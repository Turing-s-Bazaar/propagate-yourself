import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { registerScienceDatabaseTools } from "../extensions/research-tools/science-databases.js";

type Tool = {
	execute: (toolCallId: string, params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; details: unknown }>;
	name: string;
	promptGuidelines?: string[];
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

function textResponse(body: string, contentType = "text/plain"): Response {
	return new Response(body, {
		status: 200,
		headers: { "content-type": contentType },
	});
}

function bodyParam(init: RequestInit | undefined, key: string): string | null {
	const body = init?.body;
	assert.ok(body instanceof URLSearchParams);
	return body.get(key);
}

test("science database tool exposes exact protein-annotation parity names", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input, init) => {
		const url = String(input);
		requests.push(url);
		if (url.includes("/entry/interpro/protein/uniprot/P04637/")) {
			const parsed = new URL(url);
			assert.equal(parsed.searchParams.get("page_size"), "200");
			return jsonResponse({
				count: 1,
				results: [{ metadata: { accession: "IPR011615", name: "p53 DNA-binding domain", type: "domain", source_database: "interpro" } }],
			});
		}
		if (url.includes("/entry/pfam/") && url.includes("search=kinase")) {
			return jsonResponse({
				count: 1,
				results: [{ metadata: { accession: "PF00069", name: "Protein kinase domain", type: "domain", source_database: "pfam" } }],
			});
		}
		if (url.endsWith("/entry/pfam/PF00069/")) {
			return jsonResponse({ metadata: { accession: "PF00069", name: "Protein kinase domain", type: "domain", source_database: "pfam" } });
		}
		if (url.includes("/set/pfam/") && url.includes("search=kinase")) {
			return jsonResponse({ count: 1, results: [{ metadata: { accession: "CL0016", name: "Protein kinase clan" } }] });
		}
		if (url.endsWith("/set/pfam/CL0016/")) {
			return jsonResponse({
				metadata: {
					accession: "CL0016",
					name: "Protein kinase clan",
					relationships: { nodes: [{ accession: "PF00069", name: "Protein kinase domain", source_database: "pfam" }] },
				},
			});
		}
		if (url.includes("/protein/reviewed/entry/pfam/PF00069/")) {
			assert.equal(new URL(url).searchParams.get("tax_id"), "9606");
			return jsonResponse({ count: 1, results: [{ metadata: { accession: "P04637", name: "TP53" } }] });
		}
		if (url.includes("/proteome/uniprot/entry/pfam/PF00069/")) {
			assert.equal(new URL(url).searchParams.get("page_size"), "1");
			return jsonResponse({ count: 42, results: [{ metadata: { accession: "UP000005640" } }] });
		}
		if (url.includes("proteinatlas.org/api/search_download.php")) {
			const parsed = new URL(url);
			assert.equal(parsed.searchParams.get("format"), "json");
			assert.equal(parsed.searchParams.get("compress"), "no");
			return jsonResponse([{
				Gene: "TP53",
				"Gene synonym": ["LFS1", "p53"],
				Ensembl: "ENSG00000141510",
				"Gene description": "tumor protein p53",
				Uniprot: ["P04637"],
				"Subcellular location": "Nucleoplasm",
			}]);
		}
		if (url.includes("version-12-0.string-db.org/api/json/get_string_ids")) {
			assert.equal(bodyParam(init, "identifiers"), "TP53\rBRCA1");
			return jsonResponse([
				{ queryIndex: 0, queryItem: "TP53", stringId: "9606.ENSP00000269305", preferredName: "TP53", ncbiTaxonId: 9606, annotation: "tumor protein p53" },
				{ queryIndex: 1, queryItem: "BRCA1", stringId: "9606.ENSP00000350283", preferredName: "BRCA1", ncbiTaxonId: 9606, annotation: "DNA repair associated" },
			]);
		}
		if (url.includes("version-12-0.string-db.org/api/tsv/network")) {
			assert.equal(bodyParam(init, "required_score"), "700");
			return textResponse([
				"stringId_A\tstringId_B\tpreferredName_A\tpreferredName_B\tncbiTaxonId\tscore\tnscore\tfscore\tpscore\tascore\tescore\tdscore\ttscore",
				"9606.ENSP00000269305\t9606.ENSP00000350283\tTP53\tBRCA1\t9606\t0.999\t0\t0\t0\t0.2\t0.7\t0.9\t0.8",
			].join("\n"), "text/tab-separated-values");
		}
		if (url.includes("version-12-0.string-db.org/api/json/homology_best")) {
			assert.equal(bodyParam(init, "species_b"), "10090");
			return jsonResponse([{ stringId_A: "9606.ENSP00000269305", ncbiTaxonId_A: 9606, stringId_B: "10090.ENSMUSP000001", ncbiTaxonId_B: 10090, bitscore: 598.2 }]);
		}
		if (url.includes("version-12-0.string-db.org/api/json/homology")) {
			return jsonResponse([{ stringId_A: "9606.ENSP00000269305", ncbiTaxonId_A: 9606, stringId_B: "9606.ENSP00000350283", ncbiTaxonId_B: 9606, bitscore: "406.8" }]);
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tool = registerTools().get("feynman_science_database_search");
	assert.ok(tool);
	const calls = [
		{ source: "interpro", query: "get_domain_architecture:P04637", expectCommand: "get_domain_architecture" },
		{ source: "interpro", query: "search_interpro_entries:kinase source_db=pfam entry_type=domain", expectCommand: "search_interpro_entries" },
		{ source: "interpro", query: "get_interpro_entry:PF00069", expectCommand: "get_interpro_entry" },
		{ source: "interpro", query: "search_pfam_clans:kinase", expectCommand: "search_pfam_clans" },
		{ source: "interpro", query: "get_pfam_clan:CL0016", expectCommand: "get_pfam_clan" },
		{ source: "interpro", query: "get_pfam_family_proteins:PF00069 reviewed_only=true tax_id=9606", expectCommand: "get_pfam_family_proteins" },
		{ source: "interpro", query: "get_pfam_family_proteomes:PF00069", expectCommand: "get_pfam_family_proteomes" },
		{ source: "proteinatlas", query: "get_protein_atlas_gene:TP53", expectCommand: "get_protein_atlas_gene" },
		{ source: "proteinatlas", query: "search_protein_atlas:TP53 columns=g,gs,eg,gd,up,scl", expectCommand: "search_protein_atlas" },
		{ source: "string", query: "map_string_ids:TP53,BRCA1 species=9606", expectCommand: "map_string_ids" },
		{ source: "string", query: "get_string_network:TP53,BRCA1 species=9606 required_score=700", expectCommand: "get_string_network" },
		{ source: "string", query: "get_string_similarity_scores:TP53,BRCA1 species=9606", expectCommand: "get_string_similarity_scores" },
		{ source: "string", query: "get_string_best_similarity_hits:TP53,BRCA1 species=9606 target_species=10090", expectCommand: "get_string_best_similarity_hits" },
	];

	for (const call of calls) {
		const result = await tool.execute(`protein-${call.expectCommand}`, { source: call.source, query: call.query, limit: 2 });
		const details = result.details as { command: string; provenance: { endpoints: string[] }; results: unknown[] };
		assert.equal(details.command, call.expectCommand);
		assert.ok(details.provenance.endpoints.length > 0);
		assert.ok(Array.isArray(details.results));
	}
	assert.equal(requests.some((url) => url.includes("claude-science")), false);
	assert.match(tool.promptGuidelines?.join("\n") ?? "", /InterPro/);
});
