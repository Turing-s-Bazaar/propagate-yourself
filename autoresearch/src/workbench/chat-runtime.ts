import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";

import {
	buildPiArgs,
	buildPiEnv,
	ensureFeynmanCommandShim,
	resolvePiPaths,
	toNodeImportSpecifier,
	type PiRuntimeOptions,
} from "../pi/runtime.js";
import { patchPiRuntimeNodeModules } from "../pi/runtime-patches.js";
import { resolveAllExecutables } from "../system/executables.js";
import { ensureSupportedNodeVersion } from "../system/node-version.js";
import type {
	WorkbenchAttachment,
	WorkbenchChatStatus,
	WorkbenchPromptRequest,
	WorkbenchPromptResult,
	WorkbenchToolEvent,
} from "./chat.js";
import { readWorkbenchArtifactAnnotations } from "./annotations.js";
import { readWorkbenchTranscriptAnnotations } from "./transcript-annotations.js";
import type { WorkbenchArtifactAnnotation, WorkbenchTranscriptAnnotation } from "./types.js";
import type { WorkbenchPiCommand } from "./types.js";
import { normalizePiCommands } from "./pi-commands.js";
import { readNotebookExecutionRecords, type WorkbenchNotebookExecutionRecord } from "./notebook-execution.js";
import { findWorkbenchProject } from "./projects.js";
import { formatWorkbenchRuntimeContextForPrompt } from "./runtime-context.js";
import { buildWorkbenchState, readWorkbenchFile } from "./scan.js";

export type WorkbenchPromptStreamUpdate = {
	content?: string;
	status?: WorkbenchChatStatus;
	toolEvents?: WorkbenchToolEvent[];
};

type PiWorkbenchPromptStreamUpdate = WorkbenchPromptStreamUpdate & {
	contentDelta?: string;
};

type ChildMode = "rpc";

type WorkbenchPiChild = ReturnType<typeof spawn>;

type RpcResponse = {
	command?: string;
	data?: unknown;
	error?: string;
	id?: string;
	success?: boolean;
	type?: string;
};

type PendingRpcRequest = {
	reject: (error: Error) => void;
	resolve: (response: RpcResponse) => void;
	timeout: NodeJS.Timeout;
};

type ActiveRpcRun = {
	content: string;
	onUpdate: (update: WorkbenchPromptStreamUpdate) => void | Promise<void>;
	pendingUpdates: Array<Promise<void>>;
	reject: (error: Error) => void;
	resolve: () => void;
	status: WorkbenchChatStatus;
	timeout: NodeJS.Timeout;
	toolEvents: Map<string, WorkbenchToolEvent>;
};

function formatAttachmentForPrompt(attachment: WorkbenchAttachment): string[] {
	const lines = [
		`- ${attachment.name} (${attachment.contentType}, ${attachment.sizeBytes} bytes)`,
		`  Local path: ${attachment.storagePath}`,
	];
	if (attachment.previewText) {
		lines.push("  Excerpt:");
		lines.push(...attachment.previewText.split("\n").slice(0, 80).map((line) => `    ${line}`));
		if (attachment.truncated) lines.push("    [attachment preview truncated]");
	} else {
		lines.push("  Preview unavailable in the app; inspect the local path when this file matters.");
	}
	return lines;
}

function isRawPiInput(message: string): boolean {
	const trimmed = message.trimStart();
	return trimmed.startsWith("/") || trimmed.startsWith("!");
}

function boundedPromptText(value: string, limit = 3_000): string {
	if (value.length <= limit) return value;
	return `${value.slice(0, limit)}\n[notebook context truncated]`;
}

