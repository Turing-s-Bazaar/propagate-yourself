import type { WorkbenchArtifact, WorkbenchProject, WorkbenchRun, WorkbenchState } from "./types.js";

export type FileBrowserScope = "project" | "run" | "workspace";
export type FileCategoryFilter = "all" | WorkbenchArtifact["category"];

const categoryOrder: WorkbenchArtifact["category"][] = [
	"plan",
	"paper",
	"data",
	"visual",
	"output",
	"verification",
	"provenance",
	"draft",
	"note",
];

export type FileScopeCount = {
	scope: FileBrowserScope;
	count: number;
};

export type FileCategoryCount = {
	category: WorkbenchArtifact["category"];
	count: number;
};

export function fileScopeLabel(scope: FileBrowserScope): string {
	if (scope === "run") return "Run";
	if (scope === "project") return "Project";
	return "Workspace";
}

function sortArtifacts(artifacts: WorkbenchArtifact[]): WorkbenchArtifact[] {
	return artifacts
		.slice()
		.sort((left, right) => right.updatedAtMs - left.updatedAtMs || left.path.localeCompare(right.path));
}

function projectRunSlugs(project?: WorkbenchProject): Set<string> {
	return new Set([
		...(project?.runSlugs ?? []),
		...(project?.primaryRunSlug ? [project.primaryRunSlug] : []),
	]);
}

function projectArtifactPaths(project?: WorkbenchProject): Set<string> {
	return new Set(project?.artifactPaths ?? []);
}

function runOwnsArtifact(run: WorkbenchRun | undefined, artifact: WorkbenchArtifact): boolean {
	return Boolean(run && (artifact.slug === run.slug || run.artifactPaths?.includes(artifact.path)));
}

export function primaryArtifactPathForRun(run: WorkbenchRun | undefined): string | null {
	return run?.primaryArtifact?.path ?? run?.artifactPaths?.[0] ?? null;
}

export function defaultArtifactPathForRun(state: WorkbenchState, run: WorkbenchRun | undefined): string | null {
	const availablePaths = new Set(state.artifacts.map((artifact) => artifact.path));
	const preferredPath = primaryArtifactPathForRun(run);
	if (preferredPath && availablePaths.has(preferredPath)) return preferredPath;
	return run?.artifactPaths?.find((path) => availablePaths.has(path)) ?? null;
}

export function artifactsForFileScope(
	state: WorkbenchState,
	project: WorkbenchProject | undefined,
	run: WorkbenchRun | undefined,
	scope: FileBrowserScope,
): WorkbenchArtifact[] {
	if (scope === "workspace") return sortArtifacts(state.artifacts);
	if (scope === "run") {
		return sortArtifacts(state.artifacts.filter((artifact) => runOwnsArtifact(run, artifact)));
	}
	const slugs = projectRunSlugs(project);
	const paths = projectArtifactPaths(project);
	if (!slugs.size && !paths.size) return [];
	return sortArtifacts(state.artifacts.filter((artifact) => slugs.has(artifact.slug) || paths.has(artifact.path)));
}

export function fileScopeCounts(
	state: WorkbenchState,
	project: WorkbenchProject | undefined,
	run: WorkbenchRun | undefined,
): FileScopeCount[] {
	return [
		{ scope: "run", count: artifactsForFileScope(state, project, run, "run").length },
		{ scope: "project", count: artifactsForFileScope(state, project, run, "project").length },
		{ scope: "workspace", count: state.artifacts.length },
	];
}

export function artifactCategoryCounts(artifacts: WorkbenchArtifact[]): FileCategoryCount[] {
	const counts = new Map<WorkbenchArtifact["category"], number>();
	for (const artifact of artifacts) counts.set(artifact.category, (counts.get(artifact.category) ?? 0) + 1);
	return categoryOrder
		.filter((category) => counts.has(category))
		.map((category) => ({ category, count: counts.get(category) ?? 0 }));
}

export function filterArtifactsForBrowser(
	artifacts: WorkbenchArtifact[],
	query: string,
	category: FileCategoryFilter,
): WorkbenchArtifact[] {
	const normalized = query.trim().toLowerCase();
	return artifacts.filter((artifact) => {
		if (category !== "all" && artifact.category !== category) return false;
		if (!normalized) return true;
		return (
			artifact.displayName?.toLowerCase().includes(normalized) ||
			artifact.title.toLowerCase().includes(normalized) ||
			artifact.name.toLowerCase().includes(normalized) ||
			artifact.path.toLowerCase().includes(normalized) ||
			artifact.category.toLowerCase().includes(normalized) ||
			artifact.slug.toLowerCase().includes(normalized)
		);
	});
}
