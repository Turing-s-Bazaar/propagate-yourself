import { createHash } from "node:crypto";

import type { WorkbenchExecutionRecord, WorkbenchHostCallLogEntry } from "./types.js";

const MAX_HOST_CALL_ROWS = 500;

function stableNumericId(namespace: string, value: string): number {
	const hex = createHash("sha256").update(`${namespace}:${value}`).digest("hex").slice(0, 12);
	return Number.parseInt(hex, 16);
}

function isExecutableRecord(record: WorkbenchExecutionRecord): boolean {
	if (record.code) return true;
	return record.kind === "bash" ||
		record.kind === "python" ||
		record.kind === "r" ||
		record.kind === "tool" ||
		record.kind === "verification";
}

function orderedInputPaths(record: WorkbenchExecutionRecord): string[] {
	const inputPaths = [...new Set(record.inputPaths)];
	if (!record.code) return inputPaths.sort((a, b) => a.localeCompare(b));
	return inputPaths.sort((a, b) => {
		const aIndex = record.code?.indexOf(a) ?? -1;
		const bIndex = record.code?.indexOf(b) ?? -1;
		if (aIndex >= 0 && bIndex >= 0 && aIndex !== bIndex) return aIndex - bIndex;
		if (aIndex >= 0 && bIndex < 0) return -1;
		if (aIndex < 0 && bIndex >= 0) return 1;
		return a.localeCompare(b);
	});
}

export function buildWorkbenchHostCallLog(execution: WorkbenchExecutionRecord[]): WorkbenchHostCallLogEntry[] {
	const rows: WorkbenchHostCallLogEntry[] = [];
	for (const record of execution) {
		if (!isExecutableRecord(record)) continue;
		const inputPaths = orderedInputPaths(record);
		inputPaths.forEach((inputPath, seq) => {
			const key = `${record.id}:${seq}:artifact_path:${inputPath}`;
			rows.push({
				id: stableNumericId("feynman-host-call-log", key),
				executionLogId: record.id,
				seq,
				method: "artifact_path",
				argsJson: JSON.stringify([inputPath]),
				derivable: true,
				bytes: 0,
				createdAt: record.createdAt,
				createdAtMs: record.createdAtMs,
			});
		});
	}
	return rows
		.sort((a, b) => b.createdAtMs - a.createdAtMs || a.executionLogId.localeCompare(b.executionLogId) || a.seq - b.seq)
		.slice(0, MAX_HOST_CALL_ROWS);
}