function formatPercent(value: number): string {
	return `${Number.isInteger(value) ? value : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

function formatNotebookExecutionForPrompt(record: WorkbenchNotebookExecutionRecord, index: number): string[] {
	const output = [record.stdout, record.stderr].filter(Boolean).join("\n").trim();
	const paths = [...record.inputPaths.map((path) => `read:${path}`), ...record.outputPaths.map((path) => `wrote:${path}`)];
	const lines = [
		`- Cell ${index + 1}: ${record.title} (${record.language}, ${record.purpose}, ${record.status})`,
		`  Runtime: ${record.executionMode}${record.kernelId ? ` / ${record.kernelId}` : ""}`,
		`  Command: ${record.command}`,
	];
	if (paths.length) lines.push(`  Artifact paths: ${paths.slice(0, 12).join(", ")}`);
	if (record.snapshotIds.length) lines.push(`  Artifact snapshots: ${record.snapshotIds.slice(0, 8).join(", ")}`);
	lines.push("  Code:");
	lines.push(...boundedPromptText(record.code, 2_000).split("\n").map((line) => `    ${line}`));
	if (output) {
		lines.push("  Output:");
		lines.push(...boundedPromptText(output, 4_000).split("\n").map((line) => `    ${line}`));
	}
	if (record.truncated) lines.push("  Output was truncated by the workbench.");
	return lines;
}

function recentNotebookContextForPrompt(request: WorkbenchPromptRequest): string[] {
	let records: WorkbenchNotebookExecutionRecord[] = [];
	try {
		records = readNotebookExecutionRecords(request.workingDir)
			.filter((record) => record.sessionId === request.session.id)
			.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id))
			.slice(-4);
	} catch {
		return [];
	}
	if (!records.length) return [];
	return [
		"Recent notebook cells from this session:",
		...records.flatMap(formatNotebookExecutionForPrompt),
		"",
		"Use these notebook cells as live session context when answering the user. Do not rerun them unless the user asks or verification needs it.",
	];
}

function formatAnnotation(annotation: WorkbenchArtifactAnnotation): string[] {
	const lines = [
		`- ${annotation.artifactPath} #${annotation.labelIndex} (${annotation.kind})`,
	];
	if (annotation.anchorKind) lines.push(`  Anchor type: ${annotation.anchorKind}`);
	if (annotation.anchorText) lines.push(`  Anchor: ${boundedPromptText(annotation.anchorText, 800)}`);
	if (annotation.pageNumber) lines.push(`  Page: ${annotation.pageNumber}`);
	if (annotation.startLine || annotation.endLine) {
		lines.push(`  Lines: ${[annotation.startLine, annotation.endLine].filter(Boolean).join("-")}`);
	}
	if (annotation.selectionPrefix) lines.push(`  Selection prefix: ${boundedPromptText(annotation.selectionPrefix, 400)}`);
	if (annotation.xPercent !== undefined && annotation.yPercent !== undefined) {
		const geometry = annotation.widthPercent !== undefined && annotation.heightPercent !== undefined
			? `x=${formatPercent(annotation.xPercent)}, y=${formatPercent(annotation.yPercent)}, width=${formatPercent(annotation.widthPercent)}, height=${formatPercent(annotation.heightPercent)}`
			: `x=${formatPercent(annotation.xPercent)}, y=${formatPercent(annotation.yPercent)}`;
		lines.push(`  Coordinates: ${geometry}`);
	}
	if (annotation.rects?.length) {
		const rects = annotation.rects.slice(0, 8).map((rect) =>
			`x=${formatPercent(rect.xPercent)}, y=${formatPercent(rect.yPercent)}, width=${formatPercent(rect.widthPercent)}, height=${formatPercent(rect.heightPercent)}`
		);
		lines.push(`  Rectangles: ${rects.join("; ")}${annotation.rects.length > rects.length ? " ..." : ""}`);
	}
	lines.push(`  Note: ${boundedPromptText(annotation.body, 1_200)}`);
	if (annotation.runSlug || annotation.sessionId || annotation.projectId) {
		lines.push(`  Scope: ${[annotation.projectId, annotation.runSlug, annotation.sessionId].filter(Boolean).join(" / ")}`);
	}
	return lines;
}

function artifactAnnotationContextForPrompt(request: WorkbenchPromptRequest): string[] {
	let annotations: WorkbenchArtifactAnnotation[] = [];
	try {
		annotations = readWorkbenchArtifactAnnotations(request.workingDir);
	} catch {
		return [];
	}
	if (!annotations.length) return [];
	const message = request.message.toLowerCase();
	const matching = annotations
		.map((annotation) => ({
			annotation,
			score:
				(message.includes(annotation.artifactPath.toLowerCase()) ? 4 : 0) +
				(annotation.sessionId === request.session.id ? 3 : 0) +
				(annotation.runSlug === request.session.id ? 2 : 0) +
				(annotation.projectId === request.session.projectId ? 1 : 0),
		}))
		.filter((item) => item.score > 0);
	const selected = (matching.length ? matching : annotations.map((annotation) => ({ annotation, score: 0 })))
		.sort((a, b) => b.score - a.score || b.annotation.updatedAtMs - a.annotation.updatedAtMs || a.annotation.id.localeCompare(b.annotation.id))
		.slice(0, 12)
		.map((item) => item.annotation);
	if (!selected.length) return [];
	return [
		"Artifact annotations and requested refinements:",
		...selected.flatMap(formatAnnotation),
		"",
		"Use these annotations as actionable local artifact feedback. Preserve provenance, cite changed files, and update or create artifacts under outputs/, papers/, or notes/.",
	];
}

