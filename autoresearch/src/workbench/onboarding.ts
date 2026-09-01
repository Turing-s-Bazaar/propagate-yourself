import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { migratedWorkbenchDataPath } from "./data-root.js";
import type { WorkbenchOnboardingProfile } from "./types.js";

export type WorkbenchOnboardingPermission =
	| "compute"
	| "connectors"
	| "credentials"
	| "files"
	| "memory"
	| "science-databases"
	| "web";

export type WorkbenchOnboardingCompleteInput = {
	field?: string;
	goal?: string;
	workflow?: string;
	dataTools?: string[];
	bottlenecks?: string[];
	notes?: string;
	permissions?: string[];
	selectedTask: {
		title: string;
		description: string;
	};
	projectId: string;
	sessionId: string;
};

export type WorkbenchOnboardingSettingsRecord = {
	collection: "memoryCategories" | "permissionGrants";
	record: Record<string, unknown>;
};

const ONBOARDING_SCHEMA = "feynman.workbenchOnboarding.v1" as const;
const FEYNMAN_BIO_TOOLS_NAME = "Feynman Bio Tools";
const OPEN_SCIENCE_SEED_WORKFLOWS = [
	"example_crispr_screen",
	"example_enzyme_engineering",
	"example_extremophile",
	"example_immunotherapy",
] as const;

const VALID_PERMISSIONS = new Set<WorkbenchOnboardingPermission>([
	"compute",
	"connectors",
	"credentials",
	"files",
	"memory",
	"science-databases",
	"web",
]);

function nowIso(): string {
	return new Date().toISOString();
}

function onboardingPath(workingDir: string): string {
	return migratedWorkbenchDataPath(workingDir, "onboarding.json");
}

function normalizeText(value: unknown, maxLength: number): string | undefined {
	const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
	return text ? text.slice(0, maxLength) : undefined;
}

function normalizeLongText(value: unknown, maxLength: number): string | undefined {
	const text = typeof value === "string" ? value.trim() : "";
	return text ? text.slice(0, maxLength) : undefined;
}

function normalizeStringList(value: unknown, maxItems: number, maxLength: number): string[] {
	const rawItems = Array.isArray(value)
		? value.flatMap((item) => typeof item === "string" ? item.split(/[,\n]/) : [])
		: typeof value === "string"
			? value.split(/[,\n]/)
			: [];
	const seen = new Set<string>();
	const items: string[] = [];
	for (const rawItem of rawItems) {
		const item = rawItem.trim().replace(/\s+/g, " ").slice(0, maxLength);
		if (!item || seen.has(item)) continue;
		seen.add(item);
		items.push(item);
		if (items.length >= maxItems) break;
	}
	return items;
}

function normalizePermissions(value: unknown): WorkbenchOnboardingPermission[] {
	return normalizeStringList(value, 12, 80)
		.filter((item): item is WorkbenchOnboardingPermission => VALID_PERMISSIONS.has(item as WorkbenchOnboardingPermission));
}

function emptyProfile(): WorkbenchOnboardingProfile {
	return {
		completed: false,
		dataTools: [],
		bottlenecks: [],
		permissions: [],
		suggestedConnectors: [],
		suggestedSeedWorkflows: [],
		computeDefault: "local",
	};
}

