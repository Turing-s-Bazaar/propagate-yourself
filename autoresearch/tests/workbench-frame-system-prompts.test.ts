import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ensureWorkbenchChatSession, type WorkbenchChatSession } from "../src/workbench/chat.js";
import { workbenchDataPath } from "../src/workbench/data-root.js";
import { buildWorkbenchState } from "../src/workbench/scan.js";
import { startWorkbenchServer } from "../src/workbench/server.js";

function makeWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-frame-system-prompts-"));
	mkdirSync(join(root, "outputs"), { recursive: true });
	mkdirSync(join(root, "papers"), { recursive: true });
	mkdirSync(join(root, "notes"), { recursive: true });
	mkdirSync(workbenchDataPath(root, "sessions"), { recursive: true });
	writeFileSync(join(root, "outputs", "prompt-audit.md"), "# Prompt audit\n\nClaim: frame prompt snapshots are visible.\n");
	return root;
}

function seedSession(root: string): WorkbenchChatSession {
	const session = ensureWorkbenchChatSession({ workingDir: root }, {
		id: "prompt-audit",
		projectId: "workspace",
		title: "Prompt audit",
	});
	const withConfig: WorkbenchChatSession = {
		...session,
		updatedAt: "2026-07-03T18:40:00.000Z",
		config: {
			delegation: true,
			autoReview: true,
			memory: true,
			specialist: "reviewer",
			compute: "local",
			model: "openai/gpt-5.5",
		},
	};
	writeFileSync(workbenchDataPath(root, "sessions", "prompt-audit.json"), `${JSON.stringify(withConfig, null, 2)}\n`);
	return withConfig;
}

test("buildWorkbenchState exposes Claude-style frame system prompt snapshots", () => {
	const root = makeWorkspace();
	try {
		seedSession(root);
		const state = buildWorkbenchState({ workingDir: root });
		assert.equal(state.frameSystemPrompts.length, 1);
		const prompt = state.frameSystemPrompts[0]!;
		assert.equal(prompt.frameId, "prompt-audit");
		assert.equal(prompt.hash.length, 64);
		assert.match(prompt.payload.stable, /standalone open-science research workbench/);
		assert.match(prompt.payload.stable, /must not require or shell into ~\/\.claude-science/);
		assert.match(prompt.payload.dynamic, /Project: Feynman Workspace/);
		assert.match(prompt.payload.dynamic, /Frame: prompt-audit/);
		assert.match(prompt.payload.dynamic, /delegation=on/);
		assert.match(prompt.payload.dynamic, /specialist=reviewer/);
		assert.match(prompt.payload.dynamic, /model=openai\/gpt-5\.5/);
		assert.match(prompt.payload.dynamic, /Resource groups:/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench server returns frame system prompt snapshots through state", async () => {
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
		const response = await fetch(`${handle.url}api/state`, {
			headers: { cookie: "feynman_workbench=test-token" },
		});
		assert.equal(response.status, 200);
		const payload = await response.json() as {
			frameSystemPrompts: Array<{ frameId: string; hash: string; payload: { stable: string; dynamic: string } }>;
		};
		assert.equal(payload.frameSystemPrompts[0]?.frameId, "prompt-audit");
		assert.equal(payload.frameSystemPrompts[0]?.hash.length, 64);
		assert.match(payload.frameSystemPrompts[0]?.payload.dynamic ?? "", /Config:/);
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});
