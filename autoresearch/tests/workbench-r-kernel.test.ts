import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildWorkbenchState } from "../src/workbench/scan.js";
import { workbenchDataPath } from "../src/workbench/data-root.js";
import { closeNotebookKernelSessions, executeNotebookCell, readNotebookExecutionRecords } from "../src/workbench/notebook-execution.js";

function makeWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-r-"));
	mkdirSync(join(root, "outputs"), { recursive: true });
	writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n");
	return root;
}

function writeFakeR(root: string): string {
	const fakeR = join(root, "fake-r.js");
	writeFileSync(fakeR, [
		"#!/usr/bin/env node",
		"let answer = 0;",
		"let buffer = '';",
		"process.stdin.setEncoding('utf8');",
		"process.stdin.on('data', (chunk) => {",
		"  buffer += chunk;",
		"  let index = buffer.indexOf('\\n');",
		"  while (index !== -1) {",
		"    const line = buffer.slice(0, index);",
		"    buffer = buffer.slice(index + 1);",
		"    if (line.includes('answer <- 41')) answer = 41;",
		"    if (line.includes('answer + 1')) process.stdout.write(String(answer + 1) + '\\n');",
		"    const marker = line.match(/(__FEYNMAN_NOTEBOOK_[A-Za-z0-9_]+_DONE__):/);",
		"    if (marker) process.stdout.write(marker[1] + ':0\\n');",
		"    index = buffer.indexOf('\\n');",
		"  }",
		"});",
		"",
	].join("\n"));
	chmodSync(fakeR, 0o755);
	return fakeR;
}

function writeFakeRscript(root: string): string {
	const fakeRscript = join(root, "fake-rscript.js");
	writeFileSync(fakeRscript, [
		"#!/usr/bin/env node",
		"if (process.argv[2] === '-e') {",
		"  process.stdout.write('R version fake');",
		"  process.exit(0);",
		"}",
		"let buffer = '';",
		"process.stdin.setEncoding('utf8');",
		"process.stdin.on('data', (chunk) => { buffer += chunk; });",
		"process.stdin.on('end', () => {",
		"  if (buffer.includes('40 + 2')) process.stdout.write('42\\n');",
		"});",
		"",
	].join("\n"));
	chmodSync(fakeRscript, 0o755);
	return fakeRscript;
}

test("notebook R session kernel persists variables across cells", async () => {
	const root = makeWorkspace();
	const previousR = process.env.R;
	try {
		process.env.R = writeFakeR(root);

		const first = await executeNotebookCell({
			workingDir: root,
			timeoutMs: 5_000,
		}, {
			sessionId: "r-memory",
			projectId: "workspace",
			title: "R memory",
			language: "r",
			executionMode: "session",
			purpose: "exploration",
			code: "answer <- 41",
		});
		const second = await executeNotebookCell({
			workingDir: root,
			timeoutMs: 5_000,
		}, {
			sessionId: "r-memory",
			projectId: "workspace",
			title: "R memory",
			language: "r",
			executionMode: "session",
			purpose: "exploration",
			code: "cat(answer + 1, '\\n')",
		});

		assert.equal(first.status, "complete");
		assert.equal(second.status, "complete");
		assert.equal(first.executionMode, "session");
		assert.equal(second.executionMode, "session");
		assert.equal(first.kernelId, second.kernelId);
		assert.equal(second.stdout.trim(), "42");

		const records = readNotebookExecutionRecords(root).filter((record) => record.sessionId === "r-memory");
		assert.equal(records[0]?.kernelId, "session:r-memory:r");
		assert.equal(records[1]?.kernelId, "session:r-memory:r");
		assert.match(readFileSync(workbenchDataPath(root, "notebook-executions", "r-memory.jsonl"), "utf8"), /session:r-memory:r/);

		const state = buildWorkbenchState({ workingDir: root });
		const kernel = state.kernels.find((item) => item.id === "session:r-memory:r");
		assert.ok(kernel, "expected state to expose the R session kernel");
		assert.equal(kernel?.active, true);
		assert.equal(kernel?.executionCount, 2);
		assert.equal(kernel?.language, "r");
		assert.equal(kernel?.executable, process.env.R);
		const rEnvironment = state.environments.find((item) => item.id === "r-session");
		assert.ok(rEnvironment, "expected state to expose the R session environment");
		assert.equal(rEnvironment?.status, "configured");
		assert.equal(rEnvironment?.executionCount, 2);
		assert.equal(rEnvironment?.sessionCount, 1);
	} finally {
		await closeNotebookKernelSessions();
		if (previousR === undefined) delete process.env.R;
		else process.env.R = previousR;
		rmSync(root, { recursive: true, force: true });
	}
});

test("notebook isolated R execution uses configured Rscript runtime", async () => {
	const root = makeWorkspace();
	const previousRscript = process.env.FEYNMAN_RSCRIPT;
	try {
		const fakeRscript = writeFakeRscript(root);
		process.env.FEYNMAN_RSCRIPT = fakeRscript;

		const executed = await executeNotebookCell({
			workingDir: root,
			timeoutMs: 5_000,
		}, {
			sessionId: "r-isolated",
			projectId: "workspace",
			title: "R isolated",
			language: "r",
			executionMode: "isolated",
			purpose: "verification",
			code: "cat(40 + 2, '\\n')",
		});

		assert.equal(executed.status, "complete");
		assert.equal(executed.stdout.trim(), "42");
		assert.match(executed.command, /fake-rscript\.js -/);
		assert.equal(executed.environmentSnapshot?.runtime?.executable, fakeRscript);
		assert.equal(executed.environmentSnapshot?.runtime?.version, "R version fake");
	} finally {
		if (previousRscript === undefined) delete process.env.FEYNMAN_RSCRIPT;
		else process.env.FEYNMAN_RSCRIPT = previousRscript;
		rmSync(root, { recursive: true, force: true });
	}
});
