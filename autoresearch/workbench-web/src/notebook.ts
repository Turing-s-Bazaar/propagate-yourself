import type {
	WorkbenchComputeJobRecord,
	WorkbenchNotebookCell,
	WorkbenchNotebookEnvironmentRecord,
	WorkbenchNotebookKernelRecord,
	WorkbenchRun,
} from "./types.js";

export type NotebookLanguage = "bash" | "python" | "r";
export type NotebookExecutionMode = "isolated" | "modal" | "session";
export type NotebookPurpose = "exploration" | "verification";
export type ComputeJobAction = "cancel" | "retry";
export type NotebookEnvironmentLanguage = Extract<NotebookLanguage, "python" | "r">;
export type NotebookEnvironmentMode = "create" | "install";

export function notebookEnvironmentLanguages(): NotebookEnvironmentLanguage[] {
	return ["python", "r"];
}

export function normalizeNotebookPackageInput(value: string): string[] {
	return [...new Set(value.split(/[\s,]+/g).map((item) => item.trim()).filter(Boolean))];
}

export function notebookEnvironmentActionLabel(
	mode: NotebookEnvironmentMode,
	language: NotebookEnvironmentLanguage,
	packages: string[],
): string {
	if (mode === "install") return packages.length ? `Install ${packages.length} ${packages.length === 1 ? "package" : "packages"}` : "Install packages";
	return language === "r" ? "Create R library" : "Create Python env";
}

export function defaultNotebookCode(language: NotebookLanguage): string {
	if (language === "bash") return "printf 'feynman notebook check\\n'";
	if (language === "r") return "print('feynman notebook check')";
	return "print('feynman notebook check')";
}

export function notebookCellsForRun(cells: WorkbenchNotebookCell[], run?: WorkbenchRun): WorkbenchNotebookCell[] {
	return cells
		.filter((cell) => !run || cell.runSlug === run.slug)
		.slice()
		.sort((left, right) => right.updatedAtMs - left.updatedAtMs || left.path.localeCompare(right.path));
}

export function computeJobsForRun(jobs: WorkbenchComputeJobRecord[], run?: WorkbenchRun): WorkbenchComputeJobRecord[] {
	return jobs
		.filter((job) => !run || job.runSlug === run.slug || job.sessionId === run.slug)
		.slice()
		.sort((left, right) => right.startedAtMs - left.startedAtMs || left.id.localeCompare(right.id));
}

export function kernelsForRun(kernels: WorkbenchNotebookKernelRecord[], run?: WorkbenchRun): WorkbenchNotebookKernelRecord[] {
	return kernels
		.filter((kernel) => !run || kernel.runSlug === run.slug || kernel.sessionId === run.slug)
		.slice()
		.sort((left, right) => right.latestExecutionAtMs - left.latestExecutionAtMs || left.id.localeCompare(right.id));
}

export function environmentsByLanguage(environments: WorkbenchNotebookEnvironmentRecord[]): Record<string, WorkbenchNotebookEnvironmentRecord[]> {
	return environments.reduce<Record<string, WorkbenchNotebookEnvironmentRecord[]>>((groups, environment) => {
		const language = environment.language || "runtime";
		groups[language] = [...(groups[language] ?? []), environment];
		return groups;
	}, {});
}

export function computeJobAction(job: WorkbenchComputeJobRecord): ComputeJobAction | "" {
	if (job.status === "running" || job.status === "queued") return "cancel";
	if (job.status === "complete" || job.status === "error" || job.status === "stopped") return "retry";
	return "";
}
