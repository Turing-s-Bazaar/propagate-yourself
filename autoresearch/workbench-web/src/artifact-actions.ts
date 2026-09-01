import type {
	ArtifactEditResult,
	ArtifactVersionDiff,
	ArtifactVersionRestore,
	EditableArtifact,
	WorkbenchArtifact,
	WorkbenchArtifactActionItem,
	WorkbenchCloudExportRecord,
	WorkbenchCloudExportTarget,
	WorkbenchArtifactVersion,
	WorkbenchState,
} from "./types.js";
import {
	artifactClaimsForPath,
	artifactChecksForPath,
	artifactExecutionsForPath,
	artifactPreviewKind,
	artifactVersionsForPath,
} from "./artifacts.js";
import { workbenchProjectPath } from "./routes.js";

export type ArtifactMutationAction = "delete" | "hide" | "rename" | "restore" | "star" | "unhide" | "unstar";

export type ArtifactEditReadPayload = {
	artifact: EditableArtifact;
};

export type ArtifactEditSavePayload = {
	edit: ArtifactEditResult;
	state: WorkbenchState;
};

export type ArtifactVersionDiffPayload = {
	diff: ArtifactVersionDiff;
};

export type ArtifactVersionRestorePayload = {
	restore: ArtifactVersionRestore;
	state: WorkbenchState;
};

export type ArtifactActionPayload = {
	action: {
		artifactPath: string;
		displayName?: string;
		starred: boolean;
		hidden: boolean;
		deleted: boolean;
		updatedAt: string;
		updatedAtMs: number;
	};
	state: WorkbenchState;
};

export type ArtifactCloudExportPayload = {
	export: WorkbenchCloudExportRecord;
	state: WorkbenchState;
};

export function artifactEditDisabledReason(artifact: WorkbenchArtifact): string {
	const kind = artifactPreviewKind(artifact);
	if (!artifact.previewable) return "This artifact does not have a text preview.";
	if (kind === "image" || kind === "pdf") return "This artifact type is viewed as media.";
	if (artifact.sizeBytes > 2 * 1024 * 1024) return "This artifact is too large for inline editing.";
	return "";
}

export function artifactCanEditContent(artifact: WorkbenchArtifact): boolean {
	return !artifactEditDisabledReason(artifact);
}

export function artifactEditReadPath(artifactPath: string): string {
	return `/api/artifact/edit?path=${encodeURIComponent(artifactPath)}`;
}

export function artifactVersionActionBody(version: WorkbenchArtifactVersion): { artifactPath: string; versionId: string } {
	return {
		artifactPath: version.artifactPath,
		versionId: version.id,
	};
}

export function versionActionKey(version: Pick<WorkbenchArtifactVersion, "artifactPath" | "id">): string {
	return `${version.artifactPath}::${version.id}`;
}

export function artifactMutationBody(
	artifactPath: string,
	action: ArtifactMutationAction,
	displayName?: string,
): { artifactPath: string; action: ArtifactMutationAction; displayName?: string } {
	return {
		artifactPath,
		action,
		...(displayName?.trim() ? { displayName: displayName.trim() } : {}),
	};
}

export function artifactRecoveryAction(item: WorkbenchArtifactActionItem): Extract<ArtifactMutationAction, "restore" | "unhide"> {
	return item.deleted ? "restore" : "unhide";
}

export function artifactRecoveryLabel(item: WorkbenchArtifactActionItem): string {
	return item.deleted ? "Restore" : "Unhide";
}

export function configuredCloudExportTarget(targets: WorkbenchCloudExportTarget[]): WorkbenchCloudExportTarget | null {
	return targets.find((target) => target.status === "configured") ?? null;
}

export function cloudExportBody(
	artifactPath: string,
	target: WorkbenchCloudExportTarget,
	destinationPath?: string,
): { artifactPath: string; credentialId: string; destinationPath?: string } {
	return {
		artifactPath,
		credentialId: target.id,
		...(destinationPath?.trim() ? { destinationPath: destinationPath.trim() } : {}),
	};
}

