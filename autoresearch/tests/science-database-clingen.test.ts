import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { registerScienceDatabaseTools } from "../extensions/research-tools/science-databases.js";

type Tool = {
	execute: (toolCallId: string, params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; details: unknown }>;
	name: string;
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

const actionabilityColumns = [
	"docId",
	"curationType",
	"context",
	"release",
	"releaseDate",
	"geneOrVariant",
	"geneOmim",
	"disease",
	"omim",
	"status-overall",
	"outcome",
	"outcomeScoringGroup",
	"intervention",
	"interventionScoringGroup",
	"severity",
	"likelihood",
	"natureOfIntervention",
	"effectiveness",
	"overall",
];

test("science database tool summarizes Feynman-owned ClinGen gene curation records", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		requests.push(url.toString());
		if (url.hostname === "search.clinicalgenome.org" && url.pathname === "/api/validity") {
			return jsonResponse({
				total: 2,
				rows: [
					{
						symbol: "BRCA1",
						hgnc_id: "HGNC:1100",
						ep: "Hereditary Breast, Ovarian and Pancreatic Cancer GCEP",
						affiliate_id: "40031",
						disease_name: "breast-ovarian cancer, familial 1",
						mondo: "MONDO:0011450",
						moi: "AD",
						sop: "SOP10",
						classification: "Definitive",
						perm_id: "CGGV:assertion-brca1",
						animal_model_only: 0,
						released: "01/01/2026",
					},
					{
						symbol: "TP53",
						hgnc_id: "HGNC:11998",
						disease_name: "Li-Fraumeni syndrome",
						mondo: "MONDO:0018875",
						classification: "Definitive",
					},
				],
			});
		}
		if (url.hostname === "search.clinicalgenome.org" && url.pathname === "/api/dosage") {
			return jsonResponse({
				total: 1,
				rows: [{
					type: 0,
					symbol: "BRCA1",
					hgnc_id: "HGNC:1100",
					location: "17q21.31",
					grch37: "chr17:41196312-41277500",
					grch38: "chr17:43044295-43125483",
					haplo_assertion: 3,
					triplo_assertion: 0,
					haplo_disease: "hereditary breast ovarian cancer",
					haplo_mondo: "MONDO:0011450",
					omim: "Yes",
					morbid: "Yes",
					date: "01/02/2026",
				}],
			});
		}
		if (url.hostname === "actionability.clinicalgenome.org" && url.pathname === "/ac/Adult/api/summ") {
			assert.equal(url.searchParams.get("flavor"), "flat");
			assert.equal(url.searchParams.get("format"), "json");
			return jsonResponse({
				columns: actionabilityColumns,
				rows: [[
					"AC0001",
					"Adult Actionability",
					"Adult",
					"2.0.0",
					"2026-01-03",
					"BRCA1, BRCA2",
					"113705",
					"Hereditary breast and ovarian cancer",
					"604370",
					"Released",
					"Definitive Actionability",
					"high",
					"Risk-reducing surgery and surveillance",
					"high",
					"high",
					"high",
					"Surveillance",
					"effective",
					"12",
				]],
			});
		}
		if (url.hostname === "actionability.clinicalgenome.org" && url.pathname === "/ac/Pediatric/api/summ") {
			return jsonResponse({ columns: actionabilityColumns, rows: [] });
		}
		if (url.hostname === "erepo.genome.network" && url.pathname === "/evrepo/api/summary/classifications") {
			assert.equal(url.searchParams.get("columns"), "gene");
			assert.equal(url.searchParams.get("values"), "BRCA1");
			assert.equal(url.searchParams.get("matchTypes"), "exact");
			return jsonResponse({
				data: [{
					PCERDocID: "PCER000005660",
					uuid: "03c35580-6129-4df7-b7b4-8055d39efda1",
					caId: "CA003681",
					cvId: "55607",
					gene: "BRCA1",
					geneNcbiId: "672",
					condition: "BRCA1-related cancer predisposition",
					mondoId: "MONDO:0700268",
					classification: "Pathogenic",
					ep: "ENIGMA BRCA1 and BRCA2 VCEP",
					moi: "Autosomal dominant inheritance",
					docVersion: "2.1.0",
					approvedDate: "2026-04-15",
					publishedDate: "2026-04-15",
					preferredVarTitle: "NM_007294.4(BRCA1):c.5509T>G (p.Trp1837Gly)",
					hgvs: ["NM_007294.4:c.5509T>G", "NC_000017.11:g.43045761A>C"],
					metCodes: ["PM2_Supporting", "PP3"],
					unMetCodes: ["PS3"],
					retracted: false,
					summaryDesc: "The BRCA1 variant meets criteria for Pathogenic classification.",
				}],
				metadata: { rendered: { by: "https://erepo.genome.network/evrepo/api/summary/srvc" } },
				status: { code: 200, name: "OK" },
			});
		}
		throw new Error(`unexpected ClinGen request ${url.toString()}`);
	};

	const tools = registerTools();
	const result = await tools.get("feynman_science_database_search")?.execute("call-clingen-summary", {
		source: "clingen",
		query: "BRCA1",
		limit: 2,
	});
	const details = result?.details as {
		results: Array<{
			actionability?: { adult?: { records?: Array<{ docId?: string; outcome?: string }> } };
			classifications?: { results?: Array<{ caId?: string; classification?: string; evidenceCodesMet?: string[] }> };
			dosage?: { records?: Array<{ haploinsufficiency?: { code?: string; label?: string } }> };
			validity?: { records?: Array<{ assertionId?: string; classification?: string; mondoId?: string }> };
		}>;
		searchMode?: string;
		totalCount?: number;
	};

	assert.equal(details.searchMode, "gene-summary");
	assert.equal(details.totalCount, 4);
	assert.equal(details.results[0]?.validity?.records?.[0]?.assertionId, "CGGV:assertion-brca1");
	assert.equal(details.results[0]?.validity?.records?.[0]?.classification, "Definitive");
	assert.equal(details.results[0]?.validity?.records?.[0]?.mondoId, "MONDO:0011450");
	assert.equal(details.results[0]?.dosage?.records?.[0]?.haploinsufficiency?.code, "3");
	assert.equal(details.results[0]?.dosage?.records?.[0]?.haploinsufficiency?.label, "Sufficient Evidence");
	assert.equal(details.results[0]?.actionability?.adult?.records?.[0]?.docId, "AC0001");
	assert.equal(details.results[0]?.actionability?.adult?.records?.[0]?.outcome, "Definitive Actionability");
	assert.equal(details.results[0]?.classifications?.results?.[0]?.caId, "CA003681");
	assert.equal(details.results[0]?.classifications?.results?.[0]?.classification, "Pathogenic");
	assert.deepEqual(details.results[0]?.classifications?.results?.[0]?.evidenceCodesMet, ["PM2_Supporting", "PP3"]);
	assert.equal(requests.length, 5);
	assert.match(tools.get("feynman_science_database_search")?.promptSnippet ?? "", /ClinGen/);
});

