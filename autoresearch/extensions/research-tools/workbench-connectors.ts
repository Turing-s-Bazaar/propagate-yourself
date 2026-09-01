import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { migratedWorkbenchDataPath } from "../../src/workbench/data-root.js";
import { authorizationHeaderForConnector } from "../../src/workbench/oauth-store.js";
import { upsertWorkbenchSettingsRecord } from "../../src/workbench/settings-store.js";

type WorkbenchConnectorTransport = "local" | "sse" | "streamable_http";

type WorkbenchCustomConnector = {
	assignedSpecialists?: string[] | string;
	clientId?: string;
	command?: string;
	description?: string;
	env?: string;
	excludedTools?: string[] | string;
	headersHelper?: string;
	id?: string;
	name?: string;
	oauthServerUrl?: string;
	scopes?: string;
	skipApprovals?: boolean;
	transport?: string;
	url?: string;
};

type WorkbenchPermissionGrant = {
	description?: string;
	decision?: string;
	id?: string;
	name?: string;
	scope?: string;
};

type WorkbenchSettings = {
	customConnectors?: WorkbenchCustomConnector[];
	permissionGrants?: WorkbenchPermissionGrant[];
};

type ConnectorToolGrantDecision = "allow" | "ask" | "deny";

type ConnectorToolRecord = {
	assignedSpecialists?: string[];
	connectorId: string;
	connectorName: string;
	description?: string;
	excludedTools?: string[];
	grantDecision: ConnectorToolGrantDecision;
	inputSchema?: unknown;
	toolName: string;
};

type NormalizedConnector = {
	assignedSpecialists?: string[];
	command?: string;
	description?: string;
	env?: string;
	excludedTools?: string[];
	headersHelper?: string;
	id: string;
	name: string;
	oauthServerUrl?: string;
	skipApprovals?: boolean;
	transport: WorkbenchConnectorTransport;
	url?: string;
};

type JsonRpcRequest = {
	id?: string;
	jsonrpc: "2.0";
	method: string;
	params?: Record<string, unknown>;
};

type HttpMcpSession = {
	headers: Record<string, string>;
	kind: "http";
	protocolVersion: string;
	sessionId?: string;
	url: URL;
};

type LocalMcpPendingRequest = {
	reject: (error: Error) => void;
	resolve: (result: unknown) => void;
	timeout: NodeJS.Timeout;
};

type LocalMcpSession = {
	buffer: string;
	child: ReturnType<typeof spawn>;
	closed: boolean;
	kind: "local";
	pending: Map<string, LocalMcpPendingRequest>;
	protocolVersion: string;
	stderr: string;
};

type SseMcpSession = {
	buffer: string;
	closed: boolean;
	controller: AbortController;
	endpoint?: URL;
	endpointPromise: Promise<void>;
	endpointReject: (error: Error) => void;
	endpointResolve: () => void;
	headers: Record<string, string>;
	kind: "sse";
	pending: Map<string, LocalMcpPendingRequest>;
	protocolVersion: string;
	readerDone?: Promise<void>;
	url: URL;
};

type McpSession = HttpMcpSession | LocalMcpSession | SseMcpSession;

const MCP_PROTOCOL_VERSION = "2025-06-18";
const CONNECTOR_TIMEOUT_MS = 60_000;
const HEADERS_HELPER_TIMEOUT_MS = 5_000;
const MAX_HELPER_OUTPUT_BYTES = 64_000;
const MAX_RESPONSE_CHARS = 120_000;
const MAX_LOCAL_STDERR_CHARS = 16_000;

function settingsPath(cwd: string): string {
	return migratedWorkbenchDataPath(cwd, "settings.json");
}

