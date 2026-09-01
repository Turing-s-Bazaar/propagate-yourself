import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { executeNotebookCell } from "../src/workbench/notebook-execution.js";
import { workbenchDataPath } from "../src/workbench/data-root.js";
import { buildWorkbenchState } from "../src/workbench/scan.js";

function makeWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-modal-"));
	mkdirSync(join(root, "outputs"), { recursive: true });
	writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n");
	return root;
}

test("notebook Modal cloud mode writes and runs a Modal app script", async () => {
	const root = makeWorkspace();
	const previousModalCli = process.env.FEYNMAN_MODAL_CLI;
	try {
		const fakeModal = join(root, "fake-modal");
		writeFileSync(fakeModal, [
			"#!/bin/sh",
			"echo \"modal cli: $@\"",
			"test \"$1\" = \"run\" || exit 2",
			"test -f \"$2\" || exit 3",
			"grep -q \"modal.App\" \"$2\" || exit 4",
			"grep -q \"FEYNMAN_MODAL_ARTIFACT_DIR\" \"$2\" || exit 5",
			"echo \"View run at https://modal.com/apps/companion/main/ap-test123\"",
			"printf '%s\\n' '__FEYNMAN_MODAL_RESULT__{\"artifacts\":[{\"contentBase64\":\"Y2xvdWQgYXJ0aWZhY3QK\",\"path\":\"outputs/modal-result.md\",\"size\":15}],\"exitCode\":0,\"stderr\":\"\",\"stdout\":\"remote ok\\n\"}'",
			"",
		].join("\n"));
		chmodSync(fakeModal, 0o755);
		process.env.FEYNMAN_MODAL_CLI = fakeModal;

		const executed = await executeNotebookCell({
			workingDir: root,
			timeoutMs: 5_000,
		}, {
			sessionId: "modal-session",
			projectId: "workspace",
			title: "Modal cell",
			language: "python",
			executionMode: "modal",
			purpose: "exploration",
			code: "print('remote value')",
		});

		assert.equal(executed.status, "complete");
		assert.equal(executed.executionMode, "modal");
		assert.equal(executed.stdout, "remote ok\n");
		assert.deepEqual(executed.outputPaths, ["outputs/modal-result.md"]);
		assert.match(executed.stderr, /Modal CLI log/);
		assert.match(executed.command, /fake-modal run .*\/modal-jobs\/.+\.py/);
		assert.equal(executed.environmentSnapshot?.executionMode, "modal");
		assert.match(executed.environmentSnapshot?.command ?? "", /fake-modal run/);
		assert.equal(readFileSync(join(root, "outputs", "modal-result.md"), "utf8"), "cloud artifact\n");
		assert.equal(executed.snapshotIds.length, 1);
		assert.equal(existsSync(workbenchDataPath(root, "artifact-snapshots")), true);

		const scriptPath = executed.command.match(/run (.+\.py)$/)?.[1];
		assert.ok(scriptPath, "expected Modal script path in command");
		const script = readFileSync(scriptPath!, "utf8");
		assert.match(script, /modal\.App/);
		assert.match(script, /USER_CODE = "print\('remote value'\)"/);
		assert.match(script, /collect_artifacts/);

		const state = buildWorkbenchState({ workingDir: root });
		const rendered = state.execution.find((item) => item.id === `notebook:${executed.id}`);
		assert.match(rendered?.environment ?? "", /Modal cloud/);
		assert.deepEqual(rendered?.outputPaths, ["outputs/modal-result.md"]);
		const computeJob = state.computeJobs.find((item) => item.executionId === `notebook:${executed.id}`);
		assert.equal(computeJob?.providerId, "modal");
		assert.equal(computeJob?.tierType, "cloud");
		assert.equal(computeJob?.remoteUrl, "https://modal.com/apps/companion/main/ap-test123");
		assert.equal(computeJob?.remoteHandle, "ap-test123");
		assert.deepEqual(computeJob?.outputPaths, ["outputs/modal-result.md"]);
	} finally {
		if (previousModalCli === undefined) delete process.env.FEYNMAN_MODAL_CLI;
		else process.env.FEYNMAN_MODAL_CLI = previousModalCli;
		rmSync(root, { recursive: true, force: true });
	}
});
