import { createHash } from "node:crypto";

import { readWorkbenchSettings } from "./settings-store.js";
import type { WorkbenchMemoryCategoryRecord } from "./types.js";

const LOCAL_USER_ID = "local-workbench";

function stableUuid(namespace: string, value: string): string {
	const bytes = createHash("sha256").update(`${namespace}:${value}`).digest().subarray(0, 16);
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function timestampMs(value: string): number {
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function lowerName(value: string): string {
	return value.trim().toLowerCase().slice(0, 64);
}

export function buildWorkbenchMemoryCategories(workingDir: string): WorkbenchMemoryCategoryRecord[] {
	return readWorkbenchSettings(workingDir).memoryCategories
		.map((category) => ({
			id: stableUuid("feynman-memory-category", `${LOCAL_USER_ID}:${category.id}`),
			userId: LOCAL_USER_ID,
			name: category.name,
			nameLower: lowerName(category.name),
			guidance: category.guidance,
			autoRecall: category.autoRecall,
			createdAt: category.createdAt,
			createdAtMs: timestampMs(category.createdAt),
			updatedAt: category.updatedAt,
			updatedAtMs: timestampMs(category.updatedAt),
			settingsRecordId: category.id,
		}))
		.sort((a, b) => a.nameLower.localeCompare(b.nameLower) || a.id.localeCompare(b.id));
}
