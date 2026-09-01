import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import type { WorkbenchCustomSkill, WorkbenchUserAgent } from "./types.js";

const LOCAL_USER_ID = "local-workbench";
const DEFAULT_SYSTEM_PROMPT = "You are Feynman, a research-first AI agent.";

function stableUuid(namespace: string, value: string): string {
	const bytes = createHash("sha256").update(`${namespace}:${value}`).digest().subarray(0, 16);
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function timestampFromMs(ms: number): { iso: string; ms: number } {
	const safeMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
	return { iso: new Date(safeMs).toISOString(), ms: safeMs };
}

function readSystemPrompt(workingDir: string): { prompt: string; createdAtMs: number; updatedAtMs: number } {
	const path = resolve(workingDir, ".feynman", "SYSTEM.md");
	if (!existsSync(path)) return { prompt: DEFAULT_SYSTEM_PROMPT, createdAtMs: 0, updatedAtMs: 0 };
	const stat = statSync(path);
	return {
		prompt: readFileSync(path, "utf8"),
		createdAtMs: stat.birthtimeMs || stat.ctimeMs || stat.mtimeMs,
		updatedAtMs: stat.mtimeMs || stat.ctimeMs || stat.birthtimeMs,
	};
}

export function buildWorkbenchUserAgents(workingDir: string, customSkills: WorkbenchCustomSkill[]): WorkbenchUserAgent[] {
	const system = readSystemPrompt(workingDir);
	const skillNames = Array.from(new Set(customSkills.map((skill) => skill.name).filter(Boolean))).sort();
	const created = timestampFromMs(system.createdAtMs);
	const latestSkillUpdate = customSkills.reduce((latest, skill) => Math.max(latest, skill.updatedAtMs), 0);
	const updated = timestampFromMs(Math.max(system.updatedAtMs, latestSkillUpdate));
	return [{
		id: stableUuid("feynman-user-agent", "local-workbench:FEYNMAN"),
		userId: LOCAL_USER_ID,
		name: "FEYNMAN",
		displayName: "Feynman",
		description: "Default Feynman research agent profile",
		systemPrompt: system.prompt,
		iconKey: "lightning",
		colorKey: "feynman-green",
		tags: ["research", "open-science"],
		skillNames,
		enabled: true,
		createdAt: created.iso,
		createdAtMs: created.ms,
		updatedAt: updated.iso,
		updatedAtMs: updated.ms,
		skillTombstones: [],
		connectorTombstones: [],
		unrestricted: false,
	}];
}
