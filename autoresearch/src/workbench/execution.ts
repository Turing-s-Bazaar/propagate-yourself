import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, extname, resolve } from "node:path";

import { SessionManager, type SessionEntry } from "@earendil-works/pi-coding-agent";

import { readNotebookExecutionRecords, type WorkbenchNotebookExecutionRecord } from "./notebook-execution.js";
import { buildModelEndpointExecutionRecords } from "./model-endpoint-usage.js";
import { migratedWorkbenchDataPath } from "./data-root.js";
import type {
	ArtifactCategory,
	WorkbenchArtifact,
	WorkbenchExecutionKind,
	WorkbenchExecutionMessage,
	WorkbenchExecutionRecord,
	WorkbenchExecutionStatus,
	WorkbenchRun,
} from "./types.js";

const MAX_EXECUTION_RECORDS = 320;
const MAX_EXECUTION_DETAIL_CHARS = 900;

function boundedExecutionText(value: string, limit = MAX_EXECUTION_DETAIL_CHARS): string {
	const text = value.replace(/\s+/g, " ").trim();
	return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function parseTimestamp(value: unknown, fallback: number): { iso: string; ms: number } {
	const ms = typeof value === "string" ? Date.parse(value) : Number.NaN;
	if (Number.isFinite(ms)) return { iso: new Date(ms).toISOString(), ms };
	return { iso: new Date(fallback).toISOString(), ms: fallback };
}

function executionStatusForArtifact(artifact: WorkbenchArtifact): WorkbenchExecutionStatus {
	if (artifact.category === "draft") return "draft";
	if (artifact.category === "plan") return "planned";
	if (artifact.category === "provenance") return "provenance";
	if (artifact.category === "verification") return "verified";
	return "complete";
}

function executionKindForArtifact(artifact: WorkbenchArtifact): WorkbenchExecutionKind {
	if (artifact.category === "plan") return "plan";
	if (artifact.category === "provenance") return "provenance";
	if (artifact.category === "verification") return "verification";
	return "artifact";
}

function normalizeExecutionStatus(value: unknown): WorkbenchExecutionStatus {
	if (
		value === "complete" ||
		value === "draft" ||
		value === "error" ||
		value === "planned" ||
		value === "provenance" ||
		value === "queued" ||
		value === "running" ||
		value === "stopped" ||
		value === "verified"
	) {
		return value;
	}
	return "complete";
}

function languageForArtifact(artifact: WorkbenchArtifact): string {
	if (artifact.extension === ".csv") return "csv";
	if (artifact.extension === ".tsv") return "tsv";
	if (artifact.extension === ".ent" || artifact.extension === ".pdb") return "pdb";
	if (artifact.extension === ".faa" || artifact.extension === ".fa" || artifact.extension === ".fasta" || artifact.extension === ".fna") return "fasta";
	if (artifact.extension === ".json" || artifact.extension === ".jsonl") return "json";
	if (artifact.extension === ".mjs") return "javascript";
	if (artifact.extension === ".pdf") return "pdf";
	if (artifact.extension === ".tex") return "latex";
	if (artifact.extension === ".md") return "markdown";
	return artifact.extension.replace(/^\./, "") || "text";
}

function traceLabelForCategoryName(category: ArtifactCategory): string {
	const labels: Record<ArtifactCategory, string> = {
		data: "Data",
		draft: "Draft",
		note: "Note",
		output: "Output",
		paper: "Source",
		plan: "Plan",
		provenance: "Provenance",
		verification: "Verification",
		visual: "Visual",
	};
	return labels[category];
}

function executionInputCandidates(artifact: WorkbenchArtifact, group: WorkbenchArtifact[]): string[] {
	return group
		.filter((item) =>
			item.path !== artifact.path &&
			item.updatedAtMs <= artifact.updatedAtMs &&
			(item.category === "data" ||
				item.category === "note" ||
				item.category === "paper" ||
				item.category === "plan" ||
				item.category === "output")
		)
		.sort((a, b) => b.updatedAtMs - a.updatedAtMs)
		.slice(0, 5)
		.map((item) => item.path);
}

function sortUniquePaths(paths: string[]): string[] {
	return [...new Set(paths)].sort((a, b) => a.localeCompare(b));
}

function buildArtifactExecutionRecords(artifacts: WorkbenchArtifact[]): WorkbenchExecutionRecord[] {
	const bySlug = new Map<string, WorkbenchArtifact[]>();
	for (const artifact of artifacts) {
		const group = bySlug.get(artifact.slug) ?? [];
		group.push(artifact);
		bySlug.set(artifact.slug, group);
	}
	return artifacts.map((artifact) => {
		const group = bySlug.get(artifact.slug) ?? [];
		const inputs = executionInputCandidates(artifact, group);
		return {
			id: `artifact:${artifact.path}`,
			title: `${traceLabelForCategoryName(artifact.category)} artifact`,
			kind: executionKindForArtifact(artifact),
			status: executionStatusForArtifact(artifact),
			origin: "workspace",
			createdAt: artifact.updatedAt,
			createdAtMs: artifact.updatedAtMs,
			detail: boundedExecutionText(`${artifact.title} was written to ${artifact.path}.`),
			runSlug: artifact.slug,
			language: languageForArtifact(artifact),
			environment: "local workspace",
			sourceId: artifact.path,
			inputPaths: inputs,
			outputPaths: [artifact.path],
		};
	});
}

function artifactMentions(text: string, artifacts: WorkbenchArtifact[]): string[] {
	const haystack = text.toLowerCase();
	if (!haystack) return [];
	return sortUniquePaths(artifacts.flatMap((artifact) => {
		const path = artifact.path.toLowerCase();
		const name = artifact.name.toLowerCase();
		return haystack.includes(path) || haystack.includes(name) ? [artifact.path] : [];
	}));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	return value as Record<string, unknown>;
}

function stringValue(record: Record<string, unknown> | undefined, key: string): string | undefined {
	const value = record?.[key];
	return typeof value === "string" && value.trim() ? value : undefined;
}

function textFromUnknownContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((block) => {
		const record = asRecord(block);
		if (!record) return "";
		if (typeof record.text === "string") return record.text;
		if (typeof record.thinking === "string") return record.thinking;
		if (typeof record.content === "string") return record.content;
		try {
			return JSON.stringify(record);
		} catch {
			return "";
		}
	}).filter(Boolean).join("\n");
}