function readSettings(cwd: string): WorkbenchSettings {
	const path = settingsPath(cwd);
	if (!existsSync(path)) return {};
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as WorkbenchSettings : {};
	} catch {
		return {};
	}
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function arrayValue(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function stringListValue(value: unknown): string[] {
	const rawItems = Array.isArray(value)
		? value.flatMap((item) => typeof item === "string" ? item.split(/[,\n]/) : [])
		: typeof value === "string"
			? value.split(/[,\n]/)
			: [];
	const seen = new Set<string>();
	const items: string[] = [];
	for (const rawItem of rawItems) {
		const item = rawItem.trim();
		if (!item || seen.has(item)) continue;
		seen.add(item);
		items.push(item);
	}
	return items;
}

function normalizeDecision(value: unknown): ConnectorToolGrantDecision {
	if (value === "allow" || value === "deny" || value === "ask") return value;
	return "ask";
}

function normalizeTransport(value: unknown): WorkbenchConnectorTransport {
	if (value === "local" || value === "sse" || value === "streamable_http") return value;
	return "streamable_http";
}

function normalizeConnector(connector: WorkbenchCustomConnector): NormalizedConnector | undefined {
	const name = stringValue(connector.name);
	if (!name) return undefined;
	const transport = normalizeTransport(connector.transport);
	const id = stringValue(connector.id) ?? name;
	const url = stringValue(connector.url);
	const command = stringValue(connector.command);
	const assignedSpecialists = stringListValue(connector.assignedSpecialists);
	const excludedTools = stringListValue(connector.excludedTools);
	if (transport !== "local" && !url) return undefined;
	if (transport === "local" && !command) return undefined;
	return {
		id,
		name,
		transport,
		...(command ? { command } : {}),
		...(stringValue(connector.description) ? { description: stringValue(connector.description) } : {}),
		...(assignedSpecialists.length ? { assignedSpecialists } : {}),
		...(excludedTools.length ? { excludedTools } : {}),
		...(stringValue(connector.env) ? { env: stringValue(connector.env) } : {}),
		...(url ? { url } : {}),
		...(stringValue(connector.headersHelper) ? { headersHelper: stringValue(connector.headersHelper) } : {}),
		...(stringValue(connector.oauthServerUrl) ? { oauthServerUrl: stringValue(connector.oauthServerUrl) } : {}),
		...(connector.skipApprovals === true ? { skipApprovals: true } : {}),
	};
}

function findConnector(settings: WorkbenchSettings, connectorIdOrName: string): NormalizedConnector {
	const needle = connectorIdOrName.trim().toLowerCase();
	const connector = (settings.customConnectors ?? [])
		.map(normalizeConnector)
		.find((candidate): candidate is NormalizedConnector => {
			if (!candidate) return false;
			return candidate.id.toLowerCase() === needle || candidate.name.toLowerCase() === needle;
		});
	if (!connector) {
		throw new Error(`Unknown connector: ${connectorIdOrName}`);
	}
	return connector;
}

function normalizeSpecialistName(value: string | undefined): string | undefined {
	const specialist = value?.trim();
	if (!specialist || specialist.toLowerCase() === "none") return undefined;
	return specialist.toLowerCase();
}

function connectorAvailableForSpecialist(connector: NormalizedConnector, specialist: string | undefined): boolean {
	const assigned = connector.assignedSpecialists ?? [];
	if (!assigned.length) return true;
	const normalized = normalizeSpecialistName(specialist);
	if (!normalized) return true;
	return assigned.some((candidate) => candidate.trim().toLowerCase() === normalized);
}

function assertConnectorAssigned(connector: NormalizedConnector, specialist: string | undefined): void {
	if (connectorAvailableForSpecialist(connector, specialist)) return;
	const assigned = connector.assignedSpecialists?.join(", ") || "no specialists";
	throw new Error(`Connector ${connector.name} is assigned to ${assigned}; it is not available to specialist ${specialist}.`);
}

function isExcludedTool(connector: NormalizedConnector, toolName: string): boolean {
	return (connector.excludedTools ?? []).some((candidate) => candidate === toolName);
}

function assertToolNotExcluded(connector: NormalizedConnector, toolName: string): void {
	if (!isExcludedTool(connector, toolName)) return;
	throw new Error(`Connector tool ${toolName} is excluded for connector ${connector.name} by Workbench settings.`);
}

function connectorGrantDecision(
	settings: WorkbenchSettings,
	connectorId: string,
	toolName: string,
): ConnectorToolGrantDecision {
	const connector = (settings.customConnectors ?? [])
		.map(normalizeConnector)
		.filter((candidate): candidate is NormalizedConnector => Boolean(candidate))
		.find((candidate) => candidate.id === connectorId);
	if (connector?.skipApprovals) return "allow";
	const grants = settings.permissionGrants ?? [];
	const scopes = [
		`connector:${connectorId}:${toolName}`,
		`connector:${connectorId}:*`,
	];
	for (const scope of scopes) {
		const grant = grants.find((candidate) => stringValue(candidate.scope) === scope);
		if (grant) return normalizeDecision(grant.decision);
	}
	return "ask";
}

function permissionGrantId(connectorId: string, toolName: string): string {
	return `connector-${connectorId}-${toolName}`
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 127) || "connector-tool-request";
}

function createPendingToolGrant(cwd: string, connector: NormalizedConnector, toolName: string): WorkbenchPermissionGrant {
	const scope = `connector:${connector.id}:${toolName}`;
	const record = {
		id: permissionGrantId(connector.id, toolName),
		name: `${connector.name} ${toolName}`,
		scope,
		decision: "ask",
		description: `Pending approval requested by feynman_connector_call for ${connector.name}.`,
	};
	upsertWorkbenchSettingsRecord(cwd, {
		collection: "permissionGrants",
		record,
	});
	return record;
}

function assertExecutableConnector(connector: NormalizedConnector): void {
	if (connector.transport === "local") {
		if (!connector.command) throw new Error(`Connector ${connector.name} has no local command.`);
		return;
	}
	if (!connector.url) throw new Error(`Connector ${connector.name} has no URL.`);
	const url = new URL(connector.url);
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new Error(`Connector ${connector.name} must use http or https.`);
	}
}

