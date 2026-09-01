import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, relative, resolve, sep } from "node:path";

import { buildModelStatusSnapshotFromRecords, getAvailableModelRecords, getSupportedModelRecords, type ModelStatusSnapshot } from "../model/catalog.js";
import type {
	ArtifactCategory,
	WorkbenchArtifact,
	WorkbenchChangelogEntry,
	WorkbenchComputeProvider,
	WorkbenchGeneratedPlan,
	WorkbenchGeneratedPlanStep,
	WorkbenchGeneratedPlanStatus,
	WorkbenchNotebookCell,
	WorkbenchPlanStepStatus,
	WorkbenchProject,
	WorkbenchProjectKind,
	WorkbenchProvenanceRecord,
	WorkbenchResource,
	WorkbenchResourceGroup,
	WorkbenchRun,
	WorkbenchRunStatus,
	WorkbenchState,
	WorkbenchVerificationCheck,
	WorkbenchVerificationStatus,
} from "./types.js";
import { readWorkbenchArtifactAnnotations } from "./annotations.js";
import { applyWorkbenchArtifactActions, buildWorkbenchArtifactActionItems } from "./artifact-actions.js";
import { buildArtifactVersions } from "./artifact-versions.js";
import { listWorkbenchCloudExportTargets } from "./cloud-export-targets.js";
import { readComputePendingTerminateRecords } from "./compute-lifecycle.js";
import { buildComputeJobsFromNotebookRecords, buildWorkbenchComputePendingTerminateRecords, buildWorkbenchComputeUsageRecords } from "./compute-usage.js";
import { getWorkbenchDataRoot, migratedWorkbenchDataPath } from "./data-root.js";
import { buildExecutionRecords } from "./execution.js";
import { contentTypeForExtension, isWorkbenchPreviewExtension, languageForExtension } from "./file-types.js";
import { buildWorkbenchFrameSystemPrompts } from "./frame-system-prompts.js";
import { buildNotebookEnvironmentRecords, buildNotebookKernelRecords } from "./notebook-environments.js";
import { listActiveNotebookExecutionRecords, readNotebookExecutionRecords } from "./notebook-execution.js";
import { readWorkbenchOnboardingProfile } from "./onboarding.js";
import { buildWorkbenchPollerLeases } from "./poller-leases.js";
import { readWorkbenchSafetyFeedback } from "./safety-feedback.js";
import { buildConnectorResources as buildPackageConnectorResources } from "./package-resources.js";
import { readWorkbenchProjects, type WorkbenchStoredProject } from "./projects.js";
import { buildWorkbenchProjectMetadata } from "./project-metadata.js";
import { readWorkbenchFrameReadCursors } from "./read-cursors.js";
import { buildWorkbenchSettingsResourceGroups } from "./settings-resources.js";
import { buildComputeProviders } from "./compute-providers.js";
import { listWorkbenchChatSessions } from "./chat.js";
import { buildWorkbenchClaims, claimIdForText } from "./claims.js";
import { mergeWorkbenchChatRuns } from "./chat-runs.js";
import { buildComputeJobsFromModelEndpointRecords } from "./model-endpoint-usage.js";
import { readWorkbenchMemory } from "./memory.js";
import { buildWorkbenchSessionActivity } from "./session-activity.js";
import { buildWorkbenchStateLedgers } from "./state-ledgers.js";
import { buildWorkbenchSummary } from "./summary.js";
import { readWorkbenchTranscriptAnnotations } from "./transcript-annotations.js";
import { artifactPriority, augmentRunsWithExecutionArtifacts, runOwnsArtifact } from "./run-artifacts.js";

const ARTIFACT_ROOTS = ["outputs", "papers", "notes"] as const;
const VISUAL_EXTENSIONS = new Set([".gif", ".jpeg", ".jpg", ".m4v", ".mov", ".mp4", ".mpeg", ".mpg", ".ogv", ".pdf", ".png", ".svg", ".webm", ".webp"]);
const DATA_EXTENSIONS = new Set([".csv", ".ipynb", ".json", ".jsonl", ".tsv", ".xlsx"]);
const MAX_TITLE_READ_BYTES = 96_000;
const MAX_FILE_READ_BYTES = 512_000;
const MAX_SCANNED_FILES = 1_500;
const MAX_NOTEBOOK_CELLS = 180;
const MAX_COMPUTE_JOBS = 160;
const MAX_PROVENANCE_RECORDS = 120;
const MAX_RESOURCE_FILES = 240;
const MAX_RESOURCE_READ_BYTES = 96_000;
const WORKBENCH_PLAN_SCHEMA = "feynman.workbenchPlan.v1";
const GENERATED_PLAN_STATUSES = new Set<WorkbenchGeneratedPlanStatus>([
	"approved",
	"awaiting_approval",
	"complete",
	"rejected",
	"running",
]);
const PLAN_STEP_STATUSES = new Set<WorkbenchPlanStepStatus>([
	"blocked",
	"complete",
	"pending",
	"running",
]);

export type BuildWorkbenchStateOptions = {
	workingDir: string;
	version?: string;
	settingsPath?: string;
	authPath?: string;
	modelStatus?: ModelStatusSnapshot;
	maxArtifacts?: number;
	maxRuns?: number;
};

export type WorkbenchFilePreview = {
	path: string;
	name: string;
	category: ArtifactCategory;
	sizeBytes: number;
	updatedAt: string;
	content: string;
	truncated: boolean;
};

function readCurrentModelSpec(settingsPath: string | undefined): string | undefined {
	if (!settingsPath) return undefined;
	try {
		const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
		if (typeof settings.defaultProvider === "string" && typeof settings.defaultModel === "string") {
			return `${settings.defaultProvider}/${settings.defaultModel}`;
		}
	} catch {}
	return undefined;
}

export async function loadWorkbenchModelStatus(options: Pick<BuildWorkbenchStateOptions, "authPath" | "settingsPath">): Promise<ModelStatusSnapshot | undefined> {
	if (!options.authPath) return undefined;
	return buildModelStatusSnapshotFromRecords(
		await getSupportedModelRecords(options.authPath),
		await getAvailableModelRecords(options.authPath),
		readCurrentModelSpec(options.settingsPath),
	);
}

