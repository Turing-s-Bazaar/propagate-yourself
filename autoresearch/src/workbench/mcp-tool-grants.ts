import { createHash } from "node:crypto";

import { readWorkbenchSettings, type WorkbenchPermissionGrant } from "./settings-store.js";
import type { WorkbenchMcpToolGrant } from "./types.js";

const LOCAL_USER_ID = "local-workbench";

function stableGrantUuid(value: string): string {
	const bytes = createHash("sha256").update(`feynman-mcp-tool-grant:${value}`).digest().subarray(0, 16);
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function parseScope(scope: string): { serverId: string; toolName: string } {
	const [kind, serverOrTool, ...rest] = scope.split(":").map((part) => part.trim()).filter(Boolean);
	if (kind === "connector" && serverOrTool && rest.length) {
		return { serverId: serverOrTool, toolName: rest.join(":") };
	}
	if (kind === "builtin" && serverOrTool) {
		return { serverId: "builtin", toolName: [serverOrTool, ...rest].join(":") };
	}
	return { serverId: "workspace", toolName: scope };
}

function timestampMs(value: string): number {
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function grantRecord(grant: WorkbenchPermissionGrant): WorkbenchMcpToolGrant {
	const parsed = parseScope(grant.scope);
	return {
		id: stableGrantUuid(grant.id),
		userId: LOCAL_USER_ID,
		serverId: parsed.serverId,
		toolName: parsed.toolName,
		decision: grant.decision,
		name: grant.name,
		scope: grant.scope,
		...(grant.description ? { description: grant.description } : {}),
		settingsRecordId: grant.id,
		createdAt: grant.createdAt,
		createdAtMs: timestampMs(grant.createdAt),
	};
}

export function buildWorkbenchMcpToolGrants(workingDir: string): WorkbenchMcpToolGrant[] {
	return readWorkbenchSettings(workingDir).permissionGrants
		.map(grantRecord)
		.sort((a, b) =>
			a.userId.localeCompare(b.userId) ||
			a.serverId.localeCompare(b.serverId) ||
			a.toolName.localeCompare(b.toolName) ||
			a.settingsRecordId.localeCompare(b.settingsRecordId)
		);
}
