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

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

test("science database tool supports exact regulation command names", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		requests.push(url.toString());
		if (url.origin === "https://www.encodeproject.org" && url.pathname === "/report/") {
			const type = url.searchParams.get("type");
			if (type === "Experiment") {
				assert.equal(url.searchParams.get("assay_title"), "TF ChIP-seq");
				assert.equal(url.searchParams.get("target.label"), "CTCF");
				assert.equal(url.searchParams.get("replicates.library.biosample.donor.organism.scientific_name"), "Homo sapiens");
				return jsonResponse({
					total: 44,
					"@graph": [{
						accession: "ENCSR000AKP",
						"@id": "/experiments/ENCSR000AKP/",
						status: "released",
						assay_title: "TF ChIP-seq",
						assay_term_name: "ChIP-seq",
						target: { label: "CTCF" },
						biosample_ontology: { term_name: "K562", classification: "cell line" },
						lab: { title: "ENCODE Lab" },
						date_released: "2011-01-01",
					}],
				});
			}
			if (type === "Biosample") {
				assert.equal(url.searchParams.get("biosample_ontology.term_name"), "K562");
				return jsonResponse({
					total: 7,
					"@graph": [{
						accession: "ENCBS000AAA",
						"@id": "/biosamples/ENCBS000AAA/",
						status: "released",
						biosample_ontology: { term_name: "K562", classification: "cell line" },
						organism: { scientific_name: "Homo sapiens" },
						lab: { title: "ENCODE Lab" },
						summary: "Homo sapiens K562 cell line",
					}],
				});
			}
			if (type === "File") {
				assert.equal(url.searchParams.get("file_format"), "bigWig");
				assert.equal(url.searchParams.get("output_type"), "signal p-value");
				return jsonResponse({
					total: 12,
					"@graph": [{
						accession: "ENCFF002JUR",
						"@id": "/files/ENCFF002JUR/",
						status: "released",
						file_format: "bigWig",
						output_type: "signal p-value",
						assay_term_name: "ChIP-seq",
						assembly: "GRCh38",
						file_size: 12345,
					}],
				});
			}
		}
		if (url.origin === "https://www.encodeproject.org" && url.pathname === "/ENCSR000AKP/") {
			return jsonResponse({
				accession: "ENCSR000AKP",
				"@id": "/experiments/ENCSR000AKP/",
				status: "released",
				assay_title: "TF ChIP-seq",
				assay_term_name: "ChIP-seq",
				target: { label: "CTCF" },
				biosample_ontology: { term_name: "K562", classification: "cell line" },
				assembly: ["GRCh38"],
				uuid: "experiment-uuid",
			});
		}
		if (url.origin === "https://www.encodeproject.org" && url.pathname === "/ENCFF002JUR/") {
			return jsonResponse({
				accession: "ENCFF002JUR",
				"@id": "/files/ENCFF002JUR/",
				status: "released",
				file_format: "bigWig",
				output_type: "signal p-value",
				biological_replicates: [1],
				md5sum: "abc123",
				href: "/files/ENCFF002JUR/@@download/ENCFF002JUR.bigWig",
			});
		}
		if (url.origin === "https://www.encodeproject.org" && url.pathname === "/ENCBS000AAA/") {
			return jsonResponse({
				accession: "ENCBS000AAA",
				"@id": "/biosamples/ENCBS000AAA/",
				status: "released",
				biosample_ontology: { term_name: "K562", classification: "cell line" },
				organism: { scientific_name: "Homo sapiens" },
				donor: { accession: "ENCDO000AAE" },
				summary: "Homo sapiens K562 cell line",
			});
		}
		if (url.origin === "https://jaspar.elixir.no" && url.pathname === "/api/v1/matrix/MA0106.1/") {
			return jsonResponse({
				matrix_id: "MA0106.1",
				name: "TP53",
				base_id: "MA0106",
				version: "1",
				collection: "CORE",
				pfm: { A: [1, 2], C: [0, 1], G: [3, 0], T: [0, 1] },
				sequence_logo: "https://jaspar.elixir.no/static/logos/svg/MA0106.1.svg",
			});
		}
		if (url.origin === "https://jaspar.elixir.no" && url.pathname === "/api/v1/matrix/MA0106/versions/") {
			return jsonResponse({
				count: 1,
				results: [{ matrix_id: "MA0106.1", name: "TP53", collection: "CORE", base_id: "MA0106", version: "1" }],
			});
		}
		if (url.origin === "https://jaspar.elixir.no" && url.pathname === "/api/v1/matrix/") {
			assert.equal(url.searchParams.get("tax_id"), "9606");
			return jsonResponse({
				count: 5,
				results: [{ matrix_id: "MA0106.1", name: "TP53", collection: "CORE", base_id: "MA0106", version: "1" }],
			});
		}
		if (url.origin === "https://jaspar.elixir.no" && ["/api/v1/species/", "/api/v1/taxon/", "/api/v1/collections/", "/api/v1/releases/"].includes(url.pathname)) {
			return jsonResponse({
				count: 1,
				results: [{ id: 1, name: url.pathname.includes("species") ? "Homo sapiens" : "CORE", tax_id: 9606, release_number: 2026, active: true }],
			});
		}
		if (url.origin === "https://unibind.uio.no" && url.pathname === "/api/v1/datasets/") {
			assert.equal(url.searchParams.get("tf_name"), "CTCF");
			assert.equal(url.searchParams.get("collection"), "Robust");
			return jsonResponse({
				count: 982,
				results: [{
					tf_name: "CTCF",
					total_peaks: 57900,
					url: "https://unibind.uio.no/api/v1/datasets/ENCSR000AUE.A549_lung_carcinoma.CTCF/",
				}],
			});
		}
		if (url.origin === "https://unibind.uio.no" && url.pathname === "/api/v1/datasets/ENCSR000AUE.A549_lung_carcinoma.CTCF/") {
			return jsonResponse({
				tf_id: "ENCSR000AUE.A549_lung_carcinoma.CTCF",
				tf_name: "CTCF",
				total_peaks: 57900,
				identifier: ["ENCSR000AUE"],
				cell_line: ["A549 lung carcinoma"],
				biological_condition: ["lung carcinoma"],
				jaspar_id: ["MA0139.1"],
				prediction_models: ["DAMO"],
				tfbs: [{
					DAMO: [{
						jaspar_id: "MA0139",
						jaspar_version: "1",
						total_tfbs: 50435,
						bed_url: "https://unibind.uio.no/static/data/bed/CTCF.bed.gz",
						fasta_url: "https://unibind.uio.no/static/data/fasta/CTCF.fa.gz",
					}],
				}],
			});
		}
		if (url.origin === "https://api.genome.ucsc.edu" && url.pathname === "/getData/track") {
			assert.equal(url.searchParams.get("hubUrl"), "https://unibind.uio.no/static/data/latest/UniBind_hubs_Robust/UCSC/hub.txt");
			assert.equal(url.searchParams.get("genome"), "hg38");
			assert.equal(url.searchParams.get("chrom"), "chr17");
			assert.equal(url.searchParams.get("maxItemsOutput"), "20000");
			return jsonResponse({
				track: "UniBind",
				maxItemsLimit: false,
				UniBind: [
					{ chrom: "chr17", chromStart: 7662000, chromEnd: 7662020, name: "ENCSR000EWS_MCF-7_GATA3_MA0037.3", strand: "+" },
					{ chrom: "chr17", chromStart: 7662100, chromEnd: 7662120, name: "EXP038397_NGP--neuroblastoma-_MYCN_MA0104.4", strand: "-" },
				],
			});
		}
		throw new Error(`unexpected URL ${url.toString()}`);
	};

	const tool = registerTools().get("feynman_science_database_search");
	assert.ok(tool);

	const calls = [
		["encode_search_experiments", "encode_search_experiments:assay_title=\"TF ChIP-seq\" target=CTCF organism=\"Homo sapiens\""],
		["encode_search_biosamples", "encode_search_biosamples:term_name=K562 classification=\"cell line\" organism=\"Homo sapiens\""],
		["encode_list_files", "encode_list_files:file_format=bigWig assay_term_name=ChIP-seq output_type=\"signal p-value\" assembly=GRCh38"],
		["encode_get_experiment", "encode_get_experiment:ENCSR000AKP"],
		["encode_get_file", "encode_get_file:ENCFF002JUR"],
		["encode_get_biosample", "encode_get_biosample:ENCBS000AAA"],
		["jaspar_get_matrix", "jaspar_get_matrix:MA0106.1"],
		["jaspar_matrix_versions", "jaspar_matrix_versions:MA0106"],
		["jaspar_list_matrices", "jaspar_list_matrices:search=TP53 tax_id=9606 version=latest"],
		["jaspar_list_species", "jaspar_list_species"],
		["jaspar_list_taxa", "jaspar_list_taxa"],
		["jaspar_list_collections", "jaspar_list_collections"],
		["jaspar_list_releases", "jaspar_list_releases"],
		["unibind_search_tfbs", "unibind_search_tfbs:tf_name=CTCF collection=Robust"],
		["unibind_get_dataset", "unibind_get_dataset:ENCSR000AUE.A549_lung_carcinoma.CTCF"],
		["unibind_tfbs_in_region", "unibind_tfbs_in_region:genome=hg38 chrom=chr17 start=7661779 end=7687546 collection=Robust tf_name=GATA3"],
	] as const;

	for (const [mode, query] of calls) {
		const result = await tool.execute(`call-${mode}`, { source: mode.startsWith("jaspar") ? "jaspar" : mode.startsWith("unibind") ? "unibind" : "encode", query, limit: 2 });
		const details = result.details as { mode: string; results: Array<Record<string, unknown>>; totalCount: number };
		assert.equal(details.mode, mode);
		assert.ok(details.totalCount >= 1);
		assert.ok(details.results.length >= 1);
	}

	const experiment = await tool.execute("call-regulation-exp", { source: "encode", query: "encode_search_experiments:assay_title=\"TF ChIP-seq\" target=CTCF organism=\"Homo sapiens\"", limit: 2 });
	const matrix = await tool.execute("call-regulation-matrix", { source: "jaspar", query: "jaspar_get_matrix:MA0106.1", limit: 1 });
	const dataset = await tool.execute("call-regulation-dataset", { source: "unibind", query: "unibind_get_dataset:ENCSR000AUE.A549_lung_carcinoma.CTCF", limit: 1 });
	const region = await tool.execute("call-regulation-region", { source: "unibind", query: "unibind_tfbs_in_region:genome=hg38 chrom=chr17 start=7661779 end=7687546 collection=Robust tf_name=GATA3", limit: 1 });
	const experimentDetails = experiment.details as { accessions: string[]; truncated: boolean };
	const matrixDetails = matrix.details as { results: Array<{ matrixId: string; pfm: Record<string, number[]> }> };
	const datasetDetails = dataset.details as { results: Array<{ modelCount: number; models: Array<{ bedUrl: string; totalTfbs: number }> }> };
	const regionDetails = region.details as { itemsScanned: number; results: Array<{ jasparMatrix: string; tfName: string }>; totalCount: number };

	assert.deepEqual(experimentDetails.accessions, ["ENCSR000AKP"]);
	assert.equal(experimentDetails.truncated, true);
	assert.equal(matrixDetails.results[0]?.matrixId, "MA0106.1");
	assert.deepEqual(matrixDetails.results[0]?.pfm.A, [1, 2]);
	assert.equal(datasetDetails.results[0]?.modelCount, 1);
	assert.equal(datasetDetails.results[0]?.models[0]?.totalTfbs, 50435);
	assert.match(datasetDetails.results[0]?.models[0]?.bedUrl, /CTCF[.]bed[.]gz/);
	assert.equal(regionDetails.itemsScanned, 2);
	assert.equal(regionDetails.totalCount, 1);
	assert.equal(regionDetails.results[0]?.tfName, "GATA3");
	assert.equal(regionDetails.results[0]?.jasparMatrix, "MA0037.3");
	assert.match(tool.promptGuidelines?.join("\n") ?? "", /encode_search_experiments/);
	assert.equal(requests.length, calls.length + 4);
});