export type WorkbenchFileDownload = {
	path: string;
	name: string;
	category: ArtifactCategory;
	sizeBytes: number;
	contentType: string;
	buffer: Buffer;
};

function toPosixPath(path: string): string {
	return path.split(sep).join("/");
}

function titleCaseSlug(value: string): string {
	const words = value
		.replace(/[_-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return words ? words.replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Workspace";
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

function categoryLabel(category: ArtifactCategory): string {
	const labels: Record<ArtifactCategory, string> = {
		data: "data",
		draft: "drafts",
		note: "notes",
		output: "outputs",
		paper: "papers",
		plan: "plans",
		provenance: "provenance",
		verification: "verification",
		visual: "visuals",
	};
	return labels[category];
}

function stripKnownSuffix(stem: string): string {
	let next = stem.replace(/\.provenance$/, "");
	const suffixes = [
		"-paper-access",
		"-research-foundations",
		"-research-implications",
		"-research-inference",
		"-research-revisions",
		"-research-direct",
		"-research-papers",
		"-research-web",
		"-verification",
		"-legal-context",
		"-score-audit",
		"-provenance",
		"-calibration",
		"-reproduction",
		"-synthesis",
		"-brief",
		"-cited",
		"-draft",
		"-graph",
		"-raw",
	];
	for (const suffix of suffixes) {
		if (next.endsWith(suffix) && next.length > suffix.length) {
			next = next.slice(0, -suffix.length);
			break;
		}
	}
	return next || stem || "workspace";
}

function stripWorkbenchPlanSuffix(stem: string): string {
	return stem.endsWith(".workbench-plan") ? stem.slice(0, -".workbench-plan".length) : stem;
}

function slugForArtifact(relPath: string): string {
	const segments = relPath.split("/");
	if (segments[0] === "outputs" && segments[1] === ".plans") {
		return stripWorkbenchPlanSuffix(segments[2]?.replace(/\.[^.]+$/, "") || "plans");
	}
	if (segments[0] === "outputs" && segments[1] === ".drafts") {
		return stripKnownSuffix(basename(relPath).replace(/\.[^.]+$/, ""));
	}
	if (segments[0] === "outputs" && segments[1] === "open-science-seeds" && segments[2]) {
		return segments[2];
	}
	if (segments[0] === "outputs" && segments[1] && !segments[1].startsWith(".")) {
		return segments.length > 2 ? segments[1] : stripKnownSuffix(basename(relPath).replace(/\.[^.]+$/, ""));
	}
	if (segments[0] === "notes") {
		return stripKnownSuffix(basename(relPath).replace(/\.[^.]+$/, ""));
	}
	if (segments[0] === "papers") {
		return stripKnownSuffix(basename(relPath).replace(/\.[^.]+$/, ""));
	}
	return stripKnownSuffix(basename(relPath).replace(/\.[^.]+$/, ""));
}

export function categoryForArtifact(relPath: string): ArtifactCategory {
	const ext = extname(relPath).toLowerCase();
	const name = basename(relPath).toLowerCase();
	if (relPath.startsWith("outputs/.plans/")) return "plan";
	if (relPath.startsWith("outputs/.drafts/")) return "draft";
	if (name.endsWith(".provenance.md") || name.includes("provenance")) return "provenance";
	if (name.includes("verification") || name.includes("score-audit")) return "verification";
	if (relPath.startsWith("notes/")) return "note";
	if (relPath.startsWith("papers/")) return "paper";
	if (VISUAL_EXTENSIONS.has(ext)) return "visual";
	if (DATA_EXTENSIONS.has(ext)) return "data";
	return "output";
}

function isPreviewable(relPath: string): boolean {
	return isWorkbenchPreviewExtension(extname(relPath).toLowerCase());
}

function contentTypeForPath(relPath: string): string {
	return contentTypeForExtension(extname(relPath).toLowerCase());
}

function titleFromMarkdown(absPath: string, fallback: string): string {
	try {
		const text = readFileSync(absPath, "utf8").slice(0, MAX_TITLE_READ_BYTES);
		const heading = text.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim();
		return heading || fallback;
	} catch {
		return fallback;
	}
}

function buildArtifact(workingDir: string, absPath: string): WorkbenchArtifact | undefined {
	const stat = statSync(absPath);
	if (!stat.isFile()) return undefined;
	const relPath = toPosixPath(relative(workingDir, absPath));
	if (basename(relPath) === ".gitkeep") return undefined;
	const extension = extname(relPath).toLowerCase();
	const slug = slugForArtifact(relPath);
	const category = categoryForArtifact(relPath);
	const fallbackTitle = titleCaseSlug(basename(relPath, extension).replace(/\.provenance$/, ""));
	const title = extension === ".md" ? titleFromMarkdown(absPath, fallbackTitle) : fallbackTitle;
	return {
		path: relPath,
		name: basename(relPath),
		title,
		category,
		extension,
		contentType: contentTypeForPath(relPath),
		sizeBytes: stat.size,
		updatedAt: stat.mtime.toISOString(),
		updatedAtMs: stat.mtimeMs,
		slug,
		previewable: isPreviewable(relPath),
	};
}

function walkArtifactFiles(root: string, maxFiles: number): string[] {
	const files: string[] = [];
	const ignoredDirs = new Set([".git", "dist", "node_modules"]);

	function walk(dir: string): void {
		if (files.length >= maxFiles) return;
		for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			if (ignoredDirs.has(entry.name)) continue;
			const absPath = resolve(dir, entry.name);
			if (entry.isDirectory()) {
				walk(absPath);
				continue;
			}
			if (entry.isFile()) files.push(absPath);
			if (files.length >= maxFiles) return;
		}
	}

	if (existsSync(root)) walk(root);
	return files;
}

function taskSummaryForRun(artifacts: WorkbenchArtifact[]): string {
	const categories = Array.from(new Set(artifacts.map((artifact) => artifact.category))).sort();
	const labels = categories.map(categoryLabel);
	const hasPlan = categories.includes("plan");
	const hasChecks = categories.includes("verification") || categories.includes("provenance");
	if (hasPlan && hasChecks) {
		return `Research run with ${pluralize(artifacts.length, "artifact")} spanning ${labels.join(", ")}.`;
	}
	if (hasPlan) {
		return `Planned research run with ${pluralize(artifacts.length, "artifact")} ready for follow-through.`;
	}
	if (hasChecks) {
		return `Audited research run with verification and provenance artifacts.`;
	}
	return `Research run with ${pluralize(artifacts.length, "artifact")} across ${labels.join(", ")}.`;
}

function statusForRun(artifacts: WorkbenchArtifact[]): WorkbenchRunStatus {
	const categories = new Set(artifacts.map((artifact) => artifact.category));
	if (categories.has("verification") && categories.has("provenance")) return "verified";
	if (categories.has("provenance")) return "provenance";
	if (categories.has("draft")) return "draft";
	if (categories.has("plan") && artifacts.every((artifact) => artifact.category === "plan")) return "planned";
	return "artifact";
}

function buildRuns(artifacts: WorkbenchArtifact[], maxRuns: number): WorkbenchRun[] {
	const bySlug = new Map<string, WorkbenchArtifact[]>();
	for (const artifact of artifacts) {
		const group = bySlug.get(artifact.slug) ?? [];
		group.push(artifact);
		bySlug.set(artifact.slug, group);
	}

	return Array.from(bySlug, ([slug, group]) => {
		const sorted = [...group].sort((a, b) => artifactPriority(a) - artifactPriority(b) || b.updatedAtMs - a.updatedAtMs);
		const newest = group.reduce((current, artifact) => (artifact.updatedAtMs > current.updatedAtMs ? artifact : current), group[0]);
		const categories = Array.from(new Set(group.map((artifact) => artifact.category))).sort();
		const notebookCellCount = group.filter((artifact) => artifact.previewable || artifact.category === "paper").length;
		return {
			slug,
			title: sorted[0]?.title || titleCaseSlug(slug),
			taskSummary: taskSummaryForRun(group),
			status: statusForRun(group),
			source: "artifact" as const,
			updatedAt: newest.updatedAt,
			updatedAtMs: newest.updatedAtMs,
			artifactCount: group.length,
			artifactPaths: sorted.map((artifact) => artifact.path),
			notebookCellCount,
			categories,
			lastArtifactNames: sorted.slice(0, 4).map((artifact) => artifact.name),
			primaryArtifact: sorted[0],
			hasPlan: categories.includes("plan"),
			hasProvenance: categories.includes("provenance"),
			hasVerification: categories.includes("verification"),
		};
	}).sort((a, b) => b.updatedAtMs - a.updatedAtMs).slice(0, maxRuns);
}

function buildProject(
	id: string,
	name: string,
	description: string,
	kind: WorkbenchProjectKind,
	runs: WorkbenchRun[],
	artifacts: WorkbenchArtifact[],
	options: { agentContext?: string; createdAt?: string; fallbackUpdatedAt?: string } = {},
): WorkbenchProject {
	const newestArtifact = artifacts[0];
	const newestRun = runs[0];
	const updatedAt = newestArtifact?.updatedAt ?? newestRun?.updatedAt ?? options.fallbackUpdatedAt ?? new Date().toISOString();
	const fallbackUpdatedAtMs = Date.parse(options.fallbackUpdatedAt ?? "") || 0;
	const updatedAtMs = Math.max(newestArtifact?.updatedAtMs ?? 0, newestRun?.updatedAtMs ?? 0, fallbackUpdatedAtMs);
	return {
		id,
		name,
		description,
		kind,
		...buildWorkbenchProjectMetadata(id, { ...options, updatedAt, updatedAtMs }),
		...(options.agentContext ? { agentContext: options.agentContext } : {}),
		runSlugs: runs.map((run) => run.slug),
		artifactPaths: artifacts.map((artifact) => artifact.path),
		sessionCount: runs.length, artifactCount: artifacts.length,
		updatedAt, updatedAtMs,
		...(newestRun ? { primaryRunSlug: newestRun.slug } : {}),
	};
}

function buildCustomProject(project: WorkbenchStoredProject, runs: WorkbenchRun[], artifacts: WorkbenchArtifact[]): WorkbenchProject {
	const projectRuns = runs.filter((run) => run.projectId === project.id);
	const projectArtifacts = artifacts.filter((artifact) => projectRuns.some((run) => runOwnsArtifact(run, artifact)));
	return buildProject(
		project.id,
		project.name,
		project.description || "Project-local research sessions and artifacts.",
		"custom",
		projectRuns,
		projectArtifacts,
		{ agentContext: project.agentContext, createdAt: project.createdAt, fallbackUpdatedAt: project.updatedAt },
	);
}

function buildProjects(runs: WorkbenchRun[], artifacts: WorkbenchArtifact[], customProjects: WorkbenchStoredProject[]): WorkbenchProject[] {
	const bySlug = new Map(runs.map((run) => [run.slug, run]));
	const projectArtifacts = (predicate: (artifact: WorkbenchArtifact) => boolean): WorkbenchArtifact[] =>
		artifacts.filter(predicate);
	const chatRunsForProject = (projectId: string): WorkbenchRun[] =>
		runs.filter((run) => run.source === "chat" && run.projectId === projectId);
	const sortRuns = (items: WorkbenchRun[]): WorkbenchRun[] =>
		items.slice().sort((a, b) => b.updatedAtMs - a.updatedAtMs || a.slug.localeCompare(b.slug));
	const projectRuns = (matchedArtifacts: WorkbenchArtifact[], predicate: (run: WorkbenchRun) => boolean): WorkbenchRun[] => {
		const slugs = new Set(matchedArtifacts.map((artifact) => artifact.slug));
		const paths = new Set(matchedArtifacts.map((artifact) => artifact.path));
		return sortRuns(runs.filter((run) => predicate(run) || slugs.has(run.slug) || run.artifactPaths?.some((path) => paths.has(path))));
	};
	const artifactsForRuns = (matchedRuns: WorkbenchRun[], seedArtifacts: WorkbenchArtifact[]): WorkbenchArtifact[] => {
		const slugs = new Set(matchedRuns.map((run) => run.slug));
		const paths = new Set(seedArtifacts.map((artifact) => artifact.path));
		for (const run of matchedRuns) {
			for (const path of run.artifactPaths ?? []) paths.add(path);
		}
		return artifacts.filter((artifact) => slugs.has(artifact.slug) || paths.has(artifact.path));
	};
	const workspaceRuns = runs;
	const workspaceArtifacts = artifacts;
	const planSeed = projectArtifacts((artifact) => artifact.category === "plan" || artifact.category === "draft");
	const planRuns = sortRuns([
		...projectRuns(planSeed, (run) => run.hasPlan || run.status === "planned" || run.status === "draft"),
		...chatRunsForProject("active-plans"),
	]);
	const paperSeed = projectArtifacts((artifact) => artifact.category === "paper" || artifact.path.includes("/paper"));
	const paperRuns = sortRuns([
		...projectRuns(paperSeed, (run) => run.categories.includes("paper")),
		...chatRunsForProject("papers-and-reviews"),
	]);
	const verificationSeed = projectArtifacts((artifact) => artifact.category === "verification" || artifact.category === "provenance");
	const verificationRuns = sortRuns([
		...projectRuns(verificationSeed, (run) => run.hasVerification || run.hasProvenance),
		...chatRunsForProject("verification"),
	]);
	const seedArtifacts = projectArtifacts((artifact) => artifact.path.startsWith("outputs/open-science-seeds/"));
	const seedRuns = projectRuns(seedArtifacts, (run) => seedArtifacts.some((artifact) => artifact.slug === run.slug));

	const builtInProjects = [
		buildProject(
			"workspace",
			"Feynman Workspace",
			"Local research sessions, outputs, drafts, papers, checks, and lab notes.",
			"workspace",
			workspaceRuns,
			workspaceArtifacts,
		),
		buildProject(
			"active-plans",
			"Active Plans",
			"Planned and drafted research runs waiting for execution, review, or synthesis.",
			"plans",
			planRuns,
			artifactsForRuns(planRuns, planSeed),
		),
		buildProject(
			"papers-and-reviews",
			"Papers and Reviews",
			"Paper files, review artifacts, ranking outputs, and literature-facing runs.",
			"papers",
			paperRuns,
			artifactsForRuns(paperRuns, paperSeed),
		),
		buildProject(
			"verification",
			"Verification",
			"Source checks, provenance sidecars, score audits, and reproducibility evidence.",
			"verification",
			verificationRuns,
			artifactsForRuns(verificationRuns, verificationSeed),
		),
		buildProject(
			"seed-workflows",
			"Open Science Seed Workflows",
			"Feynman-owned enzyme engineering, extremophile protein, CRISPR screen, and immunotherapy fixtures for open-science parity and smoke tests.",
			"seeds",
			seedRuns,
			artifactsForRuns(seedRuns, seedArtifacts),
		),
	].map((project) => ({
		...project,
		runSlugs: project.runSlugs.filter((slug) => bySlug.has(slug)),
	}));
	const customProjectRows = customProjects
		.map((project) => buildCustomProject(project, runs, artifacts))
		.sort((a, b) => b.updatedAtMs - a.updatedAtMs || a.name.localeCompare(b.name));
	return [...builtInProjects, ...customProjectRows];
}

function languageForArtifact(artifact: WorkbenchArtifact): string {
	return languageForExtension(artifact.extension);
}

function buildNotebook(artifacts: WorkbenchArtifact[]): WorkbenchNotebookCell[] {
	return artifacts
		.filter((artifact) =>
			artifact.previewable ||
			artifact.category === "paper" ||
			artifact.category === "visual"
		)
		.slice(0, MAX_NOTEBOOK_CELLS)
		.map((artifact, index) => ({
			id: `cell-${index}-${artifact.path}`,
			runSlug: artifact.slug,
			title: artifact.title,
			path: artifact.path,
			language: languageForArtifact(artifact),
			category: artifact.category,
			updatedAt: artifact.updatedAt,
			updatedAtMs: artifact.updatedAtMs,
			previewable: artifact.previewable,
		}));
}

function normalizeResourceId(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 90) || "resource";
}

function frontmatterValue(text: string, key: string): string | undefined {
	const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
	if (!match) return undefined;
	const prefix = `${key}:`;
	for (const rawLine of match[1].split("\n")) {
		const line = rawLine.trim();
		if (!line.startsWith(prefix)) continue;
		const value = line.slice(prefix.length).trim();
		return value.replace(/^["']|["']$/g, "").trim() || undefined;
	}
	return undefined;
}

function firstMarkdownSentence(text: string): string {
	return text
		.replace(/^---\n[\s\S]*?\n---\n?/, "")
		.split("\n")
		.map((line) => line.replace(/^#+\s*/, "").trim())
		.filter((line) => line && !line.startsWith("```") && !line.startsWith("|"))
		.find(Boolean)
		?.slice(0, 240) || "";
}

function readTextPrefix(path: string): string {
	const buffer = readFileSync(path);
	return buffer.subarray(0, MAX_RESOURCE_READ_BYTES).toString("utf8");
}

function markdownResource(
	workingDir: string,
	absPath: string,
	options: {
		fallbackName?: string;
		source: string;
		status?: WorkbenchResource["status"];
		command?: (name: string) => string;
		tags?: string[];
	},
): WorkbenchResource | undefined {
	try {
		const text = readTextPrefix(absPath);
		const name = frontmatterValue(text, "name") ?? options.fallbackName ?? basename(absPath, extname(absPath));
		const description = frontmatterValue(text, "description") ?? firstMarkdownSentence(text) ?? name;
		const command = options.command?.(name);
		return {
			id: normalizeResourceId(`${options.source}-${name}-${relative(workingDir, absPath)}`),
			name,
			description,
			status: options.status ?? "configured",
			source: options.source,
			path: toPosixPath(relative(workingDir, absPath)),
			...(command ? { command } : {}),
			tags: options.tags ?? [],
		};
	} catch {
		return undefined;
	}
}

function listFiles(root: string, predicate: (name: string, absPath: string) => boolean, maxFiles = MAX_RESOURCE_FILES): string[] {
	const results: string[] = [];
	function walk(dir: string): void {
		if (results.length >= maxFiles || !existsSync(dir)) return;
		for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const absPath = resolve(dir, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === "node_modules" || entry.name === ".git") continue;
				walk(absPath);
				continue;
			}
			if (entry.isFile() && predicate(entry.name, absPath)) results.push(absPath);
			if (results.length >= maxFiles) return;
		}
	}
	walk(root);
	return results;
}

function directMarkdownFiles(root: string): string[] {
	if (!existsSync(root)) return [];
	return readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
		.map((entry) => resolve(root, entry.name))
		.sort((a, b) => a.localeCompare(b));
}

function countFiles(root: string, predicate: (name: string) => boolean): number {
	return listFiles(root, (name) => predicate(name), 1_000).length;
}

function buildSpecialistResources(workingDir: string): WorkbenchResource[] {
	return directMarkdownFiles(resolve(workingDir, ".feynman", "agents"))
		.map((path) => markdownResource(workingDir, path, {
			source: "Feynman specialist",
			command: (name) => `/run ${name} <task>`,
			tags: ["agent", "subagent"],
		}))
		.filter((resource): resource is WorkbenchResource => Boolean(resource));
}

function buildSkillResources(workingDir: string): WorkbenchResource[] {
	return listFiles(resolve(workingDir, "skills"), (name) => name === "SKILL.md")
		.map((path) => markdownResource(workingDir, path, {
			source: "Pi skill",
			command: (name) => `/skill:${name}`,
			tags: ["skill", "slash command"],
		}))
		.filter((resource): resource is WorkbenchResource => Boolean(resource));
}

function buildPromptResources(workingDir: string): WorkbenchResource[] {
	return directMarkdownFiles(resolve(workingDir, "prompts"))
		.map((path) => markdownResource(workingDir, path, {
			fallbackName: basename(path, ".md"),
			source: "Pi prompt template",
			command: (name) => `/${name}`,
			tags: ["prompt", "slash command"],
		}))
		.filter((resource): resource is WorkbenchResource => Boolean(resource));
}

function buildConnectorResources(workingDir: string): WorkbenchResource[] {
	return buildPackageConnectorResources(workingDir);
}

function buildCredentialResources(): WorkbenchResource[] {
	return [
		{
			id: "model-provider-auth",
			name: "Model provider auth",
			description: "Provider credentials are managed through Feynman's model login flow and reused by Pi sessions.",
			status: "available",
			source: "Feynman CLI",
			command: "feynman model login [id]",
			tags: ["models", "oauth", "api keys"],
		},
		{
			id: "search-provider-keys",
			name: "Search provider keys",
			description: "Web evidence providers are configured through Feynman's search settings.",
			status: "available",
			source: "Feynman CLI",
			command: "feynman search set <provider> [api-key]",
			tags: ["search", "evidence"],
		},
	];
}

function buildPermissionResources(workingDir: string): WorkbenchResource[] {
	return [
		{
			id: "pi-rpc-chat",
			name: "Pi RPC chat",
			description: "Workbench chat uses Pi RPC prompt, steer, abort, session tree, bash, and command discovery primitives.",
			status: "configured",
			source: "Pi RPC",
			detail: "prompt, steer, abort, get_entries, get_tree, get_commands, bash",
			tags: ["chat", "sessions", "tools"],
		},
		{
			id: "workspace-artifact-scope",
			name: "Workspace artifact scope",
			description: "Preview and downloads are constrained to outputs, papers, notes, and the lab notebook.",
			status: "read-only",
			source: "Workbench server",
			path: toPosixPath(workingDir),
			tags: ["files", "provenance"],
		},
		{
			id: "loopback-workbench",
			name: "Loopback workbench",
			description: "The science app runs locally behind a bearer token and cookie, matching the desktop-local control-plane shape.",
			status: "configured",
			source: "Workbench server",
			tags: ["local", "browser"],
		},
	];
}

function buildStorageResources(workingDir: string, artifacts: WorkbenchArtifact[]): WorkbenchResource[] {
	const chatCount = countFiles(migratedWorkbenchDataPath(workingDir, "sessions"), (name) => name.endsWith(".json"));
	const piSessionCount = countFiles(resolve(workingDir, ".feynman", "sessions"), (name) => name.endsWith(".jsonl"));
	return [
		{
			id: "research-artifact-roots",
			name: "Research artifact roots",
			description: `${pluralize(artifacts.length, "artifact")} indexed from outputs, papers, and notes.`,
			status: "configured",
			source: "Workspace",
			detail: "outputs/, papers/, notes/, CHANGELOG.md",
			tags: ["outputs", "papers", "notes"],
		},
		{
			id: "workbench-chat-sessions",
			name: "Workbench chat sessions",
			description: `${pluralize(chatCount, "session")} persisted under the Feynman app data root.`,
			status: chatCount ? "configured" : "available",
			source: "Workbench",
			path: toPosixPath(resolve(getWorkbenchDataRoot(workingDir), "sessions")),
			tags: ["chat", "json"],
		},
		{
			id: "pi-session-history",
			name: "Pi session history",
			description: `${pluralize(piSessionCount, "Pi JSONL session")} available for timeline, branch, and provenance reconstruction.`,
			status: piSessionCount ? "configured" : "available",
			source: "Pi sessions",
			path: ".feynman/sessions",
			tags: ["jsonl", "branches"],
		},
	];
}

function buildMemoryResources(workingDir: string, changelog: WorkbenchChangelogEntry[]): WorkbenchResource[] {
	return [
		{
			id: "lab-notebook",
			name: "Lab notebook",
			description: `${pluralize(changelog.length, "entry", "entries")} loaded from CHANGELOG.md for continuity and verification state.`,
			status: existsSync(resolve(workingDir, "CHANGELOG.md")) ? "configured" : "available",
			source: "Workspace",
			path: "CHANGELOG.md",
			tags: ["continuity", "verification"],
		},
		{
			id: "session-memory-context",
			name: "Session memory context",
			description: "Session-level context is kept local and can be included per turn from the session configuration.",
			status: "available",
			source: "Workbench chat",
			tags: ["local", "opt-in"],
		},
	];
}

function buildComputeResources(compute: WorkbenchComputeProvider[]): WorkbenchResource[] {
	return compute.map((provider) => ({
		id: normalizeResourceId(`compute-${provider.id}`),
		name: provider.name,
		description: provider.description,
		status: provider.status,
		source: provider.family,
		detail: provider.capabilities.join(", "),
		tags: provider.capabilities,
	}));
}

function buildWorkbenchResourceGroups(
	workingDir: string,
	artifacts: WorkbenchArtifact[],
	changelog: WorkbenchChangelogEntry[],
	compute: WorkbenchComputeProvider[],
): WorkbenchResourceGroup[] {
	return [
		{
			id: "specialists",
			title: "Specialists",
			description: "Prompted research agents that can be selected or delegated from a session.",
			resources: buildSpecialistResources(workingDir),
		},
		{
			id: "skills",
			title: "Skills",
			description: "Reusable research playbooks exposed to Pi as skill commands.",
			resources: buildSkillResources(workingDir),
		},
		{
			id: "connectors",
			title: "Connectors",
			description: "Pi packages and project extensions that add external evidence, parsers, tools, or telemetry.",
			resources: buildConnectorResources(workingDir),
		},
		{
			id: "compute",
			title: "Compute",
			description: "Local and Pi-backed execution resources visible to the workbench.",
			resources: buildComputeResources(compute),
		},
		{
			id: "permissions",
			title: "Permissions",
			description: "Local execution, file, and loopback access boundaries for this app.",
			resources: buildPermissionResources(workingDir),
		},
		{
			id: "credentials",
			title: "Credentials",
			description: "Credential surfaces Feynman can use for model and evidence providers.",
			resources: buildCredentialResources(),
		},
		{
			id: "storage",
			title: "Storage",
			description: "Artifact, chat, and Pi session storage used by the local science workspace.",
			resources: buildStorageResources(workingDir, artifacts),
		},
		{
			id: "memory",
			title: "Memory",
			description: "Local continuity records that make research runs resumable and auditable.",
			resources: buildMemoryResources(workingDir, changelog),
		},
		{
			id: "prompts",
			title: "Prompt Templates",
			description: "Slash-command research workflows loaded from Feynman's prompt templates.",
			resources: buildPromptResources(workingDir),
		},
	];
}

function excerptFromFile(workingDir: string, artifact: WorkbenchArtifact): string {
	if (!artifact.previewable) return artifact.path;
	try {
		return readFileSync(resolve(workingDir, artifact.path), "utf8")
			.replace(/^#\s+.+$/m, "")
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.slice(0, 3)
			.join(" ");
	} catch {
		return artifact.path;
	}
}

function buildProvenanceRecords(
	workingDir: string,
	artifacts: WorkbenchArtifact[],
	changelog: WorkbenchChangelogEntry[],
): WorkbenchProvenanceRecord[] {
	const artifactRecords = artifacts
		.filter((artifact) => artifact.category === "verification" || artifact.category === "provenance")
		.slice(0, MAX_PROVENANCE_RECORDS)
		.map((artifact) => ({
			id: artifact.path,
			title: artifact.title,
			kind: artifact.category as "provenance" | "verification",
			runSlug: artifact.slug,
			path: artifact.path,
			updatedAt: artifact.updatedAt,
			excerpt: excerptFromFile(workingDir, artifact) || artifact.path,
		}));
	const changelogRecords = changelog.slice(0, 12).map((entry, index) => ({
		id: `changelog-${index}`,
		title: entry.title,
		kind: "changelog" as const,
		updatedAt: entry.updatedAt,
		excerpt: entry.body,
	}));
	return [...artifactRecords, ...changelogRecords].slice(0, MAX_PROVENANCE_RECORDS);
}

function verificationStatusForExecution(status: string): WorkbenchVerificationStatus {
	if (status === "complete" || status === "verified") return "pass";
	if (status === "error" || status === "stopped") return "fail";
	return "inconclusive";
}

function buildVerificationChecks(
	artifacts: WorkbenchArtifact[],
	execution: ReturnType<typeof buildExecutionRecords>,
): WorkbenchVerificationCheck[] {
	const artifactChecks = artifacts
		.filter((artifact) => artifact.category === "verification")
		.map((artifact) => ({
			id: `artifact:${artifact.path}`,
			title: artifact.title,
			status: "pass" as const,
			claimId: claimIdForText(artifact.title, artifact.slug),
			claim: artifact.title,
			detail: `Verification artifact recorded at ${artifact.path}.`,
			runSlug: artifact.slug,
			evidencePaths: [artifact.path],
			createdAt: artifact.updatedAt,
			createdAtMs: artifact.updatedAtMs,
		}));
	const executionChecks = execution
		.filter((record) => record.purpose === "verification")
		.map((record) => ({
			id: `execution:${record.id}`,
			title: record.title.replace(/^Verification check:\s*/i, ""),
			status: verificationStatusForExecution(record.status),
			claimId: claimIdForText(record.title.replace(/^Verification check:\s*/i, ""), record.runSlug || record.sessionId),
			claim: record.title.replace(/^Verification check:\s*/i, ""),
			detail: record.detail,
			...(record.runSlug ? { runSlug: record.runSlug } : {}),
			...(record.sessionId ? { sessionId: record.sessionId } : {}),
			executionId: record.id,
			evidencePaths: [...new Set([...(record.inputPaths ?? []), ...(record.outputPaths ?? [])])].sort((a, b) => a.localeCompare(b)),
			createdAt: record.createdAt,
			createdAtMs: record.createdAtMs,
		}));
	return [...executionChecks, ...artifactChecks]
		.sort((a, b) => b.createdAtMs - a.createdAtMs || a.id.localeCompare(b.id))
		.slice(0, MAX_PROVENANCE_RECORDS);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	return value as Record<string, unknown>;
}

function stringValue(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" && value.trim() ? value : undefined;
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeGeneratedPlanStep(value: unknown, fallbackUpdatedAt: string): WorkbenchGeneratedPlanStep | undefined {
	const record = asRecord(value);
	if (!record) return undefined;
	const title = stringValue(record, "title");
	const description = stringValue(record, "description");
	if (!title || !description) return undefined;
	const rawStatus = stringValue(record, "status");
	const status = rawStatus && PLAN_STEP_STATUSES.has(rawStatus as WorkbenchPlanStepStatus)
		? rawStatus as WorkbenchPlanStepStatus
		: "pending";
	const notes = stringValue(record, "notes");
	return {
		title,
		description,
		status,
		...(notes ? { notes } : {}),
		artifactPaths: stringArray(record.artifactPaths),
		updatedAt: stringValue(record, "updatedAt") ?? fallbackUpdatedAt,
	};
}

function readGeneratedPlan(workingDir: string, artifact: WorkbenchArtifact): WorkbenchGeneratedPlan | undefined {
	if (artifact.category !== "plan" || artifact.extension !== ".json") return undefined;
	try {
		const parsed = asRecord(JSON.parse(readFileSync(resolve(workingDir, artifact.path), "utf8")));
		if (!parsed || parsed.schema !== WORKBENCH_PLAN_SCHEMA) return undefined;
		const id = stringValue(parsed, "id");
		const sessionId = stringValue(parsed, "sessionId");
		const projectId = stringValue(parsed, "projectId");
		const title = stringValue(parsed, "title");
		const taskSummary = stringValue(parsed, "taskSummary");
		if (!id || !sessionId || !projectId || !title || !taskSummary) return undefined;
		const rawStatus = stringValue(parsed, "status");
		const status = rawStatus && GENERATED_PLAN_STATUSES.has(rawStatus as WorkbenchGeneratedPlanStatus)
			? rawStatus as WorkbenchGeneratedPlanStatus
			: "awaiting_approval";
		const feasibility = asRecord(parsed.feasibility) ?? {};
		const rawConfidence = stringValue(feasibility, "confidence");
		const confidence = rawConfidence === "high" || rawConfidence === "low" || rawConfidence === "medium"
			? rawConfidence
			: "medium";
		const steps = Array.isArray(parsed.steps)
			? parsed.steps
				.map((step) => normalizeGeneratedPlanStep(step, artifact.updatedAt))
				.filter((step): step is WorkbenchGeneratedPlanStep => Boolean(step))
			: [];
		if (!steps.length) return undefined;
		return {
			schema: WORKBENCH_PLAN_SCHEMA,
			id,
			sessionId,
			projectId,
			runSlug: stringValue(parsed, "runSlug") ?? artifact.slug,
			title,
			taskSummary,
			status,
			feasibility: {
				confidence,
				rationale: stringValue(feasibility, "rationale") ?? "Generated from current workspace artifacts.",
			},
			steps,
			artifactPath: artifact.path,
			createdAt: stringValue(parsed, "createdAt") ?? artifact.updatedAt,
			updatedAt: stringValue(parsed, "updatedAt") ?? artifact.updatedAt,
			source: parsed.source === "pi" ? "pi" : "workbench",
		};
	} catch {
		return undefined;
	}
}

function buildGeneratedPlans(workingDir: string, artifacts: WorkbenchArtifact[]): WorkbenchGeneratedPlan[] {
	return artifacts
		.map((artifact) => readGeneratedPlan(workingDir, artifact))
		.filter((plan): plan is WorkbenchGeneratedPlan => Boolean(plan))
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function readChangelog(workingDir: string): WorkbenchChangelogEntry[] {
	const path = resolve(workingDir, "CHANGELOG.md");
	if (!existsSync(path)) return [];
	const text = readFileSync(path, "utf8");
	const matches = Array.from(text.matchAll(/^###\s+(.+)$/gm)).slice(0, 6);
	return matches.map((match, index) => {
		const start = (match.index ?? 0) + match[0].length;
		const end = matches[index + 1]?.index ?? text.length;
		const body = text.slice(start, end).trim().split("\n").slice(0, 5).join("\n").trim();
		return {
			title: match[1].trim(),
			body,
		};
	});
}

export function buildWorkbenchState(options: BuildWorkbenchStateOptions): WorkbenchState {
	const workingDir = resolve(options.workingDir);
	const maxArtifacts = options.maxArtifacts ?? 600;
	const maxRuns = options.maxRuns ?? 80;
	const scannedArtifacts = ARTIFACT_ROOTS.flatMap((root) => walkArtifactFiles(resolve(workingDir, root), MAX_SCANNED_FILES))
		.map((absPath) => buildArtifact(workingDir, absPath))
		.filter((artifact): artifact is WorkbenchArtifact => Boolean(artifact))
		.sort((a, b) => b.updatedAtMs - a.updatedAtMs)
		.slice(0, maxArtifacts);
	const artifacts = applyWorkbenchArtifactActions(workingDir, scannedArtifacts);
	const artifactActions = buildWorkbenchArtifactActionItems(workingDir, scannedArtifacts);
	const plans = buildGeneratedPlans(workingDir, artifacts);
	const chatSessions = listWorkbenchChatSessions({ workingDir });
	const artifactRuns = buildRuns(artifacts, maxRuns);
	const initialRuns = mergeWorkbenchChatRuns(artifactRuns, chatSessions, maxRuns);
	const execution = buildExecutionRecords(workingDir, artifacts, initialRuns);
	const runs = augmentRunsWithExecutionArtifacts(workingDir, initialRuns, artifacts, execution);
	const projects = buildProjects(runs, artifacts, readWorkbenchProjects(workingDir));
	const changelog = readChangelog(workingDir);
	const memory = readWorkbenchMemory(workingDir);
	const artifactPaths = new Set(artifacts.map((artifact) => artifact.path));
	const artifactAnnotations = readWorkbenchArtifactAnnotations(workingDir).filter((annotation) => artifactPaths.has(annotation.artifactPath));
	const validTranscriptRoots = new Set([...chatSessions.map((session) => session.id), ...runs.map((run) => run.slug), ...projects.map((project) => project.id)]);
	const transcriptAnnotations = readWorkbenchTranscriptAnnotations(workingDir).filter((annotation) => validTranscriptRoots.has(annotation.rootFrameId));
	const safetyFeedback = readWorkbenchSafetyFeedback(workingDir).filter((feedback) => validTranscriptRoots.has(feedback.rootFrameId));
	const frameReadCursors = readWorkbenchFrameReadCursors(workingDir).filter((cursor) => runs.some((run) => run.slug === cursor.rootFrameId) || projects.some((project) => project.id === cursor.rootFrameId));
	const artifactVersions = buildArtifactVersions(workingDir, artifacts, execution, artifactAnnotations);
	const cloudExportTargets = listWorkbenchCloudExportTargets(workingDir);
	const checks = buildVerificationChecks(artifacts, execution);
	const claims = buildWorkbenchClaims({ workingDir, artifacts, checks, execution });
	const compute = buildComputeProviders(workingDir);
	const notebookRecords = readNotebookExecutionRecords(workingDir);
	const activeNotebookRecords = listActiveNotebookExecutionRecords(workingDir);
	const pendingTerminates = readComputePendingTerminateRecords(workingDir);
	const computeJobs = [
		...buildComputeJobsFromNotebookRecords(notebookRecords, activeNotebookRecords, pendingTerminates),
		...buildComputeJobsFromModelEndpointRecords(workingDir),
	].sort((a, b) => b.startedAtMs - a.startedAtMs || a.id.localeCompare(b.id)).slice(0, MAX_COMPUTE_JOBS);
	const computeUsage = buildWorkbenchComputeUsageRecords(computeJobs);
	const computePendingTerminates = buildWorkbenchComputePendingTerminateRecords(pendingTerminates);
	const pollerLeases = buildWorkbenchPollerLeases({ computeJobs, computePendingTerminates });
	const sessionActivity = buildWorkbenchSessionActivity({
		sessions: chatSessions,
		plans,
		computeJobs,
		frameReadCursors,
	});
	const environments = buildNotebookEnvironmentRecords(workingDir, notebookRecords);
	const kernels = buildNotebookKernelRecords(workingDir, notebookRecords);
	const resources = buildWorkbenchSettingsResourceGroups({
		artifacts,
		changelog,
		checks,
		compute,
		execution,
		memories: memory.memories,
		notes: memory.notes,
		plans,
		workingDir,
	});
	const frameSystemPrompts = buildWorkbenchFrameSystemPrompts({ projects, resources, sessions: chatSessions, workingDir });
	return {
		workspacePath: workingDir,
		workspaceName: basename(workingDir),
		...(options.version ? { version: options.version } : {}),
		generatedAt: new Date().toISOString(),
		...(options.modelStatus ? { modelStatus: options.modelStatus } : {}),
		summary: buildWorkbenchSummary(artifacts, projects.length, runs.length, memory.notes.length, claims.length, sessionActivity, transcriptAnnotations.length),
		onboarding: readWorkbenchOnboardingProfile(workingDir),
		projects,
		runs,
		artifacts,
		artifactActions,
		cloudExportTargets,
		artifactVersions,
		artifactAnnotations,
		transcriptAnnotations,
		frameReadCursors,
		memories: memory.memories,
		notes: memory.notes,
		safetyFeedback,
		plans,
		notebook: buildNotebook(artifacts),
		execution,
		checks,
		claims,
		events: sessionActivity.events,
		notifications: sessionActivity.notifications,
		queuedUserMessages: sessionActivity.queuedUserMessages,
		frameSystemPrompts,
		...buildWorkbenchStateLedgers({ artifacts, artifactVersions, authPath: options.authPath, chatSessions, compute, execution, projects, resources, runs, workingDir }),
		sessionSeenMarks: sessionActivity.sessionSeenMarks,
		sessionActivity: sessionActivity.sessionActivity,
		compute,
		computeJobs,
		computeUsage,
		computePendingTerminates,
		pollerLeases,
		environments,
		kernels,
		resources,
		provenance: buildProvenanceRecords(workingDir, artifacts, changelog),
		changelog,
	};
}

function isAllowedWorkbenchPath(relPath: string): boolean {
	return ARTIFACT_ROOTS.some((root) => relPath === root || relPath.startsWith(`${root}/`)) || relPath === "CHANGELOG.md";
}

export function resolveWorkbenchPath(workingDir: string, requestedPath: string): { absPath: string; relPath: string } {
	const workspace = resolve(workingDir);
	const cleanedRequest = toPosixPath(requestedPath).replace(/^\/+/, "");
	const absPath = resolve(workspace, cleanedRequest);
	const relPath = toPosixPath(relative(workspace, absPath));
	if (!relPath) throw new Error("Cannot preview the workspace root.");
	if (relPath.startsWith("../") || relPath === ".." || relPath.split("/").includes("..")) {
		throw new Error("Cannot preview files outside the workspace.");
	}
	if (!isAllowedWorkbenchPath(relPath)) {
		throw new Error("Workbench previews are limited to research artifacts and the lab notebook.");
	}
	return { absPath, relPath };
}

export function readWorkbenchFile(workingDir: string, requestedPath: string): WorkbenchFilePreview {
	const { absPath, relPath } = resolveWorkbenchPath(workingDir, requestedPath);
	if (!existsSync(absPath)) throw new Error(`Artifact not found: ${relPath}`);
	const stat = statSync(absPath);
	if (!stat.isFile()) throw new Error(`Artifact is not a file: ${relPath}`);
	if (!isPreviewable(relPath) && relPath !== "CHANGELOG.md") {
		throw new Error("This artifact is not a text preview.");
	}
	const buffer = readFileSync(absPath);
	const truncated = buffer.length > MAX_FILE_READ_BYTES;
	return {
		path: relPath,
		name: basename(relPath),
		category: categoryForArtifact(relPath),
		sizeBytes: stat.size,
		updatedAt: stat.mtime.toISOString(),
		content: buffer.subarray(0, MAX_FILE_READ_BYTES).toString("utf8"),
		truncated,
	};
}

export function readWorkbenchFileDownload(workingDir: string, requestedPath: string): WorkbenchFileDownload {
	const { absPath, relPath } = resolveWorkbenchPath(workingDir, requestedPath);
	if (!existsSync(absPath)) throw new Error(`Artifact not found: ${relPath}`);
	const stat = statSync(absPath);
	if (!stat.isFile()) throw new Error(`Artifact is not a file: ${relPath}`);
	return {
		path: relPath,
		name: basename(relPath),
		category: categoryForArtifact(relPath),
		sizeBytes: stat.size,
		contentType: contentTypeForPath(relPath),
		buffer: readFileSync(absPath),
	};
}
