import assert from "node:assert/strict";
import test from "node:test";

import { registerThinkingCommand } from "../extensions/research-tools/thinking.js";

type RegisteredCommand = {
	getArgumentCompletions?: (prefix: string) => Array<{ value: string; label: string }> | null;
	handler: (args: string, ctx: any) => Promise<void>;
};

function createHarness(initial = "medium", thinkingLevelMap?: Record<string, string | null>) {
	let active = initial;
	const registered = new Map<string, RegisteredCommand>();
	const notifications: Array<{ message: string; level: string }> = [];
	const selections: Array<{ title: string; options: string[] }> = [];
	let selection: string | undefined;
	const pi = {
		getThinkingLevel: () => active,
		setThinkingLevel: (level: string) => {
			active = level;
		},
		registerCommand: (name: string, command: RegisteredCommand) => {
			registered.set(name, command);
		},
	};
	const ctx = {
		hasUI: true,
		model: {
			reasoning: true,
			thinkingLevelMap,
		},
		ui: {
			notify: (message: string, level: string) => notifications.push({ message, level }),
			select: async (title: string, options: string[]) => {
				selections.push({ title, options });
				return selection;
			},
		},
	};

	registerThinkingCommand(pi as any);
	return {
		command: registered.get("thinking")!,
		ctx,
		getActive: () => active,
		notifications,
		selections,
		setSelection: (value: string | undefined) => {
			selection = value;
		},
	};
}

test("/thinking sets an explicit supported level and offers completions", async () => {
	const harness = createHarness();

	await harness.command.handler("high", harness.ctx);

	assert.equal(harness.getActive(), "high");
	assert.deepEqual(harness.notifications, [{ message: "Thinking level set to high.", level: "info" }]);
	assert.deepEqual(harness.command.getArgumentCompletions?.("m"), [
		{ value: "minimal", label: "minimal" },
		{ value: "medium", label: "medium" },
		{ value: "max", label: "max" },
	]);
});

test("/thinking without an argument opens a current-aware picker", async () => {
	const harness = createHarness("low", { xhigh: "xhigh", max: "max" });
	harness.setSelection("max");

	await harness.command.handler("", harness.ctx);

	assert.equal(harness.getActive(), "max");
	assert.equal(harness.selections[0]?.title, "Thinking level (current: low)");
	assert.ok(harness.selections[0]?.options.includes("low (current)"));
	assert.ok(harness.selections[0]?.options.includes("max"));
});

test("/thinking picker only shows levels supported by the active model", async () => {
	const harness = createHarness("high");

	await harness.command.handler("", harness.ctx);

	assert.deepEqual(harness.selections[0]?.options, ["off", "minimal", "low", "medium", "high (current)"]);
});

test("/thinking reports current state without UI and rejects invalid levels", async () => {
	const harness = createHarness("medium");
	harness.ctx.hasUI = false;

	await harness.command.handler("", harness.ctx);
	await harness.command.handler("extreme", harness.ctx);

	assert.deepEqual(harness.notifications, [
		{ message: "Thinking level: medium", level: "info" },
		{ message: "Use off, minimal, low, medium, high, xhigh, or max.", level: "error" },
	]);
	assert.equal(harness.getActive(), "medium");
});
