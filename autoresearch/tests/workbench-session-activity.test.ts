import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ensureWorkbenchChatSession, type WorkbenchChatSession } from "../src/workbench/chat.js";
import { workbenchDataPath } from "../src/workbench/data-root.js";
import { buildWorkbenchState } from "../src/workbench/scan.js";
import { buildWorkbenchSessionActivity } from "../src/workbench/session-activity.js";
import { upsertWorkbenchFrameReadCursor } from "../src/workbench/read-cursors.js";

function makeWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-session-activity-"));
	mkdirSync(join(root, "outputs"), { recursive: true });
	mkdirSync(join(root, "papers"), { recursive: true });
	mkdirSync(join(root, "notes"), { recursive: true });
	writeFileSync(join(root, "outputs", "alpha.md"), "# Alpha\n\nClaim: session queue activity should be visible.\n");
	return root;
}

test("workbench session activity mirrors queued messages, notifications, events, and seen marks", () => {
	const root = makeWorkspace();
	try {
		const session = ensureWorkbenchChatSession({ workingDir: root }, {
			id: "alpha",
			projectId: "workspace",
			title: "Alpha research",
		});
		const sessionWithMessages: WorkbenchChatSession = {
			...session,
			status: "running",
			updatedAt: "2026-07-03T13:12:20.000Z",
			messages: [
				{
					id: "message-0",
					role: "assistant",
					content: "Initial result is ready.",
					createdAt: "2026-07-03T13:12:00.000Z",
					status: "complete",
					toolEvents: [],
				},
				{
					id: "message-1",
					role: "user",
					content: "Please also verify the kinase controls.",
					createdAt: "2026-07-03T13:12:10.000Z",
					status: "queued",
					toolEvents: [{
						id: "queue-tool",
						label: "Queued to active Pi turn",
						status: "running",
						output: "This message will steer the running Feynman turn.",
					}],
				},
			],
		};
		mkdirSync(workbenchDataPath(root, "sessions"), { recursive: true });
		const sessionPath = workbenchDataPath(root, "sessions", "alpha.json");
		writeFileSync(sessionPath, `${JSON.stringify(sessionWithMessages, null, 2)}\n`);

		const cursor = upsertWorkbenchFrameReadCursor(root, {
			rootFrameId: "alpha",
			messageId: "message-0",
			messageIndex: 0,
			messageCount: 1,
			projectId: "workspace",
			runSlug: "alpha",
		});
		const state = buildWorkbenchState({ workingDir: root });

		assert.equal(state.queuedUserMessages.length, 1);
		assert.equal(state.queuedUserMessages[0]?.state, "queued");
		assert.equal(state.queuedUserMessages[0]?.messageIndex, 1);
		assert.equal(state.sessionSeenMarks[0]?.seenToken, "message-0:1");
		assert.equal(state.sessionSeenMarks[0]?.rootFrameId, "alpha");
		assert.ok(state.events.some((event) => event.eventType === "user_message"));
		assert.ok(state.events.some((event) => event.eventType === "tool_event"));
		assert.ok(state.notifications.some((notification) => notification.notificationType === "queued_user_message"));

		const queuedActivity = state.sessionActivity.find((activity) => activity.kind === "queued_user_message");
		assert.equal(queuedActivity?.status, "queued");
		assert.equal(queuedActivity?.unread, true);
		assert.equal(queuedActivity?.seenToken, cursor.messageId ? `${cursor.messageId}:${cursor.messageCount}` : undefined);
		assert.equal(state.summary.queuedMessageCount, 1);
		assert.equal(state.summary.notificationCount, state.notifications.length);
		assert.equal(state.summary.activityCount, state.sessionActivity.length);
		assert.ok(state.summary.unreadActivityCount >= 1);

		const direct = buildWorkbenchSessionActivity({
			sessions: [sessionWithMessages],
			plans: [],
			computeJobs: [],
			frameReadCursors: state.frameReadCursors,
		});
		assert.equal(direct.queuedUserMessages.length, 1);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
