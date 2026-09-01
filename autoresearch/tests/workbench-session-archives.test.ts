import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { workbenchDataPath } from "../src/workbench/data-root.js";
import { buildWorkbenchState } from "../src/workbench/scan.js";
import { startWorkbenchServer } from "../src/workbench/server.js";
import { workbenchPiSessionId } from "../src/workbench/pi-session.js";

function makeWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-session-archives-"));
	mkdirSync(join(root, "outputs"), { recursive: true });
	mkdirSync(join(root, "papers"), { recursive: true });
	mkdirSync(join(root, "notes"), { recursive: true });
	return root;
}

test("workbench API exposes Claude-style session concurrency rows for chat frames", async () => {
	const root = makeWorkspace();
	const handle = await startWorkbenchServer({
		workingDir: root,
		version: "0.0.0-test",
		host: "127.0.0.1",
		port: 0,
		token: "test-token",
	});
	try {
		const response = await fetch(`${handle.url}api/chat/session/new`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				cookie: "feynman_workbench=test-token",
			},
			body: JSON.stringify({
				projectId: "workspace",
				title: "Archive parity session",
			}),
		});
		assert.equal(response.status, 200);
		const payload = await response.json() as {
			session: { id: string; createdAt: string; updatedAt: string };
			state: {
				sessionConcurrency: Array<{
					rootFrameId: string;
					maxConcurrent: number;
					createdAt: string;
					updatedAt: string;
				}>;
			};
		};

		const row = payload.state.sessionConcurrency.find((item) => item.rootFrameId === payload.session.id);
		assert.ok(row, "expected per-frame concurrency row");
		assert.equal(row?.maxConcurrent, 1);
		assert.equal(row?.createdAt, payload.session.createdAt);
		assert.equal(row?.updatedAt, payload.session.updatedAt);
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});

test("buildWorkbenchState emits Pi-derived compaction and branch archive rows", () => {
	const root = makeWorkspace();
	try {
		const piSessionId = workbenchPiSessionId("scaling-laws");
		const piSessionDir = join(root, ".feynman", "sessions");
		mkdirSync(piSessionDir, { recursive: true });
		const piSessionPath = join(piSessionDir, `2026-06-30T08-30-00-000Z_${piSessionId}.jsonl`);
		writeFileSync(piSessionPath, [
			JSON.stringify({ type: "session", version: 3, id: piSessionId, timestamp: "2026-06-30T08:30:00.000Z", cwd: root }),
			JSON.stringify({ type: "message", id: "00000001", parentId: null, timestamp: "2026-06-30T08:30:01.000Z", message: { role: "user", content: "read outputs/scaling-laws.md", timestamp: 1 } }),
			JSON.stringify({
				type: "message",
				id: "00000002",
				parentId: "00000001",
				timestamp: "2026-06-30T08:30:02.000Z",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "Found the evidence in outputs/scaling-laws.md." }],
					provider: "anthropic",
					model: "claude-test",
					usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
					stopReason: "stop",
					timestamp: 2,
				},
			}),
			JSON.stringify({ type: "message", id: "00000003", parentId: "00000002", timestamp: "2026-06-30T08:30:03.000Z", message: { role: "user", content: "keep this recent turn", timestamp: 3 } }),
			JSON.stringify({ type: "compaction", id: "00000004", parentId: "00000003", timestamp: "2026-06-30T08:30:04.000Z", summary: "Earlier evidence lookup was summarized.", firstKeptEntryId: "00000003", tokensBefore: 12345 }),
			JSON.stringify({ type: "message", id: "00000005", parentId: "00000002", timestamp: "2026-06-30T08:30:05.000Z", message: { role: "user", content: "try alternate branch", timestamp: 5 } }),
			JSON.stringify({ type: "branch_summary", id: "00000006", parentId: "00000005", timestamp: "2026-06-30T08:30:06.000Z", fromId: "00000003", summary: "Alternate branch tested a different extraction path." }),
		].join("\n") + "\n", "utf8");

		const sessionDir = workbenchDataPath(root, "sessions");
		mkdirSync(sessionDir, { recursive: true });
		writeFileSync(join(sessionDir, "scaling-laws.json"), `${JSON.stringify({
			id: "scaling-laws",
			projectId: "workspace",
			title: "Scaling laws",
			createdAt: "2026-06-30T08:30:00.000Z",
			updatedAt: "2026-06-30T08:31:00.000Z",
			status: "complete",
			config: {
				delegation: false,
				autoReview: false,
				memory: false,
				specialist: "None",
				compute: "local",
			},
			attachments: [],
			messages: [],
			piSession: {
				id: piSessionId,
				status: "active",
				path: piSessionPath,
				timeline: [],
				tools: [],
			},
		})}\n`, "utf8");

		const state = buildWorkbenchState({ workingDir: root, version: "0.0.0-test" });
		const concurrency = state.sessionConcurrency.find((row) => row.rootFrameId === "scaling-laws");
		const archive = state.compactionArchives.find((row) => row.frameId === "scaling-laws");
		const branches = state.frameBranchArchives.filter((row) => row.frameId === "scaling-laws");
		const activeBranch = branches.find((row) => row.branchId === "00000006");
		const activePayload = JSON.parse(activeBranch?.payload ?? "{}") as {
			active?: boolean;
			branchPointIds?: string[];
			entries?: Array<{ id: string; type: string; summary?: string }>;
		};

		assert.equal(concurrency?.maxConcurrent, 1);
		assert.ok(archive, "expected compaction archive row");
		assert.equal(archive?.compactionIndex, 0);
		assert.equal(archive?.messageCount, 2);
		assert.equal(archive?.tokenCount, 12345);
		assert.match(archive?.summary ?? "", /summarized/);
		assert.match(archive?.messages ?? "", /read outputs\/scaling-laws\.md/);
		assert.doesNotMatch(archive?.messages ?? "", /keep this recent turn/);
		assert.equal(archive?.firstKeptEntryId, "00000003");
		assert.equal(archive?.sourceEntryId, "00000004");
		assert.equal(branches.length, 2);
		assert.ok(activeBranch, "expected active branch archive row");
		assert.equal(activePayload.active, true);
		assert.deepEqual(activePayload.branchPointIds, ["00000002"]);
		assert.ok(activePayload.entries?.some((entry) => entry.id === "00000006" && entry.type === "branch_summary"));
		assert.match(JSON.stringify(activePayload.entries), /different extraction path/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
