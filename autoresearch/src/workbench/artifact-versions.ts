import { closeSync, openSync, readSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

import type {
	WorkbenchArtifact,
	WorkbenchArtifactAnnotation,
	WorkbenchArtifactVersion,
	WorkbenchArtifactVersionSource,
	WorkbenchExecutionRecord,
} from "./types.js";
import {
	readArtifactSnapshotRecords,
	type WorkbenchArtifactSnapshotRecord,
} from "./artifact-snapshots.js";

const HASH_BUFFER_BYTES = 64 * 1024;

type VersionSourceEvent = {
	createdAtMs: number;
	id: string;
	record?: WorkbenchExecutionRecord;
	snapshot?: WorkbenchArtifactSnapshotRecord;
};

function fileSha256(absPath: string): string | undefined {
	let fd: number | undefined;
	try {
		fd = openSync(absPath, "r");
		const hash = createHash("sha256");
		const buffer = Buffer.allocUnsafe(HASH_BUFFER_BYTES);
		for (;;) {
			const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
			if (bytesRead === 0) break;
			hash.update(buffer.subarray(0, bytesRead));
		}
		return hash.digest("hex");
	} catch {
		return undefined;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

function versionSource(record: WorkbenchExecutionRecord | undefined): WorkbenchArtifactVersionSource {
	if (!record) return "workspace";
	if (record.id.startsWith("notebook:")) return "notebook";
	if (record.origin === "chat") return "chat";
	if (record.origin === "pi") return "pi";
	return "workspace";
}

function agentNameForSource(source: WorkbenchArtifactVersionSource): string {
	if (source === "notebook") return "Feynman notebook";
	if (source === "pi") return "Pi";
	if (source === "chat") return "Feynman chat";
	return "Local workspace";
}

function versionIdFor(artifact: WorkbenchArtifact, record: WorkbenchExecutionRecord | undefined, versionNumber: number): string {
	const sourceId = record?.id ?? "workspace-scan";
	const safe = `${artifact.path}:${sourceId}:${versionNumber}`
		.toLowerCase()
		.replace(/[^a-z0-9._:-]+/g, "-")
		.slice(0, 180);
	return `artifact-version:${safe}`;
}

function snapshotVersionIdFor(artifact: WorkbenchArtifact, snapshot: WorkbenchArtifactSnapshotRecord, versionNumber: number): string {
	const safe = `${artifact.path}:snapshot:${snapshot.id}:${versionNumber}`
		.toLowerCase()
		.replace(/[^a-z0-9._:-]+/g, "-")
		.slice(0, 180);
	return `artifact-version:${safe}`;
}

function producerRecordsForArtifact(
	artifact: WorkbenchArtifact,
	execution: WorkbenchExecutionRecord[],
): WorkbenchExecutionRecord[] {
	return execution
		.filter((record) =>
			record.id !== `artifact:${artifact.path}` &&
			(record.outputPaths || []).includes(artifact.path)
		)
		.sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id));
}

function versionFromRecord(
	artifact: WorkbenchArtifact,
	record: WorkbenchExecutionRecord | undefined,
	versionNumber: number,
	parentVersionId: string | undefined,
	checksum: string | undefined,
	annotations: WorkbenchArtifactAnnotation[],
): WorkbenchArtifactVersion {
	const source = versionSource(record);
	const outputPaths = record?.outputPaths?.length ? record.outputPaths : [artifact.path];
	return {
		id: versionIdFor(artifact, record, versionNumber),
		artifactPath: artifact.path,
		versionNumber,
		label: `v${versionNumber}`,
		source,
		contentType: artifact.contentType,
		sizeBytes: artifact.sizeBytes,
		...(checksum ? { checksum } : {}),
		createdAt: record?.createdAt ?? artifact.updatedAt,
		createdAtMs: record?.createdAtMs ?? artifact.updatedAtMs,
		...(parentVersionId ? { parentVersionId } : {}),
		...(record ? { producerExecutionId: record.id } : {}),
		...(record?.sourceId ? { producerSourceId: record.sourceId } : {}),
		agentName: agentNameForSource(source),
		...(record?.language ? { language: record.language } : {}),
		...(record?.code ? { code: record.code } : {}),
		...(record?.detail ? { codeDescription: record.detail } : {}),
		messages: record?.messages ?? [],
		...(record?.environment ? { environment: record.environment } : {}),
		...(record?.details ? { environmentDetails: record.details } : {}),
		inputPaths: (record?.inputPaths ?? []).filter((path) => path !== artifact.path),
		outputPaths,
		isIntermediate: artifact.category === "data",
		isCheckpoint: record?.purpose === "verification" || artifact.category === "verification",
		annotations,
	};
}

function versionFromSnapshot(
	artifact: WorkbenchArtifact,
	snapshot: WorkbenchArtifactSnapshotRecord,
	record: WorkbenchExecutionRecord | undefined,
	versionNumber: number,
	parentVersionId: string | undefined,
	annotations: WorkbenchArtifactAnnotation[],
): WorkbenchArtifactVersion {
	const source: WorkbenchArtifactVersionSource = snapshot.source;
	const outputPaths = record?.outputPaths?.length ? record.outputPaths : [artifact.path];
	return {
		id: snapshotVersionIdFor(artifact, snapshot, versionNumber),
		artifactPath: artifact.path,
		versionNumber,
		label: `v${versionNumber}`,
		source,
		contentType: artifact.contentType,
		sizeBytes: snapshot.after.sizeBytes ?? artifact.sizeBytes,
		...(snapshot.after.checksum ? { checksum: snapshot.after.checksum } : {}),
		createdAt: snapshot.createdAt,
		createdAtMs: snapshot.createdAtMs,
		...(parentVersionId ? { parentVersionId } : {}),
		...(snapshot.producerExecutionId ? { producerExecutionId: snapshot.producerExecutionId } : {}),
		...(snapshot.producerSourceId ? { producerSourceId: snapshot.producerSourceId } : record?.sourceId ? { producerSourceId: record.sourceId } : {}),
		agentName: agentNameForSource(source),
		...(record?.language ? { language: record.language } : {}),
		...(record?.code ? { code: record.code } : {}),
		...(record?.detail ? { codeDescription: record.detail } : {}),
		messages: record?.messages ?? [],
		...(record?.environment ? { environment: record.environment } : {}),
		...(record?.details ? { environmentDetails: record.details } : {}),
		inputPaths: (record?.inputPaths ?? []).filter((path) => path !== artifact.path),
		outputPaths,
		isIntermediate: artifact.category === "data",
		isCheckpoint: record?.purpose === "verification" || artifact.category === "verification",
		annotations,
		snapshotId: snapshot.id,
		...(snapshot.after.snapshotPath ? { snapshotPath: snapshot.after.snapshotPath } : {}),
		...(snapshot.before.snapshotPath ? { previousSnapshotPath: snapshot.before.snapshotPath } : {}),
		...(snapshot.before.checksum ? { previousChecksum: snapshot.before.checksum } : {}),
		...(snapshot.before.sizeBytes !== undefined ? { previousSizeBytes: snapshot.before.sizeBytes } : {}),
		contentChanged: snapshot.contentChanged,
	};
}

export function buildArtifactVersions(
	workingDir: string,
	artifacts: WorkbenchArtifact[],
	execution: WorkbenchExecutionRecord[],
	artifactAnnotations: WorkbenchArtifactAnnotation[] = [],
): WorkbenchArtifactVersion[] {
	const versions: WorkbenchArtifactVersion[] = [];
	const annotationsByArtifact = new Map<string, WorkbenchArtifactAnnotation[]>();
	for (const annotation of artifactAnnotations) {
		const list = annotationsByArtifact.get(annotation.artifactPath) ?? [];
		list.push(annotation);
		annotationsByArtifact.set(annotation.artifactPath, list);
	}
	const snapshotsByArtifact = new Map<string, WorkbenchArtifactSnapshotRecord[]>();
	for (const snapshot of readArtifactSnapshotRecords(workingDir)) {
		if (!snapshot.after.existed) continue;
		const list = snapshotsByArtifact.get(snapshot.artifactPath) ?? [];
		list.push(snapshot);
		snapshotsByArtifact.set(snapshot.artifactPath, list);
	}
	const executionById = new Map(execution.map((record) => [record.id, record]));
	for (const artifact of artifacts) {
		const checksum = fileSha256(resolve(workingDir, artifact.path));
		const annotations = annotationsByArtifact.get(artifact.path) ?? [];
		const producers = producerRecordsForArtifact(artifact, execution);
		const snapshots = snapshotsByArtifact.get(artifact.path) ?? [];
		const snapshotProducerIds = new Set(snapshots.flatMap((snapshot) => snapshot.producerExecutionId ? [snapshot.producerExecutionId] : []));
		let parentVersionId: string | undefined;
		const sourceRecords = producers.filter((record) => !snapshotProducerIds.has(record.id));
		const sourceEvents: VersionSourceEvent[] = [
			...snapshots.map((snapshot) => ({
				createdAtMs: snapshot.createdAtMs,
				id: snapshot.id,
				snapshot,
				record: snapshot.producerExecutionId ? executionById.get(snapshot.producerExecutionId) : undefined,
			})),
			...sourceRecords.map((record) => ({
				createdAtMs: record.createdAtMs,
				id: record.id,
				record,
			})),
		].sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id));
		if (!sourceEvents.length) sourceEvents.push({ createdAtMs: artifact.updatedAtMs, id: "workspace-scan" });
		for (let index = 0; index < sourceEvents.length; index += 1) {
			const event = sourceEvents[index]!;
			const version = event.snapshot
				? versionFromSnapshot(artifact, event.snapshot, event.record, index + 1, parentVersionId, annotations)
				: versionFromRecord(artifact, event.record, index + 1, parentVersionId, checksum, annotations);
			versions.push(version);
			parentVersionId = version.id;
		}
	}
	return versions.sort((a, b) => b.createdAtMs - a.createdAtMs || a.artifactPath.localeCompare(b.artifactPath) || b.versionNumber - a.versionNumber);
}
