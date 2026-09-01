import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import { buildWorkbenchState } from "../src/workbench/scan.js";
import { executeNotebookCell } from "../src/workbench/notebook-execution.js";
import {
	managedNotebookEnvironmentRoot,
	managedPythonExecutable,
	managedRLibraryDir,
	notebookRuntimeProcessEnv,
} from "../src/workbench/notebook-runtimes.js";
import {
	manageNotebookEnvironment,
	readNotebookEnvironmentActions,
} from "../src/workbench/notebook-managed-environments.js";

function tempWorkspace(): string {
	return mkdtempSync(join(tmpdir(), "feynman-managed-env-"));
}

function hasPythonVenv(): boolean {
	const result = spawnSync("python3", ["-m", "venv", "--help"], { encoding: "utf8", timeout: 5000 });
	return result.status === 0;
}

test("managed Python env becomes the notebook Python runtime", async () => {
	if (!hasPythonVenv()) return;
	const root = tempWorkspace();
	try {
		const action = await manageNotebookEnvironment(root, {
			language: "python",
			mode: "create",
			packages: "",
		});
		assert.equal(action.status, "complete");
		assert.equal(existsSync(managedPythonExecutable(root)), true);

		const state = buildWorkbenchState({ workingDir: root, version: "0.0.0-test" });
		const python = state.environments.find((environment) => environment.id === "python");
		assert.equal(python?.managed, true);
		assert.equal(python?.source, "managed");
		assert.equal(python?.actionCount, 1);

		const execution = await executeNotebookCell({
			workingDir: root,
			timeoutMs: 30_000,
		}, {
			sessionId: "managed-python",
			projectId: "workspace",
			title: "Managed Python",
			language: "python",
			executionMode: "isolated",
			purpose: "verification",
			code: "import sys\nprint(sys.executable)",
		});
		assert.equal(execution.status, "complete");
		assert.equal(execution.stdout.trim(), managedPythonExecutable(root));
		assert.equal(execution.environmentSnapshot?.runtime?.executable, managedPythonExecutable(root));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("managed R env creates a project library inherited by runtime processes", async () => {
	const root = tempWorkspace();
	try {
		const action = await manageNotebookEnvironment(root, {
			language: "r",
			mode: "create",
			packages: "",
		});
		assert.equal(action.status, "complete");
		assert.equal(existsSync(managedRLibraryDir(root)), true);
		assert.match(notebookRuntimeProcessEnv(root).R_LIBS_USER ?? "", /r-library/);

		const state = buildWorkbenchState({ workingDir: root, version: "0.0.0-test" });
		const rSession = state.environments.find((environment) => environment.id === "r-session");
		const rscript = state.environments.find((environment) => environment.id === "rscript");
		assert.equal(rSession?.managed, true);
		assert.equal(rscript?.managed, true);
		assert.equal(rSession?.actionCount, 1);
		assert.equal(readNotebookEnvironmentActions(root).length, 1);
		assert.equal(managedNotebookEnvironmentRoot(root).endsWith("/environments"), true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("managed env package specs reject shell-shaped input", async () => {
	const root = tempWorkspace();
	try {
		await assert.rejects(
			manageNotebookEnvironment(root, {
				language: "python",
				mode: "install",
				packages: ["scanpy;rm"],
			}),
			/Unsupported python package spec/,
		);
		await assert.rejects(
			manageNotebookEnvironment(root, {
				language: "r",
				mode: "install",
				packages: ["BiocManager::install"],
			}),
			/Unsupported r package spec/,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
