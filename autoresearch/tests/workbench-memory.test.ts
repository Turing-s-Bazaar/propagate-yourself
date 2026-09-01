import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readWorkbenchMemory, removeWorkbenchMemoryRecord, removeWorkbenchNoteRecord, upsertWorkbenchMemoryRecord, upsertWorkbenchNoteRecord } from "../src/workbench/memory.js";
import { buildWorkbenchState } from "../src/workbench/scan.js";
import { startWorkbenchServer } from "../src/workbench/server.js";
import { memoriesForScope, notesForTarget } from "../workbench-web/src/memory.js";

function makeMemoryWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-memory-"));
	mkdirSync(join(root, "outputs"), { recursive: true });
	mkdirSync(join(root, "papers"), { recursive: true });
	mkdirSync(join(root, "notes"), { recursive: true });
	writeFileSync(join(root, "outputs", "result.md"), "# Result\n\nEvidence.\n", "utf8");
	writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n\n### Memory\n\n- Verified: memory state.\n", "utf8");
	return root;
}

test("workbench memory store persists scoped memories and target notes", () => {
	const root = makeMemoryWorkspace();
	try {
		upsertWorkbenchMemoryRecord(root, {
			id: "project-finding",
			body: "BRCA1 dosage evidence belongs in the project context.",
			scope: "project",
			projectId: "workspace",
			evidence: "source-backed",
		});
		upsertWorkbenchNoteRecord(root, {
			id: "artifact-note",
			content: "Check the figure legend before citing this artifact.",
			targetType: "artifact",
			targetFrameId: "result",
			targetArtifactPath: "outputs/result.md",
		});

		const store = readWorkbenchMemory(root);
		assert.equal(store.memories.length, 1);
		assert.equal(store.notes.length, 1);
		assert.equal(store.memories[0]?.scope, "project");
		assert.equal(store.notes[0]?.targetArtifactPath, "outputs/result.md");

		const state = buildWorkbenchState({ workingDir: root, version: "0.0.0-test" });
		assert.equal(state.memories.length, 1);
		assert.equal(state.notes.length, 1);
		assert.equal(state.summary.noteCount, 1);
		assert.equal(state.resources.find((group) => group.id === "memory")?.resources.find((resource) => resource.id === "target-notes")?.status, "configured");
		assert.equal(state.resources.find((group) => group.id === "memory")?.resources.find((resource) => resource.id === "session-memory-context")?.description.includes("1 memory and 1 note"), true);

		const artifact = state.artifacts.find((item) => item.path === "outputs/result.md");
		assert.equal(notesForTarget(state.notes, state.runs[0], artifact)[0]?.id, "artifact-note");
		assert.equal(memoriesForScope(state.memories, "project", state.projects[0], state.runs[0], artifact)[0]?.id, "project-finding");

		removeWorkbenchMemoryRecord(root, "project-finding");
		removeWorkbenchNoteRecord(root, "artifact-note");
		assert.equal(readWorkbenchMemory(root).memories.length, 0);
		assert.equal(readWorkbenchMemory(root).notes.length, 0);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench server mutates memory and notes through authenticated APIs", async () => {
	const root = makeMemoryWorkspace();
	const handle = await startWorkbenchServer({
		workingDir: root,
		version: "0.0.0-test",
		host: "127.0.0.1",
		port: 0,
		token: "test-token",
	});
	try {
		const headers = { "content-type": "application/json", cookie: "feynman_workbench=test-token" };
		const memoryCreated = await fetch(`${handle.url}api/memory`, {
			method: "POST",
			headers,
			body: JSON.stringify({ record: { id: "session-context", body: "Use the exact accession in follow-up runs.", scope: "session", sessionId: "result" } }),
		});
		assert.equal(memoryCreated.status, 200);
		const memoryPayload = await memoryCreated.json() as { memories: Array<{ id: string }>; state: { memories: Array<{ id: string }> } };
		assert.equal(memoryPayload.memories[0]?.id, "session-context");
		assert.equal(memoryPayload.state.memories.length, 1);

		const noteCreated = await fetch(`${handle.url}api/notes`, {
			method: "POST",
			headers,
			body: JSON.stringify({ record: { id: "session-note", content: "Re-run the notebook after changing thresholds.", targetType: "session", targetFrameId: "result" } }),
		});
		assert.equal(noteCreated.status, 200);
		const notePayload = await noteCreated.json() as { notes: Array<{ id: string }>; state: { notes: Array<{ id: string }> } };
		assert.equal(notePayload.notes[0]?.id, "session-note");
		assert.equal(notePayload.state.notes.length, 1);

		const noteUpdated = await fetch(`${handle.url}api/notes`, {
			method: "POST",
			headers,
			body: JSON.stringify({ record: { id: "session-note", content: "Updated threshold note.", targetType: "session", targetFrameId: "result" } }),
		});
		assert.equal(noteUpdated.status, 200);
		const updatedNotePayload = await noteUpdated.json() as { notes: Array<{ id: string; content: string }>; state: { notes: Array<{ id: string; content: string }> } };
		assert.equal(updatedNotePayload.notes[0]?.id, "session-note");
		assert.equal(updatedNotePayload.notes[0]?.content, "Updated threshold note.");
		assert.equal(updatedNotePayload.state.notes[0]?.content, "Updated threshold note.");

		const removed = await fetch(`${handle.url}api/memory`, {
			method: "POST",
			headers,
			body: JSON.stringify({ action: "remove", id: "session-context" }),
		});
		assert.equal(removed.status, 200);
		const removedPayload = await removed.json() as { memories: unknown[] };
		assert.equal(removedPayload.memories.length, 0);
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});
