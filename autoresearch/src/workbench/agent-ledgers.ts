import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, relative, resolve, sep } from "node:path";

import type { WorkbenchAgentRecord, WorkbenchBundledAgentSetting } from "./types.js";

const LOCAL_USER_ID = "local-workbench";

function stableUuid(namespace: string, value: string): string {
	const bytes = createHash("sha256").update(`${namespace}:${value}`).digest().subarray(0, 16);
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function toPosixPath(path: string): string {
	return path.split(sep).join("/");
}

function timestampFromMs(ms: number): { iso: string; ms: number } {
	const safeMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
	return { iso: new Date(safeMs).toISOString(), ms: safeMs };
}

function fileTimestamps(path: string): { createdAt: string; createdAtMs: number; updatedAt: string; updatedAtMs: number } {
	const stat = statSync(path);
	const created = timestampFromMs(stat.birthtimeMs || stat.ctimeMs || stat.mtimeMs);
	const updated = timestampFromMs(stat.mtimeMs || stat.ctimeMs || stat.birthtimeMs);
	return {
		createdAt: created.iso,
		createdAtMs: created.ms,
		updatedAt: updated.iso,
		updatedAtMs: updated.ms,
	};
}

function frontmatter(text: string): Record<string, string> {
	const block = text.match(/^---\n([\s\S]*?)\n---\n?/);
	if (!block) return {};
	const values: Record<string, string> = {};
	for (const line of block[1].split("\n")) {
		const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (!match) continue;
		values[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
	}
	return values;
}

function directAgentFiles(workingDir: string): string[] {
	const dir = resolve(workingDir, ".feynman", "agents");
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
		.map((entry) => resolve(dir, entry.name))
		.sort();
}

function agentName(path: string, metadata: Record<string, string>): string {
	return metadata.name || basename(path, extname(path));
}

function agentDescription(name: string, metadata: Record<string, string>): string {
	return metadata.description || `${name} Feynman research specialist.`;
}

function parametersJson(workingDir: string, path: string, metadata: Record<string, string>): string {
	const relPath = toPosixPath(relative(workingDir, path));
	return JSON.stringify({
		source: "feynman-bundled-agent",
		path: relPath,
		tools: metadata.tools ? metadata.tools.split(",").map((item) => item.trim()).filter(Boolean) : [],
		...(metadata.thinking ? { thinking: metadata.thinking } : {}),
		...(metadata.output ? { output: metadata.output } : {}),
		...(metadata.defaultProgress ? { defaultProgress: metadata.defaultProgress === "true" } : {}),
	});
}

function agentRecord(workingDir: string, path: string): WorkbenchAgentRecord {
	const content = readFileSync(path, "utf8");
	const metadata = frontmatter(content);
	const name = agentName(path, metadata);
	const timestamps = fileTimestamps(path);
	return {
		id: stableUuid("feynman-agent", name),
		name,
		url: `feynman://agents/${encodeURIComponent(name)}`,
		description: agentDescription(name, metadata),
		parameters: parametersJson(workingDir, path, metadata),
		...timestamps,
	};
}

function bundledAgentSetting(agent: WorkbenchAgentRecord): WorkbenchBundledAgentSetting {
	return {
		id: stableUuid("feynman-bundled-agent-setting", `${LOCAL_USER_ID}:${agent.name}`),
		userId: LOCAL_USER_ID,
		agentName: agent.name,
		enabled: true,
		createdAt: agent.createdAt,
		createdAtMs: agent.createdAtMs,
		updatedAt: agent.updatedAt,
		updatedAtMs: agent.updatedAtMs,
	};
}

export function buildWorkbenchAgentLedgers(workingDir: string): {
	agents: WorkbenchAgentRecord[];
	bundledAgentSettings: WorkbenchBundledAgentSetting[];
} {
	const agents = directAgentFiles(workingDir)
		.map((path) => agentRecord(workingDir, path))
		.sort((a, b) => a.name.localeCompare(b.name));
	return {
		agents,
		bundledAgentSettings: agents.map(bundledAgentSetting).sort((a, b) => a.agentName.localeCompare(b.agentName)),
	};
}
