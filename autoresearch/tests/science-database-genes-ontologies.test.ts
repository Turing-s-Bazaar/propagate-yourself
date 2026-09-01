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

function formParam(init: RequestInit | undefined, key: string): string | null {
	const body = init?.body;
	if (body instanceof URLSearchParams) return body.get(key);
	return null;
}

test("science database tool supports gene and ontology exact reference tool names", async () => {
	const requests: Array<{ method?: string; url: string }> = [];
	globalThis.fetch = async (input, init) => {
		const url = new URL(String(input));
		requests.push({ method: init?.method, url: url.toString() });
		if (url.hostname === "mygene.info" && url.pathname === "/v3/query") {
			assert.equal(init?.method, "POST");
			assert.equal(formParam(init, "q"), "TP53,BRCA1");
			assert.equal(formParam(init, "scopes"), "symbol");
			return jsonResponse([
				{ query: "TP53", _id: "7157", symbol: "TP53", name: "tumor protein p53", taxid: 9606, entrezgene: 7157, ensembl: { gene: "ENSG00000141510" } },
				{ query: "BRCA1", _id: "672", symbol: "BRCA1", name: "BRCA1 DNA repair associated", taxid: 9606, entrezgene: 672, ensembl: { gene: "ENSG00000012048" } },
			]);
		}
		if (url.hostname === "www.ebi.ac.uk" && url.pathname === "/ols4/api/ontologies") {
			return jsonResponse({
				_embedded: {
					ontologies: [{ ontologyId: "go", title: "Gene Ontology", numberOfTerms: 42000 }],
				},
			});
		}
		if (url.hostname === "www.ebi.ac.uk" && url.pathname === "/ols4/api/search") {
			assert.equal(url.searchParams.get("q"), "DNA repair");
			assert.equal(url.searchParams.get("ontology"), "go");
			return jsonResponse({
				response: {
					numFound: 1,
					docs: [{ obo_id: "GO:0006281", label: "DNA repair", ontology_name: "go", iri: "http://purl.obolibrary.org/obo/GO_0006281" }],
				},
			});
		}
		if (url.hostname === "www.ebi.ac.uk" && url.pathname.includes("/ols4/api/ontologies/go/terms/")) {
			assert.match(url.pathname, /GO_0006281/);
			return jsonResponse({ obo_id: "GO:0006281", label: "DNA repair", ontology_name: "go", iri: "http://purl.obolibrary.org/obo/GO_0006281" });
		}
		throw new Error(`unexpected request ${url.toString()}`);
	};

	const tool = registerTools().get("feynman_science_database_search");
	const genes = await tool?.execute("call-query-genes", { source: "mygene", query: "query_genes:TP53,BRCA1 scopes=symbol fields=symbol,name,taxid,entrezgene,ensembl.gene species=human", limit: 3 });
	const ontologies = await tool?.execute("call-list-ontologies", { source: "ols", query: "list_ontologies", limit: 2 });
	const searchTerms = await tool?.execute("call-search-ontology-terms", { source: "ols", query: "search_ontology_terms:DNA repair ontologies=go exact=true include_obsolete=false", limit: 2 });
	const term = await tool?.execute("call-get-ontology-term", { source: "ols", query: "get_ontology_term:go GO:0006281", limit: 2 });
	const geneDetails = genes?.details as { results: Array<{ symbol: string }>; searchMode: string; source: string };
	const ontologyDetails = ontologies?.details as { results: Array<{ ontologyId: string }>; searchMode: string };
	const searchDetails = searchTerms?.details as { results: Array<{ curie: string }>; searchMode: string };
	const termDetails = term?.details as { results: Array<{ curie: string }>; searchMode: string };

	assert.equal(geneDetails.source, "mygene");
	assert.equal(geneDetails.searchMode, "query-genes");
	assert.deepEqual(geneDetails.results.map((entry) => entry.symbol), ["TP53", "BRCA1"]);
	assert.equal(ontologyDetails.searchMode, "list-ontologies");
	assert.equal(ontologyDetails.results[0]?.ontologyId, "go");
	assert.equal(searchDetails.searchMode, "search-ontology-terms");
	assert.equal(searchDetails.results[0]?.curie, "GO:0006281");
	assert.equal(termDetails.searchMode, "get-ontology-term");
	assert.equal(termDetails.results[0]?.curie, "GO:0006281");
	assert.ok(requests.some((request) => request.method === "POST" && request.url.includes("mygene.info")));
});

