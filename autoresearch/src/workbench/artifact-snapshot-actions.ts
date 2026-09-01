import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

import {
	captureArtifactSnapshotBaseline,
	recordArtifactSnapshotsForChanges,
	type WorkbenchArtifactSnapshotRecord,
} from "./artifact-snapshots.js";
import { isInsideDirectory, migratedWorkbenchDataPath, resolveWorkbenchStoredPath } from "./data-root.js";
import type { WorkbenchArtifactVersion } from "./types.js";

export type WorkbenchArtifactSnapshotDiffLineKind = "add" | "context" | "remove";

export type WorkbenchArtifactSnapshotDiffLine = {
	kind: WorkbenchArtifactSnapshotDiffLineKind;
	text: string;
	oldLine?: number;
	newLine?: number;
};

export type WorkbenchArtifactSnapshotDiff = {
	artifactPath: string;
	versionId: string;
	previousSnapshotPath?: string;
	snapshotPath: string;
	isText: boolean;
	truncated: boolean;
	addedLines: number;
	removedLines: number;
	contextLines: number;
	lines: WorkbenchArtifactSnapshotDiffLine[];
};

export type WorkbenchArtifactSnapshotRestoreResult = {
	artifactPath: string;
	versionId: string;
	snapshotPath: string;
	bytesWritten: number;
	checksum: string;
	snapshotRecords: WorkbenchArtifactSnapshotRecord[];
};

const SNAPSHOT_FILES_DIR = ".feynman/workbench/artifact-snapshots/files";
const TRACKED_ROOTS = ["outputs", "papers", "notes"];
const MAX_DIFF_BYTES = 1_000_000;
const MAX_DIFF_LINES = 600;
const LOOKAHEAD_LINES = 24;

function toPosixPath(path: string): string {
	return path.split(sep).join("/");
}

function sha256(buffer: Buffer): string {
	return createHash("sha256").update(buffer).digest("hex");
}

function ensureInside(baseDir: string, candidate: string, label: string): string {
	const base = resolve(baseDir);
	const absolutePath = resolve(base, candidate);
	const rel = toPosixPath(relative(base, absolutePath));
	if (!rel || rel === ".." || rel.startsWith("../") || rel.split("/").includes("..")) {
		throw new Error(`${label} must stay inside the workbench workspace.`);
	}
	return absolutePath;
}

function normalizeArtifactPath(workingDir: string, artifactPath: string): string {
	const workspace = resolve(workingDir);
	const absolutePath = ensureInside(workspace, artifactPath, "Artifact path");
	const rel = toPosixPath(relative(workspace, absolutePath));
	if (!TRACKED_ROOTS.some((root) => rel === root || rel.startsWith(`${root}/`))) {
		throw new Error("Artifact path must be under outputs, papers, or notes.");
	}
	return rel;
}

function snapshotFilesDir(workingDir: string): string {
	return migratedWorkbenchDataPath(workingDir, "artifact-snapshots", "files");
}

function resolveSnapshotFile(workingDir: string, snapshotPath: string): string {
	const workspace = resolve(workingDir);
	const absolutePath = resolveWorkbenchStoredPath(workspace, snapshotPath);
	const snapshotRoot = snapshotFilesDir(workspace);
	const legacyAbsolutePath = resolve(workspace, snapshotPath);
	const legacySnapshotRoot = resolve(workspace, SNAPSHOT_FILES_DIR);
	if (!isInsideDirectory(snapshotRoot, absolutePath) && !isInsideDirectory(legacySnapshotRoot, legacyAbsolutePath)) {
		throw new Error("Snapshot path must reference a saved artifact snapshot.");
	}
	const resolvedPath = isInsideDirectory(snapshotRoot, absolutePath) ? absolutePath : legacyAbsolutePath;
	if (!existsSync(resolvedPath) || !statSync(resolvedPath).isFile()) {
		throw new Error("Snapshot content is missing.");
	}
	return resolvedPath;
}

function readSnapshotBuffer(workingDir: string, snapshotPath: string): Buffer {
	return readFileSync(resolveSnapshotFile(workingDir, snapshotPath));
}

function isBinary(buffer: Buffer): boolean {
	return buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0);
}

function splitTextLines(buffer: Buffer): { lines: string[]; truncated: boolean } {
	const truncated = buffer.length > MAX_DIFF_BYTES;
	const slice = truncated ? buffer.subarray(0, MAX_DIFF_BYTES) : buffer;
	const lines = slice.toString("utf8").replace(/\r\n/g, "\n").split("\n");
	return {
		lines: lines.slice(0, MAX_DIFF_LINES),
		truncated: truncated || lines.length > MAX_DIFF_LINES,
	};
}

function pushLine(
	lines: WorkbenchArtifactSnapshotDiffLine[],
	kind: WorkbenchArtifactSnapshotDiffLineKind,
	text: string,
	oldLine: number | undefined,
	newLine: number | undefined,
): void {
	lines.push({
		kind,
		text,
		...(oldLine !== undefined ? { oldLine } : {}),
		...(newLine !== undefined ? { newLine } : {}),
	});
}

function findNext(lines: string[], needle: string, start: number): number {
	const end = Math.min(lines.length, start + LOOKAHEAD_LINES);
	for (let index = start; index < end; index += 1) {
		if (lines[index] === needle) return index;
	}
	return -1;
}

