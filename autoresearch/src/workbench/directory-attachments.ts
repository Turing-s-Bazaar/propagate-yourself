import { createHash } from "node:crypto";

import type {
	WorkbenchDirectoryAttachment,
	WorkbenchResource,
	WorkbenchResourceGroup,
} from "./types.js";

const DEFAULT_AGENT_NAME = "feynman";
const LOCAL_USER_ID = "local-workbench";
const BUILT_IN_CREATED_AT = "2026-07-01T00:00:00.000Z";
const BUILT_IN_CREATED_AT_MS = Date.parse(BUILT_IN_CREATED_AT);

function stableServerUuid(value: string): string {
	const bytes = createHash("sha256").update(`feynman-directory-server:${value}`).digest().subarray(0, 16);
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function stringArray(value: unknown): string[] {
	const values = Array.isArray(value) ? value : [];
	const seen = new Set<string>();
	const items: string[] = [];
	for (const item of values) {
		const text = typeof item === "string" ? item.trim() : "";
		if (!text || seen.has(text)) continue;
		seen.add(text);
		items.push(text);
	}
	return items;
}

function recordValue(resource: WorkbenchResource, key: string): unknown {
	return resource.settingsRecord && typeof resource.settingsRecord === "object"
		? resource.settingsRecord[key]
		: undefined;
}

function createdAtFor(resource: WorkbenchResource): { createdAt: string; createdAtMs: number } {
	const value = recordValue(resource, "createdAt");
	const createdAt = typeof value === "string" && value.trim() ? value.trim() : BUILT_IN_CREATED_AT;
	const parsed = Date.parse(createdAt);
	return {
		createdAt,
		createdAtMs: Number.isFinite(parsed) ? parsed : BUILT_IN_CREATED_AT_MS,
	};
}

function assignedAgents(resource: WorkbenchResource): string[] {
	const agents = stringArray(recordValue(resource, "assignedSpecialists"));
	return agents.length ? agents : [DEFAULT_AGENT_NAME];
}

function excludedTools(resource: WorkbenchResource): string[] {
	return stringArray(recordValue(resource, "excludedTools"));
}

function toolNames(resource: WorkbenchResource): string[] {
	return stringArray(resource.tools?.map((tool) => tool.name));
}

function shouldAttachResource(resource: WorkbenchResource): boolean {
	if (!resource.connectorKind || resource.status === "disabled") return false;
	if (resource.settingsCollection === "customConnectors") return true;
	return resource.status === "configured";
}

export function buildWorkbenchDirectoryAttachments(resourceGroups: WorkbenchResourceGroup[]): WorkbenchDirectoryAttachment[] {
	const connectors = resourceGroups.find((group) => group.id === "connectors")?.resources ?? [];
	return connectors
		.filter(shouldAttachResource)
		.flatMap((resource) => {
			const created = createdAtFor(resource);
			return assignedAgents(resource).map((agentName) => ({
				serverUuid: stableServerUuid(resource.id),
				agentName,
				userId: LOCAL_USER_ID,
				connectorId: resource.id,
				connectorName: resource.name,
				connectorKind: resource.connectorKind!,
				status: resource.status,
				source: resource.source,
				...(resource.section ? { section: resource.section } : {}),
				...(resource.settingsCollection === "customConnectors" ? { settingsCollection: resource.settingsCollection } : {}),
				...(resource.settingsRecordId ? { settingsRecordId: resource.settingsRecordId } : {}),
				excludedTools: excludedTools(resource),
				toolNames: toolNames(resource),
				createdAt: created.createdAt,
				createdAtMs: created.createdAtMs,
			}));
		})
		.sort((a, b) =>
			a.agentName.localeCompare(b.agentName) ||
			a.connectorKind.localeCompare(b.connectorKind) ||
			a.connectorName.localeCompare(b.connectorName) ||
			a.serverUuid.localeCompare(b.serverUuid)
		);
}
