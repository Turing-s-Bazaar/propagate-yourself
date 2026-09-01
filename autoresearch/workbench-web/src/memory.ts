import type {
	WorkbenchArtifact,
	WorkbenchMemoryRecord,
	WorkbenchNoteRecord,
	WorkbenchProject,
	WorkbenchRun,
} from "./types.js";

export type MemoryScopeFilter = "all" | "artifact" | "category" | "profile" | "project" | "session";

export function memoriesForScope(
	memories: WorkbenchMemoryRecord[],
	scope: MemoryScopeFilter,
	project?: WorkbenchProject | null,
	run?: WorkbenchRun | null,
	artifact?: WorkbenchArtifact | null,
): WorkbenchMemoryRecord[] {
	return memories
		.filter((memory) => {
			if (scope !== "all" && memory.scope !== scope) return false;
			if (memory.scope === "project") return !project || memory.projectId === project.id;
			if (memory.scope === "session") return !run || memory.sessionId === run.slug;
			if (memory.scope === "artifact") return !artifact || memory.artifactPath === artifact.path;
			return true;
		})
		.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function notesForTarget(
	notes: WorkbenchNoteRecord[],
	run?: WorkbenchRun | null,
	artifact?: WorkbenchArtifact | null,
): WorkbenchNoteRecord[] {
	return notes
		.filter((note) => {
			if (artifact && note.targetType === "artifact") return note.targetArtifactPath === artifact.path;
			if (!artifact && run) return note.targetType === "session" && note.targetFrameId === run.slug;
			return true;
		})
		.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function defaultMemoryScope(project?: WorkbenchProject | null, run?: WorkbenchRun | null, artifact?: WorkbenchArtifact | null): MemoryScopeFilter {
	if (artifact) return "artifact";
	if (run) return "session";
	if (project) return "project";
	return "profile";
}

export function memoryScopeLabel(scope: MemoryScopeFilter): string {
	if (scope === "all") return "All";
	if (scope === "artifact") return "Artifact";
	if (scope === "category") return "Category";
	if (scope === "project") return "Project";
	if (scope === "session") return "Session";
	return "About you";
}