function parseConnectorEnv(env: string | undefined): Record<string, string> {
	const parsed: Record<string, string> = {};
	for (const rawLine of env?.split(/\r?\n/) ?? []) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const equalsIndex = line.indexOf("=");
		if (equalsIndex <= 0) {
			throw new Error("Connector environment variables must use KEY=value lines.");
		}
		const key = line.slice(0, equalsIndex).trim();
		const value = line.slice(equalsIndex + 1);
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
			throw new Error(`Invalid connector environment variable name: ${key}`);
		}
		parsed[key] = value;
	}
	return parsed;
}

function assertAllowedTool(cwd: string, settings: WorkbenchSettings, connector: NormalizedConnector, toolName: string): ConnectorToolGrantDecision {
	const decision = connectorGrantDecision(settings, connector.id, toolName);
	if (decision === "allow") return decision;
	const scope = `connector:${connector.id}:${toolName}`;
	if (decision === "deny") {
		throw new Error(`Connector tool ${toolName} is denied by grant scope ${scope}.`);
	}
	const request = createPendingToolGrant(cwd, connector, toolName);
	throw new Error(`Connector tool ${toolName} is waiting for approval. A pending ask grant was added in Workbench Settings > Permissions with scope ${request.scope}; approve it, block it, or enable skip approvals on ${connector.name}.`);
}

function parseHeadersHelperOutput(stdout: string): Record<string, string> {
	const trimmed = stdout.trim();
	if (!trimmed) return {};
	const parsed = JSON.parse(trimmed) as unknown;
	const source = recordValue(recordValue(parsed)?.headers) ?? recordValue(parsed);
	if (!source) throw new Error("Headers helper must print a JSON object.");
	const headers: Record<string, string> = {};
	for (const [key, value] of Object.entries(source)) {
		if (typeof value !== "string") continue;
		const headerName = key.trim();
		if (/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(headerName)) {
			headers[headerName] = value;
		}
	}
	return headers;
}

async function runHeadersHelper(command: string, cwd: string): Promise<Record<string, string>> {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, {
			cwd,
			env: process.env,
			shell: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let settled = false;
		const timeout = setTimeout(() => {
			if (settled) return;
			settled = true;
			child.kill("SIGTERM");
			reject(new Error("Connector headers helper timed out."));
		}, HEADERS_HELPER_TIMEOUT_MS);

		const fail = (error: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			reject(error);
		};

		child.stdout?.on("data", (chunk: Buffer | string) => {
			stdout += String(chunk);
			if (Buffer.byteLength(stdout) > MAX_HELPER_OUTPUT_BYTES) {
				fail(new Error("Connector headers helper printed too much output."));
			}
		});
		child.stderr?.on("data", (chunk: Buffer | string) => {
			stderr += String(chunk);
			if (Buffer.byteLength(stderr) > MAX_HELPER_OUTPUT_BYTES) {
				fail(new Error("Connector headers helper printed too much error output."));
			}
		});
		child.on("error", fail);
		child.on("exit", (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			if (code !== 0) {
				reject(new Error("Connector headers helper failed."));
				return;
			}
			try {
				resolvePromise(parseHeadersHelperOutput(stdout));
			} catch (error) {
				reject(error instanceof Error ? error : new Error("Connector headers helper output was invalid."));
			}
		});
	});
}

function boundedText(value: string): string {
	return value.length <= MAX_RESPONSE_CHARS
		? value
		: `${value.slice(0, MAX_RESPONSE_CHARS)}\n[connector response truncated]`;
}

function parseSseJsonMessages(text: string): unknown[] {
	const messages: unknown[] = [];
	let dataLines: string[] = [];
	const flush = () => {
		if (!dataLines.length) return;
		const payload = dataLines.join("\n").trim();
		dataLines = [];
		if (!payload || payload === "[DONE]") return;
		messages.push(JSON.parse(payload) as unknown);
	};
	for (const rawLine of text.split(/\r?\n/)) {
		if (!rawLine.trim()) {
			flush();
			continue;
		}
		if (rawLine.startsWith("data:")) {
			dataLines.push(rawLine.slice(5).trimStart());
		}
	}
	flush();
	return messages;
}

function findJsonRpcResponse(payload: unknown, id: string): Record<string, unknown> | undefined {
	if (Array.isArray(payload)) {
		return payload.map((item) => findJsonRpcResponse(item, id)).find(Boolean);
	}
	const record = recordValue(payload);
	if (!record) return undefined;
	return record.id === id ? record : undefined;
}

function parseJsonRpcResponse(text: string, contentType: string, id: string): unknown {
	const trimmed = text.trim();
	if (!trimmed) throw new Error("Connector returned an empty MCP response.");
	const payloads = contentType.includes("text/event-stream") || trimmed.startsWith("event:") || trimmed.startsWith("data:")
		? parseSseJsonMessages(trimmed)
		: [JSON.parse(trimmed) as unknown];
	for (const payload of payloads) {
		const response = findJsonRpcResponse(payload, id);
		if (!response) continue;
		const error = recordValue(response.error);
		if (error) {
			throw new Error(`Connector MCP error: ${stringValue(error.message) ?? JSON.stringify(error)}`);
		}
		return response.result;
	}
	throw new Error("Connector response did not include the expected MCP request id.");
}

