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

test("science database tool searches openFDA drug label records", async () => {
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		assert.equal(url.origin, "https://api.fda.gov");
		assert.equal(url.pathname, "/drug/label.json");
		assert.equal(url.searchParams.get("search"), 'openfda.generic_name:"aspirin"');
		assert.equal(url.searchParams.get("limit"), "1");
		return jsonResponse({
			meta: { results: { total: 443 } },
			results: [{
				id: "label-1",
				set_id: "0058175f-3474-40c3-a046-6cfaec86d84b",
				effective_time: "20240201",
				version: "11",
				active_ingredient: ["Active ingredient Aspirin 81 mg"],
				purpose: ["Purpose Pain reliever"],
				warnings: ["Reye's syndrome warning."],
				openfda: {
					brand_name: ["Low Dose Aspirin"],
					generic_name: ["ASPIRIN"],
					manufacturer_name: ["P & L Development, LLC"],
					product_ndc: ["59726-065"],
					product_type: ["HUMAN OTC DRUG"],
					route: ["ORAL"],
					substance_name: ["ASPIRIN"],
					rxcui: ["308416"],
				},
			}],
		});
	};

	const tool = registerTools().get("feynman_science_database_search");
	const result = await tool?.execute("call-openfda", { source: "openfda", query: "aspirin", limit: 1 });
	const details = result?.details as { mode: string; results: Array<{ brandNames: string[]; id: string; purpose: string; setId: string }>; totalCount: number };

	assert.equal(details.mode, "drug-label");
	assert.equal(details.totalCount, 443);
	assert.equal(details.results[0]?.id, "label-1");
	assert.equal(details.results[0]?.setId, "0058175f-3474-40c3-a046-6cfaec86d84b");
	assert.deepEqual(details.results[0]?.brandNames, ["Low Dose Aspirin"]);
	assert.equal(details.results[0]?.purpose, "Purpose Pain reliever");
	assert.match(tool?.promptSnippet ?? "", /openFDA/);
});

test("science database tool searches openFDA label records with structured filters", async () => {
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		assert.equal(url.origin, "https://api.fda.gov");
		assert.equal(url.pathname, "/drug/label.json");
		assert.equal(url.searchParams.get("search"), 'openfda.brand_name.exact:"Tylenol" AND openfda.route.exact:"ORAL"');
		assert.equal(url.searchParams.get("limit"), "1");
		return jsonResponse({
			meta: { results: { total: 12 } },
			results: [{
				id: "label-tylenol",
				set_id: "spl-tylenol",
				effective_time: "20250101",
				openfda: {
					brand_name: ["TYLENOL"],
					generic_name: ["ACETAMINOPHEN"],
					route: ["ORAL"],
					application_number: ["NDA019872"],
				},
				indications_and_usage: ["Temporary relief of minor aches and pains."],
			}],
		});
	};

	const tool = registerTools().get("feynman_science_database_search");
	const result = await tool?.execute("call-openfda-labels", { source: "openfda", query: "labels brand=Tylenol route=ORAL exact=true", limit: 1 });
	const details = result?.details as { mode: string; results: Array<{ applicationNumbers: string[]; brandNames: string[]; genericNames: string[] }>; search: string; totalCount: number };

	assert.equal(details.mode, "drug-label");
	assert.equal(details.search, 'openfda.brand_name.exact:"Tylenol" AND openfda.route.exact:"ORAL"');
	assert.equal(details.totalCount, 12);
	assert.deepEqual(details.results[0]?.applicationNumbers, ["NDA019872"]);
	assert.deepEqual(details.results[0]?.genericNames, ["ACETAMINOPHEN"]);
});

