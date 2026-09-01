import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

import {
	abortFeynmanWorkbenchPrompt,
	runFeynmanWorkbenchPrompt,
	runFeynmanWorkbenchPromptStream,
	steerFeynmanWorkbenchPrompt,
} from "./chat-runtime.js";
import {
	defaultWorkbenchPiSessionInfo,
	normalizeWorkbenchPiSessionInfo,
	readWorkbenchPiSessionInfo,
	type WorkbenchPiSessionInfo,
} from "./pi-session.js";
import {
	captureArtifactSnapshotBaseline,
	recordArtifactSnapshotsForChanges,
	type WorkbenchArtifactSnapshotBaseline,
} from "./artifact-snapshots.js";
import { isInsideDirectory, legacyWorkbenchDataPath, migratedWorkbenchDataPath, resolveWorkbenchStoredPath } from "./data-root.js";

export type WorkbenchChatRole = "assistant" | "system" | "user";
export type WorkbenchChatStatus = "complete" | "error" | "queued" | "running" | "stopped";

export type WorkbenchToolEvent = {
	id: string;
	label: string;
	status: WorkbenchChatStatus;
	toolName?: string;
	input?: string;
	output?: string;
	details?: string;
	isError?: boolean;
};

export type WorkbenchAttachment = {
	id: string;
	name: string;
	contentType: string;
	sizeBytes: number;
	createdAt: string;
	storagePath: string;
	previewText?: string;
	truncated?: boolean;
};

export type WorkbenchChatMessage = {
	id: string;
	role: WorkbenchChatRole;
	content: string;
	createdAt: string;
	status: WorkbenchChatStatus;
	toolEvents: WorkbenchToolEvent[];
};

export type WorkbenchSessionConfig = {
	delegation: boolean;
	autoReview: boolean;
	memory: boolean;
	specialist: string;
	compute: "off" | "local";
	model?: string;
};

export type WorkbenchChatSession = {
	id: string;
	projectId: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	status: WorkbenchChatStatus;
	config: WorkbenchSessionConfig;
	piSession: WorkbenchPiSessionInfo;
	attachments: WorkbenchAttachment[];
	messages: WorkbenchChatMessage[];
};

export type WorkbenchViewportContext = {
	activePath?: string;
	openPaths: string[];
	previewTab?: string;
	rightTab?: string;
};

export type WorkbenchPromptRequest = {
	workingDir: string;
	appRoot?: string;
	sessionDir?: string;
	feynmanAgentDir?: string;
	feynmanVersion?: string;
	session: WorkbenchChatSession;
	message: string;
	viewportContext?: WorkbenchViewportContext;
};

export type WorkbenchPromptResult = {
	content: string;
	status?: WorkbenchChatStatus;
	toolEvents?: WorkbenchToolEvent[];
};

export type WorkbenchPromptExecutor = (request: WorkbenchPromptRequest) => Promise<WorkbenchPromptResult>;

type WorkbenchChatStreamState = {
	artifacts?: unknown[];
	projects?: unknown[];
	runs?: unknown[];
};

export type WorkbenchChatStreamEvent =
	| { type: "session"; session: WorkbenchChatSession }
	| { type: "delta"; content: string }
	| { type: "tool"; toolEvent: WorkbenchToolEvent }
	| { type: "done"; session: WorkbenchChatSession; state?: WorkbenchChatStreamState }
	| { type: "error"; message: string; session?: WorkbenchChatSession; state?: WorkbenchChatStreamState };

export type WorkbenchChatStreamEmitter = (event: WorkbenchChatStreamEvent) => void | Promise<void>;

export type WorkbenchChatOptions = {
	workingDir: string;
	appRoot?: string;
	sessionDir?: string;
	feynmanAgentDir?: string;
	feynmanVersion?: string;
	executor?: WorkbenchPromptExecutor;
};

type EnsureSessionInput = {
	id: string;
	projectId: string;
	title: string;
};

export type SubmitMessageInput = EnsureSessionInput & {
	message: string;
	viewportContext?: WorkbenchViewportContext;
};

type UpdateSessionConfigInput = EnsureSessionInput & {
	config: Partial<WorkbenchSessionConfig>;
};

type AddAttachmentInput = EnsureSessionInput & {
	name: string;
	contentType?: string;
	data: Buffer;
};

type RemoveAttachmentInput = EnsureSessionInput & {
	attachmentId: string;
};

