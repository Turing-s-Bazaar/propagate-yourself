import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";

const THINKING_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const satisfies readonly ThinkingLevel[];

const THINKING_LEVEL_SET = new Set<string>(THINKING_LEVELS);

function normalizeThinkingLevel(value: string): ThinkingLevel | undefined {
	const normalized = value.trim().toLowerCase();
	return THINKING_LEVEL_SET.has(normalized) ? (normalized as ThinkingLevel) : undefined;
}

export function registerThinkingCommand(pi: ExtensionAPI): void {
	pi.registerCommand("thinking", {
		description: "View or set the active model thinking level.",
		getArgumentCompletions: (prefix) => {
			const normalizedPrefix = prefix.trim().toLowerCase();
			return THINKING_LEVELS
				.filter((level) => level.startsWith(normalizedPrefix))
				.map((level) => ({ value: level, label: level }));
		},
		handler: async (args, ctx) => {
			const requested = normalizeThinkingLevel(args);
			if (args.trim() && !requested) {
				ctx.ui.notify("Use off, minimal, low, medium, high, xhigh, or max.", "error");
				return;
			}

			let selected = requested;
			if (!selected && ctx.hasUI) {
				const current = pi.getThinkingLevel();
				const availableLevels = ctx.model
					? getSupportedThinkingLevels(ctx.model)
					: [...THINKING_LEVELS];
				const choice = await ctx.ui.select(
					`Thinking level (current: ${current})`,
					availableLevels.map((level) => level === current ? `${level} (current)` : level),
				);
				if (!choice) return;
				selected = normalizeThinkingLevel(choice.replace(/ \(current\)$/, ""));
			}

			if (!selected) {
				ctx.ui.notify(`Thinking level: ${pi.getThinkingLevel()}`, "info");
				return;
			}

			pi.setThinkingLevel(selected);
			const active = pi.getThinkingLevel();
			ctx.ui.notify(
				active === selected
					? `Thinking level set to ${active}.`
					: `Thinking level set to ${active} (clamped from ${selected} for the active model).`,
				"info",
			);
		},
	});
}
