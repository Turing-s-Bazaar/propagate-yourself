import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildWorkbenchState } from "../src/workbench/scan.js";
import { startWorkbenchServer } from "../src/workbench/server.js";

const UUID_V5_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function makeWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-agent-ledgers-"));
	mkdirSync(join(root, "outputs"), { recursive: true });
	mkdirSync(join(root, "papers"), { recursive: true });
	mkdirSync(join(root, "notes"), { recursive: true });
	mkdirSync(join(root, ".feynman", "agents"), { recursive: true });
	writeFileSync(join(root, ".feynman", "agents", "researcher.md"), [
		"---",
		"name: researcher",
		"description: Gather primary evidence.",
		"thinking: high",
		"tools: read, bash, web_search",
		"output: research.md",
		"defaultProgress: true",
		"---",
		"",
		"# Researcher",
		"",
	].join("\n"));
	writeFileSync(join(root, ".feynman", "agents", "reviewer.md"), [
		"---",
		"name: reviewer",
		"description: Audit research claims.",
		"thinking: medium",
		"output: review.md",
		"---",
		"",
		"# Reviewer",
		"",
	].join("\n"));
	return root;
}

test("buildWorkbenchState exposes Claude-style agent and bundled-agent setting rows", () => {
	const root = makeWorkspace();
	try {
		const state = buildWorkbenchState({ workingDir: root, version: "0.0.0-test" });
		assert.deepEqual(state.agents.map((agent) => agent.name), ["researcher", "reviewer"]);
		const researcher = state.agents[0];
		assert.match(researcher?.id ?? "", UUID_V5_RE);
		assert.equal(researcher?.url, "feynman://agents/researcher");
		assert.equal(researcher?.description, "Gather primary evidence.");
		const parameters = JSON.parse(researcher?.parameters ?? "{}") as {
			source: string;
			path: string;
			tools: string[];
			thinking: string;
			output: string;
			defaultProgress: boolean;
		};
		assert.equal(parameters.source, "feynman-bundled-agent");
		assert.equal(parameters.path, ".feynman/agents/researcher.md");
		assert.deepEqual(parameters.tools, ["read", "bash", "web_search"]);
		assert.equal(parameters.thinking, "high");
		assert.equal(parameters.output, "research.md");
		assert.equal(parameters.defaultProgress, true);
		assert.ok((researcher?.createdAtMs ?? 0) > 0);
		assert.ok((researcher?.updatedAtMs ?? 0) > 0);

		assert.deepEqual(state.bundledAgentSettings.map((setting) => [
			setting.userId,
			setting.agentName,
			setting.enabled,
		]), [
			["local-workbench", "researcher", true],
			["local-workbench", "reviewer", true],
		]);
		assert.match(state.bundledAgentSettings[0]?.id ?? "", UUID_V5_RE);
		assert.equal(state.bundledAgentSettings[0]?.createdAt, researcher?.createdAt);
		assert.equal(state.bundledAgentSettings[0]?.updatedAt, researcher?.updatedAt);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench server returns agent ledgers through state", async () => {
	const root = makeWorkspace();
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
			agents: Array<{ name: string; url: string; parameters: string }>;
			bundledAgentSettings: Array<{ userId: string; agentName: string; enabled: boolean }>;
		};
		assert.equal(payload.agents[0]?.name, "researcher");
		assert.equal(payload.agents[0]?.url, "feynman://agents/researcher");
		assert.match(payload.agents[0]?.parameters ?? "", /feynman-bundled-agent/);
		assert.deepEqual(payload.bundledAgentSettings.map((setting) => setting.agentName), ["researcher", "reviewer"]);
		assert.equal(payload.bundledAgentSettings.every((setting) => setting.userId === "local-workbench" && setting.enabled), true);
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});