function prettyStructured(value: unknown, limit = MAX_EXECUTION_DETAIL_CHARS): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value === "string") return boundedExecutionText(value, limit);
	try {
		return boundedExecutionText(JSON.stringify(value, null, 2), limit);
	} catch {
		return undefined;
	}
}

function parseStructuredRecordText(value: string | undefined): Record<string, unknown> | undefined {
	if (!value) return undefined;
	try {
		return asRecord(JSON.parse(value));
	} catch {
		return undefined;
	}
}

function readWorkbenchChatSessionFiles(workingDir: string): Record<string, unknown>[] {
	const dir = migratedWorkbenchDataPath(workingDir, "sessions");
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((name) => name.endsWith(".json"))
		.flatMap((name) => {
			try {
				const record = asRecord(JSON.parse(readFileSync(resolve(dir, name), "utf8")));
				return record ? [record] : [];
			} catch {
				return [];
			}
		});
}

function chatAttachmentPaths(session: Record<string, unknown>): string[] {
	const attachments = Array.isArray(session.attachments) ? session.attachments : [];
	return sortUniquePaths(attachments.flatMap((attachment) => {
		const path = stringValue(asRecord(attachment), "storagePath");
		return path ? [path] : [];
	}));
}

function chatToolEvents(message: Record<string, unknown>): Record<string, unknown>[] {
	return Array.isArray(message.toolEvents)
		? message.toolEvents.flatMap((event) => {
			const record = asRecord(event);
			return record ? [record] : [];
		})
		: [];
}

type PiToolCallRecord = {
	id?: string;
	name: string;
	arguments?: Record<string, unknown>;
};

type PiToolResultRecord = {
	entry: SessionEntry;
	message: Record<string, unknown>;
	text: string;
	details?: string;
	isError: boolean;
};

