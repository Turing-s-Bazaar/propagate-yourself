import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { migratedWorkbenchDataPath } from "./data-root.js";
import type {
	WorkbenchTranscriptAnnotation,
	WorkbenchTranscriptAnnotationKind,
	WorkbenchTranscriptAnnotationOrigin,
	WorkbenchTranscriptAnnotationSource,
} from "./types.js";

const TRANSCRIPT_ANNOTATION_SCHEMA = "feynman.workbenchTranscriptAnnotations.v1";
const MAX_ANCHOR_CHARS = 1_200;
const MAX_NOTE_CHARS = 8_000;

type WorkbenchTranscriptAnnotationStore = {
	schema: typeof TRANSCRIPT_ANNOTATION_SCHEMA;
	transcriptAnnotations: WorkbenchTranscriptAnnotation[];
};

export type UpsertWorkbenchTranscriptAnnotationInput = {
	id?: string;
	rootFrameId: string;
	messageUuid?: string;
	messageIndex: number;
	blockIndex?: number;
	source?: WorkbenchTranscriptAnnotationSource;
	toolName?: string;
	anchorText: string;
	startOffset?: number;
	endOffset?: number;
	kind?: WorkbenchTranscriptAnnotationKind;
	note?: string;
	origin?: WorkbenchTranscriptAnnotationOrigin;
	readAt?: string;
	projectId?: string;
	runSlug?: string;
};

function nowIso(): string {
	return new Date().toISOString();
}

function storePath(workingDir: string): string {
	return migratedWorkbenchDataPath(workingDir, "transcript-annotations.json");
}

