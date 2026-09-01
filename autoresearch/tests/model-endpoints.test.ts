import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { registerModelEndpointTools, testableModelEndpoints } from "../extensions/research-tools/model-endpoints.js";

type Tool = {
	execute: (toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal) => Promise<{ content: Array<{ text: string }>; details: unknown }>;
	name: string;
	promptGuidelines?: string[];
	promptSnippet?: string;
};

type ModelEndpointDetails = {
	auth: string;
	artifactPaths: string[];
	endpoint: string;
	model: string;
	output: { format: string; textPreview?: string; json?: unknown };
	provenance: { docs: string[]; endpoints: string[] };
	request: Record<string, unknown>;
	sequenceLength: number;
};

const originalFetch = globalThis.fetch;
const originalNvidiaKey = process.env.NVIDIA_API_KEY;
const originalCwd = process.cwd();

afterEach(() => {
	globalThis.fetch = originalFetch;
	if (originalNvidiaKey === undefined) delete process.env.NVIDIA_API_KEY;
	else process.env.NVIDIA_API_KEY = originalNvidiaKey;
	process.chdir(originalCwd);
});

function registerTools(): Map<string, Tool> {
	const tools = new Map<string, Tool>();
	registerModelEndpointTools({
		registerTool(tool: Tool) {
			tools.set(tool.name, tool);
		},
	} as never);
	return tools;
}

function makeWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-model-endpoints-"));
	mkdirSync(join(root, "outputs"), { recursive: true });
	return root;
}

function parseJsonBody(init: RequestInit | undefined): Record<string, unknown> {
	const body = init?.body;
	if (typeof body !== "string") throw new Error("Expected JSON string request body.");
	return JSON.parse(body) as Record<string, unknown>;
}

test("feynman_model_endpoint_call runs hosted ESMFold with NVIDIA auth and writes PDB artifacts", async () => {
	const root = makeWorkspace();
	process.chdir(root);
	process.env.NVIDIA_API_KEY = "nvidia-test-key";
	const requests: Array<{ body: Record<string, unknown>; headers: Record<string, string>; url: string }> = [];
	try {
		globalThis.fetch = async (input, init) => {
			const headers = init?.headers as Record<string, string>;
			requests.push({
				body: parseJsonBody(init),
				headers,
				url: String(input),
			});
			return new Response("HEADER    TEST ESMFOLD\nATOM      1  N   MET A   1\nEND\n", {
				status: 200,
				statusText: "OK",
				headers: { "content-type": "text/plain" },
			});
		};

		const tool = registerTools().get("feynman_model_endpoint_call");
		const result = await tool?.execute("call-esmfold", {
			provider: "nvidia-bionemo",
			model: "esmfold",
			sequence: ">example\nMNVIDIAIAMAI",
		});
		const details = result?.details as ModelEndpointDetails;

		assert.equal(tool?.name, "feynman_model_endpoint_call");
		assert.equal(requests.length, 1);
		assert.equal(requests[0]?.url, testableModelEndpoints.NVIDIA_ESMFOLD_ENDPOINT);
		assert.equal(requests[0]?.headers.authorization, "Bearer nvidia-test-key");
		assert.deepEqual(requests[0]?.body, { sequence: "MNVIDIAIAMAI" });
		assert.equal(details.model, "esmfold");
		assert.equal(details.auth, "NVIDIA_API_KEY");
		assert.equal(details.output.format, "pdb");
		assert.equal(details.sequenceLength, "MNVIDIAIAMAI".length);
		assert.equal(details.provenance.docs.includes(testableModelEndpoints.ESMFOLD_DOCS), true);
		assert.equal(details.artifactPaths.length, 2);
		assert.equal(details.artifactPaths[0]?.endsWith(".pdb"), true);
		assert.equal(details.artifactPaths[1]?.endsWith(".provenance.md"), true);
		assert.equal(existsSync(join(root, details.artifactPaths[0] ?? "")), true);
		assert.match(readFileSync(join(root, details.artifactPaths[0] ?? ""), "utf8"), /ATOM/);
		assert.match(readFileSync(join(root, details.artifactPaths[1] ?? ""), "utf8"), /NVIDIA_API_KEY/);
		assert.doesNotMatch(result?.content[0]?.text ?? "", /nvidia-test-key/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("hosted ESMFold fails before network when NVIDIA_API_KEY is missing", async () => {
	const root = makeWorkspace();
	process.chdir(root);
	delete process.env.NVIDIA_API_KEY;
	try {
		globalThis.fetch = async () => {
			throw new Error("fetch should not run without NVIDIA_API_KEY");
		};

		const tool = registerTools().get("feynman_model_endpoint_call");
		await assert.rejects(
			() => tool!.execute("call-esmfold-missing-key", {
				provider: "nvidia-bionemo",
				model: "esmfold",
				sequence: "MNVIDIAIAMAI",
			}),
			/NVIDIA_API_KEY is required/,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("self-hosted AlphaFold2 endpoint runs without NVIDIA auth and writes JSON artifacts", async () => {
	const root = makeWorkspace();
	process.chdir(root);
	delete process.env.NVIDIA_API_KEY;
	const requests: Array<{ body: Record<string, unknown>; headers: Record<string, string>; url: string }> = [];
	try {
		globalThis.fetch = async (input, init) => {
			const headers = init?.headers as Record<string, string>;
			requests.push({
				body: parseJsonBody(init),
				headers,
				url: String(input),
			});
			return new Response(JSON.stringify({ pdb: "HEADER TEST ALPHAFOLD2\nEND\n", confidence: 0.87 }), {
				status: 200,
				statusText: "OK",
				headers: { "content-type": "application/json" },
			});
		};

		const tool = registerTools().get("feynman_model_endpoint_call");
		const result = await tool?.execute("call-alphafold2", {
			provider: "nvidia-bionemo",
			model: "alphafold2",
			sequence: "MNVIDIAIAMAI",
			endpointUrl: "http://127.0.0.1:8000/protein-structure/alphafold2/predict-structure-from-sequence",
			databases: ["uniref90", "mgnify", "small_bfd"],
			iterations: 1,
			relaxPrediction: true,
		});
		const details = result?.details as ModelEndpointDetails;

		assert.equal(requests.length, 1);
		assert.equal(requests[0]?.headers.authorization, undefined);
		assert.equal(requests[0]?.url, "http://127.0.0.1:8000/protein-structure/alphafold2/predict-structure-from-sequence");
		assert.deepEqual(requests[0]?.body, {
			sequence: "MNVIDIAIAMAI",
			databases: ["uniref90", "mgnify", "small_bfd"],
			iterations: 1,
			relax_prediction: true,
		});
		assert.equal(details.auth, "none");
		assert.equal(details.output.format, "json");
		assert.equal(details.provenance.docs.includes(testableModelEndpoints.ALPHAFOLD2_DOCS), true);
		assert.equal(details.artifactPaths[0]?.endsWith(".json"), true);
		assert.match(readFileSync(join(root, details.artifactPaths[0] ?? ""), "utf8"), /confidence/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
