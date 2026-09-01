import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { openUrl } from "../system/open-url.js";
import {
	abortWorkbenchChatMessage,
	addWorkbenchChatAttachment,
	ensureWorkbenchChatSession,
	listWorkbenchChatSessions,
	MAX_WORKBENCH_ATTACHMENT_BYTES,
	normalizeWorkbenchChatMessageInput,
	readWorkbenchChatAttachmentDownload,
	removeWorkbenchChatAttachment,
	steerWorkbenchChatMessage,
	streamWorkbenchChatMessage,
	submitWorkbenchChatMessage,
	updateWorkbenchChatSessionConfig,
	type WorkbenchChatStreamEvent, type WorkbenchPromptExecutor, type WorkbenchViewportContext,
} from "./chat.js";
import { closeWorkbenchPiRpcClients, listFeynmanWorkbenchCommands } from "./chat-runtime.js";
import { normalizeWorkbenchArtifactAnnotationRects, removeWorkbenchArtifactAnnotation, upsertWorkbenchArtifactAnnotation } from "./annotations.js";
import { updateWorkbenchArtifactAction, type WorkbenchArtifactAction } from "./artifact-actions.js";
import { applyWorkbenchArtifactRefinement, MAX_ARTIFACT_EDIT_BYTES, readWorkbenchEditableArtifact, suggestWorkbenchArtifactRefinement, updateWorkbenchArtifactContent, type WorkbenchArtifactRefinementMode } from "./artifact-edit.js";
import { exportWorkbenchArtifactToCloud } from "./cloud-export.js";
import { applyWorkbenchComputeProviderAction, parseWorkbenchComputeJobAction } from "./compute-provider-actions.js";
import { manageNotebookEnvironment } from "./notebook-managed-environments.js";
import { cancelNotebookExecution, closeNotebookKernelSessions, executeNotebookCell, readNotebookExecutionRecords } from "./notebook-execution.js";
import { upsertWorkbenchMemoryRecord, removeWorkbenchMemoryRecord, upsertWorkbenchNoteRecord, removeWorkbenchNoteRecord } from "./memory.js";
import { completeWorkbenchOnboardingFromRequest } from "./onboarding-route.js";
import { createWorkbenchOAuthStart, finishWorkbenchOAuthCallback, removeWorkbenchOAuthToken } from "./oauth-store.js";
import { materializeWorkbenchOrgDatabase } from "./org-database.js";
import { updateWorkbenchPackageSettings, type WorkbenchPackageAction } from "./package-settings.js";
import { buildPiCommandResourceGroup, mergePiCommandResourceGroup } from "./pi-commands.js";
import { generateWorkbenchPlan, updateWorkbenchPlanAction, updateWorkbenchPlanStep } from "./plan.js";
import { createWorkbenchProject } from "./projects.js";
import { upsertWorkbenchFrameReadCursor } from "./read-cursors.js";
import { requestWorkbenchReview } from "./review.js";
import { readWorkbenchPdfText } from "./pdf-text.js";
import { buildWorkbenchState, loadWorkbenchModelStatus, readWorkbenchFile, readWorkbenchFileDownload, type BuildWorkbenchStateOptions } from "./scan.js";
import { ensureOpenScienceSeedFixtures } from "./seed-fixtures.js";
import { readWorkbenchSettings, removeWorkbenchSettingsRecord, upsertWorkbenchSettingsRecord, type WorkbenchSettingsCollection, type WorkbenchCustomConnector } from "./settings-store.js";
import { diffArtifactVersionSnapshot, restoreArtifactVersionSnapshot } from "./artifact-snapshot-actions.js";
import { hostForUrl, logWorkbenchRequestError, normalizeHost, requestCookie, requestOrigin, sendWorkbenchRequestError } from "./server-utils.js";
import { sendWorkbenchWeb } from "./static-shell.js";
import { mutateWorkbenchTranscriptAnnotation } from "./transcript-annotations.js";
import type { WorkbenchArtifactVersion, WorkbenchPlanStepStatus } from "./types.js";

export { parseWorkbenchPort } from "./server-utils.js";

type WorkbenchServerOptions = {
	appRoot?: string;
	sessionDir?: string;
	feynmanAgentDir?: string;
	settingsPath?: string;
	authPath?: string;
	workingDir: string;
	version?: string;
	host?: string;
	port?: number;
	requireAuth?: boolean;
	token?: string;
	promptExecutor?: WorkbenchPromptExecutor;
};

export type WorkbenchServerHandle = {
	server: Server;
	url: string;
	openUrl: string;
	token: string;
	close: () => Promise<void>;
};

type ServeWorkbenchOptions = WorkbenchServerOptions & {
	shouldOpen?: boolean;
};

function send(response: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
	response.writeHead(status, {
		"cache-control": "no-store",
		...headers,
	});
	response.end(body);
}

function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
	send(response, status, JSON.stringify(body, null, 2), {
		"content-type": "application/json; charset=utf-8",
		...headers,
	});
}