function formatTranscriptAnnotation(annotation: WorkbenchTranscriptAnnotation): string[] {
	const lines = [
		`- Message ${annotation.messageIndex + 1} block ${annotation.blockIndex + 1} (${annotation.source}, ${annotation.kind})`,
		`  Anchor: ${boundedPromptText(annotation.anchorText, 800)}`,
	];
	if (annotation.toolName) lines.push(`  Tool: ${annotation.toolName}`);
	if (annotation.startOffset !== undefined || annotation.endOffset !== undefined) {
		lines.push(`  Offsets: ${[annotation.startOffset, annotation.endOffset].filter((value) => value !== undefined).join("-")}`);
	}
	if (annotation.note) lines.push(`  Note: ${boundedPromptText(annotation.note, 1_200)}`);
	lines.push(`  Scope: ${[annotation.projectId, annotation.runSlug, annotation.rootFrameId].filter(Boolean).join(" / ")}`);
	return lines;
}

function transcriptAnnotationContextForPrompt(request: WorkbenchPromptRequest): string[] {
	let annotations: WorkbenchTranscriptAnnotation[] = [];
	try {
		annotations = readWorkbenchTranscriptAnnotations(request.workingDir);
	} catch {
		return [];
	}
	const selected = annotations
		.filter((annotation) =>
			annotation.rootFrameId === request.session.id ||
			annotation.runSlug === request.session.id ||
			annotation.projectId === request.session.projectId
		)
		.sort((a, b) => b.updatedAtMs - a.updatedAtMs || a.messageIndex - b.messageIndex || a.id.localeCompare(b.id))
		.slice(0, 12);
	if (!selected.length) return [];
	return [
		"Transcript bookmarks and notes:",
		...selected.flatMap(formatTranscriptAnnotation),
		"",
		"Use these transcript bookmarks as session-local research context. Connect them back to artifacts, source checks, or follow-up experiments when relevant.",
	];
}

function projectContextForPrompt(request: WorkbenchPromptRequest): string[] {
	const project = findWorkbenchProject(request.workingDir, request.session.projectId);
	if (!project) return [];
	const lines = [
		"Project context:",
		`- Name: ${project.name}`,
		project.agentContext ? "Agent context:\n" + project.agentContext : "",
	].filter(Boolean);
	return lines.length > 1 ? lines : [];
}

function viewportContextForPrompt(request: WorkbenchPromptRequest): string[] {
	const context = request.viewportContext;
	if (!context) return [];
	const state = buildWorkbenchState({ workingDir: request.workingDir });
	const artifacts = new Map(state.artifacts.map((artifact) => [artifact.path, artifact]));
	const paths = [...new Set([context.activePath, ...(context.openPaths || [])].filter((path): path is string => Boolean(path)))];
	const knownPaths = paths.filter((path) => artifacts.has(path)).slice(0, 8);
	if (!knownPaths.length && !context.previewTab && !context.rightTab) return [];
	const active = context.activePath ? artifacts.get(context.activePath) : undefined;
	const lines = [
		"Active preview context:",
		`- Right pane: ${context.rightTab || "unknown"}`,
		`- Preview tab: ${context.previewTab || "content"}`,
		active ? `- Active artifact: ${active.path} | ${active.category} | ${active.contentType} | ${active.title}` : "",
		knownPaths.length ? `- Open artifact tabs: ${knownPaths.join(", ")}` : "",
	].filter(Boolean);
	for (const path of knownPaths.slice(0, 3)) {
		const artifact = artifacts.get(path);
		if (!artifact) continue;
		lines.push("");
		lines.push(`Artifact visible in preview: ${artifact.path}`);
		lines.push(`- Title: ${artifact.title}`);
		lines.push(`- Type: ${artifact.category} / ${artifact.contentType}`);
		try {
			const preview = readWorkbenchFile(request.workingDir, path);
			lines.push("Preview text:");
			lines.push(boundedText(preview.content, 4_000));
			if (preview.truncated) lines.push("[active preview text truncated]");
		} catch {
			lines.push("Preview text unavailable for this artifact type; use the path and artifact metadata as context.");
		}
	}
	return lines;
}

