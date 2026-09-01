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

test("science database tool searches Feynman-owned Open Targets records", async () => {
	const requests: Array<{ body: { query?: string; variables?: Record<string, unknown> }; method: string; url: string }> = [];
	globalThis.fetch = async (input, init) => {
		const url = String(input);
		const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string; variables?: Record<string, unknown> };
		requests.push({ url, method: init?.method ?? "GET", body });
		if (url !== "https://api.platform.opentargets.org/api/v4/graphql") throw new Error(`unexpected URL ${url}`);
		assert.equal(init?.method, "POST");
		if (body.query?.includes("search(")) {
			assert.deepEqual(body.variables, { term: "BRAF melanoma", size: 3 });
			return jsonResponse({ data: { search: { total: 198, hits: [
				{ id: "MONDO_0005105", name: "melanoma", entity: "disease" },
				{ id: "ENSG00000157764", name: "BRAF", entity: "target" },
			] } } });
		}
		if (body.query?.includes("target(ensemblId")) {
			return jsonResponse({ data: { target: {
				id: "ENSG00000157764",
				approvedSymbol: "BRAF",
				approvedName: "B-Raf proto-oncogene, serine/threonine kinase",
				biotype: "protein_coding",
				functionDescriptions: ["Protein kinase involved in MAPK signalling."],
				geneticConstraint: [{ constraintType: "lof", score: 1, oe: 0.15 }],
				associatedDiseases: { count: 3139, rows: [{ score: 0.8195, disease: { id: "MONDO_0005105", name: "melanoma" } }] },
				drugAndClinicalCandidates: { count: 18, rows: [{ id: "candidate-1", maxClinicalStage: "APPROVAL", drug: { id: "CHEMBL1229517", name: "VEMURAFENIB", drugType: "Small molecule" } }] },
			} } });
		}
		if (body.query?.includes("drug(chemblId")) {
			return jsonResponse({ data: { drug: {
				id: "CHEMBL1201583",
				name: "BEVACIZUMAB",
				drugType: "Antibody",
				description: "Antibody drug with approved and investigational indications.",
				maximumClinicalStage: "APPROVAL",
				mechanismsOfAction: { rows: [{ mechanismOfAction: "VEGFA inhibitor", actionType: "INHIBITOR", targets: [{ id: "ENSG00000112715", approvedSymbol: "VEGFA", approvedName: "vascular endothelial growth factor A" }] }] },
			} } });
		}
		throw new Error(`unexpected Open Targets query ${body.query ?? ""}`);
	};

	const tools = registerTools();
	const search = await tools.get("feynman_science_database_search")?.execute("call-ot-search", {
		source: "opentargets",
		query: "BRAF melanoma",
		limit: 3,
	});
	const target = await tools.get("feynman_science_database_search")?.execute("call-ot-target", {
		source: "opentargets",
		query: "target:ENSG00000157764",
		limit: 3,
	});
	const drug = await tools.get("feynman_science_database_search")?.execute("call-ot-drug", {
		source: "opentargets",
		query: "drug:CHEMBL1201583",
	});
	const searchDetails = search?.details as { results: Array<{ entity?: string; id?: string; url?: string }>; searchMode?: string; totalCount?: number };
	const targetDetails = target?.details as { results: Array<{ approvedSymbol?: string; associatedDiseases?: { count?: number; rows?: Array<{ disease?: { id?: string } }> }; drugAndClinicalCandidates?: { rows?: Array<{ drug?: { id?: string } }> } }>; searchMode?: string };
	const drugDetails = drug?.details as { results: Array<{ id?: string; mechanismsOfAction?: Array<{ targets?: Array<{ approvedSymbol?: string }> }> }>; searchMode?: string };

	assert.equal(searchDetails.searchMode, "search");
	assert.equal(searchDetails.totalCount, 198);
	assert.equal(searchDetails.results[0]?.id, "MONDO_0005105");
	assert.equal(searchDetails.results[0]?.url, "https://platform.opentargets.org/disease/MONDO_0005105");
	assert.equal(targetDetails.searchMode, "target");
	assert.equal(targetDetails.results[0]?.approvedSymbol, "BRAF");
	assert.equal(targetDetails.results[0]?.associatedDiseases?.count, 3139);
	assert.equal(targetDetails.results[0]?.associatedDiseases?.rows?.[0]?.disease?.id, "MONDO_0005105");
	assert.equal(targetDetails.results[0]?.drugAndClinicalCandidates?.rows?.[0]?.drug?.id, "CHEMBL1229517");
	assert.equal(drugDetails.searchMode, "drug");
	assert.equal(drugDetails.results[0]?.id, "CHEMBL1201583");
	assert.equal(drugDetails.results[0]?.mechanismsOfAction?.[0]?.targets?.[0]?.approvedSymbol, "VEGFA");
	assert.equal(requests.length, 3);
	assert.match(tools.get("feynman_science_database_search")?.promptSnippet ?? "", /Open Targets/);
});