async function postHttpMcpMessage(
	session: HttpMcpSession,
	message: JsonRpcRequest,
	options: { expectResponse: boolean },
): Promise<unknown> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), CONNECTOR_TIMEOUT_MS);
	try {
		const headers = {
			Accept: "application/json, text/event-stream",
			"Content-Type": "application/json",
			"MCP-Protocol-Version": session.protocolVersion,
			...session.headers,
			...(session.sessionId ? { "Mcp-Session-Id": session.sessionId } : {}),
		};
		const response = await fetch(session.url, {
			body: JSON.stringify(message),
			headers,
			method: "POST",
			signal: controller.signal,
		});
		const responseText = await response.text();
		const nextSessionId = response.headers.get("mcp-session-id");
		if (nextSessionId) session.sessionId = nextSessionId;
		if (!response.ok) {
			throw new Error(`Connector MCP request failed: ${response.status} ${response.statusText}`);
		}
		if (!options.expectResponse) return undefined;
		return parseJsonRpcResponse(responseText, response.headers.get("content-type") ?? "", message.id ?? "");
	} finally {
		clearTimeout(timeout);
	}
}

function parseSseEventBlock(block: string): { data: string; event: string } | undefined {
	let event = "message";
	const dataLines: string[] = [];
	for (const rawLine of block.split("\n")) {
		if (!rawLine || rawLine.startsWith(":")) continue;
		const colonIndex = rawLine.indexOf(":");
		const field = colonIndex === -1 ? rawLine : rawLine.slice(0, colonIndex);
		const rawValue = colonIndex === -1 ? "" : rawLine.slice(colonIndex + 1);
		const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
		if (field === "event") event = value;
		if (field === "data") dataLines.push(value);
	}
	if (!dataLines.length) return undefined;
	return { event, data: dataLines.join("\n") };
}

function rejectSsePending(session: SseMcpSession, error: Error): void {
	for (const pending of session.pending.values()) {
		clearTimeout(pending.timeout);
		pending.reject(error);
	}
	session.pending.clear();
}

function handleSseMessage(session: SseMcpSession, data: string): void {
	let payload: unknown;
	try {
		payload = JSON.parse(data) as unknown;
	} catch (error) {
		rejectSsePending(session, error instanceof Error ? error : new Error("SSE MCP connector returned invalid JSON."));
		return;
	}
	for (const [id, pending] of session.pending.entries()) {
		const response = findJsonRpcResponse(payload, id);
		if (!response) continue;
		session.pending.delete(id);
		clearTimeout(pending.timeout);
		const error = recordValue(response.error);
		if (error) {
			pending.reject(new Error(`Connector MCP error: ${stringValue(error.message) ?? JSON.stringify(error)}`));
			continue;
		}
		pending.resolve(response.result);
	}
}

function handleSseEvent(session: SseMcpSession, event: string, data: string): void {
	if (event === "endpoint") {
		try {
			const endpoint = new URL(data, session.url);
			if (endpoint.origin !== session.url.origin) {
				throw new Error(`Endpoint origin does not match connection origin: ${endpoint.origin}`);
			}
			session.endpoint = endpoint;
			session.endpointResolve();
		} catch (error) {
			const parsedError = error instanceof Error ? error : new Error("SSE MCP connector returned an invalid endpoint.");
			session.endpointReject(parsedError);
			rejectSsePending(session, parsedError);
			session.controller.abort();
		}
		return;
	}
	if (event === "message") {
		handleSseMessage(session, data);
	}
}

function appendSseStreamText(session: SseMcpSession, text: string): void {
	session.buffer += text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	let separator = session.buffer.indexOf("\n\n");
	while (separator !== -1) {
		const block = session.buffer.slice(0, separator);
		session.buffer = session.buffer.slice(separator + 2);
		const parsed = parseSseEventBlock(block);
		if (parsed) handleSseEvent(session, parsed.event, parsed.data);
		separator = session.buffer.indexOf("\n\n");
	}
}

async function readSseStream(session: SseMcpSession): Promise<void> {
	try {
		const response = await fetch(session.url, {
			headers: {
				Accept: "text/event-stream",
				"MCP-Protocol-Version": session.protocolVersion,
				...session.headers,
			},
			method: "GET",
			signal: session.controller.signal,
		});
		if (!response.ok) {
			throw new Error(`SSE MCP connector stream failed: ${response.status} ${response.statusText}`);
		}
		if (!response.body) throw new Error("SSE MCP connector did not return an event stream.");
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			appendSseStreamText(session, decoder.decode(value, { stream: true }));
		}
		const tail = decoder.decode();
		if (tail) appendSseStreamText(session, tail);
		throw new Error("SSE MCP connector stream closed.");
	} catch (error) {
		if (session.closed) return;
		const streamError = error instanceof Error ? error : new Error("SSE MCP connector stream failed.");
		if (!session.endpoint) session.endpointReject(streamError);
		rejectSsePending(session, streamError);
	}
}

