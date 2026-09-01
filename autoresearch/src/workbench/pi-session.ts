import { statSync } from "node:fs";
import { basename } from "node:path";

import { SessionManager, type SessionEntry } from "@earendil-works/pi-coding-agent";

export type WorkbenchPiSessionStatus = "active" | "missing" | "pending";

export type WorkbenchPiTimelineEntry = {
	id: string;
	type: string;
	parentId?: string;
	timestamp?: string;
	label: string;
	detail: string;
	status?: "complete" | "error" | "running";
};

export type WorkbenchPiToolSummary = {
	name: string;
	count: number;
	errorCount: number;
	lastStatus: "complete" | "error" | "running";
	lastDetail?: string;
};

export type WorkbenchPiSessionInfo = {
	id: string;
	status: WorkbenchPiSessionStatus;
	path?: string;
	fileName?: string;
	cwd?: string;
	createdAt?: string;
	updatedAt?: string;
	leafId?: string;
	messageCount: number;
	userMessages: number;
	assistantMessages: number;
	toolResults: number;
	toolCalls: number;
	bashExecutions: number;
	customMessages: number;
	branchCount: number;
	model?: string;
	thinkingLevel?: string;
	timeline: WorkbenchPiTimelineEntry[];
	tools: WorkbenchPiToolSummary[];
};

type PiSessionLookupOptions = {
	workingDir: string;
	sessionDir?: string;
	piSessionId: string;
};

function normalizePiIdPart(value: string): string {
	const normalized = value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
	return normalized || "session";
}

export function workbenchPiSessionId(workbenchSessionId: string): string {
	const suffix = normalizePiIdPart(workbenchSessionId).slice(0, 96);
	return `feynman-workbench-${suffix}`;
}

export function defaultWorkbenchPiSessionInfo(workbenchSessionId: string): WorkbenchPiSessionInfo {
	return {
		id: workbenchPiSessionId(workbenchSessionId),
		status: "pending",
		messageCount: 0,
		userMessages: 0,
		assistantMessages: 0,
		toolResults: 0,
		toolCalls: 0,
		bashExecutions: 0,
		customMessages: 0,
		branchCount: 0,
		timeline: [],
		tools: [],
	};
}

export function normalizeWorkbenchPiSessionInfo(value: WorkbenchPiSessionInfo | undefined, workbenchSessionId: string): WorkbenchPiSessionInfo {
	const fallback = defaultWorkbenchPiSessionInfo(workbenchSessionId);
	if (!value || typeof value !== "object") return fallback;
	return {
		...fallback,
		...value,
		id: typeof value.id === "string" && value.id.trim() ? normalizePiIdPart(value.id) : fallback.id,
		status: value.status === "active" || value.status === "missing" || value.status === "pending" ? value.status : fallback.status,
		messageCount: Number.isFinite(value.messageCount) ? value.messageCount : fallback.messageCount,
		userMessages: Number.isFinite(value.userMessages) ? value.userMessages : fallback.userMessages,
		assistantMessages: Number.isFinite(value.assistantMessages) ? value.assistantMessages : fallback.assistantMessages,
		toolResults: Number.isFinite(value.toolResults) ? value.toolResults : fallback.toolResults,
		toolCalls: Number.isFinite(value.toolCalls) ? value.toolCalls : fallback.toolCalls,
		bashExecutions: Number.isFinite(value.bashExecutions) ? value.bashExecutions : fallback.bashExecutions,
		customMessages: Number.isFinite(value.customMessages) ? value.customMessages : fallback.customMessages,
		branchCount: Number.isFinite(value.branchCount) ? value.branchCount : fallback.branchCount,
		timeline: normalizeTimeline(value.timeline),
		tools: normalizeToolSummaries(value.tools),
	};
}

function boundedText(value: string, limit = 220): string {
	const text = value.replace(/\s+/g, " ").trim();
	return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function unknownRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function messageContentText(content: unknown): string {
	if (typeof content === "string") return boundedText(content);
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		const record = unknownRecord(block);
		if (!record) continue;
		if (record.type === "text" && typeof record.text === "string") parts.push(record.text);
		else if (record.type === "thinking" && typeof record.thinking === "string") parts.push(`Thinking: ${record.thinking}`);
		else if (record.type === "toolCall" && typeof record.name === "string") parts.push(`Tool call: ${record.name}`);
	}
	return boundedText(parts.join(" "));
}

function toolCallRecords(entry: SessionEntry): Array<{ id?: string; name: string; detail?: string }> {
	if (entry.type !== "message" || entry.message.role !== "assistant" || !Array.isArray(entry.message.content)) return [];
	return entry.message.content.flatMap((block) => {
		const record = unknownRecord(block);
		if (!record || record.type !== "toolCall" || typeof record.name !== "string") return [];
		const args = unknownRecord(record.arguments);
		return [{
			...(typeof record.id === "string" ? { id: record.id } : {}),
			name: record.name,
			...(args ? { detail: boundedText(JSON.stringify(args), 180) } : {}),
		}];
	});
}