test("science database tool fetches openFDA Drugs@FDA application details", async () => {
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		assert.equal(url.origin, "https://api.fda.gov");
		assert.equal(url.pathname, "/drug/drugsfda.json");
		assert.equal(url.searchParams.get("search"), 'application_number:"NDA020503"');
		assert.equal(url.searchParams.get("sort"), "application_number:asc");
		assert.equal(url.searchParams.get("limit"), "1");
		return jsonResponse({
			meta: { last_updated: "2025-12-01", results: { total: 1 } },
			results: [{
				application_number: "NDA020503",
				sponsor_name: "PFIZER",
				products: [{
					product_number: "001",
					brand_name: "ZYVOX",
					active_ingredients: [{ name: "LINEZOLID", strength: "600MG" }],
					dosage_form: "TABLET",
					route: "ORAL",
					marketing_status: "Prescription",
					te_code: "AB",
					reference_drug: "Yes",
					reference_standard: "Yes",
				}],
				submissions: [{
					submission_type: "ORIG",
					submission_number: "1",
					submission_status: "AP",
					submission_status_date: "20000418",
					review_priority: "PRIORITY",
				}],
				openfda: {
					brand_name: ["ZYVOX"],
					generic_name: ["LINEZOLID"],
					pharm_class_epc: ["Oxazolidinone Antibacterial"],
				},
			}],
		});
	};

	const tool = registerTools().get("feynman_science_database_search");
	const result = await tool?.execute("call-openfda-application", { source: "openfda", query: "application:NDA020503", limit: 1 });
	const details = result?.details as {
		found: boolean;
		mode: string;
		results: Array<{ applicationNumber: string; products: Array<{ activeIngredients: Array<{ name: string; strength: string }>; route: string }>; sponsorName: string }>;
		totalCount: number;
	};

	assert.equal(details.mode, "application-details");
	assert.equal(details.found, true);
	assert.equal(details.totalCount, 1);
	assert.equal(details.results[0]?.applicationNumber, "NDA020503");
	assert.equal(details.results[0]?.sponsorName, "PFIZER");
	assert.equal(details.results[0]?.products[0]?.route, "ORAL");
	assert.deepEqual(details.results[0]?.products[0]?.activeIngredients[0], { name: "LINEZOLID", strength: "600MG" });
});

test("science database tool aggregates openFDA Drugs@FDA application counts", async () => {
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		assert.equal(url.origin, "https://api.fda.gov");
		assert.equal(url.pathname, "/drug/drugsfda.json");
		assert.equal(url.searchParams.get("count"), "sponsor_name");
		assert.equal(url.searchParams.get("search"), 'products.brand_name:"Keytruda"');
		assert.equal(url.searchParams.get("limit"), "2");
		return jsonResponse({
			results: [
				{ term: "MERCK SHARP DOHME LLC", count: 4 },
				{ term: "MERCK", count: 1 },
			],
		});
	};

	const tool = registerTools().get("feynman_science_database_search");
	const result = await tool?.execute("call-openfda-count", { source: "openfda", query: "count:sponsor_name brand=Keytruda", limit: 2 });
	const details = result?.details as { apiField: string; bucketSum: number; countField: string; mode: string; results: Array<{ count: number; term: string }> };

	assert.equal(details.mode, "application-count");
	assert.equal(details.countField, "sponsor_name");
	assert.equal(details.apiField, "sponsor_name");
	assert.equal(details.bucketSum, 5);
	assert.equal(details.results[0]?.term, "MERCK SHARP DOHME LLC");
});

test("science database tool lists openFDA pharmacologic classes", async () => {
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		assert.equal(url.origin, "https://api.fda.gov");
		assert.equal(url.pathname, "/drug/drugsfda.json");
		assert.equal(url.searchParams.get("count"), "openfda.pharm_class_moa.exact");
		assert.equal(url.searchParams.get("limit"), "2");
		return jsonResponse({
			results: [
				{ term: "Cyclooxygenase Inhibitors", count: 42 },
				{ term: "Beta Adrenergic Blockade", count: 31 },
			],
		});
	};

	const tool = registerTools().get("feynman_science_database_search");
	const result = await tool?.execute("call-openfda-classes", { source: "openfda", query: "classes:moa", limit: 2 });
	const details = result?.details as { classType: string; mode: string; results: Array<{ count: number; term: string }> };

	assert.equal(details.mode, "pharmacologic-classes");
	assert.equal(details.classType, "moa");
	assert.equal(details.results[0]?.count, 42);
});