test("science database tool supports UniProt, QuickGO, Reactome, and KEGG exact reference tool names", async () => {
	globalThis.fetch = async (input, init) => {
		const url = new URL(String(input));
		if (url.hostname === "rest.uniprot.org" && url.pathname === "/uniprotkb/search") {
			assert.equal(url.searchParams.get("format"), "tsv");
			assert.match(url.searchParams.get("query") ?? "", /P04637/);
			return textResponse("Entry\tEntry Name\tProtein names\nP04637\tP53_HUMAN\tCellular tumor antigen p53\n", "text/tab-separated-values");
		}
		if (url.hostname === "www.ebi.ac.uk" && url.pathname === "/QuickGO/services/annotation/search") {
			assert.equal(url.searchParams.get("geneProductId"), "UniProtKB:P04637");
			assert.equal(url.searchParams.get("taxonId"), "9606");
			return jsonResponse({
				numberOfHits: 1,
				results: [{ geneProductId: "UniProtKB:P04637", symbol: "TP53", goId: "GO:0006281", goName: "DNA repair", goAspect: "biological_process", evidenceCode: "ECO:0000314", taxonId: 9606 }],
			});
		}
		if (url.hostname === "reactome.org" && url.pathname === "/AnalysisService/identifiers/") {
			assert.equal(init?.method, "POST");
			assert.match(String(init?.body), /TP53/);
			assert.equal(url.searchParams.get("resource"), "TOTAL");
			return jsonResponse({
				pathwaysFound: 1,
				identifiersNotFound: 0,
				summary: { token: "analysis-token" },
				pathways: [{
					stId: "R-HSA-73894",
					dbId: 73894,
					name: "DNA Repair",
					species: { name: "Homo sapiens", taxId: 9606 },
					entities: { found: 1, total: 10, pValue: 0.01, fdr: 0.02 },
					reactions: { found: 1, total: 8 },
				}],
			});
		}
		if (url.hostname === "rest.kegg.jp" && url.pathname === "/get/hsa%3A7157") {
			return textResponse("ENTRY       7157              CDS       T01001\nNAME        TP53, P53\nDEFINITION  tumor protein p53\n///\n");
		}
		if (url.hostname === "rest.kegg.jp" && url.pathname === "/find/hsa/TP53") {
			return textResponse("hsa:7157\tTP53, P53; tumor protein p53\nhsa:123\tTP53BP1; tumor protein p53 binding protein 1\n");
		}
		if (url.hostname === "rest.kegg.jp" && url.pathname === "/link/pathway/hsa:7157+hsa:672") {
			return textResponse("hsa:7157\tpathway:hsa04115\nhsa:672\tpathway:hsa03440\n");
		}
		throw new Error(`unexpected request ${url.toString()}`);
	};

	const tool = registerTools().get("feynman_science_database_search");
	const uniprot = await tool?.execute("call-uniprot", { source: "uniprot", query: "get_uniprot_entries:P04637 fields=accession,id,protein_name", limit: 2 });
	const quickgo = await tool?.execute("call-quickgo", { source: "quickgo", query: "get_go_annotations:P04637 aspect=biological_process evidence=ECO:0000314 taxon_id=9606 max_records=2", limit: 2 });
	const reactome = await tool?.execute("call-reactome", { source: "reactome", query: "map_reactome_pathways:TP53,BRCA1 species=Homo_sapiens resource=TOTAL include_disease=true compact=true", limit: 2 });
	const keggGet = await tool?.execute("call-kegg-get", { source: "kegg", query: "get_kegg_entries:hsa:7157 include_raw=true", limit: 2 });
	const keggSearch = await tool?.execute("call-kegg-search", { source: "kegg", query: "search_kegg:TP53 database=hsa exact_gene_symbol=true", limit: 2 });
	const keggLink = await tool?.execute("call-kegg-link", { source: "kegg", query: "link_kegg_ids:hsa:7157,hsa:672 target_db=pathway operation=link", limit: 2 });
	const uniprotDetails = uniprot?.details as { results: Array<{ Entry: string }>; searchMode: string };
	const quickgoDetails = quickgo?.details as { results: Array<{ goId: string }>; searchMode: string };
	const reactomeDetails = reactome?.details as { results: Array<{ stableId: string }>; searchMode: string };
	const keggGetDetails = keggGet?.details as { results: Array<{ entryId: string; raw?: string }>; searchMode: string };
	const keggSearchDetails = keggSearch?.details as { results: Array<{ entryId: string }>; searchMode: string };
	const keggLinkDetails = keggLink?.details as { missingIds: string[]; results: Array<{ targetId: string }>; searchMode: string };

	assert.equal(uniprotDetails.searchMode, "get-uniprot-entries");
	assert.equal(uniprotDetails.results[0]?.Entry, "P04637");
	assert.equal(quickgoDetails.searchMode, "get-go-annotations");
	assert.equal(quickgoDetails.results[0]?.goId, "GO:0006281");
	assert.equal(reactomeDetails.searchMode, "map-reactome-pathways");
	assert.equal(reactomeDetails.results[0]?.stableId, "R-HSA-73894");
	assert.equal(keggGetDetails.searchMode, "get-kegg-entries");
	assert.equal(keggGetDetails.results[0]?.entryId, "7157");
	assert.match(keggGetDetails.results[0]?.raw ?? "", /ENTRY/);
	assert.equal(keggSearchDetails.searchMode, "search-kegg");
	assert.deepEqual(keggSearchDetails.results.map((entry) => entry.entryId), ["hsa:7157"]);
	assert.equal(keggLinkDetails.searchMode, "link-kegg-ids");
	assert.deepEqual(keggLinkDetails.missingIds, []);
	assert.deepEqual(keggLinkDetails.results.map((entry) => entry.targetId), ["pathway:hsa04115", "pathway:hsa03440"]);
});
