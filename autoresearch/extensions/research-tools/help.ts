import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	extensionCommandSpecs,
	formatSlashUsage,
	getExtensionCommandSpec,
	livePackageCommandGroups,
	readPromptSpecs,
} from "../../metadata/commands.mjs";
import { APP_ROOT } from "./shared.js";

type HelpCommand = { usage: string; description: string };
type HelpSection = { title: string; commands: HelpCommand[] };

function buildHelpSections(pi: ExtensionAPI): HelpSection[] {
	const liveCommands = new Map(pi.getCommands().map((command) => [command.name, command]));
	const promptSpecs = readPromptSpecs(APP_ROOT);
	const sections = new Map<string, HelpCommand[]>();

	for (const command of promptSpecs.filter((entry) => entry.section !== "Internal")) {
		const live = liveCommands.get(command.name);
		if (!live) continue;
		const items = sections.get(command.section) ?? [];
		items.push({
			usage: formatSlashUsage(command),
			description: live.description ?? command.description,
		});
		sections.set(command.section, items);
	}

	for (const command of extensionCommandSpecs.filter((entry) => entry.publicDocs)) {
		const live = liveCommands.get(command.name);
		if (!live) continue;
		const items = sections.get(command.section) ?? [];
		items.push({
			usage: formatSlashUsage(command),
			description: live.description ?? command.description,
		});
		sections.set(command.section, items);
	}

	const ownedNames = new Set([
		...promptSpecs.filter((entry) => entry.section !== "Internal").map((entry) => entry.name),
		...extensionCommandSpecs.filter((entry) => entry.publicDocs).map((entry) => entry.name),
	]);

	for (const group of livePackageCommandGroups) {
		const commands: HelpCommand[] = [];
		for (const spec of group.commands) {
			const command = liveCommands.get(spec.name);
			if (!command || ownedNames.has(command.name)) continue;
			commands.push({
				usage: spec.usage,
				description: command.description ?? "",
			});
		}

		if (commands.length > 0) {
			sections.set(group.title, commands);
		}
	}

	return [
		"Research Workflows",
		"Project & Session",
		"Setup",
		"Agents & Delegation",
		"Live Package Commands",
	]
		.map((title) => ({ title, commands: sections.get(title) ?? [] }))
		.filter((section) => section.commands.length > 0);
}

export function registerHelpCommand(pi: ExtensionAPI): void {
	pi.registerCommand("help", {
		description:
			getExtensionCommandSpec("help")?.description ??
			"Show grouped Feynman commands and prefill the editor with a selected command.",
		handler: async (_args, ctx) => {
			const sections = buildHelpSections(pi);
			const items = sections.flatMap((section) => [
				`--- ${section.title} ---`,
				...section.commands.map((cmd) => `${cmd.usage} — ${cmd.description}`),
			]);

			const selected = await ctx.ui.select("Feynman Help", items);
			if (!selected || selected.startsWith("---")) return;

			const usage = selected.split(" — ")[0];
			ctx.ui.setEditorText(usage);
			ctx.ui.notify(`Prefilled ${usage}`, "info");
		},
	});
}
