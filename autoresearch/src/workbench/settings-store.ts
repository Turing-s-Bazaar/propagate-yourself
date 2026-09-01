import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { migratedWorkbenchDataPath } from "./data-root.js";

export type WorkbenchSettingsCollection =
	| "allowedDomains"
	| "computeHosts"
	| "computeProviderPreferences"
	| "credentialRefs"
	| "customConnectors"
	| "memoryCategories"
	| "permissionGrants";

export type WorkbenchCustomConnector = {
	id: string;
	name: string;
	description?: string;
	assignedSpecialists?: string[];
	excludedTools?: string[];
	url: string;
	transport: "local" | "sse" | "streamable_http";
	command?: string;
	env?: string;
	oauthServerUrl?: string;
	clientId?: string;
	scopes?: string;
	headersHelper?: string;
	skipApprovals?: boolean;
	createdAt: string;
	updatedAt: string;
};

export type WorkbenchAllowedDomain = {
	id: string;
	domain: string;
	createdAt: string;
};

export type WorkbenchCredentialRef = {
	id: string;
	name: string;
	provider: string;
	envVar: string;
	description?: string;
	createdAt: string;
	updatedAt: string;
};

export type WorkbenchComputeHost = {
	id: string;
	name: string;
	host: string;
	user?: string;
	port?: string;
	identityFile?: string;
	scheduler?: string;
	guidance?: string;
	scratchRoot?: string;
	createdAt: string;
	updatedAt: string;
};

export type WorkbenchComputeProviderPreference = {
	id: string;
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
};

export type WorkbenchPermissionGrant = {
	id: string;
	name: string;
	scope: string;
	decision: "allow" | "ask" | "deny";
	description?: string;
	createdAt: string;
	updatedAt: string;
};

export type WorkbenchMemoryCategory = {
	id: string;
	name: string;
	guidance: string;
	autoRecall: boolean;
	createdAt: string;
	updatedAt: string;
};

export type WorkbenchSettings = {
	schema: "feynman.workbenchSettings.v1";
	customConnectors: WorkbenchCustomConnector[];
	allowedDomains: WorkbenchAllowedDomain[];
	credentialRefs: WorkbenchCredentialRef[];
	computeHosts: WorkbenchComputeHost[];
	computeProviderPreferences: WorkbenchComputeProviderPreference[];
	permissionGrants: WorkbenchPermissionGrant[];
	memoryCategories: WorkbenchMemoryCategory[];
	updatedAt: string;
};

const SETTINGS_SCHEMA = "feynman.workbenchSettings.v1" as const;

function nowIso(): string {
	return new Date().toISOString();
}

function settingsPath(workingDir: string): string {
	return migratedWorkbenchDataPath(workingDir, "settings.json");
}

function emptySettings(): WorkbenchSettings {
	return {
		schema: SETTINGS_SCHEMA,
		customConnectors: [],
		allowedDomains: [],
		credentialRefs: [],
		computeHosts: [],
		computeProviderPreferences: [],
		permissionGrants: [],
		memoryCategories: [],
		updatedAt: nowIso(),
	};
}

function recordObject(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
	const text = typeof value === "string" ? value.trim() : "";
	return text || undefined;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function stringListValue(value: unknown, maxItems: number, maxLength: number): string[] {
	const rawItems = Array.isArray(value)
		? value.flatMap((item) => typeof item === "string" ? item.split(/[,\n]/) : [])
		: typeof value === "string"
			? value.split(/[,\n]/)
			: [];
	const seen = new Set<string>();
	const items: string[] = [];
	for (const rawItem of rawItems) {
		const item = rawItem.trim().slice(0, maxLength);
		if (!item || seen.has(item)) continue;
		seen.add(item);
		items.push(item);
		if (items.length >= maxItems) break;
	}
	return items;
}

function collectionArray<T>(value: unknown, normalize: (record: Record<string, unknown>) => T | undefined): T[] {
	return Array.isArray(value)
		? value.map((record) => normalize(recordObject(record))).filter((record): record is T => Boolean(record))
		: [];
}

function normalizeId(value: string | undefined): string {
	const id = value?.trim();
	return id && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) ? id : randomUUID();
}

function normalizeTransport(value: unknown): WorkbenchCustomConnector["transport"] {
	if (value === "local" || value === "sse" || value === "streamable_http") return value;
	return "streamable_http";
}

function normalizeDecision(value: unknown): WorkbenchPermissionGrant["decision"] {
	if (value === "allow" || value === "ask" || value === "deny") return value;
	return "ask";
}

function normalizeDomain(value: string): string {
	const domain = value.trim().toLowerCase();
	if (!/^[a-z0-9][a-z0-9.-]*\.[a-z0-9.-]+$/.test(domain) || domain.includes("..") || domain.endsWith(".")) {
		throw new Error("Domain must be a full hostname like data.example.edu.");
	}
	return domain;
}

