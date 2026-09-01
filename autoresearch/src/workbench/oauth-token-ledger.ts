import { createHash } from "node:crypto";

import type { WorkbenchCustomMcpServer, WorkbenchOAuthTokenRecord } from "./types.js";
import { readWorkbenchOAuthTokens, type WorkbenchOAuthToken } from "./oauth-store.js";

const LOCAL_USER_ID = "local-workbench";

function stableUuid(namespace: string, value: string): string {
	const bytes = createHash("sha256").update(`${namespace}:${value}`).digest().subarray(0, 16);
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function timestampMs(value: string): number {
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function expiresAtIso(expiresAtMs: number | undefined): string | undefined {
	return Number.isFinite(expiresAtMs) && expiresAtMs !== undefined ? new Date(expiresAtMs).toISOString() : undefined;
}

function tokenStatus(token: WorkbenchOAuthToken): WorkbenchOAuthTokenRecord["status"] {
	return token.expiresAtMs && token.expiresAtMs <= Date.now() ? "expired" : "active";
}

export function buildWorkbenchOAuthTokenRecords(
	workingDir: string,
	customMcpServers: WorkbenchCustomMcpServer[],
): WorkbenchOAuthTokenRecord[] {
	const serverByConnectorId = new Map(customMcpServers.map((server) => [server.settingsRecordId, server]));
	return readWorkbenchOAuthTokens(workingDir).tokens.flatMap((token) => {
		const server = serverByConnectorId.get(token.connectorId);
		if (!server) return [];
		const createdAtMs = timestampMs(token.createdAt);
		const updatedAtMs = timestampMs(token.updatedAt);
		return [{
			id: token.id || stableUuid("feynman-oauth-token", token.connectorId),
			userId: LOCAL_USER_ID,
			mcpServerId: server.id,
			encryptedAccessToken: `feynman-oauth-ref:${token.connectorId}:access`,
			...(token.refreshToken ? { encryptedRefreshToken: `feynman-oauth-ref:${token.connectorId}:refresh` } : {}),
			tokenType: token.tokenType,
			...(expiresAtIso(token.expiresAtMs) ? { expiresAt: expiresAtIso(token.expiresAtMs), expiresAtMs: token.expiresAtMs } : {}),
			...(token.scopes ? { scopes: token.scopes } : {}),
			createdAt: token.createdAt,
			createdAtMs,
			updatedAt: token.updatedAt,
			updatedAtMs,
			...(token.clientId ? { clientId: token.clientId } : {}),
			connectorId: token.connectorId,
			settingsRecordId: server.settingsRecordId,
			status: tokenStatus(token),
		}];
	}).sort((a, b) => a.mcpServerId.localeCompare(b.mcpServerId) || a.id.localeCompare(b.id));
}