function normalizeProfile(value: unknown): WorkbenchOnboardingProfile {
	if (!value || typeof value !== "object" || Array.isArray(value)) return emptyProfile();
	const record = value as Record<string, unknown>;
	const selectedTask = record.selectedTask && typeof record.selectedTask === "object" && !Array.isArray(record.selectedTask)
		? record.selectedTask as Record<string, unknown>
		: {};
	const completed = record.completed === true;
	const profile: WorkbenchOnboardingProfile = {
		completed,
		...(normalizeText(record.field, 120) ? { field: normalizeText(record.field, 120) } : {}),
		...(normalizeText(record.goal, 180) ? { goal: normalizeText(record.goal, 180) } : {}),
		...(normalizeText(record.workflow, 180) ? { workflow: normalizeText(record.workflow, 180) } : {}),
		dataTools: normalizeStringList(record.dataTools, 16, 120),
		bottlenecks: normalizeStringList(record.bottlenecks, 16, 120),
		...(normalizeLongText(record.notes, 2_000) ? { notes: normalizeLongText(record.notes, 2_000) } : {}),
		permissions: normalizePermissions(record.permissions),
		...(normalizeText(record.projectId, 128) ? { projectId: normalizeText(record.projectId, 128) } : {}),
		...(normalizeText(record.sessionId, 128) ? { sessionId: normalizeText(record.sessionId, 128) } : {}),
		...(normalizeText(record.suggestedSpecialist, 80) ? { suggestedSpecialist: normalizeText(record.suggestedSpecialist, 80) } : {}),
		suggestedConnectors: normalizeStringList(record.suggestedConnectors, 16, 120),
		suggestedSeedWorkflows: normalizeStringList(record.suggestedSeedWorkflows, 8, 120),
		computeDefault: record.computeDefault === "off" ? "off" : "local",
		...(typeof record.createdAt === "string" ? { createdAt: record.createdAt } : {}),
		...(typeof record.updatedAt === "string" ? { updatedAt: record.updatedAt } : {}),
	};
	const title = normalizeText(selectedTask.title, 160);
	const description = normalizeText(selectedTask.description, 400);
	if (title && description) profile.selectedTask = { title, description };
	return profile;
}

export function readWorkbenchOnboardingProfile(workingDir: string): WorkbenchOnboardingProfile {
	const path = onboardingPath(workingDir);
	if (!existsSync(path)) return emptyProfile();
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		return normalizeProfile(parsed);
	} catch {
		return emptyProfile();
	}
}

export function suggestedSpecialistForOnboarding(input: Pick<WorkbenchOnboardingCompleteInput, "bottlenecks" | "goal">): string {
	const text = [...(input.bottlenecks ?? []), input.goal ?? ""].join(" ").toLowerCase();
	if (/(verify|citation|evidence|reproduc|check|trace)/.test(text)) return "verifier";
	if (/(paper|literature|prior art|review|survey)/.test(text)) return "researcher";
	if (/(draft|write|manuscript|narrative|figure)/.test(text)) return "writer";
	return "researcher";
}

export function suggestedSeedWorkflowsForOnboarding(
	input: Pick<WorkbenchOnboardingCompleteInput, "dataTools" | "field" | "goal" | "workflow">,
): string[] {
	const text = [input.field, input.goal, input.workflow, ...(input.dataTools ?? [])].join(" ").toLowerCase();
	const ranked = OPEN_SCIENCE_SEED_WORKFLOWS.map((name) => {
		const lower = name.toLowerCase();
		let score = 0;
		if (/enzyme|protein|structure|variant|sequence/.test(text) && /enzyme|extremophile/.test(lower)) score += 3;
		if (/crispr|screen|perturb|guide|knockout/.test(text) && /crispr/.test(lower)) score += 4;
		if (/single.cell|scrna|immun|tumor|therapy/.test(text) && /immunotherapy/.test(lower)) score += 4;
		if (/evolution|phylo|alignment|protein/.test(text) && /extremophile/.test(lower)) score += 3;
		return { name, score };
	}).sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
	return ranked.slice(0, 3).map((item) => item.name);
}

export function buildOnboardingProjectContext(
	input: WorkbenchOnboardingCompleteInput,
): string {
	const specialist = suggestedSpecialistForOnboarding(input);
	const seeds = suggestedSeedWorkflowsForOnboarding(input);
	const lines = [
		"Onboarding profile for this open science project:",
		input.field ? `- Field: ${input.field}` : "",
		input.goal ? `- Research goal: ${input.goal}` : "",
		input.workflow ? `- Day-to-day workflow: ${input.workflow}` : "",
		input.dataTools?.length ? `- Data/tools: ${input.dataTools.join(", ")}` : "",
		input.bottlenecks?.length ? `- Bottlenecks: ${input.bottlenecks.join(", ")}` : "",
		input.notes ? `- Extra notes: ${input.notes}` : "",
		`- First selected task: ${input.selectedTask.title} — ${input.selectedTask.description}`,
		`- Suggested specialist: ${specialist}`,
		seeds.length ? `- Open science seed workflow references: ${seeds.join(", ")}` : "",
		input.permissions?.length ? `- Granted setup scopes: ${input.permissions.join(", ")}` : "",
		"",
		"Use this context to choose relevant papers, databases, tools, compute mode, and verification checks. Preserve scientific identifiers and source URLs in outputs.",
	];
	return lines.filter(Boolean).join("\n").slice(0, 8_000);
}

