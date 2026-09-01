import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { registerScienceDatabaseTools } from "../extensions/research-tools/science-databases.js";

type Tool = {
	execute: (toolCallId: string, params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; details: unknown }>;
	name: string;
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

function gwasAssociationPayload(): Record<string, unknown> {
	return {
		page: { totalElements: 2 },
		_embedded: {
			associations: [{
				association_id: 217751971,
				p_value: 4e-15,
				pvalue_mantissa: 4,
				pvalue_exponent: -15,
				or_per_copy_num: 1.24,
				snp_effect_allele: ["rs11591147-G"],
				snp_allele: [{ rs_id: "rs11591147" }],
				locations: ["1:55039974"],
				mapped_genes: ["PCSK9"],
				efo_traits: [{ efo_id: "EFO_0000266", efo_trait: "aortic stenosis", uri: "http://example.org/EFO_0000266" }],
				reported_trait: ["Aortic stenosis"],
				accession_id: "GCST90837551",
				pubmed_id: "41419686",
				first_author: "Small AM",
			}],
		},
	};
}

test("science database tool exposes exact GWAS Catalog human-genetics names", async () => {
	const seen: string[] = [];
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		seen.push(`${url.pathname}?${url.searchParams.toString()}`);
		assert.equal(url.origin, "https://www.ebi.ac.uk");
		if (url.pathname === "/gwas/rest/api/v2/associations") {
			assert.equal(url.searchParams.get("size"), "1");
			assert.equal(url.searchParams.get("sort"), "p_value");
			return jsonResponse(gwasAssociationPayload());
		}
		if (url.pathname === "/gwas/rest/api/v2/efo-traits") {
			assert.equal(url.searchParams.get("trait"), "coronary");
			return jsonResponse({
				page: { totalElements: 1 },
				_embedded: { efo_traits: [{ efo_id: "EFO_0001645", efo_trait: "coronary artery disease", uri: "http://example.org/EFO_0001645" }] },
			});
		}
		if (url.pathname === "/gwas/rest/api/v2/studies") {
			assert.equal(url.searchParams.get("efo_id"), "EFO_0001645");
			return jsonResponse({
				page: { totalElements: 1 },
				_embedded: { studies: [{ accession_id: "GCST90837551", disease_trait: "Coronary artery disease", pubmed_id: "41419686", efo_traits: [] }] },
			});
		}
		if (url.pathname === "/gwas/rest/api/v2/studies/GCST90837551") {
			return jsonResponse({ accession_id: "GCST90837551", disease_trait: "Coronary artery disease", pubmed_id: "41419686", efo_traits: [] });
		}
		if (url.pathname === "/gwas/rest/api/v2/single-nucleotide-polymorphisms/rs7412") {
			return jsonResponse({ rs_id: "rs7412", merged: false, functional_class: "missense_variant", most_severe_consequence: "missense_variant", alleles: "C/T (forward)", mapped_genes: ["APOE"], locations: [{ chromosome: "19", position: 44908822, region: "19q13.32" }], last_update_date: "2026-01-01" });
		}
		throw new Error(`Unexpected URL ${url.toString()}`);
	};

	const tool = registerTools().get("feynman_science_database_search");
	const byVariant = await tool?.execute("gwas-variant", { source: "gwascatalog", query: "gwas_associations_for_variant:rs7412", limit: 1 });
	const byGene = await tool?.execute("gwas-gene", { source: "gwascatalog", query: "gwas_associations_for_gene:PCSK9", limit: 1 });
	const byTrait = await tool?.execute("gwas-trait", { source: "gwascatalog", query: "gwas_associations_for_trait:efo_id=EFO_0001645", limit: 1 });
	const traits = await tool?.execute("gwas-trait-search", { source: "gwascatalog", query: "gwas_search_traits:coronary", limit: 1 });
	const studies = await tool?.execute("gwas-study-search", { source: "gwascatalog", query: "gwas_search_studies:efo_id=EFO_0001645", limit: 1 });
	const study = await tool?.execute("gwas-study", { source: "gwascatalog", query: "gwas_get_study:GCST90837551", limit: 1 });
	const variant = await tool?.execute("gwas-snp", { source: "gwascatalog", query: "gwas_get_variant:rs7412", limit: 1 });

	const associationDetails = byVariant?.details as { associations: Array<{ association_id: number; efo_traits: Array<{ efo_id: string }>; rs_ids: string[] }>; api_total: number; searchMode: string };
	assert.equal(associationDetails.searchMode, "gwas_associations_for_variant");
	assert.equal(associationDetails.api_total, 2);
	assert.equal(associationDetails.associations[0]?.association_id, 217751971);
	assert.deepEqual(associationDetails.associations[0]?.rs_ids, ["rs11591147"]);
	assert.equal(associationDetails.associations[0]?.efo_traits[0]?.efo_id, "EFO_0000266");
	assert.equal((byGene?.details as { gene_symbol: string }).gene_symbol, "PCSK9");
	assert.deepEqual((byTrait?.details as { filters: Record<string, string> }).filters, { efo_id: "EFO_0001645" });
	assert.equal((traits?.details as { efo_traits: Array<{ efo_id: string }> }).efo_traits[0]?.efo_id, "EFO_0001645");
	assert.equal((studies?.details as { studies: Array<{ accession_id: string }> }).studies[0]?.accession_id, "GCST90837551");
	assert.equal((study?.details as { found: boolean; study: { accession_id: string } }).study.accession_id, "GCST90837551");
	assert.equal((variant?.details as { variant: { rs_id: string } }).variant.rs_id, "rs7412");
	assert.ok(seen.some((path) => path.includes("rs_id=rs7412")));
	assert.ok(seen.some((path) => path.includes("mapped_gene=PCSK9")));
});

