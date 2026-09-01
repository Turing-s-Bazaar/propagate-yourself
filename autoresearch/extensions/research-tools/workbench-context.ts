import { existsSync, readFileSync } from "node:fs";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { migratedWorkbenchDataPath } from "../../src/workbench/data-root.js";

type WorkbenchSettings = {
	allowedDomains?: Array<{ domain?: string; id?: string }>;
	computeHosts?: Array<{
		guidance?: string;
		host?: string;
		id?: string;
		name?: string;
		port?: string;
		scheduler?: string;
		scratchRoot?: string;
		user?: string;
	}>;
	credentialRefs?: Array<{
		description?: string;
		envVar?: string;
		id?: string;
		name?: string;
		provider?: string;
	}>;
	customConnectors?: Array<{
		assignedSpecialists?: string[] | string;
		clientId?: string;
		command?: string;
		description?: string;
		excludedTools?: string[] | string;
		headersHelper?: string;
		id?: string;
		name?: string;
		oauthServerUrl?: string;
		scopes?: string;
		skipApprovals?: boolean;
		transport?: string;
		url?: string;
	}>;
	memoryCategories?: Array<{
		autoRecall?: boolean;
		guidance?: string;
		id?: string;
		name?: string;
	}>;
	permissionGrants?: Array<{
		decision?: string;
		description?: string;
		id?: string;
		name?: string;
		scope?: string;
	}>;
};

function settingsPath(cwd: string): string {
	return migratedWorkbenchDataPath(cwd, "settings.json");
}

function readSettings(cwd: string): WorkbenchSettings {
	const path = settingsPath(cwd);
	if (!existsSync(path)) return {};
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as WorkbenchSettings : {};
	} catch {
		return {};
	}
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringListValue(value: unknown): string[] {
	const rawItems = Array.isArray(value)
		? value.flatMap((item) => typeof item === "string" ? item.split(/[,\n]/) : [])
		: typeof value === "string"
			? value.split(/[,\n]/)
			: [];
	const seen = new Set<string>();
	const items: string[] = [];
	for (const rawItem of rawItems) {
		const item = rawItem.trim();
		if (!item || seen.has(item)) continue;
		seen.add(item);
		items.push(item);
	}
	return items;
}

function credentialStatus(envVar: string | undefined): "missing" | "present" {
	return envVar && process.env[envVar]?.trim() ? "present" : "missing";
}