export function buildWorkbenchRpcPrompt(request: WorkbenchPromptRequest): string {
	if (isRawPiInput(request.message)) return request.message;

	const attachments = request.session.attachments.flatMap(formatAttachmentForPrompt);
	const config = request.session.config;
	const notebookContext = recentNotebookContextForPrompt(request);
	const annotationContext = artifactAnnotationContextForPrompt(request);
	const transcriptAnnotationContext = transcriptAnnotationContextForPrompt(request);
	const projectContext = projectContextForPrompt(request);
	const viewportContext = viewportContextForPrompt(request);
	const runtimeContext = formatWorkbenchRuntimeContextForPrompt(request.workingDir, config);
	return [
		"Workbench context for this message:",
		`- Workspace: ${request.workingDir}`,
		`- Project: ${request.session.projectId}`,
		`- Session: ${request.session.title}`,
		`- Delegation: ${config.delegation ? "enabled" : "disabled"}`,
		`- Auto-review: ${config.autoReview ? "enabled" : "disabled"}`,
		`- Memory context: ${config.memory ? "enabled" : "disabled"}`,
		`- Specialist: ${config.specialist}`,
		`- Compute: ${config.compute === "local" ? "local workspace available" : "disabled"}`,
		`- Model: ${config.model ? config.model : "auto"}`,
		"",
		...projectContext,
		"",
		...viewportContext,
		"",
		attachments.length ? "Session attachments:" : "",
		...attachments,
		"",
		...runtimeContext,
		"",
		...annotationContext,
		"",
		...transcriptAnnotationContext,
		"",
		...notebookContext,
		"User message:",
		request.message,
	].filter((line) => line !== "").join("\n");
}

