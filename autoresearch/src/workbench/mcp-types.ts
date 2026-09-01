export type WorkbenchMcpConnectorKind = "custom" | "directory" | "featured" | "organization" | "package";
export type WorkbenchMcpResourceStatus = "available" | "configured" | "disabled" | "read-only";

export type WorkbenchDirectoryAttachment = {
	serverUuid: string;
	agentName: string;
	userId: string;
	connectorId: string;
	connectorName: string;
	connectorKind: WorkbenchMcpConnectorKind;
	status: WorkbenchMcpResourceStatus;
	source: string;
	section?: string;
	settingsCollection?: "customConnectors";
	settingsRecordId?: string;
	excludedTools: string[];
	toolNames: string[];
	createdAt: string;
	createdAtMs: number;
};

export type WorkbenchMcpToolGrant = {
	id: string;
	userId: string;
	serverId: string;
	toolName: string;
	decision: "allow" | "ask" | "deny";
	name: string;
	scope: string;
	description?: string;
	settingsRecordId: string;
	createdAt: string;
	createdAtMs: number;
};

export type WorkbenchCustomMcpServer = {
	id: string;
	userId: string;
	name: string;
	description?: string;
	url: string;
	transport: "local" | "sse" | "streamable_http";
	oauthServerUrl?: string;
	clientId?: string;
	scopes?: string;
	headersHelper?: string;
	source: "custom";
	resourceIdentifier: string;
	settingsRecordId: string;
	createdAt: string;
	createdAtMs: number;
	updatedAt: string;
	updatedAtMs: number;
};

export type WorkbenchMcpAgentAssignment = {
	id: string;
	mcpServerId: string;
	agentName: string;
	userId: string;
	excludedTools: string[];
	settingsRecordId: string;
	createdAt: string;
	createdAtMs: number;
};
