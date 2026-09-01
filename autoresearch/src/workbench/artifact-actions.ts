import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { migratedWorkbenchDataPath, resolveWorkbenchStoredPath, workbenchDataPath } from "./data-root.js";
import type { WorkbenchArtifact, WorkbenchArtifactActionItem } from "./types.js";

const ARTIFACT_ACTIONS_SCHEMA = "feynman.workbenchArtifactActions.v1";
const ACTION_ROOTS = ["outputs", "papers", "notes"] as const;
const MAX_DISPLAY_NAME_CHARS = 180;

export type WorkbenchArtifactActionRecord = {
	artifactPath: string;
	displayName?: string;
	starred: boolean;
	hidden: boolean;
	deleted: boolean;
	deletedAt?: string;
	trashPath?: string;
	updatedAt: string;
	updatedAtMs: number;
};

export type WorkbenchArtifactAction = "delete" | "hide" | "rename" | "restore" | "star" | "unhide" | "unstar";

type ArtifactActionStore = {
	schema: typeof ARTIFACT_ACTIONS_SCHEMA;
	artifacts: WorkbenchArtifactActionRecord[];
	updatedAt: string;
};

export type UpdateWorkbenchArtifactActionInput = {
	artifactPath: string;
	action: WorkbenchArtifactAction;
	displayName?: string;
};

function nowIso(): string {
	return new Date().toISOString();
}

function toPosixPath(path: string): string {
	return path.split(sep).join("/");
}

function actionStorePath(workingDir: string): string {
	return migratedWorkbenchDataPath(workingDir, "artifact-actions.json");
}

function defaultStore(): ArtifactActionStore {
	return {
		schema: ARTIFACT_ACTIONS_SCHEMA,
		artifacts: [],
		updatedAt: nowIso(),
	};
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	return value as Record<string, unknown>;
}

