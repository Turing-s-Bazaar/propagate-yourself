import { createHash, randomBytes, randomUUID } from "node:crypto";
import { closeSync, constants, existsSync, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync, type Stats } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { getLegacyHomeWorkbenchDataRoot, legacyWorkbenchDataPath, migratedWorkbenchDataPath } from "./data-root.js";

export type WorkbenchOAuthToken = {
	id: string;
	connectorId: string;
	accessToken: string;
	refreshToken?: string;
	tokenType: string;
	expiresAtMs?: number;
	scopes?: string;
	clientId?: string;
	createdAt: string;
	updatedAt: string;
};

export type WorkbenchOAuthPendingState = {
	id: string;
	connectorId: string;
	state: string;
	codeVerifier: string;
	redirectUri: string;
	authorizationEndpoint: string;
	tokenEndpoint: string;
	clientId: string;
	scopes?: string;
	createdAtMs: number;
	expiresAtMs: number;
};

export type WorkbenchOAuthCompletedState = {
	id: string;
	connectorId: string;
	state: string;
	completedAtMs: number;
	expiresAtMs: number;
};

export type WorkbenchOAuthTokenStore = {
	schema: "feynman.workbenchOAuthTokens.v1";
	tokens: WorkbenchOAuthToken[];
	updatedAt: string;
};

export type WorkbenchOAuthPendingStore = {
	schema: "feynman.workbenchOAuthPending.v1";
	states: WorkbenchOAuthPendingState[];
	completedStates: WorkbenchOAuthCompletedState[];
	updatedAt: string;
};

export type WorkbenchOAuthConnectorConfig = {
	id: string;
	clientId?: string;
	oauthServerUrl?: string;
	scopes?: string;
};

const TOKEN_SCHEMA = "feynman.workbenchOAuthTokens.v1" as const;
const PENDING_SCHEMA = "feynman.workbenchOAuthPending.v1" as const;
const PENDING_TTL_MS = 10 * 60 * 1000;
const COMPLETED_STATE_TTL_MS = 10 * 60 * 1000;

function nowIso(): string {
	return new Date().toISOString();
}

function nowMs(): number {
	return Date.now();
}

function tokenStorePath(workingDir: string): string {
	return migratedSensitiveStorePath(workingDir, "oauth-tokens.json");
}

function pendingStorePath(workingDir: string): string {
	return migratedSensitiveStorePath(workingDir, "oauth-pending.json");
}

function migratedSensitiveStorePath(workingDir: string, filename: string): string {
	const legacyPaths: Array<[string, string, boolean]> = [
		[join(getLegacyHomeWorkbenchDataRoot(workingDir), filename), dirname(getLegacyHomeWorkbenchDataRoot(workingDir)), true],
		[legacyWorkbenchDataPath(workingDir, filename), resolve(workingDir), false],
	];
	for (const [path, boundary, repairPermissions] of legacyPaths) {
		secureExistingSensitiveStorePath(path, boundary, repairPermissions);
	}
	return migratedWorkbenchDataPath(workingDir, filename);
}

