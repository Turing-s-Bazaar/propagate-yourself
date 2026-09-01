import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { migratedWorkbenchDataPath } from "./data-root.js";

export type WorkbenchComputePendingTerminateRecord = {
	schema: "feynman.computePendingTerminate.v1";
	id: string;
	jobId: string;
	provider: string;
	remoteHandle?: string;
	enqueuedAt: string;
	attempts: number;
	status: "pending";
};

const PENDING_TERMINATE_SCHEMA = "feynman.computePendingTerminate.v1";

function pendingTerminatePath(workingDir: string): string {
	return migratedWorkbenchDataPath(workingDir, "compute-pending-terminate.jsonl");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	return value as Record<string, unknown>;
}

function normalizeStoredRecord(value: unknown): WorkbenchComputePendingTerminateRecord | undefined {
	const record = asRecord(value);
	if (!record || record.schema !== PENDING_TERMINATE_SCHEMA) return undefined;
	const id = typeof record.id === "string" && record.id.trim() ? record.id : undefined;
	const jobId = typeof record.jobId === "string" && record.jobId.trim() ? record.jobId : undefined;
	const provider = typeof record.provider === "string" && record.provider.trim() ? record.provider : undefined;
	const enqueuedAt = typeof record.enqueuedAt === "string" && record.enqueuedAt.trim() ? record.enqueuedAt : undefined;
	if (!id || !jobId || !provider || !enqueuedAt) return undefined;
	return {
		schema: PENDING_TERMINATE_SCHEMA,
		id,
		jobId,
		provider,
		...(typeof record.remoteHandle === "string" && record.remoteHandle.trim() ? { remoteHandle: record.remoteHandle } : {}),
		enqueuedAt,
		attempts: typeof record.attempts === "number" && Number.isFinite(record.attempts) ? record.attempts : 0,
		status: "pending",
	};
}

export function readComputePendingTerminateRecords(workingDir: string): WorkbenchComputePendingTerminateRecord[] {
	const filePath = pendingTerminatePath(workingDir);
	if (!existsSync(filePath)) return [];
	return readFileSync(filePath, "utf8")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.flatMap((line) => {
			try {
				const record = normalizeStoredRecord(JSON.parse(line));
				return record ? [record] : [];
			} catch {
				return [];
			}
		});
}

export function recordComputePendingTerminate(
	workingDir: string,
	input: { jobId: string; provider: string; remoteHandle?: string },
): WorkbenchComputePendingTerminateRecord {
	const existing = readComputePendingTerminateRecords(workingDir).find((record) =>
		record.jobId === input.jobId && record.provider === input.provider && record.status === "pending"
	);
	if (existing) return existing;
	const record: WorkbenchComputePendingTerminateRecord = {
		schema: PENDING_TERMINATE_SCHEMA,
		id: randomUUID(),
		jobId: input.jobId,
		provider: input.provider,
		...(input.remoteHandle ? { remoteHandle: input.remoteHandle } : {}),
		enqueuedAt: new Date().toISOString(),
		attempts: 0,
		status: "pending",
	};
	const filePath = pendingTerminatePath(workingDir);
	mkdirSync(dirname(filePath), { recursive: true });
	appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
	return record;
}
