import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, test } from "node:test";
import { gzipSync } from "node:zlib";

import { registerScienceDatabaseTools } from "../extensions/research-tools/science-databases.js";

type Tool = {
	execute: (toolCallId: string, params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; details: unknown }>;
	name: string;
	promptGuidelines?: string[];
};

const originalFetch = globalThis.fetch;
const originalPanglaoChecksum = process.env.FEYNMAN_PANGLAODB_MARKERS_SHA256;
const originalPanglaoPath = process.env.FEYNMAN_PANGLAODB_MARKERS_PATH;

afterEach(() => {
	globalThis.fetch = originalFetch;
	if (originalPanglaoChecksum === undefined) delete process.env.FEYNMAN_PANGLAODB_MARKERS_SHA256;
	else process.env.FEYNMAN_PANGLAODB_MARKERS_SHA256 = originalPanglaoChecksum;
	if (originalPanglaoPath === undefined) delete process.env.FEYNMAN_PANGLAODB_MARKERS_PATH;
	else process.env.FEYNMAN_PANGLAODB_MARKERS_PATH = originalPanglaoPath;
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

test("science database tool supports GTEx exact expression and eQTL tool names", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		requests.push(url.toString());
		if (url.pathname === "/api/v2/metadata/dataset") {
			return jsonResponse({ data: [{ datasetId: "gtex_v8", label: "GTEx v8" }] });
		}
		if (url.pathname === "/api/v2/dataset/tissueSiteDetail") {
			assert.equal(url.searchParams.get("datasetId"), "gtex_v8");
			return jsonResponse({
				paging_info: { totalNumberOfItems: 2 },
				data: [
					{ tissueSiteDetailId: "Breast_Mammary_Tissue", tissueSiteDetail: "Breast - Mammary Tissue" },
					{ tissueSiteDetailId: "Whole_Blood", tissueSiteDetail: "Whole Blood" },
				],
			});
		}
		if (url.pathname === "/api/v2/dataset/sample") {
			assert.equal(url.searchParams.get("tissueSiteDetailId"), "Whole_Blood");
			return jsonResponse({ paging_info: { totalNumberOfItems: 1 }, data: [{ sampleId: "GTEX-1117F-0001", tissueSiteDetailId: "Whole_Blood" }] });
		}
		if (url.pathname === "/api/v2/reference/gene") {
			assert.equal(url.searchParams.get("datasetId"), "gtex_v8");
			return jsonResponse({
				paging_info: { totalNumberOfItems: 1 },
				data: [{ geneSymbol: "BRCA1", geneSymbolUpper: "BRCA1", gencodeId: "ENSG00000012048.26", genomeBuild: "GRCh38" }],
			});
		}
		if (url.pathname === "/api/v2/expression/medianGeneExpression") {
			assert.equal(url.searchParams.get("gencodeId"), "ENSG00000012048.26");
			return jsonResponse({
				paging_info: { totalNumberOfItems: 2 },
				data: [
					{ geneSymbol: "BRCA1", gencodeId: "ENSG00000012048.26", tissueSiteDetailId: "Whole_Blood", tissueSiteDetail: "Whole Blood", median: 3.5 },
					{ geneSymbol: "BRCA1", gencodeId: "ENSG00000012048.26", tissueSiteDetailId: "Breast_Mammary_Tissue", tissueSiteDetail: "Breast - Mammary Tissue", median: 8.25 },
				],
			});
		}
		if (url.pathname === "/api/v2/expression/geneExpression") {
			assert.equal(url.searchParams.get("tissueSiteDetailId"), "Whole_Blood");
			return jsonResponse({ paging_info: { totalNumberOfItems: 1 }, data: [{ sampleId: "S1", gencodeId: "ENSG00000012048.26", expression: 4.2 }] });
		}
		if (url.pathname === "/api/v2/expression/topExpressedGene") {
			assert.equal(url.searchParams.get("filterMtGene"), "true");
			return jsonResponse({ paging_info: { totalNumberOfItems: 1 }, data: [{ geneSymbol: "HBB", gencodeId: "ENSG00000244734.4", median: 5032 }] });
		}
		if (url.pathname === "/api/v2/association/egene") {
			assert.equal(url.searchParams.get("tissueSiteDetailId"), "Whole_Blood");
			return jsonResponse({ paging_info: { totalNumberOfItems: 1 }, data: [{ geneSymbol: "BRCA1", gencodeId: "ENSG00000012048.26", qValue: 0.01 }] });
		}
		if (url.pathname === "/api/v2/association/singleTissueEqtl") {
			assert.equal(url.searchParams.get("variantId"), "chr17_43044295_A_G_b38");
			return jsonResponse({ paging_info: { totalNumberOfItems: 1 }, data: [{ variantId: "chr17_43044295_A_G_b38", pValue: 1e-8 }] });
		}
		if (url.pathname === "/api/v2/association/metasoft") {
			return jsonResponse({ paging_info: { totalNumberOfItems: 1 }, data: [{ gencodeId: "ENSG00000012048.26", mValue: 0.8 }] });
		}
		if (url.pathname === "/api/v2/association/dyneqtl") {
			return jsonResponse({ gencodeId: "ENSG00000012048.26", variantId: "chr17_43044295_A_G_b38", empiricalPValue: 0.002 });
		}
		throw new Error(`unexpected URL ${url.toString()}`);
	};

	const tool = registerTools().get("feynman_science_database_search");
	const queries = [
		["gtex_dataset_info", "dataset-info"],
		["gtex_tissue_sites", "tissue-sites"],
		["gtex_sample_info:tissue_site_detail_id=Whole_Blood", "sample-info"],
		["gtex_resolve_genes:BRCA1", "resolve-genes"],
		["gtex_median_expression:ENSG00000012048.26", "median-expression"],
		["gtex_expression_summary:BRCA1", "expression-summary"],
		["gtex_gene_expression:gencode_id=ENSG00000012048.26 tissue_site_detail_id=Whole_Blood", "gene-expression"],
		["gtex_top_expressed_genes:Whole_Blood n=1 filter_mt_gene=true", "top-expressed-genes"],
		["gtex_eqtl_genes:Whole_Blood", "eqtl-genes"],
		["gtex_single_tissue_eqtls:gencode_id=ENSG00000012048.26 variant_id=chr17_43044295_A_G_b38 tissue_site_detail_id=Whole_Blood", "single-tissue-eqtls"],
		["gtex_multi_tissue_eqtls:gencode_id=ENSG00000012048.26 variant_id=chr17_43044295_A_G_b38", "multi-tissue-eqtls"],
		["gtex_calculate_eqtl:gencode_id=ENSG00000012048.26 variant_id=chr17_43044295_A_G_b38 tissue_site_detail_id=Whole_Blood", "calculate-eqtl"],
	] as const;

	for (const [query, searchMode] of queries) {
		const result = await tool?.execute(`call-${searchMode}`, { source: "gtex", query, limit: 2 });
		const details = result?.details as { results: unknown[]; searchMode: string; source: string };
		assert.equal(details.source, "gtex");
		assert.equal(details.searchMode, searchMode);
		assert.ok(details.results.length >= 1);
	}
	assert.ok(requests.some((url) => url.includes("/expression/medianGeneExpression")));
	assert.ok(requests.some((url) => url.includes("/association/dyneqtl")));
	assert.match(tool?.promptGuidelines?.join("\n") ?? "", /GTEx/);
});

