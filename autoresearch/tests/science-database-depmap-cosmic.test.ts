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

test("science database tool searches Feynman-owned DepMap model and dependency records", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		requests.push(url.toString());
		if (url.hostname !== "api.cellmodelpassports.sanger.ac.uk") throw new Error(`unexpected URL ${url.toString()}`);
		if (url.pathname === "/search/SNU-1033") {
			return jsonResponse({
				data: [{
					type: "model",
					id: "SIDM00192",
					attributes: {
						names: ["SNU-1033"],
						model_type: "Cell Line",
						growth_properties: "Adherent",
						crispr_ko_available: true,
						rnaseq_available: true,
						mutations_available: true,
					},
				}],
				meta: { count: 1 },
			});
		}
		if (url.pathname === "/genes") {
			assert.match(url.searchParams.get("filter") ?? "", /BRAF/);
			return jsonResponse({
				data: [{
					type: "gene",
					id: "SIDG02491",
					attributes: {
						symbol: "BRAF",
						hgnc_id: "HGNC:1097",
						hgnc_status: "current",
						location: "7q34",
						cancer_driver: true,
						method_of_action: "Act",
						in_yusa_lib: true,
					},
				}],
				meta: { count: 1 },
			});
		}
		if (url.pathname === "/genes/SIDG02491/datasets/crispr_ko") {
			assert.equal(url.searchParams.get("page[size]"), "2");
			return jsonResponse({
				data: [{
					type: "crispr_ko",
					id: "drop-me",
					attributes: {
						source: "Sanger",
						bf: -2.4,
						bf_scaled: -1.2,
						fc_clean: -0.6,
						fc_clean_qn: -0.5,
						mageck_fdr: 0.01,
						qc_pass: true,
					},
					relationships: {
						gene: { data: { type: "gene", id: "SIDG02491" } },
						model: { data: { type: "model", id: "SIDM00192" } },
					},
				}],
				meta: { count: 1 },
			});
		}
		throw new Error(`unexpected DepMap request ${url.toString()}`);
	};

	const tools = registerTools();
	const search = await tools.get("feynman_science_database_search")?.execute("call-depmap-search", {
		source: "depmap",
		query: "SNU-1033",
		limit: 2,
	});
	const dependency = await tools.get("feynman_science_database_search")?.execute("call-depmap-dependency", {
		source: "depmap",
		query: "dependencies:BRAF@SIDM00192",
		limit: 2,
	});
	const searchDetails = search?.details as { results: Array<{ modelId?: string; names?: string[]; url?: string }>; searchMode?: string };
	const dependencyDetails = dependency?.details as { gene?: { geneId?: string; hgncId?: string; symbol?: string }; results: Array<{ bayesFactor?: number; geneId?: string; modelId?: string; source?: string }>; searchMode?: string; totalCount?: number };

	assert.equal(searchDetails.searchMode, "model-search");
	assert.equal(searchDetails.results[0]?.modelId, "SIDM00192");
	assert.equal(searchDetails.results[0]?.names?.[0], "SNU-1033");
	assert.equal(searchDetails.results[0]?.url, "https://cellmodelpassports.sanger.ac.uk/passports/SIDM00192");
	assert.equal(dependencyDetails.searchMode, "crispr-dependencies");
	assert.equal(dependencyDetails.gene?.geneId, "SIDG02491");
	assert.equal(dependencyDetails.gene?.hgncId, "HGNC:1097");
	assert.equal(dependencyDetails.totalCount, 1);
	assert.equal(dependencyDetails.results[0]?.modelId, "SIDM00192");
	assert.equal(dependencyDetails.results[0]?.source, "Sanger");
	assert.equal(dependencyDetails.results[0]?.bayesFactor, -2.4);
	assert.equal(requests.length, 3);
	assert.match(tools.get("feynman_science_database_search")?.promptSnippet ?? "", /DepMap/);
});

