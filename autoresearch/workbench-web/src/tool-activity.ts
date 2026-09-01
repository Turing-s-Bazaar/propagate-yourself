import type {
	WorkbenchResource,
	WorkbenchResourceGroup,
	WorkbenchToolEvent,
} from "./types.js";

export type ToolActivityTone = "approval" | "complete" | "error" | "queued" | "running" | "stopped";

export type ConnectorApprovalDecision = "allow" | "ask" | "deny";

export type ConnectorApprovalView = {
	connectorId: string;
	connectorName: string;
	decision: ConnectorApprovalDecision;
	description: string;
	scope: string;
	toolName: string;
	exactRecord: {
		description: string;
		id: string;
		name: string;
		scope: string;
	};
	wildcardRecord: {
		description: string;
		id: string;
		name: string;
		scope: string;
	};
};

export type ToolActivityView = {
	approval?: ConnectorApprovalView;
	details?: string;
	id: string;
	input?: string;
	output?: string;
	statusLabel: string;
	summary?: string;
	title: string;
	tone: ToolActivityTone;
	toolName?: string;
};

export type ToolActivityCounts = {
	approval: number;
	complete: number;
	error: number;
	queued: number;
	running: number;
	stopped: number;
	total: number;
};

const STATUS_LABELS: Record<WorkbenchToolEvent["status"], string> = {
	complete: "Complete",
	error: "Error",
	queued: "Queued",
	running: "Running",
	stopped: "Stopped",
};

function compactText(value: string | undefined, limit: number): string | undefined {
	const normalized = value?.replace(/\s+/g, " ").trim();
	if (!normalized) return undefined;
	return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1).trimEnd()}...`;
}

function previewText(value: string | undefined, limit = 900): string | undefined {
	if (!value) return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit - 1).trimEnd()}...`;
}

function resourceGroup(groups: WorkbenchResourceGroup[], id: string): WorkbenchResourceGroup | undefined {
	return groups.find((group) => group.id === id);
}

function permissionResourceForScope(groups: WorkbenchResourceGroup[], scope: string): WorkbenchResource | undefined {
	return resourceGroup(groups, "permissions")?.resources.find((resource) =>
		resource.settingsCollection === "permissionGrants" &&
		resource.detail?.startsWith(`${scope} | `)
	);
}

function decisionForScope(groups: WorkbenchResourceGroup[], scope: string): { decision: ConnectorApprovalDecision; resource?: WorkbenchResource } {
	const resource = permissionResourceForScope(groups, scope);
	const detail = resource?.detail || "";
	if (detail.endsWith(" | allow")) return { decision: "allow", resource };
	if (detail.endsWith(" | deny")) return { decision: "deny", resource };
	return { decision: "ask", ...(resource ? { resource } : {}) };
}

function connectorInfo(groups: WorkbenchResourceGroup[], connectorId: string): { description: string; name: string } {
	const connector = resourceGroup(groups, "connectors")?.resources.find((resource) =>
		resource.settingsCollection === "customConnectors" &&
		resource.settingsRecordId === connectorId
	);
	return {
		description: connector?.description || "Connector tool approval requested by Feynman.",
		name: connector?.name || connectorId.replaceAll("-", " "),
	};
}

export function connectorApprovalGrantId(connectorId: string, toolName: string): string {
	const id = `connector-${connectorId}-${toolName}`;
	return id.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 127) || "connector-tool-request";
}

export function connectorApprovalScopeFromText(value: string | undefined): string | undefined {
	const text = value || "";
	const marker = "scope connector:";
	const markerIndex = text.indexOf(marker);
	if (markerIndex === -1) return undefined;
	const rest = text.slice(markerIndex + "scope ".length);
	const allowed = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:._-*";
	let scope = "";
	for (const char of rest) {
		if (!allowed.includes(char)) break;
		scope += char;
	}
	return scope.startsWith("connector:") ? scope : undefined;
}

export function parseConnectorApprovalScope(scope: string | undefined): { connectorId: string; toolName: string } | undefined {
	const parts = String(scope || "").split(":");
	if (parts.length < 3 || parts[0] !== "connector" || !parts[1] || !parts[2]) return undefined;
	return {
		connectorId: parts[1],
		toolName: parts.slice(2).join(":"),
	};
}

