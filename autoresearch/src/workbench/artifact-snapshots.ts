import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";

import { migratedWorkbenchDataPath } from "./data-root.js";

export type WorkbenchArtifactSnapshotSource = "chat" | "notebook" | "pi" | "workspace";

export type WorkbenchArtifactSnapshotState = {
	existed: boolean;
	sizeBytes?: number;
	checksum?: string;
	snapshotPath?: string;
};

export type WorkbenchArtifactSnapshotRecord = {
	schema: "feynman.artifactSnapshot.v1";
	id: string;
	artifactPath: string;
	source: WorkbenchArtifactSnapshotSource;
	sessionId: string;
	runSlug?: string;
	producerExecutionId?: string;
	producerSourceId?: string;
	before: WorkbenchArtifactSnapshotState;
	after: WorkbenchArtifactSnapshotState;
	contentChanged: boolean;
	createdAt: string;
	createdAtMs: number;
};

export type WorkbenchArtifactSnapshotBaseline = Map<string, CapturedArtifactState>;

type CapturedArtifactState = WorkbenchArtifactSnapshotState & {
	content?: Buffer;
};

type RecordArtifactSnapshotsOptions = {
	source: WorkbenchArtifactSnapshotSource;
	sessionId: string;
	runSlug?: string;
	producerExecutionId?: string;
	producerSourceId?: string;
	createdAtMs?: number;
	paths?: string[];
};

const SNAPSHOT_SCHEMA = "feynman.artifactSnapshot.v1";
const MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024;
const TRACKED_ROOTS = ["outputs", "papers", "notes"];

function toPosixPath(path: string): string {
	return path.split(sep).join("/");
}

function normalizeArtifactPath(workingDir: string, path: string): string | undefined {
	const workspace = resolve(workingDir);
	const absPath = resolve(workspace, path);
	const rel = toPosixPath(relative(workspace, absPath));
	if (!rel || rel === ".." || rel.startsWith("../") || rel.split("/").includes("..")) return undefined;
	if (!isTrackedArtifactPath(rel)) return undefined;
	return rel;
}

function isTrackedArtifactPath(path: string): boolean {
	return TRACKED_ROOTS.some((root) => path === root || path.startsWith(`${root}/`));
}

function snapshotDir(workingDir: string): string {
	return migratedWorkbenchDataPath(workingDir, "artifact-snapshots");
}

function snapshotLogPath(workingDir: string, sessionId: string): string {
	const safe = sessionId.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workbench";
	return join(snapshotDir(workingDir), `${safe.slice(0, 120)}.jsonl`);
}

function snapshotContentPath(workingDir: string, artifactPath: string, id: string): string {
	const extension = extname(artifactPath).replace(/[^A-Za-z0-9.]+/g, "").slice(0, 16);
	return join(snapshotDir(workingDir), "files", `${id}${extension}`);
}

function relativeSnapshotPath(workingDir: string, absolutePath: string): string {
	return absolutePath;
}

function hashBuffer(buffer: Buffer): string {
	return createHash("sha256").update(buffer).digest("hex");
}

function capturePath(workingDir: string, artifactPath: string): CapturedArtifactState {
	const absPath = resolve(workingDir, artifactPath);
	if (!existsSync(absPath)) return { existed: false };
	const stats = statSync(absPath);
	if (!stats.isFile() || stats.size > MAX_SNAPSHOT_BYTES) {
		return { existed: true, sizeBytes: stats.size };
	}
	const content = readFileSync(absPath);
	return {
		existed: true,
		sizeBytes: stats.size,
		checksum: hashBuffer(content),
		content,
	};
}

function listTrackedArtifactPaths(workingDir: string): string[] {
	const workspace = resolve(workingDir);
	const paths: string[] = [];
	const visit = (directory: string) => {
		if (!existsSync(directory)) return;
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const absolutePath = join(directory, entry.name);
			if (entry.isDirectory()) {
				visit(absolutePath);
				continue;
			}
			if (!entry.isFile()) continue;
			const rel = normalizeArtifactPath(workspace, absolutePath);
			if (rel) paths.push(rel);
		}
	};
	for (const root of TRACKED_ROOTS) visit(resolve(workspace, root));
	return [...new Set(paths)].sort((a, b) => a.localeCompare(b));
}

function normalizedPathSet(workingDir: string, paths: string[] | undefined): string[] {
	const rawPaths = paths?.length ? paths : listTrackedArtifactPaths(workingDir);
	return [...new Set(rawPaths.flatMap((path) => {
		const normalized = normalizeArtifactPath(workingDir, path);
		return normalized ? [normalized] : [];
	}))].sort((a, b) => a.localeCompare(b));
}

export function captureArtifactSnapshotBaseline(
	workingDir: string,
	paths?: string[],
): WorkbenchArtifactSnapshotBaseline {
	const normalized = normalizedPathSet(workingDir, paths);
	const baseline: WorkbenchArtifactSnapshotBaseline = new Map();
	for (const path of normalized) baseline.set(path, capturePath(workingDir, path));
	return baseline;
}

function stateChanged(before: CapturedArtifactState | undefined, after: CapturedArtifactState): boolean {
	if (!before) return after.existed;
	if (before.existed !== after.existed) return true;
	if (!before.existed && !after.existed) return false;
	if (before.checksum && after.checksum) return before.checksum !== after.checksum;
	return before.sizeBytes !== after.sizeBytes;
}

