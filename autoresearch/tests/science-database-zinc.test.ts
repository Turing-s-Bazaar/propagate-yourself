import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { registerScienceDatabaseTools } from "../extensions/research-tools/science-databases.js";

type Tool = {
	execute: (toolCallId: string, params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; details: unknown }>;
	name: string;
	promptGuidelines?: string[];
	promptSnippet?: string;
};

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function registerTools(): Map<string, Tool> {
	const tools = new Map<string, Tool>();
	registerScienceDatabaseTools({
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

function zincRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		zinc_id: "ZINC000000000012",
		smiles: "CCO",
		tranche_name: "H03P050",
		catalogs: [{
			catalog_name: "Mcule BB",
			supplier_code: "MCULE-2311834287",
			price: 240,
			quantity: 10,
			unit: "mg",
			shipping: "6 weeks",
			url: "https://mcule.com/%%s/",
		}],
		...overrides,
	};
}

test("science database tool searches ZINC ids through CartBlanche submit and poll", async () => {
	const requests: Array<{ body?: string; method?: string; url: string }> = [];
	globalThis.fetch = async (input, init) => {
		const url = String(input);
		requests.push({ url, method: init?.method, body: init?.body instanceof URLSearchParams ? init.body.toString() : String(init?.body ?? "") });
		if (url === "https://cartblanche22.docking.org/substances.txt") {
			assert.equal(init?.method, "POST");
			const body = init?.body as URLSearchParams;
			assert.equal(body.get("zinc_ids"), "ZINC000000000012");
			assert.equal(body.get("output_fields"), "zinc_id,smiles,tranche_name,catalogs");
			return jsonResponse({ task: "task-id" });
		}
		if (url === "https://cartblanche22.docking.org/search/result/task-id") {
			return jsonResponse({ result: { missing: [], zinc20: [zincRecord()] } });
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tool = registerTools().get("feynman_science_database_search");
	const result = await tool?.execute("call-zinc", { source: "zinc", query: "id:ZINC12", limit: 1 });
	const details = result?.details as {
		provenance: { endpoints: string[] };
		results: Array<{ catalogCount: number; catalogs: Array<{ supplierCode: string }>; smiles: string; trancheProperties: { heavyAtoms: number; logp: number }; zincId: string }>;
		searchMode: string;
		sourceCounts: Record<string, number>;
		taskId: string;
		totalAvailable: number;
	};

	assert.equal(details.searchMode, "id");
	assert.equal(details.taskId, "task-id");
	assert.equal(details.totalAvailable, 1);
	assert.equal(details.sourceCounts.zinc20, 1);
	assert.equal(details.results[0]?.zincId, "ZINC000000000012");
	assert.equal(details.results[0]?.smiles, "CCO");
	assert.equal(details.results[0]?.catalogCount, 1);
	assert.equal(details.results[0]?.catalogs[0]?.supplierCode, "MCULE-2311834287");
	assert.equal(details.results[0]?.trancheProperties.heavyAtoms, 3);
	assert.equal(details.results[0]?.trancheProperties.logp, 0.5);
	assert.deepEqual(details.provenance.endpoints, [
		"https://cartblanche22.docking.org/substances.txt",
		"https://cartblanche22.docking.org/search/result/task-id",
	]);
	assert.equal(requests.length, 2);
	assert.match(tool?.promptSnippet ?? "", /ZINC/);
	assert.match(tool?.promptGuidelines?.join("\n") ?? "", /supplier catalog/);
});

test("science database tool supports ZINC SMILES, supplier, random, and 3D modes", async () => {
	const submitted: Array<{ body: URLSearchParams; url: string }> = [];
	let task = 0;
	globalThis.fetch = async (input, init) => {
		const url = String(input);
		if (init?.method === "POST") {
			task += 1;
			submitted.push({ url, body: init.body as URLSearchParams });
			return jsonResponse({ task: `task-${task}` });
		}
		if (url === "https://cartblanche22.docking.org/search/result/task-1") {
			return jsonResponse({ status: "SUCCESS", result: { zinc22: [zincRecord({ tranche: { h_num: "H03", p_num: "P050" } })] } });
		}
		if (url === "https://cartblanche22.docking.org/search/result/task-2") {
			return jsonResponse({ result: { zinc20: [zincRecord({ supplier_code: ["MCULE-2311834287"] })] } });
		}
		if (url === "https://cartblanche22.docking.org/search/result/task-3") {
			return jsonResponse({ result: { zinc22: [zincRecord({ zinc_id: "ZINC000000000013" })] } });
		}
		if (url === "https://cartblanche22.docking.org/search/result/task-4") {
			return jsonResponse({ result: { zinc20: [zincRecord()] } });
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tool = registerTools().get("feynman_science_database_search");
	const smiles = await tool?.execute("zinc-smiles", { source: "zinc", query: "smiles:CCO dist=1 adist=2", limit: 1 });
	const supplier = await tool?.execute("zinc-supplier", { source: "zinc", query: "supplier:MCULE-2311834287", limit: 1 });
	const random = await tool?.execute("zinc-random", { source: "zinc", query: "random subset=lead-like count=1", limit: 1 });
	const structures = await tool?.execute("zinc-3d", { source: "zinc", query: "3d:ZINC12", limit: 1 });

	assert.equal(submitted[0]?.url, "https://cartblanche22.docking.org/smiles.txt");
	assert.equal(submitted[0]?.body.get("smiles"), "CCO");
	assert.equal(submitted[0]?.body.get("dist"), "1");
	assert.equal(submitted[0]?.body.get("adist"), "2");
	assert.equal(submitted[1]?.url, "https://cartblanche22.docking.org/catitems.txt");
	assert.equal(submitted[1]?.body.get("supplier_codes"), "MCULE-2311834287");
	assert.equal(submitted[2]?.url, "https://cartblanche22.docking.org/substance/random.txt");
	assert.equal(submitted[2]?.body.get("subset"), "lead-like");
	assert.equal(submitted[2]?.body.get("count"), "1");
	assert.equal(submitted[3]?.url, "https://cartblanche22.docking.org/substances.txt");
	assert.equal(submitted[3]?.body.get("zinc_ids"), "ZINC000000000012");

	const smilesDetails = smiles?.details as { parsedQuery: { adist: number; dist: number; smiles: string }; searchMode: string };
	const supplierDetails = supplier?.details as { results: Array<{ supplierCodes: string[] }>; searchMode: string };
	const randomDetails = random?.details as { parsedQuery: { subset: string }; searchMode: string };
	const structureDetails = structures?.details as { searchMode: string; structures: Array<{ download: { tranchePathPattern: string }; found: boolean }> };
	assert.deepEqual(smilesDetails.parsedQuery, { smiles: "CCO", dist: 1, adist: 2 });
	assert.equal(smilesDetails.searchMode, "smiles");
	assert.equal(supplierDetails.searchMode, "supplier");
	assert.deepEqual(supplierDetails.results[0]?.supplierCodes, ["MCULE-2311834287"]);
	assert.equal(randomDetails.searchMode, "random");
	assert.equal(randomDetails.parsedQuery.subset, "lead-like");
	assert.equal(structureDetails.searchMode, "3d");
	assert.equal(structureDetails.structures[0]?.found, true);
	assert.equal(structureDetails.structures[0]?.download.tranchePathPattern, "zinc-22*/H03/H03P050/");
});
