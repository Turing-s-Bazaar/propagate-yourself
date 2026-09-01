import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	applyWorkbenchArtifactRefinement,
	readWorkbenchEditableArtifact,
	suggestWorkbenchArtifactRefinement,
	updateWorkbenchArtifactContent,
} from "../src/workbench/artifact-edit.js";
import { workbenchDataPath } from "../src/workbench/data-root.js";
import type { WorkbenchPromptRequest } from "../src/workbench/chat.js";
import { buildWorkbenchState } from "../src/workbench/scan.js";
import { startWorkbenchServer } from "../src/workbench/server.js";

function makeWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-artifact-edit-"));
	mkdirSync(join(root, "outputs"), { recursive: true });
	mkdirSync(join(root, "papers"), { recursive: true });
	writeFileSync(join(root, "outputs", "alpha.md"), "# Alpha\n\nOriginal claim.\n");
	writeFileSync(join(root, "outputs", "ethanol.smi"), "CCO ethanol\n");
	writeFileSync(join(root, "outputs", "sketch.ket"), "{\"root\":{\"nodes\":[{\"type\":\"atom\"}]}}\n");
	writeFileSync(join(root, "papers", "figure.png"), "not-really-a-png");
	return root;
}

test("artifact edit reads and saves tracked text artifacts with snapshots", () => {
	const root = makeWorkspace();
	try {
		const editable = readWorkbenchEditableArtifact(root, "outputs/alpha.md");
		assert.equal(editable.content, "# Alpha\n\nOriginal claim.\n");
		assert.equal(editable.artifactPath, "outputs/alpha.md");

		const result = updateWorkbenchArtifactContent(root, {
			artifactPath: "outputs/alpha.md",
			content: "# Alpha\n\nRevised claim with evidence.\n",
		});
		assert.equal(result.changed, true);
		assert.equal(result.snapshotRecords.length, 1);
		assert.equal(result.snapshotRecords[0]?.artifactPath, "outputs/alpha.md");
		assert.equal(readFileSync(join(root, "outputs", "alpha.md"), "utf8"), "# Alpha\n\nRevised claim with evidence.\n");
		assert.equal(existsSync(workbenchDataPath(root, "artifact-snapshots", "workbench-edit.jsonl")), true);

		const state = buildWorkbenchState({ workingDir: root });
		const versions = state.artifactVersions.filter((version) => version.artifactPath === "outputs/alpha.md");
		assert.equal(versions.length, 1);
		assert.equal(versions[0]?.snapshotPath?.includes("artifact-snapshots/files"), true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("artifact edit saves previewable molecule text artifacts with snapshots", () => {
	const root = makeWorkspace();
	try {
		const editable = readWorkbenchEditableArtifact(root, "outputs/ethanol.smi");
		assert.equal(editable.content, "CCO ethanol\n");
		assert.equal(editable.artifactPath, "outputs/ethanol.smi");

		const result = updateWorkbenchArtifactContent(root, {
			artifactPath: "outputs/ethanol.smi",
			content: "CCO\n",
		});
		assert.equal(result.changed, true);
		assert.equal(result.snapshotRecords.length, 1);
		assert.equal(result.snapshotRecords[0]?.artifactPath, "outputs/ethanol.smi");
		assert.equal(readFileSync(join(root, "outputs", "ethanol.smi"), "utf8"), "CCO\n");

		const sketch = readWorkbenchEditableArtifact(root, "outputs/sketch.ket");
		assert.equal(sketch.content, "{\"root\":{\"nodes\":[{\"type\":\"atom\"}]}}\n");
		const sketchResult = updateWorkbenchArtifactContent(root, {
			artifactPath: "outputs/sketch.ket",
			content: "{\"root\":{\"nodes\":[{\"type\":\"atom\"},{\"type\":\"atom\"}]}}\n",
		});
		assert.equal(sketchResult.changed, true);
		assert.equal(readFileSync(join(root, "outputs", "sketch.ket"), "utf8"), "{\"root\":{\"nodes\":[{\"type\":\"atom\"},{\"type\":\"atom\"}]}}\n");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("artifact edit rejects traversal and non-text artifacts", () => {
	const root = makeWorkspace();
	try {
		assert.throws(
			() => readWorkbenchEditableArtifact(root, "../outside.md"),
			/Cannot edit files outside the workspace/,
		);
		assert.throws(
			() => readWorkbenchEditableArtifact(root, "papers/figure.png"),
			/not editable as text/,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("artifact refinement suggests replacements and applies only the selected span", async () => {
	const root = makeWorkspace();
	try {
		const requests: WorkbenchPromptRequest[] = [];
		const suggestion = await suggestWorkbenchArtifactRefinement({
			workingDir: root,
			executor: async (request) => {
				requests.push(request);
				return { content: JSON.stringify({ suggestion: "Revised claim with an explicit benchmark caveat." }) };
			},
		}, {
			artifactPath: "outputs/alpha.md",
			instruction: "Add the benchmark caveat.",
			mode: "edit",
			projectId: "workspace",
			selectedText: "Original claim.",
			sessionId: "alpha",
			title: "Alpha",
		});
		assert.equal(suggestion.source, "model");
		assert.equal(suggestion.suggestion, "Revised claim with an explicit benchmark caveat.");
		assert.match(requests[0]?.message ?? "", /replacement text/);
		assert.match(requests[0]?.message ?? "", /Original claim/);

		const applied = applyWorkbenchArtifactRefinement(root, {
			artifactPath: "outputs/alpha.md",
			selectedText: "Original claim.",
			replacementText: suggestion.suggestion,
		});
		assert.equal(applied.changed, true);
		assert.equal(applied.startOffset, "# Alpha\n\n".length);
		assert.equal(readFileSync(join(root, "outputs", "alpha.md"), "utf8"), "# Alpha\n\nRevised claim with an explicit benchmark caveat.\n");
		const state = buildWorkbenchState({ workingDir: root });
		assert.equal(state.artifactVersions.some((version) => version.artifactPath === "outputs/alpha.md" && version.snapshotPath), true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench server edits artifacts through the authenticated API", async () => {
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
		const readResponse = await fetch(`${handle.url}api/artifact/edit?path=${encodeURIComponent("outputs/alpha.md")}`, {
			headers: { cookie: "feynman_workbench=test-token" },
		});
		assert.equal(readResponse.status, 200);
		const readPayload = await readResponse.json() as { artifact: { content: string } };
		assert.equal(readPayload.artifact.content, "# Alpha\n\nOriginal claim.\n");

		const saveResponse = await fetch(`${handle.url}api/artifact/edit`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				artifactPath: "outputs/alpha.md",
				content: "# Alpha\n\nSaved from the workbench editor.\n",
			}),
		});
		assert.equal(saveResponse.status, 200);
		const savePayload = await saveResponse.json() as {
			edit: { artifactPath: string; changed: boolean; snapshotRecords: Array<{ artifactPath: string }> };
			state: { artifacts: Array<{ path: string }>; artifactVersions: Array<{ artifactPath: string }> };
		};
		assert.equal(savePayload.edit.artifactPath, "outputs/alpha.md");
		assert.equal(savePayload.edit.changed, true);
		assert.equal(savePayload.edit.snapshotRecords.length, 1);
		assert.equal(savePayload.state.artifacts.some((artifact) => artifact.path === "outputs/alpha.md"), true);
		assert.equal(savePayload.state.artifactVersions.some((version) => version.artifactPath === "outputs/alpha.md"), true);
		assert.equal(readFileSync(join(root, "outputs", "alpha.md"), "utf8"), "# Alpha\n\nSaved from the workbench editor.\n");
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench server suggests and applies artifact refinements through the authenticated API", async () => {
	const root = makeWorkspace();
	const handle = await startWorkbenchServer({
		workingDir: root,
		version: "0.0.0-test",
		host: "127.0.0.1",
		port: 0,
		token: "test-token",
		promptExecutor: async () => ({
			content: JSON.stringify({ suggestion: "Server-side suggested replacement." }),
		}),
	});
	try {
		const headers = {
			"content-type": "application/json",
			cookie: "feynman_workbench=test-token",
		};
		const suggested = await fetch(`${handle.url}api/artifact/refinement/suggest`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				sessionId: "alpha",
				projectId: "workspace",
				title: "Alpha",
				artifactPath: "outputs/alpha.md",
				mode: "edit",
				selectedText: "Original claim.",
				instruction: "Revise the selected sentence.",
			}),
		});
		assert.equal(suggested.status, 200);
		const suggestedPayload = await suggested.json() as { suggestion: { suggestion: string; source: string } };
		assert.equal(suggestedPayload.suggestion.source, "model");
		assert.equal(suggestedPayload.suggestion.suggestion, "Server-side suggested replacement.");

		const applied = await fetch(`${handle.url}api/artifact/refinement/apply`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				artifactPath: "outputs/alpha.md",
				selectedText: "Original claim.",
				replacementText: suggestedPayload.suggestion.suggestion,
			}),
		});
		assert.equal(applied.status, 200);
		const appliedPayload = await applied.json() as {
			edit: { changed: boolean; replacementText: string; snapshotRecords: Array<{ artifactPath: string }> };
			state: { artifactVersions: Array<{ artifactPath: string; snapshotPath?: string }> };
		};
		assert.equal(appliedPayload.edit.changed, true);
		assert.equal(appliedPayload.edit.replacementText, "Server-side suggested replacement.");
		assert.equal(appliedPayload.edit.snapshotRecords.length, 1);
		assert.equal(readFileSync(join(root, "outputs", "alpha.md"), "utf8"), "# Alpha\n\nServer-side suggested replacement.\n");
		assert.equal(appliedPayload.state.artifactVersions.some((version) => version.artifactPath === "outputs/alpha.md" && version.snapshotPath), true);
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});
