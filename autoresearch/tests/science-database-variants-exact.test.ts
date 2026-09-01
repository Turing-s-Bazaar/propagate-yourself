import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { registerScienceDatabaseTools } from "../extensions/research-tools/science-databases.js";

type Tool = {
	execute: (toolCallId: string, params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; details: unknown }>;
	name: string;
	promptGuidelines?: string[];
};

const originalFetch = globalThis.fetch;
const originalNcbiEmail = process.env.NCBI_EMAIL;

afterEach(() => {
	globalThis.fetch = originalFetch;
	if (originalNcbiEmail === undefined) delete process.env.NCBI_EMAIL;
	else process.env.NCBI_EMAIL = originalNcbiEmail;
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

const clinvarSummary = {
	result: {
		uids: ["140484"],
		"140484": {
			uid: "140484",
			accession: "VCV000014048",
			accession_version: "VCV000014048.13",
			title: "NM_000041.4(APOE):c.388T>C",
			obj_type: "single nucleotide variant",
			variation_set: [{
				variant_type: "single nucleotide variant",
				canonical_spdi: "NC_000019.10:44908821:C:T",
				variation_xrefs: [{ db_source: "dbSNP", db_id: "7412" }],
				variation_loc: [{ assembly_name: "GRCh38", chr: "19", start: "44908822", stop: "44908822", ref: "C", alt: "T" }],
			}],
			genes: [{ symbol: "APOE", geneid: "348" }],
			germline_classification: {
				description: "Pathogenic",
				review_status: "reviewed by expert panel",
				trait_set: [{ trait_name: "Alzheimer disease" }],
			},
		},
	},
};

const refsnp7412 = {
	refsnp_id: 7412,
	create_date: "2000-01-01",
	last_update_date: "2026-01-01",
	citations: [12345678],
	primary_snapshot_data: {
		variant_type: "snv",
		placements_with_allele: [{
			is_ptlp: true,
			seq_id: "NC_000019.10",
			placement_annot: { seq_id_traits_by_assembly: [{ assembly_name: "GRCh38.p14", is_chromosome: true }] },
			alleles: [
				{ allele: { spdi: { seq_id: "NC_000019.10", position: 44908821, deleted_sequence: "C", inserted_sequence: "C" } } },
				{ allele: { spdi: { seq_id: "NC_000019.10", position: 44908821, deleted_sequence: "C", inserted_sequence: "T" } }, hgvs: "NC_000019.10:g.44908822C>T" },
			],
		}],
		allele_annotations: [{}, { frequency: [{ study_name: "TOPMed", allele_count: 2, total_count: 1000 }] }],
	},
};

function gnomadResponse(body: { query?: string; variables?: Record<string, unknown> }): Response {
	if (body.query?.includes("variant_search")) {
		return jsonResponse({ data: { variant_search: [{ variant_id: "19-44908822-C-T" }] } });
	}
	if (body.query?.includes("structural_variant") && !body.query.includes("structural_variants")) {
		return jsonResponse({ data: { structural_variant: { variant_id: body.variables?.variantId, reference_genome: "GRCh38", chrom: "17", pos: 2481242, end: 21559655, type: "DEL", ac: 35, an: 124536, af: 0.000281, filters: ["UNRESOLVED"], qual: 112, consequences: [{ consequence: "lof", genes: ["TP53"] }], algorithms: ["Depth"], evidence: ["RD"] } } });
	}
	if (body.query?.includes("variant(variantId")) {
		return jsonResponse({ data: { variant: { variant_id: body.variables?.variantId, reference_genome: "GRCh38", chrom: "19", pos: 44908822, ref: "C", alt: "T", rsids: ["rs7412"], exome: { ac: 42, an: 100000, af: 0.00042, filters: [] }, genome: { ac: 12, an: 80000, af: 0.00015, filters: ["PASS"] } } } });
	}
	if (body.query?.includes("gnomad_constraint")) {
		return jsonResponse({ data: { gene: { gene_id: "ENSG00000141510", symbol: "TP53", canonical_transcript_id: "ENST00000269305", chrom: "17", start: 7661779, stop: 7687538, strand: "-", gnomad_constraint: { pli: 1, oe_lof_upper: 0.22 } } } });
	}
	if (body.query?.includes("region(chrom") && body.query.includes("variants(dataset")) {
		return jsonResponse({ data: { region: { variants: [{ variant_id: "19-44908822-C-T", reference_genome: "GRCh38", chrom: "19", pos: 44908822, ref: "C", alt: "T", rsids: ["rs7412"], exome: { ac: 42, an: 100000, af: 0.00042 }, genome: { ac: 12, an: 80000, af: 0.00015 } }] } } });
	}
	if (body.query?.includes("variants(dataset")) {
		return jsonResponse({ data: { gene: { gene_id: "ENSG00000130203", symbol: "APOE", chrom: "19", start: 44905791, stop: 44909393, variants: [{ variant_id: "19-44908822-C-T", reference_genome: "GRCh38", chrom: "19", pos: 44908822, ref: "C", alt: "T", rsids: ["rs7412"], exome: { ac: 42, an: 100000, af: 0.00042 }, genome: { ac: 12, an: 80000, af: 0.00015 } }] } } });
	}
	if (body.query?.includes("liftover(")) {
		return jsonResponse({ data: { liftover: [{ source: { variant_id: body.variables?.source, reference_genome: "GRCh37" }, liftover: { variant_id: "19-44908822-C-T", reference_genome: "GRCh38" }, datasets: ["gnomad_r4"] }] } });
	}
	if (body.query?.includes("clinvar_variants")) {
		return jsonResponse({ data: { meta: { clinvar_release_date: "2026-06-01" }, gene: { gene_id: "ENSG00000130203", symbol: "APOE", clinvar_variants: [{ variant_id: "19-44908822-C-T", clinvar_variation_id: "140484", clinical_significance: "Pathogenic", gold_stars: 3, review_status: "reviewed by expert panel", major_consequence: "missense_variant", pos: 44908822, transcript_id: "ENST00000252486", in_gnomad: true }] } } });
	}
	if (body.query?.includes("structural_variants")) {
		return jsonResponse({ data: { gene: { gene_id: "ENSG00000141510", symbol: "TP53", structural_variants: [{ variant_id: "DEL_chr17_599b1512", reference_genome: "GRCh38", chrom: "17", pos: 2481242, end: 21559655, type: "DEL", ac: 35, an: 124536, af: 0.000281, filters: ["UNRESOLVED"] }] } } });
	}
	if (body.query?.includes("mitochondrial_variants")) {
		return jsonResponse({ data: { gene: { gene_id: "ENSG00000209082", symbol: "MT-TL1", mitochondrial_variants: [{ variant_id: "M-3236-A-G", reference_genome: "GRCh38", pos: 3236, ac_het: 0, ac_hom: 7, an: 56434, max_heteroplasmy: 1, filters: [] }] } } });
	}
	throw new Error(`unexpected gnomAD query ${body.query}`);
}

test("science database tool supports exact variant command names", async () => {
	process.env.NCBI_EMAIL = "variants@example.edu";
	const requests: Array<{ body?: string; url: string }> = [];
	globalThis.fetch = async (input, init) => {
		const url = String(input);
		requests.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
		const parsed = new URL(url);
		if (parsed.hostname === "cadd.gs.washington.edu" && parsed.pathname.endsWith("/api/v1.0/GRCh38-v1.7/19:44908822_C_T")) return jsonResponse([{ Chrom: "19", Pos: 44908822, Ref: "C", Alt: "T", RawScore: "2.100000", PHRED: "24.7" }]);
		if (parsed.hostname === "cadd.gs.washington.edu" && parsed.pathname.endsWith("/api/v1.0/GRCh38-v1.7/19:44908822")) return jsonResponse([{ Chrom: "19", Pos: 44908822, Ref: "C", Alt: "T", RawScore: "2.100000", PHRED: "24.7" }]);
		if (parsed.hostname === "cadd.gs.washington.edu" && parsed.pathname.endsWith("/api/v1.0/GRCh38-v1.7/19:44908822-44908823")) return jsonResponse([["Chrom", "Pos", "Ref", "Alt", "RawScore", "PHRED"], ["19", "44908822", "C", "T", "2.100000", "24.7"]]);
		if (parsed.hostname === "eutils.ncbi.nlm.nih.gov" && parsed.searchParams.get("db") === "clinvar" && parsed.pathname.endsWith("/esearch.fcgi")) return jsonResponse({ esearchresult: { count: "1", idlist: ["140484"] } });
		if (parsed.hostname === "eutils.ncbi.nlm.nih.gov" && parsed.searchParams.get("db") === "clinvar" && parsed.pathname.endsWith("/esummary.fcgi")) return jsonResponse(clinvarSummary);
		if (parsed.hostname === "eutils.ncbi.nlm.nih.gov" && parsed.searchParams.get("db") === "snp") return jsonResponse({ esearchresult: { count: "2", idlist: ["7412", "429358"] } });
		if (parsed.hostname === "api.ncbi.nlm.nih.gov" && parsed.pathname.endsWith("/variation/v0/refsnp/7412")) return jsonResponse(refsnp7412);
		if (parsed.hostname === "gnomad.broadinstitute.org") return gnomadResponse(JSON.parse(String(init?.body ?? "{}")));
		throw new Error(`unexpected URL ${url}`);
	};
	const tool = registerTools().get("feynman_science_database_search");
	assert.ok(tool);
	const call = (source: string, query: string, limit = 5) => tool.execute(`call-${query.split(":")[0]}`, { source, query, limit });
	const results = await Promise.all([
		call("cadd", "cadd_variant_score:chrom=19 pos=44908822 ref=C alt=T"),
		call("cadd", "cadd_position_scores:chrom=19 pos=44908822"),
		call("cadd", "cadd_range_scores:chrom=19 start=44908822 end=44908823"),
		call("clinvar", "clinvar_search:APOE rs7412", 1),
		call("clinvar", "clinvar_get_records:VCV000014048"),
		call("clinvar", "clinvar_variant_by_rsid:rs7412"),
		call("dbsnp", "dbsnp_get_rsids:rs7412"),
		call("dbsnp", "dbsnp_search_by_region:chrom=19 start=44908820 stop=44908830 assembly=GRCh38 max_rsids=2"),
		call("gnomad", "get_variant:variant_id=19-44908822-C-T"),
		call("gnomad", "search_variants:rs7412"),
		call("gnomad", "gene_variants:gene_symbol=APOE", 1),
		call("gnomad", "gene_constraint:gene_symbol=TP53"),
		call("gnomad", "region_variants:chrom=19 start=44908820 stop=44908830"),
		call("gnomad", "liftover_variant:variant_id=19-45411941-C-T source_build=GRCh37"),
		call("gnomad", "clinvar_variants:gene_symbol=APOE", 1),
		call("gnomad", "structural_variants:gene_symbol=TP53", 1),
		call("gnomad", "get_structural_variant:sv_id=DEL_chr17_599b1512"),
		call("gnomad", "mitochondrial_variants:gene_symbol=MT-TL1", 1),
	]);
	assert.equal(results.length, 18);
	for (const result of results) assert.equal(result.details && typeof result.details === "object", true);
	const caddRange = results[2]!.details as { results: Array<{ phred?: string }>; searchMode?: string };
	const clinvar = results[3]!.details as { results: Array<{ variationId?: number }> };
	const dbsnpRegion = results[7]!.details as { rsids?: string[]; searchMode?: string };
	const gnomadGet = results[8]!.details as { dataset?: string; found?: boolean; variant?: { variantId?: string } };
	const gnomadGene = results[10]!.details as { results: Array<{ variantId?: string }>; truncated?: boolean };
	const liftover = results[13]!.details as { results: Array<{ liftover?: { variant_id?: string } }> };
	const structural = results[16]!.details as { structural_variant?: { variantId?: string; variant_id?: string } };
	assert.equal(caddRange.searchMode, "cadd_range_scores");
	assert.equal(caddRange.results[0]?.phred, "24.7");
	assert.equal(clinvar.results[0]?.variationId, 140484);
	assert.deepEqual(dbsnpRegion.rsids, ["rs429358", "rs7412"]);
	assert.equal(gnomadGet.dataset, "gnomad_r4");
	assert.equal(gnomadGet.found, true);
	assert.equal(gnomadGet.variant?.variantId, "19-44908822-C-T");
	assert.equal(gnomadGene.results[0]?.variantId, "19-44908822-C-T");
	assert.equal(gnomadGene.truncated, false);
	assert.equal(liftover.results[0]?.liftover?.variant_id, "19-44908822-C-T");
	assert.equal(structural.structural_variant?.variantId ?? structural.structural_variant?.variant_id, "DEL_chr17_599b1512");
	assert.equal(requests.some((request) => request.url.includes("db=snp") && request.url.includes("CPOS")), true);
	assert.equal(requests.filter((request) => request.url.includes("gnomad.broadinstitute.org/api")).length, 10);
});
