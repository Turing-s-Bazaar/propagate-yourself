import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { readWorkbenchSettings, type WorkbenchSettings } from "./settings-store.js";
import type { WorkbenchComputeProvider } from "./types.js";

function modalConfigExists(): boolean {
	return existsSync(resolve(homedir(), ".modal.toml"));
}

function modalCredentialStatus(): WorkbenchComputeProvider["status"] {
	return (process.env.MODAL_TOKEN_ID?.trim() && process.env.MODAL_TOKEN_SECRET?.trim()) || modalConfigExists()
		? "configured"
		: "available";
}

function modalCredentialDetail(): string {
	if (process.env.MODAL_TOKEN_ID?.trim() && process.env.MODAL_TOKEN_SECRET?.trim()) return "MODAL_TOKEN_ID / MODAL_TOKEN_SECRET";
	if (modalConfigExists()) return "~/.modal.toml";
	return "MODAL_TOKEN_ID / MODAL_TOKEN_SECRET or ~/.modal.toml";
}

function computeProviderEnabled(settings: WorkbenchSettings, providerId: string, fallback: boolean): boolean {
	return settings.computeProviderPreferences.find((item) => item.id === providerId)?.enabled ?? fallback;
}

function computeToggleAction(enabled: boolean): WorkbenchComputeProvider["actions"] {
	return [{
		id: enabled ? "disable" : "enable",
		label: enabled ? "Disable" : "Enable",
		description: enabled
			? "Hide this provider from active workbench compute selection and runtime context."
			: "Expose this provider to active workbench compute selection and runtime context.",
	}];
}

export function buildComputeProviders(workingDir: string): WorkbenchComputeProvider[] {
	const settings = readWorkbenchSettings(workingDir);
	const modalStatus = modalCredentialStatus();
	const nvidiaStatus = process.env.NVIDIA_API_KEY?.trim() ? "configured" as const : "available" as const;
	const baseProviders: WorkbenchComputeProvider[] = [
		{
			id: "local-workspace",
			name: "Local Workspace",
			family: "Feynman",
			status: "available",
			description: "Indexes research artifacts from this checkout without sending files to a hosted dashboard.",
			capabilities: ["outputs", "papers", "notes", "plans", "drafts"],
			enabled: computeProviderEnabled(settings, "local-workspace", true),
			checked: computeProviderEnabled(settings, "local-workspace", true),
			tierType: "local",
			detail: "Workspace-local files and generated research artifacts",
			actions: computeToggleAction(computeProviderEnabled(settings, "local-workspace", true)),
		},
		{
			id: "pi-subagents",
			name: "Pi Research Agents",
			family: "Pi",
			status: "configured",
			description: "Bundled researcher, reviewer, writer, and verifier agents remain the execution layer.",
			capabilities: ["researcher", "reviewer", "writer", "verifier"],
			enabled: computeProviderEnabled(settings, "pi-subagents", true),
			checked: computeProviderEnabled(settings, "pi-subagents", true),
			tierType: "session",
			detail: ".feynman/agents",
			actions: computeToggleAction(computeProviderEnabled(settings, "pi-subagents", true)),
		},
		{
			id: "artifact-provenance",
			name: "Artifact Provenance",
			family: "Verification",
			status: "read-only",
			description: "Surfaces provenance sidecars, score audits, and lab-notebook checkpoints beside each run.",
			capabilities: ["sidecars", "verification checks", "lab notebook"],
			enabled: true,
			checked: true,
			tierType: "local",
			detail: "Always on for artifact history and verification records",
			managed: true,
		},
		{
			id: "modal",
			name: "Modal",
			family: "Cloud provider",
			status: modalStatus,
			description: modalStatus === "configured"
				? "Cloud GPU/provider target connected through the local Modal credential path."
				: "Cloud GPU/provider target for heavier scientific runs; configure Modal tokens or ~/.modal.toml.",
			capabilities: ["gpu", "serverless", "python", "notebook"],
			enabled: computeProviderEnabled(settings, "modal", modalStatus === "configured"),
			checked: computeProviderEnabled(settings, "modal", modalStatus === "configured"),
			tierType: "cloud",
			detail: modalCredentialDetail(),
			diagnostics: [
				process.env.MODAL_TOKEN_ID?.trim() && process.env.MODAL_TOKEN_SECRET?.trim()
					? "Auth: Modal token environment variables are present; values are not displayed."
					: modalConfigExists()
						? "Auth: ~/.modal.toml exists; Modal's local Python client can read credentials from this file."
						: "Auth: no Modal token environment variables or ~/.modal.toml were detected.",
				"Execution: Python notebook cells can use Modal cloud mode; missing CLI or credentials records an explicit compute error.",
			],
			actions: computeToggleAction(computeProviderEnabled(settings, "modal", modalStatus === "configured")),
		},
		{
			id: "nvidia-bionemo",
			name: "NVIDIA BioNeMo NIM",
			family: "Model endpoint",
			status: nvidiaStatus,
			description: "Executable scientific model endpoint path for hosted ESMFold and self-hosted AlphaFold2 NIM protein-structure inference.",
			capabilities: ["biology", "inference", "esmfold", "alphafold2"],
			enabled: computeProviderEnabled(settings, "nvidia-bionemo", true),
			checked: computeProviderEnabled(settings, "nvidia-bionemo", true),
			tierType: "cloud",
			detail: "NVIDIA_API_KEY",
			diagnostics: [
				process.env.NVIDIA_API_KEY?.trim()
					? "Auth: NVIDIA_API_KEY is present; the value is not displayed."
					: "Auth: NVIDIA_API_KEY is not present in the server environment.",
				"Execution: feynman_model_endpoint_call runs hosted ESMFold when NVIDIA_API_KEY is present and self-hosted AlphaFold2 NIM by endpointUrl.",
				"Artifacts: endpoint responses are saved under outputs/model-endpoints with a provenance sidecar.",
			],
			tools: [{ name: "feynman_model_endpoint_call", description: "Run hosted ESMFold or self-hosted AlphaFold2 NIM calls and save provenance-backed outputs." }],
			actions: computeToggleAction(computeProviderEnabled(settings, "nvidia-bionemo", true)),
		},
	];
	const sshProviders: WorkbenchComputeProvider[] = settings.computeHosts.map((host) => {
		const id = `ssh:${host.id}`;
		const enabled = computeProviderEnabled(settings, id, true);
		return {
			id,
			name: host.name,
			family: "SSH compute",
			status: "configured",
			description: host.guidance || `Remote workstation or HPC compute host ${host.host}.`,
			capabilities: ["ssh", host.scheduler || "remote", "hpc"].filter((item): item is string => Boolean(item)),
			enabled,
			checked: enabled,
			tierType: "cloud",
			detail: [
				host.user ? `${host.user}@${host.host}` : host.host,
				host.port ? `port ${host.port}` : undefined,
				host.scheduler,
				host.scratchRoot,
			].filter(Boolean).join(" | "),
			settingsCollection: "computeHosts",
			settingsRecordId: host.id,
			actions: [
				...(computeToggleAction(enabled) ?? []),
				{ id: "remove", label: "Remove", description: "Remove this SSH compute host from Feynman settings." },
			],
		};
	});
	return [...baseProviders, ...sshProviders];
}
