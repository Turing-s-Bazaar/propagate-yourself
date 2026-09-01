import { createHash } from "node:crypto";

import type { WorkbenchArtifact, WorkbenchArtifactFolder, WorkbenchProject, WorkbenchRun } from "./types.js";

function stableUuid(namespace: string, value: string): string {
	const bytes = createHash("sha256").update(`${namespace}:${value}`).digest().subarray(0, 16);
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function timestampMs(value: string): number {
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function userUploadsFolder(project: WorkbenchProject): WorkbenchArtifactFolder {
	return {
		id: stableUuid("feynman-artifact-folder", `${project.id}:user-uploads`),
		projectId: project.id,
		name: "User Uploads",
		sortOrder: -1000,
		isConversationFolder: false,
		isUserUploadsFolder: true,
		createdAt: project.updatedAt,
		createdAtMs: timestampMs(project.updatedAt),
		updatedAt: project.updatedAt,
		updatedAtMs: project.updatedAtMs,
	};
}

function runArtifactCount(run: WorkbenchRun, artifactsBySlug: Map<string, number>): number {
	return run.artifactCount || artifactsBySlug.get(run.slug) || 0;
}

function conversationFolder(project: WorkbenchProject, run: WorkbenchRun, sortOrder: number, artifactsBySlug: Map<string, number>): WorkbenchArtifactFolder {
	return {
		id: stableUuid("feynman-artifact-folder", `${project.id}:run:${run.slug}`),
		projectId: project.id,
		name: run.title,
		sortOrder,
		rootFrameId: run.slug,
		isConversationFolder: true,
		isUserUploadsFolder: false,
		artifactCount: runArtifactCount(run, artifactsBySlug),
		createdAt: run.updatedAt,
		createdAtMs: run.updatedAtMs,
		updatedAt: run.updatedAt,
		updatedAtMs: run.updatedAtMs,
	};
}

export function buildWorkbenchArtifactFolders({
	artifacts,
	projects,
	runs,
}: {
	artifacts: WorkbenchArtifact[];
	projects: WorkbenchProject[];
	runs: WorkbenchRun[];
}): WorkbenchArtifactFolder[] {
	const runsBySlug = new Map(runs.map((run) => [run.slug, run]));
	const artifactsBySlug = new Map<string, number>();
	for (const artifact of artifacts) {
		artifactsBySlug.set(artifact.slug, (artifactsBySlug.get(artifact.slug) ?? 0) + 1);
	}
	return projects
		.flatMap((project) => {
			const folders: WorkbenchArtifactFolder[] = [userUploadsFolder(project)];
			project.runSlugs.forEach((slug, index) => {
				const run = runsBySlug.get(slug);
				if (run) folders.push(conversationFolder(project, run, index, artifactsBySlug));
			});
			return folders;
		})
		.sort((a, b) =>
			a.projectId.localeCompare(b.projectId) ||
			a.sortOrder - b.sortOrder ||
			a.name.localeCompare(b.name) ||
			a.id.localeCompare(b.id)
		);
}