test("science database tool exposes exact eQTL Catalogue human-genetics names", async () => {
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		assert.equal(url.origin, "https://www.ebi.ac.uk");
		if (url.pathname === "/eqtl/api/v2/datasets") {
			assert.equal(url.searchParams.get("study_label"), "GTEx");
			assert.equal(url.searchParams.get("quant_method"), "ge");
			return jsonResponse([{
				dataset_id: "QTD000075",
				study_id: "QTS000008",
				study_label: "GTEx",
				tissue_id: "UBERON_0000178",
				tissue_label: "blood",
				quant_method: "ge",
				sample_size: 670,
			}]);
		}
		if (url.pathname === "/eqtl/api/v2/datasets/QTD000075/associations") {
			assert.equal(url.searchParams.get("gene_id"), "ENSG00000141510");
			return jsonResponse([{
				molecular_trait_id: "ENSG00000141510",
				gene_id: "ENSG00000141510",
				variant: "chr17_6693178_A_AACAC",
				rsid: "rs1277420555",
				chromosome: "17",
				position: 6693178,
				ref: "A",
				alt: "AACAC",
				beta: -0.0049,
				se: 0.115,
				pvalue: 0.966,
				neg_log10_pvalue: 0.015,
				maf: 0.12,
			}]);
		}
		throw new Error(`Unexpected URL ${url.toString()}`);
	};

	const tool = registerTools().get("feynman_science_database_search");
	const datasets = await tool?.execute("eqtl-datasets", { source: "eqtlcatalogue", query: "eqtl_list_datasets:study_label=GTEx quant_method=ge", limit: 1 });
	const associations = await tool?.execute("eqtl-associations", { source: "eqtlcatalogue", query: "eqtl_associations:dataset_id=QTD000075 gene_id=ENSG00000141510", limit: 1 });

	assert.equal((datasets?.details as { datasets: Array<{ dataset_id: string; study_label: string }> }).datasets[0]?.dataset_id, "QTD000075");
	assert.equal((datasets?.details as { datasets: Array<{ dataset_id: string; study_label: string }> }).datasets[0]?.study_label, "GTEx");
	const row = (associations?.details as { associations: Array<{ gene_id: string; nlog10p: number; rsid: string }>; dataset_id: string }).associations[0];
	assert.equal((associations?.details as { dataset_id: string }).dataset_id, "QTD000075");
	assert.equal(row?.gene_id, "ENSG00000141510");
	assert.equal(row?.rsid, "rs1277420555");
	assert.equal(row?.nlog10p, 0.015);
});