test("science database tool fetches Open Targets disease and evidence rows", async () => {
	const requests: Array<{ body: { query?: string; variables?: Record<string, unknown> } }> = [];
	globalThis.fetch = async (input, init) => {
		const url = String(input);
		const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string; variables?: Record<string, unknown> };
		requests.push({ body });
		if (url !== "https://api.platform.opentargets.org/api/v4/graphql") throw new Error(`unexpected URL ${url}`);
		if (body.query?.includes("evidences(")) {
			assert.deepEqual(body.variables, { target: "ENSG00000157764", disease: "MONDO_0005105", size: 2 });
			return jsonResponse({ data: { disease: {
				id: "MONDO_0005105",
				name: "melanoma",
				evidences: { count: 17997, rows: [
					{ datasourceId: "intogen", datatypeId: "somatic_mutation", score: 1, target: { id: "ENSG00000157764", approvedSymbol: "BRAF" }, disease: { id: "MONDO_0005105", name: "melanoma" } },
				] },
			} } });
		}
		if (body.query?.includes("disease(efoId")) {
			assert.deepEqual(body.variables, { id: "MONDO_0004992", size: 2 });
			return jsonResponse({ data: { disease: {
				id: "MONDO_0004992",
				name: "cancer",
				description: "A tumor composed of atypical neoplastic cells.",
				therapeuticAreas: [{ id: "MONDO_0045024", name: "cell proliferation disorder" }],
				associatedTargets: { count: 22581, rows: [{ score: 0.94, target: { id: "ENSG00000139618", approvedSymbol: "BRCA2", approvedName: "BRCA2 DNA repair associated" } }] },
				drugAndClinicalCandidates: { count: 293, rows: [{ id: "candidate-2", maxClinicalStage: "APPROVAL", drug: { id: "CHEMBL1201583", name: "BEVACIZUMAB", drugType: "Antibody" } }] },
			} } });
		}
		throw new Error(`unexpected Open Targets query ${body.query ?? ""}`);
	};

	const tools = registerTools();
	const disease = await tools.get("feynman_science_database_search")?.execute("call-ot-disease", {
		source: "opentargets",
		query: "disease-targets:MONDO_0004992",
		limit: 2,
	});
	const evidence = await tools.get("feynman_science_database_search")?.execute("call-ot-evidence", {
		source: "opentargets",
		query: "evidence:ENSG00000157764@MONDO_0005105",
		limit: 2,
	});
	const diseaseDetails = disease?.details as { results: Array<{ associatedTargets?: { count?: number; rows?: Array<{ target?: { approvedSymbol?: string } }> }; id?: string }>; searchMode?: string };
	const evidenceDetails = evidence?.details as { disease?: { id?: string }; results: Array<{ datasourceId?: string; target?: { approvedSymbol?: string } }>; searchMode?: string; totalCount?: number };

	assert.equal(diseaseDetails.searchMode, "disease-targets");
	assert.equal(diseaseDetails.results[0]?.id, "MONDO_0004992");
	assert.equal(diseaseDetails.results[0]?.associatedTargets?.count, 22581);
	assert.equal(diseaseDetails.results[0]?.associatedTargets?.rows?.[0]?.target?.approvedSymbol, "BRCA2");
	assert.equal(evidenceDetails.searchMode, "target-disease-evidence");
	assert.equal(evidenceDetails.disease?.id, "MONDO_0005105");
	assert.equal(evidenceDetails.totalCount, 17997);
	assert.equal(evidenceDetails.results[0]?.datasourceId, "intogen");
	assert.equal(evidenceDetails.results[0]?.target?.approvedSymbol, "BRAF");
	assert.equal(requests.length, 2);
});