async function waitForSseEndpoint(session: SseMcpSession): Promise<void> {
	let timeout: NodeJS.Timeout | undefined;
	try {
		await Promise.race([
			session.endpointPromise,
			new Promise<void>((_resolve, reject) => {
				timeout = setTimeout(() => reject(new Error("SSE MCP connector timed out waiting for endpoint.")), CONNECTOR_TIMEOUT_MS);
			}),
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

async function sendSseMcpMessage(
	session: SseMcpSession,
	message: JsonRpcRequest,
	options: { expectResponse: boolean },
): Promise<unknown> {
	if (session.closed) throw new Error("SSE MCP connector session is closed.");
	if (!session.endpoint) await waitForSseEndpoint(session);
	if (!session.endpoint) throw new Error("SSE MCP connector did not provide an endpoint.");

	let responsePromise: Promise<unknown> | undefined;
	let id: string | undefined;
	if (options.expectResponse) {
		if (message.id === undefined) throw new Error("SSE MCP request needs an id.");
		id = String(message.id);
		responsePromise = new Promise((resolvePromise, reject) => {
			const timeout = setTimeout(() => {
				session.pending.delete(id!);
				reject(new Error("SSE MCP connector timed out."));
			}, CONNECTOR_TIMEOUT_MS);
			session.pending.set(id!, { resolve: resolvePromise, reject, timeout });
		});
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), CONNECTOR_TIMEOUT_MS);
	try {
		const response = await fetch(session.endpoint, {
			body: JSON.stringify(message),
			headers: {
				"Content-Type": "application/json",
				"MCP-Protocol-Version": session.protocolVersion,
				...session.headers,
			},
			method: "POST",
			signal: controller.signal,
		});
		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new Error(`SSE MCP connector POST failed: ${response.status} ${response.statusText}${text ? ` ${text}` : ""}`);
		}
		await response.body?.cancel().catch(() => undefined);
		if (!responsePromise) return undefined;
		return await responsePromise;
	} catch (error) {
		if (id) {
			const pending = session.pending.get(id);
			session.pending.delete(id);
			if (pending) clearTimeout(pending.timeout);
		}
		throw error;
	} finally {
		clearTimeout(timeout);
	}
}

function rejectLocalPending(session: LocalMcpSession, error: Error): void {
	for (const pending of session.pending.values()) {
		clearTimeout(pending.timeout);
		pending.reject(error);
	}
	session.pending.clear();
}

function handleLocalMcpLine(session: LocalMcpSession, line: string): void {
	if (!line.trim()) return;
	let message: Record<string, unknown>;
	try {
		message = JSON.parse(line) as Record<string, unknown>;
	} catch (error) {
		rejectLocalPending(session, error instanceof Error ? error : new Error("Local MCP connector returned invalid JSON."));
		return;
	}
	const id = typeof message.id === "string" || typeof message.id === "number" ? String(message.id) : undefined;
	if (!id) return;
	const pending = session.pending.get(id);
	if (!pending) return;
	session.pending.delete(id);
	clearTimeout(pending.timeout);
	const error = recordValue(message.error);
	if (error) {
		pending.reject(new Error(`Connector MCP error: ${stringValue(error.message) ?? JSON.stringify(error)}`));
		return;
	}
	pending.resolve(message.result);
}

function appendLocalMcpStdout(session: LocalMcpSession, chunk: Buffer | string): void {
	session.buffer += String(chunk);
	let newline = session.buffer.indexOf("\n");
	while (newline !== -1) {
		const line = session.buffer.slice(0, newline).replace(/\r$/, "");
		session.buffer = session.buffer.slice(newline + 1);
		handleLocalMcpLine(session, line);
		newline = session.buffer.indexOf("\n");
	}
}

async function sendLocalMcpMessage(
	session: LocalMcpSession,
	message: JsonRpcRequest,
	options: { expectResponse: boolean },
): Promise<unknown> {
	if (session.closed || !session.child.stdin?.writable) {
		throw new Error("Local MCP connector is not running.");
	}
	const stdin = session.child.stdin;
	const serialized = `${JSON.stringify(message)}\n`;
	if (!options.expectResponse) {
		await new Promise<void>((resolvePromise, reject) => {
			stdin.write(serialized, (error) => error ? reject(error) : resolvePromise());
		});
		return undefined;
	}
	if (message.id === undefined) throw new Error("Local MCP request needs an id.");
	const id = String(message.id);
	return new Promise((resolvePromise, reject) => {
		const timeout = setTimeout(() => {
			session.pending.delete(id);
			reject(new Error("Local MCP connector timed out."));
		}, CONNECTOR_TIMEOUT_MS);
		session.pending.set(id, { resolve: resolvePromise, reject, timeout });
		stdin.write(serialized, (error) => {
			if (!error) return;
			const pending = session.pending.get(id);
			session.pending.delete(id);
			if (pending) clearTimeout(pending.timeout);
			reject(error);
		});
	});
}

async function openLocalMcpSession(connector: NormalizedConnector, cwd: string): Promise<LocalMcpSession> {
	if (!connector.command) throw new Error(`Connector ${connector.name} has no local command.`);
	const child = spawn(connector.command, {
		cwd,
		env: {
			...process.env,
			...parseConnectorEnv(connector.env),
		},
		shell: true,
		stdio: ["pipe", "pipe", "pipe"],
	});
	const session: LocalMcpSession = {
		buffer: "",
		child,
		closed: false,
		kind: "local",
		pending: new Map(),
		protocolVersion: MCP_PROTOCOL_VERSION,
		stderr: "",
	};
	child.stdout?.on("data", (chunk: Buffer | string) => {
		appendLocalMcpStdout(session, chunk);
	});
	child.stderr?.on("data", (chunk: Buffer | string) => {
		session.stderr = `${session.stderr}${String(chunk)}`.slice(-MAX_LOCAL_STDERR_CHARS);
	});
	child.on("error", (error) => {
		rejectLocalPending(session, error);
	});
	child.on("exit", () => {
		session.closed = true;
		rejectLocalPending(session, new Error("Local MCP connector exited before responding."));
	});
	const init = await sendLocalMcpMessage(session, {
		id: "feynman_initialize",
		jsonrpc: "2.0",
		method: "initialize",
		params: {
			capabilities: {},
			clientInfo: {
				name: "feynman-workbench",
				version: process.env.FEYNMAN_VERSION ?? "dev",
			},
			protocolVersion: MCP_PROTOCOL_VERSION,
		},
	}, { expectResponse: true });
	const protocolVersion = stringValue(recordValue(init)?.protocolVersion);
	if (protocolVersion) session.protocolVersion = protocolVersion;
	await sendLocalMcpMessage(session, {
		jsonrpc: "2.0",
		method: "notifications/initialized",
	}, { expectResponse: false });
	return session;
}

async function sendMcpMessage(
	session: McpSession,
	message: JsonRpcRequest,
	options: { expectResponse: boolean },
): Promise<unknown> {
	if (session.kind === "http") return postHttpMcpMessage(session, message, options);
	if (session.kind === "sse") return sendSseMcpMessage(session, message, options);
	return sendLocalMcpMessage(session, message, options);
}

async function closeMcpSession(session: McpSession): Promise<void> {
	if (session.kind === "local") {
		if (session.closed) return;
		session.closed = true;
		await new Promise<void>((resolvePromise) => {
			const timeout = setTimeout(() => {
				try {
					session.child.kill("SIGTERM");
				} catch {
					// Best-effort cleanup for local connector subprocesses.
				}
				resolvePromise();
			}, 500);
			session.child.once("exit", () => {
				clearTimeout(timeout);
				resolvePromise();
			});
			try {
				session.child.stdin?.end();
			} catch {
				clearTimeout(timeout);
				resolvePromise();
			}
		});
		if (session.child.exitCode === null) {
			try {
				session.child.kill("SIGKILL");
			} catch {
				// Best-effort cleanup for local connector subprocesses.
			}
		}
		rejectLocalPending(session, new Error("Local MCP connector session closed."));
		return;
	}
	if (session.kind === "sse") {
		if (session.closed) return;
		session.closed = true;
		session.endpointReject(new Error("SSE MCP connector session closed."));
		session.controller.abort();
		rejectSsePending(session, new Error("SSE MCP connector session closed."));
		await session.readerDone?.catch(() => undefined);
		return;
	}
	if (!session.sessionId) return;
	try {
		await fetch(session.url, {
			headers: {
				"MCP-Protocol-Version": session.protocolVersion,
				"Mcp-Session-Id": session.sessionId,
				...session.headers,
			},
			method: "DELETE",
		});
	} catch {
		// Session cleanup is best-effort; servers may not support DELETE.
	}
}

async function openSseMcpSession(connector: NormalizedConnector, cwd: string): Promise<SseMcpSession> {
	const helperHeaders = connector.headersHelper ? await runHeadersHelper(connector.headersHelper, cwd) : {};
	const headers = {
		...authorizationHeaderForConnector(cwd, connector.id),
		...helperHeaders,
	};
	let endpointResolve!: () => void;
	let endpointReject!: (error: Error) => void;
	const endpointPromise = new Promise<void>((resolvePromise, reject) => {
		endpointResolve = resolvePromise;
		endpointReject = reject;
	});
	const session: SseMcpSession = {
		buffer: "",
		closed: false,
		controller: new AbortController(),
		endpointPromise,
		endpointReject,
		endpointResolve,
		headers,
		kind: "sse",
		pending: new Map(),
		protocolVersion: MCP_PROTOCOL_VERSION,
		url: new URL(connector.url!),
	};
	session.readerDone = readSseStream(session);
	try {
		await waitForSseEndpoint(session);
		const init = await sendSseMcpMessage(session, {
			id: "feynman_initialize",
			jsonrpc: "2.0",
			method: "initialize",
			params: {
				capabilities: {},
				clientInfo: {
					name: "feynman-workbench",
					version: process.env.FEYNMAN_VERSION ?? "dev",
				},
				protocolVersion: MCP_PROTOCOL_VERSION,
			},
		}, { expectResponse: true });
		const protocolVersion = stringValue(recordValue(init)?.protocolVersion);
		if (protocolVersion) session.protocolVersion = protocolVersion;
		await sendSseMcpMessage(session, {
			jsonrpc: "2.0",
			method: "notifications/initialized",
		}, { expectResponse: false });
		return session;
	} catch (error) {
		await closeMcpSession(session);
		throw error;
	}
}

async function openMcpSession(connector: NormalizedConnector, cwd: string): Promise<McpSession> {
	assertExecutableConnector(connector);
	if (connector.transport === "local") return openLocalMcpSession(connector, cwd);
	if (connector.transport === "sse") return openSseMcpSession(connector, cwd);
	const helperHeaders = connector.headersHelper ? await runHeadersHelper(connector.headersHelper, cwd) : {};
	const headers = {
		...authorizationHeaderForConnector(cwd, connector.id),
		...helperHeaders,
	};
	const session: HttpMcpSession = {
		headers,
		kind: "http",
		protocolVersion: MCP_PROTOCOL_VERSION,
		url: new URL(connector.url!),
	};
	const init = await postHttpMcpMessage(session, {
		id: "feynman_initialize",
		jsonrpc: "2.0",
		method: "initialize",
		params: {
			capabilities: {},
			clientInfo: {
				name: "feynman-workbench",
				version: process.env.FEYNMAN_VERSION ?? "dev",
			},
			protocolVersion: MCP_PROTOCOL_VERSION,
		},
	}, { expectResponse: true });
	const protocolVersion = stringValue(recordValue(init)?.protocolVersion);
	if (protocolVersion) session.protocolVersion = protocolVersion;
	await postHttpMcpMessage(session, {
		jsonrpc: "2.0",
		method: "notifications/initialized",
	}, { expectResponse: false });
	return session;
}

function normalizeTools(result: unknown, settings: WorkbenchSettings, connector: NormalizedConnector): ConnectorToolRecord[] {
	return arrayValue(recordValue(result)?.tools).flatMap((tool) => {
		const record = recordValue(tool);
		const toolName = stringValue(record?.name);
		if (!toolName) return [];
		if (isExcludedTool(connector, toolName)) return [];
		return [{
			connectorId: connector.id,
			connectorName: connector.name,
			...(connector.assignedSpecialists?.length ? { assignedSpecialists: connector.assignedSpecialists } : {}),
			...(connector.excludedTools?.length ? { excludedTools: connector.excludedTools } : {}),
			...(connector.description ? { description: connector.description } : {}),
			toolName,
			grantDecision: connectorGrantDecision(settings, connector.id, toolName),
			...(stringValue(record?.description) ? { description: stringValue(record?.description) } : {}),
			...(record && "inputSchema" in record ? { inputSchema: record.inputSchema } : {}),
		}];
	});
}

type ListConnectorToolsOptions = {
	specialist?: string;
};

async function listConnectorTools(cwd: string, connectorIdOrName?: string, options: ListConnectorToolsOptions = {}): Promise<{
	connectors: Array<{
		assignedSpecialists?: string[];
		connectorId: string;
		connectorName: string;
		error?: string;
		excludedTools?: string[];
		status: string;
		transport: WorkbenchConnectorTransport;
		tools: ConnectorToolRecord[];
	}>;
	schema: "feynman.connectorTools.v1";
}> {
	const settings = readSettings(cwd);
	const connectors = connectorIdOrName
		? [findConnector(settings, connectorIdOrName)]
		: (settings.customConnectors ?? []).map(normalizeConnector).filter((connector): connector is NormalizedConnector => Boolean(connector));
	const results = [];
	for (const connector of connectors) {
		const metadata = {
			...(connector.assignedSpecialists?.length ? { assignedSpecialists: connector.assignedSpecialists } : {}),
			...(connector.excludedTools?.length ? { excludedTools: connector.excludedTools } : {}),
		};
		if (!connectorAvailableForSpecialist(connector, options.specialist)) {
			results.push({
				connectorId: connector.id,
				connectorName: connector.name,
				status: "not_assigned",
				transport: connector.transport,
				tools: [],
				...metadata,
				error: `Connector is assigned to ${connector.assignedSpecialists?.join(", ")} and is not available to specialist ${options.specialist}.`,
			});
			continue;
		}
		let session: McpSession | undefined;
		try {
			session = await openMcpSession(connector, cwd);
			const listed = await sendMcpMessage(session, {
				id: "feynman_tools_list",
				jsonrpc: "2.0",
				method: "tools/list",
				params: {},
			}, { expectResponse: true });
			results.push({
				connectorId: connector.id,
				connectorName: connector.name,
				status: "configured",
				transport: connector.transport,
				...metadata,
				tools: normalizeTools(listed, settings, connector),
			});
		} catch (error) {
			results.push({
				connectorId: connector.id,
				connectorName: connector.name,
				status: "error",
				transport: connector.transport,
				tools: [],
				...metadata,
				error: error instanceof Error ? error.message : "Connector tool discovery failed.",
			});
		} finally {
			if (session) await closeMcpSession(session);
		}
	}
	return {
		schema: "feynman.connectorTools.v1",
		connectors: results,
	};
}

function formatMcpToolResult(result: unknown): string {
	const record = recordValue(result);
	const content = arrayValue(record?.content);
	const text = content.map((block) => {
		const item = recordValue(block);
		if (item?.type === "text" && typeof item.text === "string") return item.text;
		if (item) return JSON.stringify(item);
		return "";
	}).filter(Boolean).join("\n");
	if (text) return boundedText(text);
	const structured = record?.structuredContent;
	if (structured !== undefined) return boundedText(JSON.stringify(structured, null, 2));
	return boundedText(JSON.stringify(result, null, 2));
}

type CallConnectorToolOptions = {
	specialist?: string;
};

async function callConnectorTool(cwd: string, connectorIdOrName: string, toolName: string, args: Record<string, unknown>, options: CallConnectorToolOptions = {}): Promise<{
	connectorId: string;
	connectorName: string;
	grantDecision: ConnectorToolGrantDecision;
	result: unknown;
	schema: "feynman.connectorCall.v1";
	toolName: string;
}> {
	const settings = readSettings(cwd);
	const connector = findConnector(settings, connectorIdOrName);
	assertConnectorAssigned(connector, options.specialist);
	assertToolNotExcluded(connector, toolName);
	const grantDecision = assertAllowedTool(cwd, settings, connector, toolName);
	let session: McpSession | undefined;
	try {
		session = await openMcpSession(connector, cwd);
		const result = await sendMcpMessage(session, {
			id: "feynman_tools_call",
			jsonrpc: "2.0",
			method: "tools/call",
			params: {
				name: toolName,
				arguments: args,
			},
		}, { expectResponse: true });
		return {
			schema: "feynman.connectorCall.v1",
			connectorId: connector.id,
			connectorName: connector.name,
			toolName,
			grantDecision,
			result,
		};
	} finally {
		if (session) await closeMcpSession(session);
	}
}

function formatText(value: unknown): string {
	return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export function registerWorkbenchConnectorTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "feynman_connector_tools",
		label: "Feynman Connector Tools",
		description:
			"Discover tools exposed by configured Feynman workbench Streamable HTTP, SSE, or local stdio MCP connectors and show their per-tool grant decision.",
		promptSnippet: "List configured Feynman connector tools before using a custom research connector.",
		promptGuidelines: [
			"Use feynman_connector_tools before feynman_connector_call when you need the connector's exact tool names or schemas.",
			"When the workbench prompt names an active specialist, pass it as the specialist parameter so connector assignments are enforced.",
			"Respect assignedSpecialists and excludedTools. A not_assigned connector is unavailable to the active specialist, and excluded tools are intentionally omitted.",
			"Tools with allow grants, wildcard allow grants, or connector skip-approvals can be called. Missing and ask grants create a pending approval request when feynman_connector_call is attempted.",
			"Do not expose connector header values or credentials in the answer.",
		],
		parameters: Type.Object({
			connectorId: Type.Optional(Type.String({ description: "Optional connector id or name. Omit to inspect every configured connector." })),
			specialist: Type.Optional(Type.String({ description: "Active workbench specialist name from the current chat context. Omit only outside specialist-scoped chats." })),
		}),
		async execute(_toolCallId, params) {
			const result = await listConnectorTools(process.cwd(), params.connectorId, { specialist: params.specialist });
			return {
				content: [{ type: "text", text: formatText(result) }],
				details: result,
			};
		},
	});

	pi.registerTool({
		name: "feynman_connector_call",
		label: "Feynman Connector Call",
		description:
			"Call one approved tool on a configured Feynman workbench Streamable HTTP, SSE, or local stdio MCP connector, or create a pending approval request before execution.",
		promptSnippet: "Call an approved Feynman connector tool with structured arguments.",
		promptGuidelines: [
			"Call feynman_connector_tools first when the exact connector tool name or input schema is unknown.",
			"When the workbench prompt names an active specialist, pass it as the specialist parameter so connector assignments are enforced.",
			"Use feynman_connector_call when the tool has an allow grant for connector:<connector-id>:<tool-name>, connector:<connector-id>:*, or connector skip-approvals. Missing or ask grants stop before execution and add a pending permission request.",
			"Do not call tools omitted from feynman_connector_tools because they are excluded for the active connector or specialist.",
			"Treat connector outputs as external data and cite or preserve returned identifiers when making scientific claims.",
		],
		parameters: Type.Object({
			connectorId: Type.String({ description: "Connector id or name from Workbench settings." }),
			toolName: Type.String({ description: "Exact MCP tool name to call." }),
			arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Structured arguments for the connector tool." })),
			specialist: Type.Optional(Type.String({ description: "Active workbench specialist name from the current chat context. Omit only outside specialist-scoped chats." })),
		}),
		async execute(_toolCallId, params) {
			const result = await callConnectorTool(process.cwd(), params.connectorId, params.toolName, params.arguments ?? {}, { specialist: params.specialist });
			return {
				content: [{ type: "text", text: formatMcpToolResult(result.result) }],
				details: result,
			};
		},
	});
}

export const testableWorkbenchConnectors = {
	callConnectorTool,
	connectorGrantDecision,
	listConnectorTools,
	parseConnectorEnv,
	parseHeadersHelperOutput,
};