test("science database tool accepts DepMap reference cancer-model query names", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		requests.push(url.toString());
		if (url.hostname !== "api.cellmodelpassports.sanger.ac.uk") throw new Error(`unexpected URL ${url.toString()}`);
		if (url.pathname === "/models/SIDM00192") {
			return jsonResponse({
				data: {
					type: "model",
					id: "SIDM00192",
					attributes: { names: ["SNU-1033"], model_type: "Cell Line", mutations_available: true },
					relationships: { sample: { data: { type: "sample", id: "SIDS00192" } } },
				},
				included: [
					{ type: "sample", id: "SIDS00192", relationships: { tissue: { data: { type: "tissue", id: "Large Intestine" } }, cancer_type: { data: { type: "cancer_type", id: "Colorectal Carcinoma" } } } },
					{ type: "tissue", id: "Large Intestine", attributes: { name: "Large Intestine" } },
					{ type: "cancer_type", id: "Colorectal Carcinoma", attributes: { name: "Colorectal Carcinoma" } },
				],
			});
		}
		if (url.pathname === "/models") {
			assert.match(url.searchParams.get("filter") ?? "", /Large Intestine|Colorectal Carcinoma/);
			return jsonResponse({
				data: [{
					type: "model",
					id: "SIDM00192",
					attributes: { names: ["SNU-1033"], model_type: "Cell Line", crispr_ko_available: true },
				}],
				meta: { count: 1 },
			});
		}
		if (url.pathname === "/search/SNU") {
			return jsonResponse({
				data: [{
					type: "model",
					id: "SIDM00192",
					attributes: { names: ["SNU-1033"], model_type: "Cell Line", crispr_ko_available: true },
				}],
				meta: { count: 1 },
			});
		}
		if (url.pathname === "/genes") {
			const filter = url.searchParams.get("filter") ?? "";
			assert.match(filter, /BRA|BRAF/);
			return jsonResponse({
				data: [{
					type: "gene",
					id: "SIDG02491",
					attributes: { symbol: "BRAF", hgnc_id: "HGNC:1097", cancer_driver: true },
				}],
				meta: { count: 1 },
			});
		}
		if (url.pathname === "/genes/SIDG02491/datasets/crispr_ko") {
			return jsonResponse({
				data: [{
					type: "crispr_ko",
					attributes: { source: "Broad", bf: -1.7 },
					relationships: {
						gene: { data: { type: "gene", id: "SIDG02491" } },
						model: { data: { type: "model", id: "SIDM00192" } },
					},
				}],
				meta: { count: 1 },
			});
		}
		throw new Error(`unexpected DepMap request ${url.toString()}`);
	};

	const tools = registerTools();
	const getModel = await tools.get("feynman_science_database_search")?.execute("depmap-get-model", {
		source: "depmap",
		query: "get_model:SIDM00192",
	});
	const listModels = await tools.get("feynman_science_database_search")?.execute("depmap-list-models", {
		source: "depmap",
		query: "list_models:tissue=Large Intestine;cancer_type=Colorectal Carcinoma",
	});
	const searchModels = await tools.get("feynman_science_database_search")?.execute("depmap-search-models", {
		source: "depmap",
		query: "search_models:SNU",
	});
	const searchGenes = await tools.get("feynman_science_database_search")?.execute("depmap-search-genes", {
		source: "depmap",
		query: "search_genes:BRA",
	});
	const dependencies = await tools.get("feynman_science_database_search")?.execute("depmap-gene-dependencies", {
		source: "depmap",
		query: "gene_dependencies:BRAF@SIDM00192",
	});

	assert.equal((getModel?.details as { searchMode?: string }).searchMode, "model-detail");
	assert.equal((listModels?.details as { searchMode?: string }).searchMode, "model-list");
	assert.equal((searchModels?.details as { searchMode?: string }).searchMode, "model-search");
	assert.equal((searchGenes?.details as { searchMode?: string }).searchMode, "gene-search");
	assert.equal((dependencies?.details as { searchMode?: string }).searchMode, "crispr-dependencies");
	assert.equal(requests.some((request) => request.includes("/models/SIDM00192")), true);
	assert.equal(requests.some((request) => request.includes("/genes/SIDG02491/datasets/crispr_ko")), true);
});

test("science database tool fetches bounded COSMIC mutation records through NLM Clinical Tables", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		requests.push(url.toString());
		if (url.hostname !== "clinicaltables.nlm.nih.gov" || url.pathname !== "/api/cosmic/v4/search") throw new Error(`unexpected URL ${url.toString()}`);
		assert.equal(url.searchParams.get("terms"), "BRAF V600E");
		assert.equal(url.searchParams.get("grchv"), "38");
		assert.equal(url.searchParams.get("maxList"), "3");
		return jsonResponse([
			753,
			["224203145"],
			{
				AccessionNumber: ["ENST00000646891.1"],
				GeneName: ["BRAF"],
				HGNC_ID: ["HGNC:1097"],
				MutationAA: ["p.V600E"],
				MutationCDS: ["c.1799T>A"],
				MutationDescription: ["Substitution - Missense"],
				MutationGenomePosition: ["7:140753336-140753336"],
				MutationID: ["224203145"],
				LegacyMutationID: ["COSM476"],
				GenomicMutationID: ["COSV56077494"],
				PrimaryHistology: ["malignant melanoma"],
				PrimarySite: ["skin"],
				PubmedPMID: ["12068308"],
				GRChVer: ["38"],
				COSMIC_GENE_ID: ["COSG739"],
				COSMIC_PHENOTYPE_ID: ["COSO465"],
			},
			[["224203145", "BRAF", "c.1799T>A", "p.V600E"]],
		]);
	};

	const result = await registerTools().get("feynman_science_database_search")?.execute("call-cosmic", {
		source: "cosmic",
		query: "grch38:BRAF V600E",
		limit: 3,
	});
	const details = result?.details as { grchVersion?: string; results: Array<Record<string, unknown>>; searchMode?: string; totalCount?: number; warnings?: string[] };

	assert.equal(details.searchMode, "terms");
	assert.equal(details.grchVersion, "38");
	assert.equal(details.totalCount, 753);
	assert.equal(details.results[0]?.mutationId, "224203145");
	assert.equal(details.results[0]?.legacyMutationId, "COSM476");
	assert.equal(details.results[0]?.genomicMutationId, "COSV56077494");
	assert.equal(details.results[0]?.cosmicGeneId, "COSG739");
	assert.equal(details.results[0]?.cosmicPhenotypeId, "COSO465");
	assert.equal(details.results[0]?.mutationCds, "c.1799T>A");
	assert.equal(details.results[0]?.mutationAa, "p.V600E");
	assert.equal(details.results[0]?.primarySite, "skin");
	assert.deepEqual(details.results[0]?.pubmedIds, ["12068308"]);
	assert.deepEqual(details.results[0]?.pubmedUrls, ["https://pubmed.ncbi.nlm.nih.gov/12068308/"]);
	assert.match(details.warnings?.[0] ?? "", /does not support pagination/);
	assert.equal(requests.length, 1);
	assert.match(registerTools().get("feynman_science_database_search")?.promptSnippet ?? "", /COSMIC/);
});