function sendStreamEvent(response: ServerResponse, event: WorkbenchChatStreamEvent): void {
	response.write(`event: ${event.type}\n`);
	response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function isAuthorized(request: IncomingMessage, url: URL, token: string): boolean {
	const queryToken = url.searchParams.get("token");
	const headerToken = request.headers["x-feynman-token"];
	const cookieToken = requestCookie(request.headers.cookie, "feynman_workbench");
	return queryToken === token || headerToken === token || cookieToken === token;
}

function tokenCookie(token: string): string {
	return `feynman_workbench=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/`;
}

function newWorkbenchSessionId(): string {
	return `session-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`;
}

function readJsonBody(request: IncomingMessage, maxBytes = 64 * 1024): Promise<unknown> {
	return new Promise((resolve, reject) => {
		let body = "";
		request.setEncoding("utf8");
		request.on("data", (chunk) => {
			body += chunk;
			if (body.length > maxBytes) {
				reject(new Error("Request body is too large."));
				request.destroy();
			}
		});
		request.on("error", reject);
		request.on("end", () => {
			if (!body.trim()) {
				resolve({});
				return;
			}
			try {
				resolve(JSON.parse(body));
			} catch {
				reject(new Error("Request body must be valid JSON."));
			}
		});
	});
}

function expectObject(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Request body must be a JSON object.");
	}
	return value as Record<string, unknown>;
}

function stringField(body: Record<string, unknown>, key: string): string {
	const value = body[key];
	if (typeof value !== "string") {
		throw new Error(`Missing ${key}.`);
	}
	return value;
}

function optionalConfig(body: Record<string, unknown>): Record<string, unknown> {
	const value = body.config;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Missing config.");
	}
	return value as Record<string, unknown>;
}

function optionalStringField(body: Record<string, unknown>, key: string): string | undefined {
	const value = body[key];
	return typeof value === "string" ? value : undefined;
}

function optionalNumberField(body: Record<string, unknown>, key: string): number | undefined {
	const value = body[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArrayField(body: Record<string, unknown>, key: string): string[] {
	const value = body[key];
	if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
		throw new Error(`Missing ${key}.`);
	}
	return value;
}

function optionalViewportContext(body: Record<string, unknown>): WorkbenchViewportContext | undefined {
	const value = body.viewportContext;
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	const openPaths = Array.isArray(record.openPaths)
		? record.openPaths.filter((item): item is string => typeof item === "string").slice(0, 8)
		: [];
	const activePath = typeof record.activePath === "string" ? record.activePath : undefined;
	const previewTab = typeof record.previewTab === "string" ? record.previewTab : undefined;
	const rightTab = typeof record.rightTab === "string" ? record.rightTab : undefined;
	if (!activePath && !openPaths.length && !previewTab && !rightTab) return undefined;
	return { openPaths, ...(activePath ? { activePath } : {}), ...(previewTab ? { previewTab } : {}), ...(rightTab ? { rightTab } : {}) };
}

function packageActionField(body: Record<string, unknown>): WorkbenchPackageAction {
	const value = stringField(body, "action");
	if (value === "disable" || value === "enable") return value;
	throw new Error("Package action must be enable or disable.");
}

function settingsCollectionField(body: Record<string, unknown>): WorkbenchSettingsCollection {
	const value = stringField(body, "collection");
	if (
		value === "allowedDomains" ||
		value === "computeHosts" ||
		value === "computeProviderPreferences" ||
		value === "credentialRefs" ||
		value === "customConnectors" ||
		value === "memoryCategories" ||
		value === "permissionGrants"
	) return value;
	throw new Error("Unknown settings collection.");
}

function annotationActionField(body: Record<string, unknown>): "remove" | "upsert" {
	const value = optionalStringField(body, "action");
	if (!value || value === "upsert") return "upsert";
	if (value === "remove") return value;
	throw new Error("Annotation action must be upsert or remove.");
}

function artifactActionField(body: Record<string, unknown>): WorkbenchArtifactAction {
	const value = stringField(body, "action");
	if (
		value === "delete" ||
		value === "hide" ||
		value === "rename" ||
		value === "restore" ||
		value === "star" ||
		value === "unhide" ||
		value === "unstar"
	) return value;
	throw new Error("Artifact action must be star, unstar, hide, unhide, rename, restore, or delete.");
}

function artifactRefinementModeField(body: Record<string, unknown>): WorkbenchArtifactRefinementMode {
	const value = optionalStringField(body, "mode");
	if (value === "ask" || value === "edit") return value;
	throw new Error("Refinement mode must be ask or edit.");
}

function settingsActionField(body: Record<string, unknown>): "remove" | "upsert" {
	const value = optionalStringField(body, "action");
	if (!value || value === "upsert") return "upsert";
	if (value === "remove") return value;
	throw new Error("Settings action must be upsert or remove.");
}

function settingsRecordField(body: Record<string, unknown>): Record<string, unknown> {
	const value = body.record;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Missing settings record.");
	}
	return value as Record<string, unknown>;
}

function connectorField(options: WorkbenchRequestHandlerOptions, body: Record<string, unknown>): WorkbenchCustomConnector {
	const connectorId = stringField(body, "connectorId").trim();
	const connector = readWorkbenchSettings(options.workingDir).customConnectors.find((item) => item.id === connectorId);
	if (!connector) throw new Error("Connector was not found.");
	return connector;
}

function planActionField(body: Record<string, unknown>): "approve" | "reject" | "reopen" {
	const value = stringField(body, "action");
	if (value === "approve" || value === "reject" || value === "reopen") return value;
	throw new Error("Plan action must be approve, reject, or reopen.");
}

function planStepStatusField(body: Record<string, unknown>): WorkbenchPlanStepStatus {
	const value = stringField(body, "status");
	if (value === "blocked" || value === "complete" || value === "pending" || value === "running") return value;
	throw new Error("Plan step status must be pending, running, blocked, or complete.");
}

function notebookLanguageField(body: Record<string, unknown>): "bash" | "python" | "r" {
	const value = optionalStringField(body, "language")?.toLowerCase() ?? "python";
	if (value === "bash" || value === "shell" || value === "sh") return "bash";
	if (value === "r" || value === "rscript") return "r";
	return "python";
}

