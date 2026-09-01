import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { submitWorkbenchChatMessage } from "../src/workbench/chat.js";
import { buildWorkbenchState } from "../src/workbench/scan.js";
import { startWorkbenchServer } from "../src/workbench/server.js";

function makeFrameMessageWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-frame-messages-"));
	mkdirSync(join(root, "outputs"), { recursive: true });
	mkdirSync(join(root, "papers"), { recursive: true });
	mkdirSync(join(root, "notes"), { recursive: true });
	writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n");
	return root;
}

test("workbench state exposes Claude-style frame message rows from Feynman chat sessions", async () => {
	const root = makeFrameMessageWorkspace();
	try {
		await submitWorkbenchChatMessage({
			workingDir: root,
			executor: async (request) => ({
				content: `assistant saw ${request.message}`,
				toolEvents: [{
					id: "tool-1",
					label: "search papers",
					status: "complete",
					toolName: "feynman_science_database_search",
					input: "BRCA1",
					output: "one result",
				}],
			}),
		}, {
			id: "kinase-session",
			projectId: "workspace",
			title: "Kinase session",
			message: "find kinase papers",
		});

		const state = buildWorkbenchState({ workingDir: root, version: "0.0.0-test" });
		assert.equal(state.frameMessages.length, 2);
		assert.deepEqual(state.frameMessages.map((row) => row.idx), [0, 1]);

		const first = state.frameMessages[0]!;
		assert.equal(first.frameId, "kinase-session");
		assert.equal(first.role, "user");
		assert.equal(first.status, "complete");
		assert.equal(first.source, "chat-session");
		assert.match(first.messageUuid, /^[0-9a-f-]{36}$/);

		const firstJson = JSON.parse(first.msgJson) as { _uuid: string; role: string; content: Array<{ type: string; text: string }>; feynman: { message_index: number; message_count: number } };
		assert.equal(firstJson._uuid, first.messageUuid);
		assert.equal(firstJson.role, "user");
		assert.equal(firstJson.content[0]?.type, "text");
		assert.equal(firstJson.content[0]?.text, "find kinase papers");
		assert.equal(firstJson.feynman.message_index, 0);
		assert.equal(firstJson.feynman.message_count, 2);

		const assistantJson = JSON.parse(state.frameMessages[1]!.msgJson) as { role: string; feynman: { tool_events: Array<{ tool_name: string; output: string }> } };
		assert.equal(assistantJson.role, "assistant");
		assert.equal(assistantJson.feynman.tool_events[0]?.tool_name, "feynman_science_database_search");
		assert.equal(assistantJson.feynman.tool_events[0]?.output, "one result");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench chat API returns frame message rows through authenticated state", async () => {
	const root = makeFrameMessageWorkspace();
	const handle = await startWorkbenchServer({
		workingDir: root,
		version: "0.0.0-test",
		host: "127.0.0.1",
		port: 0,
		token: "test-token",
		promptExecutor: async (request) => ({ content: `Workbench reply: ${request.message}` }),
	});
	try {
		const response = await fetch(`${handle.url}api/chat/message`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				cookie: "feynman_workbench=test-token",
			},
			body: JSON.stringify({
				sessionId: "frame-ledger",
				projectId: "workspace",
				title: "Frame ledger",
				message: "audit this transcript",
			}),
		});
		assert.equal(response.status, 200);

		const stateResponse = await fetch(`${handle.url}api/state`, {
			headers: { cookie: "feynman_workbench=test-token" },
		});
		assert.equal(stateResponse.status, 200);
		const payload = await stateResponse.json() as {
			frameMessages: Array<{ frameId: string; idx: number; msgJson: string; role: string }>;
		};
		assert.equal(payload.frameMessages.length, 2);
		assert.equal(payload.frameMessages[0]?.frameId, "frame-ledger");
		assert.equal(payload.frameMessages[0]?.idx, 0);
		assert.equal(payload.frameMessages[0]?.role, "user");
		assert.match(payload.frameMessages[0]?.msgJson ?? "", /audit this transcript/);
		assert.equal(JSON.parse(payload.frameMessages[1]!.msgJson).role, "assistant");
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});
