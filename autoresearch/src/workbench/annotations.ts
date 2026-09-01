import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

import { migratedWorkbenchDataPath } from "./data-root.js";
import type {
	WorkbenchArtifactAnnotation,
	WorkbenchArtifactAnnotationAnchorKind,
	WorkbenchArtifactAnnotationRect,
	WorkbenchArtifactAnnotationKind,
} from "./types.js";

const ANNOTATION_SCHEMA = "feynman.workbenchAnnotations.v1";
const MAX_ANNOTATION_BODY_CHARS = 8_000;
const MAX_ANCHOR_CHARS = 1_200;
const MAX_SELECTION_PREFIX_CHARS = 800;
const ANNOTATION_ROOTS = ["outputs", "papers", "notes"] as const;

type WorkbenchAnnotationStore = {
	schema: typeof ANNOTATION_SCHEMA;
	artifactAnnotations: WorkbenchArtifactAnnotation[];
};

export type UpsertWorkbenchArtifactAnnotationInput = {
	id?: string;
	artifactPath: string;
	body: string;
	kind?: WorkbenchArtifactAnnotationKind;
	anchorKind?: WorkbenchArtifactAnnotationAnchorKind;
	anchorText?: string;
	startOffset?: number;
	endOffset?: number;
	startLine?: number;
	endLine?: number;
	pageNumber?: number;
	selectionPrefix?: string;
	xPercent?: number;
	yPercent?: number;
	widthPercent?: number;
	heightPercent?: number;
	rects?: WorkbenchArtifactAnnotationRect[];
	sessionId?: string;
	projectId?: string;
	runSlug?: string;
};

function nowIso(): string {
	return new Date().toISOString();
}

function toPosixPath(path: string): string {
	return path.split(sep).join("/");
}

function annotationStorePath(workingDir: string): string {
	return migratedWorkbenchDataPath(workingDir, "annotations.json");
}

