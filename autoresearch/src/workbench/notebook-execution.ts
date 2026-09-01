import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

import type { WorkbenchExecutionPurpose, WorkbenchExecutionStatus } from "./types.js";
import {
	captureArtifactSnapshotBaseline,
	recordArtifactSnapshotsForChanges,
} from "./artifact-snapshots.js";
import { dropNotebookKernel, getNotebookKernel, languageSupportsSessionKernel } from "./notebook-kernels.js";
import {
	notebookRuntimeProcessEnv,
	resolvePythonRuntimeCommand,
	resolveRscriptRuntimeCommand,
} from "./notebook-runtimes.js";
import { runModalNotebookCell } from "./modal-execution.js";
import {
	captureWorkbenchEnvironmentSnapshot,
	type WorkbenchEnvironmentSnapshot,
} from "./runtime-context.js";
import { recordComputePendingTerminate } from "./compute-lifecycle.js";
import { migratedWorkbenchDataPath } from "./data-root.js";

export { closeNotebookKernelSessions } from "./notebook-kernels.js";

export type WorkbenchNotebookLanguage = "bash" | "python" | "r";
export type WorkbenchNotebookExecutionMode = "isolated" | "modal" | "session";

export type WorkbenchNotebookExecutionRecord = {
	schema: "feynman.notebookExecution.v1";
	id: string;
	sessionId: string;
	projectId: string;
	title: string;
	runSlug?: string;
	taskSummary?: string;
	language: WorkbenchNotebookLanguage;
	executionMode: WorkbenchNotebookExecutionMode;
	kernelId?: string;
	purpose: WorkbenchExecutionPurpose;
	code: string;
	status: WorkbenchExecutionStatus;
	command: string;
	cwd: string;
	stdout: string;
	stderr: string;
	exitCode?: number;
	signal?: string;
	durationMs: number;
	truncated: boolean;
	inputPaths: string[];
	outputPaths: string[];
	snapshotIds: string[];
	environmentSnapshot?: WorkbenchEnvironmentSnapshot;
	createdAt: string;
	updatedAt: string;
};

export type WorkbenchNotebookActiveExecutionRecord = {
	id: string;
	sessionId: string;
	projectId: string;
	title: string;
	runSlug?: string;
	taskSummary?: string;
	language: WorkbenchNotebookLanguage;
	executionMode: WorkbenchNotebookExecutionMode;
	kernelId?: string;
	purpose: WorkbenchExecutionPurpose;
	code: string;
	status: "queued" | "running";
	command: string;
	cwd: string;
	inputPaths: string[];
	createdAt: string;
	createdAtMs: number;
	updatedAt: string;
	updatedAtMs: number;
	cancellationRequestedAt?: string;
};

type ExecuteNotebookCellOptions = {
	workingDir: string;
	timeoutMs?: number;
	maxOutputChars?: number;
};

type ExecuteNotebookCellInput = {
	sessionId: string;
	projectId: string;
	title: string;
	runSlug?: string;
	taskSummary?: string;
	language?: string;
	executionMode?: string;
	purpose?: string;
	jobId?: string;
	code: string;
};

type ProcessResult = {
	stdout: string;
	stderr: string;
	exitCode?: number;
	signal?: string;
	canceled?: boolean;
	timedOut: boolean;
	truncated: boolean;
	command?: string;
	outputPaths?: string[];
};

const NOTEBOOK_EXECUTION_SCHEMA = "feynman.notebookExecution.v1";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_CHARS = 48_000;
const MAX_CODE_CHARS = 96_000;

type ActiveNotebookExecution = WorkbenchNotebookActiveExecutionRecord & {
	controller: AbortController;
};

function toPosixPath(path: string): string {
	return path.split(sep).join("/");
}

function normalizeId(value: string): string {
	const normalized = value
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
	return normalized || "workbench";
}

function normalizeClientJobId(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed) return undefined;
	const normalized = trimmed
		.replace(/[^A-Za-z0-9._:-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 96);
	return normalized || undefined;
}

function activeNotebookExecutionKey(workingDir: string, id: string): string {
	return `${resolve(workingDir)}\0${id}`;
}

const activeNotebookExecutions = new Map<string, ActiveNotebookExecution>();

