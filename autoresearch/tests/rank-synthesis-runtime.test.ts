import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
	createAgentSession,
	DefaultResourceLoader,
	SessionManager,
	SettingsManager,
	type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	fauxAssistantMessage,
	registerFauxProvider,
	streamSimple,
} from "@earendil-works/pi-ai/compat";

import { resolveRankSynthesisTerminalText } from "../src/cli.js";
import { runPaperRank } from "../src/rank/paper-rank.js";

const fixturePath = resolve(process.cwd(), "tests", "fixtures", "openalex-rank.json");

test("PaperRank rejects Pi terminal provider errors even when they contain partial text", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "feynman-rank-provider-error-"));
	const faux = registerFauxProvider();
	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: false },
		retry: { enabled: false },
		packages: [],
	});
	const resourceLoader = new DefaultResourceLoader({
		cwd: root,
		agentDir: root,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await resourceLoader.reload();

	faux.setResponses([
		fauxAssistantMessage("partial synthesis that must not be delivered", {
			stopReason: "error",
			errorMessage: "provider stream failed",
		}),
	]);
	const modelRuntime = {
		hasConfiguredAuth: () => true,
		checkAuth: async () => ({ auth: { apiKey: "faux-key" } }),
		getAuth: async () => ({ auth: { apiKey: "faux-key" } }),
		isUsingOAuth: () => false,
		streamSimple,
	};
	const { session } = await createAgentSession({
		cwd: root,
		agentDir: root,
		modelRuntime: modelRuntime as never,
		model: faux.getModel(),
		resourceLoader,
		sessionManager: SessionManager.inMemory(root),
		settingsManager,
		noTools: "all",
	});
	let terminalAssistantMessage: AssistantMessage | undefined;
	const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
		if (event.type === "message_end" && event.message.role === "assistant") {
			terminalAssistantMessage = event.message;
		}
	});
	t.after(() => {
		unsubscribe();
		session.dispose();
		faux.unregister();
		rmSync(root, { recursive: true, force: true });
	});

	await assert.doesNotReject(
		session.prompt("write a bounded synthesis", { expandPromptTemplates: false }),
	);
	assert.equal(terminalAssistantMessage?.stopReason, "error");
	assert.throws(
		() => resolveRankSynthesisTerminalText(terminalAssistantMessage),
		/Model synthesis provider failed: provider stream failed/,
	);
});

test("PaperRank reads only the finalized assistant message", () => {
	const finalMessage = fauxAssistantMessage("final synthesis", { stopReason: "stop" });
	assert.equal(resolveRankSynthesisTerminalText(finalMessage), "final synthesis");
	assert.throws(
		() => resolveRankSynthesisTerminalText(undefined),
		/without a terminal assistant response/,
	);
	assert.throws(
		() =>
			resolveRankSynthesisTerminalText(
				fauxAssistantMessage("truncated synthesis", { stopReason: "length" }),
			),
		/output token limit before completion/,
	);
});

test("PaperRank records output-limit truncation as a failed synthesis stage", async () => {
	const outputDir = mkdtempSync(join(tmpdir(), "feynman-rank-provider-length-"));
	const partialMessage = fauxAssistantMessage(
		"partial synthesis that reached the provider output limit",
		{ stopReason: "length" },
	);
	try {
		const result = await runPaperRank({
			topic: "mechanistic interpretability sparse autoencoders",
			limit: 2,
			outputDir,
			sourceFixture: fixturePath,
			synthesize: true,
			modelSynthesizer: async () => ({
				text: resolveRankSynthesisTerminalText(partialMessage),
			}),
			now: new Date("2026-07-29T00:00:00Z"),
		});

		assert.equal(result.synthesis.status, "failed");
		assert.equal(result.synthesis.synthesisPath, undefined);
		assert.equal(result.artifacts.modelSynthesisPath, undefined);
		assert.equal(
			existsSync(join(outputDir, `${result.slug}-model-synthesis.md`)),
			false,
		);
		const researchRun = JSON.parse(
			readFileSync(result.artifacts.researchRunPath, "utf8"),
		) as {
			tools: Array<{ id: string; status: string; outputArtifacts: string[] }>;
		};
		const synthesisStage = researchRun.tools.find(
			(tool) => tool.id === "feynman.paper_rank.model_synthesis",
		);
		assert.equal(synthesisStage?.status, "failed");
		assert.deepEqual(synthesisStage?.outputArtifacts, [
			result.artifacts.synthesisPacketPath,
			result.artifacts.synthesisPromptPath,
		]);
	} finally {
		rmSync(outputDir, { recursive: true, force: true });
	}
});
