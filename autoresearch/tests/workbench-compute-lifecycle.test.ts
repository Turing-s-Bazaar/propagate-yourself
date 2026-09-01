import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readComputePendingTerminateRecords } from "../src/workbench/compute-lifecycle.js";
import {
	cancelNotebookExecution,
	executeNotebookCell,
	listActiveNotebookExecutionRecords,
} from "../src/workbench/notebook-execution.js";
import { buildWorkbenchState } from "../src/workbench/scan.js";
import { startWorkbenchServer } from "../src/workbench/server.js";

function makeWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-compute-"));
	mkdirSync(join(root, "outputs"), { recursive: true });
	writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n");
	return root;
}

async function waitFor<T>(read: () => T | undefined | false | Promise<T | undefined | false>, label: string, timeoutMs = 5000): Promise<T> {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		const value = await read();
		if (value) return value;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error(`Timed out waiting for ${label}.`);
}

test("workbench compute jobs expose running cancel and stored retry through the API", async () => {
	const root = makeWorkspace();
	const handle = await startWorkbenchServer({
		workingDir: root,
		version: "0.0.0-test",
		host: "127.0.0.1",
		port: 0,
		token: "test-token",
	});
	const headers = {
		"content-type": "application/json",
		cookie: "feynman_workbench=test-token",
	};
	const jobId = "cancel-retry-smoke";
	try {
		const executePromise = fetch(`${handle.url}api/notebook/execute`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				sessionId: "compute-lifecycle",
				projectId: "workspace",
				title: "Compute lifecycle",
				runSlug: "compute-lifecycle",
				jobId,
				language: "bash",
				executionMode: "isolated",
				purpose: "exploration",
				code: "mkdir -p .feynman\nif [ -f .feynman/retry-ready ]; then printf 'retried\\n'; else touch .feynman/retry-ready; sleep 30; fi",
			}),
		});

		const runningState = await waitFor(async () => {
			const response = await fetch(`${handle.url}api/state`, { headers });
			const payload = await response.json() as { computeJobs: Array<{ id: string; status: string }> };
			return payload.computeJobs.find((job) => job.id === `compute:${jobId}` && job.status === "running");
		}, "running compute job");
		assert.equal(runningState.status, "running");
		const runningResponse = await fetch(`${handle.url}api/state`, { headers });
		const runningPayload = await runningResponse.json() as {
			computeUsage: Array<{
				jobId: string;
				status: string;
				provider: string;
				frameId?: string;
				projectId?: string;
				startedAtMs: number;
				endedAt?: string;
				expiresAtMs?: number;
			}>;
			pollerLeases: Array<{
				provider: string;
				holder: string;
				expiresAtMs: number;
				activeJobIds: string[];
				pendingTerminateIds: string[];
			}>;
		};
		const runningUsage = runningPayload.computeUsage.find((usage) => usage.jobId === `compute:${jobId}`);
		assert.equal(runningUsage?.status, "running");
		assert.equal(runningUsage?.provider, "local-process");
		assert.equal(runningUsage?.frameId, "compute-lifecycle");
		assert.equal(runningUsage?.projectId, "workspace");
		assert.equal(runningUsage?.endedAt, undefined);
		assert.ok((runningUsage?.expiresAtMs ?? 0) > (runningUsage?.startedAtMs ?? 0));
		assert.equal(runningPayload.pollerLeases.length, 1);
		assert.equal(runningPayload.pollerLeases[0]?.provider, "*");
		assert.match(runningPayload.pollerLeases[0]?.holder ?? "", /^poller-[0-9a-f]{32}$/);
		assert.ok((runningPayload.pollerLeases[0]?.expiresAtMs ?? 0) > Date.now());
		assert.deepEqual(runningPayload.pollerLeases[0]?.activeJobIds, [`compute:${jobId}`]);
		assert.deepEqual(runningPayload.pollerLeases[0]?.pendingTerminateIds, []);
		await waitFor(() => existsSync(join(root, ".feynman", "retry-ready")), "retry marker");

		const cancel = await fetch(`${handle.url}api/compute/job/action`, {
			method: "POST",
			headers,
			body: JSON.stringify({ jobId: `compute:${jobId}`, action: "cancel" }),
		});
		assert.equal(cancel.status, 200);
		const cancelPayload = await cancel.json() as { result: { ok: boolean } };
		assert.equal(cancelPayload.result.ok, true);

		const executeResponse = await executePromise;
		assert.equal(executeResponse.status, 200);
		const executePayload = await executeResponse.json() as {
			execution: { status: string; stderr: string; signal?: string };
			state: {
				computeJobs: Array<{ id: string; status: string }>;
				computeUsage: Array<{ jobId: string; status: string; endedAt?: string; endedAtMs?: number }>;
			};
		};
		assert.equal(executePayload.execution.status, "stopped");
		assert.match(`${executePayload.execution.stderr}\n${executePayload.execution.signal ?? ""}`, /canceled|SIGTERM/);
		assert.equal(executePayload.state.computeJobs.find((job) => job.id === `compute:${jobId}`)?.status, "stopped");
		const stoppedUsage = executePayload.state.computeUsage.find((usage) => usage.jobId === `compute:${jobId}`);
		assert.equal(stoppedUsage?.status, "stopped");
		assert.ok((stoppedUsage?.endedAtMs ?? 0) > 0);
		assert.match(stoppedUsage?.endedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);

		const retry = await fetch(`${handle.url}api/compute/job/action`, {
			method: "POST",
			headers,
			body: JSON.stringify({ jobId: `compute:${jobId}`, action: "retry" }),
		});
		assert.equal(retry.status, 200);
		const retryPayload = await retry.json() as {
			execution: { status: string; stdout: string };
			state: { computeJobs: Array<{ status: string }> };
		};
		assert.equal(retryPayload.execution.status, "complete");
		assert.match(retryPayload.execution.stdout, /retried/);
		assert.ok(retryPayload.state.computeJobs.some((job) => job.status === "complete"));
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});