test("science database tool builds ClinGen ERepo classification filters", async () => {
	const filters: Array<Record<string, string | null>> = [];
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		if (url.hostname !== "erepo.genome.network" || url.pathname !== "/evrepo/api/summary/classifications") {
			throw new Error(`unexpected URL ${url.toString()}`);
		}
		filters.push({
			columns: url.searchParams.get("columns"),
			values: url.searchParams.get("values"),
			matchTypes: url.searchParams.get("matchTypes"),
			pgSize: url.searchParams.get("pgSize"),
		});
		return jsonResponse({ data: [{ caId: "CA003681", classification: "Pathogenic", gene: "BRCA1" }] });
	};

	const tool = registerTools().get("feynman_science_database_search");
	await tool?.execute("call-clingen-caid", { source: "clingen", query: "caid:CA003681", limit: 4 });
	await tool?.execute("call-clingen-hgvs", { source: "clingen", query: "hgvs:NM_007294.4:c.5509T>G", limit: 1 });
	await tool?.execute("call-clingen-gene", { source: "clingen", query: "classifications:BRCA1", limit: 2 });

	assert.deepEqual(filters, [
		{ columns: "caId", values: "CA003681", matchTypes: "exact", pgSize: "4" },
		{ columns: "hgvs", values: "NM_007294.4:c.5509T>G", matchTypes: "contains", pgSize: "1" },
		{ columns: "gene", values: "BRCA1", matchTypes: "exact", pgSize: "2" },
	]);
});

