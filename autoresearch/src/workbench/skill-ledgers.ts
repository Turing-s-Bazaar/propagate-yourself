import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";

import type { WorkbenchAgentSkillAssignment, WorkbenchCustomAgentPrompt, WorkbenchCustomSkill } from "./types.js";

const DEFAULT_AGENT_NAME = "feynman";
const LOCAL_USER_ID = "local-workbench";
const MAX_SKILL_CONTENT_BYTES = 96_000;

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

function readText(path: string): { content: string; truncated: boolean } {
	const buffer = readFileSync(path);
	if (buffer.byteLength <= MAX_SKILL_CONTENT_BYTES) return { content: buffer.toString("utf8"), truncated: false };
	return { content: buffer.subarray(0, MAX_SKILL_CONTENT_BYTES).toString("utf8"), truncated: true };
}

function frontmatterValue(text: string, key: string): string | undefined {
	const block = text.match(/^---\n([\s\S]*?)\n---\n?/);
	if (!block) return undefined;
	const match = block[1].match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
	return match?.[1]?.trim().replace(/^["']|["']$/g, "") || undefined;
}

function firstMarkdownSentence(text: string): string | undefined {
	const cleaned = text
		.replace(/^---\n[\s\S]*?\n---\n?/, "")
		.split("\n")
		.map((line) => line.replace(/^#+\s*/, "").trim())
		.filter(Boolean)
		.find((line) => !line.startsWith("```"));
	return cleaned?.replace(/\s+/g, " ").slice(0, 300);
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

function listFiles(root: string, predicate: (name: string, absPath: string) => boolean): string[] {
	if (!existsSync(root)) return [];
	const files: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const absPath = resolve(dir, entry.name);
			if (entry.isDirectory()) {
				walk(absPath);
				continue;
			}
			if (entry.isFile() && predicate(entry.name, absPath)) files.push(absPath);
		}
	};
	walk(root);
	return files.sort();
}

function directMarkdownFiles(root: string): string[] {
	if (!existsSync(root)) return [];
	return readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
		.map((entry) => resolve(root, entry.name))
		.sort();
}

function skillName(path: string, content: string): string {
	return frontmatterValue(content, "name") ?? basename(dirname(path));
}

function skillRecord(workingDir: string, path: string): WorkbenchCustomSkill {
	const { content, truncated } = readText(path);
	const relPath = toPosixPath(relative(workingDir, path));
	const name = skillName(path, content);
	const description = frontmatterValue(content, "description") ?? firstMarkdownSentence(content) ?? name;
	const timestamps = fileTimestamps(path);
	return {
		id: stableUuid("feynman-custom-skill", relPath),
		userId: LOCAL_USER_ID,
		name,
		description: truncated ? `${description} Content truncated in state snapshot.` : description,
		content,
		path: relPath,
		source: "project",
		...timestamps,
	};
}

function agentPromptRecord(workingDir: string, path: string): WorkbenchCustomAgentPrompt {
	const { content } = readText(path);
	const relPath = toPosixPath(relative(workingDir, path));
	const agentName = frontmatterValue(content, "name") ?? basename(path, extname(path));
	const timestamps = fileTimestamps(path);
	return {
		id: stableUuid("feynman-custom-agent-prompt", relPath),
		userId: LOCAL_USER_ID,
		agentName,
		promptText: content,
		path: relPath,
		...timestamps,
	};
}

function skillAssignment(skill: WorkbenchCustomSkill): WorkbenchAgentSkillAssignment {
	return {
		id: stableUuid("feynman-agent-skill-assignment", `${skill.id}:${DEFAULT_AGENT_NAME}`),
		skillId: skill.id,
		agentName: DEFAULT_AGENT_NAME,
		userId: LOCAL_USER_ID,
		createdAt: skill.createdAt,
		createdAtMs: skill.createdAtMs,
	};
}

export function buildWorkbenchSkillLedgers(workingDir: string): {
	customSkills: WorkbenchCustomSkill[];
	agentSkillAssignments: WorkbenchAgentSkillAssignment[];
	customAgentPrompts: WorkbenchCustomAgentPrompt[];
} {
	const customSkills = listFiles(resolve(workingDir, "skills"), (name) => name === "SKILL.md")
		.map((path) => skillRecord(workingDir, path))
		.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
	const customAgentPrompts = directMarkdownFiles(resolve(workingDir, ".feynman", "agents"))
		.map((path) => agentPromptRecord(workingDir, path))
		.sort((a, b) => a.agentName.localeCompare(b.agentName) || a.path.localeCompare(b.path));
	return {
		customSkills,
		agentSkillAssignments: customSkills.map(skillAssignment).sort((a, b) => a.skillId.localeCompare(b.skillId)),
		customAgentPrompts,
	};
}
