import {
	PI_SUBAGENTS_AGENT_DIAGNOSTICS_PATCH_MARKER,
	patchPiSubagentAgentDiscovery,
} from "./pi-subagents-agent-discovery-patch.mjs";

const PATCH_MARKER = PI_SUBAGENTS_AGENT_DIAGNOSTICS_PATCH_MARKER;

function replaceRequired(source, original, replacement, label) {
	if (!source.includes(original)) {
		throw new Error(`Cannot apply ${PATCH_MARKER}: missing ${label}.`);
	}
	return source.replace(original, replacement);
}

function patchPreflight(source) {
	if (source.includes("findBlockingAgentDiagnostic(input.agent")) {
		return source;
	}
	if (!source.includes("const resolvedAgent = resolveAgentName(input.agent, discovered.agents);")) {
		return source;
	}
	let patched = replaceRequired(
		source,
		"import { discoverAgents, discoverAgentsAll, resolveAgentName, type AgentConfig, type AgentScope, type AgentSource } from \"../agents/agents.ts\";",
		"import { discoverAgents, discoverAgentsAll, findBlockingAgentDiagnostic, resolveAgentName, type AgentConfig, type AgentScope, type AgentSource } from \"../agents/agents.ts\";",
		"preflight agent import",
	);
	patched = replaceRequired(
		patched,
		[
			"\tconst discovered = discoverAgents(effectiveCwd, scope);",
			"\tconst resolvedAgent = resolveAgentName(input.agent, discovered.agents);",
			"\tif (resolvedAgent.error) {",
		].join("\n"),
		[
			"\tconst discovered = discoverAgents(effectiveCwd, scope);",
			"\tconst resolvedAgent = resolveAgentName(input.agent, discovered.agents);",
			"\tconst ambiguousCandidates = resolvedAgent.error",
			"\t\t? discovered.agents.filter((agent) => resolveAgentName(input.agent, [agent]).agent)",
			"\t\t: resolvedAgent.agent;",
			"\tconst invalidAgent = findBlockingAgentDiagnostic(input.agent, ambiguousCandidates, discovered.agentDiagnostics);",
			"\tif (invalidAgent) {",
			"\t\tconst message = `Agent '${input.agent}' has invalid configuration: ${invalidAgent.error}`;",
			"\t\treturn { ok: false, code: \"missing_agent\", message, diagnostics: [{ code: \"missing_agent\", severity: \"error\", message }] };",
			"\t}",
			"\tif (resolvedAgent.error) {",
		].join("\n"),
		"preflight invalid-agent guard",
	);
	return patched;
}

