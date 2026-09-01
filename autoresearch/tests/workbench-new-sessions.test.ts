import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { ensureWorkbenchChatSession, updateWorkbenchChatSessionConfig } from "../src/workbench/chat.js";
import { buildWorkbenchRpcPrompt } from "../src/workbench/chat-runtime.js";
import { readWorkbenchOnboardingProfile } from "../src/workbench/onboarding.js";
import { createWorkbenchProject } from "../src/workbench/projects.js";
import { buildWorkbenchState } from "../src/workbench/scan.js";
import { ensureOpenScienceSeedFixtures } from "../src/workbench/seed-fixtures.js";
import { startWorkbenchServer } from "../src/workbench/server.js";
import { readWorkbenchSettings } from "../src/workbench/settings-store.js";

function makeWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-new-session-"));
	mkdirSync(join(root, "outputs"), { recursive: true });
	mkdirSync(join(root, "papers"), { recursive: true });
	mkdirSync(join(root, "notes"), { recursive: true });
	return root;
}

test("buildWorkbenchState exposes persisted blank chat sessions as runs", () => {
	const root = makeWorkspace();
	try {
		const session = ensureWorkbenchChatSession({ workingDir: root }, {
			id: "fresh-hypothesis",
			projectId: "active-plans",
			title: "Fresh hypothesis",
		});
		assert.equal(session.messages.length, 0);

		const state = buildWorkbenchState({ workingDir: root, version: "0.0.0-test" });
		const run = state.runs.find((item) => item.slug === "fresh-hypothesis");
		const activePlans = state.projects.find((project) => project.id === "active-plans");
		const workspace = state.projects.find((project) => project.id === "workspace");

		assert.ok(run, "expected chat session to appear as a workbench run");
		assert.equal(run?.source, "chat");
		assert.equal(run?.status, "chat");
		assert.equal(run?.projectId, "active-plans");
		assert.equal(run?.artifactCount, 0);
		assert.match(run?.taskSummary ?? "", /ready for a question/);
		assert.ok(activePlans?.runSlugs.includes("fresh-hypothesis"), "expected project rail to include the chat session");
		assert.equal(activePlans?.userId, "local-workbench");
		assert.equal(activePlans?.memoryEnabled, false);
		assert.match(activePlans?.uploadsFrameId ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		assert.match(activePlans?.createdAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
		assert.ok((activePlans?.createdAtMs ?? 0) > 0);
		assert.ok(workspace?.runSlugs.includes("fresh-hypothesis"), "expected workspace to include the chat session");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench server creates blank chat sessions through the authenticated API", async () => {
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
				projectId: "verification",
				title: "New verification session",
			}),
		});
		assert.equal(response.status, 200);
		const payload = await response.json() as {
			session: { id: string; projectId: string; title: string; messages: unknown[] };
			state: { runs: Array<{ slug: string; source: string }>; projects: Array<{ id: string; runSlugs: string[] }> };
		};
		assert.match(payload.session.id, /^session-\d{14}-[a-f0-9]{6}$/);
		assert.equal(payload.session.projectId, "verification");
		assert.equal(payload.session.title, "New verification session");
		assert.deepEqual(payload.session.messages, []);
		assert.ok(payload.state.runs.find((run) => run.slug === payload.session.id && run.source === "chat"));
		assert.ok(payload.state.projects.find((project) => project.id === "verification")?.runSlugs.includes(payload.session.id));
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench state exposes Feynman model status for the model menu", async () => {
	const root = makeWorkspace();
	const settingsPath = join(root, "agent-settings.json");
	const authPath = join(root, "auth.json");
	writeFileSync(settingsPath, JSON.stringify({ defaultProvider: "openai", defaultModel: "gpt-5.5" }, null, 2) + "\n", "utf8");
	writeFileSync(authPath, "{}\n", "utf8");
	const handle = await startWorkbenchServer({
		workingDir: root,
		version: "0.0.0-test",
		host: "127.0.0.1",
		port: 0,
		token: "test-token",
		settingsPath,
		authPath,
	});
	try {
		const response = await fetch(`${handle.url}api/state`, {
			headers: { cookie: "feynman_workbench=test-token" },
		});
		assert.equal(response.status, 200);
		const payload = await response.json() as {
			modelStatus?: { current?: string; availableModels: string[]; guidance: string[] };
		};
		assert.equal(payload.modelStatus?.current, "openai/gpt-5.5");
		assert.ok(Array.isArray(payload.modelStatus?.availableModels));
		assert.ok(Array.isArray(payload.modelStatus?.guidance));

		writeFileSync(authPath, JSON.stringify({ openai: { type: "api_key", key: "openai-test-key" } }, null, 2) + "\n", "utf8");
		const refreshedResponse = await fetch(`${handle.url}api/state`, {
			headers: { cookie: "feynman_workbench=test-token" },
		});
		assert.equal(refreshedResponse.status, 200);
		const refreshedPayload = await refreshedResponse.json() as {
			modelStatus?: { availableModels: string[] };
		};
		assert.ok(
			refreshedPayload.modelStatus?.availableModels.some((spec) => spec.startsWith("openai/")),
			"model status must refresh after auth changes without restarting the workbench",
		);
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench server creates Claude-style projects with an initial chat session", async () => {
	const root = makeWorkspace();
	const handle = await startWorkbenchServer({
		workingDir: root,
		version: "0.0.0-test",
		host: "127.0.0.1",
		port: 0,
		token: "test-token",
	});
	try {
		const response = await fetch(`${handle.url}api/project/new`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				cookie: "feynman_workbench=test-token",
			},
			body: JSON.stringify({
				name: "Genome repair screen",
				description: "Shown in the project list only.",
				agentContext: "Always use GRCh38 and prefer peer-reviewed wet-lab evidence.",
			}),
		});
		assert.equal(response.status, 200);
		const payload = await response.json() as {
			project: { id: string; name: string; description: string; agentContext: string; createdAt: string };
			session: { id: string; projectId: string; title: string; messages: unknown[] };
			state: { runs: Array<{ slug: string; source: string; projectId?: string }>; projects: Array<{ id: string; kind: string; agentContext?: string; context?: string; userId: string; uploadsFrameId: string; memoryEnabled: boolean; createdAt: string; createdAtMs: number; runSlugs: string[] }> };
		};
		assert.equal(payload.project.name, "Genome repair screen");
		assert.equal(payload.project.description, "Shown in the project list only.");
		assert.equal(payload.project.agentContext, "Always use GRCh38 and prefer peer-reviewed wet-lab evidence.");
		assert.equal(payload.session.projectId, payload.project.id);
		assert.equal(payload.session.title, "Genome repair screen");
		assert.deepEqual(payload.session.messages, []);
		assert.ok(payload.state.runs.find((run) => run.slug === payload.session.id && run.source === "chat" && run.projectId === payload.project.id));
		const projectRow = payload.state.projects.find((project) => project.id === payload.project.id);
		assert.equal(projectRow?.kind, "custom");
		assert.equal(projectRow?.agentContext, payload.project.agentContext);
		assert.equal(projectRow?.context, payload.project.agentContext);
		assert.equal(projectRow?.userId, "local-workbench");
		assert.equal(projectRow?.memoryEnabled, false);
		assert.match(projectRow?.uploadsFrameId ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		assert.equal(projectRow?.createdAt, payload.project.createdAt);
		assert.equal(projectRow?.createdAtMs, Date.parse(payload.project.createdAt));
		assert.ok(projectRow?.runSlugs.includes(payload.session.id));
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench onboarding creates project, session, profile, and setup settings", async () => {
	const root = makeWorkspace();
	const handle = await startWorkbenchServer({
		workingDir: root,
		version: "0.0.0-test",
		host: "127.0.0.1",
		port: 0,
		token: "test-token",
	});
	try {
		const response = await fetch(`${handle.url}api/onboarding/complete`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				cookie: "feynman_workbench=test-token",
			},
			body: JSON.stringify({
				field: "Biology / medicine",
				goal: "Find and rank evidence",
				workflow: "Code and notebooks",
				dataTools: ["PDFs", "Protein structures"],
				bottlenecks: ["Citation verification", "Tracking provenance"],
				notes: "Prioritize reproducible evidence.",
				permissions: ["files", "memory", "science-databases", "web"],
				selectedTask: {
					title: "Biology evidence map",
					description: "Map the strongest sources and preserve identifiers.",
				},
			}),
		});
		assert.equal(response.status, 200);
		const payload = await response.json() as {
			onboarding: { completed: boolean; projectId?: string; sessionId?: string; suggestedConnectors?: string[]; suggestedSpecialist?: string; computeDefault?: string };
			project: { id: string; agentContext: string };
			session: { id: string; projectId: string; config: { autoReview: boolean; memory: boolean; specialist: string; compute: string } };
			state: {
				onboarding: { completed: boolean };
				projects: Array<{ id: string; agentContext?: string }>;
				runs: Array<{ slug: string; projectId?: string }>;
				useIntentDeclarations: Array<{ intent: string; source: string; createdAtMs: number }>;
			};
		};
		assert.equal(payload.onboarding.completed, true);
		assert.equal(payload.onboarding.suggestedSpecialist, "verifier");
		assert.deepEqual(payload.onboarding.suggestedConnectors, ["Feynman Bio Tools"]);
		assert.equal(payload.onboarding.computeDefault, "off");
		assert.equal(payload.session.projectId, payload.project.id);
		assert.equal(payload.session.config.autoReview, true);
		assert.equal(payload.session.config.memory, true);
		assert.equal(payload.session.config.specialist, "verifier");
		assert.equal(payload.session.config.compute, "off");
		assert.match(payload.project.agentContext, /Onboarding profile for this open science project:/);
		assert.match(payload.project.agentContext, /Biology evidence map/);
		assert.equal(readWorkbenchOnboardingProfile(root).sessionId, payload.session.id);
		const settings = readWorkbenchSettings(root);
		assert.equal(settings.permissionGrants.some((grant) => grant.id === "onboarding-files"), true);
		assert.equal(settings.permissionGrants.some((grant) => grant.id === "onboarding-feynman-bio-tools" && grant.scope === "builtin:feynman_science_database_search"), true);
		assert.equal(settings.permissionGrants.some((grant) => grant.id === "onboarding-web"), true);
		assert.equal(settings.customConnectors.length, 0);
		assert.equal(settings.memoryCategories.some((category) => category.id === "onboarding-research-context"), true);
		assert.equal(payload.state.onboarding.completed, true);
		assert.ok(payload.state.projects.find((project) => project.id === payload.project.id)?.agentContext?.includes("Prioritize reproducible evidence."));
		assert.ok(payload.state.runs.find((run) => run.slug === payload.session.id && run.projectId === payload.project.id));
		const intents = payload.state.useIntentDeclarations.map((row) => row.intent);
		assert.equal(payload.state.useIntentDeclarations.every((row) => row.source === "onboarding" && row.createdAtMs > 0), true);
		assert.ok(intents.includes("field:Biology / medicine"));
		assert.ok(intents.includes("goal:Find and rank evidence"));
		assert.ok(intents.includes("workflow:Code and notebooks"));
		assert.ok(intents.includes("task:Biology evidence map"));
		assert.ok(intents.includes("specialist:verifier"));
		assert.ok(intents.includes("permission:science-databases"));
		assert.ok(intents.includes("connector:Feynman Bio Tools"));
		assert.ok(intents.includes("tool:Protein structures"));
		assert.ok(intents.includes("bottleneck:Citation verification"));
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});