export function listActiveNotebookExecutionRecords(workingDir?: string): WorkbenchNotebookActiveExecutionRecord[] {
	const cwd = workingDir ? resolve(workingDir) : undefined;
	return [...activeNotebookExecutions.values()]
		.filter((record) => !cwd || record.cwd === cwd)
		.map(({ controller: _controller, ...record }) => ({ ...record }))
		.sort((a, b) => b.createdAtMs - a.createdAtMs || a.id.localeCompare(b.id));
}

export async function cancelNotebookExecution(
	workingDir: string,
	jobId: string,
): Promise<{ ok: boolean; reason?: string; job?: WorkbenchNotebookActiveExecutionRecord }> {
	const cwd = resolve(workingDir);
	const active = activeNotebookExecutions.get(activeNotebookExecutionKey(cwd, jobId));
	if (!active) return { ok: false, reason: "not_found" };
	if (!active.cancellationRequestedAt) {
		const now = new Date().toISOString();
		active.cancellationRequestedAt = now;
		active.updatedAt = now;
		active.updatedAtMs = Date.now();
		if (active.executionMode === "modal") {
			recordComputePendingTerminate(cwd, { jobId: active.id, provider: "modal" });
		}
		active.controller.abort();
	}
	const { controller: _controller, ...job } = active;
	return { ok: true, job };
}

function executionDir(workingDir: string): string {
	return migratedWorkbenchDataPath(workingDir, "notebook-executions");
}

function executionPath(workingDir: string, sessionId: string): string {
	return resolve(executionDir(workingDir), `${normalizeId(sessionId)}.jsonl`);
}

function normalizeLanguage(value: string | undefined): WorkbenchNotebookLanguage {
	const lower = (value ?? "python").trim().toLowerCase();
	if (lower === "bash" || lower === "sh" || lower === "shell") return "bash";
	if (lower === "r" || lower === "rscript") return "r";
	return "python";
}

function normalizeExecutionMode(value: string | undefined, language: WorkbenchNotebookLanguage): WorkbenchNotebookExecutionMode {
	const lower = (value ?? "").trim().toLowerCase();
	if (lower === "modal" || lower === "cloud") return "modal";
	if (lower === "isolated" || lower === "process") return "isolated";
	if (lower === "session" || lower === "kernel") return languageSupportsSessionKernel(language) ? "session" : "isolated";
	return languageSupportsSessionKernel(language) ? "session" : "isolated";
}

function normalizePurpose(value: string | undefined): WorkbenchExecutionPurpose {
	return value === "verification" || value === "check" ? "verification" : "exploration";
}

function commandForLanguage(language: WorkbenchNotebookLanguage, workingDir: string): { command: string; args: string[]; stdin?: string } {
	if (language === "bash") return { command: "bash", args: ["-lc"] };
	if (language === "r") return { command: resolveRscriptRuntimeCommand().command, args: ["-"], stdin: "code" };
	return { command: resolvePythonRuntimeCommand(workingDir).command, args: ["-"], stdin: "code" };
}

function boundedAppend(current: string, chunk: string, limit: number): { value: string; truncated: boolean } {
	if (!chunk) return { value: current, truncated: false };
	const next = current + chunk;
	if (next.length <= limit) return { value: next, truncated: false };
	return { value: next.slice(0, limit), truncated: true };
}

function killChildProcess(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
	if (process.platform !== "win32" && child.pid) {
		try {
			process.kill(-child.pid, signal);
			return;
		} catch {
			// Fall through to direct child termination.
		}
	}
	child.kill(signal);
}

