export const PI_SUBAGENTS_PROMPT_METADATA_UPSTREAM_FIX =
	"https://github.com/nicobailon/pi-subagents/commit/27784eed57dd62021a7add4990ac2dada6690baa";
export const PI_SUBAGENTS_MODEL_SELECTOR_GUIDANCE_UPSTREAM_FIX =
	"https://github.com/nicobailon/pi-subagents/commit/62e0934c93c26c532a4aa76af4e72100f8aed965";
// Remove only after a compatible pi-subagents release exposes launchable,
// model-scope-aware selectors that preserve Feynman's premium-model policy.
export const PI_SUBAGENTS_PROMPT_METADATA_PATCH_MARKER =
	"feynman-pi-subagents-prompt-metadata-v2";

const PATCH_MARKER = PI_SUBAGENTS_PROMPT_METADATA_PATCH_MARKER;
const PRIOR_PATCH_MARKER = "feynman-pi-subagents-prompt-metadata-v1";
const MODEL_SELECTOR_GUIDANCE_TEXT =
	"When a child needs an explicit model, run `feynman model list` first and copy an exact approved provider/model. Never pass a bare model id or an agent name as the model.";
const MODEL_SELECTOR_GUIDANCE =
	`\t${JSON.stringify(MODEL_SELECTOR_GUIDANCE_TEXT)},`;
const MODEL_SELECTOR_DESCRIPTION_GUIDANCE =
	MODEL_SELECTOR_GUIDANCE_TEXT.replaceAll("`", "\\`");

function countOccurrences(source, marker) {
	return source.split(marker).length - 1;
}

function requireCount(source, marker, expected, label) {
	const actual = countOccurrences(source, marker);
	if (actual !== expected) {
		throw new Error(
			`Cannot apply ${PATCH_MARKER}: expected ${expected} ${label}, found ${actual}.`,
		);
	}
}

function assertPatchedToolDescription(source) {
	requireCount(source, PATCH_MARKER, 1, "v2 patch marker");
	requireCount(source, PRIOR_PATCH_MARKER, 0, "stale v1 patch markers");
	requireCount(source, MODEL_SELECTOR_GUIDANCE_TEXT, 1, "prompt model selector guidance copy");
	for (const exportName of [
		"FULL_SUBAGENT_TOOL_DESCRIPTION",
		"COMPACT_SUBAGENT_TOOL_DESCRIPTION",
	]) {
		const { description } = findDescription(source, exportName);
		requireCount(
			description,
			MODEL_SELECTOR_DESCRIPTION_GUIDANCE,
			1,
			`${exportName} model selector guidance copy`,
		);
	}
}

function replaceRequired(source, original, replacement, label) {
	if (!source.includes(original)) {
		throw new Error(`Cannot apply ${PATCH_MARKER}: missing ${label}.`);
	}
	return source.replace(original, replacement);
}

function findDescription(source, exportName) {
	const startMarker = `export const ${exportName} = \``;
	requireCount(source, startMarker, 1, `${exportName} declarations`);
	const start = source.indexOf(startMarker) + startMarker.length;
	const end = source.indexOf("`;", start);
	if (end < 0) {
		throw new Error(`Cannot apply ${PATCH_MARKER}: missing ${exportName} terminator.`);
	}
	return { description: source.slice(start, end), end };
}

function appendDescriptionGuidance(source, exportName) {
	const { description, end } = findDescription(source, exportName);
	if (description.includes(MODEL_SELECTOR_GUIDANCE_TEXT)) {
		throw new Error(`Cannot apply ${PATCH_MARKER}: ${exportName} already contains model selector guidance.`);
	}
	return `${source.slice(0, end)}\n\n• ${MODEL_SELECTOR_DESCRIPTION_GUIDANCE}${source.slice(end)}`;
}

