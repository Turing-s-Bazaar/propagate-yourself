import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { migratedWorkbenchDataPath } from "./data-root.js";
import type { WorkbenchSafetyFeedback } from "./ledger-types.js";

type WorkbenchSafetyFeedbackStore = {
	schema: "feynman.workbenchSafetyFeedback.v1";
	feedback: WorkbenchSafetyFeedback[];
	updatedAt: string;
};

type SafetyFeedbackInput = {
	rootFrameId: string;
	type: string;
	userId?: string;
	model?: string;
	reason?: string;
	responseId?: string;
	contextSnapshot?: string;
	source?: WorkbenchSafetyFeedback["source"];
};

const SAFETY_FEEDBACK_SCHEMA = "feynman.workbenchSafetyFeedback.v1" as const;
const LOCAL_USER_ID = "local-user";

function nowIso(): string {
	return new Date().toISOString();
}

function safetyFeedbackPath(workingDir: string): string {
	return migratedWorkbenchDataPath(workingDir, "safety-feedback.json");
}

function recordObject(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown, maxLength = 4_000): string | undefined {
	const text = typeof value === "string" ? value.trim() : "";
	return text ? text.slice(0, maxLength) : undefined;
}

function dateMs(value: string): number {
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : Date.now();
}

function normalizeId(value: unknown): string {
	const id = stringValue(value, 128);
	return id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
		? id
		: randomUUID();
}

function emptyStore(): WorkbenchSafetyFeedbackStore {
	return { schema: SAFETY_FEEDBACK_SCHEMA, feedback: [], updatedAt: nowIso() };
}

function normalizeSource(value: unknown): WorkbenchSafetyFeedback["source"] {
	return value === "review-request" ? "review-request" : "store";
}

function normalizeFeedback(record: Record<string, unknown>): WorkbenchSafetyFeedback | undefined {
	const rootFrameId = stringValue(record.rootFrameId, 255);
	const type = stringValue(record.type, 64);
	if (!rootFrameId || !type) return undefined;
	const createdAt = stringValue(record.createdAt, 64) ?? nowIso();
	const model = stringValue(record.model, 255);
	const reason = stringValue(record.reason);
	const responseId = stringValue(record.responseId, 128);
	const contextSnapshot = stringValue(record.contextSnapshot, 12_000);
	return {
		id: normalizeId(record.id),
		rootFrameId,
		userId: stringValue(record.userId, 255) ?? LOCAL_USER_ID,
		type,
		...(model ? { model } : {}),
		...(reason ? { reason } : {}),
		...(responseId ? { responseId } : {}),
		...(contextSnapshot ? { contextSnapshot } : {}),
		createdAt,
		createdAtMs: dateMs(createdAt),
		source: normalizeSource(record.source),
	};
}

function readArray(value: unknown): WorkbenchSafetyFeedback[] {
	return Array.isArray(value)
		? value.map((record) => normalizeFeedback(recordObject(record))).filter((record): record is WorkbenchSafetyFeedback => Boolean(record))
		: [];
}

function writeWorkbenchSafetyFeedbackStore(workingDir: string, store: WorkbenchSafetyFeedbackStore): WorkbenchSafetyFeedbackStore {
	const path = safetyFeedbackPath(workingDir);
	const next = { ...store, schema: SAFETY_FEEDBACK_SCHEMA, updatedAt: nowIso() };
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
	return next;
}

function uniqueKey(record: Pick<WorkbenchSafetyFeedback, "rootFrameId" | "type" | "userId">): string {
	return `${record.rootFrameId}\0${record.userId}\0${record.type}`;
}

export function readWorkbenchSafetyFeedback(workingDir: string): WorkbenchSafetyFeedback[] {
	const path = safetyFeedbackPath(workingDir);
	if (!existsSync(path)) return [];
	try {
		const parsed = recordObject(JSON.parse(readFileSync(path, "utf8")));
		return readArray(parsed.feedback)
			.sort((a, b) => b.createdAtMs - a.createdAtMs || a.id.localeCompare(b.id));
	} catch {
		return [];
	}
}

export function recordWorkbenchSafetyFeedback(workingDir: string, input: SafetyFeedbackInput): WorkbenchSafetyFeedback {
	const timestamp = nowIso();
	const normalized = normalizeFeedback({
		id: randomUUID(),
		rootFrameId: input.rootFrameId,
		userId: input.userId ?? LOCAL_USER_ID,
		type: input.type,
		model: input.model,
		reason: input.reason,
		responseId: input.responseId,
		contextSnapshot: input.contextSnapshot,
		createdAt: timestamp,
		source: input.source ?? "review-request",
	});
	if (!normalized) throw new Error("Safety feedback requires a root frame id and type.");
	const path = safetyFeedbackPath(workingDir);
	let existing: Record<string, unknown> = emptyStore();
	try {
		existing = existsSync(path)
			? recordObject(JSON.parse(readFileSync(path, "utf8")))
			: emptyStore();
	} catch {
		existing = emptyStore();
	}
	const store: WorkbenchSafetyFeedbackStore = {
		schema: SAFETY_FEEDBACK_SCHEMA,
		feedback: readArray(existing.feedback),
		updatedAt: stringValue(existing.updatedAt, 64) ?? timestamp,
	};
	const key = uniqueKey(normalized);
	const previous = store.feedback.find((item) => uniqueKey(item) === key);
	const feedback = previous
		? store.feedback.map((item) => uniqueKey(item) === key ? {
			...normalized,
			id: item.id,
			createdAt: item.createdAt,
			createdAtMs: item.createdAtMs,
		} : item)
		: [...store.feedback, normalized];
	writeWorkbenchSafetyFeedbackStore(workingDir, { ...store, feedback });
	return feedback.find((item) => uniqueKey(item) === key) ?? normalized;
}