function recordObject(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
	const text = typeof value === "string" ? value.trim() : "";
	return text || undefined;
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function base64Url(buffer: Buffer): string {
	return buffer.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function normalizeToken(record: Record<string, unknown>): WorkbenchOAuthToken | undefined {
	const connectorId = stringValue(record.connectorId);
	const accessToken = stringValue(record.accessToken);
	if (!connectorId || !accessToken) return undefined;
	const createdAt = stringValue(record.createdAt) ?? nowIso();
	return {
		id: stringValue(record.id) ?? randomUUID(),
		connectorId: connectorId.slice(0, 128),
		accessToken,
		...(stringValue(record.refreshToken) ? { refreshToken: stringValue(record.refreshToken) } : {}),
		tokenType: (stringValue(record.tokenType) ?? "Bearer").slice(0, 32),
		...(numberValue(record.expiresAtMs) ? { expiresAtMs: numberValue(record.expiresAtMs) } : {}),
		...(stringValue(record.scopes) ? { scopes: stringValue(record.scopes)!.slice(0, 1024) } : {}),
		...(stringValue(record.clientId) ? { clientId: stringValue(record.clientId)!.slice(0, 255) } : {}),
		createdAt,
		updatedAt: stringValue(record.updatedAt) ?? createdAt,
	};
}

function normalizePending(record: Record<string, unknown>): WorkbenchOAuthPendingState | undefined {
	const connectorId = stringValue(record.connectorId);
	const state = stringValue(record.state);
	const codeVerifier = stringValue(record.codeVerifier);
	const redirectUri = stringValue(record.redirectUri);
	const authorizationEndpoint = stringValue(record.authorizationEndpoint);
	const tokenEndpoint = stringValue(record.tokenEndpoint);
	const clientId = stringValue(record.clientId);
	const createdAtMs = numberValue(record.createdAtMs);
	const expiresAtMs = numberValue(record.expiresAtMs);
	if (!connectorId || !state || !codeVerifier || !redirectUri || !authorizationEndpoint || !tokenEndpoint || !clientId || !createdAtMs || !expiresAtMs) {
		return undefined;
	}
	return {
		id: stringValue(record.id) ?? randomUUID(),
		connectorId: connectorId.slice(0, 128),
		state,
		codeVerifier,
		redirectUri,
		authorizationEndpoint,
		tokenEndpoint,
		clientId,
		...(stringValue(record.scopes) ? { scopes: stringValue(record.scopes)!.slice(0, 1024) } : {}),
		createdAtMs,
		expiresAtMs,
	};
}

function normalizeCompleted(record: Record<string, unknown>): WorkbenchOAuthCompletedState | undefined {
	const connectorId = stringValue(record.connectorId);
	const state = stringValue(record.state);
	const completedAtMs = numberValue(record.completedAtMs);
	const expiresAtMs = numberValue(record.expiresAtMs);
	if (!connectorId || !state || !completedAtMs || !expiresAtMs) return undefined;
	return {
		id: stringValue(record.id) ?? randomUUID(),
		connectorId: connectorId.slice(0, 128),
		state,
		completedAtMs,
		expiresAtMs,
	};
}

function readJsonFile(path: string): Record<string, unknown> {
	secureSensitiveStorePath(path);
	if (!existsSync(path)) return {};
	try {
		return recordObject(JSON.parse(readFileSync(path, "utf8")));
	} catch {
		return {};
	}
}

function secureSensitiveStorePath(path: string): void {
	const directory = dirname(path);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	chmodSensitivePath(directory, 0o700, "directory");
	if (existsSync(path)) {
		chmodSensitivePath(path, 0o600, "file");
	}
}

function secureExistingSensitiveStorePath(path: string, boundary: string, repairPermissions: boolean): void {
	if (!existsSync(path)) return;
	const canonicalBoundary = realpathSync.native(boundary);
	const canonicalPath = realpathSync.native(path);
	const relPath = relative(canonicalBoundary, canonicalPath);
	if (!relPath || isAbsolute(relPath) || relPath === ".." || relPath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
		throw new Error("OAuth store path is outside its expected root.");
	}
	const directoryPath = dirname(path);
	const expectedDirectory = lstatSync(directoryPath);
	const expectedFile = lstatSync(path);
	for (let directory = dirname(path); directory !== boundary; directory = dirname(directory)) {
		if (directory === dirname(directory)) throw new Error("OAuth store path is outside its expected root.");
		if (lstatSync(directory).isSymbolicLink()) throw new Error("OAuth store path must not contain symbolic links.");
	}
	if (!repairPermissions) return;
	chmodSensitivePath(directoryPath, 0o700, "directory", expectedDirectory);
	chmodSensitivePath(path, 0o600, "file", expectedFile);
}

function chmodSensitivePath(path: string, mode: number, kind: "directory" | "file", expected = lstatSync(path)): void {
	const before: Stats = expected;
	if (kind === "directory" ? !before.isDirectory() : !before.isFile() || before.nlink !== 1) {
		throw new Error(`OAuth store ${kind} must be a regular ${kind}.`);
	}
	if (process.platform === "win32") return;
	const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | (kind === "directory" ? constants.O_DIRECTORY : 0));
	try {
		const opened = fstatSync(descriptor);
		if (
			(kind === "directory" ? !opened.isDirectory() : !opened.isFile() || opened.nlink !== 1)
			|| opened.dev !== before.dev
			|| opened.ino !== before.ino
		) throw new Error(`OAuth store ${kind} changed while its permissions were secured.`);
		fchmodSync(descriptor, mode);
	} finally {
		closeSync(descriptor);
	}
}

function writeSensitiveJson(path: string, value: unknown): void {
	secureSensitiveStorePath(path);
	const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
			encoding: "utf8",
			flag: "wx",
			mode: 0o600,
		});
		renameSync(temporaryPath, path);
		chmodSensitivePath(path, 0o600, "file");
	} finally {
		rmSync(temporaryPath, { force: true });
	}
}

export function readWorkbenchOAuthTokens(workingDir: string): WorkbenchOAuthTokenStore {
	const parsed = readJsonFile(tokenStorePath(workingDir));
	return {
		schema: TOKEN_SCHEMA,
		tokens: Array.isArray(parsed.tokens)
			? parsed.tokens.map((item) => normalizeToken(recordObject(item))).filter((item): item is WorkbenchOAuthToken => Boolean(item))
			: [],
		updatedAt: stringValue(parsed.updatedAt) ?? nowIso(),
	};
}