function addModelSelectorGuidance(source) {
	let patched = replaceRequired(
		source,
		[
			'\t"Keep one subagent writer per cwd or worktree. Use fresh read-only reviewers, then let the parent synthesize and apply fixes.",',
			'\t"Ordinary subagent children do not delegate. Use the pi-subagents skill for advanced execution, control, and safety details.",',
		].join("\n"),
		[
			'\t"Keep one subagent writer per cwd or worktree. Use fresh read-only reviewers, then let the parent synthesize and apply fixes.",',
			MODEL_SELECTOR_GUIDANCE,
			'\t"Ordinary subagent children do not delegate. Use the pi-subagents skill for advanced execution, control, and safety details.",',
		].join("\n"),
		"model selector prompt guidance",
	);
	patched = appendDescriptionGuidance(patched, "FULL_SUBAGENT_TOOL_DESCRIPTION");
	patched = appendDescriptionGuidance(patched, "COMPACT_SUBAGENT_TOOL_DESCRIPTION");
	return patched;
}

function patchToolDescription(source) {
	if (source.includes(PATCH_MARKER)) {
		assertPatchedToolDescription(source);
		return source;
	}
	if (source.includes(PRIOR_PATCH_MARKER)) {
		requireCount(source, PRIOR_PATCH_MARKER, 1, "v1 patch marker");
		const patched = addModelSelectorGuidance(
			source.replace(PRIOR_PATCH_MARKER, PATCH_MARKER),
		);
		assertPatchedToolDescription(patched);
		return patched;
	}

	let patched = replaceRequired(
		source,
		[
			'const CUSTOM_TOOL_DESCRIPTION_FILE = "subagent-tool-description.md";',
			"const CUSTOM_TOOL_DESCRIPTION_MAX_BYTES = 50 * 1024;",
		].join("\n"),
		[
			'const CUSTOM_TOOL_DESCRIPTION_FILE = "subagent-tool-description.md";',
			"const CUSTOM_TOOL_DESCRIPTION_MAX_BYTES = 50 * 1024;",
			`const FEYNMAN_PROMPT_METADATA_PATCH = "${PATCH_MARKER}";`,
			"",
			"export const DEFAULT_SUBAGENT_TOOL_DESCRIPTION = `Delegate to configured research subagents. Omit action and use { agent, task? } for one child, { tasks } for parallel work, or { chain } for a sequence. Use action only for management and control. Call { action: \"list\" } before execution. Use the pi-subagents skill for advanced workflows.`;",
			"",
			"export const SUBAGENT_TOOL_PROMPT_SNIPPET = \"Delegate research work to configured subagents.\";",
			"",
			"export const SUBAGENT_TOOL_PROMPT_GUIDELINES = [",
			'\t"Use subagent only when delegation helps the current task. Call { action: \\"list\\" } first and run only executable, non-disabled agents or chains.",',
			'\t"Omit action for subagent execution. Use { agent, task? } for one child, { tasks } for parallel work, or { chain } for sequential work.",',
			'\t"For subagent async work, continue useful work or return control. Use subagent_wait only when the current turn must receive the result.",',
			'\t"Keep one subagent writer per cwd or worktree. Use fresh read-only reviewers, then let the parent synthesize and apply fixes.",',
			'\t"Ordinary subagent children do not delegate. Use the pi-subagents skill for advanced execution, control, and safety details.",',
			"];",
		].join("\n"),
		"tool-description constants",
	);

	patched = replaceRequired(
		patched,
		[
			"export interface ToolDescriptionOptions {",
			"\tcwd?: string;",
			"\tagentDir?: string;",
			"\twarn?: (message: string) => void;",
			"}",
			"",
			"export function resolveToolDescriptionMode(",
		].join("\n"),
		[
			"export interface ToolDescriptionOptions {",
			"\tcwd?: string;",
			"\tagentDir?: string;",
			"\twarn?: (message: string) => void;",
			"}",
			"",
			"export interface SubagentToolPromptMetadata {",
			"\tpromptSnippet?: string;",
			"\tpromptGuidelines?: string[];",
			"}",
			"",
			'export function buildSubagentToolPromptMetadata(config: Pick<ExtensionConfig, "toolDescriptionMode"> = {}): SubagentToolPromptMetadata {',
			"\tif (config.toolDescriptionMode !== undefined) return {};",
			"\treturn {",
			"\t\tpromptSnippet: SUBAGENT_TOOL_PROMPT_SNIPPET,",
			"\t\tpromptGuidelines: SUBAGENT_TOOL_PROMPT_GUIDELINES,",
			"\t};",
			"}",
			"",
			"export function resolveToolDescriptionMode(",
		].join("\n"),
		"prompt metadata builder",
	);

	patched = replaceRequired(
		patched,
		[
			'export function buildSubagentToolDescription(config: Pick<ExtensionConfig, "toolDescriptionMode"> = {}, options?: ToolDescriptionOptions): string {',
			"\tconst mode = resolveToolDescriptionMode(config, options);",
		].join("\n"),
		[
			'export function buildSubagentToolDescription(config: Pick<ExtensionConfig, "toolDescriptionMode"> = {}, options?: ToolDescriptionOptions): string {',
			"\tif (config.toolDescriptionMode === undefined) return DEFAULT_SUBAGENT_TOOL_DESCRIPTION;",
			"\tconst mode = resolveToolDescriptionMode(config, options);",
		].join("\n"),
		"default split-metadata description",
	);

	patched = addModelSelectorGuidance(patched);
	assertPatchedToolDescription(patched);
	return patched;
}

