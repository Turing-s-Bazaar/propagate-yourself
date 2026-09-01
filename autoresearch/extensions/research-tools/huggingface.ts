import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type RepoType = "model" | "dataset" | "space";

const HF_API_BASE = "https://huggingface.co/api";
const HF_BASE = "https://huggingface.co";
const DEFAULT_FILE_LIMIT = 200;
const DEFAULT_READ_CHARS = 20_000;
const MAX_READ_CHARS = 60_000;
const BLOCKED_FILE_EXTENSIONS = new Set([
	".7z",
	".bin",
	".ckpt",
	".gguf",
	".h5",
	".joblib",
	".onnx",
	".ot",
	".parquet",
	".pt",
	".pth",
	".safetensors",
	".tar",
	".tgz",
	".zip",
]);

function encodeRepoId(repo: string): string {
	return repo
		.split("/")
		.map((part) => encodeURIComponent(part))
		.join("/");
}

function repoTypeApiSegment(repoType: RepoType): string {
	return repoType === "model" ? "models" : repoType === "dataset" ? "datasets" : "spaces";
}

function repoTypeResolvePrefix(repoType: RepoType): string {
	return repoType === "model" ? "" : repoType === "dataset" ? "datasets/" : "spaces/";
}

function authHeaders(): Record<string, string> {
	const token = process.env.HF_TOKEN ?? process.env.HUGGINGFACE_HUB_TOKEN;
	return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchJson(url: string): Promise<unknown> {
	const response = await fetch(url, { headers: authHeaders() });
	if (!response.ok) {
		throw new Error(`Hugging Face request failed: ${response.status} ${response.statusText}`);
	}
	return response.json();
}

function trimText(value: string, maxChars: number): string {
	if (value.length <= maxChars) return value;
	return `${value.slice(0, maxChars)}\n\n[truncated: ${value.length - maxChars} chars omitted]`;
}

function safeNumber(value: number | undefined, fallback: number, max: number): number {
	if (!Number.isFinite(value) || value === undefined) return fallback;
	return Math.max(1, Math.min(Math.floor(value), max));
}

function formatText(value: unknown): string {
	return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function fileExtension(path: string): string {
	const fileName = path.split("/").pop() ?? "";
	const dotIndex = fileName.lastIndexOf(".");
	return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : "";
}

function assertReadableHubFile(path: string): void {
	const extension = fileExtension(path);
	if (BLOCKED_FILE_EXTENSIONS.has(extension)) {
		throw new Error(`Refusing to read likely large or binary Hugging Face file: ${path}`);
	}
}

function extractDatasetInfo(cardData: unknown): unknown {
	if (!cardData || typeof cardData !== "object") return undefined;
	const record = cardData as Record<string, unknown>;
	return record.dataset_info ?? record.dataset_infos;
}

async function datasetInfo(dataset: string): Promise<unknown> {
	const encoded = encodeRepoId(dataset.trim());
	const data = await fetchJson(`${HF_API_BASE}/datasets/${encoded}`);
	const record = data as Record<string, unknown>;
	return {
		id: record.id,
		author: record.author,
		sha: record.sha,
		lastModified: record.lastModified,
		private: record.private,
		gated: record.gated,
		disabled: record.disabled,
		downloads: record.downloads,
		likes: record.likes,
		tags: record.tags,
		cardData: record.cardData,
		datasetInfo: extractDatasetInfo(record.cardData),
		siblings: record.siblings,
		url: `${HF_BASE}/datasets/${encoded}`,
	};
}

async function repoFiles(params: {
	repo: string;
	repoType: RepoType;
	revision?: string;
	path?: string;
	recursive?: boolean;
	limit?: number;
}): Promise<unknown> {
	const encoded = encodeRepoId(params.repo.trim());
	const revision = encodeURIComponent(params.revision?.trim() || "main");
	const cleanPath = params.path?.trim().replace(/^\/+/, "");
	const pathSuffix = cleanPath ? `/${cleanPath.split("/").map(encodeURIComponent).join("/")}` : "";
	const query = new URLSearchParams({ recursive: params.recursive ? "true" : "false" });
	const url = `${HF_API_BASE}/${repoTypeApiSegment(params.repoType)}/${encoded}/tree/${revision}${pathSuffix}?${query}`;
	const data = await fetchJson(url);
	const files = Array.isArray(data) ? data : [];
	const limit = safeNumber(params.limit, DEFAULT_FILE_LIMIT, 1000);
	return {
		repo: params.repo,
		repoType: params.repoType,
		revision: params.revision || "main",
		path: cleanPath || "",
		count: files.length,
		truncated: files.length > limit,
		files: files.slice(0, limit),
		url: `${HF_BASE}/${repoTypeResolvePrefix(params.repoType)}${encoded}/tree/${revision}${pathSuffix}`,
	};
}

async function readRepoFile(params: {
	repo: string;
	repoType: RepoType;
	path: string;
	revision?: string;
	maxChars?: number;
}): Promise<unknown> {
	const encoded = encodeRepoId(params.repo.trim());
	const revision = encodeURIComponent(params.revision?.trim() || "main");
	const cleanPath = params.path.trim().replace(/^\/+/, "");
	assertReadableHubFile(cleanPath);
	const filePath = cleanPath.split("/").map(encodeURIComponent).join("/");
	const url = `${HF_BASE}/${repoTypeResolvePrefix(params.repoType)}${encoded}/resolve/${revision}/${filePath}`;
	const response = await fetch(url, { headers: authHeaders() });
	if (!response.ok) {
		throw new Error(`Hugging Face file read failed: ${response.status} ${response.statusText}`);
	}
	const contentType = response.headers.get("content-type") ?? "";
	const text = await response.text();
	const maxChars = safeNumber(params.maxChars, DEFAULT_READ_CHARS, MAX_READ_CHARS);
	return {
		repo: params.repo,
		repoType: params.repoType,
		revision: params.revision || "main",
		path: cleanPath,
		contentType,
		sizeChars: text.length,
		truncated: text.length > maxChars,
		content: trimText(text, maxChars),
		url,
	};
}

export function registerHuggingFaceTools(pi: ExtensionAPI): void {
	const repoTypeSchema = Type.Optional(
		Type.Union([Type.Literal("model"), Type.Literal("dataset"), Type.Literal("space")], {
			description: "Hub repository type. Defaults to dataset.",
		}),
	);

	pi.registerTool({
		name: "hf_dataset_info",
		label: "HF Dataset Info",
		description:
			"Inspect Hugging Face dataset metadata, tags, card data, dataset_info features, splits, and sibling files. Uses HF_TOKEN or HUGGINGFACE_HUB_TOKEN when set.",
		promptSnippet: "Inspect Hugging Face dataset metadata, features, splits, tags, access status, and sibling files.",
		promptGuidelines: [
			"Use hf_dataset_info before calling a Hugging Face dataset usable in an ML recipe or replication plan.",
			"Treat hf_dataset_info feature and split details as evidence; if they are missing, mark schema or availability as unverified.",
		],
		parameters: Type.Object({
			dataset: Type.String({ description: "Dataset repo id, for example HuggingFaceH4/ultrachat_200k." }),
		}),
		async execute(_toolCallId, params) {
			const result = await datasetInfo(params.dataset);
			return { content: [{ type: "text", text: formatText(result) }], details: result };
		},
	});

	pi.registerTool({
		name: "hf_repo_files",
		label: "HF Repo Files",
		description:
			"List files in a Hugging Face model, dataset, or Space repo. Use this before reading files so large artifacts can be avoided.",
		promptSnippet: "List files in a Hugging Face model, dataset, or Space repository before reading specific small files.",
		promptGuidelines: [
			"Use hf_repo_files before hf_repo_read_file so large model weights, archives, and dataset shards can be avoided.",
		],
		parameters: Type.Object({
			repo: Type.String({ description: "Hub repo id, for example HuggingFaceH4/ultrachat_200k or openai-community/gpt2." }),
			repoType: repoTypeSchema,
			revision: Type.Optional(Type.String({ description: "Git revision, branch, tag, or commit. Defaults to main." })),
			path: Type.Optional(Type.String({ description: "Optional subdirectory path." })),
			recursive: Type.Optional(Type.Boolean({ description: "Whether to list recursively. Defaults to false." })),
			limit: Type.Optional(Type.Number({ description: "Maximum file entries to return. Defaults to 200, max 1000." })),
		}),
		async execute(_toolCallId, params) {
			const result = await repoFiles({
				repo: params.repo,
				repoType: (params.repoType ?? "dataset") as RepoType,
				revision: params.revision,
				path: params.path,
				recursive: params.recursive,
				limit: params.limit,
			});
			return { content: [{ type: "text", text: formatText(result) }], details: result };
		},
	});

	pi.registerTool({
		name: "hf_repo_read_file",
		label: "HF Read File",
		description:
			"Read a small text file from a Hugging Face model, dataset, or Space repo. Use for README, configs, dataset cards, examples, and scripts; avoid large data or weight files.",
		promptSnippet: "Read small text files from Hugging Face repos, such as README.md, configs, examples, and scripts.",
		promptGuidelines: [
			"Use hf_repo_read_file only for small text files from Hugging Face repos; do not use it for weights, archives, or dataset shards.",
		],
		parameters: Type.Object({
			repo: Type.String({ description: "Hub repo id, for example HuggingFaceH4/ultrachat_200k or openai-community/gpt2." }),
			repoType: repoTypeSchema,
			path: Type.String({ description: "File path inside the repo, for example README.md or config.json." }),
			revision: Type.Optional(Type.String({ description: "Git revision, branch, tag, or commit. Defaults to main." })),
			maxChars: Type.Optional(Type.Number({ description: "Maximum characters to return. Defaults to 20000, max 60000." })),
		}),
		async execute(_toolCallId, params) {
			const result = await readRepoFile({
				repo: params.repo,
				repoType: (params.repoType ?? "dataset") as RepoType,
				path: params.path,
				revision: params.revision,
				maxChars: params.maxChars,
			});
			return { content: [{ type: "text", text: formatText(result) }], details: result };
		},
	});
}
