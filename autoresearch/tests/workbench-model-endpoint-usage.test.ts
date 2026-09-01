import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildWorkbenchState } from "../src/workbench/scan.js";
import { startWorkbenchServer } from "../src/workbench/server.js";

function makeWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-endpoint-"));
	mkdirSync(join(root, "outputs", "model-endpoints"), { recursive: true });
	writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n");
	return root;
}

test("workbench promotes saved model endpoint artifacts into compute and execution history", () => {
	const root = makeWorkspace();
	const previousNvidiaKey = process.env.NVIDIA_API_KEY;
	delete process.env.NVIDIA_API_KEY;
	try {
		const stem = "esmfold-abcdef123456-20260703051300";
		const outputPath = join(root, "outputs", "model-endpoints", `${stem}.pdb`);
		const provenancePath = join(root, "outputs", "model-endpoints", `${stem}.provenance.md`);
		writeFileSync(outputPath, [
			"HEADER    FEYNMAN TEST MODEL",
			"ATOM      1  N   MET A   1      11.104  13.207  14.111  1.00 20.00           N",
			"END",
			"",
		].join("\n"));
		writeFileSync(provenancePath, [
			"# esmfold model endpoint provenance",
			"",
			"- Provider: nvidia-bionemo",
			"- Endpoint: https://health.api.nvidia.com/v1/biology/nvidia/esmfold",
			"- Auth: NVIDIA_API_KEY",
			"- Status: 200 OK",
			"- Sequence length: 14",
			"- Output format: pdb",
			"- Source docs:",
			"  - https://docs.api.nvidia.com/nim/reference/meta-esmfold-infer",
			"",
		].join("\n"));

		const state = buildWorkbenchState({ workingDir: root });
		const expectedOutputs = [
			`outputs/model-endpoints/${stem}.pdb`,
			`outputs/model-endpoints/${stem}.provenance.md`,
		];
		const computeJob = state.computeJobs.find((job) => job.executionId === `model-endpoint:${stem}`);
		assert.ok(computeJob, "expected model endpoint compute job");
		assert.equal(computeJob?.providerId, "nvidia-bionemo");
		assert.equal(computeJob?.providerName, "NVIDIA BioNeMo NIM");
		assert.equal(computeJob?.family, "Model endpoint");
		assert.equal(computeJob?.tierType, "cloud");
		assert.equal(computeJob?.status, "complete");
		assert.equal(computeJob?.language, "esmfold");
		assert.equal(computeJob?.hardwareDetails, "Hosted NVIDIA BioNeMo/NIM endpoint");
		assert.match(computeJob?.detail ?? "", /200 OK/);
		assert.match(computeJob?.command ?? "", /feynman_model_endpoint_call --provider nvidia-bionemo --model esmfold/);
		assert.deepEqual(computeJob?.outputPaths, expectedOutputs);

		const execution = state.execution.find((record) => record.id === `model-endpoint:${stem}`);
		assert.ok(execution, "expected model endpoint execution record");
		assert.equal(execution?.kind, "tool");
		assert.equal(execution?.origin, "workspace");
		assert.equal(execution?.status, "complete");
		assert.equal(execution?.environment, "NVIDIA BioNeMo NIM / ESMFold");
		assert.match(execution?.details ?? "", /NVIDIA_API_KEY/);
		assert.deepEqual(execution?.outputPaths, expectedOutputs);
		assert.equal(state.runs.some((run) => run.slug === "model-endpoints"), true);

		const managed = state.managedEndpoints.find((endpoint) => endpoint.name === "nvidia-bionemo");
		assert.equal(managed?.url, "https://health.api.nvidia.com/v1/biology/nvidia/esmfold");
		assert.equal(managed?.port, 443);
		assert.equal(managed?.credentialName, "NVIDIA_API_KEY");
		assert.equal(managed?.skillName, "feynman_model_endpoint_call");
		assert.equal(managed?.startScript, "");
		assert.equal(managed?.stopScript, "");
		assert.equal(managed?.livePath, "/v1/biology/nvidia/esmfold");
		assert.match(managed?.approvedScriptHash ?? "", /^[0-9a-f]{64}$/);
		assert.equal(managed?.state, "stopped");
		assert.match(managed?.lastError ?? "", /NVIDIA_API_KEY/);
		assert.equal(managed?.registeredBy, "feynman-runtime-context");
		assert.deepEqual(managed?.models, ["esmfold", "alphafold2"]);
		assert.equal(managed?.status, "missing");
		assert.ok((managed?.createdAtMs ?? 0) > 0);
	} finally {
		if (previousNvidiaKey === undefined) delete process.env.NVIDIA_API_KEY;
		else process.env.NVIDIA_API_KEY = previousNvidiaKey;
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench server returns managed endpoint rows through state", async () => {
	const root = makeWorkspace();
	const previousNvidiaKey = process.env.NVIDIA_API_KEY;
	process.env.NVIDIA_API_KEY = "nvidia-test-key";
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
			managedEndpoints: Array<{
				name: string;
				credentialName?: string;
				state: string;
				status: string;
				url: string;
			}>;
		};
		const managed = payload.managedEndpoints.find((endpoint) => endpoint.name === "nvidia-bionemo");
		assert.equal(managed?.url, "https://health.api.nvidia.com/v1/biology/nvidia/esmfold");
		assert.equal(managed?.credentialName, "NVIDIA_API_KEY");
		assert.equal(managed?.state, "live");
		assert.equal(managed?.status, "present");
	} finally {
		await handle.close();
		if (previousNvidiaKey === undefined) delete process.env.NVIDIA_API_KEY;
		else process.env.NVIDIA_API_KEY = previousNvidiaKey;
		rmSync(root, { recursive: true, force: true });
	}
});
