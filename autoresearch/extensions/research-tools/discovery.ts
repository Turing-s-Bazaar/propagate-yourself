import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import type { ExtensionAPI, SlashCommandInfo, ToolInfo } from "@earendil-works/pi-coding-agent";

import {
	extensionCommandSpecs,
	isPublicLivePackageCommandName,
	isPublicLivePackageToolName,
	readPromptSpecs,
} from "../../metadata/commands.mjs";
import { APP_ROOT } from "./shared.js";

function resolveFeynmanSettingsPath(): string {
	const configured = process.env.PI_CODING_AGENT_DIR?.trim();
	const agentDir = configured
		? configured.startsWith("~/")
			? resolve(homedir(), configured.slice(2))
			: resolve(configured)
		: resolve(homedir(), ".feynman", "agent");
	return resolve(agentDir, "settings.json");
}

function readConfiguredPackages(): string[] {
	const settingsPath = resolveFeynmanSettingsPath();
	if (!existsSync(settingsPath)) return [];

	try {
		const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as { packages?: unknown[] };
		return Array.isArray(parsed.packages)
			? parsed.packages
					.map((entry) => {
						if (typeof entry === "string") return entry;
						if (!entry || typeof entry !== "object") return undefined;
						const record = entry as { source?: unknown };
						return typeof record.source === "string" ? record.source : undefined;
					})
					.filter((entry): entry is string => Boolean(entry))
			: [];
	} catch {
		return [];
	}
}

function formatSourceLabel(sourceInfo: { source: string; path: string }): string {
	const normalizedPath = sourceInfo.path.replaceAll("\\", "/");
	if (
		(sourceInfo.source === "local" || sourceInfo.source === "cli") &&
		(
			normalizedPath.endsWith("/extensions/research-tools.ts") ||
			normalizedPath.includes("/extensions/research-tools/")
		)
	) {
		return "extension";
	}
	if (sourceInfo.source === "local") {
		if (normalizedPath.includes("/prompts/")) return "workflow";
		if (normalizedPath.includes("/extensions/")) return "extension";
		return "local";
	}
	return sourceInfo.source.replace(/^npm:/, "").replace(/^git:/, "");
}

function formatCommandLine(command: SlashCommandInfo): string {
	const source = formatSourceLabel(command.sourceInfo);
	return `/${command.name} — ${command.description ?? ""} [${source}]`;
}

function getPublicCommandNames(): Set<string> {
	return new Set([
		...readPromptSpecs(APP_ROOT)
			.filter((entry) => entry.section !== "Internal")
			.map((entry) => entry.name),
		...extensionCommandSpecs.filter((entry) => entry.publicDocs).map((entry) => entry.name),
	]);
}

function isPublicCommand(command: SlashCommandInfo, publicNames: Set<string>): boolean {
	return publicNames.has(command.name) || isPublicLivePackageCommandName(command.name);
}

function isFeynmanLocalTool(tool: ToolInfo): boolean {
	if (tool.sourceInfo.source !== "local" && tool.sourceInfo.source !== "cli") return false;
	const normalizedPath = tool.sourceInfo.path.replaceAll("\\", "/");
	return (
		normalizedPath.endsWith("/extensions/research-tools.ts") ||
		normalizedPath.includes("/extensions/research-tools/")
	);
}

function isPublicTool(tool: ToolInfo): boolean {
	return isFeynmanLocalTool(tool) || isPublicLivePackageToolName(tool.name);
}

function summarizeToolParameters(tool: ToolInfo): string {
	const properties =
		tool.parameters &&
		typeof tool.parameters === "object" &&
		"properties" in tool.parameters &&
		tool.parameters.properties &&
		typeof tool.parameters.properties === "object"
			? Object.keys(tool.parameters.properties as Record<string, unknown>)
			: [];
	return properties.length > 0 ? properties.join(", ") : "no parameters";
}

function formatToolLine(tool: ToolInfo): string {
	const source = formatSourceLabel(tool.sourceInfo);
	return `${tool.name} — ${tool.description ?? ""} [${source}]`;
}

export function registerDiscoveryCommands(pi: ExtensionAPI): void {
	pi.registerCommand("commands", {
		description: "Browse Feynman workflow, project, and approved live runtime commands.",
		handler: async (_args, ctx) => {
			const publicNames = getPublicCommandNames();
			const commands = pi
				.getCommands()
				.filter((command) => isPublicCommand(command, publicNames))
				.slice()
				.sort((left, right) => left.name.localeCompare(right.name));
			const items = commands.map((command) => formatCommandLine(command));
			const selected = await ctx.ui.select("Slash Commands", items);
			if (!selected) return;
			ctx.ui.setEditorText(selected.split(" — ")[0] ?? "");
			ctx.ui.notify(`Prefilled ${selected.split(" — ")[0]}`, "info");
		},
	});

	pi.registerCommand("tools", {
		description: "Browse public research tools with their source and parameter summary.",
		handler: async (_args, ctx) => {
			const tools = pi
				.getAllTools()
				.filter(isPublicTool)
				.slice()
				.sort((left, right) => left.name.localeCompare(right.name));
			const selected = await ctx.ui.select("Tools", tools.map((tool) => formatToolLine(tool)));
			if (!selected) return;

			const toolName = selected.split(" — ")[0] ?? selected;
			const tool = tools.find((entry) => entry.name === toolName);
			if (!tool) return;
			ctx.ui.notify(`${tool.name}: ${summarizeToolParameters(tool)}`, "info");
		},
	});

	pi.registerCommand("capabilities", {
		description: "Show installed packages, discovery entrypoints, and high-level runtime capability counts.",
		handler: async (_args, ctx) => {
			const publicNames = getPublicCommandNames();
			const commands = pi.getCommands().filter((command) => isPublicCommand(command, publicNames));
			const tools = pi.getAllTools().filter(isPublicTool);
			const workflows = commands.filter((command) => formatSourceLabel(command.sourceInfo) === "workflow");
			const packages = readConfiguredPackages();
			const items = [
				`Commands: ${commands.length}`,
				`Workflows: ${workflows.length}`,
				`Tools: ${tools.length}`,
				`Packages: ${packages.length}`,
				"--- Discovery ---",
				"/commands — browse slash commands",
				"/tools — inspect callable tools",
				"/hotkeys — view keyboard shortcuts",
				"/service-tier — set request tier for supported providers",
				"/thinking — view or set the active model thinking level",
				"--- Installed Packages ---",
				...packages.map((pkg) => pkg),
			];
			const selected = await ctx.ui.select("Capabilities", items);
			if (!selected || selected.startsWith("---")) return;
			if (selected.startsWith("/")) {
				ctx.ui.setEditorText(selected.split(" — ")[0] ?? selected);
				ctx.ui.notify(`Prefilled ${selected.split(" — ")[0]}`, "info");
			}
		},
	});
}