function stringValue(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanValue(record: Record<string, unknown>, key: string): boolean {
	return record[key] === true;
}

function numberValue(record: Record<string, unknown>, key: string): number | undefined {
	const value = record[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeDisplayName(value: string | undefined): string | undefined {
	const normalized = value?.trim().replace(/\s+/g, " ").slice(0, MAX_DISPLAY_NAME_CHARS);
	return normalized || undefined;
}

function safeArtifactPath(workingDir: string, artifactPath: string): string {
	const workspace = resolve(workingDir);
	const absPath = resolve(workspace, artifactPath.trim().replace(/^\/+/, ""));
	const relPath = toPosixPath(relative(workspace, absPath));
	if (!relPath || relPath.startsWith("../") || relPath === ".." || relPath.split("/").includes("..")) {
		throw new Error("Artifact action target must stay inside the workspace.");
	}
	if (!ACTION_ROOTS.some((root) => relPath === root || relPath.startsWith(`${root}/`))) {
		throw new Error("Artifact actions are limited to research artifacts.");
	}
	return relPath;
}

function assertExistingArtifactPath(workingDir: string, artifactPath: string): string {
	const relPath = safeArtifactPath(workingDir, artifactPath);
	const absPath = resolve(workingDir, relPath);
	if (!existsSync(absPath)) throw new Error(`Artifact not found: ${relPath}`);
	const stat = statSync(absPath);
	if (!stat.isFile()) throw new Error(`Artifact is not a file: ${relPath}`);
	return relPath;
}

function normalizeRecord(workingDir: string, value: unknown): WorkbenchArtifactActionRecord | undefined {
	const record = asRecord(value);
	if (!record) return undefined;
	const artifactPath = stringValue(record, "artifactPath");
	if (!artifactPath) return undefined;
	let safePath: string;
	try {
		safePath = safeArtifactPath(workingDir, artifactPath);
	} catch {
		return undefined;
	}
	const updatedAt = stringValue(record, "updatedAt") ?? nowIso();
	const parsedUpdatedAtMs = Date.parse(updatedAt);
	const deletedAt = stringValue(record, "deletedAt");
	const trashPath = stringValue(record, "trashPath");
	return {
		artifactPath: safePath,
		...(normalizeDisplayName(stringValue(record, "displayName")) ? { displayName: normalizeDisplayName(stringValue(record, "displayName")) } : {}),
		starred: booleanValue(record, "starred"),
		hidden: booleanValue(record, "hidden"),
		deleted: booleanValue(record, "deleted"),
		...(deletedAt ? { deletedAt } : {}),
		...(trashPath ? { trashPath } : {}),
		updatedAt,
		updatedAtMs: numberValue(record, "updatedAtMs") ?? (Number.isFinite(parsedUpdatedAtMs) ? parsedUpdatedAtMs : Date.now()),
	};
}

function sortRecords(records: WorkbenchArtifactActionRecord[]): WorkbenchArtifactActionRecord[] {
	return records.slice().sort((a, b) => a.artifactPath.localeCompare(b.artifactPath));
}

function readStore(workingDir: string): ArtifactActionStore {
	const path = actionStorePath(workingDir);
	if (!existsSync(path)) return defaultStore();
	try {
		const parsed = asRecord(JSON.parse(readFileSync(path, "utf8")));
		const artifacts = Array.isArray(parsed?.artifacts)
			? parsed.artifacts
				.map((item) => normalizeRecord(workingDir, item))
				.filter((item): item is WorkbenchArtifactActionRecord => Boolean(item))
			: [];
		return {
			schema: ARTIFACT_ACTIONS_SCHEMA,
			artifacts: sortRecords(artifacts),
			updatedAt: stringValue(parsed ?? {}, "updatedAt") ?? nowIso(),
		};
	} catch {
		return defaultStore();
	}
}

function writeStore(workingDir: string, store: ArtifactActionStore): void {
	const path = actionStorePath(workingDir);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify({
		schema: ARTIFACT_ACTIONS_SCHEMA,
		artifacts: sortRecords(store.artifacts),
		updatedAt: store.updatedAt,
	}, null, 2) + "\n", "utf8");
}

function blankRecord(artifactPath: string, now: string): WorkbenchArtifactActionRecord {
	return {
		artifactPath,
		starred: false,
		hidden: false,
		deleted: false,
		updatedAt: now,
		updatedAtMs: Date.parse(now),
	};
}

function trashPathForArtifact(workingDir: string, artifactPath: string): string {
	const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
	return workbenchDataPath(workingDir, "artifact-trash", timestamp, randomUUID().slice(0, 8), artifactPath);
}

export function readWorkbenchArtifactActions(workingDir: string): WorkbenchArtifactActionRecord[] {
	return readStore(workingDir).artifacts;
}

export function applyWorkbenchArtifactActions(
	workingDir: string,
	artifacts: WorkbenchArtifact[],
): WorkbenchArtifact[] {
	const records = new Map(readWorkbenchArtifactActions(workingDir).map((record) => [record.artifactPath, record]));
	return artifacts
		.flatMap((artifact) => {
			const record = records.get(artifact.path);
			if (!record || record.deleted || record.hidden) return record?.deleted || record?.hidden ? [] : [artifact];
			return [{
				...artifact,
				title: record.displayName ?? artifact.title,
				starred: record.starred,
				hidden: record.hidden,
				displayName: record.displayName,
			}];
		})
		.sort((a, b) =>
			Number(Boolean(b.starred)) - Number(Boolean(a.starred)) ||
			b.updatedAtMs - a.updatedAtMs ||
			a.path.localeCompare(b.path)
		);
}

export function buildWorkbenchArtifactActionItems(
	workingDir: string,
	artifacts: WorkbenchArtifact[],
): WorkbenchArtifactActionItem[] {
	const byPath = new Map(artifacts.map((artifact) => [artifact.path, artifact]));
	return readWorkbenchArtifactActions(workingDir)
		.filter((record) => record.hidden || record.deleted)
		.map((record) => {
			const artifact = byPath.get(record.artifactPath);
			const status: WorkbenchArtifactActionItem["status"] = record.deleted ? "deleted" : "hidden";
			return {
				artifactPath: record.artifactPath,
				title: record.displayName ?? artifact?.title ?? basename(record.artifactPath),
				...(record.displayName ? { displayName: record.displayName } : {}),
				status,
				starred: record.starred,
				hidden: record.hidden,
				deleted: record.deleted,
				...(record.deletedAt ? { deletedAt: record.deletedAt } : {}),
				...(record.trashPath ? { trashPath: record.trashPath } : {}),
				updatedAt: record.updatedAt,
				updatedAtMs: record.updatedAtMs,
			};
		})
		.sort((a, b) =>
			Number(b.status === "hidden") - Number(a.status === "hidden") ||
			b.updatedAtMs - a.updatedAtMs ||
			a.artifactPath.localeCompare(b.artifactPath)
		);
}

export function updateWorkbenchArtifactAction(
	workingDir: string,
	input: UpdateWorkbenchArtifactActionInput,
): WorkbenchArtifactActionRecord {
	if (input.action === "restore") {
		return restoreWorkbenchDeletedArtifact(workingDir, input.artifactPath);
	}
	const artifactPath = input.action === "delete"
		? assertExistingArtifactPath(workingDir, input.artifactPath)
		: safeArtifactPath(workingDir, input.artifactPath);
	if (input.action !== "delete") assertExistingArtifactPath(workingDir, artifactPath);
	const store = readStore(workingDir);
	const now = nowIso();
	const existing = store.artifacts.find((record) => record.artifactPath === artifactPath);
	const next: WorkbenchArtifactActionRecord = {
		...(existing ?? blankRecord(artifactPath, now)),
		artifactPath,
		updatedAt: now,
		updatedAtMs: Date.parse(now),
	};
	if (input.action === "star") next.starred = true;
	if (input.action === "unstar") next.starred = false;
	if (input.action === "hide") next.hidden = true;
	if (input.action === "unhide") next.hidden = false;
	if (input.action === "rename") {
		const displayName = normalizeDisplayName(input.displayName);
		if (!displayName) throw new Error("Artifact display name is required.");
		next.displayName = displayName;
	}
	if (input.action === "delete") {
		const trashPath = trashPathForArtifact(workingDir, artifactPath);
		const absSource = resolve(workingDir, artifactPath);
		const absTrash = trashPath;
		mkdirSync(dirname(absTrash), { recursive: true });
		renameSync(absSource, absTrash);
		next.deleted = true;
		next.hidden = true;
		next.deletedAt = now;
		next.trashPath = trashPath;
	}
	const artifacts = [
		...store.artifacts.filter((record) => record.artifactPath !== artifactPath),
		next,
	];
	writeStore(workingDir, { schema: ARTIFACT_ACTIONS_SCHEMA, artifacts, updatedAt: now });
	return next;
}

export function restoreWorkbenchDeletedArtifact(workingDir: string, artifactPath: string): WorkbenchArtifactActionRecord {
	const safePath = safeArtifactPath(workingDir, artifactPath);
	const store = readStore(workingDir);
	const record = store.artifacts.find((item) => item.artifactPath === safePath && item.deleted && item.trashPath);
	if (!record?.trashPath) throw new Error("Deleted artifact was not found.");
	const absTrash = resolveWorkbenchStoredPath(workingDir, record.trashPath);
	const absTarget = resolve(workingDir, safePath);
	if (!existsSync(absTrash)) throw new Error(`Trash file not found: ${basename(record.trashPath)}`);
	if (existsSync(absTarget)) throw new Error(`Artifact already exists: ${safePath}`);
	mkdirSync(dirname(absTarget), { recursive: true });
	renameSync(absTrash, absTarget);
	const now = nowIso();
	const restored: WorkbenchArtifactActionRecord = {
		...record,
		deleted: false,
		hidden: false,
		updatedAt: now,
		updatedAtMs: Date.parse(now),
	};
	delete restored.deletedAt;
	delete restored.trashPath;
	writeStore(workingDir, {
		schema: ARTIFACT_ACTIONS_SCHEMA,
		artifacts: [...store.artifacts.filter((item) => item.artifactPath !== safePath), restored],
		updatedAt: now,
	});
	return restored;
}
