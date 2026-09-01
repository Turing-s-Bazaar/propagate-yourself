import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	readWorkbenchArtifactActions,
	updateWorkbenchArtifactAction,
} from "../src/workbench/artifact-actions.js";
import { workbenchDataPath } from "../src/workbench/data-root.js";
import { buildWorkbenchState } from "../src/workbench/scan.js";
import { startWorkbenchServer } from "../src/workbench/server.js";

function makeWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-artifact-actions-"));
	mkdirSync(join(root, "outputs"), { recursive: true });
	writeFileSync(join(root, "outputs", "alpha.md"), "# Alpha\n\nBody.\n");
	writeFileSync(join(root, "outputs", "beta.md"), "# Beta\n\nBody.\n");
	return root;
}

test("artifact actions persist star, rename, hide, and reversible delete state", () => {
	const root = makeWorkspace();
	try {
		updateWorkbenchArtifactAction(root, { artifactPath: "outputs/beta.md", action: "star" });
		updateWorkbenchArtifactAction(root, { artifactPath: "outputs/beta.md", action: "rename", displayName: "Pinned Beta Result" });

		let state = buildWorkbenchState({ workingDir: root });
		assert.equal(state.artifacts[0]?.path, "outputs/beta.md");
		assert.equal(state.artifacts[0]?.starred, true);
		assert.equal(state.artifacts[0]?.title, "Pinned Beta Result");

		updateWorkbenchArtifactAction(root, { artifactPath: "outputs/beta.md", action: "hide" });
		state = buildWorkbenchState({ workingDir: root });
		assert.equal(state.artifacts.some((artifact) => artifact.path === "outputs/beta.md"), false);
		assert.equal(state.artifactActions.find((item) => item.artifactPath === "outputs/beta.md")?.status, "hidden");
		assert.equal(state.summary.artifactCount, 1);

		const deleted = updateWorkbenchArtifactAction(root, { artifactPath: "outputs/alpha.md", action: "delete" });
		assert.equal(deleted.deleted, true);
		assert.ok(deleted.trashPath, "expected a workbench trash path");
		assert.equal(existsSync(join(root, "outputs", "alpha.md")), false);
		assert.equal(existsSync(deleted.trashPath ?? ""), true);
		assert.match(readFileSync(workbenchDataPath(root, "artifact-actions.json"), "utf8"), /Pinned Beta Result/);
		assert.equal(existsSync(join(root, ".feynman", "workbench", "artifact-actions.json")), false);
		assert.equal(readWorkbenchArtifactActions(root).length, 2);

		state = buildWorkbenchState({ workingDir: root });
		assert.equal(state.summary.artifactCount, 0);
		assert.equal(state.artifactActions.find((item) => item.artifactPath === "outputs/alpha.md")?.status, "deleted");

		updateWorkbenchArtifactAction(root, { artifactPath: "outputs/alpha.md", action: "restore" });
		updateWorkbenchArtifactAction(root, { artifactPath: "outputs/beta.md", action: "unhide" });
		state = buildWorkbenchState({ workingDir: root });
		assert.equal(existsSync(join(root, "outputs", "alpha.md")), true);
		assert.equal(state.summary.artifactCount, 2);
		assert.equal(state.artifactActions.length, 0);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench server mutates artifact actions through the authenticated API", async () => {
	const root = makeWorkspace();
	const handle = await startWorkbenchServer({
		workingDir: root,
		version: "0.0.0-test",
		host: "127.0.0.1",
		port: 0,
		token: "test-token",
	});
	try {
		const headers = {
			"content-type": "application/json",
			cookie: "feynman_workbench=test-token",
		};
		const renamed = await fetch(`${handle.url}api/artifact/action`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				artifactPath: "outputs/alpha.md",
				action: "rename",
				displayName: "Renamed Alpha",
			}),
		});
		assert.equal(renamed.status, 200);
		const renamedPayload = await renamed.json() as {
			action: { displayName?: string };
			state: { artifacts: Array<{ path: string; title: string }> };
		};
		assert.equal(renamedPayload.action.displayName, "Renamed Alpha");
		assert.equal(renamedPayload.state.artifacts.find((artifact) => artifact.path === "outputs/alpha.md")?.title, "Renamed Alpha");

		const hidden = await fetch(`${handle.url}api/artifact/action`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				artifactPath: "outputs/alpha.md",
				action: "hide",
			}),
		});
		assert.equal(hidden.status, 200);
		const hiddenPayload = await hidden.json() as { state: { artifacts: Array<{ path: string }> } };
		assert.equal(hiddenPayload.state.artifacts.some((artifact) => artifact.path === "outputs/alpha.md"), false);

		const unhidden = await fetch(`${handle.url}api/artifact/action`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				artifactPath: "outputs/alpha.md",
				action: "unhide",
			}),
		});
		assert.equal(unhidden.status, 200);
		const unhiddenPayload = await unhidden.json() as { state: { artifacts: Array<{ path: string }> } };
		assert.equal(unhiddenPayload.state.artifacts.some((artifact) => artifact.path === "outputs/alpha.md"), true);

		const deleted = await fetch(`${handle.url}api/artifact/action`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				artifactPath: "outputs/beta.md",
				action: "delete",
			}),
		});
		assert.equal(deleted.status, 200);
		const deletedPayload = await deleted.json() as { state: { artifactActions: Array<{ artifactPath: string; status: string }> } };
		assert.equal(deletedPayload.state.artifactActions.find((item) => item.artifactPath === "outputs/beta.md")?.status, "deleted");
		assert.equal(existsSync(join(root, "outputs", "beta.md")), false);

		const restored = await fetch(`${handle.url}api/artifact/action`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				artifactPath: "outputs/beta.md",
				action: "restore",
			}),
		});
		assert.equal(restored.status, 200);
		const restoredPayload = await restored.json() as { state: { artifacts: Array<{ path: string }> } };
		assert.equal(restoredPayload.state.artifacts.some((artifact) => artifact.path === "outputs/beta.md"), true);
		assert.equal(existsSync(join(root, "outputs", "beta.md")), true);
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});
