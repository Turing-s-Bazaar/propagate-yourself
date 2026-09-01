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

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

test("science database tool searches UniBind datasets, details, and hub-backed region rows", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = String(input);
		requests.push(url);
		if (url === "https://unibind.uio.no/api/v1/datasets/?page_size=2&tf_name=CTCF&collection=Robust") {
			return jsonResponse({
				count: 982,
				results: [{
					tf_name: "CTCF",
					total_peaks: 57900,
					url: "https://unibind.uio.no/api/v1/datasets/ENCSR000AUE.A549_lung_carcinoma.CTCF/",
				}],
			});
		}
		if (url === "https://unibind.uio.no/api/v1/datasets/ENCSR000AUE.A549_lung_carcinoma.CTCF/") {
			return jsonResponse({
				tf_id: "ENCSR000AUE.A549_lung_carcinoma.CTCF",
				tf_name: "CTCF",
				total_peaks: 57900,
				identifiers: ["ENCSR000AUE", "EXP011091"],
				biological_condition: {
					cell_lines: ["A549 lung carcinoma"],
					biological_conditions: ["lung carcinoma"],
				},
				jaspar_ids: ["MA0139.1"],
				prediction_models: ["DAMO"],
				tfbs: [{
					prediction_model: "DAMO",
					jaspar_id: "MA0139",
					jaspar_version: "1",
					tfbs: [{
						total_tfbs: 50435,
						score_threshold: 8.74,
						distance_threshold: 31,
						adj_centrimo_pvalue: 0.001,
						bed: "https://unibind.uio.no/static/data/bed/CTCF.bed.gz",
						fasta: "https://unibind.uio.no/static/data/fasta/CTCF.fa.gz",
						summary_plot: "https://unibind.uio.no/static/data/plots/CTCF.png",
					}],
				}],
			});
		}
		const parsed = new URL(url);
		if (parsed.origin + parsed.pathname === "https://api.genome.ucsc.edu/getData/track") {
			assert.equal(parsed.searchParams.get("hubUrl"), "https://unibind.uio.no/static/data/latest/UniBind_hubs_Robust/UCSC/hub.txt");
			assert.equal(parsed.searchParams.get("genome"), "hg38");
			assert.equal(parsed.searchParams.get("track"), "UniBind");
			assert.equal(parsed.searchParams.get("chrom"), "chr17");
			assert.equal(parsed.searchParams.get("start"), "7661779");
			assert.equal(parsed.searchParams.get("end"), "7687546");
			assert.equal(parsed.searchParams.get("maxItemsOutput"), "20000");
			return jsonResponse({
				track: "UniBind",
				maxItemsLimit: true,
				UniBind: [
					{ chrom: "chr17", chromStart: 7662000, chromEnd: 7662020, name: "ENCSR000EWS_MCF-7_GATA3_MA0037.3", score: 982, strand: "+", color: "0,0,0" },
					{ chrom: "chr17", chromStart: 7662100, chromEnd: 7662120, name: "EXP038397_NGP--neuroblastoma-_MYCN_MA0104.4", score: 800, strand: "-", color: "0,0,0" },
				],
			}, 206);
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tool = registerTools().get("feynman_science_database_search");
	const datasets = await tool?.execute("call-unibind-datasets", { source: "unibind", query: "datasets:CTCF tf=CTCF collection=Robust", limit: 2 });
	const detail = await tool?.execute("call-unibind-detail", { source: "unibind", query: "dataset:ENCSR000AUE.A549_lung_carcinoma.CTCF", limit: 1 });
	const region = await tool?.execute("call-unibind-region", { source: "unibind", query: "region genome=hg38 chrom=chr17 start=7661779 end=7687546 collection=Robust tf=GATA3", limit: 1 });
	const datasetDetails = datasets?.details as { totalCount: number; results: Array<{ cellLineSlug: string; identifier: string; tfId: string; tfName: string; totalPeaks: number }> };
	const detailDetails = detail?.details as { results: Array<{ identifiers: string[]; modelCount: number; models: Array<{ bedUrl: string; jasparId: string; totalTfbs: number }> }> };
	const regionDetails = region?.details as { collection: string; itemsScanned: number; results: Array<{ cellLineSlug: string; jasparMatrix: string; tfName: string }>; totalCount: number; truncated: boolean; url: string };

	assert.equal(datasetDetails.totalCount, 982);
	assert.equal(datasetDetails.results[0]?.tfId, "ENCSR000AUE.A549_lung_carcinoma.CTCF");
	assert.equal(datasetDetails.results[0]?.identifier, "ENCSR000AUE");
	assert.equal(datasetDetails.results[0]?.cellLineSlug, "A549_lung_carcinoma");
	assert.equal(datasetDetails.results[0]?.tfName, "CTCF");
	assert.equal(datasetDetails.results[0]?.totalPeaks, 57900);
	assert.deepEqual(detailDetails.results[0]?.identifiers, ["ENCSR000AUE", "EXP011091"]);
	assert.equal(detailDetails.results[0]?.modelCount, 1);
	assert.equal(detailDetails.results[0]?.models[0]?.jasparId, "MA0139");
	assert.equal(detailDetails.results[0]?.models[0]?.totalTfbs, 50435);
	assert.equal(detailDetails.results[0]?.models[0]?.bedUrl, "https://unibind.uio.no/static/data/bed/CTCF.bed.gz");
	assert.equal(regionDetails.collection, "Robust");
	assert.equal(regionDetails.itemsScanned, 2);
	assert.equal(regionDetails.totalCount, 1);
	assert.equal(regionDetails.truncated, true);
	assert.equal(regionDetails.results[0]?.cellLineSlug, "MCF-7");
	assert.equal(regionDetails.results[0]?.tfName, "GATA3");
	assert.equal(regionDetails.results[0]?.jasparMatrix, "MA0037.3");
	assert.match(regionDetails.url, /UniBind_hubs_Robust/);
	assert.deepEqual(requests, [
		"https://unibind.uio.no/api/v1/datasets/?page_size=2&tf_name=CTCF&collection=Robust",
		"https://unibind.uio.no/api/v1/datasets/ENCSR000AUE.A549_lung_carcinoma.CTCF/",
		"https://api.genome.ucsc.edu/getData/track?hubUrl=https%3A%2F%2Funibind.uio.no%2Fstatic%2Fdata%2Flatest%2FUniBind_hubs_Robust%2FUCSC%2Fhub.txt&genome=hg38&track=UniBind&chrom=chr17&start=7661779&end=7687546&maxItemsOutput=20000",
	]);
	assert.match(tool?.promptGuidelines?.join("\n") ?? "", /UniBind TF ids/);
	assert.match(tool?.promptSnippet ?? "", /UniBind/);
});