function patchExtensionIndex(source) {
	if (source.includes("...buildSubagentToolPromptMetadata(config),")) {
		return source;
	}
	if (!source.includes('import { buildSubagentToolDescription } from "./tool-description.ts";')) {
		return source;
	}
	let patched = replaceRequired(
		source,
		'import { buildSubagentToolDescription } from "./tool-description.ts";',
		'import { buildSubagentToolDescription, buildSubagentToolPromptMetadata } from "./tool-description.ts";',
		"extension prompt metadata import",
	);
	patched = replaceRequired(
		patched,
		[
			'\t\tdescription: buildSubagentToolDescription(config),',
			"\t\tparameters: SubagentParams,",
		].join("\n"),
		[
			'\t\tdescription: buildSubagentToolDescription(config),',
			"\t\t...buildSubagentToolPromptMetadata(config),",
			"\t\tparameters: SubagentParams,",
		].join("\n"),
		"extension prompt metadata registration",
	);
	return patched;
}

export function patchPiSubagentPromptMetadata(relativePath, source) {
	switch (relativePath) {
		case "src/extension/tool-description.ts":
			return patchToolDescription(source);
		case "src/extension/index.ts":
			return patchExtensionIndex(source);
		default:
			return source;
	}
}

const PI_SUBAGENTS_PROMPT_METADATA_REQUIREMENTS = Object.freeze([
	["src/extension/tool-description.ts", [
		PI_SUBAGENTS_PROMPT_METADATA_PATCH_MARKER,
		"export const DEFAULT_SUBAGENT_TOOL_DESCRIPTION",
		"export const SUBAGENT_TOOL_PROMPT_SNIPPET",
		"export const SUBAGENT_TOOL_PROMPT_GUIDELINES",
		"export function buildSubagentToolPromptMetadata(",
		"if (config.toolDescriptionMode === undefined) return DEFAULT_SUBAGENT_TOOL_DESCRIPTION;",
	]],
	["src/extension/index.ts", [
		"buildSubagentToolPromptMetadata",
		"...buildSubagentToolPromptMetadata(config),",
	]],
]);

export function assertPiSubagentPromptMetadataSources(readSource, label = "pi-subagents") {
	for (const [relativePath, markers] of PI_SUBAGENTS_PROMPT_METADATA_REQUIREMENTS) {
		const source = readSource(relativePath);
		if (typeof source !== "string") {
			throw new Error(`${label} is missing ${relativePath}`);
		}
		if (relativePath === "src/extension/tool-description.ts") {
			assertPatchedToolDescription(source);
		}
		for (const marker of markers) {
			if (!source.includes(marker)) {
				throw new Error(`${label} ${relativePath} is missing required marker: ${marker}`);
			}
		}
	}
}
