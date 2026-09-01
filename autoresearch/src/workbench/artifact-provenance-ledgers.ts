import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

import { isInsideDirectory, migratedWorkbenchDataPath, resolveWorkbenchStoredPath } from "./data-root.js";
import { readArtifactSnapshotRecords, type WorkbenchArtifactSnapshotRecord, type WorkbenchArtifactSnapshotState } from "./artifact-snapshots.js";
import type { WorkbenchArtifactDependency, WorkbenchArtifactVersion, WorkbenchContentSnapshot } from "./types.js";

const MAX_INLINE_CONTENT_BYTES = 64 * 1024;

function stableUuid(namespace: string, value: string): string {
	const bytes = createHash("sha256").update(`${namespace}:${value}`).digest().subarray(0, 16);
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function toPosixPath(path: string): string {
	return path.split(sep).join("/");
}

function snapshotFile(workingDir: string, snapshotPath: string): string | undefined {
	const workspace = resolve(workingDir);
	const absPath = resolveWorkbenchStoredPath(workspace, snapshotPath);
	const snapshotRoot = migratedWorkbenchDataPath(workspace, "artifact-snapshots", "files");
	if (isInsideDirectory(snapshotRoot, absPath)) return absPath;
	const rel = toPosixPath(relative(workspace, absPath));
	if (!rel || rel === ".." || rel.startsWith("../") || rel.split("/").includes("..")) return undefined;
	if (!rel.startsWith(".feynman/workbench/artifact-snapshots/files/")) return undefined;
	return absPath;
}

function contentHash(buffer: Buffer): string {
	return createHash("sha256").update(buffer).digest("hex");
}

function snapshotRowFromState(
	workingDir: string,
	record: WorkbenchArtifactSnapshotRecord,
	state: WorkbenchArtifactSnapshotState,
	stateKind: "after" | "before",
): WorkbenchContentSnapshot | undefined {
	if (!state.snapshotPath) return undefined;
	const absPath = snapshotFile(workingDir, state.snapshotPath);
	if (!absPath || !existsSync(absPath)) return undefined;
	const stats = statSync(absPath);
	if (!stats.isFile()) return undefined;
	const buffer = readFileSync(absPath);
	const hash = state.checksum ?? contentHash(buffer);
	const sizeBytes = state.sizeBytes ?? stats.size;
	const truncated = sizeBytes > MAX_INLINE_CONTENT_BYTES;
	return {
		hash,
		content: truncated ? buffer.subarray(0, MAX_INLINE_CONTENT_BYTES).toString("utf8") : buffer.toString("utf8"),
		sizeBytes,
		createdAt: record.createdAt,
		createdAtMs: record.createdAtMs,
		contentTruncated: truncated,
		snapshotPath: state.snapshotPath,
		artifactPath: record.artifactPath,
		snapshotId: record.id,
		stateKind,
	};
}

export function buildWorkbenchContentSnapshots(workingDir: string): WorkbenchContentSnapshot[] {
	const byHash = new Map<string, WorkbenchContentSnapshot>();
	for (const record of readArtifactSnapshotRecords(workingDir)) {
		for (const stateKind of ["before", "after"] as const) {
			const row = snapshotRowFromState(workingDir, record, record[stateKind], stateKind);
			if (!row) continue;
			const existing = byHash.get(row.hash);
			if (!existing || row.createdAtMs < existing.createdAtMs) byHash.set(row.hash, row);
		}
	}
	return [...byHash.values()].sort((a, b) => b.createdAtMs - a.createdAtMs || a.hash.localeCompare(b.hash));
}

function versionsByArtifact(versions: WorkbenchArtifactVersion[]): Map<string, WorkbenchArtifactVersion[]> {
	const byArtifact = new Map<string, WorkbenchArtifactVersion[]>();
	for (const version of versions) {
		const list = byArtifact.get(version.artifactPath) ?? [];
		list.push(version);
		byArtifact.set(version.artifactPath, list);
	}
	for (const list of byArtifact.values()) {
		list.sort((a, b) => a.createdAtMs - b.createdAtMs || a.versionNumber - b.versionNumber || a.id.localeCompare(b.id));
	}
	return byArtifact;
}

function dependencyTarget(versions: WorkbenchArtifactVersion[] | undefined, dependent: WorkbenchArtifactVersion): WorkbenchArtifactVersion | undefined {
	if (!versions?.length) return undefined;
	const before = versions.filter((version) => version.createdAtMs <= dependent.createdAtMs);
	return before.at(-1) ?? versions[0];
}

export function buildWorkbenchArtifactDependencies(versions: WorkbenchArtifactVersion[]): WorkbenchArtifactDependency[] {
	const byArtifact = versionsByArtifact(versions);
	const seen = new Set<string>();
	const dependencies: WorkbenchArtifactDependency[] = [];
	for (const version of versions) {
		for (const inputPath of version.inputPaths) {
			if (inputPath === version.artifactPath) continue;
			const target = dependencyTarget(byArtifact.get(inputPath), version);
			if (!target) continue;
			const pair = `${version.id}:${target.id}`;
			if (seen.has(pair)) continue;
			seen.add(pair);
			dependencies.push({
				id: stableUuid("feynman-artifact-dependency", pair),
				artifactVersionId: version.id,
				dependsOnVersionId: target.id,
				referenceName: inputPath,
				createdAt: version.createdAt,
				createdAtMs: version.createdAtMs,
			});
		}
	}
	return dependencies.sort((a, b) => b.createdAtMs - a.createdAtMs || a.artifactVersionId.localeCompare(b.artifactVersionId) || a.dependsOnVersionId.localeCompare(b.dependsOnVersionId));
}