test("science database tool resolves openFDA generic equivalents from active ingredients", async () => {
	const seen: string[] = [];
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		seen.push(url.searchParams.get("search") ?? "");
		assert.equal(url.origin, "https://api.fda.gov");
		assert.equal(url.pathname, "/drug/drugsfda.json");
		if (seen.length === 1) {
			assert.equal(url.searchParams.get("search"), 'products.brand_name:"Advil"');
			return jsonResponse({
				meta: { results: { total: 1 } },
				results: [{
					application_number: "NDA018989",
					sponsor_name: "HALEON",
					products: [{
						product_number: "001",
						brand_name: "ADVIL",
						active_ingredients: [{ name: "IBUPROFEN", strength: "200MG" }],
						dosage_form: "TABLET",
						route: "ORAL",
						marketing_status: "Over-the-counter",
					}],
				}],
			});
		}
		assert.equal(url.searchParams.get("search"), 'products.active_ingredients.name:"IBUPROFEN"');
		return jsonResponse({
			meta: { results: { total: 2 } },
			results: [{
				application_number: "ANDA076123",
				sponsor_name: "GENERIC INC",
				products: [{
					product_number: "001",
					brand_name: "IBUPROFEN",
					active_ingredients: [{ name: "IBUPROFEN", strength: "200MG" }],
					dosage_form: "TABLET",
					route: "ORAL",
					marketing_status: "Over-the-counter",
				}],
			}],
		});
	};

	const tool = registerTools().get("feynman_science_database_search");
	const result = await tool?.execute("call-openfda-generics", { source: "openfda", query: "generics:Advil", limit: 2 });
	const details = result?.details as { activeIngredients: string[]; mode: string; referenceApplications: string[]; results: Array<{ applicationNumber: string; sponsorName: string }>; totalCount: number };

	assert.equal(details.mode, "generic-equivalents");
	assert.deepEqual(details.referenceApplications, ["NDA018989"]);
	assert.deepEqual(details.activeIngredients, ["IBUPROFEN"]);
	assert.equal(details.totalCount, 2);
	assert.equal(details.results[0]?.applicationNumber, "ANDA076123");
	assert.deepEqual(seen, ['products.brand_name:"Advil"', 'products.active_ingredients.name:"IBUPROFEN"']);
});

test("science database tool searches eQTL Catalogue v3 association rows", async () => {
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		assert.equal(url.toString(), "https://www.ebi.ac.uk/eqtl/api/v3/associations?gene_id=ENSG00000141510&size=1");
		return jsonResponse([{
			molecular_trait_id: "ENSG00000141510",
			chromosome: "17",
			position: 6693178,
			ref: "A",
			alt: "AACAC",
			variant: "chr17_6693178_A_AACAC",
			pvalue: 0.9662749767303467,
			beta: -0.00490573002025485,
			se: 0.11597699671983719,
			gene_id: "ENSG00000141510",
			rsid: "rs1277420555",
			study_id: "QTS000008",
			dataset_id: "QTD000075",
		}]);
	};

	const tool = registerTools().get("feynman_science_database_search");
	const result = await tool?.execute("call-eqtl", { source: "eqtlcatalogue", query: "gene:ENSG00000141510", limit: 1 });
	const details = result?.details as { results: Array<{ beta: number; datasetId: string; geneId: string; rsid: string; studyId: string }>; returned: number };

	assert.equal(details.returned, 1);
	assert.equal(details.results[0]?.geneId, "ENSG00000141510");
	assert.equal(details.results[0]?.rsid, "rs1277420555");
	assert.equal(details.results[0]?.studyId, "QTS000008");
	assert.equal(details.results[0]?.datasetId, "QTD000075");
	assert.equal(details.results[0]?.beta, -0.00490573002025485);
	assert.match(tool?.promptGuidelines?.join("\n") ?? "", /eQTL Catalogue study\/dataset\/variant\/gene\/p-value\/beta fields/);
});

