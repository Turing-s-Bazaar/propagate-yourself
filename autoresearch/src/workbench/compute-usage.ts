import { createHash } from "node:crypto";
import { sep } from "node:path";

import type {
	WorkbenchComputePendingTerminate,
	WorkbenchComputeJobRecord,
	WorkbenchComputeTierType,
	WorkbenchComputeUsageRecord,
	WorkbenchExecutionStatus,
} from "./types.js";
import type {
	WorkbenchNotebookActiveExecutionRecord,
	WorkbenchNotebookExecutionMode,
	WorkbenchNotebookExecutionRecord,
} from "./notebook-execution.js";
import type { WorkbenchComputePendingTerminateRecord } from "./compute-lifecycle.js";

const ACTIVE_COMPUTE_TTL_MS = 24 * 60 * 60 * 1000;

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

function toPosixPath(path: string): string {
	return path.split(sep).join("/");
}

function plural(count: number, singular: string, pluralValue = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : pluralValue}`;
}

function boundedText(value: string, limit = 480): string {
	const cleaned = value.trim();
	if (cleaned.length <= limit) return cleaned;
	return `${cleaned.slice(0, limit).trimEnd()}...`;
}

function modalRemoteUrl(text: string): string | undefined {
	const match = text.match(/https:\/\/modal\.com\/apps\/[^\s)"'<>]+/);
	return match ? match[0].replace(/[.,;:]+$/, "") : undefined;
}

function modalRemoteHandle(url: string | undefined): string | undefined {
	if (!url) return undefined;
	const match = url.match(/\/(ap-[A-Za-z0-9_-]+)(?:[/?#]|$)/);
	return match?.[1];
}

function scriptPath(command: string): string | undefined {
	const match = command.match(/\brun\s+([^\s]+\.py)\b/);
	return match ? toPosixPath(match[1]) : undefined;
}

function providerForMode(mode: WorkbenchNotebookExecutionMode): {
	family: string;
	hardwareDetails?: string;
	providerId: string;
	providerName: string;
	tierType: WorkbenchComputeTierType;
} {
	if (mode === "modal") {
		return {
			family: "Modal",
			hardwareDetails: "Modal serverless Python container",
			providerId: "modal",
			providerName: "Modal cloud",
			tierType: "cloud",
		};
	}
	if (mode === "session") {
		return {
			family: "Feynman",
			hardwareDetails: "Persistent local notebook kernel",
			providerId: "local-kernel",
			providerName: "Session kernel",
			tierType: "session",
		};
	}
	return {
		family: "Feynman",
		hardwareDetails: "Isolated local process",
		providerId: "local-process",
		providerName: "Local process",
		tierType: "local",
	};
}

function statusLabel(status: WorkbenchExecutionStatus): string {
	if (status === "complete") return "completed";
	if (status === "stopped") return "stopped";
	if (status === "error") return "failed";
	if (status === "running") return "running";
	if (status === "queued") return "queued";
	return status;
}

function jobDetail(record: WorkbenchNotebookExecutionRecord, providerName: string): string {
	const parts = [
		`${statusLabel(record.status)} in ${record.durationMs}ms`,
		`${providerName} / ${record.language}`,
		record.outputPaths.length ? plural(record.outputPaths.length, "output") : "no tracked outputs",
	];
	return parts.join(" / ");
}

function jobError(record: WorkbenchNotebookExecutionRecord): string | undefined {
	if (record.status !== "error" && record.status !== "stopped") return undefined;
	return boundedText(record.stderr || record.stdout || record.signal || "Execution did not complete.");
}

function pendingTerminateForJob(
	pendingTerminates: WorkbenchComputePendingTerminateRecord[],
	jobId: string,
	remoteHandle?: string,
): WorkbenchComputePendingTerminateRecord | undefined {
	return pendingTerminates.find((record) =>
		record.jobId === jobId ||
		record.jobId === `compute:${jobId}` ||
		(Boolean(remoteHandle) && record.remoteHandle === remoteHandle)
	);
}

function buildStoredComputeJob(
	record: WorkbenchNotebookExecutionRecord,
	pendingTerminates: WorkbenchComputePendingTerminateRecord[],
): WorkbenchComputeJobRecord {
	const provider = providerForMode(record.executionMode);
	const remoteUrl = record.executionMode === "modal" ? modalRemoteUrl(`${record.stdout}\n${record.stderr}\n${record.command}`) : undefined;
	const remoteHandle = record.executionMode === "modal" ? modalRemoteHandle(remoteUrl) : record.kernelId;
	const endedAtMs = Date.parse(record.updatedAt);
	const startedAtMs = Number.isFinite(endedAtMs) ? Math.max(0, endedAtMs - record.durationMs) : Date.parse(record.createdAt);
	const pendingTerminate = pendingTerminateForJob(pendingTerminates, record.id, remoteHandle);
	return {
		id: `compute:${record.id}`,
		title: record.purpose === "verification" ? `Verification compute: ${record.title}` : `Notebook compute: ${record.title}`,
		providerId: provider.providerId,
		providerName: provider.providerName,
		family: provider.family,
		status: record.status,
		tierType: provider.tierType,
		intent: record.purpose,
		sessionId: record.sessionId,
		projectId: record.projectId,
		...(record.runSlug ? { runSlug: record.runSlug } : {}),
		language: record.language,
		environment: `${provider.providerName} / ${record.language}`,
		command: record.command,
		cwd: record.cwd,
		executionId: `notebook:${record.id}`,
		...(remoteUrl ? { remoteUrl } : {}),
		...(remoteHandle ? { remoteHandle } : {}),
		...(scriptPath(record.command) ? { scriptPath: scriptPath(record.command) } : {}),
		...(provider.hardwareDetails ? { hardwareDetails: provider.hardwareDetails } : {}),
		...(pendingTerminate ? {
			pendingTermination: true,
			terminationDetail: `${pendingTerminate.provider} terminate queued ${pendingTerminate.enqueuedAt}`,
		} : {}),
		detail: pendingTerminate ? `${jobDetail(record, provider.providerName)} / terminate pending` : jobDetail(record, provider.providerName),
		...(jobError(record) ? { error: jobError(record) } : {}),
		inputPaths: record.inputPaths,
		outputPaths: record.outputPaths,
		startedAt: Number.isFinite(startedAtMs) ? new Date(startedAtMs).toISOString() : record.createdAt,
		startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : Date.parse(record.createdAt),
		endedAt: record.updatedAt,
		endedAtMs: Number.isFinite(endedAtMs) ? endedAtMs : Date.parse(record.updatedAt),
		durationMs: record.durationMs,
	};
}

function buildActiveComputeJob(
	record: WorkbenchNotebookActiveExecutionRecord,
	pendingTerminates: WorkbenchComputePendingTerminateRecord[],
): WorkbenchComputeJobRecord {
	const provider = providerForMode(record.executionMode);
	const nowMs = Date.now();
	const pendingTerminate = pendingTerminateForJob(pendingTerminates, record.id, record.kernelId);
	const durationMs = Math.max(0, nowMs - record.createdAtMs);
	const providerName = provider.providerName;
	const detailParts = [
		`${statusLabel(record.status)} for ${durationMs}ms`,
		`${providerName} / ${record.language}`,
		record.cancellationRequestedAt ? `stop requested ${record.cancellationRequestedAt}` : "",
		pendingTerminate ? "terminate pending" : "",
	].filter(Boolean);
	return {
		id: `compute:${record.id}`,
		title: record.purpose === "verification" ? `Verification compute: ${record.title}` : `Notebook compute: ${record.title}`,
		providerId: provider.providerId,
		providerName,
		family: provider.family,
		status: record.status,
		tierType: provider.tierType,
		intent: record.purpose,
		sessionId: record.sessionId,
		projectId: record.projectId,
		...(record.runSlug ? { runSlug: record.runSlug } : {}),
		language: record.language,
		environment: `${providerName} / ${record.language}`,
		command: record.command,
		cwd: record.cwd,
		executionId: `notebook:${record.id}`,
		...(record.kernelId ? { remoteHandle: record.kernelId } : {}),
		...(provider.hardwareDetails ? { hardwareDetails: provider.hardwareDetails } : {}),
		...(pendingTerminate ? {
			pendingTermination: true,
			terminationDetail: `${pendingTerminate.provider} terminate queued ${pendingTerminate.enqueuedAt}`,
		} : {}),
		detail: detailParts.join(" / "),
		inputPaths: record.inputPaths,
		outputPaths: [],
		startedAt: record.createdAt,
		startedAtMs: record.createdAtMs,
		endedAt: new Date(nowMs).toISOString(),
		endedAtMs: nowMs,
		durationMs,
	};
}

export function buildComputeJobsFromNotebookRecords(
	records: WorkbenchNotebookExecutionRecord[],
	activeRecords: WorkbenchNotebookActiveExecutionRecord[] = [],
	pendingTerminates: WorkbenchComputePendingTerminateRecord[] = [],
): WorkbenchComputeJobRecord[] {
	return [
		...activeRecords.map((record) => buildActiveComputeJob(record, pendingTerminates)),
		...records.map((record) => buildStoredComputeJob(record, pendingTerminates)),
	]
		.sort((a, b) => b.startedAtMs - a.startedAtMs || a.id.localeCompare(b.id));
}

export function buildWorkbenchComputeUsageRecords(
	computeJobs: WorkbenchComputeJobRecord[],
): WorkbenchComputeUsageRecord[] {
	return computeJobs.map((job) => {
		const active = job.status === "running" || job.status === "queued";
		const expiresAtMs = job.startedAtMs + ACTIVE_COMPUTE_TTL_MS;
		return {
			id: stableUuid("feynman-compute-usage", job.id),
			jobId: job.id,
			environment: job.environment,
			tierType: job.tierType,
			provider: job.providerId,
			...(job.sessionId ? { frameId: job.sessionId } : {}),
			...(job.projectId ? { projectId: job.projectId } : {}),
			startedAt: job.startedAt,
			startedAtMs: job.startedAtMs,
			...(!active ? { endedAt: job.endedAt, endedAtMs: job.endedAtMs } : {}),
			...(active ? { expiresAt: new Date(expiresAtMs).toISOString(), expiresAtMs } : {}),
			status: job.status,
		};
	}).sort((a, b) => b.startedAtMs - a.startedAtMs || a.jobId.localeCompare(b.jobId));
}

export function buildWorkbenchComputePendingTerminateRecords(
	pendingTerminates: WorkbenchComputePendingTerminateRecord[],
): WorkbenchComputePendingTerminate[] {
	return pendingTerminates.map((record) => {
		const sandboxId = record.remoteHandle || record.jobId;
		const enqueuedAtMs = timestampMs(record.enqueuedAt);
		return {
			sandboxId,
			provider: record.provider,
			enqueuedAt: record.enqueuedAt,
			enqueuedAtMs,
			attempts: record.attempts,
			jobId: record.jobId,
			...(record.remoteHandle ? { remoteHandle: record.remoteHandle } : {}),
			status: "pending" as const,
		};
	}).sort((a, b) => b.enqueuedAtMs - a.enqueuedAtMs || a.sandboxId.localeCompare(b.sandboxId));
}