export type WorkbenchAttachmentDownload = {
	name: string;
	contentType: string;
	sizeBytes: number;
	buffer: Buffer;
};

export const MAX_WORKBENCH_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const DEFAULT_SESSION_CONFIG: WorkbenchSessionConfig = {
	delegation: false,
	autoReview: false,
	memory: false,
	specialist: "None",
	compute: "local",
	model: "",
};

function nowIso(): string {
	return new Date().toISOString();
}

function normalizeSessionId(value: string): string {
	const id = value.trim();
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) {
		throw new Error("Chat session id must be a simple slug.");
	}
	return id;
}

function normalizeProjectId(value: string): string {
	const id = value.trim();
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) {
		throw new Error("Project id must be a simple slug.");
	}
	return id;
}

function normalizeTitle(value: string): string {
	const title = value.trim().replace(/\s+/g, " ");
	return title.slice(0, 140) || "Research chat";
}

function normalizeMessage(value: string): string {
	const message = value.trim();
	if (!message) {
		throw new Error("Message is required.");
	}
	if (message.length > 50_000) {
		throw new Error("Message is too large for one workbench turn.");
	}
	return message;
}

export function normalizeWorkbenchChatMessageInput(input: SubmitMessageInput): SubmitMessageInput {
	return {
		id: normalizeSessionId(input.id),
		projectId: normalizeProjectId(input.projectId),
		title: normalizeTitle(input.title),
		message: normalizeMessage(input.message),
		...(input.viewportContext ? { viewportContext: input.viewportContext } : {}),
	};
}

function chatDir(workingDir: string): string {
	return migratedWorkbenchDataPath(workingDir, "sessions");
}

function chatPath(workingDir: string, sessionId: string): string {
	return join(chatDir(workingDir), `${normalizeSessionId(sessionId)}.json`);
}

function readSessionPath(path: string): WorkbenchChatSession {
	const parsed = JSON.parse(readFileSync(path, "utf8")) as WorkbenchChatSession;
	return {
		...parsed,
		config: normalizeSessionConfig(parsed.config),
		piSession: normalizeWorkbenchPiSessionInfo(parsed.piSession, parsed.id),
		attachments: normalizeAttachments(parsed.attachments),
	};
}

