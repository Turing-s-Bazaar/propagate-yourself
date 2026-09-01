import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { registerHuggingFaceTools } from "../extensions/research-tools/huggingface.js";

type Tool = {
	name: string;
	promptSnippet?: string;
	promptGuidelines?: string[];
	execute: (toolCallId: string, params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; details: unknown }>;
};

const originalFetch = globalThis.fetch;
const originalToken = process.env.HF_TOKEN;
const originalHubToken = process.env.HUGGINGFACE_HUB_TOKEN;

afterEach(() => {
	globalThis.fetch = originalFetch;
	process.env.HF_TOKEN = originalToken;
	process.env.HUGGINGFACE_HUB_TOKEN = originalHubToken;
});

function registerTools(): Map<string, Tool> {
	const tools = new Map<string, Tool>();
	registerHuggingFaceTools({
		registerTool(tool: Tool) {
			tools.set(tool.name, tool);
		},
	} as never);
	return tools;
}

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

test("Hugging Face tools register read-only dataset, tree, and file readers", async () => {
	process.env.HF_TOKEN = "hf_test";
	const requests: Array<{ url: string; authorization?: string }> = [];
	globalThis.fetch = async (input, init) => {
		const url = String(input);
		const headers = init?.headers as Record<string, string> | undefined;
		requests.push({ url, authorization: headers?.Authorization });
		if (url.includes("/api/datasets/")) {
			return jsonResponse({
				id: "org/test-dataset",
				cardData: { dataset_info: { features: { text: { dtype: "string" } }, splits: [{ name: "train" }] } },
				siblings: [{ rfilename: "README.md" }],
			});
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tools = registerTools();
	const result = await tools.get("hf_dataset_info")?.execute("call-1", { dataset: "org/test-dataset" });
	const details = result?.details as Record<string, unknown>;

	assert.equal(tools.has("hf_dataset_info"), true);
	assert.equal(tools.has("hf_repo_files"), true);
	assert.equal(tools.has("hf_repo_read_file"), true);
	assert.equal(details.id, "org/test-dataset");
	assert.deepEqual(details.datasetInfo, { features: { text: { dtype: "string" } }, splits: [{ name: "train" }] });
	assert.equal(details.url, "https://huggingface.co/datasets/org/test-dataset");
	assert.equal(requests[0]?.url, "https://huggingface.co/api/datasets/org/test-dataset");
	assert.equal(requests[0]?.authorization, "Bearer hf_test");
	assert.match(tools.get("hf_dataset_info")?.promptSnippet ?? "", /dataset metadata/);
	assert.match(tools.get("hf_repo_files")?.promptGuidelines?.[0] ?? "", /before hf_repo_read_file/);
});

test("Hugging Face repo file tools encode repo paths, cap limits, and truncate file reads", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = String(input);
		requests.push(url);
		if (url.includes("/tree/")) {
			return jsonResponse([{ path: "README.md" }, { path: "config.json" }, { path: "weights.safetensors" }]);
		}
		if (url.includes("/resolve/")) {
			return new Response("abcdef", { status: 200, headers: { "content-type": "text/plain" } });
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tools = registerTools();
	const files = await tools.get("hf_repo_files")?.execute("call-2", {
		repo: "openai-community/gpt2",
		repoType: "model",
		revision: "main",
		recursive: true,
		limit: 2,
	});
	const fileDetails = files?.details as Record<string, unknown>;
	const read = await tools.get("hf_repo_read_file")?.execute("call-3", {
		repo: "org/test-space",
		repoType: "space",
		path: "/README.md",
		maxChars: 3,
	});
	const readDetails = read?.details as Record<string, unknown>;

	assert.equal(requests[0], "https://huggingface.co/api/models/openai-community/gpt2/tree/main?recursive=true");
	assert.equal(fileDetails.count, 3);
	assert.equal(fileDetails.truncated, true);
	assert.equal((fileDetails.files as unknown[]).length, 2);
	assert.equal(requests[1], "https://huggingface.co/spaces/org/test-space/resolve/main/README.md");
	assert.equal(readDetails.truncated, true);
	assert.equal(readDetails.content, "abc\n\n[truncated: 3 chars omitted]");
});

test("Hugging Face file reader refuses likely large or binary files before download", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		requests.push(String(input));
		return new Response("not reached", { status: 200 });
	};

	const tools = registerTools();
	await assert.rejects(
		async () => tools.get("hf_repo_read_file")!.execute("call-4", {
			repo: "openai-community/gpt2",
			repoType: "model",
			path: "model.safetensors",
		}),
		/Refusing to read likely large or binary Hugging Face file/,
	);
	assert.deepEqual(requests, []);
});
