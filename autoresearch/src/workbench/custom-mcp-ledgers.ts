import { createHash } from "node:crypto";

import { readWorkbenchSettings, type WorkbenchCustomConnector } from "./settings-store.js";
import type { WorkbenchCustomMcpServer, WorkbenchMcpAgentAssignment } from "./types.js";

const DEFAULT_AGENT_NAME = "feynman";
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

function resourceIdentifier(connector: WorkbenchCustomConnector): string {
	return connector.transport === "local" ? connector.command ?? connector.id : connector.url;
}

function customMcpServer(connector: WorkbenchCustomConnector): WorkbenchCustomMcpServer {
	return {
		id: stableUuid("feynman-custom-mcp-server", connector.id),
		userId: LOCAL_USER_ID,
		name: connector.name,
		...(connector.description ? { description: connector.description } : {}),
		url: connector.url,
		transport: connector.transport,
		...(connector.oauthServerUrl ? { oauthServerUrl: connector.oauthServerUrl } : {}),
		...(connector.clientId ? { clientId: connector.clientId } : {}),
		...(connector.scopes ? { scopes: connector.scopes } : {}),
		...(connector.headersHelper ? { headersHelper: connector.headersHelper } : {}),
		source: "custom",
		resourceIdentifier: resourceIdentifier(connector),
		settingsRecordId: connector.id,
		createdAt: connector.createdAt,
		createdAtMs: timestampMs(connector.createdAt),
		updatedAt: connector.updatedAt,
		updatedAtMs: timestampMs(connector.updatedAt),
	};
}

function agentAssignments(connector: WorkbenchCustomConnector, serverId: string): WorkbenchMcpAgentAssignment[] {
	const agents = connector.assignedSpecialists?.length ? connector.assignedSpecialists : [DEFAULT_AGENT_NAME];
	return agents.map((agentName) => ({
		id: stableUuid("feynman-mcp-agent-assignment", `${connector.id}:${agentName}`),
		mcpServerId: serverId,
		agentName,
		userId: LOCAL_USER_ID,
		excludedTools: connector.excludedTools ?? [],
		settingsRecordId: connector.id,
		createdAt: connector.createdAt,
		createdAtMs: timestampMs(connector.createdAt),
	}));
}

export function buildWorkbenchCustomMcpLedgers(workingDir: string): {
	customMcpServers: WorkbenchCustomMcpServer[];
	mcpAgentAssignments: WorkbenchMcpAgentAssignment[];
} {
	const connectors = readWorkbenchSettings(workingDir).customConnectors;
	const customMcpServers = connectors.map(customMcpServer);
	const serverIds = new Map(customMcpServers.map((server) => [server.settingsRecordId, server.id]));
	return {
		customMcpServers: customMcpServers.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
		mcpAgentAssignments: connectors
			.flatMap((connector) => agentAssignments(connector, serverIds.get(connector.id) ?? stableUuid("feynman-custom-mcp-server", connector.id)))
			.sort((a, b) =>
				a.mcpServerId.localeCompare(b.mcpServerId) ||
				a.agentName.localeCompare(b.agentName) ||
				a.id.localeCompare(b.id)
			),
	};
}