test("science database tool accepts ClinGen reference clinical-genomics query names", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		requests.push(url.toString());
		if (url.hostname === "search.clinicalgenome.org" && url.pathname === "/api/validity") {
			return jsonResponse({ total: 1, rows: [{ symbol: "BRCA1", hgnc_id: "HGNC:1100", disease_name: "breast-ovarian cancer", mondo: "MONDO:0011450", classification: "Definitive" }] });
		}
		if (url.hostname === "search.clinicalgenome.org" && url.pathname === "/api/dosage") {
			return jsonResponse({ total: 1, rows: [{ type: 0, symbol: "BRCA1", hgnc_id: "HGNC:1100", haplo_assertion: 3, triplo_assertion: 0 }] });
		}
		if (url.hostname === "actionability.clinicalgenome.org" && url.pathname === "/ac/Adult/api/summ") {
			return jsonResponse({ columns: actionabilityColumns, rows: [["AC0001", "Adult Actionability", "Adult", "2.0.0", "2026-01-03", "BRCA1", "113705", "Hereditary breast and ovarian cancer", "604370", "Released", "Definitive Actionability", "high", "Surveillance", "high", "high", "high", "Surveillance", "effective", "12"]] });
		}
		if (url.hostname === "actionability.clinicalgenome.org" && url.pathname === "/ac/Pediatric/api/summ") {
			return jsonResponse({ columns: actionabilityColumns, rows: [] });
		}
		if (url.hostname === "erepo.genome.network" && url.pathname === "/evrepo/api/summary/classifications") {
			return jsonResponse({ data: [{ caId: "CA003681", classification: "Pathogenic", gene: "BRCA1" }] });
		}
		throw new Error(`unexpected ClinGen request ${url.toString()}`);
	};

	const tool = registerTools().get("feynman_science_database_search");
	const validity = await tool?.execute("call-clingen-reference-validity", { source: "clingen", query: "clingen_gene_validity:BRCA1", limit: 1 });
	const dosage = await tool?.execute("call-clingen-reference-dosage", { source: "clingen", query: "clingen_dosage_sensitivity:BRCA1 include_regions=false", limit: 1 });
	const actionability = await tool?.execute("call-clingen-reference-actionability", { source: "clingen", query: "clingen_actionability:BRCA1 context=adult", limit: 1 });
	const classifications = await tool?.execute("call-clingen-reference-classifications", { source: "clingen", query: "clingen_variant_classifications:gene=BRCA1", limit: 1 });

	assert.equal((validity?.details as { searchMode?: string }).searchMode, "gene-disease-validity");
	assert.equal((dosage?.details as { searchMode?: string }).searchMode, "dosage-sensitivity");
	assert.equal((actionability?.details as { searchMode?: string }).searchMode, "clinical-actionability");
	assert.equal((classifications?.details as { classificationQuery?: { column?: string }; searchMode?: string }).searchMode, "variant-classifications");
	assert.equal((classifications?.details as { classificationQuery?: { column?: string } }).classificationQuery?.column, "gene");
	assert.ok(requests.some((request) => request.includes("/api/validity")));
	assert.ok(requests.some((request) => request.includes("/api/dosage")));
	assert.ok(requests.some((request) => request.includes("/ac/Adult/api/summ")));
	assert.ok(requests.some((request) => request.includes("/evrepo/api/summary/classifications")));
});

test("science database tool returns bounded ClinGen warnings for transient actionability failures", async () => {
	globalThis.fetch = async () => new Response("<html>temporarily unavailable</html>", { status: 502, statusText: "Bad Gateway" });
	const result = await registerTools().get("feynman_science_database_search")?.execute("call-clingen-actionability", {
		source: "clingen",
		query: "actionability:BRCA1 adult",
	});
	const details = result?.details as { adult?: { returned?: number; totalCount?: number }; searchMode?: string; warnings?: string[] };

	assert.equal(details.searchMode, "clinical-actionability");
	assert.equal(details.adult?.totalCount, 0);
	assert.equal(details.adult?.returned, 0);
	assert.match(details.warnings?.[0] ?? "", /ClinGen actionability Adult/);
	assert.match(details.warnings?.[0] ?? "", /502 Bad Gateway/);
});