function stripAnsi(value: string): string {
	return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

function ensureRuntimeReady(request: WorkbenchPromptRequest) {
	if (!request.appRoot || !request.sessionDir || !request.feynmanAgentDir) {
		throw new Error("Workbench chat is not connected to the Feynman runtime. Start it with `feynman serve`.");
	}

	ensureSupportedNodeVersion();
	patchPiRuntimeNodeModules(request.appRoot, request.feynmanAgentDir);
	const paths = resolvePiPaths(request.appRoot);
	const useBuiltWrapper = existsSync(paths.piCliWrapperPath);
	const useBuiltPolyfill = existsSync(paths.promisePolyfillPath);
	const useDevWrapper = !useBuiltWrapper && existsSync(paths.piCliWrapperSourcePath) && existsSync(paths.tsxLoaderPath);
	const useDevPolyfill = !useBuiltPolyfill && existsSync(paths.promisePolyfillSourcePath) && existsSync(paths.tsxLoaderPath);
	const wrapperPath = useBuiltWrapper ? paths.piCliWrapperPath : paths.piCliWrapperSourcePath;
	if (!existsSync(paths.piMainPath) || (!useBuiltWrapper && !useDevWrapper) || (!useBuiltPolyfill && !useDevPolyfill)) {
		throw new Error("Feynman Pi runtime files are missing. Run `npm run build` and try again.");
	}
	return { paths, useDevPolyfill, wrapperPath };
}

async function spawnWorkbenchPi(request: WorkbenchPromptRequest, mode: ChildMode): Promise<WorkbenchPiChild> {
	const { paths, useDevPolyfill, wrapperPath } = ensureRuntimeReady(request);
	const runtimeOptions: PiRuntimeOptions = {
		appRoot: request.appRoot!,
		workingDir: request.workingDir,
		sessionDir: request.sessionDir!,
		feynmanAgentDir: request.feynmanAgentDir!,
		feynmanVersion: request.feynmanVersion,
		sessionId: request.session.piSession.id,
		mode,
		explicitModelSpec: request.session.config.model || undefined,
	};
	const importArgs = useDevPolyfill
		? ["--import", toNodeImportSpecifier(paths.tsxLoaderPath), "--import", toNodeImportSpecifier(paths.promisePolyfillSourcePath)]
		: ["--import", toNodeImportSpecifier(paths.promisePolyfillPath)];
	const executables = await resolveAllExecutables();
	ensureFeynmanCommandShim(request.appRoot!, request.feynmanAgentDir!);

	return spawn(process.execPath, [
		...importArgs,
		wrapperPath,
		paths.piMainPath,
		...buildPiArgs(runtimeOptions, paths),
	], {
		cwd: request.workingDir,
		stdio: ["pipe", "pipe", "pipe"],
		env: buildPiEnv(runtimeOptions, paths, executables),
	});
}

export function attachStrictJsonlLineReader(stream: NodeJS.ReadableStream, onLine: (line: string) => void): () => void {
	const decoder = new StringDecoder("utf8");
	let buffer = "";
	const emitLine = (line: string) => {
		onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
	};
	const onData = (chunk: Buffer | string) => {
		buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
		let newline = buffer.indexOf("\n");
		while (newline !== -1) {
			emitLine(buffer.slice(0, newline));
			buffer = buffer.slice(newline + 1);
			newline = buffer.indexOf("\n");
		}
	};
	const onEnd = () => {
		buffer += decoder.end();
		if (buffer) {
			emitLine(buffer);
			buffer = "";
		}
	};
	stream.on("data", onData);
	stream.on("end", onEnd);
	return () => {
		stream.off("data", onData);
		stream.off("end", onEnd);
	};
}

function serializeRpcLine(value: unknown): string {
	return `${JSON.stringify(value)}\n`;
}

function rpcTimeoutMs(): number {
	return Number(process.env.FEYNMAN_WORKBENCH_TIMEOUT_MS ?? "480000");
}

function rpcCommandTimeoutMs(): number {
	return Number(process.env.FEYNMAN_WORKBENCH_RPC_COMMAND_TIMEOUT_MS ?? "30000");
}

function rpcClientKey(request: WorkbenchPromptRequest): string {
	return [
		request.appRoot ?? "",
		request.workingDir,
		request.sessionDir ?? "",
		request.feynmanAgentDir ?? "",
		request.session.piSession.id,
	].join("\0");
}

class WorkbenchPiRpcClient {
	private activeRun?: ActiveRpcRun;
	private child?: WorkbenchPiChild;
	private exitError?: Error;
	private pendingRequests = new Map<string, PendingRpcRequest>();
	private requestId = 0;
	private runQueue: Promise<unknown> = Promise.resolve();
	private stderr = "";
	private stopReadingStdout?: () => void;

	isUsable(): boolean {
		return Boolean(this.child && !this.exitError && this.child.exitCode === null);
	}

	async stop(): Promise<void> {
		const child = this.child;
		if (!child) return;
		this.stopReadingStdout?.();
		this.stopReadingStdout = undefined;
		child.kill("SIGTERM");
		await new Promise<void>((resolve) => {
			const timeout = setTimeout(() => {
				child.kill("SIGKILL");
				resolve();
			}, 1000);
			child.once("exit", () => {
				clearTimeout(timeout);
				resolve();
			});
		});
		this.child = undefined;
		this.pendingRequests.clear();
	}

	async promptAndStream(
		request: WorkbenchPromptRequest,
		onUpdate: (update: WorkbenchPromptStreamUpdate) => void | Promise<void>,
	): Promise<WorkbenchPromptResult> {
		await this.ensureStarted(request);
		const run = () => this.runPrompt(request, onUpdate);
		const queued = this.runQueue.then(run, run);
		this.runQueue = queued.catch(() => undefined);
		return queued;
	}

	hasActiveRun(): boolean {
		return Boolean(this.activeRun);
	}

	async steer(request: WorkbenchPromptRequest): Promise<void> {
		if (!this.activeRun) {
			throw new Error("No active Feynman Pi turn is running.");
		}
		const response = await this.send({
			type: "steer",
			message: buildWorkbenchRpcPrompt(request),
		});
		if (response.success === false) {
			throw new Error(response.error || "Feynman Pi RPC steering message was rejected.");
		}
	}

	async abortActiveRun(): Promise<void> {
		if (!this.activeRun) {
			throw new Error("No active Feynman Pi turn is running.");
		}
		const response = await this.send({ type: "abort" });
		if (response.success === false) {
			throw new Error(response.error || "Feynman Pi RPC abort was rejected.");
		}
	}

	async listCommands(request: WorkbenchPromptRequest): Promise<WorkbenchPiCommand[]> {
		await this.ensureStarted(request);
		const response = await this.send({ type: "get_commands" });
		if (response.success === false) {
			throw new Error(response.error || "Feynman Pi RPC command discovery failed.");
		}
		return normalizePiCommands(response.data);
	}

	private async ensureStarted(request: WorkbenchPromptRequest): Promise<void> {
		if (this.isUsable()) return;
		this.exitError = undefined;
		this.stderr = "";
		const child = await spawnWorkbenchPi(request, "rpc");
		if (!child.stdin || !child.stdout || !child.stderr) {
			throw new Error("Feynman Pi RPC session did not expose stdio pipes.");
		}
		const stdout = child.stdout;
		const stderr = child.stderr;
		this.child = child;
		stdout.setEncoding("utf8");
		stderr.setEncoding("utf8");
		stderr.on("data", (chunk) => {
			this.stderr += String(chunk);
		});
		child.once("exit", (code, signal) => {
			if (this.child !== child) return;
			const error = new Error(`Feynman Pi RPC session exited (code=${code} signal=${signal}).${this.stderr ? ` ${stripAnsi(this.stderr).trim()}` : ""}`);
			this.exitError = error;
			this.rejectPending(error);
			this.activeRun?.reject(error);
		});
		child.once("error", (error) => {
			if (this.child !== child) return;
			const wrapped = new Error(`Feynman Pi RPC session failed: ${error.message}.${this.stderr ? ` ${stripAnsi(this.stderr).trim()}` : ""}`);
			this.exitError = wrapped;
			this.rejectPending(wrapped);
			this.activeRun?.reject(wrapped);
		});
		this.stopReadingStdout = attachStrictJsonlLineReader(stdout, (line) => {
			this.handleLine(line);
		});
		await new Promise((resolve) => setTimeout(resolve, 100));
		if (child.exitCode !== null) {
			throw this.exitError ?? new Error(`Feynman Pi RPC session exited before it was ready. ${stripAnsi(this.stderr).trim()}`);
		}
	}

	private async runPrompt(
		request: WorkbenchPromptRequest,
		onUpdate: (update: WorkbenchPromptStreamUpdate) => void | Promise<void>,
	): Promise<WorkbenchPromptResult> {
		const toolEvents = new Map<string, WorkbenchToolEvent>();
		const activeRun: ActiveRpcRun = {
			content: "",
			onUpdate,
			pendingUpdates: [],
			reject: () => undefined,
			resolve: () => undefined,
			status: "running",
			timeout: setTimeout(() => undefined, 0),
			toolEvents,
		};
		clearTimeout(activeRun.timeout);
		const done = new Promise<void>((resolve, reject) => {
			activeRun.resolve = resolve;
			activeRun.reject = reject;
			activeRun.timeout = setTimeout(() => {
				reject(new Error("Feynman chat turn timed out."));
			}, rpcTimeoutMs());
		});
		this.activeRun = activeRun;
		try {
			const response = await this.send({
				type: "prompt",
				message: buildWorkbenchRpcPrompt(request),
			});
			if (response.success === false) {
				throw new Error(response.error || "Feynman Pi RPC prompt was rejected.");
			}
			await done;
			await Promise.all(activeRun.pendingUpdates);
		} finally {
			clearTimeout(activeRun.timeout);
			if (this.activeRun === activeRun) this.activeRun = undefined;
		}
		if (!activeRun.toolEvents.size) {
			const id = randomUUID();
			activeRun.toolEvents.set(id, {
				id,
				label: "Feynman Pi RPC session",
				status: "complete",
			});
		}
		return {
			content: activeRun.content.trim() || "Feynman finished without text output.",
			status: activeRun.status,
			toolEvents: [...activeRun.toolEvents.values()],
		};
	}

	private async send(command: Record<string, unknown>): Promise<RpcResponse> {
		const child = this.child;
		const stdin = child?.stdin;
		if (!child || !stdin) {
			throw new Error("Feynman Pi RPC session is not running.");
		}
		if (this.exitError) throw this.exitError;
		if (child.exitCode !== null) {
			throw new Error(`Feynman Pi RPC session already exited. ${stripAnsi(this.stderr).trim()}`);
		}
		const id = `workbench_${++this.requestId}`;
		const payload = { ...command, id };
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pendingRequests.delete(id);
				reject(new Error(`Timed out waiting for Pi RPC response to ${String(command.type)}.`));
			}, rpcCommandTimeoutMs());
			this.pendingRequests.set(id, { resolve, reject, timeout });
			stdin.write(serializeRpcLine(payload), (error) => {
				if (!error) return;
				const pending = this.pendingRequests.get(id);
				this.pendingRequests.delete(id);
				if (pending) clearTimeout(pending.timeout);
				reject(error);
			});
		});
	}

	private handleLine(line: string): void {
		if (!line.trim()) return;
		let event: Record<string, unknown>;
		try {
			event = JSON.parse(line) as Record<string, unknown>;
		} catch {
			return;
		}
		if (event.type === "response" && typeof event.id === "string") {
			const pending = this.pendingRequests.get(event.id);
			if (pending) {
				this.pendingRequests.delete(event.id);
				clearTimeout(pending.timeout);
				pending.resolve(event as RpcResponse);
				return;
			}
		}
		const activeRun = this.activeRun;
		if (!activeRun) return;
		if (event.type === "agent_end") {
			if (activeRun.status === "running") activeRun.status = "complete";
			activeRun.resolve();
			return;
		}
			activeRun.pendingUpdates.push(handlePiJsonLine(line, activeRun.toolEvents, async (update) => {
				const normalized: WorkbenchPromptStreamUpdate = { ...update };
				if (update.contentDelta !== undefined) {
					activeRun.content += update.contentDelta;
					normalized.content = activeRun.content;
					delete (normalized as PiWorkbenchPromptStreamUpdate).contentDelta;
				} else if (update.content !== undefined) {
					activeRun.content = update.content;
				}
				if (normalized.status) activeRun.status = normalized.status;
				await activeRun.onUpdate(normalized);
			}));
	}

	private rejectPending(error: Error): void {
		for (const pending of this.pendingRequests.values()) {
			clearTimeout(pending.timeout);
			pending.reject(error);
		}
		this.pendingRequests.clear();
	}
}

