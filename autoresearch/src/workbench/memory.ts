import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { migratedWorkbenchDataPath } from "./data-root.js";

export type WorkbenchMemoryScope = "artifact" | "category" | "profile" | "project" | "session";
export type WorkbenchNoteTarget = "artifact" | "message" | "session";

export type WorkbenchMemoryRecord = {
	id: string;
	body: string;
	scope: WorkbenchMemoryScope;
	projectId?: string;
	sessionId?: string;
	artifactPath?: string;
	categoryId?: string;
	origin: "assistant" | "imported" | "user";
	evidence: "inferred" | "source-backed" | "stated";
	createdAt: string;
	updatedAt: string;
};

export type WorkbenchNoteRecord = {
	id: string;
	projectId?: string;
	targetType: WorkbenchNoteTarget;
	targetFrameId?: string;
	targetMessageIndex?: number;
	targetArtifactPath?: string;
	content: string;
	createdAt: string;
	updatedAt: string;
};

export type WorkbenchMemoryStore = {
	schema: "feynman.workbenchMemory.v1";
	memories: WorkbenchMemoryRecord[];
	notes: WorkbenchNoteRecord[];
	updatedAt: string;
};

const MEMORY_SCHEMA = "feynman.workbenchMemory.v1" as const;

function nowIso(): string {
	return new Date().toISOString();
}

function memoryPath(workingDir: string): string {
	return migratedWorkbenchDataPath(workingDir, "memory.json");
}

function recordObject(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
	const text = typeof value === "string" ? value.trim() : "";
	return text || undefined;
}

function integerValue(value: unknown): number | undefined {
	const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
	return Number.isInteger(number) && number >= 0 ? number : undefined;
}

function normalizeId(value: string | undefined): string {
	const id = value?.trim();
	return id && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) ? id : randomUUID();
}

function normalizeScope(value: unknown): WorkbenchMemoryScope {
	if (value === "artifact" || value === "category" || value === "project" || value === "session") return value;
	return "profile";
}

function normalizeOrigin(value: unknown): WorkbenchMemoryRecord["origin"] {
	if (value === "assistant" || value === "imported") return value;
	return "user";
}

function normalizeEvidence(value: unknown): WorkbenchMemoryRecord["evidence"] {
	if (value === "inferred" || value === "source-backed") return value;
	return "stated";
}

function normalizeNoteTarget(value: unknown): WorkbenchNoteTarget {
	if (value === "artifact" || value === "message") return value;
	return "session";
}

function emptyStore(): WorkbenchMemoryStore {
	return { schema: MEMORY_SCHEMA, memories: [], notes: [], updatedAt: nowIso() };
}

function normalizeMemory(record: Record<string, unknown>): WorkbenchMemoryRecord | undefined {
	const body = stringValue(record.body);
	if (!body) return undefined;
	const createdAt = stringValue(record.createdAt) ?? nowIso();
	const scope = normalizeScope(record.scope);
	return {
		id: normalizeId(stringValue(record.id)),
		body: body.slice(0, 4_000),
		scope,
		...(stringValue(record.projectId) ? { projectId: stringValue(record.projectId)!.slice(0, 255) } : {}),
		...(stringValue(record.sessionId) ? { sessionId: stringValue(record.sessionId)!.slice(0, 255) } : {}),
		...(stringValue(record.artifactPath) ? { artifactPath: stringValue(record.artifactPath)!.slice(0, 512) } : {}),
		...(stringValue(record.categoryId) ? { categoryId: stringValue(record.categoryId)!.slice(0, 128) } : {}),
		origin: normalizeOrigin(record.origin),
		evidence: normalizeEvidence(record.evidence),
		createdAt,
		updatedAt: stringValue(record.updatedAt) ?? createdAt,
	};
}

