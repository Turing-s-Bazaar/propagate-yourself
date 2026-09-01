import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildWorkbenchState } from "../src/workbench/scan.js";
import { startWorkbenchServer } from "../src/workbench/server.js";
import { upsertWorkbenchSettingsRecord } from "../src/workbench/settings-store.js";

function makeWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-compute-providers-"));
	mkdirSync(join(root, "outputs"), { recursive: true });
	mkdirSync(join(root, "papers"), { recursive: true });
	mkdirSync(join(root, "notes"), { recursive: true });
	writeFileSync(join(root, "outputs", "compute-providers.md"), "# Compute providers\n");
	upsertWorkbenchSettingsRecord(root, {
		collection: "computeHosts",
		record: {
			id: "cluster",
			name: "Lab Cluster",
			host: "cluster.example.edu",
			user: "researcher",
			port: "2222",
			scheduler: "slurm",
			scratchRoot: "/scratch/feynman",
		},
	});
	upsertWorkbenchSettingsRecord(root, {
		collection: "computeProviderPreferences",
		record: { id: "nvidia-bionemo", enabled: false },
	});
	return root;
}

test("buildWorkbenchState exposes Claude-style compute provider rows", () => {
	const root = makeWorkspace();
	try {
		const state = buildWorkbenchState({ workingDir: root, version: "0.0.0-test" });
		assert.ok(state.computeProviders.length >= state.compute.length);

		const local = state.computeProviders.find((provider) => provider.name === "local-workspace");
		assert.equal(local?.displayName, "Local Workspace");
		assert.equal(local?.family, "Feynman");
		assert.equal(local?.enabled, true);
		assert.equal(local?.scratchRoot, root);
		assert.equal(local?.scratchRootSource, "workspace");
		assert.deepEqual(local?.dataRoots, ["outputs", "papers", "notes"]);
		assert.match(local?.memoryMd ?? "", /Workspace-local files/);

		const nvidia = state.computeProviders.find((provider) => provider.name === "nvidia-bionemo");
		assert.equal(nvidia?.enabled, false);
		assert.equal(nvidia?.family, "Model endpoint");
		assert.deepEqual(nvidia?.inferConfig, { hosted: "ESMFold", selfHosted: "AlphaFold2 NIM", tool: "feynman_model_endpoint_call" });
		assert.deepEqual(nvidia?.dataRoots, ["outputs/model-endpoints"]);

		const ssh = state.computeProviders.find((provider) => provider.name === "ssh:cluster");
		assert.equal(ssh?.displayName, "Lab Cluster");
		assert.equal(ssh?.family, "SSH compute");
		assert.equal(ssh?.scheduler, "slurm");
		assert.equal(ssh?.egressPolicy, "Feynman Settings Network policy");
		assert.equal(ssh?.scratchRoot, "/scratch/feynman");
		assert.equal(ssh?.scratchRootSource, "settings");
		assert.deepEqual(ssh?.sshOverrides, {
			host: "cluster.example.edu",
			user: "researcher",
			port: "2222",
		});
		assert.equal(ssh?.settingsCollection, "computeHosts");
		assert.equal(ssh?.settingsRecordId, "cluster");

		const modal = state.computeProviders.find((provider) => provider.name === "modal");
		assert.equal(modal?.egressPolicy, "Feynman Settings Network policy");
		assert.equal(modal?.modalEnvironment, process.env.MODAL_ENVIRONMENT || "main");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench server returns compute provider rows through state", async () => {
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
			computeProviders: Array<{ name: string; enabled: boolean; scheduler?: string; scratchRoot?: string }>;
		};
		assert.equal(payload.computeProviders.some((provider) =>
			provider.name === "nvidia-bionemo" &&
			provider.enabled === false
		), true);
		assert.equal(payload.computeProviders.some((provider) =>
			provider.name === "ssh:cluster" &&
			provider.scheduler === "slurm" &&
			provider.scratchRoot === "/scratch/feynman"
		), true);
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});
