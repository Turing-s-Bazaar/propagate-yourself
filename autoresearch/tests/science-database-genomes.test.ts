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

test("science database tool supports Ensembl genome exact reference tool names", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		requests.push(url.toString());
		if (url.hostname === "rest.ensembl.org" && url.pathname === "/lookup/symbol/homo_sapiens/BRAF") {
			return jsonResponse({ id: "ENSG00000157764", display_name: "BRAF", object_type: "Gene", species: "homo_sapiens", seq_region_name: "7", start: 140719327, end: 140924929, strand: -1 });
		}
		if (url.hostname === "rest.ensembl.org" && url.pathname === "/xrefs/id/ENSG00000157764") {
			assert.equal(url.searchParams.get("external_db"), "HGNC");
			return jsonResponse([{ dbname: "HGNC", primary_id: "1097", display_id: "BRAF" }]);
		}
		if (url.hostname === "rest.ensembl.org" && url.pathname === "/vep/homo_sapiens/id/rs7412") {
			return jsonResponse([{
				input: "rs7412",
				assembly_name: "GRCh38",
				seq_region_name: "19",
				start: 44908822,
				end: 44908822,
				strand: 1,
				allele_string: "C/T",
				most_severe_consequence: "missense_variant",
				transcript_consequences: [
					{ gene_id: "ENSG00000130203", gene_symbol: "APOE", transcript_id: "ENST00000252486", impact: "MODERATE", consequence_terms: ["missense_variant"], hgvsp: "p.Arg176Cys" },
					{ gene_id: "ENSG00000130203", gene_symbol: "APOE", transcript_id: "ENST00000425718", impact: "LOW", consequence_terms: ["synonymous_variant"] },
				],
				colocated_variants: [{ id: "rs7412", start: 44908822, end: 44908822, allele_string: "C/T" }],
			}]);
		}
		if (url.hostname === "rest.ensembl.org" && url.pathname === "/homology/id/homo_sapiens/ENSG00000157764") {
			assert.equal(url.searchParams.get("type"), "orthologues");
			return jsonResponse({
				data: [{
					id: "ENSG00000157764",
					homologies: [{
						type: "ortholog_one2one",
						method_link_type: "ENSEMBL_ORTHOLOGUES",
						source: { id: "ENSG00000157764" },
						target: { id: "ENSMUSG00000002413", species: "mus_musculus", protein_id: "ENSMUSP00000002487", perc_id: 94.5, perc_pos: 95.1 },
					}],
				}],
			});
		}
		if (url.hostname === "rest.ensembl.org" && url.pathname === "/sequence/id/ENST00000288602") {
			assert.equal(url.searchParams.get("type"), "genomic");
			return jsonResponse({ id: "ENST00000288602", seq: "ACGTACGT" });
		}
		if (url.hostname === "rest.ensembl.org" && url.pathname === "/overlap/region/homo_sapiens/7%3A140719327-140925199") {
			assert.equal(url.searchParams.get("feature"), "gene");
			return jsonResponse([{ id: "ENSG00000157764", external_name: "BRAF", object_type: "Gene", biotype: "protein_coding", seq_region_name: "7", start: 140719327, end: 140924929, strand: -1 }]);
		}
		throw new Error(`unexpected request ${url.toString()}`);
	};

	const tool = registerTools().get("feynman_science_database_search");
	const lookup = await tool?.execute("call-ensembl-lookup", { source: "ensembl", query: "ensembl_lookup:BRAF species=homo_sapiens expand=false", limit: 2 });
	const xrefs = await tool?.execute("call-ensembl-xrefs", { source: "ensembl", query: "ensembl_xrefs:ENSG00000157764 external_db=HGNC", limit: 2 });
	const vep = await tool?.execute("call-ensembl-vep", { source: "ensembl", query: "ensembl_vep_variant:rs7412 max_consequences=2", limit: 2 });
	const homology = await tool?.execute("call-ensembl-homology", { source: "ensembl", query: "ensembl_homology:ENSG00000157764 homology_type=orthologues", limit: 2 });
	const sequence = await tool?.execute("call-ensembl-sequence", { source: "ensembl", query: "ensembl_sequence:ENST00000288602 seq_type=genomic", limit: 2 });
	const overlap = await tool?.execute("call-ensembl-overlap", { source: "ensembl", query: "ensembl_overlap_region:7:140719327-140925199 feature=gene", limit: 2 });
	const lookupDetails = lookup?.details as { found: boolean; record: { stableId: string }; searchMode: string };
	const xrefDetails = xrefs?.details as { nXrefs: number; results: Array<{ display_id: string }>; searchMode: string };
	const vepDetails = vep?.details as { results: Array<{ genes: string[]; transcriptConsequences: Array<{ impact: string }> }>; searchMode: string };
	const homologyDetails = homology?.details as { nTotal: number; results: Array<{ targetSpecies: string }>; searchMode: string };
	const sequenceDetails = sequence?.details as { found: boolean; length: number; seq: string; sha256: string; searchMode: string };
	const overlapDetails = overlap?.details as { nTotal: number; results: Array<{ externalName: string }>; searchMode: string };

	assert.equal(lookupDetails.searchMode, "ensembl-lookup");
	assert.equal(lookupDetails.found, true);
	assert.equal(lookupDetails.record.stableId, "ENSG00000157764");
	assert.equal(xrefDetails.searchMode, "ensembl-xrefs");
	assert.equal(xrefDetails.nXrefs, 1);
	assert.equal(xrefDetails.results[0]?.display_id, "BRAF");
	assert.equal(vepDetails.searchMode, "ensembl-vep-variant");
	assert.deepEqual(vepDetails.results[0]?.genes, ["APOE"]);
	assert.deepEqual(vepDetails.results[0]?.transcriptConsequences.map((row) => row.impact), ["MODERATE", "LOW"]);
	assert.equal(homologyDetails.searchMode, "ensembl-homology");
	assert.equal(homologyDetails.nTotal, 1);
	assert.equal(homologyDetails.results[0]?.targetSpecies, "mus_musculus");
	assert.equal(sequenceDetails.searchMode, "ensembl-sequence");
	assert.equal(sequenceDetails.found, true);
	assert.equal(sequenceDetails.length, 8);
	assert.equal(sequenceDetails.seq, "ACGTACGT");
	assert.equal(sequenceDetails.sha256, "b28b7e7e6b70661dfee15d5290c4bca097ca145f721c4fbc4de73ad1d1660b8b");
	assert.equal(overlapDetails.searchMode, "ensembl-overlap-region");
	assert.equal(overlapDetails.nTotal, 1);
	assert.equal(overlapDetails.results[0]?.externalName, "BRAF");
	assert.ok(requests.some((url) => url.includes("/vep/homo_sapiens/id/rs7412")));
});

