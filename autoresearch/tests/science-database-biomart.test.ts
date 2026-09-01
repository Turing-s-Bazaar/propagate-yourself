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
const originalEndpoints = process.env.FEYNMAN_BIOMART_ENDPOINTS;

afterEach(() => {
	globalThis.fetch = originalFetch;
	if (originalEndpoints === undefined) delete process.env.FEYNMAN_BIOMART_ENDPOINTS;
	else process.env.FEYNMAN_BIOMART_ENDPOINTS = originalEndpoints;
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

test("science database tool lists BioMart registry rows", async () => {
	process.env.FEYNMAN_BIOMART_ENDPOINTS = "https://biomart.example/martservice";
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = String(input);
		requests.push(url);
		assert.equal(url, "https://biomart.example/martservice?type=registry");
		return new Response([
			"<MartRegistry>",
			'<MartURLLocation database="ensembl_mart_116" default="1" displayName="Ensembl Genes 116" host="www.ensembl.org" name="ENSEMBL_MART_ENSEMBL" path="/biomart/martservice" serverVirtualSchema="default" visible="1" />',
			'<MartURLLocation database="sequence_mart_116" displayName="Sequence" host="www.ensembl.org" name="ENSEMBL_MART_SEQUENCE" path="/biomart/martservice" serverVirtualSchema="default" visible="" />',
			"</MartRegistry>",
		].join("\n"), { status: 200, headers: { "content-type": "application/xml" } });
	};

	const tool = registerTools().get("feynman_science_database_search");
	const result = await tool?.execute("call-biomart-registry", { source: "biomart", query: "marts", limit: 1 });
	const details = result?.details as {
		mode: string;
		provenance: { endpoints: string[] };
		results: Array<{ database: string; default: boolean; displayName: string; name: string; visible: boolean }>;
		source: string;
	};

	assert.equal(details.source, "biomart");
	assert.equal(details.mode, "marts");
	assert.equal(details.results[0]?.name, "ENSEMBL_MART_ENSEMBL");
	assert.equal(details.results[0]?.displayName, "Ensembl Genes 116");
	assert.equal(details.results[0]?.database, "ensembl_mart_116");
	assert.equal(details.results[0]?.default, true);
	assert.equal(details.results[0]?.visible, true);
	assert.deepEqual(details.provenance.endpoints, requests);
	assert.match(tool?.promptSnippet ?? "", /BioMart/);
});

test("science database tool queries BioMart gene rows with endpoint fallback and completion stamp", async () => {
	process.env.FEYNMAN_BIOMART_ENDPOINTS = "https://bad.example/martservice,https://ok.example/martservice";
	const requests: Array<{ body: string; method: string; url: string }> = [];
	globalThis.fetch = async (input, init) => {
		const request = { body: String(init?.body ?? ""), method: String(init?.method ?? "GET"), url: String(input) };
		requests.push(request);
		if (request.url === "https://bad.example/martservice") {
			return new Response("<html>maintenance</html>", { status: 405, statusText: "Method Not Allowed" });
		}
		assert.equal(request.url, "https://ok.example/martservice");
		assert.equal(request.method, "POST");
		const decoded = new URLSearchParams(request.body).get("query") ?? "";
		assert.match(decoded, /completionStamp="1"/);
		assert.match(decoded, /Dataset name="hsapiens_gene_ensembl"/);
		assert.match(decoded, /Filter name="external_gene_name" value="TP53"/);
		assert.match(decoded, /Attribute name="ensembl_gene_id"/);
		return new Response("ENSG00000141510\tTP53\tcellular tumor antigen p53\t17\t7661779\t7687546\t-1\tprotein_coding\n[success]\n", {
			status: 200,
			headers: { "content-type": "text/plain" },
		});
	};

	const tool = registerTools().get("feynman_science_database_search");
	const result = await tool?.execute("call-biomart-gene", { source: "biomart", query: "gene:TP53", limit: 1 });
	const details = result?.details as {
		mode: string;
		provenance: { endpoints: string[] };
		results: Array<Record<string, string>>;
		route: { filterName: string; filterValue: string };
		totalCount: number;
	};

	assert.equal(requests.length, 2);
	assert.equal(details.mode, "data");
	assert.equal(details.route.filterName, "external_gene_name");
	assert.equal(details.route.filterValue, "TP53");
	assert.equal(details.totalCount, 1);
	assert.equal(details.results[0]?.ensembl_gene_id, "ENSG00000141510");
	assert.equal(details.results[0]?.external_gene_name, "TP53");
	assert.equal(details.results[0]?.gene_biotype, "protein_coding");
	assert.deepEqual(details.provenance.endpoints, ["https://ok.example/martservice"]);
	assert.match(tool?.promptGuidelines?.join("\n") ?? "", /BioMart mart names/);
});
