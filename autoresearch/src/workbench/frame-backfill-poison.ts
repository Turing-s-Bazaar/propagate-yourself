import { existsSync, readFileSync } from "node:fs";

import { migratedWorkbenchDataPath } from "./data-root.js";
import type { WorkbenchFrameBackfillPoison, WorkbenchFrameRecord } from "./types.js";

const FRAME_BACKFILL_POISON_SCHEMA = "feynman.frameBackfillPoison.v1";

type WorkbenchFrameBackfillPoisonStore = {
	schema: typeof FRAME_BACKFILL_POISON_SCHEMA;
	frameBackfillPoison: WorkbenchFrameBackfillPoison[];
};

function storePath(workingDir: string): string {
	return migratedWorkbenchDataPath(workingDir, "frame-backfill-poison.json");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	return value as Record<string, unknown>;
}

function stringValue(record: Record<string, unknown>, ...keys: string[]): string | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return undefined;
}

function numberValue(record: Record<string, unknown>, ...keys: string[]): number | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "number" && Number.isFinite(value)) return value;
	}
	return undefined;
}

function booleanValue(record: Record<string, unknown>, ...keys: string[]): boolean | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "boolean") return value;
		if (typeof value === "number" && Number.isFinite(value)) return value !== 0;
	}
	return undefined;
}

function updatedTimestamp(record: Record<string, unknown>): { updatedAt: string; updatedAtMs: number } {
	const explicitAt = stringValue(record, "updatedAt", "updated_at_iso");
	const explicitMs = numberValue(record, "updatedAtMs", "updated_at");
	const parsedMs = Date.parse(explicitAt ?? "");
	const updatedAtMs = explicitMs ?? (Number.isFinite(parsedMs) ? parsedMs : Date.now());
	return { updatedAt: explicitAt ?? new Date(updatedAtMs).toISOString(), updatedAtMs };
}

function normalizePoisonRow(value: unknown): WorkbenchFrameBackfillPoison | undefined {
	const record = asRecord(value);
	if (!record) return undefined;
	const frameId = stringValue(record, "frameId", "frame_id");
	if (!frameId) return undefined;
	const updated = updatedTimestamp(record);
	return {
		frameId,
		failCount: Math.max(0, Math.floor(numberValue(record, "failCount", "fail_count") ?? 0)),
		terminal: booleanValue(record, "terminal") ?? false,
		...(stringValue(record, "reason") ? { reason: stringValue(record, "reason") } : {}),
		updatedAt: updated.updatedAt,
		updatedAtMs: updated.updatedAtMs,
	};
}

function defaultStore(): WorkbenchFrameBackfillPoisonStore {
	return { schema: FRAME_BACKFILL_POISON_SCHEMA, frameBackfillPoison: [] };
}

function readStore(workingDir: string): WorkbenchFrameBackfillPoisonStore {
	const path = storePath(workingDir);
	if (!existsSync(path)) return defaultStore();
	try {
		const parsed = asRecord(JSON.parse(readFileSync(path, "utf8")));
		const rows = Array.isArray(parsed?.frameBackfillPoison)
			? parsed.frameBackfillPoison.map(normalizePoisonRow).filter((item): item is WorkbenchFrameBackfillPoison => Boolean(item))
			: [];
		return { schema: FRAME_BACKFILL_POISON_SCHEMA, frameBackfillPoison: rows };
	} catch {
		return defaultStore();
	}
}

export function readWorkbenchFrameBackfillPoison(workingDir: string, frames: WorkbenchFrameRecord[] = []): WorkbenchFrameBackfillPoison[] {
	const frameIds = new Set(frames.map((frame) => frame.id));
	return readStore(workingDir).frameBackfillPoison
		.filter((row) => !frameIds.size || frameIds.has(row.frameId))
		.sort((a, b) => b.updatedAtMs - a.updatedAtMs || a.frameId.localeCompare(b.frameId));
}