test("science database tool accepts Open Targets reference clinical-genomics query names", async () => {
	const requests: Array<{ body: { query?: string; variables?: Record<string, unknown> } }> = [];
	globalThis.fetch = async (input, init) => {
		const url = String(input);
		const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string; variables?: Record<string, unknown> };
		requests.push({ body });
		if (url !== "https://api.platform.opentargets.org/api/v4/graphql") throw new Error(`unexpected URL ${url}`);
		if (body.query?.includes("search(")) {
			return jsonResponse({ data: { search: { total: 2, hits: [{ id: "ENSG00000157764", name: "BRAF", entity: "target" }] } } });
		}
		if (body.query?.includes("drug(chemblId")) {
			return jsonResponse({ data: { drug: { id: "CHEMBL1201583", name: "BEVACIZUMAB", mechanismsOfAction: { rows: [] } } } });
		}
		if (body.query?.includes("disease(efoId")) {
			return jsonResponse({ data: { disease: {
				id: body.variables?.id,
				name: "cancer",
				description: "Cancer.",
				therapeuticAreas: [],
				associatedTargets: { count: 1, rows: [{ score: 0.94, target: { id: "ENSG00000139618", approvedSymbol: "BRCA2" } }] },
				drugAndClinicalCandidates: { count: 1, rows: [{ id: "candidate-1", maxClinicalStage: "APPROVAL", drug: { id: "CHEMBL1201583", name: "BEVACIZUMAB" } }] },
			} } });
		}
		throw new Error(`unexpected Open Targets query ${body.query ?? ""}`);
	};

	const tool = registerTools().get("feynman_science_database_search");
	const graphqlSearch = await tool?.execute("call-ot-reference-graphql", { source: "opentargets", query: "open_targets_graphql:query BRAF melanoma", limit: 2 });
	const diseaseDrugs = await tool?.execute("call-ot-reference-disease-drugs", { source: "opentargets", query: "open_targets_disease_drugs:MONDO_0004992", limit: 2 });
	const diseaseTargets = await tool?.execute("call-ot-reference-disease-targets", { source: "opentargets", query: "open_targets_disease_targets:MONDO_0004992", limit: 2 });
	const drug = await tool?.execute("call-ot-reference-drug", { source: "opentargets", query: "open_targets_drug:CHEMBL1201583", limit: 2 });

	assert.equal((graphqlSearch?.details as { searchMode?: string }).searchMode, "search");
	assert.equal((diseaseDrugs?.details as { searchMode?: string }).searchMode, "disease-drugs");
	assert.equal((diseaseTargets?.details as { searchMode?: string }).searchMode, "disease-targets");
	assert.equal((drug?.details as { searchMode?: string }).searchMode, "drug");
	assert.deepEqual(requests.map((request) => request.body.variables), [
		{ term: "BRAF melanoma", size: 2 },
		{ id: "MONDO_0004992", size: 2 },
		{ id: "MONDO_0004992", size: 2 },
		{ id: "CHEMBL1201583" },
	]);
});