function writeWorkbenchOAuthTokens(workingDir: string, tokens: WorkbenchOAuthToken[]): WorkbenchOAuthTokenStore {
	const path = tokenStorePath(workingDir);
	const next = { schema: TOKEN_SCHEMA, tokens, updatedAt: nowIso() };
	writeSensitiveJson(path, next);
	return next;
}

export function readWorkbenchOAuthPending(workingDir: string): WorkbenchOAuthPendingStore {
	const parsed = readJsonFile(pendingStorePath(workingDir));
	const cutoff = nowMs();
	return {
		schema: PENDING_SCHEMA,
		states: Array.isArray(parsed.states)
			? parsed.states
				.map((item) => normalizePending(recordObject(item)))
				.filter((item): item is WorkbenchOAuthPendingState => item !== undefined && item.expiresAtMs > cutoff)
			: [],
		completedStates: Array.isArray(parsed.completedStates)
			? parsed.completedStates
				.map((item) => normalizeCompleted(recordObject(item)))
				.filter((item): item is WorkbenchOAuthCompletedState => item !== undefined && item.expiresAtMs > cutoff)
			: [],
		updatedAt: stringValue(parsed.updatedAt) ?? nowIso(),
	};
}

function writeWorkbenchOAuthPending(
	workingDir: string,
	states: WorkbenchOAuthPendingState[],
	completedStates: WorkbenchOAuthCompletedState[] = [],
): WorkbenchOAuthPendingStore {
	const path = pendingStorePath(workingDir);
	const cutoff = nowMs();
	const next = {
		schema: PENDING_SCHEMA,
		states: states.filter((state) => state.expiresAtMs > cutoff),
		completedStates: completedStates.filter((state) => state.expiresAtMs > cutoff),
		updatedAt: nowIso(),
	};
	writeSensitiveJson(path, next);
	return next;
}

export function oauthTokenForConnector(workingDir: string, connectorId: string): WorkbenchOAuthToken | undefined {
	return readWorkbenchOAuthTokens(workingDir).tokens.find((token) => token.connectorId === connectorId);
}

export function isOAuthTokenExpired(token: WorkbenchOAuthToken | undefined, atMs = nowMs()): boolean {
	return Boolean(token?.expiresAtMs && token.expiresAtMs <= atMs);
}

export function authorizationHeaderForConnector(workingDir: string, connectorId: string): Record<string, string> {
	const token = oauthTokenForConnector(workingDir, connectorId);
	if (!token || isOAuthTokenExpired(token)) return {};
	const tokenType = token.tokenType || "Bearer";
	return { Authorization: `${tokenType} ${token.accessToken}` };
}

export function upsertWorkbenchOAuthToken(workingDir: string, token: Omit<WorkbenchOAuthToken, "createdAt" | "id" | "updatedAt"> & { id?: string }): WorkbenchOAuthTokenStore {
	const store = readWorkbenchOAuthTokens(workingDir);
	const existing = store.tokens.find((item) => item.connectorId === token.connectorId);
	const timestamp = nowIso();
	const normalized = normalizeToken({
		...token,
		id: existing?.id ?? token.id ?? randomUUID(),
		createdAt: existing?.createdAt ?? timestamp,
		updatedAt: timestamp,
	});
	if (!normalized) throw new Error("OAuth token is missing connector id or access token.");
	const tokens = existing
		? store.tokens.map((item) => item.connectorId === normalized.connectorId ? normalized : item)
		: [...store.tokens, normalized];
	return writeWorkbenchOAuthTokens(workingDir, tokens);
}

export function removeWorkbenchOAuthToken(workingDir: string, connectorId: string): WorkbenchOAuthTokenStore {
	const store = readWorkbenchOAuthTokens(workingDir);
	return writeWorkbenchOAuthTokens(workingDir, store.tokens.filter((token) => token.connectorId !== connectorId));
}

function endpointFromServerUrl(oauthServerUrl: string, kind: "authorize" | "token"): string {
	const url = new URL(oauthServerUrl);
	const path = url.pathname.replace(/\/+$/, "");
	if (/(^|\/)authorize$/i.test(path)) {
		url.pathname = kind === "authorize" ? path : path.replace(/authorize$/i, "token");
		return url.toString();
	}
	if (/(^|\/)token$/i.test(path)) {
		url.pathname = kind === "token" ? path : path.replace(/token$/i, "authorize");
		return url.toString();
	}
	url.pathname = `${path === "" ? "" : path}/${kind}`;
	return url.toString();
}

export function resolveOAuthEndpoints(oauthServerUrl: string): { authorizationEndpoint: string; tokenEndpoint: string } {
	return {
		authorizationEndpoint: endpointFromServerUrl(oauthServerUrl, "authorize"),
		tokenEndpoint: endpointFromServerUrl(oauthServerUrl, "token"),
	};
}