function countToolCalls(entry: SessionEntry): number {
	return toolCallRecords(entry).length;
}

function latestAssistantModel(entries: SessionEntry[]): string | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index]!;
		if (entry.type === "model_change") return `${entry.provider}/${entry.modelId}`;
		if (entry.type === "message" && entry.message.role === "assistant") {
			const provider = typeof entry.message.provider === "string" ? entry.message.provider : "";
			const model = typeof entry.message.model === "string" ? entry.message.model : "";
			if (provider || model) return [provider, model].filter(Boolean).join("/");
		}
	}
	return undefined;
}

function latestThinkingLevel(entries: SessionEntry[]): string | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index]!;
		if (entry.type === "thinking_level_change") return entry.thinkingLevel;
	}
	return undefined;
}

function countBranchPoints(entries: SessionEntry[]): number {
	const children = new Map<string, number>();
	for (const entry of entries) {
		if (entry.parentId === null) continue;
		children.set(entry.parentId, (children.get(entry.parentId) ?? 0) + 1);
	}
	return [...children.values()].filter((count) => count > 1).length;
}

function summarizeEntry(entry: SessionEntry): WorkbenchPiTimelineEntry {
	if (entry.type === "message") {
		const message = entry.message as unknown as Record<string, unknown>;
		const role = typeof message.role === "string" ? message.role : "message";
		if (role === "assistant") {
			const calls = toolCallRecords(entry);
			const detail = calls.length
				? calls.map((call) => call.name).join(", ")
				: messageContentText(message.content);
			const stopReason = typeof message.stopReason === "string" ? message.stopReason : undefined;
			return {
				id: entry.id,
				type: entry.type,
				parentId: entry.parentId ?? undefined,
				timestamp: entry.timestamp,
				label: calls.length ? "Assistant tool request" : "Assistant",
				detail: detail || "Assistant turn",
				status: stopReason === "error" || stopReason === "aborted" ? "error" : stopReason === "toolUse" ? "running" : "complete",
			};
		}
		if (role === "toolResult") {
			const toolName = typeof message.toolName === "string" ? message.toolName : "tool";
			return {
				id: entry.id,
				type: entry.type,
				parentId: entry.parentId ?? undefined,
				timestamp: entry.timestamp,
				label: `${toolName} result`,
				detail: messageContentText(message.content) || (message.isError ? "Tool returned an error" : "Tool completed"),
				status: message.isError === true ? "error" : "complete",
			};
		}
		if (role === "bashExecution") {
			return {
				id: entry.id,
				type: entry.type,
				parentId: entry.parentId ?? undefined,
				timestamp: entry.timestamp,
				label: "Bash execution",
				detail: boundedText(String(message.command ?? "shell command")),
				status: message.cancelled === true || typeof message.exitCode === "number" && message.exitCode !== 0 ? "error" : "complete",
			};
		}
		return {
			id: entry.id,
			type: entry.type,
			parentId: entry.parentId ?? undefined,
			timestamp: entry.timestamp,
			label: role === "user" ? "User" : role,
			detail: messageContentText(message.content) || "Message",
			status: "complete",
		};
	}
	if (entry.type === "model_change") {
		return {
			id: entry.id,
			type: entry.type,
			parentId: entry.parentId ?? undefined,
			timestamp: entry.timestamp,
			label: "Model changed",
			detail: `${entry.provider}/${entry.modelId}`,
			status: "complete",
		};
	}
	if (entry.type === "thinking_level_change") {
		return {
			id: entry.id,
			type: entry.type,
			parentId: entry.parentId ?? undefined,
			timestamp: entry.timestamp,
			label: "Thinking level",
			detail: entry.thinkingLevel,
			status: "complete",
		};
	}
	if (entry.type === "compaction") {
		return {
			id: entry.id,
			type: entry.type,
			parentId: entry.parentId ?? undefined,
			timestamp: entry.timestamp,
			label: "Compaction",
			detail: boundedText(entry.summary),
			status: "complete",
		};
	}
	if (entry.type === "branch_summary") {
		return {
			id: entry.id,
			type: entry.type,
			parentId: entry.parentId ?? undefined,
			timestamp: entry.timestamp,
			label: "Branch summary",
			detail: boundedText(entry.summary),
			status: "complete",
		};
	}
	if (entry.type === "custom_message") {
		return {
			id: entry.id,
			type: entry.type,
			parentId: entry.parentId ?? undefined,
			timestamp: entry.timestamp,
			label: `Context: ${entry.customType}`,
			detail: messageContentText(entry.content),
			status: "complete",
		};
	}
	return {
		id: entry.id,
		type: entry.type,
		parentId: entry.parentId ?? undefined,
		timestamp: entry.timestamp,
		label: entry.type,
		detail: entry.type === "custom" ? entry.customType : "Session entry",
		status: "complete",
	};
}