function persistContentSnapshot(
	workingDir: string,
	artifactPath: string,
	state: CapturedArtifactState,
	id: string,
): WorkbenchArtifactSnapshotState {
	const { content, ...publicState } = state;
	if (!state.existed || !content) return publicState;
	const absolutePath = snapshotContentPath(workingDir, artifactPath, id);
	mkdirSync(dirname(absolutePath), { recursive: true });
	writeFileSync(absolutePath, content);
	return {
		...publicState,
		snapshotPath: relativeSnapshotPath(workingDir, absolutePath),
	};
}

export function recordArtifactSnapshotsForChanges(
	workingDir: string,
	baseline: WorkbenchArtifactSnapshotBaseline,
	options: RecordArtifactSnapshotsOptions,
): WorkbenchArtifactSnapshotRecord[] {
	const workspace = resolve(workingDir);
	const paths = normalizedPathSet(workspace, [
		...baseline.keys(),
		...(options.paths ?? listTrackedArtifactPaths(workspace)),
	]);
	const createdAtMs = options.createdAtMs ?? Date.now();
	const createdAt = new Date(createdAtMs).toISOString();
	const records: WorkbenchArtifactSnapshotRecord[] = [];

	for (const artifactPath of paths) {
		const before = baseline.get(artifactPath);
		const after = capturePath(workspace, artifactPath);
		if (!stateChanged(before, after)) continue;
		const id = randomUUID();
		const beforeState = persistContentSnapshot(workspace, artifactPath, before ?? { existed: false }, `${id}-before`);
		const afterState = persistContentSnapshot(workspace, artifactPath, after, `${id}-after`);
		records.push({
			schema: SNAPSHOT_SCHEMA,
			id,
			artifactPath,
			source: options.source,
			sessionId: options.sessionId,
			...(options.runSlug ? { runSlug: options.runSlug } : {}),
			...(options.producerExecutionId ? { producerExecutionId: options.producerExecutionId } : {}),
			...(options.producerSourceId ? { producerSourceId: options.producerSourceId } : {}),
			before: beforeState,
			after: afterState,
			contentChanged: true,
			createdAt,
			createdAtMs,
		});
	}

	if (records.length) {
		const logPath = snapshotLogPath(workspace, options.sessionId);
		mkdirSync(dirname(logPath), { recursive: true });
		for (const record of records) appendFileSync(logPath, `${JSON.stringify(record)}\n`, "utf8");
	}

	return records;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function normalizeState(value: unknown): WorkbenchArtifactSnapshotState | undefined {
	const record = asRecord(value);
	if (!record || typeof record.existed !== "boolean") return undefined;
	return {
		existed: record.existed,
		...(typeof record.sizeBytes === "number" && Number.isFinite(record.sizeBytes) ? { sizeBytes: record.sizeBytes } : {}),
		...(typeof record.checksum === "string" ? { checksum: record.checksum } : {}),
		...(typeof record.snapshotPath === "string" ? { snapshotPath: record.snapshotPath } : {}),
	};
}

function normalizeSnapshotRecord(value: unknown): WorkbenchArtifactSnapshotRecord | undefined {
	const record = asRecord(value);
	if (!record || record.schema !== SNAPSHOT_SCHEMA) return undefined;
	const artifactPath = typeof record.artifactPath === "string" ? record.artifactPath : "";
	const source = record.source === "notebook" || record.source === "pi" || record.source === "workspace"
		? record.source
		: record.source === "chat"
			? "chat"
			: undefined;
	const sessionId = typeof record.sessionId === "string" ? record.sessionId : "";
	const before = normalizeState(record.before);
	const after = normalizeState(record.after);
	const createdAt = typeof record.createdAt === "string" ? record.createdAt : "";
	const createdAtMs = typeof record.createdAtMs === "number" && Number.isFinite(record.createdAtMs)
		? record.createdAtMs
		: Date.parse(createdAt);
	if (!record.id || typeof record.id !== "string" || !artifactPath || !source || !sessionId || !before || !after || !createdAt || !Number.isFinite(createdAtMs)) {
		return undefined;
	}
	return {
		schema: SNAPSHOT_SCHEMA,
		id: record.id,
		artifactPath,
		source,
		sessionId,
		...(typeof record.runSlug === "string" ? { runSlug: record.runSlug } : {}),
		...(typeof record.producerExecutionId === "string" ? { producerExecutionId: record.producerExecutionId } : {}),
		...(typeof record.producerSourceId === "string" ? { producerSourceId: record.producerSourceId } : {}),
		before,
		after,
		contentChanged: record.contentChanged !== false,
		createdAt,
		createdAtMs,
	};
}

export function readArtifactSnapshotRecords(workingDir: string): WorkbenchArtifactSnapshotRecord[] {
	const dir = snapshotDir(resolve(workingDir));
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((name) => name.endsWith(".jsonl"))
		.flatMap((name) => {
			try {
				return readFileSync(join(dir, name), "utf8")
					.split("\n")
					.map((line) => line.trim())
					.filter(Boolean)
					.flatMap((line) => {
						try {
							const record = normalizeSnapshotRecord(JSON.parse(line));
							return record ? [record] : [];
						} catch {
							return [];
						}
					});
			} catch {
				return [];
			}
		})
		.sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id));
}
