import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	captureArtifactSnapshotBaseline,
	readArtifactSnapshotRecords,
	recordArtifactSnapshotsForChanges,
} from "../src/workbench/artifact-snapshots.js";
import {
	diffArtifactVersionSnapshot,
	restoreArtifactVersionSnapshot,
} from "../src/workbench/artifact-snapshot-actions.js";
import { buildWorkbenchState } from "../src/workbench/scan.js";
import { startWorkbenchServer } from "../src/workbench/server.js";
import type { WorkbenchArtifactVersion } from "../src/workbench/types.js";

function makeWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-snapshot-actions-"));
	mkdirSync(join(root, "outputs"), { recursive: true });
	mkdirSync(join(root, "papers"), { recursive: true });
	mkdirSync(join(root, "notes"), { recursive: true });
	writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n");
	writeFileSync(join(root, "outputs", "science.md"), "# Science\n\nbefore\n");
	return root;
}

function createSnapshotVersion(root: string): WorkbenchArtifactVersion {
	const baseline = captureArtifactSnapshotBaseline(root, ["outputs/science.md"]);
	writeFileSync(join(root, "outputs", "science.md"), "# Science\n\nafter workspace edit\n");
	const records = recordArtifactSnapshotsForChanges(root, baseline, {
		source: "workspace",
		sessionId: "manual-edit",
		producerExecutionId: "workspace:manual-edit",
		paths: ["outputs/science.md"],
		createdAtMs: Date.parse("2026-07-01T00:00:00.000Z"),
	});
	assert.equal(records.length, 1);
	const state = buildWorkbenchState({ workingDir: root });
	const version = state.artifactVersions.find((item) => item.snapshotId === records[0]?.id);
	assert.ok(version, "expected snapshot-backed artifact version");
	return version;
}

test("artifact version diff compares saved snapshots", () => {
	const root = makeWorkspace();
	try {
		const version = createSnapshotVersion(root);
		const diff = diffArtifactVersionSnapshot(root, version);

		assert.equal(diff.artifactPath, "outputs/science.md");
		assert.equal(diff.versionId, version.id);
		assert.equal(diff.isText, true);
		assert.equal(diff.truncated, false);
		assert.ok(diff.addedLines > 0);
		assert.ok(diff.removedLines > 0);
		assert.ok(diff.lines.some((line) => line.kind === "add" && line.text.includes("after workspace edit")));
		assert.ok(diff.lines.some((line) => line.kind === "remove" && line.text.includes("before")));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("artifact version restore writes the saved snapshot and records the restore", () => {
	const root = makeWorkspace();
	try {
		const version = createSnapshotVersion(root);
		writeFileSync(join(root, "outputs", "science.md"), "# Science\n\nlatest draft\n");

		const restore = restoreArtifactVersionSnapshot(root, version);

		assert.equal(restore.artifactPath, "outputs/science.md");
		assert.equal(restore.versionId, version.id);
		assert.equal(readFileSync(join(root, "outputs", "science.md"), "utf8"), "# Science\n\nafter workspace edit\n");
		assert.equal(restore.snapshotRecords.length, 1);
		assert.equal(restore.snapshotRecords[0]?.source, "workspace");
		assert.match(restore.snapshotRecords[0]?.producerExecutionId ?? "", /^restore:/);

		const records = readArtifactSnapshotRecords(root);
		assert.ok(records.some((record) => record.producerExecutionId === `restore:${version.id}`));
		const state = buildWorkbenchState({ workingDir: root });
		assert.ok(state.artifactVersions.some((item) =>
			item.artifactPath === "outputs/science.md" &&
			item.source === "workspace" &&
			item.producerExecutionId === `restore:${version.id}`
		));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("artifact version actions reject snapshot paths outside the snapshot store", () => {
	const root = makeWorkspace();
	try {
		const version = {
			...createSnapshotVersion(root),
			snapshotPath: "../outside.md",
		};

		assert.throws(
			() => diffArtifactVersionSnapshot(root, version),
			/Snapshot path must stay inside|Snapshot path must reference a saved artifact snapshot/,
		);
		assert.throws(
			() => restoreArtifactVersionSnapshot(root, version),
			/Snapshot path must stay inside|Snapshot path must reference a saved artifact snapshot/,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench server exposes artifact version diff and restore endpoints", async () => {
	const root = makeWorkspace();
	const version = createSnapshotVersion(root);
	writeFileSync(join(root, "outputs", "science.md"), "# Science\n\nlatest draft\n");
	const handle = await startWorkbenchServer({
		workingDir: root,
		version: "0.0.0-test",
		host: "127.0.0.1",
		port: 0,
		token: "test-token",
	});
	try {
		const diffResponse = await fetch(`${handle.url}api/artifact/version/diff`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				cookie: "feynman_workbench=test-token",
			},
			body: JSON.stringify({ artifactPath: "outputs/science.md", versionId: version.id }),
		});
		assert.equal(diffResponse.status, 200);
		const diffPayload = await diffResponse.json() as { diff: { addedLines: number; removedLines: number; isText: boolean } };
		assert.equal(diffPayload.diff.isText, true);
		assert.ok(diffPayload.diff.addedLines > 0);
		assert.ok(diffPayload.diff.removedLines > 0);

		const restoreResponse = await fetch(`${handle.url}api/artifact/version/restore`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				cookie: "feynman_workbench=test-token",
			},
			body: JSON.stringify({ artifactPath: "outputs/science.md", versionId: version.id }),
		});
		assert.equal(restoreResponse.status, 200);
		const restorePayload = await restoreResponse.json() as {
			restore: { bytesWritten: number; snapshotRecords: Array<{ producerExecutionId?: string }> };
			state: { artifactVersions: Array<{ artifactPath: string; producerExecutionId?: string }> };
		};
		assert.ok(restorePayload.restore.bytesWritten > 0);
		assert.match(restorePayload.restore.snapshotRecords[0]?.producerExecutionId ?? "", /^restore:/);
		assert.equal(readFileSync(join(root, "outputs", "science.md"), "utf8"), "# Science\n\nafter workspace edit\n");
		assert.ok(restorePayload.state.artifactVersions.some((item) =>
			item.artifactPath === "outputs/science.md" &&
			item.producerExecutionId === `restore:${version.id}`
		));
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});