function buildTimeline(manager: SessionManager): WorkbenchPiTimelineEntry[] {
	return manager.getBranch()
		.slice(-18)
		.map(summarizeEntry);
}

function buildToolSummaries(entries: SessionEntry[]): WorkbenchPiToolSummary[] {
	const callsById = new Map<string, string>();
	const summaries = new Map<string, WorkbenchPiToolSummary>();
	const touch = (name: string, patch: Partial<WorkbenchPiToolSummary> = {}) => {
		const existing = summaries.get(name) ?? {
			name,
			count: 0,
			errorCount: 0,
			lastStatus: "running" as const,
		};
		summaries.set(name, { ...existing, ...patch });
		return summaries.get(name)!;
	};
	for (const entry of entries) {
		for (const call of toolCallRecords(entry)) {
			if (call.id) callsById.set(call.id, call.name);
			const summary = touch(call.name);
			summaries.set(call.name, {
				...summary,
				count: summary.count + 1,
				lastStatus: "running",
				...(call.detail ? { lastDetail: call.detail } : {}),
			});
		}
		if (entry.type !== "message" || entry.message.role !== "toolResult") continue;
		const message = entry.message as unknown as Record<string, unknown>;
		const toolCallId = typeof message.toolCallId === "string" ? message.toolCallId : undefined;
		const name = typeof message.toolName === "string" ? message.toolName : toolCallId ? callsById.get(toolCallId) : undefined;
		if (!name) continue;
		const summary = touch(name);
		const isError = message.isError === true;
		summaries.set(name, {
			...summary,
			errorCount: summary.errorCount + (isError ? 1 : 0),
			lastStatus: isError ? "error" : "complete",
			lastDetail: messageContentText(message.content) || summary.lastDetail,
		});
	}
	return [...summaries.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 16);
}

function normalizeTimeline(value: unknown): WorkbenchPiTimelineEntry[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((entry) => {
		const record = unknownRecord(entry);
		if (!record || typeof record.id !== "string" || typeof record.label !== "string" || typeof record.detail !== "string") return [];
		return [{
			id: record.id,
			type: typeof record.type === "string" ? record.type : "entry",
			...(typeof record.parentId === "string" ? { parentId: record.parentId } : {}),
			...(typeof record.timestamp === "string" ? { timestamp: record.timestamp } : {}),
			label: record.label,
			detail: record.detail,
			...(record.status === "complete" || record.status === "error" || record.status === "running" ? { status: record.status } : {}),
		}];
	});
}

function normalizeToolSummaries(value: unknown): WorkbenchPiToolSummary[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((tool) => {
		const record = unknownRecord(tool);
		if (!record || typeof record.name !== "string") return [];
		return [{
			name: record.name,
			count: typeof record.count === "number" && Number.isFinite(record.count) ? record.count : 0,
			errorCount: typeof record.errorCount === "number" && Number.isFinite(record.errorCount) ? record.errorCount : 0,
			lastStatus: record.lastStatus === "error" || record.lastStatus === "running" ? record.lastStatus : "complete",
			...(typeof record.lastDetail === "string" ? { lastDetail: record.lastDetail } : {}),
		}];
	});
}

export async function readWorkbenchPiSessionInfo(options: PiSessionLookupOptions): Promise<WorkbenchPiSessionInfo> {
	const fallback = {
		...defaultWorkbenchPiSessionInfo("session"),
		id: options.piSessionId,
		status: options.sessionDir ? "missing" as const : "pending" as const,
	};
	if (!options.sessionDir) return fallback;

	const sessions = await SessionManager.list(options.workingDir, options.sessionDir);
	const session = sessions.find((item) => item.id === options.piSessionId);
	if (!session) return fallback;

	const manager = SessionManager.open(session.path, options.sessionDir);
	const entries = manager.getEntries();
	const header = manager.getHeader();
	const stats = statSync(session.path);
	const messageEntries = entries.filter((entry) => entry.type === "message");

	return {
		id: session.id,
		status: "active",
		path: session.path,
		fileName: basename(session.path),
		cwd: header?.cwd || session.cwd,
		createdAt: header?.timestamp,
		updatedAt: stats.mtime.toISOString(),
		leafId: manager.getLeafId() ?? undefined,
		messageCount: messageEntries.length,
		userMessages: messageEntries.filter((entry) => entry.message.role === "user").length,
		assistantMessages: messageEntries.filter((entry) => entry.message.role === "assistant").length,
		toolResults: messageEntries.filter((entry) => entry.message.role === "toolResult").length,
		toolCalls: entries.reduce((count, entry) => count + countToolCalls(entry), 0),
		bashExecutions: messageEntries.filter((entry) => entry.message.role === "bashExecution").length,
		customMessages: entries.filter((entry) => entry.type === "custom_message").length,
		branchCount: countBranchPoints(entries),
		model: latestAssistantModel(entries),
		thinkingLevel: latestThinkingLevel(entries),
		timeline: buildTimeline(manager),
		tools: buildToolSummaries(entries),
	};
}
