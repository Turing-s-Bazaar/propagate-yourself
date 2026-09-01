import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ensureWorkbenchChatSession, type WorkbenchChatSession } from "../src/workbench/chat.js";
import { buildWorkbenchRpcPrompt } from "../src/workbench/chat-runtime.js";
import { workbenchDataPath } from "../src/workbench/data-root.js";
import { buildWorkbenchState } from "../src/workbench/scan.js";
import { startWorkbenchServer } from "../src/workbench/server.js";
import {
	mutateWorkbenchTranscriptAnnotation,
	readWorkbenchTranscriptAnnotations,
	removeWorkbenchTranscriptAnnotation,
	upsertWorkbenchTranscriptAnnotation,
} from "../src/workbench/transcript-annotations.js";

function makeWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-transcript-annotations-"));
	mkdirSync(join(root, "outputs"), { recursive: true });
	mkdirSync(join(root, "papers"), { recursive: true });
	mkdirSync(join(root, "notes"), { recursive: true });
	writeFileSync(join(root, "outputs", "kinase-notes.md"), "# Kinase notes\n\nTranscript bookmark fixture.\n");
	return root;
}

function seedSession(root: string): WorkbenchChatSession {
	const session = ensureWorkbenchChatSession({ workingDir: root }, {
		id: "kinase-thread",
		projectId: "workspace",
		title: "Kinase screen",
	});
	const withMessages: WorkbenchChatSession = {
		...session,
		status: "complete",
		updatedAt: "2026-07-03T16:30:00.000Z",
		messages: [
			{
				id: "message-0",
				role: "user",
				content: "Find the strongest evidence for MAPK rescue controls.",
				createdAt: "2026-07-03T16:29:40.000Z",
				status: "complete",
				toolEvents: [],
			},
			{
				id: "message-1",
				role: "assistant",
				content: "The MEK inhibitor rescue experiment is the key follow-up to verify.",
				createdAt: "2026-07-03T16:30:00.000Z",
				status: "complete",
				toolEvents: [],
			},
		],
	};
	mkdirSync(workbenchDataPath(root, "sessions"), { recursive: true });
	writeFileSync(workbenchDataPath(root, "sessions", "kinase-thread.json"), `${JSON.stringify(withMessages, null, 2)}\n`);
	return withMessages;
}

test("workbench transcript annotations persist into state and Pi prompt context", () => {
	const root = makeWorkspace();
	try {
		const session = seedSession(root);
		const annotations = upsertWorkbenchTranscriptAnnotation(root, {
			rootFrameId: "kinase-thread",
			messageUuid: "message-1",
			messageIndex: 1,
			blockIndex: 0,
			source: "assistant",
			anchorText: "MEK inhibitor rescue experiment",
			kind: "bookmark",
			note: "Use this as the verification hinge for the next pass.",
			projectId: "workspace",
			runSlug: "kinase-thread",
		});
		assert.equal(annotations.length, 1);
		assert.equal(annotations[0]?.rootFrameId, "kinase-thread");
		assert.equal(annotations[0]?.messageUuid, "message-1");
		assert.equal(annotations[0]?.source, "assistant");
		assert.match(readFileSync(workbenchDataPath(root, "transcript-annotations.json"), "utf8"), /workbenchTranscriptAnnotations/);

		const state = buildWorkbenchState({ workingDir: root });
		assert.equal(state.transcriptAnnotations.length, 1);
		assert.equal(state.summary.transcriptAnnotationCount, 1);
		assert.match(state.transcriptAnnotations[0]?.note ?? "", /verification hinge/);

		const prompt = buildWorkbenchRpcPrompt({
			workingDir: root,
			message: "continue from the saved bookmark",
			session,
		});
		assert.match(prompt, /Transcript bookmarks and notes:/);
		assert.match(prompt, /MEK inhibitor rescue experiment/);
		assert.match(prompt, /verification hinge/);

		const removed = removeWorkbenchTranscriptAnnotation(root, annotations[0]!.id);
		assert.equal(removed.length, 0);
		assert.equal(readWorkbenchTranscriptAnnotations(root).length, 0);
		assert.throws(
			() => upsertWorkbenchTranscriptAnnotation(root, {
				rootFrameId: "",
				messageIndex: 0,
				anchorText: "No target",
			}),
			/root frame id/,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench server mutates transcript annotations through the authenticated API", async () => {
	const root = makeWorkspace();
	seedSession(root);
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
		const created = await fetch(`${handle.url}api/transcript/annotation`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				rootFrameId: "kinase-thread",
				messageUuid: "message-1",
				messageIndex: 1,
				blockIndex: 0,
				source: "assistant",
				anchorText: "MEK inhibitor rescue experiment",
				kind: "bookmark",
				note: "Queue this for verification.",
				projectId: "workspace",
				runSlug: "kinase-thread",
			}),
		});
		assert.equal(created.status, 200);
		const createdPayload = await created.json() as {
			annotations: Array<{ id: string; anchorText: string }>;
			state: { transcriptAnnotations: Array<{ note: string }>; summary: { transcriptAnnotationCount: number } };
		};
		const id = createdPayload.annotations[0]?.id;
		assert.ok(id, "expected transcript annotation id");
		assert.match(createdPayload.annotations[0]?.anchorText ?? "", /MEK inhibitor/);
		assert.match(createdPayload.state.transcriptAnnotations[0]?.note ?? "", /verification/);
		assert.equal(createdPayload.state.summary.transcriptAnnotationCount, 1);

		const mutated = mutateWorkbenchTranscriptAnnotation(root, {
			id,
			rootFrameId: "kinase-thread",
			messageUuid: "message-1",
			messageIndex: 1,
			source: "assistant",
			anchorText: "MEK inhibitor rescue experiment",
			note: "Updated note",
		});
		assert.equal(mutated[0]?.note, "Updated note");

		const removed = await fetch(`${handle.url}api/transcript/annotation`, {
			method: "POST",
			headers,
			body: JSON.stringify({ action: "remove", id }),
		});
		assert.equal(removed.status, 200);
		const removedPayload = await removed.json() as { state: { transcriptAnnotations: unknown[] } };
		assert.equal(removedPayload.state.transcriptAnnotations.length, 0);
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});
