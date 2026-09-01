import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildWorkbenchState } from "../src/workbench/scan.js";
import { startWorkbenchServer } from "../src/workbench/server.js";
import { upsertWorkbenchSettingsRecord } from "../src/workbench/settings-store.js";

function makeWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-capability-settings-"));
	mkdirSync(join(root, "outputs"), { recursive: true });
	mkdirSync(join(root, "papers"), { recursive: true });
	mkdirSync(join(root, "notes"), { recursive: true });
	writeFileSync(join(root, "outputs", "capabilities.md"), "# Capability settings\n");
	upsertWorkbenchSettingsRecord(root, {
		collection: "allowedDomains",
		record: { id: "nih-data", domain: "data.example.edu" },
	});
	upsertWorkbenchSettingsRecord(root, {
		collection: "computeProviderPreferences",
		record: { id: "nvidia-bionemo", enabled: false },
	});
	upsertWorkbenchSettingsRecord(root, {
		collection: "permissionGrants",
		record: {
			id: "pubmed-deny",
			name: "PubMed search",
			scope: "connector:feynman-bio-tools:pubmed_fetch",
			decision: "deny",
		},
	});
	return root;
}

test("buildWorkbenchState exposes Claude-style capability setting rows", () => {
	const root = makeWorkspace();
	try {
		const state = buildWorkbenchState({ workingDir: root, version: "0.0.0-test" });
		assert.ok(state.capabilitySettings.length >= state.resources.length);

		const disabledCompute = state.capabilitySettings.find((setting) =>
			setting.kind === "compute" && setting.key === "compute-nvidia-bionemo"
		);
		assert.equal(disabledCompute?.userId, "local-workbench");
		assert.equal(disabledCompute?.enabled, false);
		assert.equal(disabledCompute?.source, "Model endpoint");
		assert.ok((disabledCompute?.updatedAtMs ?? 0) > 0);

		const allowedDomain = state.capabilitySettings.find((setting) =>
			setting.kind === "network" && setting.key === "allowed-domain-nih-data"
		);
		assert.equal(allowedDomain?.enabled, true);
		assert.equal(allowedDomain?.settingsCollection, "allowedDomains");
		assert.equal(allowedDomain?.settingsRecordId, "nih-data");
		assert.equal(allowedDomain?.status, "configured");

		const deniedGrant = state.capabilitySettings.find((setting) =>
			setting.kind === "permissions" && setting.key === "permission-grant-pubmed-deny"
		);
		assert.equal(deniedGrant?.enabled, false);
		assert.equal(deniedGrant?.settingsCollection, "permissionGrants");
		assert.equal(deniedGrant?.settingsRecordId, "pubmed-deny");
		assert.equal(deniedGrant?.status, "disabled");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench server returns capability settings through state", async () => {
	const root = makeWorkspace();
	const handle = await startWorkbenchServer({
		workingDir: root,
		version: "0.0.0-test",
		host: "127.0.0.1",
		port: 0,
		token: "test-token",
	});
	try {
		const response = await fetch(`${handle.url}api/state`, {
			headers: { cookie: "feynman_workbench=test-token" },
		});
		assert.equal(response.status, 200);
		const payload = await response.json() as {
			capabilitySettings: Array<{ kind: string; key: string; enabled: boolean }>;
		};
		assert.equal(payload.capabilitySettings.some((setting) =>
			setting.kind === "compute" &&
			setting.key === "compute-nvidia-bionemo" &&
			setting.enabled === false
		), true);
		assert.equal(payload.capabilitySettings.some((setting) =>
			setting.kind === "network" &&
			setting.key === "allowed-domain-nih-data" &&
			setting.enabled === true
		), true);
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});