export function connectorApprovalForEvent(
	event: WorkbenchToolEvent,
	groups: WorkbenchResourceGroup[] = [],
): ConnectorApprovalView | undefined {
	const text = [event.output, event.details, event.input].filter(Boolean).join("\n");
	const scope = connectorApprovalScopeFromText(text);
	const parsed = parseConnectorApprovalScope(scope);
	if (!scope || !parsed) return undefined;
	const wildcardScope = `connector:${parsed.connectorId}:*`;
	const exact = decisionForScope(groups, scope);
	const wildcard = exact.resource ? undefined : decisionForScope(groups, wildcardScope);
	const active = wildcard?.resource ? wildcard : exact;
	const connector = connectorInfo(groups, parsed.connectorId);
	return {
		connectorId: parsed.connectorId,
		connectorName: connector.name,
		decision: active.decision,
		description: connector.description,
		scope,
		toolName: parsed.toolName,
		exactRecord: {
			id: exact.resource?.settingsRecordId || connectorApprovalGrantId(parsed.connectorId, parsed.toolName),
			name: exact.resource?.name || `${connector.name} ${parsed.toolName}`,
			scope,
			description: exact.resource?.description || `Approval for ${parsed.toolName} on ${connector.name}.`,
		},
		wildcardRecord: {
			id: connectorApprovalGrantId(parsed.connectorId, "all-tools"),
			name: `${connector.name} tools`,
			scope: wildcardScope,
			description: `Allow every tool exposed by ${connector.name}.`,
		},
	};
}

function toneForEvent(event: WorkbenchToolEvent, approval?: ConnectorApprovalView): ToolActivityTone {
	if (approval?.decision === "ask") return "approval";
	if (approval?.decision === "deny") return "error";
	if (approval?.decision === "allow") return "complete";
	if (event.isError || event.status === "error") return "error";
	return event.status;
}

function statusLabel(event: WorkbenchToolEvent, approval?: ConnectorApprovalView): string {
	if (approval?.decision === "ask") return "Needs approval";
	if (approval?.decision === "allow") return "Approved";
	if (approval?.decision === "deny") return "Blocked";
	return STATUS_LABELS[event.status] ?? event.status;
}

export function toolActivityView(event: WorkbenchToolEvent, groups: WorkbenchResourceGroup[] = []): ToolActivityView {
	const approval = connectorApprovalForEvent(event, groups);
	const tone = toneForEvent(event, approval);
	const title = compactText(event.label || event.toolName || "Tool activity", 140) || "Tool activity";
	const outputSummary = approval ? undefined : compactText(event.output, 220);
	const detailsSummary = compactText(event.details, 220);
	const inputSummary = compactText(event.input, 220);
	return {
		id: event.id,
		title,
		tone,
		statusLabel: statusLabel(event, approval),
		...(event.toolName ? { toolName: event.toolName } : {}),
		...(approval ? { approval } : {}),
		...(outputSummary || detailsSummary || inputSummary ? { summary: outputSummary ?? detailsSummary ?? inputSummary } : {}),
		...(previewText(event.input) ? { input: previewText(event.input) } : {}),
		...(previewText(event.output) ? { output: previewText(event.output) } : {}),
		...(previewText(event.details) ? { details: previewText(event.details) } : {}),
	};
}

export function connectorApprovalRetryPrompt(approval: ConnectorApprovalView, input?: string): string {
	return [
		"Continue the blocked connector call now that I approved it.",
		`Connector: ${approval.connectorName}`,
		`Tool: ${approval.toolName}`,
		`Grant: ${approval.scope}`,
		compactText(input, 1_000) ? `Original arguments: ${compactText(input, 1_000)}` : "",
	].filter(Boolean).join("\n");
}

export function toolActivityViews(
	events: WorkbenchToolEvent[],
	groups: WorkbenchResourceGroup[] = [],
	limit = 6,
): { counts: ToolActivityCounts; hiddenCount: number; visible: ToolActivityView[] } {
	const all = events.map((event) => toolActivityView(event, groups));
	const counts = all.reduce<ToolActivityCounts>((memo, event) => {
		memo.total += 1;
		memo[event.tone] += 1;
		return memo;
	}, {
		approval: 0,
		complete: 0,
		error: 0,
		queued: 0,
		running: 0,
		stopped: 0,
		total: 0,
	});
	return {
		counts,
		hiddenCount: Math.max(0, all.length - limit),
		visible: all.slice(0, limit),
	};
}