test("science database tool supports PanglaoDB exact expression tool names", async () => {
	const tsv = [
		"species\tofficial gene symbol\tcell type\tnicknames\tubiquitousness index\tproduct description\tgene type\tcanonical marker\tgerm layer\torgan\tsensitivity_human\tsensitivity_mouse\tspecificity_human\tspecificity_mouse",
		"Hs\tCD3D\tT cells\tT3D|CD3-DELTA\t0.01\tCD3 delta chain\tprotein-coding\t1\tmesoderm\tImmune system\t0.94\tNA\t0.10\tNA",
		"Hs\tKRT19\tEpithelial cells\tK19\t0.02\tKeratin 19\tprotein-coding\t1\tendoderm\tEpithelium\t0.88\tNA\t0.08\tNA",
	].join("\n");
	const gz = gzipSync(Buffer.from(tsv));
	process.env.FEYNMAN_PANGLAODB_MARKERS_SHA256 = createHash("sha256").update(gz).digest("hex");
	globalThis.fetch = async (input) => {
		assert.equal(String(input), "https://panglaodb.se/markers/PanglaoDB_markers_27_Mar_2020.tsv.gz");
		return new Response(gz, { status: 200, headers: { "content-type": "application/gzip" } });
	};

	const tool = registerTools().get("feynman_science_database_search");
	const markers = await tool?.execute("call-panglaodb-marker-genes", { source: "panglaodb", query: "panglaodb_marker_genes:T cells species=Hs canonical_only=true", limit: 2 });
	const gene = await tool?.execute("call-panglaodb-cell-types", { source: "panglaodb", query: "panglaodb_cell_types_for_gene:K19 include_synonyms=true", limit: 2 });
	const options = await tool?.execute("call-panglaodb-options", { source: "panglaodb", query: "panglaodb_options", limit: 1 });
	const markerDetails = markers?.details as { mode: string; results: Array<{ canonicalMarker: boolean; cellType: string; geneSymbol: string }> };
	const geneDetails = gene?.details as { mode: string; results: Array<{ cellType: string; geneSymbol: string; matchedVia: string }> };
	const optionsDetails = options?.details as { mode: string; results: Array<{ cellTypes: string[] }> };

	assert.equal(markerDetails.mode, "cell");
	assert.equal(markerDetails.results[0]?.cellType, "T cells");
	assert.equal(markerDetails.results[0]?.geneSymbol, "CD3D");
	assert.equal(markerDetails.results[0]?.canonicalMarker, true);
	assert.equal(geneDetails.mode, "gene");
	assert.equal(geneDetails.results[0]?.cellType, "Epithelial cells");
	assert.equal(geneDetails.results[0]?.matchedVia, "synonym");
	assert.equal(optionsDetails.mode, "options");
	assert.deepEqual(optionsDetails.results[0]?.cellTypes, ["Epithelial cells", "T cells"]);
});