test("buildWorkbenchState groups open-science seed workflows as project runs", () => {
	const root = makeWorkspace();
	try {
		mkdirSync(join(root, "outputs", "open-science-seeds", "example_alpha"), { recursive: true });
		mkdirSync(join(root, "outputs", "open-science-seeds", "example_beta"), { recursive: true });
		writeFileSync(join(root, "outputs", "open-science-seeds", "example_alpha", "report.md"), "# Alpha Seed Report\n\nEvidence.", "utf8");
		writeFileSync(join(root, "outputs", "open-science-seeds", "example_alpha", "results.csv"), "gene,score\nA,1\n", "utf8");
		writeFileSync(join(root, "outputs", "open-science-seeds", "example_beta", "summary.md"), "# Beta Seed Report\n\nEvidence.", "utf8");

		const state = buildWorkbenchState({ workingDir: root, version: "0.0.0-test" });
		const seedProject = state.projects.find((project) => project.id === "seed-workflows");

		assert.equal(seedProject?.kind, "seeds");
		assert.deepEqual(seedProject?.runSlugs.sort(), ["example_alpha", "example_beta"]);
		assert.equal(state.runs.find((run) => run.slug === "example_alpha")?.artifactCount, 2);
		assert.equal(state.runs.find((run) => run.slug === "example_alpha")?.title, "Alpha Seed Report");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("Feynman-owned open-science seed fixtures are packaged with all reference-shaped workflows", () => {
	const fixtureRoot = resolve(process.cwd(), "fixtures", "open-science-seeds");
	const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as { files?: string[] };
	const counts = Object.fromEntries(
		readdirSync(fixtureRoot, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => [
				entry.name,
				readdirSync(join(fixtureRoot, entry.name), { withFileTypes: true }).filter((file) => file.isFile()).length,
			]),
	);

	assert.ok(packageJson.files?.includes("fixtures/"), "expected packaged fixture directory");
	assert.deepEqual(counts, {
		example_crispr_screen: 20,
		example_enzyme_engineering: 28,
		example_extremophile: 19,
		example_immunotherapy: 16,
	});
	assert.equal(Object.values(counts).reduce((sum, count) => sum + count, 0), 83);
	assert.equal(existsSync(join(fixtureRoot, "example_enzyme_engineering", "is621_esmfold.pdb")), true);
	assert.equal(existsSync(join(fixtureRoot, "example_immunotherapy", "summary_report.md")), true);
});

test("open-science seed fixture sync materializes missing files without overwriting workspace edits", () => {
	const appRoot = mkdtempSync(join(tmpdir(), "feynman-seed-fixture-app-"));
	const root = makeWorkspace();
	try {
		mkdirSync(join(appRoot, "fixtures", "open-science-seeds", "example_alpha"), { recursive: true });
		writeFileSync(join(appRoot, "fixtures", "open-science-seeds", "example_alpha", "report.md"), "# Source Seed Report\n\nEvidence.", "utf8");
		writeFileSync(join(appRoot, "fixtures", "open-science-seeds", "example_alpha", "results.csv"), "gene,score\nA,1\n", "utf8");
		mkdirSync(join(root, "outputs", "open-science-seeds", "example_alpha"), { recursive: true });
		writeFileSync(join(root, "outputs", "open-science-seeds", "example_alpha", "report.md"), "# Edited Seed Report\n\nKeep me.", "utf8");

		const result = ensureOpenScienceSeedFixtures({ appRoot, workingDir: root });
		const state = buildWorkbenchState({ workingDir: root, version: "0.0.0-test" });
		const seedProject = state.projects.find((project) => project.id === "seed-workflows");

		assert.equal(result.sourceAvailable, true);
		assert.equal(result.fileCount, 2);
		assert.equal(result.copiedFiles, 1);
		assert.equal(result.skippedFiles, 1);
		assert.equal(
			readFileSync(join(root, "outputs", "open-science-seeds", "example_alpha", "report.md"), "utf8"),
			"# Edited Seed Report\n\nKeep me.",
		);
		assert.equal(
			readFileSync(join(root, "outputs", "open-science-seeds", "example_alpha", "results.csv"), "utf8"),
			"gene,score\nA,1\n",
		);
		assert.ok(seedProject?.runSlugs.includes("example_alpha"), "expected materialized fixture to appear as seed run");
		assert.equal(state.runs.find((run) => run.slug === "example_alpha")?.artifactCount, 2);
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(appRoot, { recursive: true, force: true });
	}
});

test("workbench chat prompt injects project agent context but not project-list description", () => {
	const root = makeWorkspace();
	try {
		const project = createWorkbenchProject(root, {
			name: "Membrane protein project",
			description: "Visible project list metadata.",
			agentContext: "Treat cryo-EM resolution as a hard evidence ranking factor.",
		});
		const session = ensureWorkbenchChatSession({ workingDir: root }, {
			id: "membrane-session",
			projectId: project.id,
			title: "Membrane protein project",
		});

		const prompt = buildWorkbenchRpcPrompt({
			workingDir: root,
			message: "rank the evidence",
			session,
		});

		assert.match(prompt, /Project context:/);
		assert.match(prompt, /Membrane protein project/);
		assert.match(prompt, /Treat cryo-EM resolution as a hard evidence ranking factor\./);
		assert.doesNotMatch(prompt, /Visible project list metadata/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench chat session config persists an explicit Pi model override", () => {
	const root = makeWorkspace();
	try {
		const configured = updateWorkbenchChatSessionConfig({ workingDir: root }, {
			id: "model-session",
			projectId: "workspace",
			title: "Model session",
			config: { model: "openai/gpt-5.5" },
		});

		assert.equal(configured.config.model, "openai/gpt-5.5");
		const reloaded = ensureWorkbenchChatSession({ workingDir: root }, {
			id: "model-session",
			projectId: "workspace",
			title: "Model session",
		});
		assert.equal(reloaded.config.model, "openai/gpt-5.5");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
