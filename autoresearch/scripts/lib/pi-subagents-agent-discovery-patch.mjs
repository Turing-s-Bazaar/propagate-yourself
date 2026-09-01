export const PI_SUBAGENTS_AGENT_DIAGNOSTICS_UPSTREAM_FIX =
	"nicobailon/pi-subagents@e973fa3c717bb32546a55ca7f061fd10ed6f7427";
export const PI_SUBAGENTS_AGENT_DIAGNOSTICS_PATCH_MARKER =
	`Feynman backport: ${PI_SUBAGENTS_AGENT_DIAGNOSTICS_UPSTREAM_FIX}`;
const PATCH_MARKER = PI_SUBAGENTS_AGENT_DIAGNOSTICS_PATCH_MARKER;

function replaceRequired(source, original, replacement, label) {
	if (!source.includes(original)) {
		throw new Error(`Cannot apply ${PATCH_MARKER}: missing ${label}.`);
	}
	return source.replace(original, replacement);
}

function patchAgentDiscovery(source) {
	if (!source.includes("function loadAgentsFromDir(dir: string, source: AgentSource): AgentConfig[]")) {
		return source;
	}

	let patched = replaceRequired(
		source,
		[
			"\tsource: AgentSource;",
			"\tfilePath: string;",
			"\tskills?: string[];",
		].join("\n"),
		[
			"\tsource: AgentSource;",
			"\tfilePath: string;",
			"\tdiscoveryPriority?: number;",
			"\tskills?: string[];",
		].join("\n"),
		"AgentConfig file path",
	);

	patched = replaceRequired(
		patched,
		[
			"export interface ChainDiscoveryDiagnostic {",
			"\tsource: AgentSource;",
			"\tfilePath: string;",
			"\terror: string;",
			"}",
			"",
			"interface AgentDiscoveryResult {",
			"\tagents: AgentConfig[];",
			"\tprojectAgentsDir: string | null;",
			"\tmodelScope?: ModelScopeConfig;",
			"}",
		].join("\n"),
		[
			"export interface ChainDiscoveryDiagnostic {",
			"\tsource: AgentSource;",
			"\tfilePath: string;",
			"\terror: string;",
			"}",
			"",
			`// ${PATCH_MARKER}. Remove after the bundled release includes this fix.`,
			"export interface AgentDiscoveryDiagnostic extends ChainDiscoveryDiagnostic {",
			"\tname?: string;",
			"\truntimeName?: string;",
			"\tpackageSpecified?: boolean;",
			"\tdiscoveryPriority?: number;",
			"}",
			"",
			"const AGENT_SOURCE_PRIORITY: Record<AgentSource, number> = {",
			"\tbuiltin: 0,",
			"\tpackage: 1,",
			"\tuser: 2,",
			"\tproject: 3,",
			"};",
			"",
			"function agentDefinitionPriority(definition: Pick<AgentConfig | AgentDiscoveryDiagnostic, \"source\" | \"discoveryPriority\">): number {",
			"\treturn AGENT_SOURCE_PRIORITY[definition.source] * 1_000_000",
			"\t\t+ (definition.discoveryPriority ?? 0);",
			"}",
			"",
			"export function findBlockingAgentDiagnostic(name: string, agent: AgentConfig | readonly AgentConfig[] | undefined, diagnostics: AgentDiscoveryDiagnostic[] | undefined): AgentDiscoveryDiagnostic | undefined {",
			"\tconst normalizedName = name.trim();",
			"\tconst agents = Array.isArray(agent) ? agent : agent ? [agent] : [];",
			"\tlet match: AgentDiscoveryDiagnostic | undefined;",
			"\tfor (const diagnostic of diagnostics ?? []) {",
			"\t\tif ((diagnostic.runtimeName === normalizedName",
			"\t\t\t|| (diagnostic.name === normalizedName && (!diagnostic.packageSpecified",
			"\t\t\t\t|| diagnostic.runtimeName === undefined",
			"\t\t\t\t|| agents.some((candidate) => candidate.name === diagnostic.runtimeName && candidate.localName === diagnostic.name))))",
			"\t\t\t&& (!match || agentDefinitionPriority(diagnostic) > agentDefinitionPriority(match))) {",
			"\t\t\tmatch = diagnostic;",
			"\t\t}",
			"\t}",
			"\tconst highestPriority = Math.max(...agents.map(agentDefinitionPriority), -Infinity);",
			"\treturn !agents.length || (match && agentDefinitionPriority(match) > highestPriority) ? match : undefined;",
			"}",
			"",
			"interface AgentDiscoveryResult {",
			"\tagents: AgentConfig[];",
			"\tagentDiagnostics?: AgentDiscoveryDiagnostic[];",
			"\tprojectAgentsDir: string | null;",
			"\tmodelScope?: ModelScopeConfig;",
			"}",
		].join("\n"),
		"agent discovery interfaces",
	);

	patched = replaceRequired(
		patched,
		[
			"function loadAgentsFromDir(dir: string, source: AgentSource): AgentConfig[] {",
			"\tconst agents: AgentConfig[] = [];",
		].join("\n"),
		[
			"function loadAgentsFromDir(dir: string, source: AgentSource, discoveryPriority?: number): { agents: AgentConfig[]; diagnostics: AgentDiscoveryDiagnostic[] } {",
			"\tconst agents: AgentConfig[] = [];",
			"\tconst diagnostics: AgentDiscoveryDiagnostic[] = [];",
		].join("\n"),
		"agent loader signature",
	);
	patched = replaceRequired(
		patched,
		[
			"\t\tconst { frontmatter, body } = parseFrontmatter(content);",
			"",
			"\t\tif (!frontmatter.name || !frontmatter.description) {",
			"\t\t\tcontinue;",
			"\t\t}",
			"",
			"\t\tconst localName = frontmatter.name;",
			"\t\tconst parsedPackage = parsePackageName(frontmatter.package, `Agent '${localName}' package`);",
			"\t\tif (parsedPackage.error) continue;",
			"\t\tconst packageName = parsedPackage.packageName;",
			"\t\tconst runtimeName = buildRuntimeName(localName, packageName);",
		].join("\n"),
		[
			"\t\tlet name: string | undefined;",
			"\t\tlet runtimeName: string | undefined;",
			"\t\tlet packageSpecified = false;",
			"\t\ttry {",
			"\t\t\tconst { frontmatter, body } = parseFrontmatter(content);",
			"",
			"\t\t\tif (!frontmatter.name || !frontmatter.description) {",
			"\t\t\t\tcontinue;",
			"\t\t\t}",
			"",
			"\t\t\tconst localName = frontmatter.name;",
			"\t\t\tname = localName;",
			"\t\t\tconst parsedPackage = parsePackageName(frontmatter.package, `Agent '${localName}' package`);",
			"\t\t\tpackageSpecified = parsedPackage.packageName !== undefined || parsedPackage.error !== undefined;",
			"\t\t\tif (parsedPackage.error) throw new Error(parsedPackage.error);",
			"\t\t\tconst packageName = parsedPackage.packageName;",
			"\t\t\truntimeName = buildRuntimeName(localName, packageName);",
		].join("\n"),
		"agent frontmatter parsing",
	);
	patched = replaceRequired(
		patched,
		[
			"\t\t\tsource,",
			"\t\t\tfilePath,",
			"\t\t\tskills: skills && skills.length > 0 ? skills : undefined,",
		].join("\n"),
		[
			"\t\t\tsource,",
			"\t\t\tfilePath,",
			"\t\t\t...(discoveryPriority !== undefined ? { discoveryPriority } : {}),",
			"\t\t\tskills: skills && skills.length > 0 ? skills : undefined,",
		].join("\n"),
		"agent discovery priority",
	);
	patched = replaceRequired(
		patched,
		[
			"\t\tagentFrontmatterFields.set(agent, new Set(Object.keys(frontmatter)));",
			"\t\tagents.push(agent);",
			"\t}",
			"",
			"\treturn agents;",
			"}",
		].join("\n"),
		[
			"\t\t\tagentFrontmatterFields.set(agent, new Set(Object.keys(frontmatter)));",
			"\t\t\tagents.push(agent);",
			"\t\t} catch (error) {",
			"\t\t\tdiagnostics.push({",
			"\t\t\t\tsource,",
			"\t\t\t\tfilePath,",
			"\t\t\t\t...(name ? { name } : {}),",
			"\t\t\t\t...(runtimeName && runtimeName !== name ? { runtimeName } : {}),",
			"\t\t\t\t...(packageSpecified ? { packageSpecified: true } : {}),",
			"\t\t\t\t...(discoveryPriority !== undefined ? { discoveryPriority } : {}),",
			"\t\t\t\terror: error instanceof Error ? error.message : String(error),",
			"\t\t\t});",
			"\t\t}",
			"\t}",
			"",
			"\treturn { agents, diagnostics };",
			"}",
		].join("\n"),
		"agent loader result",
	);

	patched = replaceRequired(
		patched,
		[
			"\tconst builtinAgents = applyBuiltinOverrides(",
			"\t\tapplySubagentDefaults(loadAgentsFromDir(BUILTIN_AGENTS_DIR, \"builtin\"), defaultModel, defaultThinking, defaultExtensions),",
		].join("\n"),
		[
			"\tconst builtinLoaded = loadAgentsFromDir(BUILTIN_AGENTS_DIR, \"builtin\");",
			"\tconst builtinAgents = applyBuiltinOverrides(",
			"\t\tapplySubagentDefaults(builtinLoaded.agents, defaultModel, defaultThinking, defaultExtensions),",
		].join("\n"),
		"runtime builtin discovery",
	);
	patched = replaceRequired(
		patched,
		[
			"\tconst userAgentsExtra = scope === \"project\" ? [] : extraUserAgentDirs().flatMap((dir) => loadAgentsFromDir(dir, \"user\"));",
			"\tconst userAgentsOld = scope === \"project\" ? [] : loadAgentsFromDir(userDirOld, \"user\");",
			"\tconst userAgentsNew = scope === \"project\" ? [] : loadAgentsFromDir(userDirNew, \"user\");",
			"\tconst userAgents = applyCustomAgentOverrides(",
			"\t\tapplySubagentDefaults([...userAgentsExtra, ...userAgentsOld, ...userAgentsNew], defaultModel, defaultThinking, defaultExtensions),",
		].join("\n"),
		[
			"\tconst userLoaded = scope === \"project\" ? [] : [...extraUserAgentDirs(), userDirOld, userDirNew]",
			"\t\t.map((dir, discoveryPriority) => loadAgentsFromDir(dir, \"user\", discoveryPriority));",
			"\tconst userAgents = applyCustomAgentOverrides(",
			"\t\tapplySubagentDefaults(userLoaded.flatMap((loaded) => loaded.agents), defaultModel, defaultThinking, defaultExtensions),",
		].join("\n"),
		"runtime user discovery",
	);
	patched = replaceRequired(
		patched,
		[
			"\tconst projectAgents = applyCustomAgentOverrides(",
			"\t\tapplySubagentDefaults(scope === \"user\" ? [] : projectAgentDirs.flatMap((dir) => loadAgentsFromDir(dir, \"project\")), defaultModel, defaultThinking, defaultExtensions),",
		].join("\n"),
		[
			"\tconst projectLoaded = scope === \"user\" ? [] : projectAgentDirs",
			"\t\t.map((dir, discoveryPriority) => loadAgentsFromDir(dir, \"project\", discoveryPriority));",
			"\tconst projectAgents = applyCustomAgentOverrides(",
			"\t\tapplySubagentDefaults(projectLoaded.flatMap((loaded) => loaded.agents), defaultModel, defaultThinking, defaultExtensions),",
		].join("\n"),
		"runtime project discovery",
	);
	patched = replaceRequired(
		patched,
		[
			"\tconst packageAgents = applyCustomAgentOverrides(",
			"\t\tapplySubagentDefaults(packageSubagentPaths.agents.flatMap((dir) => loadAgentsFromDir(dir, \"package\")), defaultModel, defaultThinking, defaultExtensions),",
		].join("\n"),
		[
			"\tconst packageLoaded = packageSubagentPaths.agents",
			"\t\t.map((dir, index) => loadAgentsFromDir(dir, \"package\", packageSubagentPaths.agents.length - index));",
			"\tconst packageMap = new Map<string, AgentConfig>();",
			"\tfor (const loaded of packageLoaded) {",
			"\t\tfor (const agent of loaded.agents) {",
			"\t\t\tif (!packageMap.has(agent.name)) packageMap.set(agent.name, agent);",
			"\t\t}",
			"\t}",
			"\tconst packageAgents = applyCustomAgentOverrides(",
			"\t\tapplySubagentDefaults(Array.from(packageMap.values()), defaultModel, defaultThinking, defaultExtensions),",
		].join("\n"),
		"runtime package discovery",
	);
	patched = replaceRequired(
		patched,
		"\treturn { agents, projectAgentsDir, modelScope };",
		[
			"\tconst agentDiagnostics = [",
			"\t\t...builtinLoaded.diagnostics,",
			"\t\t...userLoaded.flatMap((loaded) => loaded.diagnostics),",
			"\t\t...projectLoaded.flatMap((loaded) => loaded.diagnostics),",
			"\t\t...packageLoaded.flatMap((loaded) => loaded.diagnostics),",
			"\t];",
			"\treturn { agents, agentDiagnostics, projectAgentsDir, modelScope };",
		].join("\n"),
		"runtime discovery result",
	);

	patched = replaceRequired(
		patched,
		[
			"\tproject: AgentConfig[];",
			"\tchains: ChainConfig[];",
		].join("\n"),
		[
			"\tproject: AgentConfig[];",
			"\tagentDiagnostics?: AgentDiscoveryDiagnostic[];",
			"\tchains: ChainConfig[];",
		].join("\n"),
		"all-agent discovery result",
	);
	patched = replaceRequired(
		patched,
		[
			"\tconst builtin = applyBuiltinOverrides(",
			"\t\tapplySubagentDefaults(loadAgentsFromDir(BUILTIN_AGENTS_DIR, \"builtin\"), defaultModel, defaultThinking, defaultExtensions),",
		].join("\n"),
		[
			"\tconst builtinLoaded = loadAgentsFromDir(BUILTIN_AGENTS_DIR, \"builtin\");",
			"\tconst builtin = applyBuiltinOverrides(",
			"\t\tapplySubagentDefaults(builtinLoaded.agents, defaultModel, defaultThinking, defaultExtensions),",
		].join("\n"),
		"all-agent builtin discovery",
	);
	patched = replaceRequired(
		patched,
		[
			"\tconst user = applyCustomAgentOverrides(",
			"\t\tapplySubagentDefaults([",
			"\t\t\t...extraUserAgentDirs().flatMap((dir) => loadAgentsFromDir(dir, \"user\")),",
			"\t\t\t...loadAgentsFromDir(userDirOld, \"user\"),",
			"\t\t\t...loadAgentsFromDir(userDirNew, \"user\"),",
			"\t\t], defaultModel, defaultThinking, defaultExtensions),",
		].join("\n"),
		[
			"\tconst userLoaded = [...extraUserAgentDirs(), userDirOld, userDirNew]",
			"\t\t.map((dir, discoveryPriority) => loadAgentsFromDir(dir, \"user\", discoveryPriority));",
			"\tconst user = applyCustomAgentOverrides(",
			"\t\tapplySubagentDefaults(userLoaded.flatMap((loaded) => loaded.agents), defaultModel, defaultThinking, defaultExtensions),",
		].join("\n"),
		"all-agent user discovery",
	);
	patched = replaceRequired(
		patched,
		[
			"\tconst packageMap = new Map<string, AgentConfig>();",
			"\tfor (const dir of packageSubagentPaths.agents) {",
			"\t\tfor (const agent of loadAgentsFromDir(dir, \"package\")) {",
			"\t\t\tif (!packageMap.has(agent.name)) packageMap.set(agent.name, agent);",
			"\t\t}",
			"\t}",
		].join("\n"),
		[
			"\tconst packageMap = new Map<string, AgentConfig>();",
			"\tconst packageAgentDiagnostics: AgentDiscoveryDiagnostic[] = [];",
			"\tfor (const [index, dir] of packageSubagentPaths.agents.entries()) {",
			"\t\tconst loaded = loadAgentsFromDir(dir, \"package\", packageSubagentPaths.agents.length - index);",
			"\t\tpackageAgentDiagnostics.push(...loaded.diagnostics);",
			"\t\tfor (const agent of loaded.agents) {",
			"\t\t\tif (!packageMap.has(agent.name)) packageMap.set(agent.name, agent);",
			"\t\t}",
			"\t}",
		].join("\n"),
		"all-agent package discovery",
	);
	patched = replaceRequired(
		patched,
		[
			"\tconst projectMap = new Map<string, AgentConfig>();",
			"\tfor (const dir of projectDirs) {",
			"\t\tfor (const agent of loadAgentsFromDir(dir, \"project\")) {",
			"\t\t\tprojectMap.set(agent.name, agent);",
			"\t\t}",
			"\t}",
		].join("\n"),
		[
			"\tconst projectMap = new Map<string, AgentConfig>();",
			"\tconst projectAgentDiagnostics: AgentDiscoveryDiagnostic[] = [];",
			"\tfor (const [discoveryPriority, dir] of projectDirs.entries()) {",
			"\t\tconst loaded = loadAgentsFromDir(dir, \"project\", discoveryPriority);",
			"\t\tprojectAgentDiagnostics.push(...loaded.diagnostics);",
			"\t\tfor (const agent of loaded.agents) {",
			"\t\t\tprojectMap.set(agent.name, agent);",
			"\t\t}",
			"\t}",
		].join("\n"),
		"all-agent project discovery",
	);
	patched = replaceRequired(
		patched,
		[
			"\tconst userDir = process.env.PI_CODING_AGENT_DIR ? userDirOld : fs.existsSync(userDirNew) ? userDirNew : userDirOld;",
			"",
			"\treturn { builtin, package: packageAgents, user, project, chains, chainDiagnostics, userDir, projectDir, userChainDir, projectChainDir, userSettingsPath, projectSettingsPath };",
		].join("\n"),
		[
			"\tconst agentDiagnostics = [",
			"\t\t...builtinLoaded.diagnostics,",
			"\t\t...userLoaded.flatMap((loaded) => loaded.diagnostics),",
			"\t\t...packageAgentDiagnostics,",
			"\t\t...projectAgentDiagnostics,",
			"\t];",
			"\tconst userDir = process.env.PI_CODING_AGENT_DIR ? userDirOld : fs.existsSync(userDirNew) ? userDirNew : userDirOld;",
			"",
			"\treturn { builtin, package: packageAgents, user, project, agentDiagnostics, chains, chainDiagnostics, userDir, projectDir, userChainDir, projectChainDir, userSettingsPath, projectSettingsPath };",
		].join("\n"),
		"all-agent diagnostic result",
	);

	return patched;
}


export { patchAgentDiscovery as patchPiSubagentAgentDiscovery };