function piToolCalls(entry: SessionEntry): PiToolCallRecord[] {
	if (entry.type !== "message" || entry.message.role !== "assistant" || !Array.isArray(entry.message.content)) return [];
	return entry.message.content.flatMap((block) => {
		const record = asRecord(block);
		if (!record || record.type !== "toolCall" || typeof record.name !== "string") return [];
		const args = asRecord(record.arguments);
		return [{
			...(typeof record.id === "string" ? { id: record.id } : {}),
			name: record.name,
			...(args ? { arguments: args } : {}),
		}];
	});
}

function codeFromToolInput(toolName: string, args: Record<string, unknown> | undefined): string | undefined {
	if (!args) return undefined;
	const keys = ["code", "source", "script", "command", "query"];
	for (const key of keys) {
		const value = args[key];
		if (typeof value === "string" && value.trim()) {
			if (key === "query" && !/python|rscript|bash|shell|sql|code/i.test(toolName)) continue;
			return value;
		}
	}
	return undefined;
}

function languageFromToolInput(toolName: string, args: Record<string, unknown> | undefined, code: string | undefined): string | undefined {
	const explicit = typeof args?.language === "string" ? args.language.trim() : "";
	if (explicit) return explicit;
	const lowerName = toolName.toLowerCase();
	if (lowerName.includes("python")) return "python";
	if (lowerName.includes("bash") || lowerName.includes("shell")) return "bash";
	if (lowerName.includes("sql")) return "sql";
	if (!code) return undefined;
	if (/^\s*(python|python3)\s/m.test(code) || /\b(import|def|from)\s+[A-Za-z_]/.test(code)) return "python";
	if (/^\s*(Rscript|library\()/m.test(code)) return "r";
	return "text";
}

function toolKind(toolName: string): WorkbenchExecutionKind {
	const lower = toolName.toLowerCase();
	return lower.includes("bash") || lower.includes("shell") ? "bash" : "tool";
}

function notebookExecutionKind(record: WorkbenchNotebookExecutionRecord): WorkbenchExecutionKind {
	if (record.purpose === "verification") return "verification";
	if (record.language === "bash") return "bash";
	if (record.language === "r") return "r";
	return "python";
}

function toolResultsByCallId(entries: SessionEntry[]): Map<string, PiToolResultRecord> {
	const results = new Map<string, PiToolResultRecord>();
	for (const entry of entries) {
		if (entry.type !== "message" || entry.message.role !== "toolResult") continue;
		const message = entry.message as unknown as Record<string, unknown>;
		const toolCallId = stringValue(message, "toolCallId");
		if (!toolCallId) continue;
		const details = prettyStructured(message.details);
		results.set(toolCallId, {
			entry,
			message,
			text: textFromUnknownContent(message.content),
			...(details ? { details } : {}),
			isError: message.isError === true,
		});
	}
	return results;
}

function executionMessage(
	id: string,
	role: WorkbenchExecutionMessage["role"],
	title: string,
	content: string,
	createdAt: string | undefined,
	status: WorkbenchExecutionStatus = "complete",
): WorkbenchExecutionMessage {
	return {
		id,
		role,
		title,
		content: boundedExecutionText(content || title),
		...(createdAt ? { createdAt } : {}),
		status,
	};
}

function buildPiSessionExecutionRecords(
	sessionId: string,
	runSlug: string | undefined,
	piSession: Record<string, unknown> | undefined,
	baseInputPaths: string[],
	artifacts: WorkbenchArtifact[],
	fallbackTime: number,
): WorkbenchExecutionRecord[] {
	const sessionPath = stringValue(piSession, "path");
	if (!sessionPath || !existsSync(sessionPath)) return [];

	let entries: SessionEntry[];
	let cwd = "";
	try {
		const manager = SessionManager.open(sessionPath);
		entries = manager.getEntries();
		cwd = manager.getHeader()?.cwd ?? "";
	} catch {
		return [];
	}

	const records: WorkbenchExecutionRecord[] = [];
	const resultsById = toolResultsByCallId(entries);

	for (const entry of entries) {
		const timestamp = parseTimestamp(entry.timestamp, fallbackTime);
		if (entry.type === "message" && entry.message.role === "bashExecution") {
			const message = entry.message as unknown as Record<string, unknown>;
			const command = stringValue(message, "command") ?? "shell command";
			const output = stringValue(message, "output") ?? "";
			const mentionedOutputs = artifactMentions(`${command}\n${output}`, artifacts);
			records.push({
				id: `pi-session:${sessionId}:${entry.id}`,
				title: "Pi bash execution",
				kind: "bash",
				status: message.cancelled === true || typeof message.exitCode === "number" && message.exitCode !== 0 ? "error" : "complete",
				origin: "pi",
				createdAt: timestamp.iso,
				createdAtMs: timestamp.ms,
				detail: boundedExecutionText(output || command),
				...(runSlug ? { runSlug } : {}),
				sessionId,
				language: "bash",
				environment: cwd ? `Pi shell / ${cwd}` : "Pi shell",
				sourceId: entry.id,
				code: command,
				messages: [
					executionMessage(`${entry.id}:bash`, "tool", "Bash command", command, entry.timestamp, "complete"),
					...(output ? [executionMessage(`${entry.id}:output`, "tool", "Bash output", output, entry.timestamp, message.cancelled === true ? "stopped" : "complete")] : []),
				],
				inputPaths: sortUniquePaths([...baseInputPaths, ...artifactMentions(command, artifacts)]),
				outputPaths: mentionedOutputs,
			});
			continue;
		}

		for (const call of piToolCalls(entry)) {
			const sourceId = call.id ?? `${entry.id}:${call.name}`;
			const argsText = prettyStructured(call.arguments, 1600) ?? "";
			const code = codeFromToolInput(call.name, call.arguments);
			const language = languageFromToolInput(call.name, call.arguments, code);
			const result = call.id ? resultsById.get(call.id) : undefined;
			const resultTimestamp = result ? parseTimestamp(result.entry.timestamp, timestamp.ms).iso : undefined;
			const resultText = result?.text ?? "";
			const detail = boundedExecutionText(resultText || argsText || `${call.name} tool call`);
			const recordText = [call.name, argsText, resultText, result?.details].filter(Boolean).join("\n");
			const inputPaths = sortUniquePaths([...baseInputPaths, ...artifactMentions(argsText, artifacts)]);
			const outputPaths = artifactMentions(recordText, artifacts);
			const messages = [
				executionMessage(`${entry.id}:tool-call`, "assistant", `${call.name} request`, argsText || `${call.name} tool call`, entry.timestamp, "complete"),
				...(result ? [
					executionMessage(
						`${result.entry.id}:tool-result`,
						"tool",
						`${call.name} result`,
						resultText || result.details || "Tool completed",
						resultTimestamp,
						result.isError ? "error" : "complete",
					),
				] : []),
			];
			records.push({
				id: `pi-session:${sessionId}:${sourceId}`,
				title: `Pi tool: ${call.name}`,
				kind: toolKind(call.name),
				status: result ? result.isError ? "error" : "complete" : "running",
				origin: "pi",
				createdAt: timestamp.iso,
				createdAtMs: timestamp.ms,
				detail,
				...(runSlug ? { runSlug } : {}),
				sessionId,
				...(language ? { language } : {}),
				environment: cwd ? `Pi session / ${cwd}` : "Pi session JSONL",
				sourceId,
				...(code ? { code } : {}),
				...(result?.details ? { details: result.details } : {}),
				messages,
				inputPaths,
				outputPaths,
			});
		}
	}

	return records;
}

function buildChatExecutionRecords(
	workingDir: string,
	artifacts: WorkbenchArtifact[],
	runSlugs: Set<string>,
): WorkbenchExecutionRecord[] {
	const sessions = readWorkbenchChatSessionFiles(workingDir);
	const records: WorkbenchExecutionRecord[] = [];
	for (const session of sessions) {
		const sessionId = stringValue(session, "id") ?? "workbench";
		const runSlug = runSlugs.has(sessionId) ? sessionId : undefined;
		const sessionFallbackTime = parseTimestamp(stringValue(session, "updatedAt"), Date.now()).ms;
		const inputPaths = chatAttachmentPaths(session);
		const messages = Array.isArray(session.messages) ? session.messages : [];
		const seenSourceIds = new Set<string>();

		for (const rawMessage of messages) {
			const message = asRecord(rawMessage);
			if (!message) continue;
			const role = stringValue(message, "role") ?? "message";
			const messageId = stringValue(message, "id") ?? `${sessionId}:message:${records.length}`;
			const timestamp = parseTimestamp(stringValue(message, "createdAt"), sessionFallbackTime);
			const content = boundedExecutionText(textFromUnknownContent(message.content));
			const outputPaths = artifactMentions([
				content,
				...chatToolEvents(message).map((event) => [
					stringValue(event, "label") ?? "",
					stringValue(event, "output") ?? "",
				].join(" ")),
			].join(" "), artifacts);
			const status = normalizeExecutionStatus(stringValue(message, "status"));
			const kind: WorkbenchExecutionKind = role === "assistant" ? "assistant" : "message";
			seenSourceIds.add(messageId);
			records.push({
				id: `chat:${sessionId}:${messageId}`,
				title: role === "assistant" ? "Feynman response" : role === "user" ? "User prompt" : `${role} message`,
				kind,
				status,
				origin: "chat",
				createdAt: timestamp.iso,
				createdAtMs: timestamp.ms,
				detail: content || `${role} message in the workbench transcript.`,
				...(runSlug ? { runSlug } : {}),
				sessionId,
				environment: "Feynman Pi RPC",
				sourceId: messageId,
				inputPaths,
				outputPaths,
			});

			for (const event of chatToolEvents(message)) {
				const eventId = stringValue(event, "id") ?? `${messageId}:tool:${records.length}`;
				const label = stringValue(event, "label") ?? "Pi tool";
				const toolName = stringValue(event, "toolName") ?? label;
				const input = stringValue(event, "input");
				const output = stringValue(event, "output") ?? "";
				const details = stringValue(event, "details");
				const inputRecord = parseStructuredRecordText(input);
				const code = codeFromToolInput(toolName, inputRecord);
				const language = languageFromToolInput(toolName, inputRecord, code);
				const eventText = [label, input, output, details].filter(Boolean).join("\n");
				seenSourceIds.add(eventId);
				records.push({
					id: `tool:${sessionId}:${eventId}`,
					title: `Pi tool: ${label}`,
					kind: toolKind(toolName),
					status: normalizeExecutionStatus(stringValue(event, "status")),
					origin: "pi",
					createdAt: timestamp.iso,
					createdAtMs: timestamp.ms,
					detail: boundedExecutionText(output || input || label),
					...(runSlug ? { runSlug } : {}),
					sessionId,
					...(language ? { language } : {}),
					environment: "Pi agent session",
					sourceId: eventId,
					...(code ? { code } : {}),
					...(details ? { details } : {}),
					messages: [
						...(input ? [executionMessage(`${eventId}:input`, "assistant", `${label} input`, input, timestamp.iso, "complete")] : []),
						...(output || details ? [executionMessage(
							`${eventId}:output`,
							"tool",
							`${label} result`,
							output || details || "Tool completed",
							timestamp.iso,
							event.isError === true ? "error" : normalizeExecutionStatus(stringValue(event, "status")),
						)] : []),
					],
					inputPaths: sortUniquePaths([...inputPaths, ...artifactMentions(input ?? "", artifacts)]),
					outputPaths: artifactMentions(eventText, artifacts),
				});
			}
		}

		const piSession = asRecord(session.piSession);
		const directPiRecords = buildPiSessionExecutionRecords(sessionId, runSlug, piSession, inputPaths, artifacts, sessionFallbackTime);
		records.push(...directPiRecords);
		if (directPiRecords.length) continue;

		const timeline = Array.isArray(piSession?.timeline) ? piSession.timeline : [];
		for (const rawEntry of timeline) {
			const entry = asRecord(rawEntry);
			if (!entry) continue;
			const sourceId = stringValue(entry, "id") ?? `${sessionId}:pi:${records.length}`;
			if (seenSourceIds.has(sourceId)) continue;
			const timestamp = parseTimestamp(stringValue(entry, "timestamp"), sessionFallbackTime);
			const label = stringValue(entry, "label") ?? "Pi session entry";
			const detail = stringValue(entry, "detail") ?? "";
			const lowerLabel = label.toLowerCase();
			const kind: WorkbenchExecutionKind = lowerLabel.includes("tool") || lowerLabel.includes("result")
				? "tool"
				: lowerLabel.includes("bash")
					? "bash"
					: "message";
			records.push({
				id: `pi:${sessionId}:${sourceId}`,
				title: label,
				kind,
				status: normalizeExecutionStatus(stringValue(entry, "status")),
				origin: "pi",
				createdAt: timestamp.iso,
				createdAtMs: timestamp.ms,
				detail: boundedExecutionText(detail || label),
				...(runSlug ? { runSlug } : {}),
				sessionId,
				environment: "Pi session JSONL",
				sourceId,
				inputPaths,
				outputPaths: artifactMentions(`${label}\n${detail}`, artifacts),
			});
		}
	}
	return records;
}

function buildNotebookExecutionRecords(
	workingDir: string,
	artifacts: WorkbenchArtifact[],
	runSlugs: Set<string>,
): WorkbenchExecutionRecord[] {
	return readNotebookExecutionRecords(workingDir).map((record) => {
		const output = [record.stdout, record.stderr].filter(Boolean).join("\n\n");
		const createdAtMs = Date.parse(record.createdAt);
		const runSlug = record.runSlug && runSlugs.has(record.runSlug) ? record.runSlug : undefined;
		const outputPaths = sortUniquePaths(record.outputPaths);
		const detailBits = [
			record.status === "complete" ? "completed" : record.status,
			`exit ${record.exitCode ?? record.signal ?? "unknown"}`,
			`${record.durationMs}ms`,
		];
		return {
			id: `notebook:${record.id}`,
			title: record.purpose === "verification" ? `Verification check: ${record.title}` : `Notebook cell: ${record.title}`,
			kind: notebookExecutionKind(record),
			status: record.purpose === "verification" && record.status === "complete" ? "verified" : record.status,
			origin: "workspace",
			createdAt: record.createdAt,
			createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : Date.now(),
			detail: boundedExecutionText(output || detailBits.join(" / ")),
			purpose: record.purpose,
			...(runSlug ? { runSlug } : {}),
			sessionId: record.sessionId,
			language: record.language,
			environment: `Feynman notebook ${record.executionMode === "session" ? "session kernel" : record.executionMode === "modal" ? "Modal cloud" : "isolated process"} / ${record.cwd || "local workspace"}`,
			sourceId: record.id,
			code: record.code,
			details: boundedExecutionText(JSON.stringify({
				command: record.command,
				executionMode: record.executionMode,
				kernelId: record.kernelId,
				durationMs: record.durationMs,
				exitCode: record.exitCode,
				signal: record.signal,
				truncated: record.truncated,
				purpose: record.purpose,
				environmentSnapshot: record.environmentSnapshot,
			}, null, 2)),
			messages: [
				executionMessage(`${record.id}:code`, "user", `${record.language} cell`, record.code, record.createdAt, "complete"),
				...(record.stdout ? [executionMessage(`${record.id}:stdout`, "tool", "stdout", record.stdout, record.updatedAt, record.status)] : []),
				...(record.stderr ? [executionMessage(`${record.id}:stderr`, "tool", "stderr", record.stderr, record.updatedAt, record.status)] : []),
			],
			inputPaths: sortUniquePaths(record.inputPaths),
			outputPaths,
		};
	});
}

export function buildExecutionRecords(
	workingDir: string,
	artifacts: WorkbenchArtifact[],
	runs: WorkbenchRun[],
): WorkbenchExecutionRecord[] {
	const runSlugs = new Set(runs.map((run) => run.slug));
	return [
		...buildNotebookExecutionRecords(workingDir, artifacts, runSlugs),
		...buildModelEndpointExecutionRecords(workingDir, runSlugs),
		...buildChatExecutionRecords(workingDir, artifacts, runSlugs),
		...buildArtifactExecutionRecords(artifacts),
	].sort((a, b) => b.createdAtMs - a.createdAtMs || a.id.localeCompare(b.id)).slice(0, MAX_EXECUTION_RECORDS);
}
