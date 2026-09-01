import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";

import type {
	WorkbenchComputeJobRecord,
	WorkbenchExecutionRecord,
	WorkbenchExecutionStatus,
} from "./types.js";

const MODEL_ENDPOINT_OUTPUT_EXTENSIONS = [".pdb", ".json", ".txt"] as const;
const MODEL_ENDPOINT_DIR = ["outputs", "model-endpoints"] as const;
const MAX_MODEL_ENDPOINT_RECORDS = 120;

type ModelEndpointUsageRecord = {
	id: string;
	stem: string;
	model: string;
	modelName: string;
	providerId: string;
	providerName: string;
	endpoint: string;
	auth: string;
	statusCode?: number;
	statusText?: string;
	status: WorkbenchExecutionStatus;
	sequenceLength?: number;
	outputFormat?: string;
	outputPaths: string[];
	provenancePath: string;
	updatedAt: string;
	updatedAtMs: number;
	command: string;
	detail: string;
	details: string;
};

function toPosixPath(path: string): string {
	return path.split(sep).join("/");
}

function bulletValue(text: string, label: string): string | undefined {
	const match = text.match(new RegExp(`^- ${label}:\\s*(.+)$`, "m"));
	return match?.[1]?.trim();
}

function modelName(model: string): string {
	if (model.toLowerCase() === "esmfold") return "ESMFold";
	if (model.toLowerCase() === "alphafold2") return "AlphaFold2";
	return model;
}

function providerName(providerId: string): string {
	if (providerId === "nvidia-bionemo") return "NVIDIA BioNeMo NIM";
	return providerId;
}

function statusFromCode(statusCode: number | undefined): WorkbenchExecutionStatus {
	if (statusCode === undefined) return "complete";
	return statusCode >= 200 && statusCode < 300 ? "complete" : "error";
}

function parseStatus(value: string | undefined): { code?: number; text?: string; status: WorkbenchExecutionStatus } {
	if (!value) return { status: "complete" };
	const match = value.match(/^(\d{3})(?:\s+(.+))?$/);
	const code = match ? Number(match[1]) : undefined;
	const text = match?.[2]?.trim() || value;
	return {
		...(Number.isFinite(code) ? { code } : {}),
		...(text ? { text } : {}),
		status: statusFromCode(Number.isFinite(code) ? code : undefined),
	};
}

