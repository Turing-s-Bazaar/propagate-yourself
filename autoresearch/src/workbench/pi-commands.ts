import { relative, resolve, sep } from "node:path";

import type { WorkbenchPiCommand, WorkbenchResource, WorkbenchResourceGroup } from "./types.js";

function toPosixPath(path: string): string {
	return path.split(sep).join("/");
}

function normalizeResourceId(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 90) || "resource";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sourceInfoFromRecord(record: Record<string, unknown>): WorkbenchPiCommand["sourceInfo"] {
	const sourceInfo = asRecord(record.sourceInfo);
	if (!sourceInfo) return undefined;
	return {
		...(stringValue(sourceInfo, "path") ? { path: stringValue(sourceInfo, "path") } : {}),
		...(stringValue(sourceInfo, "source") ? { source: stringValue(sourceInfo, "source") } : {}),
		...(stringValue(sourceInfo, "scope") ? { scope: stringValue(sourceInfo, "scope") } : {}),
		...(stringValue(sourceInfo, "origin") ? { origin: stringValue(sourceInfo, "origin") } : {}),
		...(stringValue(sourceInfo, "baseDir") ? { baseDir: stringValue(sourceInfo, "baseDir") } : {}),
	};
}

function commandInvocation(name: string): string {
	return `/${name.replace(/^\/+/, "")}`;
}

function commandDescription(command: WorkbenchPiCommand): string {
	if (command.description) return command.description;
	if (command.source === "skill") return `Pi skill command ${command.command}.`;
	if (command.source === "prompt") return `Pi prompt-template command ${command.command}.`;
	if (command.source === "extension") return `Pi extension command ${command.command}.`;
	return `Pi command ${command.command}.`;
}

function relativeCommandPath(workingDir: string, path: string | undefined): string | undefined {
	if (!path) return undefined;
	const workspace = resolve(workingDir);
	const absolute = resolve(path);
	const rel = toPosixPath(relative(workspace, absolute));
	if (rel && !rel.startsWith("../") && rel !== ".." && !rel.split("/").includes("..")) return rel;
	return path;
}

export function normalizePiCommands(value: unknown): WorkbenchPiCommand[] {
	const root = asRecord(value);
	const data = asRecord(root?.data) ?? root;
	const commands = Array.isArray(data?.commands) ? data.commands : Array.isArray(value) ? value : [];
	return commands.flatMap((item) => {
		const record = asRecord(item);
		const name = record ? stringValue(record, "name") : undefined;
		if (!record || !name) return [];
		const sourceInfo = sourceInfoFromRecord(record);
		return [{
			name,
			command: commandInvocation(name),
			...(stringValue(record, "description") ? { description: stringValue(record, "description") } : {}),
			...(stringValue(record, "source") ? { source: stringValue(record, "source") } : {}),
			...(sourceInfo?.scope || stringValue(record, "location")
				? { location: sourceInfo?.scope ?? stringValue(record, "location") }
				: {}),
			...(sourceInfo?.path || stringValue(record, "path")
				? { path: sourceInfo?.path ?? stringValue(record, "path") }
				: {}),
			...(sourceInfo && Object.keys(sourceInfo).length ? { sourceInfo } : {}),
		}];
	}).sort((a, b) => a.command.localeCompare(b.command));
}

export function buildPiCommandResourceGroup(workingDir: string, commands: WorkbenchPiCommand[]): WorkbenchResourceGroup {
	const resources: WorkbenchResource[] = commands.map((command) => {
		const source = command.source ?? "command";
		const scope = command.sourceInfo?.scope ?? command.location ?? "runtime";
		const origin = command.sourceInfo?.origin;
		const sourceName = command.sourceInfo?.source;
		const relPath = relativeCommandPath(workingDir, command.path);
		const detail = [scope, origin, sourceName].filter((item): item is string => Boolean(item)).join(" / ");
		const tags = ["live", source, scope, origin, sourceName].filter((item): item is string => Boolean(item));
		return {
			id: normalizeResourceId(`pi-command-${source}-${scope}-${origin ?? ""}-${command.name}-${relPath ?? ""}`),
			name: command.name,
			description: commandDescription(command),
			status: "configured",
			source: `Pi ${source} command`,
			section: source === "skill" ? "Skill commands" : source === "prompt" ? "Prompt commands" : "Extension commands",
			command: command.command,
			...(relPath ? { path: relPath } : {}),
			...(detail ? { detail } : {}),
			tags,
		};
	});
	return {
		id: "commands",
		title: "Pi Commands",
		description: "Live slash commands exposed by the current Pi RPC session.",
		resources,
	};
}

export function mergePiCommandResourceGroup(
	groups: WorkbenchResourceGroup[],
	commandGroup: WorkbenchResourceGroup,
): WorkbenchResourceGroup[] {
	const existing = groups.filter((group) => group.id !== "commands");
	if (!commandGroup.resources.length) return existing;
	const skillIndex = existing.findIndex((group) => group.id === "skills");
	if (skillIndex === -1) return [commandGroup, ...existing];
	return [
		...existing.slice(0, skillIndex + 1),
		commandGroup,
		...existing.slice(skillIndex + 1),
	];
}
