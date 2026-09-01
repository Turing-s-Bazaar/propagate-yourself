import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { migratedWorkbenchDataPath } from "./data-root.js";
import type { WorkbenchFrameReadCursor } from "./types.js";

const READ_CURSOR_SCHEMA = "feynman.workbenchReadCursors.v1";
const MAX_CURSOR_ID_CHARS = 160;

type WorkbenchReadCursorStore = {
	schema: typeof READ_CURSOR_SCHEMA;
	frameReadCursors: WorkbenchFrameReadCursor[];
};

export type UpsertWorkbenchFrameReadCursorInput = {
	rootFrameId: string;
	messageId?: string;
	messageIndex: number;
	messageCount?: number;
	projectId?: string;
	runSlug?: string;
};

function nowIso(): string {
	return new Date().toISOString();
}

function readCursorStorePath(workingDir: string): string {
	return migratedWorkbenchDataPath(workingDir, "read-cursors.json");
}

function defaultStore(): WorkbenchReadCursorStore {
	return {
		schema: READ_CURSOR_SCHEMA,
		frameReadCursors: [],
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

function numberValue(record: Record<string, unknown>, key: string): number | undefined {
	const value = record[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeCursorId(value: string | undefined, fallback = "workspace"): string {
	const normalized = (value ?? fallback)
		.trim()
		.replace(/\s+/g, "-")
		.replace(/[^A-Za-z0-9._:-]/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, MAX_CURSOR_ID_CHARS);
	return normalized || fallback;
}

function normalizeIndex(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) return 0;
	return Math.max(0, Math.floor(value));
}

function normalizeCursor(value: unknown): WorkbenchFrameReadCursor | undefined {
	const record = asRecord(value);
	if (!record) return undefined;
	const rootFrameId = normalizeCursorId(stringValue(record, "rootFrameId"));
	const updatedAt = stringValue(record, "updatedAt") ?? nowIso();
	const parsedUpdatedAtMs = Date.parse(updatedAt);
	const messageIndex = normalizeIndex(numberValue(record, "messageIndex"));
	const messageCount = Math.max(messageIndex + 1, normalizeIndex(numberValue(record, "messageCount")));
	return {
		rootFrameId,
		messageIndex,
		messageCount,
		...(stringValue(record, "messageId") ? { messageId: normalizeCursorId(stringValue(record, "messageId")) } : {}),
		...(stringValue(record, "projectId") ? { projectId: normalizeCursorId(stringValue(record, "projectId")) } : {}),
		...(stringValue(record, "runSlug") ? { runSlug: normalizeCursorId(stringValue(record, "runSlug")) } : {}),
		updatedAt,
		updatedAtMs: numberValue(record, "updatedAtMs") ?? (Number.isFinite(parsedUpdatedAtMs) ? parsedUpdatedAtMs : Date.now()),
	};
}

function sortReadCursors(cursors: WorkbenchFrameReadCursor[]): WorkbenchFrameReadCursor[] {
	return cursors.slice().sort((a, b) => b.updatedAtMs - a.updatedAtMs || a.rootFrameId.localeCompare(b.rootFrameId));
}

function readStore(workingDir: string): WorkbenchReadCursorStore {
	const path = readCursorStorePath(workingDir);
	if (!existsSync(path)) return defaultStore();
	try {
		const parsed = asRecord(JSON.parse(readFileSync(path, "utf8")));
		const frameReadCursors = Array.isArray(parsed?.frameReadCursors)
			? parsed.frameReadCursors
				.map(normalizeCursor)
				.filter((item): item is WorkbenchFrameReadCursor => Boolean(item))
			: [];
		return {
			schema: READ_CURSOR_SCHEMA,
			frameReadCursors: sortReadCursors(frameReadCursors),
		};
	} catch {
		return defaultStore();
	}
}

function writeStore(workingDir: string, store: WorkbenchReadCursorStore): void {
	const path = readCursorStorePath(workingDir);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({
		schema: READ_CURSOR_SCHEMA,
		frameReadCursors: sortReadCursors(store.frameReadCursors),
	}, null, 2)}\n`, "utf8");
}

export function readWorkbenchFrameReadCursors(workingDir: string): WorkbenchFrameReadCursor[] {
	return readStore(workingDir).frameReadCursors;
}

export function upsertWorkbenchFrameReadCursor(
	workingDir: string,
	input: UpsertWorkbenchFrameReadCursorInput,
): WorkbenchFrameReadCursor {
	const store = readStore(workingDir);
	const now = nowIso();
	const messageIndex = normalizeIndex(input.messageIndex);
	const messageCount = Math.max(messageIndex + 1, normalizeIndex(input.messageCount));
	const rootFrameId = normalizeCursorId(input.rootFrameId);
	const next: WorkbenchFrameReadCursor = {
		rootFrameId,
		messageIndex,
		messageCount,
		...(input.messageId ? { messageId: normalizeCursorId(input.messageId) } : {}),
		...(input.projectId ? { projectId: normalizeCursorId(input.projectId) } : {}),
		...(input.runSlug ? { runSlug: normalizeCursorId(input.runSlug) } : {}),
		updatedAt: now,
		updatedAtMs: Date.parse(now),
	};
	writeStore(workingDir, {
		schema: READ_CURSOR_SCHEMA,
		frameReadCursors: [
			...store.frameReadCursors.filter((cursor) => cursor.rootFrameId !== rootFrameId),
			next,
		],
	});
	return next;
}
