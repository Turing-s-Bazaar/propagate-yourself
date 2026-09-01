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

test("science database tool searches UCSC tracks, chromosome sizes, track rows, and conservation scores", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = String(input);
		requests.push(url);
		if (url === "https://api.genome.ucsc.edu/list/chromosomes?genome=hg38") {
			return jsonResponse({
				chromCount: 3,
				chromosomes: {
					chr1: 248956422,
					chr17: 83257441,
					chrM: 16569,
				},
			});
		}
		if (url === "https://api.genome.ucsc.edu/search?search=clinvar&genome=hg38&categories=trackDb") {
			return jsonResponse({
				positionMatches: [{
					matches: [{
						position: "clinvarMain:ClinVar Main:ClinVar variants",
						description: "<b>ClinVar</b> <em>variant</em> annotations<br/>with p < 0.05. Threshold <LOD measurement> remains relevant <strong",
						canonical: true,
					}],
				}],
			});
		}
		if (url === "https://api.genome.ucsc.edu/getData/track?genome=hg38&track=knownGene&chrom=chr17&start=7661779&end=7687546&maxItemsOutput=5") {
			return jsonResponse({
				downloadTime: "2026:07:03T12:00:00Z",
				track: "knownGene",
				trackType: "bigGenePred knownGenePep knownGeneMrna",
				itemsReturned: 5,
				maxItemsLimit: true,
				knownGene: [{
					name: "ENST00000413465.6",
					chrom: "chr17",
					txStart: 7661778,
					txEnd: 7687546,
					geneName: "TP53",
				}],
			}, 206);
		}
		if (url === "https://api.genome.ucsc.edu/getData/track?genome=hg38&track=phyloP100way&chrom=chr17&start=7676150&end=7676152&maxItemsOutput=1000") {
			return jsonResponse({
				trackType: "wiggle",
				itemsReturned: 2,
				phyloP100way: [
					{ chrom: "chr17", start: 7676150, end: 7676151, value: 0.5 },
					{ chrom: "chr17", start: 7676151, end: 7676152, value: 1.5 },
				],
			});
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tool = registerTools().get("feynman_science_database_search");
	const chroms = await tool?.execute("call-ucsc-chroms", { source: "ucsc", query: "chroms:hg38 chr17", limit: 1 });
	const search = await tool?.execute("call-ucsc-search", { source: "ucsc", query: "search:clinvar genome=hg38", limit: 1 });
	const track = await tool?.execute("call-ucsc-track", { source: "ucsc", query: "track:knownGene genome=hg38 chrom=chr17 start=7661779 end=7687546 max=5", limit: 1 });
	const conservation = await tool?.execute("call-ucsc-conservation", { source: "ucsc", query: "conservation genome=hg38 chrom=chr17 start=7676150 end=7676152", limit: 2 });
	const chromDetails = chroms?.details as { chromCount: number; results: Array<{ name: string; sizeBp: number }> };
	const searchDetails = search?.details as { results: Array<{ canonical: boolean; description?: string; track: string }> };
	const trackDetails = track?.details as { itemsReturned: number; results: Array<{ geneName: string; name: string }>; trackType: string; truncated: boolean; url: string };
	const conservationDetails = conservation?.details as { basesCovered: number; coverageFraction: number; mean: number; min: number; max: number; results: Array<{ value: number }> };

	assert.equal(chromDetails.chromCount, 3);
	assert.deepEqual(chromDetails.results[0], { name: "chr17", sizeBp: 83257441 });
	assert.equal(searchDetails.results[0]?.track, "clinvarMain");
	assert.equal(searchDetails.results[0]?.canonical, true);
	assert.equal(searchDetails.results[0]?.description, "ClinVar variant annotations with p < 0.05. Threshold <LOD measurement> remains relevant");
	assert.doesNotMatch(searchDetails.results[0]?.description ?? "", /<\/?(?:b|br|em|strong)\b/i);
	assert.equal(trackDetails.trackType, "bigGenePred knownGenePep knownGeneMrna");
	assert.equal(trackDetails.itemsReturned, 5);
	assert.equal(trackDetails.truncated, true);
	assert.equal(trackDetails.results[0]?.name, "ENST00000413465.6");
	assert.equal(trackDetails.results[0]?.geneName, "TP53");
	assert.equal(trackDetails.url, "https://genome.ucsc.edu/cgi-bin/hgTracks?db=hg38&position=chr17%3A7661780-7687546");
	assert.equal(conservationDetails.basesCovered, 2);
	assert.equal(conservationDetails.coverageFraction, 1);
	assert.equal(conservationDetails.mean, 1);
	assert.equal(conservationDetails.min, 0.5);
	assert.equal(conservationDetails.max, 1.5);
	assert.deepEqual(conservationDetails.results.map((record) => record.value), [0.5, 1.5]);
	assert.deepEqual(requests, [
		"https://api.genome.ucsc.edu/list/chromosomes?genome=hg38",
		"https://api.genome.ucsc.edu/search?search=clinvar&genome=hg38&categories=trackDb",
		"https://api.genome.ucsc.edu/getData/track?genome=hg38&track=knownGene&chrom=chr17&start=7661779&end=7687546&maxItemsOutput=5",
		"https://api.genome.ucsc.edu/getData/track?genome=hg38&track=phyloP100way&chrom=chr17&start=7676150&end=7676152&maxItemsOutput=1000",
	]);
	assert.match(tool?.promptGuidelines?.join("\n") ?? "", /UCSC genome db names/);
	assert.match(tool?.promptSnippet ?? "", /UCSC Genome Browser/);
});