function parseModelFromHeading(text: string, fallbackStem: string): string {
	const match = text.match(/^#\s+([A-Za-z0-9_-]+)\s+model endpoint provenance\s*$/m);
	if (match?.[1]) return match[1].toLowerCase();
	const stemMatch = fallbackStem.match(/^([A-Za-z0-9_-]+)-/);
	return (stemMatch?.[1] ?? "model-endpoint").toLowerCase();
}

function relativeExistingOutputPath(workingDir: string, provenancePath: string, stem: string): string | undefined {
	const dir = dirname(provenancePath);
	for (const extension of MODEL_ENDPOINT_OUTPUT_EXTENSIONS) {
		const candidate = resolve(dir, `${stem}${extension}`);
		if (existsSync(candidate)) return toPosixPath(relative(workingDir, candidate));
	}
	return undefined;
}

function newestTimestampMs(paths: string[], workingDir: string): number {
	const values = paths.flatMap((path) => {
		try {
			return [statSync(resolve(workingDir, path)).mtimeMs];
		} catch {
			return [];
		}
	});
	return values.length ? Math.max(...values) : Date.now();
}

function parseModelEndpointUsageRecord(workingDir: string, provenanceAbsPath: string): ModelEndpointUsageRecord | undefined {
	const provenanceName = basename(provenanceAbsPath);
	if (!provenanceName.endsWith(".provenance.md")) return undefined;
	const stem = provenanceName.slice(0, -".provenance.md".length);
	let text = "";
	try {
		text = readFileSync(provenanceAbsPath, "utf8");
	} catch {
		return undefined;
	}
	if (!/model endpoint provenance/i.test(text)) return undefined;

	const model = parseModelFromHeading(text, stem);
	const providerId = bulletValue(text, "Provider") ?? "nvidia-bionemo";
	const endpoint = bulletValue(text, "Endpoint") ?? "";
	const auth = bulletValue(text, "Auth") ?? "none";
	const parsedStatus = parseStatus(bulletValue(text, "Status"));
	const sequenceLength = Number(bulletValue(text, "Sequence length"));
	const outputFormat = bulletValue(text, "Output format");
	const provenancePath = toPosixPath(relative(workingDir, provenanceAbsPath));
	const outputPath = relativeExistingOutputPath(workingDir, provenanceAbsPath, stem);
	const outputPaths = [outputPath, provenancePath].filter((path): path is string => Boolean(path));
	const updatedAtMs = newestTimestampMs(outputPaths, workingDir);
	const updatedAt = new Date(updatedAtMs).toISOString();
	const providerLabel = providerName(providerId);
	const modelLabel = modelName(model);
	const statusLabel = [
		parsedStatus.code,
		parsedStatus.text,
	].filter(Boolean).join(" ") || parsedStatus.status;
	const detail = [
		`${statusLabel}`,
		`${providerLabel} / ${modelLabel}`,
		Number.isFinite(sequenceLength) ? `${sequenceLength} residues` : undefined,
		outputFormat ? `${outputFormat} output` : undefined,
	].filter(Boolean).join(" / ");
	const command = [
		"feynman_model_endpoint_call",
		`--provider ${providerId}`,
		`--model ${model}`,
		endpoint ? `--endpoint ${endpoint}` : undefined,
	].filter(Boolean).join(" ");
	const details = JSON.stringify({
		provider: providerId,
		model,
		endpoint,
		auth,
		status: statusLabel,
		...(Number.isFinite(sequenceLength) ? { sequenceLength } : {}),
		...(outputFormat ? { outputFormat } : {}),
		provenancePath,
	}, null, 2);

	return {
		id: `model-endpoint:${stem}`,
		stem,
		model,
		modelName: modelLabel,
		providerId,
		providerName: providerLabel,
		endpoint,
		auth,
		...(parsedStatus.code !== undefined ? { statusCode: parsedStatus.code } : {}),
		...(parsedStatus.text ? { statusText: parsedStatus.text } : {}),
		status: parsedStatus.status,
		...(Number.isFinite(sequenceLength) ? { sequenceLength } : {}),
		...(outputFormat ? { outputFormat } : {}),
		outputPaths,
		provenancePath,
		updatedAt,
		updatedAtMs,
		command,
		detail,
		details,
	};
}

function readModelEndpointUsageRecords(workingDir: string): ModelEndpointUsageRecord[] {
	const dir = resolve(workingDir, ...MODEL_ENDPOINT_DIR);
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((name) => name.endsWith(".provenance.md"))
		.flatMap((name) => {
			const record = parseModelEndpointUsageRecord(workingDir, resolve(dir, name));
			return record ? [record] : [];
		})
		.sort((a, b) => b.updatedAtMs - a.updatedAtMs || a.id.localeCompare(b.id))
		.slice(0, MAX_MODEL_ENDPOINT_RECORDS);
}

export function buildComputeJobsFromModelEndpointRecords(workingDir: string): WorkbenchComputeJobRecord[] {
	return readModelEndpointUsageRecords(workingDir).map((record) => ({
		id: `compute:${record.id}`,
		title: `Model endpoint: ${record.modelName}`,
		providerId: record.providerId,
		providerName: record.providerName,
		family: "Model endpoint",
		status: record.status,
		tierType: "cloud",
		intent: "exploration",
		sessionId: "model-endpoints",
		projectId: "workspace",
		runSlug: "model-endpoints",
		language: record.model,
		environment: `${record.providerName} / ${record.modelName}`,
		command: record.command,
		cwd: workingDir,
		executionId: record.id,
		hardwareDetails: record.auth === "NVIDIA_API_KEY" ? "Hosted NVIDIA BioNeMo/NIM endpoint" : "Self-hosted model endpoint",
		detail: record.detail,
		...(record.status === "error" ? { error: record.detail } : {}),
		inputPaths: [],
		outputPaths: record.outputPaths,
		startedAt: record.updatedAt,
		startedAtMs: record.updatedAtMs,
		endedAt: record.updatedAt,
		endedAtMs: record.updatedAtMs,
		durationMs: 0,
	}));
}

export function buildModelEndpointExecutionRecords(workingDir: string, runSlugs: Set<string>): WorkbenchExecutionRecord[] {
	return readModelEndpointUsageRecords(workingDir).map((record) => ({
		id: record.id,
		title: `Model endpoint: ${record.modelName}`,
		kind: "tool",
		status: record.status,
		origin: "workspace",
		createdAt: record.updatedAt,
		createdAtMs: record.updatedAtMs,
		detail: record.detail,
		purpose: "exploration",
		...(runSlugs.has("model-endpoints") ? { runSlug: "model-endpoints" } : {}),
		sessionId: "model-endpoints",
		language: record.model,
		environment: `${record.providerName} / ${record.modelName}`,
		sourceId: record.provenancePath,
		code: record.command,
		details: record.details,
		inputPaths: [],
		outputPaths: record.outputPaths,
	}));
}