function patchExecutor(source) {
	if (source.includes("canonicalizeExecutionParams(effectiveParams, discoveredAgents, discovered.agentDiagnostics)")) {
		return source;
	}
	if (!source.includes("function canonicalizeAgentName(name: string, agents: AgentConfig[])")) {
		return source;
	}
	let patched = replaceRequired(
		source,
		"import { resolveAgentName, type AgentConfig, type AgentScope } from \"../../agents/agents.ts\";",
		"import { findBlockingAgentDiagnostic, resolveAgentName, type AgentConfig, type AgentDiscoveryDiagnostic, type AgentScope } from \"../../agents/agents.ts\";",
		"executor agent import",
	);
	patched = replaceRequired(
		patched,
		"\tdiscoverAgents: (cwd: string, scope: AgentScope) => { agents: AgentConfig[]; modelScope?: ModelScopeConfig };",
		"\tdiscoverAgents: (cwd: string, scope: AgentScope) => { agents: AgentConfig[]; agentDiagnostics?: AgentDiscoveryDiagnostic[]; modelScope?: ModelScopeConfig };",
		"executor discovery contract",
	);
	patched = replaceRequired(
		patched,
		[
			"function canonicalizeAgentName(name: string, agents: AgentConfig[]): { name?: string; error?: string } {",
			"\tconst resolved = resolveAgentName(name, agents);",
			"\tif (resolved.error) return { error: resolved.error };",
			"\tif (!resolved.agent) return { error: `Unknown agent: ${name}` };",
			"\treturn { name: resolved.agent.name };",
			"}",
			"",
			"function canonicalizeExecutionParams(params: SubagentParamsLike, agents: AgentConfig[]): { params?: SubagentParamsLike; error?: string } {",
			"\tconst resolve = (name: string, location?: string): { name?: string; error?: string } => {",
			"\t\tconst result = canonicalizeAgentName(name, agents);",
		].join("\n"),
		[
			"function canonicalizeAgentName(name: string, agents: AgentConfig[], diagnostics?: AgentDiscoveryDiagnostic[]): { name?: string; error?: string } {",
			"\tconst resolved = resolveAgentName(name, agents);",
			"\tconst candidates = resolved.error ? agents.filter((agent) => resolveAgentName(name, [agent]).agent) : resolved.agent;",
			"\tconst diagnostic = findBlockingAgentDiagnostic(name, candidates, diagnostics);",
			"\tif (diagnostic) return { error: `Agent '${name}' has invalid configuration: ${diagnostic.error}` };",
			"\tif (resolved.error) return { error: resolved.error };",
			"\tif (!resolved.agent) return { error: `Unknown agent: ${name}` };",
			"\treturn { name: resolved.agent.name };",
			"}",
			"",
			"function canonicalizeExecutionParams(params: SubagentParamsLike, agents: AgentConfig[], diagnostics?: AgentDiscoveryDiagnostic[]): { params?: SubagentParamsLike; error?: string } {",
			"\tconst resolve = (name: string, location?: string): { name?: string; error?: string } => {",
			"\t\tconst result = canonicalizeAgentName(name, agents, diagnostics);",
		].join("\n"),
		"executor canonicalization",
	);
	patched = replaceRequired(
		patched,
		"\t\tconst canonicalParams = canonicalizeExecutionParams(effectiveParams, discoveredAgents);",
		"\t\tconst canonicalParams = canonicalizeExecutionParams(effectiveParams, discoveredAgents, discovered.agentDiagnostics);",
		"executor invalid-agent guard",
	);
	return patched;
}

