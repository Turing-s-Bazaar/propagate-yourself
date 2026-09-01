import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type ModelEndpointModel = "alphafold2" | "esmfold";
type ModelEndpointProvider = "nvidia-bionemo";

type ModelEndpointParams = {
	databases?: string[];
	endpointUrl?: string;
	iterations?: number;
	model: ModelEndpointModel;
	provider: ModelEndpointProvider;
	relaxPrediction?: boolean;
	sequence: string;
	timeoutMs?: number;
};

type EndpointOutput = {
	contentType: string;
	format: "json" | "pdb" | "text";
	json?: unknown;
	text?: string;
	textPreview?: string;
};

type ModelEndpointResult = {
	schema: "feynman.modelEndpointCall.v1";
	provider: ModelEndpointProvider;
	model: ModelEndpointModel;
	endpoint: string;
	auth: "NVIDIA_API_KEY" | "none";
	status: number;
	statusText: string;
	sequenceLength: number;
	request: Record<string, unknown>;
	output: EndpointOutput;
	artifactPaths: string[];
	provenance: {
		docs: string[];
		endpoints: string[];
	};
};

const NVIDIA_ESMFOLD_ENDPOINT = "https://health.api.nvidia.com/v1/biology/nvidia/esmfold";
const LOCAL_ALPHAFOLD2_SEQUENCE_ENDPOINT = "http://localhost:8000/protein-structure/alphafold2/predict-structure-from-sequence";
const ESMFOLD_DOCS = "https://docs.api.nvidia.com/nim/reference/meta-esmfold-infer";
const ALPHAFOLD2_DOCS = "https://docs.nvidia.com/nim/bionemo/alphafold2/latest/endpoints.html";
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_SEQUENCE_LENGTH = 1_024;
const MAX_INLINE_TEXT_CHARS = 24_000;
const PROTEIN_SEQUENCE_PATTERN = /^[ACDEFGHIKLMNPQRSTVWYBXZJUO]+$/;

function toPosixPath(path: string): string {
	return path.split(sep).join("/");
}

function normalizeProteinSequence(value: string): string {
	const sequence = value
		.split(/\r?\n/)
		.filter((line) => !line.trim().startsWith(">"))
		.join("")
		.replace(/\s+/g, "")
		.toUpperCase();
	if (!sequence) throw new Error("Model endpoint calls require a non-empty protein sequence.");
	if (sequence.length > MAX_SEQUENCE_LENGTH) {
		throw new Error(`Protein sequence length ${sequence.length} exceeds the ${MAX_SEQUENCE_LENGTH} residue hosted endpoint limit.`);
	}
	if (!PROTEIN_SEQUENCE_PATTERN.test(sequence)) {
		throw new Error("Protein sequence contains unsupported residue symbols. Use amino-acid residue letters only.");
	}
	return sequence;
}

function safeTimeoutMs(value: number | undefined): number {
	if (!Number.isFinite(value) || value === undefined) return DEFAULT_TIMEOUT_MS;
	return Math.max(1_000, Math.min(Math.floor(value), MAX_TIMEOUT_MS));
}

function endpointForParams(params: ModelEndpointParams): URL {
	if (params.endpointUrl?.trim()) return new URL(params.endpointUrl.trim());
	if (params.model === "alphafold2") return new URL(LOCAL_ALPHAFOLD2_SEQUENCE_ENDPOINT);
	return new URL(NVIDIA_ESMFOLD_ENDPOINT);
}

function shouldUseNvidiaAuth(endpoint: URL): boolean {
	return endpoint.hostname === "health.api.nvidia.com" || endpoint.hostname.endsWith(".nvidia.com");
}

function requestBody(params: ModelEndpointParams, sequence: string): Record<string, unknown> {
	if (params.model === "alphafold2") {
		return {
			sequence,
			...(params.databases?.length ? { databases: params.databases } : {}),
			...(Number.isFinite(params.iterations) ? { iterations: params.iterations } : {}),
			...(params.relaxPrediction === undefined ? {} : { relax_prediction: params.relaxPrediction }),
		};
	}
	return { sequence };
}