test("science database tool searches GWAS Catalog association rows with allowed filters", async () => {
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		assert.equal(url.toString(), "https://www.ebi.ac.uk/gwas/rest/api/v2/associations?mapped_gene=PCSK9&size=1&page=0&sort=p_value&direction=asc");
		return jsonResponse({
			page: { totalElements: 1539 },
			_embedded: {
				associations: [{
					association_id: 217751971,
					p_value: 4e-15,
					pvalue_mantissa: 4,
					pvalue_exponent: -15,
					or_per_copy_num: 1.24,
					range: "[1.17-1.31]",
					risk_frequency: "0.991187",
					snp_effect_allele: ["rs11591147-G"],
					snp_allele: [{ rs_id: "rs11591147", effect_allele: "G" }],
					locations: ["1:55039974"],
					mapped_genes: ["PCSK9"],
					efo_traits: [{ efo_id: "EFO_0000266", efo_trait: "aortic stenosis" }],
					reported_trait: ["Aortic stenosis"],
					accession_id: "GCST90837551",
					pubmed_id: "41419686",
					first_author: "Small AM",
					_links: { self: { href: "https://www.ebi.ac.uk/gwas/rest/api/v2/associations/217751971" } },
				}],
			},
		});
	};

	const tool = registerTools().get("feynman_science_database_search");
	const result = await tool?.execute("call-gwas", { source: "gwascatalog", query: "gene:PCSK9", limit: 1 });
	const details = result?.details as {
		filter: Record<string, string>;
		results: Array<{ associationId: number; efoTraits: Array<{ efoId: string; efoTrait: string }>; oddsRatio: number; pValue: number; rsIds: string[]; studyAccession: string }>;
		totalCount: number;
		truncated: boolean;
	};

	assert.deepEqual(details.filter, { mapped_gene: "PCSK9" });
	assert.equal(details.totalCount, 1539);
	assert.equal(details.truncated, true);
	assert.equal(details.results[0]?.associationId, 217751971);
	assert.equal(details.results[0]?.pValue, 4e-15);
	assert.equal(details.results[0]?.oddsRatio, 1.24);
	assert.deepEqual(details.results[0]?.rsIds, ["rs11591147"]);
	assert.equal(details.results[0]?.efoTraits[0]?.efoId, "EFO_0000266");
	assert.equal(details.results[0]?.studyAccession, "GCST90837551");
	assert.match(tool?.promptSnippet ?? "", /GWAS Catalog/);
});

test("science database tool searches GWAS Catalog trait rows", async () => {
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		assert.equal(url.toString(), "https://www.ebi.ac.uk/gwas/rest/api/v2/efo-traits?trait=asthma&size=1&page=0");
		return jsonResponse({
			page: { totalElements: 13 },
			_embedded: {
				efo_traits: [{
					efo_trait: "T2-high asthma",
					uri: "http://purl.obolibrary.org/obo/MONDO_0956975",
					efo_id: "MONDO_0956975",
					_links: { self: { href: "https://www.ebi.ac.uk/gwas/rest/api/v2/efo-traits/MONDO_0956975" } },
				}],
			},
		});
	};

	const tool = registerTools().get("feynman_science_database_search");
	const result = await tool?.execute("call-gwas-trait", { source: "gwascatalog", query: "trait:asthma", limit: 1 });
	const details = result?.details as { mode: string; results: Array<{ efoId: string; efoTrait: string; uri: string }>; totalCount: number };

	assert.equal(details.mode, "traits");
	assert.equal(details.totalCount, 13);
	assert.equal(details.results[0]?.efoId, "MONDO_0956975");
	assert.equal(details.results[0]?.efoTrait, "T2-high asthma");
	assert.equal(details.results[0]?.uri, "http://purl.obolibrary.org/obo/MONDO_0956975");
	assert.match(tool?.promptGuidelines?.join("\n") ?? "", /GWAS Catalog association IDs/);
});

test("science database tool searches Human Protein Atlas rows", async () => {
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		assert.equal(url.origin, "https://www.proteinatlas.org");
		assert.equal(url.pathname, "/api/search_download.php");
		assert.equal(url.searchParams.get("search"), "TP53");
		assert.equal(url.searchParams.get("format"), "json");
		assert.equal(url.searchParams.get("compress"), "no");
		assert.match(url.searchParams.get("columns") ?? "", /rnatsm/);
		return jsonResponse([{
			Gene: "TP53",
			"Gene synonym": ["LFS1", "p53"],
			Ensembl: "ENSG00000141510",
			Uniprot: ["P04637"],
			"RNA tissue specificity": "Low tissue specificity",
			"RNA tissue distribution": "Detected in all",
			"RNA tissue specific nTPM": "esophagus: 112.2",
		}]);
	};

	const tool = registerTools().get("feynman_science_database_search");
	const result = await tool?.execute("call-hpa", { source: "proteinatlas", query: "TP53", limit: 1 });
	const details = result?.details as { results: Array<{ ensembl: string; gene: string; geneSynonyms: string[]; uniprotAccessions: string[]; url: string }>; totalCount: number };

	assert.equal(details.totalCount, 1);
	assert.equal(details.results[0]?.gene, "TP53");
	assert.equal(details.results[0]?.ensembl, "ENSG00000141510");
	assert.deepEqual(details.results[0]?.geneSynonyms, ["LFS1", "p53"]);
	assert.deepEqual(details.results[0]?.uniprotAccessions, ["P04637"]);
	assert.equal(details.results[0]?.url, "https://www.proteinatlas.org/ENSG00000141510-TP53");
});