function normalizeConnector(record: Record<string, unknown>): WorkbenchCustomConnector | undefined {
	const name = stringValue(record.name);
	const url = stringValue(record.url);
	const command = stringValue(record.command);
	const transport = normalizeTransport(record.transport);
	if (!name || (transport === "local" ? !command : !url)) return undefined;
	const createdAt = stringValue(record.createdAt) ?? nowIso();
	const assignedSpecialists = stringListValue(record.assignedSpecialists, 24, 80);
	const excludedTools = stringListValue(record.excludedTools, 128, 255);
	return {
		id: normalizeId(stringValue(record.id)),
		name: name.slice(0, 80),
		...(stringValue(record.description) ? { description: stringValue(record.description)!.slice(0, 400) } : {}),
		...(assignedSpecialists.length ? { assignedSpecialists } : {}),
		...(excludedTools.length ? { excludedTools } : {}),
		url: url ?? "",
		transport,
		...(command ? { command } : {}),
		...(stringValue(record.env) ? { env: stringValue(record.env)!.slice(0, 4000) } : {}),
		...(stringValue(record.oauthServerUrl) ? { oauthServerUrl: stringValue(record.oauthServerUrl)!.slice(0, 2048) } : {}),
		...(stringValue(record.clientId) ? { clientId: stringValue(record.clientId)!.slice(0, 255) } : {}),
		...(stringValue(record.scopes) ? { scopes: stringValue(record.scopes)!.slice(0, 1024) } : {}),
		...(stringValue(record.headersHelper) ? { headersHelper: stringValue(record.headersHelper)!.slice(0, 4096) } : {}),
		...(booleanValue(record.skipApprovals, false) ? { skipApprovals: true } : {}),
		createdAt,
		updatedAt: stringValue(record.updatedAt) ?? createdAt,
	};
}

function normalizeAllowedDomain(record: Record<string, unknown>): WorkbenchAllowedDomain | undefined {
	const domain = stringValue(record.domain);
	if (!domain) return undefined;
	return {
		id: normalizeId(stringValue(record.id)),
		domain: normalizeDomain(domain),
		createdAt: stringValue(record.createdAt) ?? nowIso(),
	};
}

function normalizeCredentialRef(record: Record<string, unknown>): WorkbenchCredentialRef | undefined {
	const name = stringValue(record.name);
	const provider = stringValue(record.provider);
	const envVar = stringValue(record.envVar)?.toUpperCase().replace(/[^A-Z0-9_]/g, "");
	if (!name || !provider || !envVar) return undefined;
	const createdAt = stringValue(record.createdAt) ?? nowIso();
	return {
		id: normalizeId(stringValue(record.id)),
		name: name.slice(0, 128),
		provider: provider.slice(0, 64),
		envVar: envVar.slice(0, 128),
		...(stringValue(record.description) ? { description: stringValue(record.description)!.slice(0, 400) } : {}),
		createdAt,
		updatedAt: stringValue(record.updatedAt) ?? createdAt,
	};
}

function normalizeComputeHost(record: Record<string, unknown>): WorkbenchComputeHost | undefined {
	const name = stringValue(record.name);
	const host = stringValue(record.host);
	if (!name || !host) return undefined;
	const createdAt = stringValue(record.createdAt) ?? nowIso();
	return {
		id: normalizeId(stringValue(record.id)),
		name: name.slice(0, 128),
		host: host.slice(0, 255),
		...(stringValue(record.user) ? { user: stringValue(record.user)!.slice(0, 128) } : {}),
		...(stringValue(record.port) ? { port: stringValue(record.port)!.slice(0, 12) } : {}),
		...(stringValue(record.identityFile) ? { identityFile: stringValue(record.identityFile)!.slice(0, 512) } : {}),
		...(stringValue(record.scheduler) ? { scheduler: stringValue(record.scheduler)!.slice(0, 32) } : {}),
		...(stringValue(record.guidance) ? { guidance: stringValue(record.guidance)!.slice(0, 1024) } : {}),
		...(stringValue(record.scratchRoot) ? { scratchRoot: stringValue(record.scratchRoot)!.slice(0, 512) } : {}),
		createdAt,
		updatedAt: stringValue(record.updatedAt) ?? createdAt,
	};
}

function normalizeComputeProviderPreference(record: Record<string, unknown>): WorkbenchComputeProviderPreference | undefined {
	const id = stringValue(record.id);
	if (!id) return undefined;
	const createdAt = stringValue(record.createdAt) ?? nowIso();
	return {
		id: id.slice(0, 128),
		enabled: booleanValue(record.enabled, true),
		createdAt,
		updatedAt: stringValue(record.updatedAt) ?? createdAt,
	};
}

