import { isAbsolute, normalize } from "node:path";

import { researchJobValues, type ResearchJob } from "./contracts.js";

export const feynmanPluginSlotValues = [
	"source_adapters",
	"access_resolvers",
	"entity_extractors",
	"rank_scorers",
	"experiment_runners",
	"artifact_exporters",
	"visualizers",
	"subagents",
	"mcp_servers",
] as const;

export type FeynmanPluginSlot = (typeof feynmanPluginSlotValues)[number];

export type FeynmanPluginManifest = {
	manifest_version: 1;
	name: string;
	version?: string;
	description?: string;
	research_jobs: ResearchJob[];
	slots?: Partial<Record<FeynmanPluginSlot, string[]>>;
	pi?: {
		extensions?: string[];
		skills?: string[];
		prompts?: string[];
		themes?: string[];
	};
	requires_env?: Array<string | { name: string; secret?: boolean; description?: string }>;
};

export type PluginManifestValidationResult = {
	valid: boolean;
	errors: string[];
	warnings: string[];
};

const knownTopLevelKeys = new Set(["manifest_version", "name", "version", "description", "research_jobs", "slots", "pi", "requires_env"]);
const piResourceKeys = new Set(["extensions", "skills", "prompts", "themes"]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafePackageName(name: string): boolean {
	return /^[a-z0-9][a-z0-9._-]*$/i.test(name) && !name.includes("..") && !name.includes("/") && !name.includes("\\");
}

function isSafeRelativePath(path: string): boolean {
	if (!path.trim()) return false;
	if (isAbsolute(path)) return false;
	const normalized = normalize(path).replaceAll("\\", "/");
	return normalized !== ".." && !normalized.startsWith("../") && !normalized.includes("/../");
}

function validatePathList(input: { owner: string; value: unknown; errors: string[] }): boolean {
	if (!Array.isArray(input.value)) {
		input.errors.push(`${input.owner} must be an array of relative paths`);
		return false;
	}
	for (const [index, path] of input.value.entries()) {
		if (typeof path !== "string") {
			input.errors.push(`${input.owner}[${index}] must be a string path`);
			continue;
		}
		if (!isSafeRelativePath(path)) {
			input.errors.push(`${input.owner}[${index}] must stay inside the plugin root`);
		}
	}
	return true;
}

export function validateFeynmanPluginManifest(value: unknown): PluginManifestValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];
	if (!isRecord(value)) {
		return { valid: false, errors: ["manifest must be an object"], warnings };
	}

	for (const key of Object.keys(value)) {
		if (!knownTopLevelKeys.has(key)) warnings.push(`unknown top-level key ignored by v1: ${key}`);
	}

	if (value.manifest_version !== 1) errors.push("manifest_version must be 1");
	if (typeof value.name !== "string" || !isSafePackageName(value.name)) errors.push("name must be a package-safe identifier without path separators");

	const researchJobs = value.research_jobs;
	if (!Array.isArray(researchJobs) || researchJobs.length === 0) {
		errors.push("research_jobs must be a non-empty array");
	} else {
		for (const [index, job] of researchJobs.entries()) {
			if (typeof job !== "string" || !researchJobValues.includes(job as ResearchJob)) {
				errors.push(`research_jobs[${index}] is not a supported Feynman research job`);
			}
		}
	}

	let declaredResource = false;
	if (value.slots !== undefined) {
		if (!isRecord(value.slots)) {
			errors.push("slots must be an object");
		} else {
			for (const [slot, paths] of Object.entries(value.slots)) {
				if (!feynmanPluginSlotValues.includes(slot as FeynmanPluginSlot)) {
					errors.push(`unknown plugin slot: ${slot}`);
					continue;
				}
				if (validatePathList({ owner: `slots.${slot}`, value: paths, errors }) && Array.isArray(paths) && paths.length > 0) {
					declaredResource = true;
				}
			}
		}
	}

	if (value.pi !== undefined) {
		if (!isRecord(value.pi)) {
			errors.push("pi must be an object");
		} else {
			for (const [key, paths] of Object.entries(value.pi)) {
				if (!piResourceKeys.has(key)) {
					errors.push(`unknown pi resource: ${key}`);
					continue;
				}
				if (validatePathList({ owner: `pi.${key}`, value: paths, errors }) && Array.isArray(paths) && paths.length > 0) {
					declaredResource = true;
				}
			}
		}
	}

	if (!declaredResource) errors.push("at least one slots or pi resource must be declared");

	if (value.requires_env !== undefined) {
		if (!Array.isArray(value.requires_env)) {
			errors.push("requires_env must be an array");
		} else {
			for (const [index, entry] of value.requires_env.entries()) {
				if (typeof entry === "string") {
					if (!/^[A-Z][A-Z0-9_]*$/.test(entry)) errors.push(`requires_env[${index}] must be an environment variable name`);
				} else if (isRecord(entry)) {
					if (typeof entry.name !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(entry.name)) errors.push(`requires_env[${index}].name must be an environment variable name`);
				} else {
					errors.push(`requires_env[${index}] must be a string or object`);
				}
			}
		}
	}

	return {
		valid: errors.length === 0,
		errors,
		warnings,
	};
}
