import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname, resolve } from "node:path";

import type { WorkbenchResource } from "./types.js";

type ClaudeScienceDomain = {
	deferredTools: string[];
	name: string;
	servedTools: string[];
	totalTools: string[];
};

type ClaudeScienceSkill = {
	description: string;
	name: string;
	path: string;
};

type ClaudeScienceAgent = {
	description: string;
	name: string;
	path: string;
};

type ClaudeScienceSeedWorkflow = {
	bytes: number;
	files: number;
	name: string;
	path: string;
	types: Record<string, number>;
};

export type ClaudeScienceInstall = {
	agentCount: number;
	agents: ClaudeScienceAgent[];
	bioMcpPath?: string;
	databasePath?: string;
	databaseTables: string[];
	deferredToolCount: number;
	domains: ClaudeScienceDomain[];
	migrationCount: number;
	migrationPath?: string;
	runtimePath: string;
	seedPath?: string;
	seedWorkflows: ClaudeScienceSeedWorkflow[];
	servedToolCount: number;
	skillCount: number;
	skills: ClaudeScienceSkill[];
	totalToolCount: number;
};

const CLAUDE_SCIENCE_HOME = resolve(homedir(), ".claude-science");

function toTitle(value: string): string {
	return value
		.replace(/^example_/, "")
		.replace(/[_-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function firstTextLine(text: string): string {
	return text
		.replace(/^---\n[\s\S]*?\n---\n?/, "")
		.split("\n")
		.map((line) => line.replace(/^#+\s*/, "").replace(/^[-*]\s*/, "").trim())
		.filter((line) => line && !line.startsWith("```") && !line.startsWith("#"))
		.find(Boolean)
		?.slice(0, 260) || "";
}

function yamlScalar(text: string, key: string): string | undefined {
	const match = text.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
	return match?.[1]?.trim().replace(/^["']|["']$/g, "") || undefined;
}

function yamlBlock(text: string, key: string): string | undefined {
	const lines = text.split("\n");
	const start = lines.findIndex((line) => line.trim() === `${key}: |`);
	if (start < 0) return undefined;
	const block: string[] = [];
	for (const line of lines.slice(start + 1)) {
		if (/^\S/.test(line)) break;
		const trimmed = line.replace(/^\s{2}/, "");
		if (trimmed.trim()) block.push(trimmed.trim());
	}
	return block.join(" ").slice(0, 300) || undefined;
}

function latestRuntimePath(): string | undefined {
	const runtimeRoot = resolve(CLAUDE_SCIENCE_HOME, "runtime");
	if (!existsSync(runtimeRoot)) return undefined;
	return readdirSync(runtimeRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && entry.name.endsWith("-release"))
		.map((entry) => resolve(runtimeRoot, entry.name))
		.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
		.at(0);
}

function readJsonFile<T>(path: string): T | undefined {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as T;
	} catch {
		return undefined;
	}
}

function readDomains(bioMcpPath: string): { deferredToolCount: number; domains: ClaudeScienceDomain[]; servedToolCount: number; totalToolCount: number } {
	const domainsPath = resolve(bioMcpPath, "domains.json");
	const deferredPath = resolve(bioMcpPath, "deferred.json");
	const domainsJson = readJsonFile<Record<string, string[]>>(domainsPath) ?? {};
	const deferredJson = readJsonFile<{ domains?: string[]; tools?: string[]; license_tools?: string[] }>(deferredPath) ?? {};
	const deferredTools = new Set([...(deferredJson.tools ?? []), ...(deferredJson.license_tools ?? [])]);
	for (const domain of deferredJson.domains ?? []) {
		for (const tool of domainsJson[domain] ?? []) deferredTools.add(tool);
	}
	const domains = Object.entries(domainsJson)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([name, totalTools]) => {
			const sortedTools = [...totalTools].sort((left, right) => left.localeCompare(right));
			const domainDeferred = sortedTools.filter((tool) => deferredTools.has(tool));
			return {
				name,
				totalTools: sortedTools,
				deferredTools: domainDeferred,
				servedTools: sortedTools.filter((tool) => !deferredTools.has(tool)),
			};
		});
	const totalToolCount = domains.reduce((sum, domain) => sum + domain.totalTools.length, 0);
	const deferredToolCount = domains.reduce((sum, domain) => sum + domain.deferredTools.length, 0);
	return {
		deferredToolCount,
		domains,
		servedToolCount: totalToolCount - deferredToolCount,
		totalToolCount,
	};
}

function readSkills(runtimePath: string): ClaudeScienceSkill[] {
	const skillsRoot = resolve(runtimePath, "skills");
	if (!existsSync(skillsRoot)) return [];
	return readdirSync(skillsRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.flatMap((entry) => {
			const path = resolve(skillsRoot, entry.name, "SKILL.md");
			if (!existsSync(path)) return [];
			const text = readFileSync(path, "utf8");
			return [{
				name: entry.name,
				path,
				description: firstTextLine(text) || `${toTitle(entry.name)} skill from the installed Claude Science runtime.`,
			}];
		})
		.sort((left, right) => left.name.localeCompare(right.name));
}

function readAgents(runtimePath: string): ClaudeScienceAgent[] {
	const agentsRoot = resolve(runtimePath, "agents");
	if (!existsSync(agentsRoot)) return [];
	return readdirSync(agentsRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.flatMap((entry) => {
			const path = resolve(agentsRoot, entry.name, "metadata.yaml");
			if (!existsSync(path)) return [];
			const text = readFileSync(path, "utf8");
			return [{
				name: yamlScalar(text, "agent_name") ?? entry.name.toUpperCase(),
				path,
				description: yamlBlock(text, "description") ?? `${toTitle(entry.name)} agent metadata from the installed Claude Science runtime.`,
			}];
		})
		.sort((left, right) => left.name.localeCompare(right.name));
}

function readSeedWorkflows(): { seedPath?: string; seedWorkflows: ClaudeScienceSeedWorkflow[] } {
	const seedPath = resolve(CLAUDE_SCIENCE_HOME, "seed-assets");
	if (!existsSync(seedPath)) return { seedWorkflows: [] };
	const seedWorkflows = readdirSync(seedPath, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => {
			const path = resolve(seedPath, entry.name);
			const files = readdirSync(path, { withFileTypes: true }).filter((file) => file.isFile());
			const types: Record<string, number> = {};
			let bytes = 0;
			for (const file of files) {
				const filePath = resolve(path, file.name);
				bytes += statSync(filePath).size;
				const extension = extname(file.name).toLowerCase() || "no-ext";
				types[extension] = (types[extension] ?? 0) + 1;
			}
			return { name: entry.name, path, files: files.length, bytes, types };
		})
		.sort((left, right) => left.name.localeCompare(right.name));
	return { seedPath, seedWorkflows };
}

function migrationCount(runtimePath: string): { migrationCount: number; migrationPath?: string } {
	const migrationPath = resolve(runtimePath, "drizzle", "sqlite");
	if (!existsSync(migrationPath)) return { migrationCount: 0 };
	return {
		migrationPath,
		migrationCount: readdirSync(migrationPath).filter((name) => name.endsWith(".sql")).length,
	};
}

function databaseTables(): { databasePath?: string; databaseTables: string[] } {
	const orgRoot = resolve(CLAUDE_SCIENCE_HOME, "orgs");
	if (!existsSync(orgRoot)) return { databaseTables: [] };
	const databasePath = readdirSync(orgRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => resolve(orgRoot, entry.name, "operon-cli.db"))
		.find((path) => existsSync(path));
	if (!databasePath) return { databaseTables: [] };
	const result = spawnSync("sqlite3", [databasePath, ".tables"], {
		encoding: "utf8",
		timeout: 2_000,
	});
	const tables = result.status === 0
		? result.stdout.split(/\s+/).map((name) => name.trim()).filter(Boolean).sort((left, right) => left.localeCompare(right))
		: [];
	return { databasePath, databaseTables: tables };
}

export function readClaudeScienceInstall(): ClaudeScienceInstall | undefined {
	const runtimePath = latestRuntimePath();
	if (!runtimePath) return undefined;
	const bioMcpPath = resolve(runtimePath, "mcp-servers", "bio-tools", "lib", "mcp_bio");
	const domainInfo = existsSync(bioMcpPath)
		? readDomains(bioMcpPath)
		: { deferredToolCount: 0, domains: [], servedToolCount: 0, totalToolCount: 0 };
	const skills = readSkills(runtimePath);
	const agents = readAgents(runtimePath);
	const seeds = readSeedWorkflows();
	const migrations = migrationCount(runtimePath);
	const db = databaseTables();
	return {
		...domainInfo,
		...seeds,
		...migrations,
		...db,
		runtimePath,
		agentCount: agents.length,
		agents,
		...(existsSync(bioMcpPath) ? { bioMcpPath } : {}),
		skillCount: skills.length,
		skills,
	};
}

export function buildClaudeScienceReferenceResources(install: ClaudeScienceInstall | undefined): WorkbenchResource[] {
	if (!install) return [];
	const seedTypes = install.seedWorkflows
		.map((workflow) => `${toTitle(workflow.name)}: ${workflow.files} files`)
		.join("; ");
	return [
		{
			id: "claude-science-reference-install",
			name: "Claude Science reference install",
			description: "Internal read-only blueprint used to compare schemas, tool coverage, skills, agents, and seed workflow shapes while Feynman owns its runtime.",
			status: "read-only",
			source: "Claude Science local install",
			section: "Internal reference",
			path: install.runtimePath,
			detail: [
				`${install.migrationCount} SQLite migrations`,
				`${install.databaseTables.length} local DB tables`,
				`${install.servedToolCount}/${install.totalToolCount} bio tools served`,
				`${install.skillCount} skills`,
				`${install.agentCount} agents`,
			].join("; "),
			diagnostics: [
				`Runtime path: ${install.runtimePath}`,
				install.databasePath ? `Database: ${install.databasePath}` : "Database: not found",
				install.migrationPath ? `Migrations: ${install.migrationPath}` : "Migrations: not found",
				install.bioMcpPath ? `Bio tool catalog: ${install.bioMcpPath}` : "Bio tool catalog: not found",
				seedTypes ? `Reference seed shapes: ${seedTypes}` : "Reference seed shapes: none found",
			],
			tags: ["internal reference", "debug", "schema", "tool coverage"],
		},
	];
}
