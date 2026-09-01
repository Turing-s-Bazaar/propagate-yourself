import { readWorkbenchSettings } from "./settings-store.js";
import type {
	WorkbenchCapabilitySetting,
	WorkbenchComputeProvider,
	WorkbenchResource,
	WorkbenchResourceGroup,
} from "./types.js";

const LOCAL_USER_ID = "local-workbench";

function normalizeResourceId(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 90) || "resource";
}

function timestamp(value: string | undefined, fallback: string): { iso: string; ms: number } {
	const raw = value || fallback;
	const parsed = Date.parse(raw);
	if (Number.isFinite(parsed)) return { iso: new Date(parsed).toISOString(), ms: parsed };
	const fallbackMs = Date.parse(fallback);
	const safeMs = Number.isFinite(fallbackMs) ? fallbackMs : 0;
	return { iso: new Date(safeMs).toISOString(), ms: safeMs };
}

function resourceSettingUpdatedAt(resource: WorkbenchResource, settingsUpdatedAt: string, settingsUpdatedById: Map<string, string>): string {
	if (resource.settingsCollection && resource.settingsRecordId) {
		const direct = settingsUpdatedById.get(`${resource.settingsCollection}:${resource.settingsRecordId}`);
		if (direct) return direct;
	}
	const computePreference = resource.id.startsWith("compute-")
		? settingsUpdatedById.get(`computeProviderPreferences:${resource.id.slice("compute-".length)}`)
		: undefined;
	return computePreference ?? settingsUpdatedAt;
}

function buildSettingsUpdatedById(workingDir: string): { settingsUpdatedAt: string; settingsUpdatedById: Map<string, string> } {
	const settings = readWorkbenchSettings(workingDir);
	const settingsUpdatedById = new Map<string, string>();
	for (const record of settings.allowedDomains) settingsUpdatedById.set(`allowedDomains:${record.id}`, record.createdAt);
	for (const record of settings.computeHosts) settingsUpdatedById.set(`computeHosts:${record.id}`, record.updatedAt);
	for (const record of settings.computeProviderPreferences) settingsUpdatedById.set(`computeProviderPreferences:${record.id}`, record.updatedAt);
	for (const record of settings.credentialRefs) settingsUpdatedById.set(`credentialRefs:${record.id}`, record.updatedAt);
	for (const record of settings.customConnectors) settingsUpdatedById.set(`customConnectors:${record.id}`, record.updatedAt);
	for (const record of settings.memoryCategories) settingsUpdatedById.set(`memoryCategories:${record.id}`, record.updatedAt);
	for (const record of settings.permissionGrants) settingsUpdatedById.set(`permissionGrants:${record.id}`, record.updatedAt);
	return { settingsUpdatedAt: settings.updatedAt, settingsUpdatedById };
}

function computeEnabledByResourceId(compute: WorkbenchComputeProvider[]): Map<string, boolean> {
	return new Map(compute.map((provider) => [normalizeResourceId(`compute-${provider.id}`), provider.enabled]));
}

function resourceEnabled(groupId: string, resource: WorkbenchResource, computeEnabled: Map<string, boolean>): boolean {
	if (groupId === "compute") return computeEnabled.get(resource.id) ?? resource.status !== "disabled";
	return resource.status !== "disabled";
}

function capabilitySettingForResource({
	computeEnabled,
	group,
	resource,
	settingsUpdatedAt,
	settingsUpdatedById,
}: {
	computeEnabled: Map<string, boolean>;
	group: WorkbenchResourceGroup;
	resource: WorkbenchResource;
	settingsUpdatedAt: string;
	settingsUpdatedById: Map<string, string>;
}): WorkbenchCapabilitySetting {
	const updated = timestamp(resourceSettingUpdatedAt(resource, settingsUpdatedAt, settingsUpdatedById), settingsUpdatedAt);
	return {
		userId: LOCAL_USER_ID,
		kind: group.id.slice(0, 32),
		key: resource.id.slice(0, 255),
		enabled: resourceEnabled(group.id, resource, computeEnabled),
		updatedAt: updated.iso,
		updatedAtMs: updated.ms,
		source: resource.source,
		status: resource.status,
		...(resource.settingsCollection ? { settingsCollection: resource.settingsCollection } : {}),
		...(resource.settingsRecordId ? { settingsRecordId: resource.settingsRecordId } : {}),
	};
}

export function buildWorkbenchCapabilitySettings({
	compute,
	resources,
	workingDir,
}: {
	compute: WorkbenchComputeProvider[];
	resources: WorkbenchResourceGroup[];
	workingDir: string;
}): WorkbenchCapabilitySetting[] {
	const { settingsUpdatedAt, settingsUpdatedById } = buildSettingsUpdatedById(workingDir);
	const computeEnabled = computeEnabledByResourceId(compute);
	return resources
		.flatMap((group) =>
			group.resources.map((resource) =>
				capabilitySettingForResource({
					computeEnabled,
					group,
					resource,
					settingsUpdatedAt,
					settingsUpdatedById,
				})
			)
		)
		.sort((a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key));
}
