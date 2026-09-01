import {
	removeWorkbenchSettingsRecord,
	upsertWorkbenchSettingsRecord,
} from "./settings-store.js";

export type WorkbenchComputeProviderAction = "disable" | "enable" | "remove";
export type WorkbenchComputeJobAction = "cancel" | "retry" | "terminate";

function stringField(body: Record<string, unknown>, key: string): string {
	const value = body[key];
	if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${key}.`);
	return value.trim();
}

function computeProviderActionField(body: Record<string, unknown>): WorkbenchComputeProviderAction {
	const value = stringField(body, "action").toLowerCase();
	if (value === "disable" || value === "enable" || value === "remove") return value;
	throw new Error("Compute provider action must be enable, disable, or remove.");
}

function notebookJobIdFromComputeId(value: string): string {
	return value
		.trim()
		.replace(/^compute:/, "")
		.replace(/^notebook:/, "");
}

export function parseWorkbenchComputeJobAction(body: Record<string, unknown>): { action: WorkbenchComputeJobAction; jobId: string } {
	const value = stringField(body, "action").toLowerCase();
	if (value !== "cancel" && value !== "retry" && value !== "terminate") {
		throw new Error("Compute job action must be cancel, terminate, or retry.");
	}
	return {
		action: value,
		jobId: notebookJobIdFromComputeId(stringField(body, "jobId")),
	};
}

export function applyWorkbenchComputeProviderAction(
	workingDir: string,
	body: Record<string, unknown>,
): { action: WorkbenchComputeProviderAction } {
	const action = computeProviderActionField(body);
	const providerId = stringField(body, "providerId");
	if (action === "remove") {
		if (!providerId.startsWith("ssh:")) throw new Error("Only custom SSH compute providers can be removed.");
		removeWorkbenchSettingsRecord(workingDir, "computeHosts", providerId.replace(/^ssh:/, ""));
		return { action };
	}
	upsertWorkbenchSettingsRecord(workingDir, {
		collection: "computeProviderPreferences",
		record: { id: providerId, enabled: action === "enable" },
	});
	return { action };
}
