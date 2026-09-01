import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

import {
	buildCurrentDateResearchContext,
	registerCurrentDateResearchContext,
} from "../extensions/research-tools/current-date.js";

test("current-date research context states the date and source-verification rules", () => {
	const context = buildCurrentDateResearchContext(new Date(2026, 7, 12, 9));
	assert.match(context, /current date is 2026-08-12/i);
	assert.match(context, /verify against current sources/i);
	assert.match(context, /Do not reject evidence only because its date is later than your training data/i);
});

test("before_agent_start appends current-date context through Pi's supported system-prompt result", () => {
	let handler:
		| ((event: BeforeAgentStartEvent) => BeforeAgentStartEventResult | void)
		| undefined;
	const pi = {
		on(event: string, candidate: typeof handler) {
			if (event === "before_agent_start") handler = candidate;
		},
	} as unknown as ExtensionAPI;

	registerCurrentDateResearchContext(pi, () => new Date(2026, 7, 12, 9));
	assert.ok(handler);
	const result = handler({
		type: "before_agent_start",
		prompt: "Find the latest research.",
		systemPrompt: "Base prompt.",
		systemPromptOptions: {} as BeforeAgentStartEvent["systemPromptOptions"],
	});
	assert.equal(
		result?.systemPrompt,
		[
			"Base prompt.",
			"",
			"The current date is 2026-08-12.",
			"For current, latest, or recent claims, verify against current sources.",
			"Do not reject evidence only because its date is later than your training data.",
		].join("\n"),
	);
});

test("the bundled research extension registers current-date context for parent and child agents", () => {
	const source = readFileSync(resolve(process.cwd(), "extensions", "research-tools.ts"), "utf8");
	assert.match(source, /registerCurrentDateResearchContext\(pi\)/);
});