export function completeWorkbenchOnboardingProfile(
	workingDir: string,
	input: WorkbenchOnboardingCompleteInput,
): WorkbenchOnboardingProfile {
	const previous = readWorkbenchOnboardingProfile(workingDir);
	const timestamp = nowIso();
	const permissions = normalizePermissions(input.permissions);
	const profile: WorkbenchOnboardingProfile = {
		completed: true,
		...(normalizeText(input.field, 120) ? { field: normalizeText(input.field, 120) } : {}),
		...(normalizeText(input.goal, 180) ? { goal: normalizeText(input.goal, 180) } : {}),
		...(normalizeText(input.workflow, 180) ? { workflow: normalizeText(input.workflow, 180) } : {}),
		dataTools: normalizeStringList(input.dataTools, 16, 120),
		bottlenecks: normalizeStringList(input.bottlenecks, 16, 120),
		...(normalizeLongText(input.notes, 2_000) ? { notes: normalizeLongText(input.notes, 2_000) } : {}),
		permissions,
		selectedTask: {
			title: normalizeText(input.selectedTask.title, 160) ?? "Open science research task",
			description: normalizeText(input.selectedTask.description, 400) ?? "Start a local open science research session.",
		},
		projectId: input.projectId,
		sessionId: input.sessionId,
		suggestedSpecialist: suggestedSpecialistForOnboarding(input),
		suggestedConnectors: permissions.includes("science-databases") || permissions.includes("connectors")
			? [FEYNMAN_BIO_TOOLS_NAME]
			: [],
		suggestedSeedWorkflows: suggestedSeedWorkflowsForOnboarding(input),
		computeDefault: permissions.includes("compute") ? "local" : "off",
		createdAt: previous.createdAt ?? timestamp,
		updatedAt: timestamp,
	};
	const path = onboardingPath(workingDir);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ schema: ONBOARDING_SCHEMA, ...profile }, null, 2)}\n`, "utf8");
	return profile;
}

export function onboardingSettingsRecords(
	input: WorkbenchOnboardingCompleteInput,
): WorkbenchOnboardingSettingsRecord[] {
	const permissions = normalizePermissions(input.permissions);
	const records: WorkbenchOnboardingSettingsRecord[] = permissions.map((permission) => ({
		collection: "permissionGrants",
		record: {
			id: `onboarding-${permission}`,
			name: permissionLabel(permission),
			scope: `onboarding:${permission}`,
			decision: permission === "credentials" ? "ask" : "allow",
			description: `Granted during onboarding for ${input.selectedTask.title}.`,
		},
	}));
	if (permissions.includes("memory")) {
		records.push({
			collection: "memoryCategories",
			record: {
				id: "onboarding-research-context",
				name: "Research context",
				guidance: "Recall the user's field, research workflow, data/tool preferences, bottlenecks, and selected first task.",
				autoRecall: true,
			},
		});
		records.push({
			collection: "memoryCategories",
			record: {
				id: "onboarding-verified-findings",
				name: "Verified findings",
				guidance: "Save only source-backed findings, identifiers, methods, datasets, and reproducibility notes.",
				autoRecall: true,
			},
		});
	}
	if (permissions.includes("science-databases") || permissions.includes("connectors")) {
		records.push({
			collection: "permissionGrants",
			record: {
				id: "onboarding-feynman-bio-tools",
				name: FEYNMAN_BIO_TOOLS_NAME,
				scope: "builtin:feynman_science_database_search",
				decision: "allow",
				description: `Enabled during onboarding for ${input.selectedTask.title}.`,
			},
		});
	}
	return records;
}

function permissionLabel(permission: WorkbenchOnboardingPermission): string {
	const labels: Record<WorkbenchOnboardingPermission, string> = {
		compute: "Local compute",
		connectors: "MCP connectors",
		credentials: "Credential references",
		files: "Local files",
		memory: "Project memory",
		"science-databases": "Science databases",
		web: "Web evidence",
	};
	return labels[permission];
}
