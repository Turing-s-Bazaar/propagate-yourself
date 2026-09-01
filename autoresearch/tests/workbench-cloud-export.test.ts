import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildWorkbenchState } from "../src/workbench/scan.js";
import { startWorkbenchServer } from "../src/workbench/server.js";
import { workbenchDataPath } from "../src/workbench/data-root.js";

function makeWorkspace(): { exportRoot: string; root: string } {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-cloud-export-"));
	const exportRoot = mkdtempSync(join(tmpdir(), "feynman-workbench-cloud-target-"));
	mkdirSync(join(root, "outputs"), { recursive: true });
	writeFileSync(join(root, "outputs", "alpha.md"), "# Alpha\n\nExport me.\n");
	writeFileSync(workbenchDataPath(root, "settings.json"), JSON.stringify({
		schema: "feynman.workbenchSettings.v1",
		credentialRefs: [{
			id: "local-export",
			name: "Local export target",
			provider: "local",
			envVar: "FEYNMAN_TEST_EXPORT_TARGET",
			description: "Used by the cloud export test.",
			createdAt: "2026-07-01T00:00:00.000Z",
			updatedAt: "2026-07-01T00:00:00.000Z",
		}, {
			id: "missing-export",
			name: "Missing S3 export target",
			provider: "s3",
			envVar: "FEYNMAN_TEST_MISSING_EXPORT_TARGET",
			createdAt: "2026-07-01T00:00:00.000Z",
			updatedAt: "2026-07-01T00:00:00.000Z",
		}],
		updatedAt: "2026-07-01T00:00:00.000Z",
	}, null, 2));
	return { exportRoot, root };
}

test("workbench state exposes configured credential-backed cloud export targets", () => {
	const { exportRoot, root } = makeWorkspace();
	const original = process.env.FEYNMAN_TEST_EXPORT_TARGET;
	process.env.FEYNMAN_TEST_EXPORT_TARGET = `file://${exportRoot}`;
	try {
		const state = buildWorkbenchState({ workingDir: root });
		assert.equal(state.cloudExportTargets.length, 2);
		const localTarget = state.cloudExportTargets.find((target) => target.id === "local-export");
		assert.equal(localTarget?.provider, "local");
		assert.equal(localTarget?.status, "configured");
		const localCredential = state.cloudCredentials.find((credential) => credential.settingsRecordId === "local-export");
		assert.match(localCredential?.id ?? "", /^[0-9a-f-]{36}$/);
		assert.equal(localCredential?.userId, "local-workbench");
		assert.equal(localCredential?.provider, "local");
		assert.equal(localCredential?.credentialType, "filesystem-target");
		assert.equal(localCredential?.encryptedCredentials, "feynman-env-ref:FEYNMAN_TEST_EXPORT_TARGET");
		assert.equal(localCredential?.defaultBucket, exportRoot);
		assert.equal(localCredential?.status, "configured");
		assert.ok((localCredential?.createdAtMs ?? 0) > 0);
		const missingCredential = state.cloudCredentials.find((credential) => credential.settingsRecordId === "missing-export");
		assert.equal(missingCredential?.provider, "s3");
		assert.equal(missingCredential?.credentialType, "env-reference-missing");
		assert.equal(missingCredential?.status, "missing");
		assert.equal(missingCredential?.defaultBucket, undefined);
		assert.equal(state.resources.find((group) => group.id === "storage")?.resources.find((resource) => resource.id === "cloud-storage")?.status, "configured");
	} finally {
		if (original === undefined) {
			delete process.env.FEYNMAN_TEST_EXPORT_TARGET;
		} else {
			process.env.FEYNMAN_TEST_EXPORT_TARGET = original;
		}
		rmSync(root, { recursive: true, force: true });
		rmSync(exportRoot, { recursive: true, force: true });
	}
});

test("workbench server exports an artifact through the authenticated cloud export API", async () => {
	const { exportRoot, root } = makeWorkspace();
	const original = process.env.FEYNMAN_TEST_EXPORT_TARGET;
	process.env.FEYNMAN_TEST_EXPORT_TARGET = `file://${exportRoot}`;
	const handle = await startWorkbenchServer({
		workingDir: root,
		version: "0.0.0-test",
		host: "127.0.0.1",
		port: 0,
		token: "test-token",
	});
	try {
		const response = await fetch(`${handle.url}api/artifact/export-cloud`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				cookie: "feynman_workbench=test-token",
			},
			body: JSON.stringify({
				artifactPath: "outputs/alpha.md",
				credentialId: "local-export",
				destinationPath: "exports/alpha-copy.md",
			}),
		});
		assert.equal(response.status, 200);
		const payload = await response.json() as {
			export: { artifactPath: string; destinationPath: string; status: string; target: string };
			state: {
				cloudCredentials: Array<{ settingsRecordId: string; status: string }>;
				cloudExportTargets: Array<{ id: string; status: string }>;
			};
		};
		assert.equal(payload.export.artifactPath, "outputs/alpha.md");
		assert.equal(payload.export.destinationPath, "exports/alpha-copy.md");
		assert.equal(payload.export.status, "complete");
		assert.equal(payload.state.cloudExportTargets[0]?.status, "configured");
		assert.equal(payload.state.cloudCredentials.find((credential) => credential.settingsRecordId === "local-export")?.status, "configured");
		assert.equal(readFileSync(join(exportRoot, "exports", "alpha-copy.md"), "utf8"), "# Alpha\n\nExport me.\n");
		const logPath = workbenchDataPath(root, "cloud-exports.jsonl");
		assert.equal(existsSync(logPath), true);
		assert.match(readFileSync(logPath, "utf8"), /"status":"complete"/);
		assert.equal(existsSync(join(root, ".feynman", "workbench", "cloud-exports.jsonl")), false);
		assert.match(payload.export.target, /^file:\/\//);
	} finally {
		await handle.close();
		if (original === undefined) {
			delete process.env.FEYNMAN_TEST_EXPORT_TARGET;
		} else {
			process.env.FEYNMAN_TEST_EXPORT_TARGET = original;
		}
		rmSync(root, { recursive: true, force: true });
		rmSync(exportRoot, { recursive: true, force: true });
	}
});