function writeSessionPath(path: string, session: WorkbenchChatSession): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(session, null, 2)}\n`, "utf8");
}

function mergeExternalSessionMessages(path: string, session: WorkbenchChatSession): WorkbenchChatSession {
	if (!existsSync(path)) return session;
	const current = readSessionPath(path);
	const knownMessageIds = new Set(session.messages.map((message) => message.id));
	const externalMessages = current.messages.filter((message) => !knownMessageIds.has(message.id));
	if (!externalMessages.length) return session;
	return {
		...session,
		messages: [...session.messages, ...externalMessages].sort((a, b) =>
			a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
		),
	};
}

function writeStreamSessionPath(path: string, session: WorkbenchChatSession): WorkbenchChatSession {
	const merged = mergeExternalSessionMessages(path, session);
	writeSessionPath(path, merged);
	return merged;
}

function createMessage(
	role: WorkbenchChatRole,
	content: string,
	status: WorkbenchChatStatus = "complete",
	toolEvents: WorkbenchToolEvent[] = [],
): WorkbenchChatMessage {
	return {
		id: randomUUID(),
		role,
		content,
		createdAt: nowIso(),
		status,
		toolEvents,
	};
}

export function appendWorkbenchChatAssistantMessage(
	options: WorkbenchChatOptions,
	session: WorkbenchChatSession,
	content: string,
	toolEvents: WorkbenchToolEvent[] = [],
): WorkbenchChatSession {
	const updated = {
		...session,
		status: "complete" as const,
		updatedAt: nowIso(),
		messages: [
			...session.messages,
			createMessage("assistant", content, "complete", toolEvents),
		],
	};
	writeSessionPath(chatPath(options.workingDir, updated.id), updated);
	return updated;
}

function normalizeSessionConfig(config: Partial<WorkbenchSessionConfig> | undefined): WorkbenchSessionConfig {
	if (
		config?.delegation === true &&
		config.autoReview === true &&
		config.memory === true &&
		config.specialist === "Default" &&
		(config.compute === undefined || config.compute === "local")
	) {
		return DEFAULT_SESSION_CONFIG;
	}
	const compute = config?.compute === "off" ? "off" : "local";
	return {
		delegation: config?.delegation ?? DEFAULT_SESSION_CONFIG.delegation,
		autoReview: config?.autoReview ?? DEFAULT_SESSION_CONFIG.autoReview,
		memory: config?.memory ?? DEFAULT_SESSION_CONFIG.memory,
		specialist: typeof config?.specialist === "string" && config.specialist.trim()
			? config.specialist.trim().slice(0, 80)
			: DEFAULT_SESSION_CONFIG.specialist,
		compute,
		model: typeof config?.model === "string" ? config.model.trim().slice(0, 160) : DEFAULT_SESSION_CONFIG.model,
	};
}

function normalizeAttachments(attachments: WorkbenchAttachment[] | undefined): WorkbenchAttachment[] {
	if (!Array.isArray(attachments)) return [];
	return attachments.filter((attachment) =>
		attachment &&
		typeof attachment.id === "string" &&
		typeof attachment.name === "string" &&
		typeof attachment.contentType === "string" &&
		typeof attachment.sizeBytes === "number" &&
		typeof attachment.createdAt === "string" &&
		typeof attachment.storagePath === "string"
	).map((attachment) => ({
		id: attachment.id,
		name: attachment.name,
		contentType: attachment.contentType,
		sizeBytes: attachment.sizeBytes,
		createdAt: attachment.createdAt,
		storagePath: attachment.storagePath,
		...(typeof attachment.previewText === "string" ? { previewText: attachment.previewText } : {}),
		...(attachment.truncated ? { truncated: true } : {}),
	}));
}

export function listWorkbenchChatSessions(options: WorkbenchChatOptions): WorkbenchChatSession[] {
	const dir = chatDir(options.workingDir);
	if (!existsSync(dir)) return [];
	return readdirJsonFiles(dir)
		.map((path) => readSessionPath(path))
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function readdirJsonFiles(dir: string): string[] {
	return readdirSync(dir)
		.filter((name) => name.endsWith(".json"))
		.map((name) => join(dir, name));
}

export function ensureWorkbenchChatSession(
	options: WorkbenchChatOptions,
	input: EnsureSessionInput,
): WorkbenchChatSession {
	const id = normalizeSessionId(input.id);
	const path = chatPath(options.workingDir, id);
	if (existsSync(path)) {
		const existing = readSessionPath(path);
		const projectId = normalizeProjectId(input.projectId);
		const title = normalizeTitle(input.title);
		if (existing.projectId !== projectId || existing.title !== title) {
			const updated = { ...existing, projectId, title, updatedAt: nowIso() };
			writeSessionPath(path, updated);
			return updated;
		}
		return existing;
	}
	const createdAt = nowIso();
	const session: WorkbenchChatSession = {
		id,
		projectId: normalizeProjectId(input.projectId),
		title: normalizeTitle(input.title),
		createdAt,
		updatedAt: createdAt,
		status: "complete",
		config: DEFAULT_SESSION_CONFIG,
		piSession: defaultWorkbenchPiSessionInfo(id),
		attachments: [],
		messages: [],
	};
	writeSessionPath(path, session);
	return session;
}

async function refreshWorkbenchPiSession(
	options: WorkbenchChatOptions,
	session: WorkbenchChatSession,
): Promise<WorkbenchChatSession> {
	const piSession = await readWorkbenchPiSessionInfo({
		workingDir: options.workingDir,
		sessionDir: options.sessionDir,
		piSessionId: session.piSession.id,
	});
	return { ...session, piSession, updatedAt: nowIso() };
}

export function updateWorkbenchChatSessionConfig(
	options: WorkbenchChatOptions,
	input: UpdateSessionConfigInput,
): WorkbenchChatSession {
	const session = ensureWorkbenchChatSession(options, input);
	const updated = {
		...session,
		config: normalizeSessionConfig({ ...session.config, ...input.config }),
		updatedAt: nowIso(),
	};
	writeSessionPath(chatPath(options.workingDir, updated.id), updated);
	return updated;
}

function uploadDir(workingDir: string, sessionId: string): string {
	return migratedWorkbenchDataPath(workingDir, "uploads", normalizeSessionId(sessionId));
}

function storedUploadPath(absolutePath: string): string {
	return absolutePath;
}

function uploadRoots(workingDir: string): string[] {
	return [
		migratedWorkbenchDataPath(workingDir, "uploads"),
		legacyWorkbenchDataPath(workingDir, "uploads"),
	];
}

function resolveStoredUploadPath(workingDir: string, storagePath: string): string {
	const absolutePath = resolveWorkbenchStoredPath(workingDir, storagePath);
	if (!uploadRoots(workingDir).some((root) => isInsideDirectory(root, absolutePath))) {
		throw new Error("Attachment path is outside the workbench upload store.");
	}
	return absolutePath;
}

function sanitizeAttachmentName(value: string): string {
	const name = value.trim().replace(/[/\\\0\r\n]/g, "_").replace(/\s+/g, " ").slice(0, 160);
	return name || "attachment";
}

function normalizeContentType(value: string | undefined, name: string): string {
	const type = value?.trim().toLowerCase();
	if (type && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(type)) return type;
	const extension = extname(name).toLowerCase();
	if (extension === ".md" || extension === ".markdown") return "text/markdown";
	if (extension === ".csv" || extension === ".tsv") return "text/csv";
	if (extension === ".json") return "application/json";
	if (extension === ".txt" || extension === ".log") return "text/plain";
	if (extension === ".pdf") return "application/pdf";
	return "application/octet-stream";
}

function isTextAttachment(name: string, contentType: string, data: Buffer): boolean {
	if (contentType.startsWith("text/")) return true;
	if (/(json|xml|yaml|csv|markdown|x-python|javascript|typescript)/.test(contentType)) return true;
	if (/\.(md|markdown|txt|csv|tsv|json|jsonl|xml|yaml|yml|py|r|js|ts|tsx|jsx|log)$/i.test(name)) return true;
	return !data.subarray(0, Math.min(data.length, 8192)).includes(0);
}

function attachmentPreview(name: string, contentType: string, data: Buffer): Pick<WorkbenchAttachment, "previewText" | "truncated"> {
	if (!isTextAttachment(name, contentType, data)) return {};
	const maxChars = 120_000;
	const text = data.toString("utf8").replace(/\u0000/g, "");
	if (text.length <= maxChars) return { previewText: text };
	return { previewText: text.slice(0, maxChars), truncated: true };
}

export function addWorkbenchChatAttachment(
	options: WorkbenchChatOptions,
	input: AddAttachmentInput,
): WorkbenchChatSession {
	if (input.data.length > MAX_WORKBENCH_ATTACHMENT_BYTES) {
		throw new Error("Attachment is too large for the local workbench.");
	}
	const session = ensureWorkbenchChatSession(options, input);
	const name = sanitizeAttachmentName(input.name);
	const contentType = normalizeContentType(input.contentType, name);
	const id = randomUUID();
	const directory = uploadDir(options.workingDir, session.id);
	mkdirSync(directory, { recursive: true });
	const absolutePath = join(directory, `${id}-${name}`);
	writeFileSync(absolutePath, input.data);
	const attachment: WorkbenchAttachment = {
		id,
		name,
		contentType,
		sizeBytes: input.data.length,
		createdAt: nowIso(),
		storagePath: storedUploadPath(absolutePath),
		...attachmentPreview(name, contentType, input.data),
	};
	const updated = {
		...session,
		updatedAt: nowIso(),
		attachments: [...session.attachments, attachment],
	};
	writeSessionPath(chatPath(options.workingDir, updated.id), updated);
	return updated;
}

export function removeWorkbenchChatAttachment(
	options: WorkbenchChatOptions,
	input: RemoveAttachmentInput,
): WorkbenchChatSession {
	const session = ensureWorkbenchChatSession(options, input);
	const attachment = session.attachments.find((item) => item.id === input.attachmentId);
	if (!attachment) return session;
	const absolutePath = resolveStoredUploadPath(options.workingDir, attachment.storagePath);
	rmSync(absolutePath, { force: true });
	const updated = {
		...session,
		updatedAt: nowIso(),
		attachments: session.attachments.filter((item) => item.id !== input.attachmentId),
	};
	writeSessionPath(chatPath(options.workingDir, updated.id), updated);
	return updated;
}

export function readWorkbenchChatAttachmentDownload(
	options: WorkbenchChatOptions,
	input: RemoveAttachmentInput,
): WorkbenchAttachmentDownload {
	const session = ensureWorkbenchChatSession(options, input);
	const attachment = session.attachments.find((item) => item.id === input.attachmentId);
	if (!attachment) throw new Error("Attachment not found.");
	const absolutePath = resolveStoredUploadPath(options.workingDir, attachment.storagePath);
	if (!existsSync(absolutePath)) throw new Error("Attachment file is missing.");
	const stat = statSync(absolutePath);
	if (!stat.isFile()) throw new Error("Attachment is not a file.");
	return {
		name: attachment.name,
		contentType: attachment.contentType,
		sizeBytes: stat.size,
		buffer: readFileSync(absolutePath),
	};
}

function updateMessage(
	session: WorkbenchChatSession,
	messageId: string,
	patch: Partial<WorkbenchChatMessage>,
): WorkbenchChatSession {
	return {
		...session,
		updatedAt: nowIso(),
		messages: session.messages.map((message) =>
			message.id === messageId ? { ...message, ...patch } : message
		),
	};
}

function messageById(session: WorkbenchChatSession, messageId: string): WorkbenchChatMessage | undefined {
	return session.messages.find((message) => message.id === messageId);
}

function recordChatTurnSnapshots(
	options: WorkbenchChatOptions,
	baseline: WorkbenchArtifactSnapshotBaseline,
	session: WorkbenchChatSession,
	assistantMessage: WorkbenchChatMessage,
): void {
	recordArtifactSnapshotsForChanges(options.workingDir, baseline, {
		source: "chat",
		sessionId: session.id,
		runSlug: session.id,
		producerExecutionId: `chat:${session.id}:${assistantMessage.id}`,
		producerSourceId: assistantMessage.id,
		createdAtMs: Date.parse(assistantMessage.createdAt) || Date.now(),
	});
}

export async function submitWorkbenchChatMessage(
	options: WorkbenchChatOptions,
	input: SubmitMessageInput,
): Promise<WorkbenchChatSession> {
	const message = normalizeMessage(input.message);
	let session = ensureWorkbenchChatSession(options, input);
	const path = chatPath(options.workingDir, session.id);
	session = {
		...session,
		status: "running",
		updatedAt: nowIso(),
		messages: [...session.messages, createMessage("user", message)],
	};
	writeSessionPath(path, session);
	const snapshotBaseline = captureArtifactSnapshotBaseline(options.workingDir);

	try {
		const executor = options.executor ?? runFeynmanWorkbenchPrompt;
		const result = await executor({ ...options, session, message, viewportContext: input.viewportContext });
		const assistantMessage = createMessage(
			"assistant",
			result.content.trim() || "Feynman finished without text output.",
			result.status ?? "complete",
			result.toolEvents ?? [],
		);
		session = {
			...session,
			status: result.status ?? "complete",
			updatedAt: nowIso(),
			messages: [...session.messages, assistantMessage],
		};
		recordChatTurnSnapshots(options, snapshotBaseline, session, assistantMessage);
		session = await refreshWorkbenchPiSession(options, session);
	} catch (error) {
		const assistantMessage = createMessage("assistant", error instanceof Error ? error.message : String(error), "error");
		session = {
			...session,
			status: "error",
			updatedAt: nowIso(),
			messages: [...session.messages, assistantMessage],
		};
		recordChatTurnSnapshots(options, snapshotBaseline, session, assistantMessage);
		session = await refreshWorkbenchPiSession(options, session);
	}
	writeSessionPath(path, session);
	return session;
}

export async function steerWorkbenchChatMessage(
	options: WorkbenchChatOptions,
	input: SubmitMessageInput,
): Promise<WorkbenchChatSession> {
	const message = normalizeMessage(input.message);
	let session = ensureWorkbenchChatSession(options, input);
	const path = chatPath(options.workingDir, session.id);
	const queuedMessage = createMessage("user", message, "queued", [{
		id: randomUUID(),
		label: "Queued to active Pi turn",
		status: "running",
		output: "This message will steer the running Feynman turn.",
	}]);
	session = {
		...session,
		status: "running",
		updatedAt: nowIso(),
		messages: [...session.messages, queuedMessage],
	};
	writeSessionPath(path, session);

	try {
		await steerFeynmanWorkbenchPrompt({ ...options, session, message, viewportContext: input.viewportContext });
		session = updateMessage(session, queuedMessage.id, {
			status: "complete",
			toolEvents: queuedMessage.toolEvents.map((event) => ({
				...event,
				status: "complete",
				output: "Queued inside the active Pi RPC session.",
			})),
		});
		session = await refreshWorkbenchPiSession(options, session);
	} catch (error) {
		session = updateMessage(session, queuedMessage.id, {
			status: "error",
			toolEvents: queuedMessage.toolEvents.map((event) => ({
				...event,
				status: "error",
				output: error instanceof Error ? error.message : String(error),
			})),
		});
		session = { ...session, status: "error", updatedAt: nowIso() };
		session = await refreshWorkbenchPiSession(options, session);
	}
	writeSessionPath(path, session);
	return session;
}

export async function abortWorkbenchChatMessage(
	options: WorkbenchChatOptions,
	input: EnsureSessionInput,
): Promise<WorkbenchChatSession> {
	let session = ensureWorkbenchChatSession(options, input);
	await abortFeynmanWorkbenchPrompt({
		...options,
		session,
		message: "Stop the running Feynman turn.",
	});
	session = { ...session, status: "stopped", updatedAt: nowIso() };
	writeSessionPath(chatPath(options.workingDir, session.id), session);
	return session;
}

export async function streamWorkbenchChatMessage(
	options: WorkbenchChatOptions,
	input: SubmitMessageInput,
	emit: WorkbenchChatStreamEmitter,
): Promise<WorkbenchChatSession> {
	const normalizedInput = normalizeWorkbenchChatMessageInput(input);
	const message = normalizedInput.message;
	let session = ensureWorkbenchChatSession(options, normalizedInput);
	const path = chatPath(options.workingDir, session.id);
	const assistantMessage = createMessage("assistant", "Starting Feynman inside this workspace...", "running", [{
		id: randomUUID(),
		label: "Feynman Pi turn",
		status: "running",
	}]);
	session = {
		...session,
		status: "running",
		updatedAt: nowIso(),
		messages: [...session.messages, createMessage("user", message), assistantMessage],
	};
	writeSessionPath(path, session);
	await emit({ type: "session", session });
	const snapshotBaseline = captureArtifactSnapshotBaseline(options.workingDir);

	try {
		const request = { ...options, session, message, viewportContext: normalizedInput.viewportContext };
		const result = options.executor
			? await options.executor(request)
			: await runFeynmanWorkbenchPromptStream(request, async (update) => {
				session = updateMessage(session, assistantMessage.id, {
					...(update.content !== undefined ? { content: update.content } : {}),
					...(update.status ? { status: update.status } : {}),
					...(update.toolEvents ? { toolEvents: update.toolEvents } : {}),
				});
				session = { ...session, status: update.status === "error" || update.status === "stopped" ? update.status : "running" };
				session = writeStreamSessionPath(path, session);
				if (update.content !== undefined) await emit({ type: "delta", content: update.content });
				for (const toolEvent of update.toolEvents ?? []) await emit({ type: "tool", toolEvent });
				await emit({ type: "session", session });
			});
		if (options.executor) {
			if (result.content) await emit({ type: "delta", content: result.content });
			for (const toolEvent of result.toolEvents ?? []) await emit({ type: "tool", toolEvent });
		}
		const currentToolEvents = messageById(session, assistantMessage.id)?.toolEvents ?? [];
		session = updateMessage(session, assistantMessage.id, {
			content: result.content.trim() || "Feynman finished without text output.",
			status: result.status ?? "complete",
			toolEvents: result.toolEvents ?? currentToolEvents,
		});
		session = { ...session, status: result.status ?? "complete", updatedAt: nowIso() };
		const currentAssistant = messageById(session, assistantMessage.id) ?? assistantMessage;
		recordChatTurnSnapshots(options, snapshotBaseline, session, currentAssistant);
		session = await refreshWorkbenchPiSession(options, session);
	} catch (error) {
		const messageText = error instanceof Error ? error.message : String(error);
		const currentToolEvents = messageById(session, assistantMessage.id)?.toolEvents ?? [];
		session = updateMessage(session, assistantMessage.id, {
			content: messageText,
			status: "error",
			toolEvents: currentToolEvents.map((event) => ({
				...event,
				status: event.status === "running" ? "error" : event.status,
			})),
		});
		session = { ...session, status: "error", updatedAt: nowIso() };
		const currentAssistant = messageById(session, assistantMessage.id) ?? assistantMessage;
		recordChatTurnSnapshots(options, snapshotBaseline, session, currentAssistant);
		session = await refreshWorkbenchPiSession(options, session);
		session = writeStreamSessionPath(path, session);
		await emit({ type: "error", message: messageText, session });
		return session;
	}
	session = writeStreamSessionPath(path, session);
	await emit({ type: "done", session });
	return session;
}
