type GnomadSearchParams = { limit?: number; query: string };

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const MAX_STRUCTURAL_CONSEQUENCE_GENES = 80;
const GNOMAD_GRAPHQL_URL = "https://gnomad.broadinstitute.org/api";
const GNOMAD_DEFAULT_DATASET = "gnomad_r4";
const GNOMAD_DEFAULT_SV_DATASET = "gnomad_sv_r4";
const GNOMAD_DOCS = [
	"https://gnomad.broadinstitute.org/help/how-do-i-query-a-batch-of-variants-do-you-have-an-api",
	"https://github.com/broadinstitute/gnomad-browser/blob/main/graphql-api/src/graphql/types/dataset-id.graphql",
	"https://github.com/broadinstitute/gnomad-browser/blob/main/graphql-api/src/graphql/types/variant.graphql",
	"https://github.com/broadinstitute/gnomad-browser/blob/main/graphql-api/src/graphql/types/structural-variant.graphql",
	"https://github.com/broadinstitute/gnomad-browser/blob/main/graphql-api/src/graphql/types/mitochondria.graphql",
];

const GNOMAD_VARIANT_QUERY = `
query Variant($variantId: String!, $dataset: DatasetId!) {
  variant(variantId: $variantId, dataset: $dataset) {
    variant_id reference_genome chrom pos ref alt rsids
    exome { ac an af homozygote_count hemizygote_count filters }
    genome { ac an af homozygote_count hemizygote_count filters }
  }
}
`;

const GNOMAD_VARIANT_SEARCH_QUERY = `
query VariantSearch($query: String!, $dataset: DatasetId!) {
  variant_search(query: $query, dataset: $dataset) { variant_id }
}
`;

const GNOMAD_GENE_VARIANTS_QUERY = `
query GeneVariants($symbol: String, $geneId: String, $dataset: DatasetId!) {
  gene(gene_symbol: $symbol, gene_id: $geneId, reference_genome: GRCh38) {
    gene_id symbol chrom start stop
    variants(dataset: $dataset) {
      variant_id reference_genome chrom pos ref alt rsids
      exome { ac an af homozygote_count hemizygote_count filters }
      genome { ac an af homozygote_count hemizygote_count filters }
    }
  }
}
`;

const GNOMAD_REGION_VARIANTS_QUERY = `
query RegionVariants($chrom: String!, $start: Int!, $stop: Int!, $dataset: DatasetId!) {
  region(chrom: $chrom, start: $start, stop: $stop, reference_genome: GRCh38) {
    variants(dataset: $dataset) {
      variant_id reference_genome chrom pos ref alt rsids
      exome { ac an af homozygote_count hemizygote_count filters }
      genome { ac an af homozygote_count hemizygote_count filters }
    }
  }
}
`;

const GNOMAD_LIFTOVER_QUERY = `
query Liftover($source: String!, $referenceGenome: ReferenceGenomeId!) {
  liftover(source_variant_id: $source, reference_genome: $referenceGenome) {
    source { variant_id reference_genome }
    liftover { variant_id reference_genome }
    datasets
  }
}
`;

const GNOMAD_CLINVAR_VARIANTS_QUERY = `
query ClinvarVariants($symbol: String, $geneId: String) {
  meta { clinvar_release_date }
  gene(gene_symbol: $symbol, gene_id: $geneId, reference_genome: GRCh38) {
    gene_id symbol
    clinvar_variants {
      variant_id clinvar_variation_id clinical_significance gold_stars
      review_status major_consequence pos transcript_id in_gnomad
    }
  }
}
`;

const GNOMAD_STRUCTURAL_VARIANT_QUERY = `
query StructuralVariant($variantId: String!, $dataset: StructuralVariantDatasetId!) {
  structural_variant(variantId: $variantId, dataset: $dataset) {
    variant_id reference_genome chrom pos end chrom2 pos2 type length
    ac an af homozygote_count hemizygote_count filters qual
    major_consequence consequence consequences { consequence genes }
    algorithms evidence
  }
}
`;

const GNOMAD_STRUCTURAL_VARIANTS_GENE_QUERY = `
query StructuralVariantsGene($symbol: String, $geneId: String, $dataset: StructuralVariantDatasetId!) {
  gene(gene_symbol: $symbol, gene_id: $geneId, reference_genome: GRCh38) {
    gene_id symbol
    structural_variants(dataset: $dataset) {
      variant_id reference_genome consequence major_consequence
      ac an af homozygote_count hemizygote_count
      chrom pos end chrom2 pos2 type length filters
    }
  }
}
`;