export function artifactReferenceUrl(
	artifact: WorkbenchArtifact,
	projectId: string,
	origin: string,
	currentPathname: string,
): string {
	const path = workbenchProjectPath(projectId, artifact.slug, currentPathname);
	return `${origin}${path}?artifact=${encodeURIComponent(artifact.path)}`;
}

export function artifactMetadataFilename(artifact: WorkbenchArtifact): string {
	const baseName = artifact.name || artifact.path.split("/").at(-1) || "artifact";
	return `${baseName}.metadata.json`;
}

export function artifactMetadataPayload(
	artifact: WorkbenchArtifact,
	state: WorkbenchState,
	preview?: { content?: string; error?: string; truncated?: boolean } | null,
	link?: string,
): Record<string, unknown> {
	const run = state.runs.find((item) => item.slug === artifact.slug);
	return {
		artifact: {
			path: artifact.path,
			name: artifact.name,
			title: artifact.title,
			displayName: artifact.displayName,
			category: artifact.category,
			contentType: artifact.contentType,
			extension: artifact.extension,
			sizeBytes: artifact.sizeBytes,
			updatedAt: artifact.updatedAt,
			starred: Boolean(artifact.starred),
		},
		session: run ? {
			slug: run.slug,
			title: run.title,
			status: run.status,
			taskSummary: run.taskSummary,
		} : undefined,
		execution: artifactExecutionsForPath(state, artifact.path).map((record) => ({
			id: record.id,
			title: record.title,
			kind: record.kind,
			status: record.status,
			origin: record.origin,
			environment: record.environment,
			language: record.language,
			createdAt: record.createdAt,
			inputPaths: record.inputPaths ?? [],
			outputPaths: record.outputPaths ?? [],
			sourceId: record.sourceId,
		})),
		versions: artifactVersionsForPath(state, artifact.path).map((version) => ({
			id: version.id,
			versionNumber: version.versionNumber,
			source: version.source,
			contentType: version.contentType,
			sizeBytes: version.sizeBytes,
			checksum: version.checksum,
			createdAt: version.createdAt,
			parentVersionId: version.parentVersionId,
			producerExecutionId: version.producerExecutionId,
			agentName: version.agentName,
			language: version.language,
			snapshotId: version.snapshotId,
			snapshotPath: version.snapshotPath,
			previousSnapshotPath: version.previousSnapshotPath,
			previousChecksum: version.previousChecksum,
			previousSizeBytes: version.previousSizeBytes,
			contentChanged: Boolean(version.contentChanged),
			inputPaths: version.inputPaths ?? [],
			outputPaths: version.outputPaths ?? [],
			isCheckpoint: Boolean(version.isCheckpoint),
			isIntermediate: Boolean(version.isIntermediate),
		})),
		annotations: state.artifactAnnotations
			.filter((annotation) => annotation.artifactPath === artifact.path)
			.map((annotation) => ({
				id: annotation.id,
				kind: annotation.kind,
				anchorKind: annotation.anchorKind,
				body: annotation.body,
				anchorText: annotation.anchorText,
				pageNumber: annotation.pageNumber,
				xPercent: annotation.xPercent,
				yPercent: annotation.yPercent,
				widthPercent: annotation.widthPercent,
				heightPercent: annotation.heightPercent,
				rects: annotation.rects,
				updatedAt: annotation.updatedAt,
			})),
		checks: artifactChecksForPath(state, artifact.path).map((check) => ({
			id: check.id,
			claimId: check.claimId,
			title: check.title,
			status: check.status,
			claim: check.claim,
			detail: check.detail,
			createdAt: check.createdAt,
		})),
		claims: artifactClaimsForPath(state, artifact.path).map((claim) => ({
			id: claim.id,
			claim: claim.claim,
			status: claim.status,
			source: claim.source,
			sourceTitle: claim.sourceTitle,
			checkIds: claim.checkIds,
			evidencePaths: claim.evidencePaths,
			createdAt: claim.createdAt,
		})),
		preview: preview?.error ? { error: preview.error } : {
			truncated: Boolean(preview?.truncated),
			contentLength: typeof preview?.content === "string" ? preview.content.length : undefined,
		},
		link,
	};
}