function runProcess(
	cwd: string,
	language: WorkbenchNotebookLanguage,
	code: string,
	timeoutMs: number,
	maxOutputChars: number,
	signal?: AbortSignal,
): Promise<ProcessResult> {
	return new Promise((resolveProcess) => {
		const command = commandForLanguage(language, cwd);
		const args = language === "bash" ? [...command.args, code] : command.args;
		let stdout = "";
		let stderr = "";
		let truncated = false;
		let settled = false;
		let timedOut = false;
		let canceled = signal?.aborted ?? false;
		let killTimer: NodeJS.Timeout | undefined;
		const child = spawn(command.command, args, {
			cwd,
			detached: process.platform !== "win32",
			env: notebookRuntimeProcessEnv(cwd),
			stdio: ["pipe", "pipe", "pipe"],
		});
		const timer = setTimeout(() => {
			timedOut = true;
			killChildProcess(child, "SIGTERM");
		}, timeoutMs);
		const abortHandler = () => {
			if (settled) return;
			canceled = true;
			killChildProcess(child, "SIGTERM");
			killTimer = setTimeout(() => killChildProcess(child, "SIGKILL"), 1000);
		};
		if (signal) {
			if (signal.aborted) abortHandler();
			else signal.addEventListener("abort", abortHandler, { once: true });
		}
		const cleanup = () => {
			clearTimeout(timer);
			if (killTimer) clearTimeout(killTimer);
			signal?.removeEventListener("abort", abortHandler);
		};

		if (command.stdin === "code") {
			child.stdin.end(code);
		} else {
			child.stdin.end();
		}

		child.stdout.on("data", (chunk: Buffer) => {
			const bounded = boundedAppend(stdout, chunk.toString("utf8"), maxOutputChars);
			stdout = bounded.value;
			truncated ||= bounded.truncated;
		});
		child.stderr.on("data", (chunk: Buffer) => {
			const bounded = boundedAppend(stderr, chunk.toString("utf8"), maxOutputChars);
			stderr = bounded.value;
			truncated ||= bounded.truncated;
		});
		child.on("error", (error) => {
			if (settled) return;
			settled = true;
			cleanup();
			resolveProcess({
				stdout,
				stderr: stderr || error.message,
				canceled,
				timedOut,
				truncated,
			});
		});
		child.on("close", (exitCode, signal) => {
			if (settled) return;
			settled = true;
			cleanup();
			resolveProcess({
				stdout,
				stderr: canceled && !stderr ? "Notebook execution canceled." : stderr,
				...(typeof exitCode === "number" ? { exitCode } : {}),
				...(signal || canceled ? { signal: signal ?? "SIGTERM" } : {}),
				canceled,
				timedOut,
				truncated,
			});
		});
	});
}