const GNOMAD_MITOCHONDRIAL_VARIANT_QUERY = `
query MitochondrialVariant($variantId: String!, $dataset: DatasetId!) {
  mitochondrial_variant(variant_id: $variantId, dataset: $dataset) {
    variant_id reference_genome pos ref alt ac_het ac_hom an max_heteroplasmy
    filters flags rsid rsids
  }
}
`;

const GNOMAD_MITOCHONDRIAL_VARIANTS_GENE_QUERY = `
query MitochondrialVariantsGene($symbol: String, $geneId: String, $dataset: DatasetId!) {
  gene(gene_symbol: $symbol, gene_id: $geneId, reference_genome: GRCh38) {
    gene_id symbol
    mitochondrial_variants(dataset: $dataset) {
      variant_id reference_genome pos ac_het ac_hom an max_heteroplasmy
      filters flags rsid rsids consequence gene_id gene_symbol transcript_id hgvsc hgvsp
    }
  }
}
`;

const GNOMAD_MITOCHONDRIAL_VARIANTS_REGION_QUERY = `
query MitochondrialVariantsRegion($start: Int!, $stop: Int!, $dataset: DatasetId!) {
  region(chrom: "M", start: $start, stop: $stop, reference_genome: GRCh38) {
    mitochondrial_variants(dataset: $dataset) {
      variant_id reference_genome pos ac_het ac_hom an max_heteroplasmy
      filters flags rsid rsids consequence gene_id gene_symbol transcript_id hgvsc hgvsp
    }
  }
}
`;

const GNOMAD_GENE_CONSTRAINT_QUERY = `
query GeneConstraint($symbol: String, $geneId: String) {
  gene(gene_symbol: $symbol, gene_id: $geneId, reference_genome: GRCh38) {
    gene_id symbol canonical_transcript_id chrom start stop strand
    gnomad_constraint {
      exp_lof obs_lof oe_lof oe_lof_lower oe_lof_upper
      exp_mis obs_mis oe_mis oe_mis_lower oe_mis_upper
      exp_syn obs_syn oe_syn oe_syn_lower oe_syn_upper
      pli lof_z mis_z syn_z
    }
  }
}
`;

function recordValue(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
	return undefined;
}

function safeLimit(value: number | undefined): number {
	if (!Number.isFinite(value) || value === undefined) return DEFAULT_LIMIT;
	return Math.max(1, Math.min(Math.floor(value), MAX_LIMIT));
}

function cleanQuery(query: string): string {
	const clean = query.trim();
	if (!clean) throw new Error("Science database search requires a non-empty query.");
	return clean;
}

function gnomadBrowserVariantUrl(variantId: string | undefined, dataset = GNOMAD_DEFAULT_DATASET): string | undefined {
	return variantId ? `https://gnomad.broadinstitute.org/variant/${encodeURIComponent(variantId)}?dataset=${encodeURIComponent(dataset)}` : undefined;
}

function normalizeGnomadFrequencyBlock(block: Record<string, unknown>): Record<string, unknown> | undefined {
	if (!Object.keys(block).length) return undefined;
	return {
		ac: numberValue(block.ac),
		an: numberValue(block.an),
		af: numberValue(block.af),
		homozygoteCount: numberValue(block.homozygote_count),
		hemizygoteCount: numberValue(block.hemizygote_count),
		filters: arrayValue(block.filters).map(String).sort(),
	};
}

function normalizeGnomadVariant(record: Record<string, unknown>, dataset = GNOMAD_DEFAULT_DATASET): Record<string, unknown> {
	const variantId = stringValue(record.variant_id);
	return {
		variantId,
		dataset,
		referenceGenome: stringValue(record.reference_genome),
		chrom: stringValue(record.chrom),
		pos: numberValue(record.pos),
		ref: stringValue(record.ref),
		alt: stringValue(record.alt),
		rsids: arrayValue(record.rsids).map(String).sort(),
		exome: normalizeGnomadFrequencyBlock(recordValue(record.exome)),
		genome: normalizeGnomadFrequencyBlock(recordValue(record.genome)),
		url: gnomadBrowserVariantUrl(variantId, dataset),
	};
}

function normalizeGnomadShortVariant(record: Record<string, unknown>, dataset = GNOMAD_DEFAULT_DATASET): Record<string, unknown> {
	const normalized = normalizeGnomadVariant(record, dataset);
	return {
		variantId: normalized.variantId,
		variant_id: normalized.variantId,
		dataset,
		referenceGenome: normalized.referenceGenome,
		chrom: normalized.chrom,
		pos: normalized.pos,
		ref: normalized.ref,
		alt: normalized.alt,
		rsids: normalized.rsids,
		exome: normalized.exome,
		genome: normalized.genome,
		url: normalized.url,
	};
}