function outputFromText(contentType: string, text: string): EndpointOutput {
	const trimmed = text.trim();
	if (contentType.includes("json") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
		try {
			return { contentType, format: "json", json: JSON.parse(text) as unknown };
		} catch {
			// Some providers return text/plain for status pages or partial JSON. Preserve the text below.
		}
	}
	const isPdb = /^(ATOM|HETATM|HEADER|MODEL|REMARK)\b/m.test(trimmed);
	return {
		contentType,
		format: isPdb ? "pdb" : "text",
		text,
		textPreview: text.length > MAX_INLINE_TEXT_CHARS
			? `${text.slice(0, MAX_INLINE_TEXT_CHARS)}\n...[truncated ${text.length - MAX_INLINE_TEXT_CHARS} characters]`
			: text,
	};
}

function responseBodyForArtifact(output: EndpointOutput): { extension: "json" | "pdb" | "txt"; text: string } {
	if (output.format === "json") {
		return { extension: "json", text: JSON.stringify(output.json, null, 2) };
	}
	if (output.format === "pdb") {
		return { extension: "pdb", text: output.text ?? "" };
	}
	return { extension: "txt", text: output.text ?? "" };
}

function writeArtifacts(cwd: string, result: Omit<ModelEndpointResult, "artifactPaths">): string[] {
	const artifact = responseBodyForArtifact(result.output);
	const hash = createHash("sha256").update(`${result.model}:${result.endpoint}:${result.request.sequenceLength ?? result.sequenceLength}`).digest("hex").slice(0, 12);
	const timestamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
	const dir = resolve(cwd, "outputs", "model-endpoints");
	const basename = `${result.model}-${hash}-${timestamp}`;
	const outputPath = resolve(dir, `${basename}.${artifact.extension}`);
	const provenancePath = resolve(dir, `${basename}.provenance.md`);
	mkdirSync(dir, { recursive: true });
	writeFileSync(outputPath, artifact.text);
	writeFileSync(provenancePath, [
		`# ${result.model} model endpoint provenance`,
		"",
		`- Provider: ${result.provider}`,
		`- Endpoint: ${result.endpoint}`,
		`- Auth: ${result.auth}`,
		`- Status: ${result.status} ${result.statusText}`,
		`- Sequence length: ${result.sequenceLength}`,
		`- Output format: ${result.output.format}`,
		"- Source docs:",
		...result.provenance.docs.map((doc) => `  - ${doc}`),
		"",
	].join("\n"));
	return [outputPath, provenancePath].map((path) => toPosixPath(relative(cwd, path)));
}

async function postModelEndpoint(params: ModelEndpointParams, signal?: AbortSignal): Promise<ModelEndpointResult> {
	if (params.provider !== "nvidia-bionemo") throw new Error(`Unsupported model endpoint provider: ${params.provider}`);
	if (params.model !== "esmfold" && params.model !== "alphafold2") throw new Error(`Unsupported model endpoint model: ${params.model}`);

	const sequence = normalizeProteinSequence(params.sequence);
	const endpoint = endpointForParams(params);
	const useNvidiaAuth = shouldUseNvidiaAuth(endpoint);
	const apiKey = process.env.NVIDIA_API_KEY?.trim();
	if (useNvidiaAuth && !apiKey) {
		throw new Error("NVIDIA_API_KEY is required for NVIDIA-hosted BioNeMo/NIM model endpoint calls.");
	}
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), safeTimeoutMs(params.timeoutMs));
	const abort = () => controller.abort(signal?.reason);
	signal?.addEventListener("abort", abort, { once: true });
	try {
		const body = requestBody(params, sequence);
		const response = await fetch(endpoint, {
			method: "POST",
			headers: {
				accept: "application/json, text/plain, */*",
				"content-type": "application/json",
				...(useNvidiaAuth ? { authorization: `Bearer ${apiKey}` } : {}),
			},
			body: JSON.stringify(body),
			signal: controller.signal,
		});
		const text = await response.text();
		if (!response.ok) {
			throw new Error(`Model endpoint request failed: ${response.status} ${response.statusText}${text ? `: ${text.slice(0, 500)}` : ""}`);
		}
		const output = outputFromText(response.headers.get("content-type") ?? "application/octet-stream", text);
		const docs = params.model === "alphafold2" ? [ALPHAFOLD2_DOCS] : [ESMFOLD_DOCS];
		const resultWithoutArtifacts = {
			schema: "feynman.modelEndpointCall.v1" as const,
			provider: params.provider,
			model: params.model,
			endpoint: endpoint.toString(),
			auth: useNvidiaAuth ? "NVIDIA_API_KEY" as const : "none" as const,
			status: response.status,
			statusText: response.statusText,
			sequenceLength: sequence.length,
			request: {
				model: params.model,
				sequenceLength: sequence.length,
				...(params.model === "alphafold2" ? {
					databases: params.databases ?? [],
					iterations: params.iterations,
					relaxPrediction: params.relaxPrediction,
				} : {}),
			},
			output,
			provenance: {
				docs,
				endpoints: [endpoint.toString()],
			},
		};
		const artifactPaths = writeArtifacts(process.cwd(), resultWithoutArtifacts);
		return { ...resultWithoutArtifacts, artifactPaths };
	} finally {
		clearTimeout(timeout);
		signal?.removeEventListener("abort", abort);
	}
}