test("canceling an active Modal notebook job records a pending terminate entry", async () => {
	const root = makeWorkspace();
	const previousModalCli = process.env.FEYNMAN_MODAL_CLI;
	try {
		const fakeModal = join(root, "fake-modal");
		writeFileSync(fakeModal, [
			"#!/bin/sh",
			"echo \"View run at https://modal.com/apps/companion/main/ap-cancel123\"",
			"sleep 30",
		].join("\n"));
		chmodSync(fakeModal, 0o755);
		process.env.FEYNMAN_MODAL_CLI = fakeModal;

		const jobId = "modal-cancel-smoke";
		const executionPromise = executeNotebookCell({
			workingDir: root,
			timeoutMs: 30_000,
		}, {
			sessionId: "modal-cancel",
			projectId: "workspace",
			title: "Modal cancel",
			jobId,
			language: "python",
			executionMode: "modal",
			purpose: "exploration",
			code: "print('cancel me')",
		});
		await waitFor(() => listActiveNotebookExecutionRecords(root).find((record) => record.id === jobId), "active Modal job");
		const cancel = await cancelNotebookExecution(root, jobId);
		assert.equal(cancel.ok, true);
		const execution = await executionPromise;
		assert.equal(execution.status, "stopped");
		assert.match(`${execution.stderr}\n${execution.signal ?? ""}`, /canceled|SIGTERM/);

		const pending = readComputePendingTerminateRecords(root);
		assert.equal(pending.length, 1);
		assert.equal(pending[0]?.jobId, jobId);
		assert.equal(pending[0]?.provider, "modal");
		assert.equal(pending[0]?.attempts, 0);
		const state = buildWorkbenchState({ workingDir: root, version: "0.0.0-test" });
		assert.equal(state.computePendingTerminates.length, 1);
		assert.equal(state.computePendingTerminates[0]?.sandboxId, jobId);
		assert.equal(state.computePendingTerminates[0]?.provider, "modal");
		assert.equal(state.computePendingTerminates[0]?.attempts, 0);
		assert.equal(state.computePendingTerminates[0]?.status, "pending");
		assert.ok((state.computePendingTerminates[0]?.enqueuedAtMs ?? 0) > 0);
		assert.equal(state.pollerLeases.length, 1);
		assert.equal(state.pollerLeases[0]?.provider, "*");
		assert.match(state.pollerLeases[0]?.holder ?? "", /^poller-[0-9a-f]{32}$/);
		assert.ok((state.pollerLeases[0]?.expiresAtMs ?? 0) > Date.now());
		assert.deepEqual(state.pollerLeases[0]?.pendingTerminateIds, [jobId]);
	} finally {
		if (previousModalCli === undefined) delete process.env.FEYNMAN_MODAL_CLI;
		else process.env.FEYNMAN_MODAL_CLI = previousModalCli;
		rmSync(root, { recursive: true, force: true });
	}
});