function defaultStore(): WorkbenchTranscriptAnnotationStore {
	return {
		schema: TRANSCRIPT_ANNOTATION_SCHEMA,
		transcriptAnnotations: [],
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

function requiredString(record: Record<string, unknown>, key: string): string {
	const value = stringValue(record, key);
	if (!value) throw new Error(`Missing ${key}.`);
	return value;
}

function requiredNumber(record: Record<string, unknown>, key: string): number {
	const value = numberValue(record, key);
	if (value === undefined) throw new Error(`Missing ${key}.`);
	return value;
}

function normalizeOptionalSlug(value: string | undefined, maxLength = 140): string | undefined {
	if (!value) return undefined;
	const normalized = value.trim().replace(/\s+/g, "-").replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, maxLength);
	return normalized || undefined;
}

function normalizeText(value: string | undefined, limit: number): string | undefined {
	const normalized = value?.trim().replace(/\r\n/g, "\n").slice(0, limit);
	return normalized || undefined;
}

function normalizeAnchorText(value: string): string {
	const normalized = normalizeText(value, MAX_ANCHOR_CHARS);
	if (!normalized) throw new Error("Transcript annotation anchor text is required.");
	return normalized;
}

function normalizeSource(value: string | undefined): WorkbenchTranscriptAnnotationSource {
	if (value === "assistant" || value === "tool_input" || value === "tool_result" || value === "user") return value;
	return "assistant";
}

function normalizeKind(value: string | undefined): WorkbenchTranscriptAnnotationKind {
	return value === "note" ? "note" : "bookmark";
}

function normalizeOrigin(value: string | undefined): WorkbenchTranscriptAnnotationOrigin {
	return value === "agent" ? "agent" : "user";
}

function nonNegativeInteger(value: number | undefined, fallback = 0): number {
	if (value === undefined || !Number.isFinite(value)) return fallback;
	return Math.max(0, Math.floor(value));
}

function optionalOffset(value: number | undefined): number | undefined {
	if (value === undefined || !Number.isFinite(value)) return undefined;
	return Math.max(0, Math.floor(value));
}

function timestampMs(value: string | undefined, fallback: number): number {
	if (!value) return fallback;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeAnnotation(value: unknown): WorkbenchTranscriptAnnotation | undefined {
	const record = asRecord(value);
	if (!record) return undefined;
	const id = stringValue(record, "id");
	const rootFrameId = normalizeOptionalSlug(stringValue(record, "rootFrameId"));
	const anchorText = normalizeText(stringValue(record, "anchorText"), MAX_ANCHOR_CHARS);
	if (!id || !rootFrameId || !anchorText) return undefined;
	const createdAt = stringValue(record, "createdAt") ?? nowIso();
	const createdAtMs = numberValue(record, "createdAtMs") ?? timestampMs(createdAt, Date.now());
	const updatedAt = stringValue(record, "updatedAt") ?? createdAt;
	const updatedAtMs = numberValue(record, "updatedAtMs") ?? timestampMs(updatedAt, createdAtMs);
	const readAt = stringValue(record, "readAt");
	const readAtMs = numberValue(record, "readAtMs") ?? (readAt ? timestampMs(readAt, updatedAtMs) : undefined);
	const note = normalizeText(stringValue(record, "note"), MAX_NOTE_CHARS) ?? "";
	const messageUuid = normalizeOptionalSlug(stringValue(record, "messageUuid"));
	const projectId = normalizeOptionalSlug(stringValue(record, "projectId"));
	const runSlug = normalizeOptionalSlug(stringValue(record, "runSlug"));
	const toolName = normalizeOptionalSlug(stringValue(record, "toolName"), 255);
	const startOffset = optionalOffset(numberValue(record, "startOffset"));
	const endOffset = optionalOffset(numberValue(record, "endOffset"));
	return {
		id: id.slice(0, 160),
		rootFrameId,
		...(messageUuid ? { messageUuid } : {}),
		messageIndex: nonNegativeInteger(numberValue(record, "messageIndex")),
		blockIndex: nonNegativeInteger(numberValue(record, "blockIndex")),
		source: normalizeSource(stringValue(record, "source")),
		...(toolName ? { toolName } : {}),
		anchorText,
		...(startOffset !== undefined ? { startOffset } : {}),
		...(endOffset !== undefined ? { endOffset } : {}),
		kind: normalizeKind(stringValue(record, "kind")),
		note,
		origin: normalizeOrigin(stringValue(record, "origin")),
		...(readAt ? { readAt } : {}),
		...(readAtMs !== undefined ? { readAtMs } : {}),
		...(projectId ? { projectId } : {}),
		...(runSlug ? { runSlug } : {}),
		createdAt,
		createdAtMs,
		updatedAt,
		updatedAtMs,
	};
}

function sortAnnotations(annotations: WorkbenchTranscriptAnnotation[]): WorkbenchTranscriptAnnotation[] {
	return annotations.slice().sort((a, b) =>
		a.rootFrameId.localeCompare(b.rootFrameId) ||
		a.messageIndex - b.messageIndex ||
		a.blockIndex - b.blockIndex ||
		a.createdAtMs - b.createdAtMs ||
		a.id.localeCompare(b.id)
	);
}

function readStore(workingDir: string): WorkbenchTranscriptAnnotationStore {
	const path = storePath(workingDir);
	if (!existsSync(path)) return defaultStore();
	try {
		const parsed = asRecord(JSON.parse(readFileSync(path, "utf8")));
		const transcriptAnnotations = Array.isArray(parsed?.transcriptAnnotations)
			? parsed.transcriptAnnotations
				.map(normalizeAnnotation)
				.filter((item): item is WorkbenchTranscriptAnnotation => Boolean(item))
			: [];
		return {
			schema: TRANSCRIPT_ANNOTATION_SCHEMA,
			transcriptAnnotations: sortAnnotations(transcriptAnnotations),
		};
	} catch {
		return defaultStore();
	}
}

function writeStore(workingDir: string, store: WorkbenchTranscriptAnnotationStore): void {
	const path = storePath(workingDir);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({
		schema: TRANSCRIPT_ANNOTATION_SCHEMA,
		transcriptAnnotations: sortAnnotations(store.transcriptAnnotations),
	}, null, 2)}\n`, "utf8");
}

export function readWorkbenchTranscriptAnnotations(workingDir: string): WorkbenchTranscriptAnnotation[] {
	return readStore(workingDir).transcriptAnnotations;
}

export function upsertWorkbenchTranscriptAnnotation(
	workingDir: string,
	input: UpsertWorkbenchTranscriptAnnotationInput,
): WorkbenchTranscriptAnnotation[] {
	const store = readStore(workingDir);
	const id = input.id?.trim() || randomUUID();
	const existing = store.transcriptAnnotations.find((annotation) => annotation.id === id);
	const now = nowIso();
	const rootFrameId = normalizeOptionalSlug(input.rootFrameId);
	if (!rootFrameId) throw new Error("Transcript annotation root frame id is required.");
	const messageUuid = normalizeOptionalSlug(input.messageUuid);
	const projectId = normalizeOptionalSlug(input.projectId);
	const runSlug = normalizeOptionalSlug(input.runSlug);
	const toolName = normalizeOptionalSlug(input.toolName, 255);
	const startOffset = optionalOffset(input.startOffset);
	const endOffset = optionalOffset(input.endOffset);
	const readAt = normalizeText(input.readAt, 80);
	const readAtMs = readAt ? timestampMs(readAt, Date.parse(now)) : undefined;
	const next: WorkbenchTranscriptAnnotation = {
		id: id.slice(0, 160),
		rootFrameId,
		...(messageUuid ? { messageUuid } : {}),
		messageIndex: nonNegativeInteger(input.messageIndex),
		blockIndex: nonNegativeInteger(input.blockIndex),
		source: normalizeSource(input.source),
		...(toolName ? { toolName } : {}),
		anchorText: normalizeAnchorText(input.anchorText),
		...(startOffset !== undefined ? { startOffset } : {}),
		...(endOffset !== undefined ? { endOffset } : {}),
		kind: normalizeKind(input.kind),
		note: normalizeText(input.note, MAX_NOTE_CHARS) ?? "",
		origin: normalizeOrigin(input.origin),
		...(readAt ? { readAt } : {}),
		...(readAtMs !== undefined ? { readAtMs } : {}),
		...(projectId ? { projectId } : {}),
		...(runSlug ? { runSlug } : {}),
		createdAt: existing?.createdAt ?? now,
		createdAtMs: existing?.createdAtMs ?? Date.parse(now),
		updatedAt: now,
		updatedAtMs: Date.parse(now),
	};
	const transcriptAnnotations = sortAnnotations([
		...store.transcriptAnnotations.filter((annotation) => annotation.id !== id),
		next,
	]);
	writeStore(workingDir, { schema: TRANSCRIPT_ANNOTATION_SCHEMA, transcriptAnnotations });
	return transcriptAnnotations;
}

export function removeWorkbenchTranscriptAnnotation(workingDir: string, annotationId: string): WorkbenchTranscriptAnnotation[] {
	const store = readStore(workingDir);
	const id = annotationId.trim();
	if (!id) throw new Error("Transcript annotation id is required.");
	const transcriptAnnotations = store.transcriptAnnotations.filter((annotation) => annotation.id !== id);
	writeStore(workingDir, { schema: TRANSCRIPT_ANNOTATION_SCHEMA, transcriptAnnotations });
	return transcriptAnnotations;
}

export function mutateWorkbenchTranscriptAnnotation(
	workingDir: string,
	body: Record<string, unknown>,
): WorkbenchTranscriptAnnotation[] {
	const action = stringValue(body, "action");
	if (action === "remove") return removeWorkbenchTranscriptAnnotation(workingDir, requiredString(body, "id"));
	if (action && action !== "upsert") throw new Error("Transcript annotation action must be upsert or remove.");
	return upsertWorkbenchTranscriptAnnotation(workingDir, {
		id: stringValue(body, "id"),
		rootFrameId: requiredString(body, "rootFrameId"),
		messageUuid: stringValue(body, "messageUuid"),
		messageIndex: requiredNumber(body, "messageIndex"),
		blockIndex: numberValue(body, "blockIndex"),
		source: normalizeSource(stringValue(body, "source")),
		toolName: stringValue(body, "toolName"),
		anchorText: requiredString(body, "anchorText"),
		startOffset: numberValue(body, "startOffset"),
		endOffset: numberValue(body, "endOffset"),
		kind: normalizeKind(stringValue(body, "kind")),
		note: stringValue(body, "note"),
		origin: normalizeOrigin(stringValue(body, "origin")),
		readAt: stringValue(body, "readAt"),
		projectId: stringValue(body, "projectId"),
		runSlug: stringValue(body, "runSlug"),
	});
}