function sanitizeWorkbenchContext(cwd: string, includeDiagnostics: boolean | undefined): Record<string, unknown> {
	const settings = readSettings(cwd);
	const customConnectors = (settings.customConnectors ?? []).flatMap((connector) => {
		const name = stringValue(connector.name);
		if (!name) return [];
		const transport = stringValue(connector.transport) ?? "streamable_http";
		const oauth = Boolean(connector.oauthServerUrl || connector.clientId || connector.scopes);
		const headers = Boolean(connector.headersHelper);
		const assignedSpecialists = stringListValue(connector.assignedSpecialists);
		const excludedTools = stringListValue(connector.excludedTools);
		return [{
			id: stringValue(connector.id) ?? name,
			name,
			description: stringValue(connector.description),
			assignedSpecialists,
			excludedTools,
			transport,
			target: transport === "local" ? stringValue(connector.command) : stringValue(connector.url),
			auth: oauth && headers ? "oauth-and-headers-helper" : oauth ? "oauth" : headers ? "headers-helper" : "none",
			scopes: stringValue(connector.scopes),
			skipApprovals: connector.skipApprovals === true,
		}];
	});
	const credentialRefs = (settings.credentialRefs ?? []).flatMap((credential) => {
		const envVar = stringValue(credential.envVar);
		const name = stringValue(credential.name);
		const provider = stringValue(credential.provider);
		if (!envVar || !name || !provider) return [];
		return [{
			id: stringValue(credential.id) ?? name,
			name,
			provider,
			envVar,
			status: credentialStatus(envVar),
			description: stringValue(credential.description),
		}];
	});
	const context = {
		schema: "feynman.workbenchContext.v1",
		capturedAt: new Date().toISOString(),
		workspace: cwd,
		customConnectors,
		credentialRefs,
		permissionGrants: (settings.permissionGrants ?? []).map((grant) => ({
			id: stringValue(grant.id) ?? stringValue(grant.name) ?? "grant",
			name: stringValue(grant.name),
			scope: stringValue(grant.scope),
			decision: stringValue(grant.decision) ?? "ask",
			description: stringValue(grant.description),
		})),
		allowedDomains: (settings.allowedDomains ?? []).map((domain) => stringValue(domain.domain)).filter(Boolean),
		computeHosts: (settings.computeHosts ?? []).map((host) => ({
			id: stringValue(host.id) ?? stringValue(host.name) ?? "host",
			name: stringValue(host.name),
			target: [
				host.user ? `${host.user}@${host.host}` : stringValue(host.host),
				host.port ? `port ${host.port}` : undefined,
			].filter(Boolean).join(" "),
			scheduler: stringValue(host.scheduler),
			scratchRoot: stringValue(host.scratchRoot),
			guidance: stringValue(host.guidance),
		})),
		modelEndpoints: [{
			id: "nvidia-bionemo",
			name: "NVIDIA BioNeMo NIM",
			provider: "nvidia-bionemo",
			models: ["esmfold", "alphafold2"],
			defaultEndpoint: "https://health.api.nvidia.com/v1/biology/nvidia/esmfold",
			credentialEnvVar: "NVIDIA_API_KEY",
			status: credentialStatus("NVIDIA_API_KEY"),
			tool: "feynman_model_endpoint_call",
			description: "Hosted ESMFold requires NVIDIA_API_KEY; self-hosted AlphaFold2 NIM can be called with endpointUrl.",
		}],
		memoryCategories: (settings.memoryCategories ?? []).map((category) => ({
			id: stringValue(category.id) ?? stringValue(category.name) ?? "memory",
			name: stringValue(category.name),
			guidance: stringValue(category.guidance),
			autoRecall: category.autoRecall !== false,
		})),
		...(includeDiagnostics ? {
			diagnostics: [
				"Credential values are not returned.",
				"Streamable HTTP, SSE, and local command custom MCP connectors can be discovered with feynman_connector_tools and called through feynman_connector_call.",
				"Scientific model endpoints can be called with feynman_model_endpoint_call and save output artifacts under outputs/model-endpoints.",
				"Connector assignedSpecialists and excludedTools are returned as policy metadata for specialist-scoped chat.",
				"Deny grants are unavailable; ask grants create pending permission requests before execution.",
			],
		} : {}),
	};
	return context;
}

export function registerWorkbenchContextTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "feynman_workbench_context",
		label: "Feynman Workbench Context",
		description:
			"Inspect sanitized in-app Feynman science workbench resources: custom connectors, credential refs, permission grants, allowed domains, compute hosts, model endpoints, and memory categories. Never returns secret values.",
		promptSnippet: "Inspect configured Feynman workbench resources and policies without exposing secret values.",
		promptGuidelines: [
			"Use feynman_workbench_context when a workbench chat needs to know which custom connectors, credential refs, grants, compute hosts, model endpoints, allowed domains, or memory categories are configured.",
			"Use feynman_connector_tools and feynman_connector_call for Streamable HTTP, SSE, or local command connector discovery and execution.",
			"Use feynman_model_endpoint_call for hosted ESMFold or self-hosted AlphaFold2 NIM inference calls.",
			"Respect connector assignedSpecialists and excludedTools when deciding which connector tools are available in a specialist chat.",
			"Treat credential values as unavailable; use only the env var names and present/missing status.",
			"Treat deny grants as unavailable and ask grants as requiring explicit user confirmation before use.",
		],
		parameters: Type.Object({
			includeDiagnostics: Type.Optional(Type.Boolean({ description: "Include runtime diagnostics and bridge limitations." })),
		}),
		async execute(_toolCallId, params) {
			const result = sanitizeWorkbenchContext(process.cwd(), params.includeDiagnostics);
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				details: result,
			};
		},
	});
}
