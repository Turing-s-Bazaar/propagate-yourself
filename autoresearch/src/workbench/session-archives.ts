import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { relative, sep } from "node:path";

import { SessionManager, type SessionEntry } from "@earendil-works/pi-coding-agent";

import type { WorkbenchChatSession } from "./chat.js";
import type { WorkbenchCompactionArchive, WorkbenchFrameBranchArchive, WorkbenchSessionConcurrency } from "./types.js";

const MAX_ARCHIVED_ENTRIES = 120;

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

function timestampMs(value: string | undefined): number {
	if (!value) return 0;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function timestamp(value: string | undefined): { iso: string; ms: number } {
	const ms = timestampMs(value);
	return { iso: new Date(ms).toISOString(), ms };
}

function boundedText(value: string, limit = 700): string {
	const text = value.replace(/\s+/g, " ").trim();
	return text.length <= limit ? text : `${text.slice(0, limit - 1)}...`;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const item of content) {
		const block = recordValue(item);
		if (!block) continue;
		if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
		else if (block.type === "thinking" && typeof block.thinking === "string") parts.push(`Thinking: ${block.thinking}`);
		else if (block.type === "toolCall" && typeof block.name === "string") parts.push(`Tool call: ${block.name}`);
	}
	return parts.join(" ");
}

function archiveEntry(entry: SessionEntry): Record<string, unknown> {
	const base: Record<string, unknown> = {
		id: entry.id,
		type: entry.type,
		parentId: entry.parentId,
		timestamp: entry.timestamp,
	};
	if (entry.type === "message") {
		const message = entry.message as unknown as Record<string, unknown>;
		return {
			...base,
			role: message.role,
			content: boundedText(contentText(message.content)),
			...(typeof message.toolName === "string" ? { toolName: message.toolName } : {}),
			...(typeof message.toolCallId === "string" ? { toolCallId: message.toolCallId } : {}),
			...(message.isError === true ? { isError: true } : {}),
		};
	}
	if (entry.type === "custom_message") {
		return {
			...base,
			customType: entry.customType,
			content: boundedText(contentText(entry.content)),
			display: entry.display,
		};
	}
	if (entry.type === "compaction") {
		return {
			...base,
			firstKeptEntryId: entry.firstKeptEntryId,
			tokensBefore: entry.tokensBefore,
			summary: boundedText(entry.summary),
		};
	}
	if (entry.type === "branch_summary") {
		return {
			...base,
			fromId: entry.fromId,
			summary: boundedText(entry.summary),
		};
	}
	if (entry.type === "model_change") return { ...base, provider: entry.provider, modelId: entry.modelId };
	if (entry.type === "thinking_level_change") return { ...base, thinkingLevel: entry.thinkingLevel };
	if (entry.type === "custom") return { ...base, customType: entry.customType, data: entry.data };
	if (entry.type === "label") return { ...base, targetId: entry.targetId, label: entry.label };
	if (entry.type === "session_info") return { ...base, name: entry.name };
	return base;
}

function messageLike(entry: SessionEntry): boolean {
	return entry.type === "message" || entry.type === "custom_message" || entry.type === "branch_summary";
}

function loadPiSession(session: WorkbenchChatSession): { entries: SessionEntry[]; leafId: string | null; path: string } | undefined {
	const path = session.piSession.path;
	if (!path || !existsSync(path)) return undefined;
	try {
		const manager = SessionManager.open(path);
		return {
			entries: manager.getEntries(),
			leafId: manager.getLeafId(),
			path,
		};
	} catch {
		return undefined;
	}
}

function pathToEntry(entries: SessionEntry[], entryId: string): SessionEntry[] {
	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	const path: SessionEntry[] = [];
	const seen = new Set<string>();
	let current = byId.get(entryId);
	while (current && !seen.has(current.id)) {
		path.push(current);
		seen.add(current.id);
		current = current.parentId ? byId.get(current.parentId) : undefined;
	}
	return path.reverse();
}

function relativePiPath(workingDir: string, path: string): string {
	const rel = relative(workingDir, path);
	return rel && !rel.startsWith("..") ? toPosixPath(rel) : path;
}