function patchLegacyManagement(source) {
	const legacyListAnchor = [
		"\t\t...(diagnostics.length ? [",
		"\t\t\t\"\",",
		"\t\t\t\"Chain diagnostics:\",",
		"\t\t\t...diagnostics.map((entry) => `- ${entry.filePath}: ${entry.error}`),",
		"\t\t] : []),",
	].join("\n");
	const compactLegacyListAnchor =
		"\t\t...(diagnostics.length ? [\"\", \"Chain diagnostics:\", ...diagnostics.map((entry) => `- ${entry.filePath}: ${entry.error}`)] : []),";
	const legacyGetAnchor = [
		"\t\tconst raw = params.agent.trim();",
		"\t\tconst sanitized = sanitizeName(raw);",
		"\t\tconst d = discoverAgentsAll(ctx.cwd);",
		"\t\tconst matches = mergeAgentsForScope(scope, d.user, d.project, d.builtin, d.package)",
		"\t\t\t.filter((agent) => agent.name === raw || agent.name === sanitized);",
		"\t\tif (!matches.length) {",
		"\t\t\tconst msg = `Agent '${params.agent}' not found. Available: ${availableNames(ctx.cwd, \"agent\").join(\", \") || \"none\"}.`;",
		"\t\t\tif (!hasBoth) return result(msg, true);",
		"\t\t\tblocks.push(msg);",
		"\t\t} else {",
	].join("\n");
	const listAnchor = source.includes(legacyListAnchor)
		? legacyListAnchor
		: source.includes(compactLegacyListAnchor)
			? compactLegacyListAnchor
			: undefined;

	if (!listAnchor || !source.includes(legacyGetAnchor)) {
		return source;
	}

	let patched = replaceRequired(
		source,
		[
			"\ttype AgentConfig,",
			"\ttype AgentScope,",
		].join("\n"),
		[
			"\ttype AgentConfig,",
			"\ttype AgentDiscoveryDiagnostic,",
			"\ttype AgentScope,",
		].join("\n"),
		"legacy management diagnostic type import",
	);
	patched = replaceRequired(
		patched,
		[
			"\tdiscoverAgentsAll,",
			"\tbuildRuntimeName,",
		].join("\n"),
		[
			"\tdiscoverAgentsAll,",
			"\tfindBlockingAgentDiagnostic,",
			"\tbuildRuntimeName,",
		].join("\n"),
		"legacy management diagnostic import",
	);
	patched = replaceRequired(
		patched,
		"function findChains(name: string, cwd: string, scope: AgentScope = \"both\"): ChainConfig[] {",
		[
			"function diagnosticsForScope(diagnostics: AgentDiscoveryDiagnostic[] | undefined, scope: AgentScope): AgentDiscoveryDiagnostic[] | undefined {",
			"\tif (scope === \"both\") return diagnostics;",
			"\tconst excludedSource = scope === \"user\" ? \"project\" : \"user\";",
			"\treturn diagnostics?.filter((diagnostic) => diagnostic.source !== excludedSource);",
			"}",
			"",
			"function findChains(name: string, cwd: string, scope: AgentScope = \"both\"): ChainConfig[] {",
		].join("\n"),
		"legacy management diagnostic scope",
	);
	patched = replaceRequired(
		patched,
		listAnchor,
		[
			listAnchor,
			"\t\t...(diagnosticsForScope(d.agentDiagnostics, scope)?.length ? [",
			"\t\t\t\"\",",
			"\t\t\t\"Invalid agent definitions:\",",
			"\t\t\t...diagnosticsForScope(d.agentDiagnostics, scope)!.map((diagnostic) => `- ${diagnostic.name ?? diagnostic.filePath} (${diagnostic.source}): ${diagnostic.error}`),",
			"\t\t] : []),",
		].join("\n"),
		"legacy management list diagnostics",
	);
	patched = replaceRequired(
		patched,
		legacyGetAnchor,
		[
			"\t\tconst raw = params.agent.trim();",
			"\t\tconst sanitized = sanitizeName(raw);",
			"\t\tconst d = discoverAgentsAll(ctx.cwd);",
			"\t\tconst matches = mergeAgentsForScope(scope, d.user, d.project, d.builtin, d.package)",
			"\t\t\t.filter((agent) => agent.name === raw || agent.name === sanitized);",
			"\t\tconst diagnostics = diagnosticsForScope(d.agentDiagnostics, scope);",
			"\t\tconst diagnostic = findBlockingAgentDiagnostic(raw, matches, diagnostics)",
			"\t\t\t?? (sanitized !== raw ? findBlockingAgentDiagnostic(sanitized, matches, diagnostics) : undefined);",
			"\t\tif (diagnostic) {",
			"\t\t\tconst msg = `Agent '${params.agent}' has invalid configuration: ${diagnostic.error}`;",
			"\t\t\tif (!hasBoth) return result(msg, true);",
			"\t\t\tblocks.push(msg);",
			"\t\t} else if (!matches.length) {",
			"\t\t\tconst msg = `Agent '${params.agent}' not found. Available: ${availableNames(ctx.cwd, \"agent\").join(\", \") || \"none\"}.`;",
			"\t\t\tif (!hasBoth) return result(msg, true);",
			"\t\t\tblocks.push(msg);",
			"\t\t} else {",
		].join("\n"),
		"legacy management get diagnostics",
	);
	return patched;
}