function discoverMentionedPaths(workingDir: string, text: string): string[] {
	const workspace = resolve(workingDir);
	const matches = new Set<string>();
	for (const match of text.matchAll(/\b(?:outputs|papers|notes)\/[A-Za-z0-9._/@+-][^\s"'`),;:\\]*/g)) {
		const relPath = match[0].replace(/[.\]]+$/, "");
		const absPath = resolve(workspace, relPath);
		const rel = toPosixPath(relative(workspace, absPath));
		if (!rel || rel.startsWith("../") || rel === ".." || rel.split("/").includes("..")) continue;
		matches.add(rel);
	}
	return [...matches].sort((a, b) => a.localeCompare(b));
}

function statusForProcess(result: ProcessResult): WorkbenchExecutionStatus {
	if (result.canceled) return "stopped";
	if (result.timedOut) return "stopped";
	if (typeof result.exitCode === "number" && result.exitCode !== 0) return "error";
	if (result.signal) return "stopped";
	return "complete";
}

function activeCommandForExecution(
	workingDir: string,
	language: WorkbenchNotebookLanguage,
	executionMode: WorkbenchNotebookExecutionMode,
	code: string,
): string {
	if (executionMode === "session") return `${language} session kernel`;
	if (executionMode === "modal") return `modal notebook job`;
	if (language === "bash") return code.split(/\r?\n/)[0]?.slice(0, 120) || "bash";
	const command = commandForLanguage(language, workingDir);
	return `${command.command} ${command.args.join(" ")}`.trim();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	return value as Record<string, unknown>;
}

function stringValue(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" && value.trim() ? value : undefined;
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeEnvironmentSnapshot(value: unknown): WorkbenchEnvironmentSnapshot | undefined {
	const record = asRecord(value);
	if (!record || record.schema !== "feynman.workbenchEnvironmentSnapshot.v1") return undefined;
	return record as WorkbenchEnvironmentSnapshot;
}

function sortUniquePaths(paths: string[]): string[] {
	return [...new Set(paths)].sort((a, b) => a.localeCompare(b));
}

function numberValue(record: Record<string, unknown>, key: string): number | undefined {
	const value = record[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeStoredRecord(value: unknown): WorkbenchNotebookExecutionRecord | undefined {
	const record = asRecord(value);
	if (!record || record.schema !== NOTEBOOK_EXECUTION_SCHEMA) return undefined;
	const id = stringValue(record, "id");
	const sessionId = stringValue(record, "sessionId");
	const projectId = stringValue(record, "projectId");
	const title = stringValue(record, "title");
	const code = stringValue(record, "code");
	const stdout = typeof record.stdout === "string" ? record.stdout : "";
	const stderr = typeof record.stderr === "string" ? record.stderr : "";
	const createdAt = stringValue(record, "createdAt");
	const updatedAt = stringValue(record, "updatedAt") ?? createdAt;
	if (!id || !sessionId || !projectId || !title || !code || !createdAt || !updatedAt) return undefined;
	const rawStatus = stringValue(record, "status");
	const status: WorkbenchExecutionStatus = rawStatus === "error" || rawStatus === "stopped" || rawStatus === "running" || rawStatus === "queued"
		? rawStatus
		: "complete";
	const language = normalizeLanguage(stringValue(record, "language"));
	const executionMode = normalizeExecutionMode(stringValue(record, "executionMode"), language);
	return {
		schema: NOTEBOOK_EXECUTION_SCHEMA,
		id,
		sessionId,
		projectId,
		title,
		...(stringValue(record, "runSlug") ? { runSlug: stringValue(record, "runSlug") } : {}),
		...(stringValue(record, "taskSummary") ? { taskSummary: stringValue(record, "taskSummary") } : {}),
		language,
		executionMode,
		...(stringValue(record, "kernelId") ? { kernelId: stringValue(record, "kernelId") } : {}),
		purpose: normalizePurpose(stringValue(record, "purpose")),
		code,
		status,
		command: stringValue(record, "command") ?? language,
		cwd: stringValue(record, "cwd") ?? "",
		stdout,
		stderr,
		...(numberValue(record, "exitCode") !== undefined ? { exitCode: numberValue(record, "exitCode") } : {}),
		...(stringValue(record, "signal") ? { signal: stringValue(record, "signal") } : {}),
		durationMs: numberValue(record, "durationMs") ?? 0,
		truncated: record.truncated === true,
		inputPaths: stringArray(record.inputPaths),
		outputPaths: stringArray(record.outputPaths),
		snapshotIds: stringArray(record.snapshotIds),
		...(normalizeEnvironmentSnapshot(record.environmentSnapshot) ? { environmentSnapshot: normalizeEnvironmentSnapshot(record.environmentSnapshot) } : {}),
		createdAt,
		updatedAt,
	};
}

export async function executeNotebookCell(
	options: ExecuteNotebookCellOptions,
	input: ExecuteNotebookCellInput,
): Promise<WorkbenchNotebookExecutionRecord> {
	const workingDir = resolve(options.workingDir);
	const code = input.code.trimEnd();
	if (!code.trim()) throw new Error("Notebook code is required.");
	if (code.length > MAX_CODE_CHARS) throw new Error("Notebook code is too large.");
	const language = normalizeLanguage(input.language);
	const executionMode = normalizeExecutionMode(input.executionMode, language);
	if (executionMode === "modal" && language !== "python") {
		throw new Error("Modal notebook execution currently supports Python cells.");
	}
	const purpose = normalizePurpose(input.purpose);
	const startedAtMs = Date.now();
	const createdAt = new Date(startedAtMs).toISOString();
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
	const inputPaths = discoverMentionedPaths(workingDir, code);
	const baseline = captureArtifactSnapshotBaseline(workingDir, inputPaths);
	const recordId = normalizeClientJobId(input.jobId) ?? randomUUID();
	const abortController = new AbortController();
	const activeRecord: ActiveNotebookExecution = {
		id: recordId,
		sessionId: input.sessionId,
		projectId: input.projectId,
		title: input.title,
		...(input.runSlug ? { runSlug: input.runSlug } : {}),
		...(input.taskSummary ? { taskSummary: input.taskSummary } : {}),
		language,
		executionMode,
		purpose,
		code,
		status: "running",
		command: activeCommandForExecution(workingDir, language, executionMode, code),
		cwd: workingDir,
		inputPaths,
		createdAt,
		createdAtMs: startedAtMs,
		updatedAt: createdAt,
		updatedAtMs: startedAtMs,
		controller: abortController,
	};
	activeNotebookExecutions.set(activeNotebookExecutionKey(workingDir, recordId), activeRecord);
	let kernelId: string | undefined;
	let result: ProcessResult;
	try {
		if (executionMode === "session" && languageSupportsSessionKernel(language)) {
			const kernel = getNotebookKernel(workingDir, input.sessionId, language);
			kernelId = kernel.id;
			activeRecord.kernelId = kernelId;
			activeRecord.command = `${language} session kernel`;
			const abortResult = new Promise<ProcessResult>((resolveAbort) => {
				const abortHandler = () => {
					void kernel.stop().finally(() => dropNotebookKernel(workingDir, input.sessionId, language));
					resolveAbort({
						stdout: "",
						stderr: "Notebook execution canceled.",
						signal: "SIGTERM",
						canceled: true,
						timedOut: false,
						truncated: false,
					});
				};
				if (abortController.signal.aborted) abortHandler();
				else abortController.signal.addEventListener("abort", abortHandler, { once: true });
			});
			result = await Promise.race([
				kernel.run(code, timeoutMs, maxOutputChars),
				abortResult,
			]);
			if (result.timedOut || result.canceled || !kernel.isUsable()) {
				dropNotebookKernel(workingDir, input.sessionId, language);
			}
		} else if (executionMode === "modal") {
			result = await runModalNotebookCell({
				workingDir,
				code,
				jobId: recordId,
				timeoutMs,
				maxOutputChars,
				signal: abortController.signal,
			});
		} else {
			result = await runProcess(workingDir, language, code, timeoutMs, maxOutputChars, abortController.signal);
		}
	} finally {
		activeNotebookExecutions.delete(activeNotebookExecutionKey(workingDir, recordId));
	}
	const finishedAtMs = Date.now();
	const outputText = [code, result.stdout, result.stderr].filter(Boolean).join("\n");
	const mentioned = discoverMentionedPaths(workingDir, outputText);
	const resultOutputPaths = sortUniquePaths(result.outputPaths ?? []);
	const outputPaths = sortUniquePaths([
		...mentioned.filter((path) => existsSync(resolve(workingDir, path))),
		...resultOutputPaths,
	]);
	const snapshotRecords = recordArtifactSnapshotsForChanges(workingDir, baseline, {
		source: "notebook",
		sessionId: input.sessionId,
		...(input.runSlug ? { runSlug: input.runSlug } : {}),
		producerExecutionId: `notebook:${recordId}`,
		producerSourceId: recordId,
		createdAtMs: finishedAtMs,
		paths: sortUniquePaths([...inputPaths, ...mentioned, ...resultOutputPaths]),
	});
	const record: WorkbenchNotebookExecutionRecord = {
		schema: NOTEBOOK_EXECUTION_SCHEMA,
		id: recordId,
		sessionId: input.sessionId,
		projectId: input.projectId,
		title: input.title,
		...(input.runSlug ? { runSlug: input.runSlug } : {}),
		...(input.taskSummary ? { taskSummary: input.taskSummary } : {}),
		language,
		executionMode,
		...(kernelId ? { kernelId } : {}),
		purpose,
		code,
		status: statusForProcess(result),
		command: result.command ?? (executionMode === "session" ? `${language} session kernel` : language === "bash" ? code : `${commandForLanguage(language, workingDir).command} ${commandForLanguage(language, workingDir).args.join(" ")}`.trim()),
		cwd: workingDir,
		stdout: result.stdout,
		stderr: result.stderr,
		...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
		...(result.signal ? { signal: result.signal } : {}),
		durationMs: finishedAtMs - startedAtMs,
		truncated: result.truncated,
		inputPaths,
		outputPaths,
		snapshotIds: snapshotRecords.map((snapshot) => snapshot.id),
		environmentSnapshot: captureWorkbenchEnvironmentSnapshot(workingDir, {
			language,
			executionMode,
			...(kernelId ? { kernelId } : {}),
			command: result.command ?? (executionMode === "session" ? `${language} session kernel` : language === "bash" ? code : `${commandForLanguage(language, workingDir).command} ${commandForLanguage(language, workingDir).args.join(" ")}`.trim()),
		}),
		createdAt,
		updatedAt: new Date(finishedAtMs).toISOString(),
	};
	mkdirSync(executionDir(workingDir), { recursive: true });
	appendFileSync(executionPath(workingDir, input.sessionId), `${JSON.stringify(record)}\n`, "utf8");
	return record;
}

export function readNotebookExecutionRecords(workingDir: string): WorkbenchNotebookExecutionRecord[] {
	const dir = executionDir(resolve(workingDir));
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((name) => name.endsWith(".jsonl"))
		.flatMap((name) => {
			try {
				return readFileSync(resolve(dir, name), "utf8")
					.split("\n")
					.map((line) => line.trim())
					.filter(Boolean)
					.flatMap((line) => {
						try {
							const record = normalizeStoredRecord(JSON.parse(line));
							return record ? [record] : [];
						} catch {
							return [];
						}
					});
			} catch {
				return [];
			}
		});
}