const rpcClients = new Map<string, WorkbenchPiRpcClient>();

function getWorkbenchPiRpcClient(request: WorkbenchPromptRequest): WorkbenchPiRpcClient {
	const key = rpcClientKey(request);
	const existing = rpcClients.get(key);
	if (existing?.isUsable()) return existing;
	const client = new WorkbenchPiRpcClient();
	rpcClients.set(key, client);
	return client;
}

function getActiveWorkbenchPiRpcClient(request: WorkbenchPromptRequest): WorkbenchPiRpcClient {
	const key = rpcClientKey(request);
	const client = rpcClients.get(key);
	if (!client?.isUsable() || !client.hasActiveRun()) {
		throw new Error("No active Feynman Pi turn is running for this workbench session.");
	}
	return client;
}

export async function closeWorkbenchPiRpcClients(): Promise<void> {
	const clients = [...rpcClients.values()];
	rpcClients.clear();
	await Promise.all(clients.map((client) => client.stop()));
}

export async function runFeynmanWorkbenchPrompt(request: WorkbenchPromptRequest): Promise<WorkbenchPromptResult> {
	return runFeynmanWorkbenchPromptStream(request, () => undefined);
}

export async function listFeynmanWorkbenchCommands(request: WorkbenchPromptRequest): Promise<WorkbenchPiCommand[]> {
	return getWorkbenchPiRpcClient(request).listCommands(request);
}