function normalizeGnomadClinvarVariant(record: Record<string, unknown>, dataset = GNOMAD_DEFAULT_DATASET): Record<string, unknown> {
	const variantId = stringValue(record.variant_id);
	return {
		variantId,
		variant_id: variantId,
		dataset,
		clinvarVariationId: stringValue(record.clinvar_variation_id) ?? numberValue(record.clinvar_variation_id),
		clinicalSignificance: stringValue(record.clinical_significance),
		goldStars: numberValue(record.gold_stars),
		reviewStatus: stringValue(record.review_status),
		majorConsequence: stringValue(record.major_consequence),
		pos: numberValue(record.pos),
		transcriptId: stringValue(record.transcript_id),
		inGnomad: typeof record.in_gnomad === "boolean" ? record.in_gnomad : undefined,
		url: gnomadBrowserVariantUrl(variantId, dataset),
	};
}

function normalizeGnomadStructuralConsequences(value: unknown): Record<string, unknown>[] | undefined {
	const consequences = arrayValue(value)
		.map((item) => recordValue(item))
		.map((item) => {
			const genes = arrayValue(item.genes).map(String).sort();
			const previewGenes = genes.slice(0, MAX_STRUCTURAL_CONSEQUENCE_GENES);
			return {
				consequence: stringValue(item.consequence),
				genes: previewGenes,
				geneCount: genes.length,
				genesTruncated: genes.length > previewGenes.length,
			};
		})
		.sort((a, b) => String(a.consequence ?? "").localeCompare(String(b.consequence ?? "")));
	return consequences.length ? consequences : undefined;
}

function normalizeGnomadStructuralVariant(record: Record<string, unknown>, dataset = GNOMAD_DEFAULT_SV_DATASET): Record<string, unknown> {
	const variantId = stringValue(record.variant_id);
	return {
		variantId,
		dataset,
		referenceGenome: stringValue(record.reference_genome),
		chrom: stringValue(record.chrom),
		pos: numberValue(record.pos),
		end: numberValue(record.end),
		chrom2: stringValue(record.chrom2),
		pos2: numberValue(record.pos2),
		type: stringValue(record.type),
		length: numberValue(record.length),
		consequence: stringValue(record.consequence),
		majorConsequence: stringValue(record.major_consequence),
		ac: numberValue(record.ac),
		an: numberValue(record.an),
		af: numberValue(record.af),
		homozygoteCount: numberValue(record.homozygote_count),
		hemizygoteCount: numberValue(record.hemizygote_count),
		filters: arrayValue(record.filters).map(String).sort(),
		qual: numberValue(record.qual),
		consequences: normalizeGnomadStructuralConsequences(record.consequences),
		algorithms: arrayValue(record.algorithms).map(String).sort(),
		evidence: arrayValue(record.evidence).map(String).sort(),
		url: gnomadBrowserVariantUrl(variantId, dataset),
	};
}

function normalizeGnomadMitochondrialVariant(record: Record<string, unknown>, dataset = GNOMAD_DEFAULT_DATASET): Record<string, unknown> {
	const variantId = stringValue(record.variant_id);
	return {
		variantId,
		dataset,
		referenceGenome: stringValue(record.reference_genome),
		pos: numberValue(record.pos),
		ref: stringValue(record.ref),
		alt: stringValue(record.alt),
		acHet: numberValue(record.ac_het),
		acHom: numberValue(record.ac_hom),
		an: numberValue(record.an),
		maxHeteroplasmy: numberValue(record.max_heteroplasmy),
		filters: arrayValue(record.filters).map(String).sort(),
		flags: arrayValue(record.flags).map(String).sort(),
		rsid: stringValue(record.rsid),
		rsids: arrayValue(record.rsids).map(String).sort(),
		consequence: stringValue(record.consequence),
		geneId: stringValue(record.gene_id),
		geneSymbol: stringValue(record.gene_symbol),
		transcriptId: stringValue(record.transcript_id),
		hgvsc: stringValue(record.hgvsc),
		hgvsp: stringValue(record.hgvsp),
		url: gnomadBrowserVariantUrl(variantId, dataset),
	};
}