test("science database tool exposes exact PheWeb and FinnGen PheWAS names", async () => {
	const seen: string[] = [];
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		seen.push(url.toString());
		assert.equal(url.origin, "https://r12.finngen.fi");
		if (url.pathname === "/api/variant/19-44908822-C-T") {
			return jsonResponse({
				chrom: "19",
				pos: 44908822,
				ref: "C",
				alt: "T",
				rsids: ["rs7412"],
				nearest_genes: ["APOE"],
				gnomad: { AF: 0.07, ignored: "large" },
				results: [{ phenocode: "T2D", phenostring: "Type 2 diabetes", pval: 1e-9, mlogp: 9, beta: 0.2, maf: 0.05, n_case: 123, n_control: 456 }],
			});
		}
		if (url.pathname === "/api/gene_phenos/APOE") {
			return jsonResponse({
				phenotypes: [{
					assoc: { phenocode: "AD", phenostring: "Alzheimer disease", pval: 1e-12, mlogp: 12, beta: 0.5 },
					variant: { chr: "19", pos: 44908822, ref: "C", alt: "T", varid: "19-44908822-C-T", annotation: { rsids: ["rs7412"] } },
				}],
			});
		}
		if (url.pathname === "/api/phenos") {
			return jsonResponse([{ phenocode: "AD", phenostring: "Alzheimer disease", category: "Neurological", num_cases: 100, num_controls: 1000, num_gw_significant: 2 }]);
		}
		if (url.pathname === "/api/autocomplete") {
			assert.equal(url.searchParams.get("query"), "diabetes");
			return jsonResponse([{ display: "Type 2 diabetes (T2D)", pheno: "T2D", url: "/pheno/T2D" }]);
		}
		throw new Error(`Unexpected URL ${url.toString()}`);
	};

	const tool = registerTools().get("feynman_science_database_search");
	const instances = await tool?.execute("pheweb-instances", { source: "pheweb", query: "phewas_instances", limit: 1 });
	const variant = await tool?.execute("pheweb-variant", { source: "pheweb", query: "phewas_variant:19-44908822-C-T instance=finngen", limit: 1 });
	const gene = await tool?.execute("pheweb-gene", { source: "pheweb", query: "phewas_finngen_gene:APOE", limit: 1 });
	const phenotypes = await tool?.execute("pheweb-phenos", { source: "pheweb", query: "phewas_list_phenotypes:instance=finngen", limit: 1 });
	const search = await tool?.execute("pheweb-search", { source: "pheweb", query: "phewas_search_phenotypes:diabetes instance=finngen", limit: 1 });

	assert.equal((instances?.details as { instances: Record<string, { genome_build: string }> }).instances.finngen.genome_build, "GRCh38");
	const variantDetails = variant?.details as { phenotypes: Array<{ phenocode: string }>; variant_meta: { gnomad: { AF: number }; rsids: string[] } };
	assert.equal(variantDetails.variant_meta.gnomad.AF, 0.07);
	assert.deepEqual(variantDetails.variant_meta.rsids, ["rs7412"]);
	assert.equal(variantDetails.phenotypes[0]?.phenocode, "T2D");
	assert.equal((gene?.details as { phenotypes: Array<{ variant: { varid: string } }> }).phenotypes[0]?.variant.varid, "19-44908822-C-T");
	assert.equal((phenotypes?.details as { phenotypes: Array<{ phenocode: string }> }).phenotypes[0]?.phenocode, "AD");
	assert.equal((search?.details as { matches: Array<{ phenocode: string }>; search_query: string }).search_query, "diabetes");
	assert.equal((search?.details as { matches: Array<{ phenocode: string }> }).matches[0]?.phenocode, "T2D");
	assert.ok(seen.includes("https://r12.finngen.fi/api/autocomplete?query=diabetes"));
});