function boundedText(value: string, limit = 12_000): string {
	return value.length <= limit ? value : `${value.slice(0, limit)}\n[stream output truncated]`;
}

function unknownRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringifyStructured(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value === "string") return boundedText(value);
	try {
		return boundedText(JSON.stringify(value, null, 2));
	} catch {
		return undefined;
	}
}

function messageText(message: unknown): string {
	if (!message || typeof message !== "object") return "";
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((block) => {
		if (!block || typeof block !== "object") return "";
		const typed = block as { type?: unknown; text?: unknown };
		return typed.type === "text" && typeof typed.text === "string" ? typed.text : "";
	}).filter(Boolean).join("\n");
}

function toolOutput(value: unknown): string | undefined {
	if (typeof value === "string") return boundedText(value);
	if (!value || typeof value !== "object") return undefined;
	const content = (value as { content?: unknown }).content;
	if (Array.isArray(content)) {
		const text = content.map((block) => {
			if (!block || typeof block !== "object") return "";
			const typed = block as { type?: unknown; text?: unknown };
			return typed.type === "text" && typeof typed.text === "string" ? typed.text : "";
		}).filter(Boolean).join("\n");
		if (text) return boundedText(text);
	}
	try {
		return boundedText(JSON.stringify(value));
	} catch {
		return undefined;
	}
}