function patchManagement(source) {
	if (source.includes("\"Invalid agent definitions:\"")) {
		return source;
	}
	if (!source.includes("export function handleList(params: ManagementParams")) {
		return source;
	}
	const currentListAnchor = [
		"\t\t...(restrictedAgents.length ? [",
		"\t\t\t\"\",",
		"\t\t\t`Restricted agents (not executable in this session${restrictedSources?.length ? `; capability ceiling: ${restrictedSources.join(\", \")}` : \"\"}):`,",
		"\t\t\t...restrictedAgents.map((a) => `- ${a.name} (${a.source}${a.aliases?.length ? `, aliases: ${a.aliases.join(\", \")}` : \"\"}): ${a.description}`),",
		"\t\t] : []),",
		"\t\t\"\",",
	].join("\n");
	if (!source.includes(currentListAnchor)) {
		return patchLegacyManagement(source);
	}
	let patched = replaceRequired(
		source,
		[
			"\ttype AgentConfig,",
			"\ttype AgentScope,",
		].join("\n"),
		[
			"\ttype AgentConfig,",
			"\ttype AgentDiscoveryDiagnostic,",
			"\ttype AgentScope,",
		].join("\n"),
		"management diagnostic type import",
	);
	patched = replaceRequired(
		patched,
		[
			"\tdiscoverAgentsAll,",
			"\tbuildRuntimeName,",
		].join("\n"),
		[
			"\tdiscoverAgentsAll,",
			"\tfindBlockingAgentDiagnostic,",
			"\tbuildRuntimeName,",
		].join("\n"),
		"management diagnostic import",
	);
	patched = replaceRequired(
		patched,
		[
			"function findChains(name: string, cwd: string, scope: AgentScope = \"both\"): ChainConfig[] {",
		].join("\n"),
		[
			"function diagnosticsForScope(diagnostics: AgentDiscoveryDiagnostic[] | undefined, scope: AgentScope): AgentDiscoveryDiagnostic[] | undefined {",
			"\tif (scope === \"both\") return diagnostics;",
			"\tconst excludedSource = scope === \"user\" ? \"project\" : \"user\";",
			"\treturn diagnostics?.filter((diagnostic) => diagnostic.source !== excludedSource);",
			"}",
			"",
			"function findChains(name: string, cwd: string, scope: AgentScope = \"both\"): ChainConfig[] {",
		].join("\n"),
		"management diagnostic scope",
	);
	patched = replaceRequired(
		patched,
		[
			"\t\t...(restrictedAgents.length ? [",
			"\t\t\t\"\",",
			"\t\t\t`Restricted agents (not executable in this session${restrictedSources?.length ? `; capability ceiling: ${restrictedSources.join(\", \")}` : \"\"}):`,",
			"\t\t\t...restrictedAgents.map((a) => `- ${a.name} (${a.source}${a.aliases?.length ? `, aliases: ${a.aliases.join(\", \")}` : \"\"}): ${a.description}`),",
			"\t\t] : []),",
			"\t\t\"\",",
		].join("\n"),
		[
			"\t\t...(restrictedAgents.length ? [",
			"\t\t\t\"\",",
			"\t\t\t`Restricted agents (not executable in this session${restrictedSources?.length ? `; capability ceiling: ${restrictedSources.join(\", \")}` : \"\"}):`,",
			"\t\t\t...restrictedAgents.map((a) => `- ${a.name} (${a.source}${a.aliases?.length ? `, aliases: ${a.aliases.join(\", \")}` : \"\"}): ${a.description}`),",
			"\t\t] : []),",
			"\t\t...(diagnosticsForScope(d.agentDiagnostics, scope)?.length ? [",
			"\t\t\t\"\",",
			"\t\t\t\"Invalid agent definitions:\",",
			"\t\t\t...diagnosticsForScope(d.agentDiagnostics, scope)!.map((diagnostic) => `- ${diagnostic.name ?? diagnostic.filePath} (${diagnostic.source}): ${diagnostic.error}`),",
			"\t\t] : []),",
			"\t\t\"\",",
		].join("\n"),
		"management list diagnostics",
	);
	patched = replaceRequired(
		patched,
		[
			"\tif (params.agent) {",
			"\t\tconst matches = findAgents(params.agent, ctx.cwd, scope);",
			"\t\tconst distinctNames = [...new Set(matches.map((agent) => agent.name))];",
		].join("\n"),
		[
			"\tif (params.agent) {",
			"\t\tconst discovered = discoverAgentsAll(ctx.cwd);",
			"\t\tconst matches = findAgents(params.agent, ctx.cwd, scope);",
			"\t\tconst rawName = params.agent.trim();",
			"\t\tconst normalizedName = sanitizeName(rawName);",
			"\t\tconst diagnostics = diagnosticsForScope(discovered.agentDiagnostics, scope);",
			"\t\tconst diagnostic = findBlockingAgentDiagnostic(rawName, matches, diagnostics)",
			"\t\t\t?? (normalizedName !== rawName ? findBlockingAgentDiagnostic(normalizedName, matches, diagnostics) : undefined);",
			"\t\tif (diagnostic) {",
			"\t\t\tconst msg = `Agent '${params.agent}' has invalid configuration: ${diagnostic.error}`;",
			"\t\t\tif (!hasBoth) return result(msg, true);",
			"\t\t\tblocks.push(msg);",
			"\t\t}",
			"\t\tconst distinctNames = diagnostic ? [] : [...new Set(matches.map((agent) => agent.name))];",
		].join("\n"),
		"management get diagnostics",
	);
	patched = replaceRequired(
		patched,
		"\t\t} else if (!matches.length) {",
		"\t\t} else if (!diagnostic && !matches.length) {",
		"management missing-agent guard",
	);
	patched = replaceRequired(
		patched,
		"\t\t} else {\n\t\t\tanyFound = true;",
		"\t\t} else if (!diagnostic) {\n\t\t\tanyFound = true;",
		"management valid-agent guard",
	);
	return patched;
}