function normalizePermissionGrant(record: Record<string, unknown>): WorkbenchPermissionGrant | undefined {
	const name = stringValue(record.name);
	const scope = stringValue(record.scope);
	if (!name || !scope) return undefined;
	const createdAt = stringValue(record.createdAt) ?? nowIso();
	return {
		id: normalizeId(stringValue(record.id)),
		name: name.slice(0, 128),
		scope: scope.slice(0, 255),
		decision: normalizeDecision(record.decision),
		...(stringValue(record.description) ? { description: stringValue(record.description)!.slice(0, 400) } : {}),
		createdAt,
		updatedAt: stringValue(record.updatedAt) ?? createdAt,
	};
}

function normalizeMemoryCategory(record: Record<string, unknown>): WorkbenchMemoryCategory | undefined {
	const name = stringValue(record.name);
	const guidance = stringValue(record.guidance);
	if (!name || !guidance) return undefined;
	const createdAt = stringValue(record.createdAt) ?? nowIso();
	return {
		id: normalizeId(stringValue(record.id)),
		name: name.slice(0, 64),
		guidance: guidance.slice(0, 1024),
		autoRecall: booleanValue(record.autoRecall, true),
		createdAt,
		updatedAt: stringValue(record.updatedAt) ?? createdAt,
	};
}

export function readWorkbenchSettings(workingDir: string): WorkbenchSettings {
	const path = settingsPath(workingDir);
	if (!existsSync(path)) return emptySettings();
	try {
		const parsed = recordObject(JSON.parse(readFileSync(path, "utf8")));
		return {
			schema: SETTINGS_SCHEMA,
			customConnectors: collectionArray(parsed.customConnectors, normalizeConnector),
			allowedDomains: collectionArray(parsed.allowedDomains, normalizeAllowedDomain),
			credentialRefs: collectionArray(parsed.credentialRefs, normalizeCredentialRef),
			computeHosts: collectionArray(parsed.computeHosts, normalizeComputeHost),
			computeProviderPreferences: collectionArray(parsed.computeProviderPreferences, normalizeComputeProviderPreference),
			permissionGrants: collectionArray(parsed.permissionGrants, normalizePermissionGrant),
			memoryCategories: collectionArray(parsed.memoryCategories, normalizeMemoryCategory),
			updatedAt: stringValue(parsed.updatedAt) ?? nowIso(),
		};
	} catch {
		return emptySettings();
	}
}

function writeWorkbenchSettings(workingDir: string, settings: WorkbenchSettings): WorkbenchSettings {
	const path = settingsPath(workingDir);
	const next = { ...settings, schema: SETTINGS_SCHEMA, updatedAt: nowIso() };
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
	return next;
}

function upsertById<T extends { id: string; createdAt: string; updatedAt?: string }>(records: T[], record: T): T[] {
	const index = records.findIndex((item) => item.id === record.id);
	if (index === -1) return [...records, record];
	return records.map((item) => item.id === record.id ? { ...record, createdAt: item.createdAt } : item);
}

export function upsertWorkbenchSettingsRecord(
	workingDir: string,
	input: { collection: WorkbenchSettingsCollection; record: Record<string, unknown> },
): WorkbenchSettings {
	const settings = readWorkbenchSettings(workingDir);
	const timestamp = nowIso();
	const record = {
		...input.record,
		id: normalizeId(stringValue(input.record.id)),
		createdAt: timestamp,
		updatedAt: timestamp,
	};
	const normalized = (() => {
		switch (input.collection) {
			case "allowedDomains":
				return normalizeAllowedDomain(record);
			case "computeHosts":
				return normalizeComputeHost(record);
			case "computeProviderPreferences":
				return normalizeComputeProviderPreference(record);
			case "credentialRefs":
				return normalizeCredentialRef(record);
			case "customConnectors":
				return normalizeConnector(record);
			case "memoryCategories":
				return normalizeMemoryCategory(record);
			case "permissionGrants":
				return normalizePermissionGrant(record);
		}
	})();
	if (!normalized) throw new Error("Missing required settings fields.");
	return writeWorkbenchSettings(workingDir, {
		...settings,
		[input.collection]: upsertById(settings[input.collection] as Array<typeof normalized>, normalized),
	});
}

export function removeWorkbenchSettingsRecord(
	workingDir: string,
	collection: WorkbenchSettingsCollection,
	id: string,
): WorkbenchSettings {
	const settings = readWorkbenchSettings(workingDir);
	const targetId = id.trim();
	if (!targetId) throw new Error("Missing settings record id.");
	return writeWorkbenchSettings(workingDir, {
		...settings,
		[collection]: settings[collection].filter((record) => record.id !== targetId),
	});
}