test("science database tool supports UCSC genome exact reference tool names", async () => {
	globalThis.fetch = async (input) => {
		const url = String(input);
		if (url === "https://api.genome.ucsc.edu/list/tracks?genome=hg38&trackLeavesOnly=1") {
			return jsonResponse({
				hg38: {
					knownGene: { shortLabel: "GENCODE", longLabel: "GENCODE known genes", type: "bigGenePred", group: "genes" },
					clinvarMain: { shortLabel: "ClinVar", longLabel: "ClinVar variants", type: "bigBed", group: "phenDis" },
				},
			});
		}
		if (url === "https://api.genome.ucsc.edu/list/chromosomes?genome=hg38") {
			return jsonResponse({ chromCount: 2, chromosomes: { chr17: 83257441, chrM: 16569 } });
		}
		if (url === "https://api.genome.ucsc.edu/getData/track?genome=hg38&track=knownGene&chrom=chr17&start=7661779&end=7687546&maxItemsOutput=2") {
			return jsonResponse({ trackType: "bigGenePred", itemsReturned: 2, knownGene: [{ name: "ENST00000413465.6", chrom: "chr17", geneName: "TP53" }] });
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
		if (url === "https://api.genome.ucsc.edu/getData/track?genome=hg38&track=encRegTfbsClustered&chrom=chr17&start=7676150&end=7676170&maxItemsOutput=2") {
			return jsonResponse({ trackType: "bigBed", itemsReturned: 2, encRegTfbsClustered: [{ name: "CTCF", chrom: "chr17", chromStart: 7676150, chromEnd: 7676170, score: 900, sourceCount: 3 }] });
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tool = registerTools().get("feynman_science_database_search");
	const tracks = await tool?.execute("call-ucsc-list-tracks", { source: "ucsc", query: "ucsc_list_tracks:genome=hg38 filter_text=ClinVar max_tracks=2", limit: 1 });
	const chroms = await tool?.execute("call-ucsc-chrom-sizes", { source: "ucsc", query: "ucsc_chrom_sizes:genome=hg38 filter_text=chr17 max_chroms=2", limit: 1 });
	const trackData = await tool?.execute("call-ucsc-track-data", { source: "ucsc", query: "ucsc_track_data:track=knownGene genome=hg38 chrom=chr17 start=7661779 end=7687546 max_rows=2", limit: 1 });
	const conservation = await tool?.execute("call-ucsc-conservation", { source: "ucsc", query: "ucsc_conservation:genome=hg38 chrom=chr17 start=7676150 end=7676152 track=phyloP100way include_values=true max_values=2", limit: 1 });
	const tfbs = await tool?.execute("call-ucsc-tfbs", { source: "ucsc", query: "ucsc_tfbs_clusters:genome=hg38 chrom=chr17 start=7676150 end=7676170 max_rows=2", limit: 1 });
	const trackDetails = tracks?.details as { searchMode: string; tracks: Array<{ track: string }>; tracksTruncated: boolean };
	const chromDetails = chroms?.details as { searchMode: string; chromosomes: Array<{ name: string }>; chromsTruncated: boolean };
	const rowDetails = trackData?.details as { rows: Array<{ geneName: string }>; searchMode: string; track_type: string; items_returned: number };
	const conservationDetails = conservation?.details as { searchMode: string; values: Array<{ value: number }>; n_bases_covered: number; coverage_fraction: number };
	const tfbsDetails = tfbs?.details as { searchMode: string; clusters: Array<{ name: string }>; n_factors: number };

	assert.equal(trackDetails.searchMode, "ucsc-list-tracks");
	assert.deepEqual(trackDetails.tracks.map((entry) => entry.track), ["clinvarMain"]);
	assert.equal(trackDetails.tracksTruncated, false);
	assert.equal(chromDetails.searchMode, "ucsc-chrom-sizes");
	assert.deepEqual(chromDetails.chromosomes.map((entry) => entry.name), ["chr17"]);
	assert.equal(chromDetails.chromsTruncated, false);
	assert.equal(rowDetails.searchMode, "ucsc-track-data");
	assert.equal(rowDetails.track_type, "bigGenePred");
	assert.equal(rowDetails.items_returned, 2);
	assert.equal(rowDetails.rows[0]?.geneName, "TP53");
	assert.equal(conservationDetails.searchMode, "ucsc-conservation");
	assert.deepEqual(conservationDetails.values.map((entry) => entry.value), [0.5, 1.5]);
	assert.equal(conservationDetails.n_bases_covered, 2);
	assert.equal(conservationDetails.coverage_fraction, 1);
	assert.equal(tfbsDetails.searchMode, "ucsc-tfbs-clusters");
	assert.deepEqual(tfbsDetails.clusters.map((entry) => entry.name), ["CTCF"]);
	assert.equal(tfbsDetails.n_factors, 1);
});
