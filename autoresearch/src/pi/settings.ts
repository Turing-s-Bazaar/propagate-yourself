import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { ModelRegistry, ModelRuntime, PackageSource } from "@earendil-works/pi-coding-agent";

import {
	CORE_PACKAGE_SOURCES,
	filterPackageSourcesForCurrentNode,
	reconcileManagedCorePackageSources,
	shouldPruneLegacyDefaultPackages,
} from "./package-presets.js";
import { choosePreferredModelRecord, getAvailableModelRecords, isProClassModelSpec } from "../model/catalog.js";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

type ModelLookup = Pick<ModelRegistry, "find"> | Pick<ModelRuntime, "getModel">;

export type FeynmanSettingsRuntime = {
	researchToolsExtensionPath?: string;
};

const RESEARCHER_EXTENSION_MARKER = "_feynmanResearchToolsExtension";

function findModel(modelLookup: ModelLookup, provider: string, id: string) {
	return "find" in modelLookup
		? modelLookup.find(provider, id)
		: modelLookup.getModel(provider, id);
}

export function parseModelSpec(spec: string, modelLookup: ModelLookup) {
	const trimmed = spec.trim();
	for (const separator of ["/", ":"] as const) {
		const separatorIndex = trimmed.indexOf(separator);
		if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1) {
			continue;
		}

		const provider = trimmed.slice(0, separatorIndex);
		const id = trimmed.slice(separatorIndex + 1);
		const model = findModel(modelLookup, provider, id);
		if (model) {
			return model;
		}
	}

	return undefined;
}

export function canonicalizeModelSpec(spec: string, modelLookup: ModelLookup): string | undefined {
	const model = parseModelSpec(spec, modelLookup);
	return model ? `${model.provider}/${model.id}` : undefined;
}

export function normalizeThinkingLevel(value: string | undefined): ThinkingLevel | undefined {
	if (!value) {
		return undefined;
	}

	const normalized = value.toLowerCase();
	if (
		normalized === "off" ||
		normalized === "minimal" ||
		normalized === "low" ||
		normalized === "medium" ||
		normalized === "high" ||
		normalized === "xhigh" ||
		normalized === "max"
	) {
		return normalized;
	}

	return undefined;
}

function filterConfiguredPackagesForCurrentNode(packages: PackageSource[] | undefined): PackageSource[] {
	if (!Array.isArray(packages)) {
		return [];
	}

	const filteredStringSources = new Set(filterPackageSourcesForCurrentNode(
		packages
			.map((entry) => (typeof entry === "string" ? entry : entry.source))
			.filter((entry): entry is string => typeof entry === "string"),
	));

	return packages.filter((entry) => {
		const source = typeof entry === "string" ? entry : entry.source;
		return filteredStringSources.has(source);
	});
}

export function readJson(path: string): Record<string, unknown> {
	if (!existsSync(path)) {
		return {};
	}

	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		if (process.env.FEYNMAN_DEBUG === "1") {
			process.stderr.write(
				`[feynman] warning: failed to parse ${path}, treating as empty (${error instanceof Error ? error.message : "unknown error"})\n`,
			);
		}
		return {};
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function ensureResearcherExtension(
	settings: Record<string, unknown>,
	researchToolsExtensionPath: string | undefined,
): void {
	if (!researchToolsExtensionPath) return;

	if (settings.subagents !== undefined && !isRecord(settings.subagents)) return;
	const subagents = settings.subagents ?? {};
	settings.subagents = subagents;

	if (subagents.agentOverrides !== undefined && !isRecord(subagents.agentOverrides)) return;
	const agentOverrides = subagents.agentOverrides ?? {};
	subagents.agentOverrides = agentOverrides;

	if (agentOverrides.researcher !== undefined && !isRecord(agentOverrides.researcher)) return;
	const researcher = agentOverrides.researcher ?? {};
	agentOverrides.researcher = researcher;

	const configuredExtensions = researcher.subagentOnlyExtensions;
	if (
		configuredExtensions !== undefined
		&& (!Array.isArray(configuredExtensions) || configuredExtensions.some((entry) => typeof entry !== "string"))
	) return;

	const previousManagedPath = researcher[RESEARCHER_EXTENSION_MARKER];
	const preservedExtensions = (configuredExtensions ?? []).filter(
		(entry) => entry !== previousManagedPath && entry !== researchToolsExtensionPath,
	);
	researcher.subagentOnlyExtensions = [...preservedExtensions, researchToolsExtensionPath];
	researcher[RESEARCHER_EXTENSION_MARKER] = researchToolsExtensionPath;
}

export async function normalizeFeynmanSettings(
	settingsPath: string,
	bundledSettingsPath: string,
	defaultThinkingLevel: ThinkingLevel,
	authPath: string,
	runtime: FeynmanSettingsRuntime = {},
): Promise<void> {
	let settings: Record<string, unknown> = {};

	if (existsSync(settingsPath)) {
		try {
			settings = JSON.parse(readFileSync(settingsPath, "utf8"));
		} catch {
			settings = {};
		}
	} else if (existsSync(bundledSettingsPath)) {
		try {
			settings = JSON.parse(readFileSync(bundledSettingsPath, "utf8"));
		} catch {
			settings = {};
		}
	}

	if (!settings.defaultThinkingLevel) {
		settings.defaultThinkingLevel = defaultThinkingLevel;
	}
	if (settings.editorPaddingX === undefined) {
		settings.editorPaddingX = 1;
	}
	settings.theme = "feynman";
	settings.quietStartup = true;
	settings.collapseChangelog = true;
	const supportedCorePackages = filterPackageSourcesForCurrentNode(CORE_PACKAGE_SOURCES);
	if (!Array.isArray(settings.packages) || settings.packages.length === 0) {
		settings.packages = supportedCorePackages;
	} else if (shouldPruneLegacyDefaultPackages(settings.packages as PackageSource[])) {
		settings.packages = supportedCorePackages;
	} else {
		settings.packages = filterConfiguredPackagesForCurrentNode(
			reconcileManagedCorePackageSources(settings.packages as PackageSource[]),
		);
	}
	ensureResearcherExtension(settings, runtime.researchToolsExtensionPath);

	const availableModels = (await getAvailableModelRecords(authPath)).map((model) => ({
		provider: model.provider,
		id: model.id,
	}));
	const availableModelSpecs = new Set(availableModels.map((model) => `${model.provider}/${model.id}`));

	const defaultModelSpec = typeof settings.defaultProvider === "string" && typeof settings.defaultModel === "string"
		? `${settings.defaultProvider}/${settings.defaultModel}`
		: undefined;
	const defaultIsProClass = isProClassModelSpec(defaultModelSpec);
	const defaultUnavailable = Boolean(defaultModelSpec && !availableModelSpecs.has(defaultModelSpec));
	if ((!settings.defaultProvider || !settings.defaultModel || defaultIsProClass || defaultUnavailable) && availableModels.length > 0) {
		const preferredModel = choosePreferredModelRecord(availableModels);
		if (preferredModel) {
			settings.defaultProvider = preferredModel.provider;
			settings.defaultModel = preferredModel.id;
		}
	} else if (defaultIsProClass) {
		delete settings.defaultProvider;
		delete settings.defaultModel;
	}

	mkdirSync(dirname(settingsPath), { recursive: true });
	writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
}
