import { createHash } from "node:crypto";

import type { WorkbenchComputeJobRecord, WorkbenchComputePendingTerminate, WorkbenchPollerLease } from "./types.js";

const POLLER_LEASE_TTL_MS = 2 * 60 * 1000;

function holderForParts(parts: string[]): string {
	const digest = createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 32);
	return `poller-${digest}`;
}

function activeComputeJobs(computeJobs: WorkbenchComputeJobRecord[]): WorkbenchComputeJobRecord[] {
	return computeJobs.filter((job) => job.status === "running" || job.status === "queued" || job.pendingTermination);
}

export function buildWorkbenchPollerLeases({
	computeJobs,
	computePendingTerminates,
	nowMs = Date.now(),
}: {
	computeJobs: WorkbenchComputeJobRecord[];
	computePendingTerminates: WorkbenchComputePendingTerminate[];
	nowMs?: number;
}): WorkbenchPollerLease[] {
	const activeJobs = activeComputeJobs(computeJobs);
	if (!activeJobs.length && !computePendingTerminates.length) return [];
	const activeJobIds = activeJobs.map((job) => job.id).sort((a, b) => a.localeCompare(b));
	const pendingTerminateIds = computePendingTerminates.map((record) => record.sandboxId).sort((a, b) => a.localeCompare(b));
	const holder = holderForParts(["*", ...activeJobIds, ...pendingTerminateIds]);
	const expiresAtMs = nowMs + POLLER_LEASE_TTL_MS;
	return [{
		provider: "*",
		holder,
		expiresAt: new Date(expiresAtMs).toISOString(),
		expiresAtMs,
		source: "compute-polling",
		activeJobIds,
		pendingTerminateIds,
	}];
}