function buildCompactionArchiveRows(workingDir: string, session: WorkbenchChatSession): WorkbenchCompactionArchive[] {
	const loaded = loadPiSession(session);
	if (!loaded) return [];
	let compactionIndex = 0;
	return loaded.entries.flatMap((entry) => {
		if (entry.type !== "compaction") return [];
		const entryPath = pathToEntry(loaded.entries, entry.id);
		const archiveEndIndex = entryPath.findIndex((pathEntry) => pathEntry.id === entry.firstKeptEntryId);
		const compactedEntries = (archiveEndIndex >= 0 ? entryPath.slice(0, archiveEndIndex) : entryPath.slice(0, -1))
			.filter(messageLike);
		const created = timestamp(entry.timestamp);
		const row: WorkbenchCompactionArchive = {
			id: stableUuid("feynman-compaction-archive", `${session.id}:${entry.id}`),
			frameId: session.id,
			compactionIndex,
			messageCount: compactedEntries.length,
			tokenCount: Number.isFinite(entry.tokensBefore) ? entry.tokensBefore : undefined,
			summary: entry.summary,
			messages: JSON.stringify(compactedEntries.slice(-MAX_ARCHIVED_ENTRIES).map(archiveEntry)),
			createdAt: created.iso,
			createdAtMs: created.ms,
			piSessionId: session.piSession.id,
			piSessionPath: relativePiPath(workingDir, loaded.path),
			firstKeptEntryId: entry.firstKeptEntryId,
			sourceEntryId: entry.id,
		};
		compactionIndex += 1;
		return [row];
	});
}

function branchLeafIds(entries: SessionEntry[]): string[] {
	const childCounts = new Map<string | null, number>();
	const childIds = new Set<string>();
	for (const entry of entries) {
		childCounts.set(entry.parentId, (childCounts.get(entry.parentId) ?? 0) + 1);
		if (entry.parentId) childIds.add(entry.parentId);
	}
	const hasBranchPoint = [...childCounts.values()].some((count) => count > 1);
	if (!hasBranchPoint) return [];
	return entries.filter((entry) => !childIds.has(entry.id)).map((entry) => entry.id);
}

function buildBranchArchiveRows(workingDir: string, session: WorkbenchChatSession): WorkbenchFrameBranchArchive[] {
	const loaded = loadPiSession(session);
	if (!loaded) return [];
	return branchLeafIds(loaded.entries).map((leafId) => {
		const branchPath = pathToEntry(loaded.entries, leafId);
		const leaf = branchPath.at(-1);
		const updated = timestamp(leaf?.timestamp);
		const payload = {
			source: "feynman-pi-session-tree",
			piSessionId: session.piSession.id,
			piSessionPath: relativePiPath(workingDir, loaded.path),
			leafId,
			active: loaded.leafId === leafId,
			branchPointIds: branchPath.filter((entry) => loaded.entries.filter((candidate) => candidate.parentId === entry.id).length > 1).map((entry) => entry.id),
			entries: branchPath.slice(-MAX_ARCHIVED_ENTRIES).map(archiveEntry),
		};
		return {
			frameId: session.id,
			branchId: leafId,
			payload: JSON.stringify(payload),
			updatedAt: updated.iso,
			updatedAtMs: updated.ms,
		};
	}).sort((a, b) => b.updatedAtMs - a.updatedAtMs || a.branchId.localeCompare(b.branchId));
}

export function buildWorkbenchSessionArchives(workingDir: string, sessions: WorkbenchChatSession[]): {
	sessionConcurrency: WorkbenchSessionConcurrency[];
	compactionArchives: WorkbenchCompactionArchive[];
	frameBranchArchives: WorkbenchFrameBranchArchive[];
} {
	const sessionConcurrency = sessions.map((session) => ({
		rootFrameId: session.id,
		maxConcurrent: 1,
		createdAt: session.createdAt,
		createdAtMs: timestampMs(session.createdAt),
		updatedAt: session.updatedAt,
		updatedAtMs: timestampMs(session.updatedAt),
	}));
	return {
		sessionConcurrency,
		compactionArchives: sessions.flatMap((session) => buildCompactionArchiveRows(workingDir, session))
			.sort((a, b) => b.createdAtMs - a.createdAtMs || a.frameId.localeCompare(b.frameId) || a.compactionIndex - b.compactionIndex),
		frameBranchArchives: sessions.flatMap((session) => buildBranchArchiveRows(workingDir, session)),
	};
}