function normalizeNote(record: Record<string, unknown>): WorkbenchNoteRecord | undefined {
	const content = stringValue(record.content);
	if (!content) return undefined;
	const createdAt = stringValue(record.createdAt) ?? nowIso();
	const targetMessageIndex = integerValue(record.targetMessageIndex);
	return {
		id: normalizeId(stringValue(record.id)),
		...(stringValue(record.projectId) ? { projectId: stringValue(record.projectId)!.slice(0, 255) } : {}),
		targetType: normalizeNoteTarget(record.targetType),
		...(stringValue(record.targetFrameId) ? { targetFrameId: stringValue(record.targetFrameId)!.slice(0, 255) } : {}),
		...(targetMessageIndex !== undefined ? { targetMessageIndex } : {}),
		...(stringValue(record.targetArtifactPath) ? { targetArtifactPath: stringValue(record.targetArtifactPath)!.slice(0, 512) } : {}),
		content: content.slice(0, 4_000),
		createdAt,
		updatedAt: stringValue(record.updatedAt) ?? createdAt,
	};
}

function readArray<T>(value: unknown, normalize: (record: Record<string, unknown>) => T | undefined): T[] {
	return Array.isArray(value)
		? value.map((record) => normalize(recordObject(record))).filter((record): record is T => Boolean(record))
		: [];
}

function writeWorkbenchMemory(workingDir: string, store: WorkbenchMemoryStore): WorkbenchMemoryStore {
	const path = memoryPath(workingDir);
	const next = { ...store, schema: MEMORY_SCHEMA, updatedAt: nowIso() };
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
	return next;
}

function upsertById<T extends { id: string; createdAt: string; updatedAt: string }>(records: T[], record: T): T[] {
	const index = records.findIndex((item) => item.id === record.id);
	if (index === -1) return [...records, record];
	return records.map((item) => item.id === record.id ? { ...record, createdAt: item.createdAt } : item);
}

export function readWorkbenchMemory(workingDir: string): WorkbenchMemoryStore {
	const path = memoryPath(workingDir);
	if (!existsSync(path)) return emptyStore();
	try {
		const parsed = recordObject(JSON.parse(readFileSync(path, "utf8")));
		return {
			schema: MEMORY_SCHEMA,
			memories: readArray(parsed.memories, normalizeMemory),
			notes: readArray(parsed.notes, normalizeNote),
			updatedAt: stringValue(parsed.updatedAt) ?? nowIso(),
		};
	} catch {
		return emptyStore();
	}
}

export function upsertWorkbenchMemoryRecord(workingDir: string, record: Record<string, unknown>): WorkbenchMemoryStore {
	const store = readWorkbenchMemory(workingDir);
	const timestamp = nowIso();
	const normalized = normalizeMemory({ ...record, id: normalizeId(stringValue(record.id)), createdAt: timestamp, updatedAt: timestamp });
	if (!normalized) throw new Error("Memory body is required.");
	return writeWorkbenchMemory(workingDir, { ...store, memories: upsertById(store.memories, normalized) });
}

export function removeWorkbenchMemoryRecord(workingDir: string, id: string): WorkbenchMemoryStore {
	const targetId = id.trim();
	if (!targetId) throw new Error("Memory id is required.");
	const store = readWorkbenchMemory(workingDir);
	return writeWorkbenchMemory(workingDir, { ...store, memories: store.memories.filter((record) => record.id !== targetId) });
}

export function upsertWorkbenchNoteRecord(workingDir: string, record: Record<string, unknown>): WorkbenchMemoryStore {
	const store = readWorkbenchMemory(workingDir);
	const timestamp = nowIso();
	const normalized = normalizeNote({ ...record, id: normalizeId(stringValue(record.id)), createdAt: timestamp, updatedAt: timestamp });
	if (!normalized) throw new Error("Note content is required.");
	return writeWorkbenchMemory(workingDir, { ...store, notes: upsertById(store.notes, normalized) });
}

export function removeWorkbenchNoteRecord(workingDir: string, id: string): WorkbenchMemoryStore {
	const targetId = id.trim();
	if (!targetId) throw new Error("Note id is required.");
	const store = readWorkbenchMemory(workingDir);
	return writeWorkbenchMemory(workingDir, { ...store, notes: store.notes.filter((record) => record.id !== targetId) });
}