function patchDoctor(source) {
	if (source.includes("- invalid agent ${diagnostic.name ?? diagnostic.filePath}")) {
		return source;
	}
	if (!source.includes("function formatDiscovery(input: DoctorReportInput")) {
		return source;
	}
	return replaceRequired(
		source,
		[
			"\t\t\treturn [",
			"\t\t\t\t`- agents: total ${agentCounts.builtin + agentCounts.package + agentCounts.user + agentCounts.project} (${formatSourceCounts(agentCounts)})`,",
			"\t\t\t\t`- chains: total ${discovered.chains.length} (${formatSourceCounts(chainCounts)})`,",
		].join("\n"),
		[
			"\t\t\treturn [",
			"\t\t\t\t`- agents: total ${agentCounts.builtin + agentCounts.package + agentCounts.user + agentCounts.project} (${formatSourceCounts(agentCounts)})`,",
			"\t\t\t\t...(discovered.agentDiagnostics ?? []).map((diagnostic) => `- invalid agent ${diagnostic.name ?? diagnostic.filePath} (${diagnostic.source}): ${diagnostic.error}`),",
			"\t\t\t\t`- chains: total ${discovered.chains.length} (${formatSourceCounts(chainCounts)})`,",
		].join("\n"),
		"doctor agent diagnostics",
	);
}