function toolEventLabel(value: string): string {
	return value.trim().replace(/\s+/g, " ").slice(0, 220);
}

function humanToolDescription(args: unknown): string | undefined {
	const record = unknownRecord(args);
	const value = record?.human_description ?? record?.humanDescription;
	return typeof value === "string" && value.trim() ? toolEventLabel(value) : undefined;
}

function applyToolEvent(
	toolEvents: Map<string, WorkbenchToolEvent>,
	event: Record<string, unknown>,
	status: WorkbenchToolEvent["status"],
	output?: string,
): WorkbenchToolEvent[] {
	const id = typeof event.toolCallId === "string" ? event.toolCallId : randomUUID();
	const toolName = typeof event.toolName === "string" ? event.toolName : "Pi tool";
	const input = stringifyStructured(event.args);
	const label = humanToolDescription(event.args) ?? toolName;
	const existing = toolEvents.get(id);
	const partialResult = unknownRecord(event.partialResult);
	const result = unknownRecord(event.result);
	const details = stringifyStructured(result?.details ?? partialResult?.details);
	toolEvents.set(id, {
		id,
		label,
		status,
		toolName,
		...(input ? { input } : existing?.input ? { input: existing.input } : {}),
		...(output ? { output } : existing?.output ? { output: existing.output } : {}),
		...(details ? { details } : existing?.details ? { details: existing.details } : {}),
		...(event.isError === true || existing?.isError ? { isError: true } : {}),
	});
	return [...toolEvents.values()];
}

export async function runFeynmanWorkbenchPromptStream(
	request: WorkbenchPromptRequest,
	onUpdate: (update: WorkbenchPromptStreamUpdate) => void | Promise<void>,
): Promise<WorkbenchPromptResult> {
	return getWorkbenchPiRpcClient(request).promptAndStream(request, onUpdate);
}

export async function steerFeynmanWorkbenchPrompt(request: WorkbenchPromptRequest): Promise<void> {
	await getActiveWorkbenchPiRpcClient(request).steer(request);
}

export async function abortFeynmanWorkbenchPrompt(request: WorkbenchPromptRequest): Promise<void> {
	await getActiveWorkbenchPiRpcClient(request).abortActiveRun();
}

export async function handlePiJsonLine(
	line: string,
	toolEvents: Map<string, WorkbenchToolEvent>,
	onUpdate: (update: PiWorkbenchPromptStreamUpdate) => void | Promise<void>,
): Promise<void> {
	let event: Record<string, unknown>;
	try {
		event = JSON.parse(line) as Record<string, unknown>;
	} catch {
		return;
	}
	if (event.type === "message_update") {
		const assistantMessageEvent = unknownRecord(event.assistantMessageEvent);
		if (
			assistantMessageEvent?.type === "text_delta" &&
			typeof assistantMessageEvent.delta === "string"
		) {
			await onUpdate({
				contentDelta: assistantMessageEvent.delta,
				status: "running",
				toolEvents: [...toolEvents.values()],
			});
			return;
		}
	}
	if (event.type === "message_update" || event.type === "message_end") {
		const message = event.message;
		if (message && typeof message === "object" && (message as { role?: unknown }).role === "assistant") {
			const content = messageText(message);
			const stopReason = (message as { stopReason?: unknown }).stopReason;
			await onUpdate({
				content,
				status: stopReason === "aborted" ? "stopped" : stopReason === "error" ? "error" : event.type === "message_end" ? "complete" : "running",
				toolEvents: [...toolEvents.values()],
			});
		}
		return;
	}
	if (event.type === "queue_update") {
		const id = "pi-queue";
		toolEvents.set(id, {
			id,
			label: "Pi message queue",
			status: "running",
			output: toolOutput(event) ?? "Queued message accepted by the active Pi session.",
		});
		await onUpdate({ toolEvents: [...toolEvents.values()] });
		return;
	}
	if (event.type === "tool_execution_start") {
		await onUpdate({ toolEvents: applyToolEvent(toolEvents, event, "running") });
		return;
	}
	if (event.type === "tool_execution_update") {
		await onUpdate({ toolEvents: applyToolEvent(toolEvents, event, "running", toolOutput(event.partialResult)) });
		return;
	}
	if (event.type === "tool_execution_end") {
		const status = event.isError === true ? "error" : "complete";
		await onUpdate({ toolEvents: applyToolEvent(toolEvents, event, status, toolOutput(event.result)) });
	}
}