function defaultStore(): WorkbenchAnnotationStore {
	return {
		schema: ANNOTATION_SCHEMA,
		artifactAnnotations: [],
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

function normalizeOptionalSlug(value: string | undefined, maxLength = 140): string | undefined {
	if (!value) return undefined;
	const normalized = value.trim().replace(/\s+/g, "-").replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, maxLength);
	return normalized || undefined;
}

function normalizeKind(value: string | undefined): WorkbenchArtifactAnnotationKind {
	return value === "revision" ? "revision" : "note";
}

function normalizeAnchorKind(value: string | undefined): WorkbenchArtifactAnnotationAnchorKind | undefined {
	if (value === "point" || value === "region" || value === "text_selection") return value;
	return undefined;
}

function normalizeText(value: string | undefined, limit: number): string | undefined {
	const normalized = value?.trim().replace(/\r\n/g, "\n").slice(0, limit);
	return normalized || undefined;
}

function normalizeBody(value: string): string {
	const normalized = normalizeText(value, MAX_ANNOTATION_BODY_CHARS);
	if (!normalized) throw new Error("Annotation body is required.");
	return normalized;
}

function safeArtifactPath(workingDir: string, artifactPath: string): string {
	const workspace = resolve(workingDir);
	const absPath = resolve(workspace, artifactPath.trim().replace(/^\/+/, ""));
	const relPath = toPosixPath(relative(workspace, absPath));
	if (!relPath || relPath.startsWith("../") || relPath === ".." || relPath.split("/").includes("..")) {
		throw new Error("Annotation target must be inside the workspace.");
	}
	if (!ANNOTATION_ROOTS.some((root) => relPath === root || relPath.startsWith(`${root}/`))) {
		throw new Error("Annotations are limited to research artifacts.");
	}
	return relPath;
}

function percentValue(value: number | undefined): number | undefined {
	if (value === undefined || !Number.isFinite(value)) return undefined;
	const clamped = Math.min(100, Math.max(0, value));
	return Math.round(clamped * 1000) / 1000;
}

function rectValues(value: unknown): WorkbenchArtifactAnnotationRect[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const rects = value.slice(0, 32).map((item) => {
		const record = asRecord(item);
		if (!record) return undefined;
		const xPercent = percentValue(numberValue(record, "xPercent"));
		const yPercent = percentValue(numberValue(record, "yPercent"));
		const widthPercent = percentValue(numberValue(record, "widthPercent"));
		const heightPercent = percentValue(numberValue(record, "heightPercent"));
		if (
			xPercent === undefined ||
			yPercent === undefined ||
			widthPercent === undefined ||
			heightPercent === undefined ||
			widthPercent <= 0 ||
			heightPercent <= 0
		) return undefined;
		return { xPercent, yPercent, widthPercent, heightPercent };
	}).filter((item): item is WorkbenchArtifactAnnotationRect => Boolean(item));
	return rects.length ? rects : undefined;
}

export function normalizeWorkbenchArtifactAnnotationRects(value: unknown): WorkbenchArtifactAnnotationRect[] | undefined {
	return rectValues(value);
}

function positiveIntegerValue(value: number | undefined): number | undefined {
	if (value === undefined || !Number.isFinite(value)) return undefined;
	const normalized = Math.floor(value);
	return normalized > 0 ? normalized : undefined;
}

function offsetValue(value: number | undefined): number | undefined {
	if (value === undefined || !Number.isFinite(value)) return undefined;
	return Math.max(0, Math.floor(value));
}

function assertExistingArtifactPath(workingDir: string, artifactPath: string): string {
	const relPath = safeArtifactPath(workingDir, artifactPath);
	const absPath = resolve(workingDir, relPath);
	if (!existsSync(absPath)) throw new Error(`Artifact not found: ${relPath}`);
	const stat = statSync(absPath);
	if (!stat.isFile()) throw new Error(`Artifact is not a file: ${relPath}`);
	return relPath;
}

function normalizeAnnotation(workingDir: string, value: unknown): WorkbenchArtifactAnnotation | undefined {
	const record = asRecord(value);
	if (!record) return undefined;
	const id = stringValue(record, "id");
	const artifactPath = stringValue(record, "artifactPath");
	const body = stringValue(record, "body");
	if (!id || !artifactPath || !body) return undefined;
	let safePath: string;
	try {
		safePath = safeArtifactPath(workingDir, artifactPath);
	} catch {
		return undefined;
	}
	const createdAt = stringValue(record, "createdAt") ?? nowIso();
	const updatedAt = stringValue(record, "updatedAt") ?? createdAt;
	const labelIndex = Math.max(1, Math.floor(numberValue(record, "labelIndex") ?? 1));
	const parsedCreatedAtMs = Date.parse(createdAt);
	const parsedUpdatedAtMs = Date.parse(updatedAt);
	const createdAtMs = numberValue(record, "createdAtMs") ?? (Number.isFinite(parsedCreatedAtMs) ? parsedCreatedAtMs : Date.now());
	const updatedAtMs = numberValue(record, "updatedAtMs") ?? (Number.isFinite(parsedUpdatedAtMs) ? parsedUpdatedAtMs : createdAtMs);
	const anchorText = normalizeText(stringValue(record, "anchorText"), MAX_ANCHOR_CHARS);
	const anchorKind = normalizeAnchorKind(stringValue(record, "anchorKind"));
	const selectionPrefix = normalizeText(stringValue(record, "selectionPrefix"), MAX_SELECTION_PREFIX_CHARS);
	const sessionId = normalizeOptionalSlug(stringValue(record, "sessionId"));
	const projectId = normalizeOptionalSlug(stringValue(record, "projectId"));
	const runSlug = normalizeOptionalSlug(stringValue(record, "runSlug"));
	const startOffset = offsetValue(numberValue(record, "startOffset"));
	const endOffset = offsetValue(numberValue(record, "endOffset"));
	const startLine = positiveIntegerValue(numberValue(record, "startLine"));
	const endLine = positiveIntegerValue(numberValue(record, "endLine"));
	const pageNumber = positiveIntegerValue(numberValue(record, "pageNumber"));
	const xPercent = percentValue(numberValue(record, "xPercent"));
	const yPercent = percentValue(numberValue(record, "yPercent"));
	const widthPercent = percentValue(numberValue(record, "widthPercent"));
	const heightPercent = percentValue(numberValue(record, "heightPercent"));
	const rects = rectValues(record.rects);
	return {
		id: id.slice(0, 160),
		artifactPath: safePath,
		targetKind: "artifact",
		targetKey: safePath,
		labelIndex,
		body: normalizeBody(body),
		kind: normalizeKind(stringValue(record, "kind")),
		...(anchorKind ? { anchorKind } : {}),
		...(anchorText ? { anchorText } : {}),
		...(startOffset !== undefined ? { startOffset } : {}),
		...(endOffset !== undefined ? { endOffset } : {}),
		...(startLine !== undefined ? { startLine } : {}),
		...(endLine !== undefined ? { endLine } : {}),
		...(pageNumber !== undefined ? { pageNumber } : {}),
		...(selectionPrefix ? { selectionPrefix } : {}),
		...(xPercent !== undefined ? { xPercent } : {}),
		...(yPercent !== undefined ? { yPercent } : {}),
		...(widthPercent !== undefined ? { widthPercent } : {}),
		...(heightPercent !== undefined ? { heightPercent } : {}),
		...(rects ? { rects } : {}),
		...(sessionId ? { sessionId } : {}),
		...(projectId ? { projectId } : {}),
		...(runSlug ? { runSlug } : {}),
		createdAt,
		createdAtMs,
		updatedAt,
		updatedAtMs,
	};
}

function sortAnnotations(annotations: WorkbenchArtifactAnnotation[]): WorkbenchArtifactAnnotation[] {
	return annotations.slice().sort((a, b) =>
		a.artifactPath.localeCompare(b.artifactPath) ||
		a.labelIndex - b.labelIndex ||
		a.createdAtMs - b.createdAtMs ||
		a.id.localeCompare(b.id)
	);
}

function readStore(workingDir: string): WorkbenchAnnotationStore {
	const path = annotationStorePath(workingDir);
	if (!existsSync(path)) return defaultStore();
	try {
		const parsed = asRecord(JSON.parse(readFileSync(path, "utf8")));
		const artifactAnnotations = Array.isArray(parsed?.artifactAnnotations)
			? parsed.artifactAnnotations
				.map((item) => normalizeAnnotation(workingDir, item))
				.filter((item): item is WorkbenchArtifactAnnotation => Boolean(item))
			: [];
		return {
			schema: ANNOTATION_SCHEMA,
			artifactAnnotations: sortAnnotations(artifactAnnotations),
		};
	} catch {
		return defaultStore();
	}
}

function writeStore(workingDir: string, store: WorkbenchAnnotationStore): void {
	const path = annotationStorePath(workingDir);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({
		schema: ANNOTATION_SCHEMA,
		artifactAnnotations: sortAnnotations(store.artifactAnnotations),
	}, null, 2)}\n`, "utf8");
}

export function readWorkbenchArtifactAnnotations(workingDir: string): WorkbenchArtifactAnnotation[] {
	return readStore(workingDir).artifactAnnotations;
}

export function upsertWorkbenchArtifactAnnotation(
	workingDir: string,
	input: UpsertWorkbenchArtifactAnnotationInput,
): WorkbenchArtifactAnnotation[] {
	const store = readStore(workingDir);
	const artifactPath = assertExistingArtifactPath(workingDir, input.artifactPath);
	const id = input.id?.trim() || randomUUID();
	const existing = store.artifactAnnotations.find((annotation) => annotation.id === id);
	const now = nowIso();
	const nextLabelIndex = existing?.labelIndex
		?? (store.artifactAnnotations
			.filter((annotation) => annotation.artifactPath === artifactPath)
			.reduce((max, annotation) => Math.max(max, annotation.labelIndex), 0) + 1);
	const anchorText = normalizeText(input.anchorText, MAX_ANCHOR_CHARS);
	const anchorKind = normalizeAnchorKind(input.anchorKind);
	const selectionPrefix = normalizeText(input.selectionPrefix, MAX_SELECTION_PREFIX_CHARS);
	const sessionId = normalizeOptionalSlug(input.sessionId);
	const projectId = normalizeOptionalSlug(input.projectId);
	const runSlug = normalizeOptionalSlug(input.runSlug);
	const startOffset = offsetValue(input.startOffset);
	const endOffset = offsetValue(input.endOffset);
	const startLine = positiveIntegerValue(input.startLine);
	const endLine = positiveIntegerValue(input.endLine);
	const pageNumber = positiveIntegerValue(input.pageNumber);
	const xPercent = percentValue(input.xPercent);
	const yPercent = percentValue(input.yPercent);
	const widthPercent = percentValue(input.widthPercent);
	const heightPercent = percentValue(input.heightPercent);
	const rects = rectValues(input.rects);
	const next: WorkbenchArtifactAnnotation = {
		id: id.slice(0, 160),
		artifactPath,
		targetKind: "artifact",
		targetKey: artifactPath,
		labelIndex: nextLabelIndex,
		body: normalizeBody(input.body),
		kind: normalizeKind(input.kind),
		...(anchorKind ? { anchorKind } : {}),
		...(anchorText ? { anchorText } : {}),
		...(startOffset !== undefined ? { startOffset } : {}),
		...(endOffset !== undefined ? { endOffset } : {}),
		...(startLine !== undefined ? { startLine } : {}),
		...(endLine !== undefined ? { endLine } : {}),
		...(pageNumber !== undefined ? { pageNumber } : {}),
		...(selectionPrefix ? { selectionPrefix } : {}),
		...(xPercent !== undefined ? { xPercent } : {}),
		...(yPercent !== undefined ? { yPercent } : {}),
		...(widthPercent !== undefined ? { widthPercent } : {}),
		...(heightPercent !== undefined ? { heightPercent } : {}),
		...(rects ? { rects } : {}),
		...(sessionId ? { sessionId } : {}),
		...(projectId ? { projectId } : {}),
		...(runSlug ? { runSlug } : {}),
		createdAt: existing?.createdAt ?? now,
		createdAtMs: existing?.createdAtMs ?? Date.parse(now),
		updatedAt: now,
		updatedAtMs: Date.parse(now),
	};
	const artifactAnnotations = sortAnnotations([
		...store.artifactAnnotations.filter((annotation) => annotation.id !== id),
		next,
	]);
	writeStore(workingDir, { schema: ANNOTATION_SCHEMA, artifactAnnotations });
	return artifactAnnotations;
}

export function removeWorkbenchArtifactAnnotation(workingDir: string, annotationId: string): WorkbenchArtifactAnnotation[] {
	const store = readStore(workingDir);
	const id = annotationId.trim();
	if (!id) throw new Error("Annotation id is required.");
	const artifactAnnotations = store.artifactAnnotations.filter((annotation) => annotation.id !== id);
	writeStore(workingDir, { schema: ANNOTATION_SCHEMA, artifactAnnotations });
	return artifactAnnotations;
}