function buildLineDiff(previousLines: string[], nextLines: string[]): WorkbenchArtifactSnapshotDiffLine[] {
	const diff: WorkbenchArtifactSnapshotDiffLine[] = [];
	let oldIndex = 0;
	let newIndex = 0;
	while (oldIndex < previousLines.length || newIndex < nextLines.length) {
		const oldText = previousLines[oldIndex];
		const newText = nextLines[newIndex];
		if (oldText !== undefined && newText !== undefined && oldText === newText) {
			pushLine(diff, "context", oldText, oldIndex + 1, newIndex + 1);
			oldIndex += 1;
			newIndex += 1;
			continue;
		}
		if (newText !== undefined) {
			const nextOldMatch = findNext(previousLines, newText, oldIndex + 1);
			if (nextOldMatch !== -1) {
				while (oldIndex < nextOldMatch) {
					pushLine(diff, "remove", previousLines[oldIndex] ?? "", oldIndex + 1, undefined);
					oldIndex += 1;
				}
				continue;
			}
		}
		if (oldText !== undefined) {
			const nextNewMatch = findNext(nextLines, oldText, newIndex + 1);
			if (nextNewMatch !== -1) {
				while (newIndex < nextNewMatch) {
					pushLine(diff, "add", nextLines[newIndex] ?? "", undefined, newIndex + 1);
					newIndex += 1;
				}
				continue;
			}
		}
		if (oldText !== undefined) {
			pushLine(diff, "remove", oldText, oldIndex + 1, undefined);
			oldIndex += 1;
		}
		if (newText !== undefined) {
			pushLine(diff, "add", newText, undefined, newIndex + 1);
			newIndex += 1;
		}
	}
	return diff;
}

function emptyPreviousDiff(next: Buffer): WorkbenchArtifactSnapshotDiffLine[] {
	const { lines } = splitTextLines(next);
	return lines.map((line, index) => ({
		kind: "add" as const,
		text: line,
		newLine: index + 1,
	}));
}

export function diffArtifactVersionSnapshot(
	workingDir: string,
	version: WorkbenchArtifactVersion,
): WorkbenchArtifactSnapshotDiff {
	const artifactPath = normalizeArtifactPath(workingDir, version.artifactPath);
	if (!version.snapshotPath) {
		throw new Error("Version has no saved snapshot.");
	}
	const nextBuffer = readSnapshotBuffer(workingDir, version.snapshotPath);
	const previousBuffer = version.previousSnapshotPath
		? readSnapshotBuffer(workingDir, version.previousSnapshotPath)
		: Buffer.alloc(0);
	const binary = isBinary(nextBuffer) || isBinary(previousBuffer);
	if (binary) {
		return {
			artifactPath,
			versionId: version.id,
			...(version.previousSnapshotPath ? { previousSnapshotPath: version.previousSnapshotPath } : {}),
			snapshotPath: version.snapshotPath,
			isText: false,
			truncated: false,
			addedLines: 0,
			removedLines: 0,
			contextLines: 0,
			lines: [],
		};
	}
	const previous = splitTextLines(previousBuffer);
	const next = splitTextLines(nextBuffer);
	const lines = version.previousSnapshotPath
		? buildLineDiff(previous.lines, next.lines)
		: emptyPreviousDiff(nextBuffer);
	return {
		artifactPath,
		versionId: version.id,
		...(version.previousSnapshotPath ? { previousSnapshotPath: version.previousSnapshotPath } : {}),
		snapshotPath: version.snapshotPath,
		isText: true,
		truncated: previous.truncated || next.truncated,
		addedLines: lines.filter((line) => line.kind === "add").length,
		removedLines: lines.filter((line) => line.kind === "remove").length,
		contextLines: lines.filter((line) => line.kind === "context").length,
		lines,
	};
}

export function restoreArtifactVersionSnapshot(
	workingDir: string,
	version: WorkbenchArtifactVersion,
): WorkbenchArtifactSnapshotRestoreResult {
	const artifactPath = normalizeArtifactPath(workingDir, version.artifactPath);
	if (!version.snapshotPath) {
		throw new Error("Version has no saved snapshot.");
	}
	const workspace = resolve(workingDir);
	const snapshotContent = readSnapshotBuffer(workspace, version.snapshotPath);
	const artifactAbsolutePath = ensureInside(workspace, artifactPath, "Artifact path");
	const baseline = captureArtifactSnapshotBaseline(workspace, [artifactPath]);
	mkdirSync(dirname(artifactAbsolutePath), { recursive: true });
	writeFileSync(artifactAbsolutePath, snapshotContent);
	const snapshotRecords = recordArtifactSnapshotsForChanges(workspace, baseline, {
		source: "workspace",
		sessionId: "workbench-restore",
		producerExecutionId: `restore:${version.id}`,
		producerSourceId: version.snapshotId ?? version.id,
		paths: [artifactPath],
	});
	return {
		artifactPath,
		versionId: version.id,
		snapshotPath: version.snapshotPath,
		bytesWritten: snapshotContent.length,
		checksum: sha256(snapshotContent),
		snapshotRecords,
	};
}
