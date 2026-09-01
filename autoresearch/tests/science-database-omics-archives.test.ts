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

function jsonResponse(body: unknown, headers?: HeadersInit): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json", ...(headers ?? {}) },
	});
}

function arrayExpressStudy() {
	return {
		accno: "E-MTAB-5061",
		attributes: [{ name: "ReleaseDate", value: "2016-09-22" }],
		section: {
			accno: "s-E-MTAB-5061",
			type: "Study",
			attributes: [
				{ name: "Title", value: "Pancreas single-cell RNA-seq" },
				{ name: "Study type", value: "RNA-seq of coding RNA from single cells" },
				{ name: "Organism", value: "Homo sapiens" },
				{ name: "Description", value: "A functional genomics experiment." },
			],
			subsections: [
				{
					type: "Samples",
					accno: "samples",
					attributes: [{ name: "Sample Name", value: "sample-1" }, { name: "Factor Value[disease]", value: "healthy" }],
				},
				{
					type: "Assays and Data",
					files: [
						{ name: "E-MTAB-5061.sdrf.txt", type: "sdrf", size: 1234 },
						{ name: "counts.tsv", type: "processed", size: 2345 },
					],
				},
			],
		},
	};
}

test("science database tool accepts exact omics archive query names", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = String(input);
		requests.push(url);
		if (url.includes("biostudies/api/v1/search")) {
			return jsonResponse({
				totalHits: 1,
				hits: [{ accession: "E-MTAB-5061", title: "Pancreas single-cell RNA-seq", files: 2, isPublic: true }],
			});
		}
		if (url.includes("biostudies/api/v1/studies/E-MTAB-5061")) {
			return jsonResponse(arrayExpressStudy());
		}
		if (url.includes("eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi")) {
			return jsonResponse({ esearchresult: { count: "1", idlist: ["200000001"] } });
		}
		if (url.includes("eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi")) {
			return jsonResponse({
				result: {
					uids: ["200000001"],
					"200000001": {
						uid: "200000001",
						accession: "GSE123",
						title: "GEO series",
						summary: "A GEO series.",
						gdstype: "Expression profiling by high throughput sequencing",
						taxon: "Homo sapiens",
						n_samples: 3,
						pdat: "2026/01/01",
						samples: [{ accession: "GSM1", title: "sample" }],
					},
				},
			});
		}
		if (url === "https://www.ebi.ac.uk/metabolights/ws/studies") {
			return jsonResponse({ content: ["MTBLS1", "MTBLS2"], studies: 2 });
		}
		if (url === "https://www.ebi.ac.uk/metabolights/ws/studies/public/study/MTBLS1") {
			return jsonResponse({
				content: {
					studyIdentifier: "MTBLS1",
					title: "Metabolomics study",
					studyDescription: "NMR metabolomics.",
					studyStatus: "Public",
					organism: [{ organismName: "Homo sapiens", organismPart: "urine" }],
					assays: [{ assayNumber: 1, measurement: "metabolite profiling", technology: "NMR spectroscopy" }],
					protocols: [{ name: "Extraction", description: "Extract metabolites." }],
					sampleTable: {
						fields: {
							"0~Source Name": { index: 0, header: "Source Name" },
							"1~Factor Value[disease]": { index: 1, header: "Factor Value[disease]" },
						},
						data: [["S1", "control"], ["S2", "case"]],
					},
				},
			});
		}
		if (url === "https://www.ebi.ac.uk/metabolights/ws/studies/MTBLS1/files?include_raw_data=true") {
			return jsonResponse({ study: [{ file: "FILES", directory: true }, { file: "i_Investigation.txt", type: "metadata" }] });
		}
		if (url === "https://www.ebi.ac.uk/metabolights/ws/studies/MTBLS1/public-data-files?file_match=true&folder_match=false&search_pattern=*.mzML") {
			return jsonResponse({ files: ["FILES/a.mzML", { name: "FILES/b.mzML" }] });
		}
		if (url.includes("metagenomics/api/v2/studies/MGYS00010397/analyses")) {
			return jsonResponse({
				count: 1,
				items: [{ accession: "MGYA01020362", study_accession: "MGYS00010397", experiment_type: "Amplicon", pipeline_version: "V6", run: { accession: "SRR1" }, sample: { accession: "SAMN1", sample_title: "sample" } }],
			});
		}
		if (url === "https://www.ebi.ac.uk/metagenomics/api/v2/studies/MGYS00010397") {
			return jsonResponse({
				accession: "MGYS00010397",
				title: "Human gut metagenome",
				ena_accessions: ["ERP1"],
				biome: { biome_name: "Large intestine", lineage: "root:Host-associated:Human" },
				metadata: { study_accession: "PRJEB1", center_name: "EMG", study_description: "Metagenomics study." },
			});
		}
		if (url.includes("metagenomics/api/v2/studies")) {
			return jsonResponse({
				count: 1,
				items: [{
					accession: "MGYS00010397",
					title: "Human gut metagenome",
					ena_accessions: ["ERP1"],
					biome: { biome_name: "Large intestine", lineage: "root:Host-associated:Human" },
					metadata: { study_accession: "PRJEB1", center_name: "EMG" },
				}],
			});
		}
		if (url.includes("pride/ws/archive/v2/search/projects")) {
			return jsonResponse([{
				accession: "PXD000001",
				title: "Proteome project",
				organisms: ["Homo sapiens (human)"],
				instruments: ["Orbitrap"],
				experimentTypes: ["Shotgun proteomics"],
				references: [{ pubmedID: 123, doi: "10.1/pride", referenceLine: "Reference" }],
			}], { total_records: "1" });
		}
		if (url === "https://www.ebi.ac.uk/pride/ws/archive/v2/projects/PXD000001") {
			return jsonResponse({
				accession: "PXD000001",
				title: "Proteome project",
				organisms: [{ name: "Homo sapiens (human)" }],
				instruments: [{ name: "Orbitrap" }],
				experimentTypes: [{ name: "Shotgun proteomics" }],
				references: [{ pubmedID: 123, doi: "10.1/pride", referenceLine: "Reference" }],
			});
		}
		if (url.includes("pride/ws/archive/v2/pride-ap/search/proteins")) {
			return jsonResponse([{ proteinAccession: "P04637", proteinName: "Cellular tumor antigen p53", gene: "TP53", projectCount: 1 }]);
		}
		if (url.includes("pride/ws/archive/v2/proteins/search")) {
			return jsonResponse([{ proteinAccession: "P04637", projects: ["PXD000001"] }]);
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tool = registerTools().get("feynman_science_database_search");
	assert.ok(tool);
	const cases = [
		{ source: "arrayexpress", query: "arrayexpress_search_experiments:query=pancreas organism=\"Homo sapiens\"", mode: "arrayexpress_search_experiments" },
		{ source: "arrayexpress", query: "arrayexpress_get_experiment:E-MTAB-5061", mode: "arrayexpress_get_experiment" },
		{ source: "arrayexpress", query: "arrayexpress_get_experiment_files:E-MTAB-5061", mode: "arrayexpress_get_experiment_files" },
		{ source: "arrayexpress", query: "arrayexpress_get_experiment_samples:E-MTAB-5061", mode: "arrayexpress_get_experiment_samples" },
		{ source: "geo", query: "geo_search_series:single cell", mode: "geo_search_series" },
		{ source: "geo", query: "geo_get_series:GSE123", mode: "geo_get_series" },
		{ source: "metabolights", query: "metabolights_list_studies", mode: "studies" },
		{ source: "metabolights", query: "metabolights_get_studies:MTBLS1 include_samples=true", mode: "metabolights_get_studies" },
		{ source: "metabolights", query: "metabolights_get_study_files:MTBLS1", mode: "files" },
		{ source: "metabolights", query: "metabolights_search_data_files:MTBLS1 pattern=*.mzML", mode: "data-files" },
		{ source: "mgnify", query: "mgnify_search_studies:query=\"human gut\"", mode: "mgnify_search_studies" },
		{ source: "mgnify", query: "mgnify_get_studies:MGYS00010397 include_analyses=true", mode: "mgnify_get_studies" },
		{ source: "mgnify", query: "mgnify_get_study_analyses:MGYS00010397", mode: "mgnify_get_study_analyses" },
		{ source: "pride", query: "pride_search_projects:keyword=proteome organism=\"Homo sapiens (human)\"", mode: "pride_search_projects" },
		{ source: "pride", query: "pride_get_projects:PXD000001", mode: "pride_get_projects" },
		{ source: "pride", query: "pride_search_project_proteins:project_accession=PXD000001 keyword=TP53", mode: "pride_search_project_proteins" },
		{ source: "pride", query: "pride_find_projects_for_protein:P04637", mode: "pride_find_projects_for_protein" },
	];
	for (const item of cases) {
		const result = await tool.execute(`call-${item.mode}`, { source: item.source, query: item.query, limit: 2 });
		const details = result.details as { mode?: string; results: unknown[]; returned: number };
		assert.equal(details.mode, item.mode);
		assert.ok(details.returned >= 1 || details.results.length >= 1, item.mode);
	}
	const mgnify = await tool.execute("call-mgnify-detail", { source: "mgnify", query: "mgnify_get_studies:MGYS00010397 include_analyses=true", limit: 2 });
	const mgnifyDetails = mgnify.details as { results: Array<{ analyses: Array<{ accession: string }> }> };
	assert.equal(mgnifyDetails.results[0]?.analyses[0]?.accession, "MGYA01020362");
	const metabolights = await tool.execute("call-metabolights-samples", { source: "metabolights", query: "metabolights_get_studies:MTBLS1 include_samples=true", limit: 2 });
	const metabolightsDetails = metabolights.details as { results: Array<{ protocols: Array<{ name: string }>; sampleTable: { nRowsTotal: number } }> };
	assert.equal(metabolightsDetails.results[0]?.protocols[0]?.name, "Extraction");
	assert.equal(metabolightsDetails.results[0]?.sampleTable.nRowsTotal, 2);
	assert.ok(requests.some((url) => url.includes("biostudies/api/v1/studies/E-MTAB-5061")));
	assert.ok(requests.some((url) => url.includes("pride/ws/archive/v2/proteins/search")));
	assert.match(tool.promptGuidelines?.join("\n") ?? "", /ArrayExpress/);
}
);
