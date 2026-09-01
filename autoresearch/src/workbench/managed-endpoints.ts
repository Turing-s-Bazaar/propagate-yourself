import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { getWorkbenchDataRoot, migratedWorkbenchDataPath } from "./data-root.js";
import { readWorkbenchRuntimeResources, type WorkbenchRuntimeModelEndpoint } from "./runtime-context.js";
import type { WorkbenchManagedEndpoint } from "./types.js";

function sha256Hex(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function endpointUrl(value: string): URL | undefined {
	try {
		return new URL(value);
	} catch {
		return undefined;
	}
}

function endpointPort(value: string): number {
	const parsed = endpointUrl(value);
	if (!parsed) return 0;
	if (parsed.port) return Number(parsed.port);
	return parsed.protocol === "https:" ? 443 : 80;
}

function endpointLivePath(value: string): string {
	const parsed = endpointUrl(value);
	if (!parsed) return "/";
	return parsed.pathname || "/";
}

function timestampSourceMs(workingDir: string): number {
	const candidates = [
		resolve(workingDir, "outputs", "model-endpoints"),
		migratedWorkbenchDataPath(workingDir, "settings.json"),
		getWorkbenchDataRoot(workingDir),
		workingDir,
	];
	for (const candidate of candidates) {
		if (!existsSync(candidate)) continue;
		const stats = statSync(candidate);
		const ms = stats.mtimeMs || stats.ctimeMs || stats.birthtimeMs || 0;
		if (Number.isFinite(ms) && ms > 0) return ms;
	}
	return Date.now();
}

function endpointState(endpoint: WorkbenchRuntimeModelEndpoint): WorkbenchManagedEndpoint["state"] {
	return endpoint.status === "present" ? "live" : "stopped";
}

function endpointLastError(endpoint: WorkbenchRuntimeModelEndpoint): string | undefined {
	if (endpoint.status === "disabled") return "Disabled in Feynman compute provider settings.";
	if (endpoint.status === "missing" && endpoint.credentialEnvVar) return `${endpoint.credentialEnvVar} is not present in the server environment.`;
	return undefined;
}

function approvedScriptHash(endpoint: WorkbenchRuntimeModelEndpoint): string {
	return sha256Hex(JSON.stringify({
		name: endpoint.id,
		url: endpoint.defaultEndpoint,
		credentialName: endpoint.credentialEnvVar,
		skillName: endpoint.tool,
		models: endpoint.models,
	}));
}

function managedEndpointRow(endpoint: WorkbenchRuntimeModelEndpoint, timestampMs: number): WorkbenchManagedEndpoint {
	const timestamp = new Date(timestampMs).toISOString();
	return {
		name: endpoint.id,
		url: endpoint.defaultEndpoint,
		port: endpointPort(endpoint.defaultEndpoint),
		...(endpoint.credentialEnvVar ? { credentialName: endpoint.credentialEnvVar } : {}),
		skillName: endpoint.tool,
		startScript: "",
		stopScript: "",
		livePath: endpointLivePath(endpoint.defaultEndpoint),
		approvedScriptHash: approvedScriptHash(endpoint),
		state: endpointState(endpoint),
		stateChangedAt: timestamp,
		stateChangedAtMs: timestampMs,
		...(endpointLastError(endpoint) ? { lastError: endpointLastError(endpoint) } : {}),
		createdAt: timestamp,
		createdAtMs: timestampMs,
		registeredBy: "feynman-runtime-context",
		provider: endpoint.provider,
		models: endpoint.models,
		status: endpoint.status,
	};
}

export function buildWorkbenchManagedEndpoints(workingDir: string): WorkbenchManagedEndpoint[] {
	const resources = readWorkbenchRuntimeResources(workingDir);
	const timestampMs = timestampSourceMs(workingDir);
	return resources.modelEndpoints
		.map((endpoint) => managedEndpointRow(endpoint, timestampMs))
		.sort((a, b) => a.name.localeCompare(b.name));
}
