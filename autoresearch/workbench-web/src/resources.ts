import type { WorkbenchResource, WorkbenchResourceGroup } from "./types.js";

export type ResourceAction =
	| { kind: "command"; label: string; command: string }
	| { kind: "oauth"; label: string; action: "connect" | "disconnect" | "reconnect"; connectorId: string }
	| { kind: "package"; label: string; action: "disable" | "enable"; sources: string[] }
	| { kind: "remove"; label: string; collection: NonNullable<WorkbenchResource["settingsCollection"]>; id: string }
	| { kind: "settings"; label: string; collection: NonNullable<WorkbenchResource["settingsCollection"]>; record: Record<string, unknown> }
	| { kind: "specialist"; label: string; specialist: string };

export type ResourceDirectoryGroupFilter = "all" | WorkbenchResourceGroup["id"];
export type ResourceDirectoryStatusFilter = "all" | WorkbenchResource["status"];

export type ResourceDirectoryFilters = {
	groupId?: ResourceDirectoryGroupFilter;
	query?: string;
	status?: ResourceDirectoryStatusFilter;
};

export type ResourceDirectoryGroup = {
	group: WorkbenchResourceGroup;
	resources: WorkbenchResource[];
	totalCount: number;
};

export type ResourceDirectoryCounts = {
	available: number;
	configured: number;
	disabled: number;
	groups: number;
	readOnly: number;
	resources: number;
};

export function specialistLabel(name: string): string {
	return name
		.replace(/[_-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizedSearch(value: string | undefined): string {
	return (value ?? "").trim().toLowerCase();
}

function resourceSearchText(resource: WorkbenchResource): string {
	return [
		resource.name,
		resource.description,
		resource.source,
		resource.section,
		resource.path,
		resource.command,
		resource.detail,
		resource.status,
		resource.connectorKind,
		...(resource.tags ?? []),
		...(resource.diagnostics ?? []),
		...(resource.tools ?? []).flatMap((tool) => [tool.name, tool.description ?? ""]),
	].filter(Boolean).join(" ").toLowerCase();
}

export function resourceDirectoryCounts(groups: WorkbenchResourceGroup[]): ResourceDirectoryCounts {
	const resources = groups.flatMap((group) => group.resources);
	return {
		groups: groups.filter((group) => group.resources.length > 0).length,
		resources: resources.length,
		configured: resources.filter((resource) => resource.status === "configured").length,
		available: resources.filter((resource) => resource.status === "available").length,
		disabled: resources.filter((resource) => resource.status === "disabled").length,
		readOnly: resources.filter((resource) => resource.status === "read-only").length,
	};
}

export function filterResourceGroups(
	groups: WorkbenchResourceGroup[],
	filters: ResourceDirectoryFilters = {},
): ResourceDirectoryGroup[] {
	const query = normalizedSearch(filters.query);
	const status = filters.status ?? "all";
	const groupId = filters.groupId ?? "all";
	return groups
		.filter((group) => group.resources.length > 0)
		.filter((group) => groupId === "all" || group.id === groupId)
		.map((group) => {
			const resources = group.resources.filter((resource) =>
				(status === "all" || resource.status === status) &&
				(!query || resourceSearchText(resource).includes(query))
			);
			return {
				group,
				resources,
				totalCount: group.resources.length,
			};
		})
		.filter((group) => group.resources.length > 0);
}

export function resourceActions(resource: WorkbenchResource): ResourceAction[] {
	const actions: ResourceAction[] = [];
	if (resource.source === "Feynman specialist") {
		actions.push({ kind: "specialist", label: "Use specialist", specialist: specialistLabel(resource.name) });
	}
	if (resource.command) {
		actions.push({ kind: "command", label: "Insert command", command: resource.command });
	}
	if (resource.oauthAction && resource.oauthConnectorId) {
		const label = resource.oauthAction === "disconnect"
			? "Disconnect OAuth"
			: resource.oauthAction === "reconnect"
				? "Reconnect OAuth"
				: "Connect OAuth";
		actions.push({ kind: "oauth", label, action: resource.oauthAction, connectorId: resource.oauthConnectorId });
	}
	if (resource.packageSources?.length && resource.packageAction) {
		actions.push({
			kind: "package",
			label: resource.packageAction === "disable" ? "Disable" : "Enable",
			action: resource.packageAction,
			sources: resource.packageSources,
		});
	}
	if (resource.settingsCollection && resource.settingsRecord) {
		actions.push({
			kind: "settings",
			label: resource.settingsCollection === "customConnectors" ? "Connect local" : "Add",
			collection: resource.settingsCollection,
			record: resource.settingsRecord,
		});
	}
	if (resource.settingsCollection && resource.settingsRecordId) {
		actions.push({
			kind: "remove",
			label: "Remove",
			collection: resource.settingsCollection,
			id: resource.settingsRecordId,
		});
	}
	return actions;
}
