import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	addWorkbenchChatAttachment,
	ensureWorkbenchChatSession,
	submitWorkbenchChatMessage,
	updateWorkbenchChatSessionConfig,
} from "../src/workbench/chat.js";
import { workbenchDataPath } from "../src/workbench/data-root.js";
import { buildWorkbenchState } from "../src/workbench/scan.js";
import { startWorkbenchServer } from "../src/workbench/server.js";

function makeFrameWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-frames-"));
	mkdirSync(join(root, "outputs", "kinase-screen"), { recursive: true });
	mkdirSync(join(root, "papers"), { recursive: true });
	mkdirSync(join(root, "notes"), { recursive: true });
	writeFileSync(join(root, "outputs", "kinase-screen", "report.md"), "# Kinase Screen\n\nFinding: CDK genes are enriched.\n");
	writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n");
	return root;
}

test("workbench state exposes Claude-style frame records from Feynman sessions, runs, and uploads", async () => {
	const root = makeFrameWorkspace();
	try {
		ensureWorkbenchChatSession({ workingDir: root }, {
			id: "kinase-session",
			projectId: "active-plans",
			title: "Kinase session",
		});
		updateWorkbenchChatSessionConfig({ workingDir: root }, {
			id: "kinase-session",
			projectId: "active-plans",
			title: "Kinase session",
			config: {
				compute: "off",
				model: "openai/test-model",
				specialist: "Researcher",
			},
		});
		addWorkbenchChatAttachment({ workingDir: root }, {
			id: "kinase-session",
			projectId: "active-plans",
			title: "Kinase session",
			name: "guides.csv",
			contentType: "text/csv",
			data: Buffer.from("gene,guide\nCDK1,AAAA\n"),
		});
		await submitWorkbenchChatMessage({
			workingDir: root,
			executor: async (request) => ({
				content: `assistant saw ${request.message}`,
				toolEvents: [{
					id: "tool-1",
					label: "search papers",
					status: "complete",
					toolName: "feynman_science_database_search",
					output: "one result",
				}],
			}),
		}, {
			id: "kinase-session",
			projectId: "active-plans",
			title: "Kinase session",
			message: "find kinase screen evidence",
		});
		writeFileSync(workbenchDataPath(root, "frame-backfill-poison.json"), JSON.stringify({
			schema: "feynman.frameBackfillPoison.v1",
			frameBackfillPoison: [
				{ frame_id: "kinase-session", fail_count: 2, terminal: 0, reason: "legacy backfill failed", updated_at: 1780000000000 },
				{ frameId: "missing-frame", failCount: 1, terminal: true, updatedAt: "2026-07-03T00:00:00.000Z" },
			],
		}, null, 2));

		const state = buildWorkbenchState({ workingDir: root, version: "0.0.0-test" });
		const chatFrame = state.frames.find((frame) => frame.id === "kinase-session");
		assert.ok(chatFrame, "expected chat session to produce a frame row");
		assert.equal(chatFrame?.conversationType, "agent");
		assert.equal(chatFrame?.source, "chat-session");
		assert.equal(chatFrame?.rootFrameId, "kinase-session");
		assert.equal(chatFrame?.agentName, "RESEARCHER");
		assert.equal(chatFrame?.delegateName, "researcher");
		assert.equal(chatFrame?.status, "completed");
		assert.equal(chatFrame?.projectId, "active-plans");
		assert.equal(chatFrame?.name, "Kinase session");
		assert.equal(chatFrame?.model, "openai/test-model");
		assert.equal(chatFrame?.computeEnabled, "off");
		assert.equal(chatFrame?.isHidden, false);
		assert.equal(chatFrame?.lastExtractMsgIdx, 1);
		assert.match(chatFrame?.lastUserMessageAt ?? "", /^\d{4}-\d{2}-\d{2}T/);

		const inputData = JSON.parse(chatFrame?.inputData ?? "{}") as { text?: string };
		assert.equal(inputData.text, "find kinase screen evidence");
		const outputData = JSON.parse(chatFrame?.outputData ?? "{}") as { text?: string; tool_event_count?: number };
		assert.equal(outputData.text, "assistant saw find kinase screen evidence");
		assert.equal(outputData.tool_event_count, 1);
		const contextData = JSON.parse(chatFrame?.contextData ?? "{}") as {
			source?: string;
			session_id?: string;
			message_count?: number;
			pi_session?: { id?: string };
			config?: { specialist?: string; compute?: string; model?: string };
		};
		assert.equal(contextData.source, "chat-session");
		assert.equal(contextData.session_id, "kinase-session");
		assert.equal(contextData.message_count, 2);
		assert.equal(contextData.config?.specialist, "Researcher");
		assert.equal(contextData.config?.compute, "off");
		assert.equal(contextData.config?.model, "openai/test-model");
		assert.match(contextData.pi_session?.id ?? "", /^feynman-workbench-kinase-session$/);
		assert.match(chatFrame?.mentionedArtifactIds ?? "", /guides\.csv/);
		assert.deepEqual(JSON.parse(chatFrame?.specialistsUsed ?? "[]"), ["Researcher"]);

		const runFrame = state.frames.find((frame) => frame.id === "kinase-screen");
		assert.equal(runFrame?.conversationType, "agent");
		assert.equal(runFrame?.source, "artifact-run");
		assert.equal(runFrame?.agentName, "FEYNMAN");
		assert.equal(runFrame?.status, "completed");
		assert.equal(runFrame?.name, "Kinase Screen");
		assert.equal(runFrame?.artifactId, "outputs/kinase-screen/report.md");
		assert.match(runFrame?.mentionedArtifactIds ?? "", /outputs\/kinase-screen\/report\.md/);

		const uploadFrame = state.frames.find((frame) =>
			frame.projectId === "active-plans" &&
			frame.conversationType === "uploads"
		);
		assert.equal(state.projects.find((project) => project.id === "active-plans")?.uploadsFrameId, uploadFrame?.id);
		assert.match(uploadFrame?.id ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		assert.equal(uploadFrame?.rootFrameId, uploadFrame?.id);
		assert.equal(uploadFrame?.agentName, "UPLOADS");
		assert.equal(uploadFrame?.status, "completed");
		assert.equal(uploadFrame?.name, "User Uploads");

		const firstMessage = state.frameMessages.find((message) => message.frameId === chatFrame?.id && message.idx === 0);
		assert.equal(firstMessage?.role, "user");
		const poison = state.frameBackfillPoison.find((row) => row.frameId === "kinase-session");
		assert.deepEqual(state.frameBackfillPoison.map((row) => row.frameId), ["kinase-session"]);
		assert.equal(poison?.failCount, 2);
		assert.equal(poison?.terminal, false);
		assert.equal(poison?.reason, "legacy backfill failed");
		assert.equal(poison?.updatedAtMs, 1780000000000);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench chat API returns frame records through authenticated state", async () => {
	const root = makeFrameWorkspace();
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
				projectId: "verification",
				title: "Frame ledger",
				message: "audit this frame",
			}),
		});
		assert.equal(response.status, 200);

		const stateResponse = await fetch(`${handle.url}api/state`, {
			headers: { cookie: "feynman_workbench=test-token" },
		});
		assert.equal(stateResponse.status, 200);
		const payload = await stateResponse.json() as {
			frames: Array<{ id: string; conversationType: string; status: string; inputData?: string; rootFrameId: string }>;
			frameBackfillPoison: Array<{ frameId: string }>;
		};
		const frame = payload.frames.find((item) => item.id === "frame-ledger");
		assert.equal(frame?.conversationType, "agent");
		assert.equal(frame?.status, "completed");
		assert.equal(frame?.rootFrameId, "frame-ledger");
		assert.match(frame?.inputData ?? "", /audit this frame/);
		assert.ok(payload.frames.some((item) => item.conversationType === "uploads"));
		assert.deepEqual(payload.frameBackfillPoison, []);
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});
