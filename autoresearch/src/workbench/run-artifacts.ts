import { readArtifactSnapshotRecords } from "./artifact-snapshots.js";
import type { WorkbenchArtifact, WorkbenchExecutionRecord, WorkbenchRun } from "./types.js";

export function artifactPriority(artifact: WorkbenchArtifact): number {
	if (artifact.category === "output" && artifact.extension === ".md") return 0;
	if (artifact.category === "paper" && artifact.extension === ".md") return 1;
	if (artifact.category === "paper" && artifact.extension === ".pdf") return 2;
	if (artifact.category === "draft") return 3;
	if (artifact.category === "verification") return 4;
	if (artifact.category === "provenance") return 5;
	if (artifact.category === "plan") return 6;
	return 7;
}

export function runOwnsArtifact(run: WorkbenchRun, artifact: WorkbenchArtifact): boolean {
	return artifact.slug === run.slug || Boolean(run.artifactPaths?.includes(artifact.path));
}

export function augmentRunsWithExecutionArtifacts(
	workingDir: string,
	runs: WorkbenchRun[],
	artifacts: WorkbenchArtifact[],
	execution: WorkbenchExecutionRecord[],
): WorkbenchRun[] {
	const artifactsByPath = new Map(artifacts.map((artifact) => [artifact.path, artifact]));
	const snapshots = readArtifactSnapshotRecords(workingDir).filter((snapshot) => artifactsByPath.has(snapshot.artifactPath));
	return runs.map((run) => {
		const paths = new Set(run.artifactPaths ?? []);
		for (const artifact of artifacts) {
			if (artifact.slug === run.slug) paths.add(artifact.path);
		}
		for (const record of execution) {
			if (record.runSlug !== run.slug) continue;
			for (const outputPath of record.outputPaths) {
				if (artifactsByPath.has(outputPath)) paths.add(outputPath);
			}
		}
		for (const snapshot of snapshots) {
			const producerId = snapshot.producerExecutionId ?? "";
			if (producerId.startsWith(`chat:${run.slug}:`) || producerId.startsWith(`tool:${run.slug}:`) || producerId.startsWith(`pi:${run.slug}:`) || producerId.startsWith(`notebook:${run.slug}:`)) {
				paths.add(snapshot.artifactPath);
			}
		}
		const runArtifacts = Array.from(paths)
			.map((path) => artifactsByPath.get(path))
			.filter((artifact): artifact is WorkbenchArtifact => Boolean(artifact))
			.sort((a, b) => artifactPriority(a) - artifactPriority(b) || b.updatedAtMs - a.updatedAtMs);
		if (!runArtifacts.length) return { ...run, artifactPaths: [] };
		const categories = Array.from(new Set(runArtifacts.map((artifact) => artifact.category))).sort();
		const notebookCellCount = runArtifacts.filter((artifact) => artifact.previewable || artifact.category === "paper").length;
		return {
			...run,
			artifactCount: runArtifacts.length,
			artifactPaths: runArtifacts.map((artifact) => artifact.path),
			notebookCellCount: run.notebookCellCount || notebookCellCount,
			categories,
			lastArtifactNames: runArtifacts.slice(0, 4).map((artifact) => artifact.name),
			primaryArtifact: run.primaryArtifact ?? runArtifacts[0],
			hasPlan: run.hasPlan || categories.includes("plan"),
			hasProvenance: run.hasProvenance || categories.includes("provenance"),
			hasVerification: run.hasVerification || categories.includes("verification"),
		};
	});
}