export function createWorkbenchOAuthStart(
	workingDir: string,
	connector: WorkbenchOAuthConnectorConfig,
	redirectUri: string,
): { authorizationUrl: string; expiresAtMs: number; state: string } {
	if (!connector.oauthServerUrl) throw new Error("Connector is missing OAuth Server URL.");
	if (!connector.clientId) throw new Error("Connector is missing OAuth Client ID.");
	const { authorizationEndpoint, tokenEndpoint } = resolveOAuthEndpoints(connector.oauthServerUrl);
	const state = base64Url(randomBytes(24));
	const codeVerifier = base64Url(randomBytes(48));
	const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());
	const expiresAtMs = nowMs() + PENDING_TTL_MS;
	const authorizationUrl = new URL(authorizationEndpoint);
	authorizationUrl.searchParams.set("response_type", "code");
	authorizationUrl.searchParams.set("client_id", connector.clientId);
	authorizationUrl.searchParams.set("redirect_uri", redirectUri);
	authorizationUrl.searchParams.set("state", state);
	authorizationUrl.searchParams.set("code_challenge", codeChallenge);
	authorizationUrl.searchParams.set("code_challenge_method", "S256");
	if (connector.scopes) authorizationUrl.searchParams.set("scope", connector.scopes);
	const pendingStore = readWorkbenchOAuthPending(workingDir);
	const pending = pendingStore.states.filter((item) => item.connectorId !== connector.id);
	writeWorkbenchOAuthPending(workingDir, [
		...pending,
		{
			id: randomUUID(),
			connectorId: connector.id,
			state,
			codeVerifier,
			redirectUri,
			authorizationEndpoint,
			tokenEndpoint,
			clientId: connector.clientId,
			...(connector.scopes ? { scopes: connector.scopes } : {}),
			createdAtMs: nowMs(),
			expiresAtMs,
		},
	], pendingStore.completedStates);
	return { authorizationUrl: authorizationUrl.toString(), expiresAtMs, state };
}

export async function finishWorkbenchOAuthCallback(
	workingDir: string,
	input: { code?: string; error?: string; state?: string },
): Promise<WorkbenchOAuthToken> {
	if (input.error) throw new Error(`OAuth provider returned an error: ${input.error}`);
	if (!input.state) throw new Error("OAuth callback is missing state.");
	if (!input.code) throw new Error("OAuth callback is missing code.");
	const pendingStore = readWorkbenchOAuthPending(workingDir);
	const pending = pendingStore.states.find((item) => item.state === input.state);
	if (!pending) {
		const completed = pendingStore.completedStates.find((item) => item.state === input.state);
		const token = completed ? oauthTokenForConnector(workingDir, completed.connectorId) : undefined;
		if (token) return token;
		throw new Error("OAuth callback state is missing or expired.");
	}
	const body = new URLSearchParams({
		grant_type: "authorization_code",
		code: input.code,
		redirect_uri: pending.redirectUri,
		client_id: pending.clientId,
		code_verifier: pending.codeVerifier,
	});
	const response = await fetch(pending.tokenEndpoint, {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body,
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(`OAuth token exchange failed: ${response.status} ${response.statusText}`);
	}
	const payload = recordObject(JSON.parse(text || "{}"));
	const accessToken = stringValue(payload.access_token);
	if (!accessToken) throw new Error("OAuth token response did not include access_token.");
	const expiresIn = numberValue(payload.expires_in);
	const tokenType = stringValue(payload.token_type) ?? "Bearer";
	upsertWorkbenchOAuthToken(workingDir, {
		connectorId: pending.connectorId,
		accessToken,
		...(stringValue(payload.refresh_token) ? { refreshToken: stringValue(payload.refresh_token) } : {}),
		tokenType,
		...(expiresIn ? { expiresAtMs: nowMs() + expiresIn * 1000 } : {}),
		...(stringValue(payload.scope) || pending.scopes ? { scopes: stringValue(payload.scope) ?? pending.scopes } : {}),
		clientId: pending.clientId,
	});
	const completedAtMs = nowMs();
	writeWorkbenchOAuthPending(
		workingDir,
		pendingStore.states.filter((state) => state.state !== pending.state),
		[
			...pendingStore.completedStates.filter((state) => state.state !== pending.state),
			{
				id: randomUUID(),
				connectorId: pending.connectorId,
				state: pending.state,
				completedAtMs,
				expiresAtMs: completedAtMs + COMPLETED_STATE_TTL_MS,
			},
		],
	);
	const token = oauthTokenForConnector(workingDir, pending.connectorId);
	if (!token) throw new Error("OAuth token was not persisted.");
	return token;
}
