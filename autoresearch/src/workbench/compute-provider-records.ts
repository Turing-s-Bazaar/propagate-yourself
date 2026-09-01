import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { readWorkbenchSettings } from "./settings-store.js";
import type { WorkbenchComputeProvider, WorkbenchComputeProviderRecord } from "./types.js";

function timestampFromIso(value: string | undefined): { iso?: string; ms?: number } {
	if (!value) return {};
	const parsed = Date.parse(value);
	if (!Number.isFinite(parsed)) return {};
	return { iso: new Date(parsed).toISOString(), ms: parsed };
}

function providerMemory(provider: WorkbenchComputeProvider): string {
	return [
		`# ${provider.name}`,
		"",
		provider.description,
		provider.detail ? `\nDetail: ${provider.detail}` : "",
		provider.capabilities.length ? `\nCapabilities: ${provider.capabilities.join(", ")}` : "",
		provider.tools?.length ? `\nTools: ${provider.tools.map((tool) => tool.name).join(", ")}` : "",
	].filter(Boolean).join("\n");
}

function providerEnvironments(provider: WorkbenchComputeProvider): string[] {
	if (provider.id === "local-workspace") return ["local-filesystem", "node", "python", "r", "bash"];
	if (provider.id === "pi-subagents") return ["pi-rpc", "pi-subagents"];
	if (provider.id === "artifact-provenance") return ["artifact-history", "verification"];
	if (provider.id === "modal") return ["modal", "python", "notebook"];
	if (provider.id === "nvidia-bionemo") return ["nvidia-bionemo", "nim", "model-endpoint"];
	if (provider.id.startsWith("ssh:")) return ["ssh", "remote-shell"];
	return provider.capabilities;
}

function providerDataRoots(provider: WorkbenchComputeProvider): string[] {
	if (provider.id === "nvidia-bionemo") return ["outputs/model-endpoints"];
	if (provider.id === "artifact-provenance") return ["outputs", "papers", "notes", "CHANGELOG.md"];
	return ["outputs", "papers", "notes"];
}

function providerProbeTimestamp(workingDir: string, provider: WorkbenchComputeProvider): { iso?: string; ms?: number } {
	if (provider.settingsCollection === "computeHosts" && provider.settingsRecordId) {
		const host = readWorkbenchSettings(workingDir).computeHosts.find((item) => item.id === provider.settingsRecordId);
		return timestampFromIso(host?.updatedAt);
	}
	const root = provider.id === "local-workspace" ? workingDir : resolve(workingDir, ".feynman");
	if (!existsSync(root)) return {};
	const stat = statSync(root);
	const ms = stat.mtimeMs || stat.ctimeMs || stat.birthtimeMs || 0;
	return Number.isFinite(ms) && ms > 0 ? { iso: new Date(ms).toISOString(), ms } : {};
}

function sshHostSettings(workingDir: string, provider: WorkbenchComputeProvider) {
	if (provider.settingsCollection !== "computeHosts" || !provider.settingsRecordId) return undefined;
	return readWorkbenchSettings(workingDir).computeHosts.find((item) => item.id === provider.settingsRecordId);
}

function providerScratchRoot(workingDir: string, provider: WorkbenchComputeProvider): { scratchRoot?: string; source: "probe" | "settings" | "workspace" } {
	const host = sshHostSettings(workingDir, provider);
	if (host?.scratchRoot) return { scratchRoot: host.scratchRoot, source: "settings" };
	if (provider.id === "local-workspace" || provider.id === "artifact-provenance") return { scratchRoot: workingDir, source: "workspace" };
	return { source: "probe" };
}

function providerScheduler(workingDir: string, provider: WorkbenchComputeProvider): string | undefined {
	const host = sshHostSettings(workingDir, provider);
	if (host?.scheduler) return host.scheduler;
	if (provider.id === "modal") return "modal";
	if (provider.id === "pi-subagents") return "pi";
	if (provider.id === "local-workspace") return "local";
	return undefined;
}

function providerInferConfig(provider: WorkbenchComputeProvider): Record<string, string> | undefined {
	if (provider.id !== "nvidia-bionemo") return undefined;
	return { hosted: "ESMFold", selfHosted: "AlphaFold2 NIM", tool: "feynman_model_endpoint_call" };
}

function providerSshOverrides(workingDir: string, provider: WorkbenchComputeProvider): Record<string, string> | undefined {
	const host = sshHostSettings(workingDir, provider);
	if (!host) return undefined;
	return {
		host: host.host,
		...(host.user ? { user: host.user } : {}),
		...(host.port ? { port: host.port } : {}),
		...(host.identityFile ? { identityFile: host.identityFile } : {}),
	};
}

export function buildWorkbenchComputeProviderRecords(
	workingDir: string,
	compute: WorkbenchComputeProvider[],
): WorkbenchComputeProviderRecord[] {
	return compute.map((provider) => {
		const scratch = providerScratchRoot(workingDir, provider);
		const probed = providerProbeTimestamp(workingDir, provider);
		return {
			name: provider.id,
			displayName: provider.name,
			family: provider.family.slice(0, 16),
			memoryMd: providerMemory(provider),
			environments: providerEnvironments(provider),
			memoryRev: providerMemory(provider).length,
			...(scratch.scratchRoot ? { scratchRoot: scratch.scratchRoot } : {}),
			...(providerScheduler(workingDir, provider) ? { scheduler: providerScheduler(workingDir, provider) } : {}),
			...(probed.iso ? { probedAt: probed.iso, probedAtMs: probed.ms } : {}),
			dataRoots: providerDataRoots(provider),
			...(providerSshOverrides(workingDir, provider) ? { sshOverrides: providerSshOverrides(workingDir, provider) } : {}),
			...(provider.id === "modal" ? { maxConcurrentJobs: 4, maxTimeoutSec: 86_400 } : {}),
			enabled: provider.enabled,
			scratchRootSource: scratch.source,
			home: provider.id === "local-workspace" ? workingDir : homedir(),
			...(provider.id === "nvidia-bionemo" ? { inferConfig: providerInferConfig(provider), appName: "feynman-bionemo" } : {}),
			...(provider.id === "modal" ? { appName: "feynman-modal", modalEnvironment: process.env.MODAL_ENVIRONMENT || "main" } : {}),
			priorAppNames: [],
			egressPolicy: "Feynman Settings Network policy",
			status: provider.status,
			tierType: provider.tierType,
			...(provider.settingsCollection ? { settingsCollection: provider.settingsCollection } : {}),
			...(provider.settingsRecordId ? { settingsRecordId: provider.settingsRecordId } : {}),
		};
	}).sort((a, b) => a.name.localeCompare(b.name));
}