function patchSlashCommands(source) {
	if (source.includes("const diagnostic = findBlockingAgentDiagnostic(agentName")) {
		return source;
	}
	if (!source.includes("const agents = discoverAgents(state.baseCwd, \"both\").agents;")) {
		return source;
	}
	let patched = replaceRequired(
		source,
		"import { BUILTIN_AGENT_NAMES, discoverAgents, discoverAgentsAll, type ChainConfig } from \"../agents/agents.ts\";",
		"import { BUILTIN_AGENT_NAMES, discoverAgents, discoverAgentsAll, findBlockingAgentDiagnostic, resolveAgentName, type ChainConfig } from \"../agents/agents.ts\";",
		"slash command agent import",
	);
	patched = replaceRequired(
		patched,
		[
			"\t\t\tconst agents = discoverAgents(state.baseCwd, \"both\").agents;",
			"\t\t\tif (!agents.find((a) => a.name === agentName)) { ctx.ui.notify(`Unknown agent: ${agentName}`, \"error\"); return; }",
		].join("\n"),
		[
			"\t\t\tconst discovered = discoverAgents(state.baseCwd, \"both\");",
			"\t\t\tconst resolvedAgent = resolveAgentName(agentName, discovered.agents);",
			"\t\t\tconst candidates = resolvedAgent.error",
			"\t\t\t\t? discovered.agents.filter((agent) => resolveAgentName(agentName, [agent]).agent)",
			"\t\t\t\t: resolvedAgent.agent;",
			"\t\t\tconst diagnostic = findBlockingAgentDiagnostic(agentName, candidates, discovered.agentDiagnostics);",
			"\t\t\tif (diagnostic || resolvedAgent.error || !resolvedAgent.agent) {",
			"\t\t\t\tctx.ui.notify(diagnostic ? `Agent '${agentName}' has invalid configuration: ${diagnostic.error}` : resolvedAgent.error ?? `Unknown agent: ${agentName}`, \"error\");",
			"\t\t\t\treturn;",
			"\t\t\t}",
		].join("\n"),
		"slash command invalid-agent guard",
	);
	return patched;
}

export function patchPiSubagentAgentDiagnostics(relativePath, source) {
	if (source.includes(PATCH_MARKER)) {
		return source;
	}

	switch (relativePath.split("/").pop()) {
		case "agents.ts":
			return patchPiSubagentAgentDiscovery(source);
		case "preflight.ts":
			return patchPreflight(source);
		case "subagent-executor.ts":
			return patchExecutor(source);
		case "agent-management.ts":
			return patchManagement(source);
		case "doctor.ts":
			return patchDoctor(source);
		case "slash-commands.ts":
			return patchSlashCommands(source);
		default:
			return source;
	}
}

const PI_SUBAGENTS_AGENT_DIAGNOSTICS_REQUIREMENTS = Object.freeze([
	["src/agents/agents.ts", [
		PI_SUBAGENTS_AGENT_DIAGNOSTICS_PATCH_MARKER,
		"export function findBlockingAgentDiagnostic(",
		"agentDiagnostics",
	]],
	["src/api/preflight.ts", [
		"findBlockingAgentDiagnostic(input.agent",
		"has invalid configuration:",
	]],
	["src/runs/foreground/subagent-executor.ts", [
		"canonicalizeExecutionParams(effectiveParams, discoveredAgents, discovered.agentDiagnostics)",
		"has invalid configuration:",
	]],
	["src/agents/agent-management.ts", [
		"Invalid agent definitions:",
		"findBlockingAgentDiagnostic(rawName",
	]],
	["src/extension/doctor.ts", [
		"- invalid agent ${diagnostic.name ?? diagnostic.filePath}",
		"discovered.agentDiagnostics",
	]],
	["src/slash/slash-commands.ts", [
		"findBlockingAgentDiagnostic(agentName",
		"has invalid configuration:",
	]],
]);

export function assertPiSubagentAgentDiagnosticsSources(readSource, label = "pi-subagents") {
	for (const [relativePath, markers] of PI_SUBAGENTS_AGENT_DIAGNOSTICS_REQUIREMENTS) {
		const source = readSource(relativePath);
		if (typeof source !== "string") {
			throw new Error(`${label} is missing ${relativePath}`);
		}
		for (const marker of markers) {
			if (!source.includes(marker)) {
				throw new Error(`${label} ${relativePath} is missing required marker: ${marker}`);
			}
		}
	}
	const agentsSource = readSource("src/agents/agents.ts");
	const packagePrecedenceMarker = "if (!packageMap.has(agent.name)) packageMap.set(agent.name, agent);";
	const packagePrecedenceCount = agentsSource.split(packagePrecedenceMarker).length - 1;
	if (packagePrecedenceCount < 2) {
		throw new Error(`${label} src/agents/agents.ts does not preserve first-package precedence in both discovery paths`);
	}
}