function normalizeGnomadConstraint(record: Record<string, unknown>): Record<string, unknown> {
	const constraint = recordValue(record.gnomad_constraint);
	return {
		geneId: stringValue(record.gene_id),
		symbol: stringValue(record.symbol),
		canonicalTranscriptId: stringValue(record.canonical_transcript_id),
		chrom: stringValue(record.chrom),
		start: numberValue(record.start),
		stop: numberValue(record.stop),
		strand: stringValue(record.strand),
		constraint: {
			expLof: numberValue(constraint.exp_lof),
			obsLof: numberValue(constraint.obs_lof),
			oeLof: numberValue(constraint.oe_lof),
			oeLofLower: numberValue(constraint.oe_lof_lower),
			oeLofUpper: numberValue(constraint.oe_lof_upper),
			expMis: numberValue(constraint.exp_mis),
			obsMis: numberValue(constraint.obs_mis),
			oeMis: numberValue(constraint.oe_mis),
			oeMisLower: numberValue(constraint.oe_mis_lower),
			oeMisUpper: numberValue(constraint.oe_mis_upper),
			expSyn: numberValue(constraint.exp_syn),
			obsSyn: numberValue(constraint.obs_syn),
			oeSyn: numberValue(constraint.oe_syn),
			oeSynLower: numberValue(constraint.oe_syn_lower),
			oeSynUpper: numberValue(constraint.oe_syn_upper),
			pli: numberValue(constraint.pli),
			lofZ: numberValue(constraint.lof_z),
			misZ: numberValue(constraint.mis_z),
			synZ: numberValue(constraint.syn_z),
		},
	};
}

async function fetchGnomadGraphql(query: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 60_000);
	let payload: Record<string, unknown>;
	try {
		const response = await fetch(GNOMAD_GRAPHQL_URL, {
			body: JSON.stringify({ query, variables }),
			headers: {
				accept: "application/json",
				"content-type": "application/json",
			},
			method: "POST",
			signal: controller.signal,
		});
		if (!response.ok) {
			throw new Error(`gnomAD GraphQL request failed: ${response.status} ${response.statusText}`);
		}
		payload = recordValue(await response.json());
	} finally {
		clearTimeout(timeout);
	}
	const errors = arrayValue(payload.errors);
	if (errors.length) {
		const messages = errors.map((error) => stringValue(recordValue(error).message) ?? "unknown GraphQL error");
		throw new Error(`gnomAD GraphQL errors: ${messages.join("; ")}`);
	}
	return recordValue(payload.data);
}

function gnomadGeneVariablesForValue(gene: string, label: string): Record<string, unknown> {
	if (!gene) throw new Error(`${label} requires a gene symbol or Ensembl gene ID.`);
	return /^ENSG\d+/i.test(gene) ? { geneId: gene, symbol: null } : { symbol: gene, geneId: null };
}

function gnomadGeneVariables(query: string): Record<string, unknown> {
	const gene = query.replace(/^(gene|constraint):/i, "").trim();
	return gnomadGeneVariablesForValue(gene, "gnomAD gene constraint search");
}

function prefixedGnomadValue(query: string, prefixes: string[]): string | undefined {
	const lower = query.toLowerCase();
	const prefix = prefixes.find((item) => lower.startsWith(item));
	return prefix ? query.slice(prefix.length).trim() : undefined;
}

function isGnomadVariantId(query: string): boolean {
	return /^(?:chr)?(?:[1-9]|1\d|2[0-2]|X|Y|M|MT)-\d+-[ACGTN]+-[ACGTN]+$/i.test(query.trim());
}

function isGnomadStructuralVariantId(query: string): boolean {
	return /^(?:DEL|DUP|INS|INV|BND|CTX|CPX|MCNV)_chr/i.test(query.trim());
}

function isGnomadMitochondrialVariantId(query: string): boolean {
	return /^(?:chr)?M(?:T)?-\d+-[ACGTN]+-[ACGTN]+$/i.test(query.trim());
}

function parseGnomadMitochondrialRegion(value: string): { start: number; stop: number } | undefined {
	const normalized = value.replace(/,/g, "").trim();
	const match = /^(?:(?:chr)?M(?:T)?[:\s-]*)?(\d+)\s*(?:-|\.\.|:)\s*(\d+)$/i.exec(normalized);
	if (!match) return undefined;
	const start = Number(match[1]);
	const stop = Number(match[2]);
	if (!Number.isInteger(start) || !Number.isInteger(stop) || start < 1 || stop < start) {
		throw new Error("gnomAD mitochondrial region must be a 1-based chrM range such as mito:1-200.");
	}
	return { start, stop };
}

function sortGnomadPositionRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
	return rows.sort((a, b) => {
		const posDiff = (numberValue(a.pos) ?? 0) - (numberValue(b.pos) ?? 0);
		if (posDiff) return posDiff;
		return String(a.variantId ?? "").localeCompare(String(b.variantId ?? ""));
	});
}

function exactOptions(text: string): Record<string, string> {
	const options: Record<string, string> = {};
	for (const match of text.matchAll(/\b([a-z][a-z0-9_-]*)\s*=\s*("[^"]+"|'[^']+'|[^\s;]+)/gi)) {
		const key = match[1]?.toLowerCase();
		const raw = match[2]?.trim();
		if (key && raw) options[key] = raw.replace(/^["']|["']$/g, "");
	}
	return options;
}

function withoutExactOptions(text: string): string {
	return text.replace(/\b[a-z][a-z0-9_-]*\s*=\s*("[^"]+"|'[^']+'|[^\s;]+)/gi, " ").trim();
}

function exactInt(value: string | undefined, name: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
	return parsed;
}

function exactGeneVariables(options: Record<string, string>, body: string, label: string): Record<string, unknown> {
	const geneId = options.gene_id ?? options.geneid;
	const geneSymbol = options.gene_symbol ?? options.symbol ?? (body || undefined);
	if (geneId && geneSymbol) throw new Error(`${label} accepts gene_symbol or gene_id, not both.`);
	if (geneId) return { geneId, symbol: null };
	if (geneSymbol) return { geneId: null, symbol: geneSymbol };
	throw new Error(`${label} requires gene_symbol=<symbol> or gene_id=<Ensembl ID>.`);
}

function exactPayload(query: string, searchMode: string, dataset: string, extra: Record<string, unknown>): Record<string, unknown> {
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "gnomad",
		query,
		dataset,
		searchMode,
		...extra,
		provenance: { docs: GNOMAD_DOCS, endpoints: [GNOMAD_GRAPHQL_URL] },
	};
}

export async function searchGnomadExact(query: string, limit?: number): Promise<Record<string, unknown> | undefined> {
	const match = /^(get_variant|search_variants|gene_variants|gene_constraint|region_variants|liftover_variant|clinvar_variants|structural_variants|get_structural_variant|mitochondrial_variants)\s*:?\s*(.*)$/i.exec(query.trim());
	if (!match) return undefined;
	const searchMode = match[1]!.toLowerCase();
	const body = match[2]?.trim() ?? "";
	const options = exactOptions(body);
	const bare = withoutExactOptions(body);
	const rowLimit = safeLimit(limit);
	const dataset = options.dataset ?? GNOMAD_DEFAULT_DATASET;
	if (searchMode === "get_variant") {
		const variantId = options.variant_id ?? options.variantid ?? bare;
		if (!variantId) throw new Error("get_variant requires variant_id=<chrom-pos-ref-alt>.");
		const data = await fetchGnomadGraphql(GNOMAD_VARIANT_QUERY, { variantId, dataset });
		const variant = recordValue(data.variant);
		const normalized = Object.keys(variant).length ? normalizeGnomadVariant(variant, dataset) : null;
		return exactPayload(query, searchMode, dataset, { found: Boolean(normalized), variant_id: variantId, variantId, variant: normalized, results: normalized ? [normalized] : [] });
	}
	if (searchMode === "search_variants") {
		const search = options.query ?? bare;
		if (!search) throw new Error("search_variants requires a query.");
		const data = await fetchGnomadGraphql(GNOMAD_VARIANT_SEARCH_QUERY, { query: search, dataset });
		const ids = arrayValue(data.variant_search).map((item) => stringValue(recordValue(item).variant_id)).filter((id): id is string => Boolean(id)).sort().slice(0, rowLimit);
		return exactPayload(query, searchMode, dataset, { searchQuery: search, n_matches: ids.length, variant_ids: ids, totalCount: ids.length, returned: ids.length, results: ids.map((variantId) => ({ variantId, variant_id: variantId, url: gnomadBrowserVariantUrl(variantId, dataset) })) });
	}
	if (searchMode === "gene_variants") {
		const data = await fetchGnomadGraphql(GNOMAD_GENE_VARIANTS_QUERY, { ...exactGeneVariables(options, bare, searchMode), dataset });
		const gene = recordValue(data.gene);
		const allResults = sortGnomadPositionRows(arrayValue(gene.variants).map((item) => normalizeGnomadShortVariant(recordValue(item), dataset)));
		const results = allResults.slice(0, rowLimit);
		return exactPayload(query, searchMode, dataset, { gene: { geneId: stringValue(gene.gene_id), symbol: stringValue(gene.symbol), chrom: stringValue(gene.chrom), start: numberValue(gene.start), stop: numberValue(gene.stop) }, totalCount: allResults.length, returned: results.length, truncated: allResults.length > results.length, results });
	}
	if (searchMode === "gene_constraint") {
		const data = await fetchGnomadGraphql(GNOMAD_GENE_CONSTRAINT_QUERY, exactGeneVariables(options, bare, searchMode));
		const gene = recordValue(data.gene);
		const results = Object.keys(gene).length ? [normalizeGnomadConstraint(gene)] : [];
		return exactPayload(query, searchMode, dataset, { totalCount: results.length, returned: results.length, results });
	}
	if (searchMode === "region_variants") {
		const chrom = (options.chrom ?? options.chr ?? bare.split(/\s+/)[0] ?? "").replace(/^chr/i, "");
		const start = exactInt(options.start, "region_variants start");
		const stop = exactInt(options.stop ?? options.end, "region_variants stop");
		if (stop < start) throw new Error("region_variants stop must be >= start.");
		if (stop - start > 1_000_000) throw new Error("region_variants spans more than 1,000,000 bp; split the query.");
		const data = await fetchGnomadGraphql(GNOMAD_REGION_VARIANTS_QUERY, { chrom, start, stop, dataset });
		const region = recordValue(data.region);
		const allResults = sortGnomadPositionRows(arrayValue(region.variants).map((item) => normalizeGnomadShortVariant(recordValue(item), dataset)));
		const results = allResults.slice(0, rowLimit);
		return exactPayload(query, searchMode, dataset, { region: { chrom, start, stop }, totalCount: allResults.length, returned: results.length, truncated: allResults.length > results.length, results });
	}
	if (searchMode === "liftover_variant") {
		const variantId = options.variant_id ?? options.variantid ?? bare;
		const sourceBuild = options.source_build ?? options.sourcebuild ?? "GRCh37";
		if (!variantId) throw new Error("liftover_variant requires variant_id=<chrom-pos-ref-alt>.");
		if (!/^(GRCh37|GRCh38)$/i.test(sourceBuild)) throw new Error("liftover_variant source_build must be GRCh37 or GRCh38.");
		const data = await fetchGnomadGraphql(GNOMAD_LIFTOVER_QUERY, { source: variantId, referenceGenome: sourceBuild });
		const results = arrayValue(data.liftover).map((row) => {
			const item = recordValue(row);
			return { source: recordValue(item.source), liftover: recordValue(item.liftover), datasets: arrayValue(item.datasets).map(String).sort() };
		});
		return exactPayload(query, searchMode, dataset, { source_variant_id: variantId, sourceBuild, source_build: sourceBuild, totalCount: results.length, returned: results.length, results });
	}
	if (searchMode === "clinvar_variants") {
		const data = await fetchGnomadGraphql(GNOMAD_CLINVAR_VARIANTS_QUERY, exactGeneVariables(options, bare, searchMode));
		const gene = recordValue(data.gene);
		const allResults = sortGnomadPositionRows(arrayValue(gene.clinvar_variants).map((item) => normalizeGnomadClinvarVariant(recordValue(item), dataset)));
		const results = allResults.slice(0, rowLimit);
		return exactPayload(query, searchMode, dataset, { gene: { geneId: stringValue(gene.gene_id), symbol: stringValue(gene.symbol) }, clinvarReleaseDate: stringValue(recordValue(data.meta).clinvar_release_date), totalCount: allResults.length, returned: results.length, truncated: allResults.length > results.length, results });
	}
	if (searchMode === "structural_variants") {
		const svDataset = options.dataset ?? GNOMAD_DEFAULT_SV_DATASET;
		const data = await fetchGnomadGraphql(GNOMAD_STRUCTURAL_VARIANTS_GENE_QUERY, { ...exactGeneVariables(options, bare, searchMode), dataset: svDataset });
		const gene = recordValue(data.gene);
		const allResults = sortGnomadPositionRows(arrayValue(gene.structural_variants).map((item) => normalizeGnomadStructuralVariant(recordValue(item), svDataset)));
		const results = allResults.slice(0, rowLimit);
		return exactPayload(query, searchMode, svDataset, { gene: { geneId: stringValue(gene.gene_id), symbol: stringValue(gene.symbol) }, totalCount: allResults.length, returned: results.length, truncated: allResults.length > results.length, results });
	}
	if (searchMode === "get_structural_variant") {
		const svDataset = options.dataset ?? GNOMAD_DEFAULT_SV_DATASET;
		const svId = options.sv_id ?? options.svid ?? options.variant_id ?? bare;
		if (!svId) throw new Error("get_structural_variant requires sv_id=<gnomAD structural variant ID>.");
		const data = await fetchGnomadGraphql(GNOMAD_STRUCTURAL_VARIANT_QUERY, { variantId: svId, dataset: svDataset });
		const variant = recordValue(data.structural_variant);
		const normalized = Object.keys(variant).length ? normalizeGnomadStructuralVariant(variant, svDataset) : null;
		return exactPayload(query, searchMode, svDataset, { found: Boolean(normalized), sv_id: svId, structural_variant: normalized, totalCount: normalized ? 1 : 0, returned: normalized ? 1 : 0, results: normalized ? [normalized] : [] });
	}
	if (searchMode === "mitochondrial_variants") {
		const start = options.region_start ?? options.start;
		const stop = options.region_stop ?? options.stop ?? options.end;
		const region = start !== undefined || stop !== undefined ? { start: exactInt(start, "mitochondrial_variants region_start"), stop: exactInt(stop, "mitochondrial_variants region_stop") } : parseGnomadMitochondrialRegion(bare);
		const data = region
			? await fetchGnomadGraphql(GNOMAD_MITOCHONDRIAL_VARIANTS_REGION_QUERY, { ...region, dataset })
			: await fetchGnomadGraphql(GNOMAD_MITOCHONDRIAL_VARIANTS_GENE_QUERY, { ...exactGeneVariables(options, bare, searchMode), dataset });
		const container = recordValue(region ? data.region : data.gene);
		const allResults = sortGnomadPositionRows(arrayValue(container.mitochondrial_variants).map((item) => normalizeGnomadMitochondrialVariant(recordValue(item), dataset)));
		const results = allResults.slice(0, rowLimit);
		return exactPayload(query, searchMode, dataset, { ...(region ? { region: { chrom: "M", ...region } } : { gene: { geneId: stringValue(container.gene_id), symbol: stringValue(container.symbol) } }), totalCount: allResults.length, returned: results.length, truncated: allResults.length > results.length, results });
	}
	return undefined;
}

export async function searchGnomad(params: GnomadSearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const dataset = GNOMAD_DEFAULT_DATASET;
	const endpoints = [GNOMAD_GRAPHQL_URL];
	const structuralDataset = GNOMAD_DEFAULT_SV_DATASET;
	if (/^(gene|constraint):/i.test(query)) {
		const data = await fetchGnomadGraphql(GNOMAD_GENE_CONSTRAINT_QUERY, gnomadGeneVariables(query));
		const gene = recordValue(data.gene);
		const results = Object.keys(gene).length ? [normalizeGnomadConstraint(gene)] : [];
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "gnomad",
			query,
			dataset,
			searchMode: "gene-constraint",
			totalCount: results.length,
			returned: results.length,
			results,
			provenance: {
				docs: GNOMAD_DOCS,
				endpoints,
			},
		};
	}
	const structuralVariantId = prefixedGnomadValue(query, ["sv-id:", "structural-id:"]);
	if (structuralVariantId !== undefined || isGnomadStructuralVariantId(query)) {
		const variantId = structuralVariantId !== undefined ? structuralVariantId : query;
		if (!variantId.trim()) throw new Error("gnomAD structural variant lookup requires an SV ID.");
		const data = await fetchGnomadGraphql(GNOMAD_STRUCTURAL_VARIANT_QUERY, { variantId: variantId.trim(), dataset: structuralDataset });
		const variant = recordValue(data.structural_variant);
		const results = Object.keys(variant).length ? [normalizeGnomadStructuralVariant(variant, structuralDataset)] : [];
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "gnomad",
			query,
			dataset: structuralDataset,
			searchMode: "structural-variant",
			totalCount: results.length,
			returned: results.length,
			results,
			provenance: {
				docs: GNOMAD_DOCS,
				endpoints,
			},
		};
	}
	const structuralGene = prefixedGnomadValue(query, ["sv:", "structural:"]);
	if (structuralGene !== undefined) {
		const data = await fetchGnomadGraphql(GNOMAD_STRUCTURAL_VARIANTS_GENE_QUERY, {
			...gnomadGeneVariablesForValue(structuralGene, "gnomAD structural variant gene lookup"),
			dataset: structuralDataset,
		});
		const gene = recordValue(data.gene);
		const allResults = sortGnomadPositionRows(arrayValue(gene.structural_variants).map((item) => normalizeGnomadStructuralVariant(recordValue(item), structuralDataset)));
		const results = allResults.slice(0, limit);
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "gnomad",
			query,
			dataset: structuralDataset,
			searchMode: "structural-variants-gene",
			gene: {
				geneId: stringValue(gene.gene_id),
				symbol: stringValue(gene.symbol),
			},
			totalCount: allResults.length,
			returned: results.length,
			truncated: allResults.length > results.length,
			results,
			provenance: {
				docs: GNOMAD_DOCS,
				endpoints,
			},
		};
	}
	const mitochondrialVariantId = prefixedGnomadValue(query, ["mito-id:", "mt-id:", "mitochondrial-id:"]);
	if (mitochondrialVariantId !== undefined || isGnomadMitochondrialVariantId(query)) {
		const variantId = mitochondrialVariantId !== undefined ? mitochondrialVariantId : query.replace(/^chr/i, "");
		if (!variantId.trim()) throw new Error("gnomAD mitochondrial variant lookup requires a mitochondrial variant ID.");
		const data = await fetchGnomadGraphql(GNOMAD_MITOCHONDRIAL_VARIANT_QUERY, { variantId: variantId.trim(), dataset });
		const variant = recordValue(data.mitochondrial_variant);
		const results = Object.keys(variant).length ? [normalizeGnomadMitochondrialVariant(variant, dataset)] : [];
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "gnomad",
			query,
			dataset,
			searchMode: "mitochondrial-variant",
			totalCount: results.length,
			returned: results.length,
			results,
			provenance: {
				docs: GNOMAD_DOCS,
				endpoints,
			},
		};
	}
	const mitochondrialQuery = prefixedGnomadValue(query, ["mito:", "mt:", "mitochondrial:"]);
	if (mitochondrialQuery !== undefined) {
		const region = parseGnomadMitochondrialRegion(mitochondrialQuery);
		const data = region
			? await fetchGnomadGraphql(GNOMAD_MITOCHONDRIAL_VARIANTS_REGION_QUERY, { ...region, dataset })
			: await fetchGnomadGraphql(GNOMAD_MITOCHONDRIAL_VARIANTS_GENE_QUERY, {
				...gnomadGeneVariablesForValue(mitochondrialQuery, "gnomAD mitochondrial variant gene lookup"),
				dataset,
			});
		const container = recordValue(region ? data.region : data.gene);
		const allResults = sortGnomadPositionRows(arrayValue(container.mitochondrial_variants).map((item) => normalizeGnomadMitochondrialVariant(recordValue(item), dataset)));
		const results = allResults.slice(0, limit);
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "gnomad",
			query,
			dataset,
			searchMode: region ? "mitochondrial-variants-region" : "mitochondrial-variants-gene",
			...(region ? { region: { chrom: "M", ...region } } : {
				gene: {
					geneId: stringValue(container.gene_id),
					symbol: stringValue(container.symbol),
				},
			}),
			totalCount: allResults.length,
			returned: results.length,
			truncated: allResults.length > results.length,
			results,
			provenance: {
				docs: GNOMAD_DOCS,
				endpoints,
			},
		};
	}
	if (isGnomadVariantId(query)) {
		const variantId = query.replace(/^chr/i, "");
		const data = await fetchGnomadGraphql(GNOMAD_VARIANT_QUERY, { variantId, dataset });
		const variant = recordValue(data.variant);
		const results = Object.keys(variant).length ? [normalizeGnomadVariant(variant, dataset)] : [];
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "gnomad",
			query,
			dataset,
			searchMode: "variant",
			totalCount: results.length,
			returned: results.length,
			results,
			provenance: {
				docs: GNOMAD_DOCS,
				endpoints,
			},
		};
	}
	const data = await fetchGnomadGraphql(GNOMAD_VARIANT_SEARCH_QUERY, { query, dataset });
	const results = arrayValue(data.variant_search)
		.map((item) => recordValue(item))
		.map((item) => {
			const variantId = stringValue(item.variant_id);
			return {
				variantId,
				dataset,
				url: gnomadBrowserVariantUrl(variantId, dataset),
			};
		})
		.filter((item) => item.variantId)
		.sort((a, b) => String(a.variantId).localeCompare(String(b.variantId)))
		.slice(0, limit);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "gnomad",
		query,
		dataset,
		searchMode: "variant-search",
		totalCount: results.length,
		returned: results.length,
		results,
		provenance: {
			docs: GNOMAD_DOCS,
			endpoints,
		},
	};
}