function formatToolText(result: ModelEndpointResult): string {
	const printable = {
		...result,
		output: result.output.format === "json"
			? result.output
			: {
				contentType: result.output.contentType,
				format: result.output.format,
				textPreview: result.output.textPreview,
			},
	};
	return JSON.stringify(printable, null, 2);
}

// Pi converts Type.Array inputs before validating them, which would turn null into ["null"].
// Preserve the JSON Schema array contract without the Type.Array conversion marker.
const modelDatabasesSchema = Type.Unsafe<string[]>({
	type: "array",
	items: Type.String(),
	description: "AlphaFold2 database names, for example uniref90, mgnify, or small_bfd.",
});

export function registerModelEndpointTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "feynman_model_endpoint_call",
		label: "Feynman Model Endpoint Call",
		description:
			"Call configured Feynman-owned scientific model endpoints. Supports NVIDIA BioNeMo/NIM ESMFold hosted calls through NVIDIA_API_KEY and self-hosted AlphaFold2 NIM sequence prediction endpoints.",
		promptSnippet: "Run a Feynman scientific model endpoint call and save the returned structure or response as a provenance-backed artifact.",
		promptGuidelines: [
			"Use feynman_model_endpoint_call when a research chat needs a model-backed biology inference result, such as ESMFold or AlphaFold2 structure prediction.",
			"For hosted ESMFold, use provider nvidia-bionemo, model esmfold, and a protein sequence; NVIDIA_API_KEY must be present and is never returned.",
			"For self-hosted AlphaFold2 NIM, use provider nvidia-bionemo, model alphafold2, and endpointUrl when the service is not running at localhost:8000.",
			"Preserve artifactPaths and provenance docs in downstream research artifacts. Verify decisive biological claims against the source model docs and saved output.",
		],
		parameters: Type.Object({
			provider: Type.Literal("nvidia-bionemo", { description: "Scientific model endpoint provider." }),
			model: Type.Union([
				Type.Literal("esmfold"),
				Type.Literal("alphafold2"),
			], { description: "Model endpoint to call. esmfold defaults to NVIDIA-hosted ESMFold; alphafold2 defaults to a local/self-hosted NIM endpoint." }),
			sequence: Type.String({ description: "Protein amino-acid sequence. FASTA headers and whitespace are ignored. Maximum hosted length is 1024 residues." }),
			endpointUrl: Type.Optional(Type.String({ description: "Override endpoint URL. Use this for self-hosted/local NIM endpoints or test endpoints." })),
			databases: Type.Optional(modelDatabasesSchema),
			iterations: Type.Optional(Type.Number({ description: "AlphaFold2 MSA iterations. Defaults to provider behavior." })),
			relaxPrediction: Type.Optional(Type.Boolean({ description: "AlphaFold2 relax_prediction flag. Defaults to provider behavior." })),
			timeoutMs: Type.Optional(Type.Number({ description: `Request timeout in milliseconds. Defaults to ${DEFAULT_TIMEOUT_MS}.` })),
		}),
		async execute(_toolCallId, params, signal) {
			const result = await postModelEndpoint(params as ModelEndpointParams, signal);
			return {
				content: [{ type: "text", text: formatToolText(result) }],
				details: result,
			};
		},
	});
}

export const testableModelEndpoints = {
	ALPHAFOLD2_DOCS,
	ESMFOLD_DOCS,
	LOCAL_ALPHAFOLD2_SEQUENCE_ENDPOINT,
	NVIDIA_ESMFOLD_ENDPOINT,
	normalizeProteinSequence,
	postModelEndpoint,
};
