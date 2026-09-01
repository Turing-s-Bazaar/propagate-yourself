import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildWorkbenchState } from "../src/workbench/scan.js";
import { startWorkbenchServer } from "../src/workbench/server.js";

function makeWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-user-agents-"));
	mkdirSync(join(root, "outputs"), { recursive: true });
	mkdirSync(join(root, "papers"), { recursive: true });
	mkdirSync(join(root, "notes"), { recursive: true });
	mkdirSync(join(root, ".feynman"), { recursive: true });
	mkdirSync(join(root, "skills", "alpha-research"), { recursive: true });
	mkdirSync(join(root, "skills", "pdf-explore"), { recursive: true });
	writeFileSync(join(root, ".feynman", "SYSTEM.md"), [
		"You are Feynman, a research-first AI agent.",
		"",
		"Use primary sources and write durable artifacts.",
		"",
	].join("\n"));
	writeFileSync(join(root, "skills", "alpha-research", "SKILL.md"), [
		"---",
		"name: alpha-research",
		"description: Search and read papers.",
		"---",
		"",
		"# Alpha Research",
		"",
	].join("\n"));
	writeFileSync(join(root, "skills", "pdf-explore", "SKILL.md"), [
		"---",
		"name: pdf-explore",
		"description: Inspect PDF evidence.",
		"---",
		"",
		"# PDF Explore",
		"",
	].join("\n"));
	return root;
}

test("buildWorkbenchState exposes Claude-style Feynman user agent rows", () => {
	const root = makeWorkspace();
	try {
		const state = buildWorkbenchState({ workingDir: root, version: "0.0.0-test" });
		assert.equal(state.userAgents.length, 1);
		const agent = state.userAgents[0];
		assert.match(agent?.id ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		assert.equal(agent?.userId, "local-workbench");
		assert.equal(agent?.name, "FEYNMAN");
		assert.equal(agent?.displayName, "Feynman");
		assert.equal(agent?.description, "Default Feynman research agent profile");
		assert.match(agent?.systemPrompt ?? "", /research-first AI agent/);
		assert.equal(agent?.iconKey, "lightning");
		assert.equal(agent?.colorKey, "feynman-green");
		assert.deepEqual(agent?.tags, ["research", "open-science"]);
		assert.deepEqual(agent?.skillNames, ["alpha-research", "pdf-explore"]);
		assert.equal(agent?.enabled, true);
		assert.deepEqual(agent?.skillTombstones, []);
		assert.deepEqual(agent?.connectorTombstones, []);
		assert.equal(agent?.unrestricted, false);
		assert.ok((agent?.createdAtMs ?? 0) > 0);
		assert.ok((agent?.updatedAtMs ?? 0) > 0);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench server returns Feynman user agents through state", async () => {
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
			userAgents: Array<{ name: string; displayName: string; skillNames: string[]; systemPrompt: string }>;
		};
		assert.equal(payload.userAgents[0]?.name, "FEYNMAN");
		assert.equal(payload.userAgents[0]?.displayName, "Feynman");
		assert.deepEqual(payload.userAgents[0]?.skillNames, ["alpha-research", "pdf-explore"]);
		assert.match(payload.userAgents[0]?.systemPrompt ?? "", /Use primary sources/);
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});
