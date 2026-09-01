import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildWorkbenchState } from "../src/workbench/scan.js";
import { startWorkbenchServer } from "../src/workbench/server.js";

function makeWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-skill-ledgers-"));
	mkdirSync(join(root, "outputs"), { recursive: true });
	mkdirSync(join(root, "papers"), { recursive: true });
	mkdirSync(join(root, "notes"), { recursive: true });
	mkdirSync(join(root, "skills", "literature-review"), { recursive: true });
	mkdirSync(join(root, ".feynman", "agents"), { recursive: true });
	writeFileSync(join(root, "outputs", "skill-ledgers.md"), "# Skill ledgers\n");
	writeFileSync(join(root, "package.json"), JSON.stringify({ name: "skill-ledger-fixture", license: "MIT" }, null, 2));
	writeFileSync(join(root, "skills", "literature-review", "SKILL.md"), [
		"---",
		"name: literature-review",
		"description: Build auditable literature-review briefs from source evidence.",
		"---",
		"",
		"# Literature Review",
		"",
		"Search, read, rank, and cite sources before synthesis.",
		"",
	].join("\n"));
	writeFileSync(join(root, ".feynman", "agents", "reviewer.md"), [
		"---",
		"name: reviewer",
		"description: Adversarial evidence reviewer.",
		"---",
		"",
		"# Reviewer",
		"",
		"Check claims against citations and reproduction evidence.",
		"",
	].join("\n"));
	return root;
}

test("buildWorkbenchState exposes Claude-style custom skill and agent prompt rows", () => {
	const root = makeWorkspace();
	try {
		const state = buildWorkbenchState({ workingDir: root, version: "0.0.0-test" });
		assert.equal(state.customSkills.length, 1);
		assert.equal(state.agentSkillAssignments.length, 1);
		assert.equal(state.customAgentPrompts.length, 1);

		const skill = state.customSkills[0];
		assert.match(skill?.id ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		assert.equal(skill?.userId, "local-workbench");
		assert.equal(skill?.name, "literature-review");
		assert.equal(skill?.description, "Build auditable literature-review briefs from source evidence.");
		assert.equal(skill?.path, "skills/literature-review/SKILL.md");
		assert.equal(skill?.source, "project");
		assert.match(skill?.content ?? "", /# Literature Review/);
		assert.ok((skill?.createdAtMs ?? 0) > 0);
		assert.ok((skill?.updatedAtMs ?? 0) > 0);

		const assignment = state.agentSkillAssignments[0];
		assert.match(assignment?.id ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		assert.equal(assignment?.skillId, skill?.id);
		assert.equal(assignment?.agentName, "feynman");
		assert.equal(assignment?.userId, "local-workbench");
		assert.equal(assignment?.createdAt, skill?.createdAt);
		assert.equal(assignment?.createdAtMs, skill?.createdAtMs);

		const prompt = state.customAgentPrompts[0];
		assert.match(prompt?.id ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		assert.equal(prompt?.userId, "local-workbench");
		assert.equal(prompt?.agentName, "reviewer");
		assert.equal(prompt?.path, ".feynman/agents/reviewer.md");
		assert.match(prompt?.promptText ?? "", /Check claims against citations/);
		assert.ok((prompt?.createdAtMs ?? 0) > 0);
		assert.ok((prompt?.updatedAtMs ?? 0) > 0);

		assert.equal(state.marketplaceSources.length, 1);
		const source = state.marketplaceSources[0];
		assert.match(source?.id ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		assert.equal(source?.userId, "local-workbench");
		assert.equal(source?.slug, "feynman-science-skill-pack");
		assert.equal(source?.kind, "local");
		assert.equal(source?.marketplaceName, "Feynman Science Skill Pack");
		assert.match(source?.pinnedSha ?? "", /^[0-9a-f]{40}$/);
		assert.equal(source?.license, "MIT");
		assert.deepEqual(source?.offeredSkills, ["literature-review"]);
		assert.equal(source?.offeredSkillsJson, JSON.stringify(["literature-review"]));
		assert.ok((source?.createdAtMs ?? 0) > 0);
		assert.ok((source?.lastImportedAtMs ?? 0) > 0);

		assert.equal(state.skillLicenseAssents.length, 1);
		const assent = state.skillLicenseAssents[0];
		assert.match(assent?.id ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		assert.equal(assent?.userId, "local-workbench");
		assert.equal(assent?.orgId, "local-workspace");
		assert.equal(assent?.resourceKey, "skill:skills/literature-review/SKILL.md");
		assert.equal(assent?.skillName, "literature-review");
		assert.equal(assent?.decision, "accepted");
		assert.equal(assent?.noticeVersion, "feynman-owned-skill-pack-v1");
		assert.match(assent?.noticeText ?? "", /Feynman-owned local project skill/);
		assert.match(assent?.noticeText ?? "", /License: MIT/);
		assert.equal(assent?.projectId, "workspace");
		assert.equal(assent?.source, "project-skill-pack");
		assert.equal(assent?.createdAt, skill?.createdAt);
		assert.equal(assent?.createdAtMs, skill?.createdAtMs);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench server returns skill ledgers through state", async () => {
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
			customSkills: Array<{ id: string; name: string; content: string }>;
			agentSkillAssignments: Array<{ skillId: string; agentName: string }>;
			customAgentPrompts: Array<{ agentName: string; promptText: string }>;
			marketplaceSources: Array<{ slug: string; offeredSkills: string[]; pinnedSha: string }>;
			skillLicenseAssents: Array<{ skillName: string; resourceKey: string; decision: string; noticeText: string }>;
		};
		assert.equal(payload.customSkills[0]?.name, "literature-review");
		assert.match(payload.customSkills[0]?.content ?? "", /Search, read, rank/);
		assert.deepEqual(payload.agentSkillAssignments.map((assignment) => [
			assignment.skillId,
			assignment.agentName,
		]), [[payload.customSkills[0]?.id, "feynman"]]);
		assert.equal(payload.customAgentPrompts[0]?.agentName, "reviewer");
		assert.match(payload.customAgentPrompts[0]?.promptText ?? "", /Adversarial evidence reviewer/);
		assert.equal(payload.marketplaceSources[0]?.slug, "feynman-science-skill-pack");
		assert.deepEqual(payload.marketplaceSources[0]?.offeredSkills, ["literature-review"]);
		assert.match(payload.marketplaceSources[0]?.pinnedSha ?? "", /^[0-9a-f]{40}$/);
		assert.equal(payload.skillLicenseAssents[0]?.skillName, "literature-review");
		assert.equal(payload.skillLicenseAssents[0]?.resourceKey, "skill:skills/literature-review/SKILL.md");
		assert.equal(payload.skillLicenseAssents[0]?.decision, "accepted");
		assert.match(payload.skillLicenseAssents[0]?.noticeText ?? "", /License: MIT/);
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});