function notebookPurposeField(body: Record<string, unknown>): "exploration" | "verification" {
	const value = optionalStringField(body, "purpose")?.toLowerCase();
	return value === "verification" || value === "check" ? "verification" : "exploration";
}

function notebookExecutionModeField(body: Record<string, unknown>): "isolated" | "modal" | "session" | undefined {
	const value = optionalStringField(body, "executionMode")?.toLowerCase();
	if (value === "isolated" || value === "process") return "isolated";
	if (value === "modal" || value === "cloud") return "modal";
	if (value === "session" || value === "kernel") return "session";
	return undefined;
}

function base64Field(body: Record<string, unknown>, key: string): Buffer {
	const value = stringField(body, key).trim();
	if (!value) return Buffer.alloc(0);
	return Buffer.from(value, "base64");
}

function contentDispositionFilename(name: string): string {
	return name.replace(/["\r\n\\]/g, "_");
}

function stateOptions(options: BuildWorkbenchStateOptions) {
	return { workingDir: options.workingDir, ...(options.version ? { version: options.version } : {}), ...(options.settingsPath ? { settingsPath: options.settingsPath } : {}), ...(options.authPath ? { authPath: options.authPath } : {}), ...(options.modelStatus ? { modelStatus: options.modelStatus } : {}) };
}

function buildServedWorkbenchState(options: BuildWorkbenchStateOptions) {
	const state = buildWorkbenchState(stateOptions(options));
	materializeWorkbenchOrgDatabase(state);
	return state;
}

function findArtifactVersion(options: WorkbenchRequestHandlerOptions, body: Record<string, unknown>): WorkbenchArtifactVersion {
	const artifactPath = stringField(body, "artifactPath");
	const versionId = stringField(body, "versionId");
	const state = buildServedWorkbenchState(options);
	const version = state.artifactVersions.find((item) => item.id === versionId && item.artifactPath === artifactPath);
	if (!version) {
		throw new Error("Artifact version was not found.");
	}
	return version;
}

type WorkbenchRequestHandlerOptions = Required<Pick<WorkbenchServerOptions, "workingDir" | "token">> & BuildWorkbenchStateOptions & {
	appRoot?: string;
	settingsPath?: string;
	authPath?: string;
	requireAuth: boolean;
	sessionDir?: string;
	feynmanAgentDir?: string;
	version?: string;
	promptExecutor?: WorkbenchPromptExecutor;
};

function createRequestHandler(options: WorkbenchRequestHandlerOptions): (request: IncomingMessage, response: ServerResponse) => void {
	return (request, response) => {
		void handleWorkbenchRequest(options, request, response).catch((error) => sendWorkbenchRequestError(response, error));
	};
}

async function handleWorkbenchRequest(
	options: WorkbenchRequestHandlerOptions,
	request: IncomingMessage,
	response: ServerResponse,
): Promise<void> {
		const url = new URL(request.url ?? "/", "http://localhost");

		if (url.pathname === "/api/health") {
			sendJson(response, 200, { ok: true });
			return;
		}

		if (url.pathname === "/favicon.ico") {
			send(response, 204, "");
			return;
		}

		if (url.pathname === "/api/connectors/oauth/callback") {
			try {
				const token = await finishWorkbenchOAuthCallback(options.workingDir, {
					code: url.searchParams.get("code") ?? undefined,
					error: url.searchParams.get("error") ?? undefined,
					state: url.searchParams.get("state") ?? undefined,
				});
				send(response, 200, [
					"<!doctype html>",
					"<meta charset=\"utf-8\">",
					"<title>Feynman OAuth connected</title>",
					"<body style=\"font:14px system-ui;background:#0f140d;color:#f1f4e9;padding:24px\">",
					"<h1>OAuth connected</h1>",
					`<p>Connector ${token.connectorId} is connected. You can close this tab and return to Feynman.</p>`,
					"</body>",
				].join(""), { "content-type": "text/html; charset=utf-8" });
			} catch (error) {
				logWorkbenchRequestError(error);
				send(response, 400, [
					"<!doctype html>",
					"<meta charset=\"utf-8\">",
					"<title>Feynman OAuth failed</title>",
					"<body style=\"font:14px system-ui;background:#0f140d;color:#f1f4e9;padding:24px\">",
					"<h1>OAuth failed</h1>",
					"<p>OAuth connection failed. Return to Feynman and try again.</p>",
					"</body>",
				].join(""), { "content-type": "text/html; charset=utf-8" });
			}
			return;
		}

		const headers: Record<string, string> = {};
		if (options.requireAuth) {
			const authorized = isAuthorized(request, url, options.token);
			if (!authorized) {
				send(response, 401, "Unauthorized. Open the URL printed by `feynman serve`.");
				return;
			}

			if (url.searchParams.get("token") === options.token) {
				headers["set-cookie"] = tokenCookie(options.token);
			}
		}

		try {
			if (sendWorkbenchWeb(response, options, url, headers)) {
				return;
			}
			options = { ...options, modelStatus: await loadWorkbenchModelStatus(options) };
			if (url.pathname === "/api/state") {
				sendJson(response, 200, buildServedWorkbenchState(options), headers);
				return;
			}

			if (url.pathname === "/api/read-cursor" && request.method === "POST") {
				const body = expectObject(await readJsonBody(request));
				const messageIndex = optionalNumberField(body, "messageIndex");
				if (messageIndex === undefined) throw new Error("Missing messageIndex.");
				const cursor = upsertWorkbenchFrameReadCursor(options.workingDir, {
					rootFrameId: stringField(body, "rootFrameId"),
					messageId: optionalStringField(body, "messageId"),
					messageIndex,
					messageCount: optionalNumberField(body, "messageCount"),
					projectId: optionalStringField(body, "projectId"),
					runSlug: optionalStringField(body, "runSlug"),
				});
				sendJson(response, 200, {
					cursor,
					state: buildServedWorkbenchState(options),
				}, headers);
				return;
			}

			if (url.pathname === "/api/chat/sessions" && request.method === "GET") {
				sendJson(response, 200, {
					sessions: listWorkbenchChatSessions({ workingDir: options.workingDir, sessionDir: options.sessionDir }),
				}, headers);
				return;
			}

			if (url.pathname === "/api/project/new" && request.method === "POST") {
				const body = expectObject(await readJsonBody(request));
				const project = createWorkbenchProject(options.workingDir, {
					name: stringField(body, "name"),
					description: optionalStringField(body, "description"),
					agentContext: optionalStringField(body, "agentContext"),
				});
				const session = ensureWorkbenchChatSession({ workingDir: options.workingDir, sessionDir: options.sessionDir }, {
					id: newWorkbenchSessionId(),
					projectId: project.id,
					title: project.name,
				});
				sendJson(response, 200, {
					project,
					session,
					state: buildServedWorkbenchState(options),
				}, headers);
				return;
			}

			if (url.pathname === "/api/onboarding/complete" && request.method === "POST") {
				const body = expectObject(await readJsonBody(request, 128 * 1024));
				sendJson(response, 200, completeWorkbenchOnboardingFromRequest({
					workingDir: options.workingDir,
					sessionDir: options.sessionDir,
					version: options.version,
				}, body), headers);
				return;
			}

			if (url.pathname === "/api/chat/session" && request.method === "POST") {
				const body = expectObject(await readJsonBody(request));
				sendJson(response, 200, {
					session: ensureWorkbenchChatSession({ workingDir: options.workingDir, sessionDir: options.sessionDir }, {
						id: stringField(body, "sessionId"),
						projectId: stringField(body, "projectId"),
						title: stringField(body, "title"),
					}),
				}, headers);
				return;
			}

			if (url.pathname === "/api/chat/session/new" && request.method === "POST") {
				const body = expectObject(await readJsonBody(request));
				const session = ensureWorkbenchChatSession({ workingDir: options.workingDir, sessionDir: options.sessionDir }, {
					id: newWorkbenchSessionId(),
					projectId: optionalStringField(body, "projectId") ?? "workspace",
					title: optionalStringField(body, "title") ?? "New research session",
				});
				sendJson(response, 200, {
					session,
					state: buildServedWorkbenchState(options),
				}, headers);
				return;
			}

			if (url.pathname === "/api/chat/message" && request.method === "POST") {
				const body = expectObject(await readJsonBody(request));
				sendJson(response, 200, {
					session: await submitWorkbenchChatMessage({
						workingDir: options.workingDir,
						appRoot: options.appRoot,
						sessionDir: options.sessionDir,
						feynmanAgentDir: options.feynmanAgentDir,
						feynmanVersion: options.version,
						executor: options.promptExecutor,
					}, {
						id: stringField(body, "sessionId"),
						projectId: stringField(body, "projectId"),
						title: stringField(body, "title"),
						message: stringField(body, "message"),
						viewportContext: optionalViewportContext(body),
					}),
				}, headers);
				return;
			}

			if (url.pathname === "/api/chat/message/stream" && request.method === "POST") {
				const body = expectObject(await readJsonBody(request));
				const input = normalizeWorkbenchChatMessageInput({
					id: stringField(body, "sessionId"),
					projectId: stringField(body, "projectId"),
					title: stringField(body, "title"),
					message: stringField(body, "message"),
					viewportContext: optionalViewportContext(body),
				});
				response.setHeader("content-type", "text/event-stream; charset=utf-8");
				response.writeHead(200, {
					"cache-control": "no-store",
					"connection": "keep-alive",
					...headers,
				});
				await streamWorkbenchChatMessage({
					workingDir: options.workingDir,
					appRoot: options.appRoot,
					sessionDir: options.sessionDir,
					feynmanAgentDir: options.feynmanAgentDir,
					feynmanVersion: options.version,
					executor: options.promptExecutor,
				}, input, (event) => {
					sendStreamEvent(response, event.type === "done" || event.type === "error"
						? { ...event, state: buildServedWorkbenchState(options) }
						: event);
				});
				response.end();
				return;
			}

			if (url.pathname === "/api/chat/message/steer" && request.method === "POST") {
				const body = expectObject(await readJsonBody(request));
				sendJson(response, 200, {
					session: await steerWorkbenchChatMessage({
						workingDir: options.workingDir,
						appRoot: options.appRoot,
						sessionDir: options.sessionDir,
						feynmanAgentDir: options.feynmanAgentDir,
						feynmanVersion: options.version,
						executor: options.promptExecutor,
					}, {
						id: stringField(body, "sessionId"),
						projectId: stringField(body, "projectId"),
						title: stringField(body, "title"),
						message: stringField(body, "message"),
						viewportContext: optionalViewportContext(body),
					}),
				}, headers);
				return;
			}

			if (url.pathname === "/api/chat/abort" && request.method === "POST") {
				const body = expectObject(await readJsonBody(request));
				sendJson(response, 200, {
					session: await abortWorkbenchChatMessage({
						workingDir: options.workingDir,
						appRoot: options.appRoot,
						sessionDir: options.sessionDir,
						feynmanAgentDir: options.feynmanAgentDir,
						feynmanVersion: options.version,
						executor: options.promptExecutor,
					}, {
						id: stringField(body, "sessionId"),
						projectId: stringField(body, "projectId"),
						title: stringField(body, "title"),
					}),
				}, headers);
				return;
			}

			if (url.pathname === "/api/chat/plan/generate" && request.method === "POST") {
				const body = expectObject(await readJsonBody(request));
				const result = generateWorkbenchPlan({
					workingDir: options.workingDir,
					sessionDir: options.sessionDir,
					feynmanVersion: options.version,
				}, {
					id: stringField(body, "sessionId"),
					projectId: stringField(body, "projectId"),
					title: stringField(body, "title"),
					runSlug: optionalStringField(body, "runSlug"),
					taskSummary: optionalStringField(body, "taskSummary"),
				});
				sendJson(response, 200, {
					...result,
					state: buildServedWorkbenchState(options),
				}, headers);
				return;
			}

			if (url.pathname === "/api/chat/plan/action" && request.method === "POST") {
				const body = expectObject(await readJsonBody(request));
				const result = updateWorkbenchPlanAction({
					workingDir: options.workingDir,
					sessionDir: options.sessionDir,
					feynmanVersion: options.version,
				}, {
					id: stringField(body, "sessionId"),
					projectId: stringField(body, "projectId"),
					title: stringField(body, "title"),
					action: planActionField(body),
				});
				sendJson(response, 200, {
					...result,
					state: buildServedWorkbenchState(options),
				}, headers);
				return;
			}

			if (url.pathname === "/api/chat/plan/step" && request.method === "POST") {
				const body = expectObject(await readJsonBody(request));
				const result = updateWorkbenchPlanStep({
					workingDir: options.workingDir,
					sessionDir: options.sessionDir,
					feynmanVersion: options.version,
				}, {
					id: stringField(body, "sessionId"),
					projectId: stringField(body, "projectId"),
					title: stringField(body, "title"),
					stepTitle: stringField(body, "stepTitle"),
					status: planStepStatusField(body),
					notes: optionalStringField(body, "notes"),
				});
				sendJson(response, 200, {
					...result,
					state: buildServedWorkbenchState(options),
				}, headers);
				return;
			}

			if (url.pathname === "/api/chat/review/request" && request.method === "POST") {
				const body = expectObject(await readJsonBody(request));
				const state = buildServedWorkbenchState(options);
				const result = await requestWorkbenchReview({
					workingDir: options.workingDir,
					appRoot: options.appRoot,
					sessionDir: options.sessionDir,
					feynmanAgentDir: options.feynmanAgentDir,
					feynmanVersion: options.version,
					executor: options.promptExecutor,
				}, {
					id: stringField(body, "sessionId"),
					projectId: stringField(body, "projectId"),
					title: stringField(body, "title"),
					runSlug: optionalStringField(body, "runSlug"),
					artifactPath: optionalStringField(body, "artifactPath"),
				}, state);
				sendJson(response, 200, {
					...result,
					state: buildServedWorkbenchState(options),
				}, headers);
				return;
			}

			if (url.pathname === "/api/chat/config" && request.method === "POST") {
				const body = expectObject(await readJsonBody(request));
				const config = optionalConfig(body);
				sendJson(response, 200, {
					session: updateWorkbenchChatSessionConfig({ workingDir: options.workingDir, sessionDir: options.sessionDir }, {
						id: stringField(body, "sessionId"),
						projectId: stringField(body, "projectId"),
						title: stringField(body, "title"),
						config,
					}),
				}, headers);
				return;
			}

			if (url.pathname === "/api/resources/package" && request.method === "POST") {
				const body = expectObject(await readJsonBody(request));
				const settings = updateWorkbenchPackageSettings(
					options.workingDir,
					packageActionField(body),
					stringArrayField(body, "sources"),
				);
				sendJson(response, 200, {
					settings,
					state: buildServedWorkbenchState(options),
				}, headers);
				return;
			}

			if (url.pathname === "/api/resources/settings" && request.method === "POST") {
				const body = expectObject(await readJsonBody(request));
				const collection = settingsCollectionField(body);
				const action = settingsActionField(body);
				const settings = action === "remove"
					? removeWorkbenchSettingsRecord(options.workingDir, collection, stringField(body, "id"))
					: upsertWorkbenchSettingsRecord(options.workingDir, { collection, record: settingsRecordField(body) });
				sendJson(response, 200, {
					settings,
					state: buildServedWorkbenchState(options),
				}, headers);
				return;
			}

			if ((url.pathname === "/api/memory" || url.pathname === "/api/notes") && request.method === "POST") {
				const body = expectObject(await readJsonBody(request));
				const action = settingsActionField(body);
				const store = url.pathname === "/api/memory"
					? action === "remove" ? removeWorkbenchMemoryRecord(options.workingDir, stringField(body, "id")) : upsertWorkbenchMemoryRecord(options.workingDir, settingsRecordField(body))
					: action === "remove" ? removeWorkbenchNoteRecord(options.workingDir, stringField(body, "id")) : upsertWorkbenchNoteRecord(options.workingDir, settingsRecordField(body));
				sendJson(response, 200, { memories: store.memories, notes: store.notes, state: buildServedWorkbenchState(options) }, headers);
				return;
			}

			if (url.pathname === "/api/connectors/oauth/start" && request.method === "POST") {
				const body = expectObject(await readJsonBody(request));
				const connector = connectorField(options, body);
				const redirectUri = optionalStringField(body, "redirectUri")
					?? `${requestOrigin(request)}/api/connectors/oauth/callback`;
				const start = createWorkbenchOAuthStart(options.workingDir, connector, redirectUri);
				sendJson(response, 200, {
					authorizationUrl: start.authorizationUrl,
					expiresAtMs: start.expiresAtMs,
					oauthState: start.state,
				}, headers);
				return;
			}

			if (url.pathname === "/api/connectors/oauth/disconnect" && request.method === "POST") {
				const body = expectObject(await readJsonBody(request));
				const connector = connectorField(options, body);
				removeWorkbenchOAuthToken(options.workingDir, connector.id);
				sendJson(response, 200, {
					state: buildServedWorkbenchState(options),
				}, headers);
				return;
			}

			if (url.pathname === "/api/chat/commands" && request.method === "POST") {
				const body = expectObject(await readJsonBody(request));
				const session = ensureWorkbenchChatSession({ workingDir: options.workingDir, sessionDir: options.sessionDir }, {
					id: stringField(body, "sessionId"),
					projectId: stringField(body, "projectId"),
					title: stringField(body, "title"),
				});
				const commands = await listFeynmanWorkbenchCommands({
					workingDir: options.workingDir,
					appRoot: options.appRoot,
					sessionDir: options.sessionDir,
					feynmanAgentDir: options.feynmanAgentDir,
					feynmanVersion: options.version,
					session,
					message: "",
				});
				const commandGroup = buildPiCommandResourceGroup(options.workingDir, commands);
				const state = buildServedWorkbenchState(options);
				sendJson(response, 200, {
					commands,
					commandGroup,
					resources: mergePiCommandResourceGroup(state.resources, commandGroup),
				}, headers);
				return;
			}

			if (url.pathname === "/api/notebook/execute" && request.method === "POST") {
				const body = expectObject(await readJsonBody(request, 256 * 1024));
				const execution = await executeNotebookCell({
					workingDir: options.workingDir,
				}, {
					sessionId: stringField(body, "sessionId"),
					projectId: stringField(body, "projectId"),
					title: stringField(body, "title"),
					runSlug: optionalStringField(body, "runSlug"),
					taskSummary: optionalStringField(body, "taskSummary"),
					language: notebookLanguageField(body),
					executionMode: notebookExecutionModeField(body),
					purpose: notebookPurposeField(body),
					jobId: optionalStringField(body, "jobId"),
					code: stringField(body, "code"),
				});
				sendJson(response, 200, {
					execution,
					state: buildServedWorkbenchState(options),
				}, headers);
				return;
			}

			if (url.pathname === "/api/compute/job/action" && request.method === "POST") {
				const body = expectObject(await readJsonBody(request, 64 * 1024));
				const { action, jobId } = parseWorkbenchComputeJobAction(body);
				if (action === "cancel" || action === "terminate") {
					const result = await cancelNotebookExecution(options.workingDir, jobId);
					sendJson(response, 200, {
						action,
						result,
						state: buildServedWorkbenchState(options),
					}, headers);
					return;
				}
				const record = readNotebookExecutionRecords(options.workingDir).find((item) => item.id === jobId);
				if (!record) {
					throw new Error("Notebook compute job was not found.");
				}
				const execution = await executeNotebookCell({
					workingDir: options.workingDir,
				}, {
					sessionId: record.sessionId,
					projectId: record.projectId,
					title: record.title,
					runSlug: record.runSlug,
					taskSummary: record.taskSummary,
					language: record.language,
					executionMode: record.executionMode,
					purpose: record.purpose,
					code: record.code,
				});
				sendJson(response, 200, {
					action,
					execution,
					state: buildServedWorkbenchState(options),
				}, headers);
				return;
			}

			if (url.pathname === "/api/compute/provider/action" && request.method === "POST") {
				const body = expectObject(await readJsonBody(request, 64 * 1024));
				const { action } = applyWorkbenchComputeProviderAction(options.workingDir, body);
				sendJson(response, 200, {
					action,
					state: buildServedWorkbenchState(options),
				}, headers);
				return;
			}

			if (url.pathname === "/api/notebook/environment" && request.method === "POST") {
				const body = expectObject(await readJsonBody(request, 64 * 1024));
				const action = await manageNotebookEnvironment(options.workingDir, {
					language: optionalStringField(body, "language"),
					mode: optionalStringField(body, "mode"),
					packages: body.packages,
				});
				sendJson(response, 200, {
					action,
					state: buildServedWorkbenchState(options),
				}, headers);
				return;
			}

			if (url.pathname === "/api/artifact/annotation" && request.method === "POST") {
				const body = expectObject(await readJsonBody(request, 64 * 1024));
				const action = annotationActionField(body);
				const annotations = action === "remove"
					? removeWorkbenchArtifactAnnotation(options.workingDir, stringField(body, "id"))
					: upsertWorkbenchArtifactAnnotation(options.workingDir, {
						id: optionalStringField(body, "id"),
						artifactPath: stringField(body, "artifactPath"),
						body: stringField(body, "body"),
						kind: optionalStringField(body, "kind") === "revision" ? "revision" : "note",
						anchorKind: optionalStringField(body, "anchorKind") === "point"
							? "point"
							: optionalStringField(body, "anchorKind") === "region"
								? "region"
								: optionalStringField(body, "anchorKind") === "text_selection"
									? "text_selection"
									: undefined,
						anchorText: optionalStringField(body, "anchorText"),
						startOffset: optionalNumberField(body, "startOffset"),
						endOffset: optionalNumberField(body, "endOffset"),
						startLine: optionalNumberField(body, "startLine"),
						endLine: optionalNumberField(body, "endLine"),
						pageNumber: optionalNumberField(body, "pageNumber"),
						selectionPrefix: optionalStringField(body, "selectionPrefix"),
						xPercent: optionalNumberField(body, "xPercent"),
						yPercent: optionalNumberField(body, "yPercent"),
						widthPercent: optionalNumberField(body, "widthPercent"),
						heightPercent: optionalNumberField(body, "heightPercent"),
						rects: normalizeWorkbenchArtifactAnnotationRects(body.rects),
						sessionId: optionalStringField(body, "sessionId"),
						projectId: optionalStringField(body, "projectId"),
						runSlug: optionalStringField(body, "runSlug"),
					});
				sendJson(response, 200, {
					annotations,
					state: buildServedWorkbenchState(options),
				}, headers);
				return;
			}

			if (url.pathname === "/api/transcript/annotation" && request.method === "POST") {
				const annotations = mutateWorkbenchTranscriptAnnotation(options.workingDir, expectObject(await readJsonBody(request, 64 * 1024)));
				sendJson(response, 200, { annotations, state: buildServedWorkbenchState(options) }, headers);
				return;
			}

			if (url.pathname === "/api/artifact/action" && request.method === "POST") {
				const body = expectObject(await readJsonBody(request, 64 * 1024));
				const action = updateWorkbenchArtifactAction(options.workingDir, {
					artifactPath: stringField(body, "artifactPath"),
					action: artifactActionField(body),
					displayName: optionalStringField(body, "displayName"),
				});
				sendJson(response, 200, {
					action,
					state: buildServedWorkbenchState(options),
				}, headers);
				return;
			}

			if (url.pathname === "/api/artifact/edit" && request.method === "GET") {
				const path = url.searchParams.get("path");
				if (!path) {
					send(response, 400, "Missing artifact path.");
					return;
				}
				sendJson(response, 200, {
					artifact: readWorkbenchEditableArtifact(options.workingDir, path),
				}, headers);
				return;
			}

			if (url.pathname === "/api/artifact/edit" && request.method === "POST") {
				const body = expectObject(await readJsonBody(request, MAX_ARTIFACT_EDIT_BYTES + 64 * 1024));
				const edit = updateWorkbenchArtifactContent(options.workingDir, {
					artifactPath: stringField(body, "artifactPath"),
					content: stringField(body, "content"),
				});
				sendJson(response, 200, {
					edit,
					state: buildServedWorkbenchState(options),
				}, headers);
				return;
			}

			if (url.pathname === "/api/artifact/refinement/suggest" && request.method === "POST") {
				const body = expectObject(await readJsonBody(request, MAX_ARTIFACT_EDIT_BYTES + 64 * 1024));
				const suggestion = await suggestWorkbenchArtifactRefinement({
					workingDir: options.workingDir,
					appRoot: options.appRoot,
					sessionDir: options.sessionDir,
					feynmanAgentDir: options.feynmanAgentDir,
					feynmanVersion: options.version,
					executor: options.promptExecutor,
				}, {
					artifactPath: stringField(body, "artifactPath"),
					currentIteration: optionalStringField(body, "currentIteration"),
					endOffset: optionalNumberField(body, "endOffset"),
					instruction: stringField(body, "instruction"),
					mode: artifactRefinementModeField(body),
					projectId: stringField(body, "projectId"),
					selectedText: stringField(body, "selectedText"),
					sessionId: stringField(body, "sessionId"),
					startOffset: optionalNumberField(body, "startOffset"),
					title: stringField(body, "title"),
				});
				sendJson(response, 200, { suggestion }, headers);
				return;
			}

			if (url.pathname === "/api/artifact/refinement/apply" && request.method === "POST") {
				const body = expectObject(await readJsonBody(request, MAX_ARTIFACT_EDIT_BYTES + 64 * 1024));
				const edit = applyWorkbenchArtifactRefinement(options.workingDir, {
					artifactPath: stringField(body, "artifactPath"),
					endOffset: optionalNumberField(body, "endOffset"),
					replacementText: stringField(body, "replacementText"),
					selectedText: stringField(body, "selectedText"),
					startOffset: optionalNumberField(body, "startOffset"),
				});
				sendJson(response, 200, {
					edit,
					state: buildServedWorkbenchState(options),
				}, headers);
				return;
			}

			if (url.pathname === "/api/artifact/export-cloud" && request.method === "POST") {
				const body = expectObject(await readJsonBody(request, 64 * 1024));
				const exportRecord = await exportWorkbenchArtifactToCloud(options.workingDir, {
					artifactPath: stringField(body, "artifactPath"),
					credentialId: stringField(body, "credentialId"),
					destinationPath: optionalStringField(body, "destinationPath"),
				});
				sendJson(response, 200, {
					export: exportRecord,
					state: buildServedWorkbenchState(options),
				}, headers);
				return;
			}

			if (url.pathname === "/api/artifact/version/diff" && request.method === "POST") {
				const body = expectObject(await readJsonBody(request));
				const version = findArtifactVersion(options, body);
				sendJson(response, 200, {
					diff: diffArtifactVersionSnapshot(options.workingDir, version),
				}, headers);
				return;
			}

			if (url.pathname === "/api/artifact/version/restore" && request.method === "POST") {
				const body = expectObject(await readJsonBody(request));
				const version = findArtifactVersion(options, body);
				const restore = restoreArtifactVersionSnapshot(options.workingDir, version);
				sendJson(response, 200, {
					restore,
					state: buildServedWorkbenchState(options),
				}, headers);
				return;
			}

			if (url.pathname === "/api/chat/attachment" && request.method === "POST") {
				const body = expectObject(await readJsonBody(request, MAX_WORKBENCH_ATTACHMENT_BYTES * 2));
				sendJson(response, 200, {
					session: addWorkbenchChatAttachment({ workingDir: options.workingDir, sessionDir: options.sessionDir }, {
						id: stringField(body, "sessionId"),
						projectId: stringField(body, "projectId"),
						title: stringField(body, "title"),
						name: stringField(body, "name"),
						contentType: optionalStringField(body, "contentType"),
						data: base64Field(body, "contentBase64"),
					}),
				}, headers);
				return;
			}

			if (url.pathname === "/api/chat/attachment/delete" && request.method === "POST") {
				const body = expectObject(await readJsonBody(request));
				sendJson(response, 200, {
					session: removeWorkbenchChatAttachment({ workingDir: options.workingDir, sessionDir: options.sessionDir }, {
						id: stringField(body, "sessionId"),
						projectId: stringField(body, "projectId"),
						title: stringField(body, "title"),
						attachmentId: stringField(body, "attachmentId"),
					}),
				}, headers);
				return;
				}

				if (url.pathname === "/api/chat/attachment/download") {
					const query = Object.fromEntries(url.searchParams);
					const attachment = readWorkbenchChatAttachmentDownload({ workingDir: options.workingDir, sessionDir: options.sessionDir }, {
						id: stringField(query, "sessionId"),
						projectId: stringField(query, "projectId"),
						title: stringField(query, "title"),
						attachmentId: stringField(query, "attachmentId"),
					});
					response.writeHead(200, {
						"cache-control": "no-store",
						"content-type": attachment.contentType,
						"content-length": String(attachment.sizeBytes),
						"content-disposition": `attachment; filename="${contentDispositionFilename(attachment.name)}"`,
						...headers,
					});
					response.end(attachment.buffer);
					return;
				}

				if (url.pathname === "/api/file") {
					const path = url.searchParams.get("path");
				if (!path) {
					send(response, 400, "Missing artifact path.");
					return;
				}
				sendJson(response, 200, readWorkbenchFile(options.workingDir, path), headers);
				return;
			}

			if (url.pathname === "/api/file/pdf-text") {
				const path = url.searchParams.get("path");
				if (!path) {
					send(response, 400, "Missing artifact path.");
					return;
				}
				sendJson(response, 200, await readWorkbenchPdfText(options.workingDir, path), headers);
				return;
			}

			if (url.pathname === "/api/file/download") {
				const path = url.searchParams.get("path");
				if (!path) {
					send(response, 400, "Missing artifact path.");
					return;
				}
				const file = readWorkbenchFileDownload(options.workingDir, path);
				response.writeHead(200, {
					"cache-control": "no-store",
					"content-type": file.contentType,
					"content-length": String(file.buffer.length),
					"content-disposition": `attachment; filename="${contentDispositionFilename(file.name)}"`,
					...headers,
				});
				response.end(file.buffer);
				return;
			}

			send(response, 404, "Not found.");
		} catch (error) {
			sendWorkbenchRequestError(response, error);
		}
}

function listen(server: Server, port: number, host: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const onError = (error: Error) => {
			server.off("listening", onListening);
			reject(error);
		};
		const onListening = () => {
			server.off("error", onError);
			resolve();
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(port, host);
	});
}

export async function startWorkbenchServer(options: WorkbenchServerOptions): Promise<WorkbenchServerHandle> {
	if (options.appRoot) {
		ensureOpenScienceSeedFixtures({
			appRoot: options.appRoot,
			workingDir: options.workingDir,
		});
	}

	const requireAuth = options.requireAuth !== false;
	const token = requireAuth ? options.token ?? randomBytes(24).toString("base64url") : "";
	const host = normalizeHost(options.host);
	const requestedPort = options.port ?? 6174;
	const server = createServer(createRequestHandler({
		appRoot: options.appRoot,
		sessionDir: options.sessionDir,
		feynmanAgentDir: options.feynmanAgentDir,
		settingsPath: options.settingsPath,
		authPath: options.authPath,
		requireAuth,
		workingDir: options.workingDir,
		token,
		...(options.version ? { version: options.version } : {}),
		promptExecutor: options.promptExecutor,
	}));
	try {
		await listen(server, requestedPort, host);
	} catch (error) {
		if (requestedPort !== 0 && (error as NodeJS.ErrnoException).code === "EADDRINUSE") {
			await listen(server, 0, host);
		} else {
			throw error;
		}
	}

	const address = server.address() as AddressInfo;
	const url = `http://${hostForUrl(host)}:${address.port}/`;
	return {
		server,
		url,
		openUrl: requireAuth ? `${url}?token=${encodeURIComponent(token)}` : url,
		token,
		close: () => new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		}).finally(() => Promise.all([
			closeWorkbenchPiRpcClients(),
			closeNotebookKernelSessions(),
		]).then(() => undefined)),
	};
}

export async function serveWorkbench(options: ServeWorkbenchOptions): Promise<void> {
	const handle = await startWorkbenchServer(options);
	console.log("Feynman workbench running");
	console.log(`URL: ${handle.openUrl}`);
	console.log(`Workspace: ${options.workingDir}`);
	console.log("Press Ctrl+C to stop.");
	if (options.shouldOpen !== false) {
		openUrl(handle.openUrl);
	}

	await new Promise<void>((resolve) => {
		const stop = () => {
			void handle.close().finally(resolve);
		};
		process.once("SIGINT", stop);
		process.once("SIGTERM", stop);
	});
}
