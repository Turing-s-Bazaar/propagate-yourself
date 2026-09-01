type SearchParams = { limit?: number; query: string };

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 25_000;
const GTEX_BASE = "https://gtexportal.org/api/v2";

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

async function fetchJson(url: URL, init?: RequestInit): Promise<unknown> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			...init,
			headers: {
				accept: "application/json",
				...(init?.headers ?? {}),
			},
			signal: controller.signal,
		});
		if (!response.ok) {
			throw new Error(`Science database request failed: ${response.status} ${response.statusText}`);
		}
		return response.json();
	} finally {
		clearTimeout(timeout);
	}
}

function normalizeGtexGene(record: Record<string, unknown>): Record<string, unknown> {
	return {
		geneSymbol: stringValue(record.geneSymbol),
		geneSymbolUpper: stringValue(record.geneSymbolUpper),
		gencodeId: stringValue(record.gencodeId),
		gencodeVersion: stringValue(record.gencodeVersion),
		genomeBuild: stringValue(record.genomeBuild),
		chromosome: stringValue(record.chromosome),
		strand: stringValue(record.strand),
	};
}

function normalizeGtexMedianExpression(record: Record<string, unknown>, gene: Record<string, unknown>): Record<string, unknown> {
	const median = numberValue(record.median);
	const tissueSiteDetailId = stringValue(record.tissueSiteDetailId);
	return {
		geneSymbol: stringValue(record.geneSymbol) ?? stringValue(gene.geneSymbol),
		gencodeId: stringValue(record.gencodeId) ?? stringValue(gene.gencodeId),
		tissueSiteDetailId,
		tissueSiteDetail: stringValue(record.tissueSiteDetail),
		medianTpm: median,
		unit: median === undefined ? undefined : "TPM",
		url: tissueSiteDetailId ? `https://gtexportal.org/home/gene/${encodeURIComponent(stringValue(gene.geneSymbol) ?? stringValue(gene.gencodeId) ?? "")}` : undefined,
	};
}

function parseNamedValue(query: string, name: string): string | undefined {
	const lower = query.toLowerCase();
	if (lower === name) return "";
	const prefix = `${name}:`;
	return lower.startsWith(prefix) ? query.slice(prefix.length).trim() : undefined;
}

function parseKeyValues(value: string): { rest: string; values: Record<string, string> } {
	const values: Record<string, string> = {};
	const rest: string[] = [];
	for (const token of value.split(/\s+/).filter(Boolean)) {
		const match = token.match(/^([A-Za-z][A-Za-z0-9_-]*)=(.+)$/);
		if (!match) {
			rest.push(token);
			continue;
		}
		values[match[1]!.toLowerCase().replace(/-/g, "_")] = match[2]!;
	}
	return { rest: rest.join(" ").trim(), values };
}

function csvValues(value: string | undefined): string[] | undefined {
	const values = value?.split(",").map((item) => item.trim()).filter(Boolean);
	return values?.length ? values : undefined;
}

function gtexDatasetId(values: Record<string, string>): string {
	return values.dataset_id ?? values.dataset ?? "gtex_v8";
}

function setRepeatedParams(url: URL, key: string, values: string[] | undefined): void {
	for (const value of values ?? []) url.searchParams.append(key, value);
}

async function fetchGtexPaged(path: string, values: Record<string, string>, limit: number, params: Record<string, string | string[] | undefined> = {}, pageSize = limit): Promise<{ endpoints: string[]; payload: Record<string, unknown>; results: unknown[]; totalCount: number }> {
	const url = new URL(`${GTEX_BASE}${path}`);
	url.searchParams.set("datasetId", gtexDatasetId(values));
	url.searchParams.set("itemsPerPage", String(Math.max(1, pageSize)));
	url.searchParams.set("page", "0");
	for (const [key, value] of Object.entries(params)) {
		if (Array.isArray(value)) setRepeatedParams(url, key, value);
		else if (value !== undefined) url.searchParams.set(key, value);
	}
	const payload = recordValue(await fetchJson(url));
	const results = arrayValue(payload.data);
	return {
		endpoints: [url.toString()],
		payload,
		results,
		totalCount: numberValue(recordValue(payload.paging_info).totalNumberOfItems) ?? results.length,
	};
}

function gtexEnvelope(query: string, searchMode: string, datasetId: string, totalCount: number, results: Record<string, unknown>[], endpoints: string[], extra: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "gtex",
		query,
		searchMode,
		datasetId,
		totalCount,
		returned: results.length,
		truncated: totalCount > results.length,
		results,
		...extra,
		provenance: {
			docs: "https://gtexportal.org/api/v2/redoc",
			endpoints,
		},
	};
}

function findGtexGene(query: string, records: Record<string, unknown>[]): Record<string, unknown> | undefined {
	const normalizedQuery = query.toUpperCase();
	const unversionedQuery = normalizedQuery.replace(/\.\d+$/, "");
	return records.find((record) => {
		const symbol = stringValue(record.geneSymbol)?.toUpperCase();
		const symbolUpper = stringValue(record.geneSymbolUpper)?.toUpperCase();
		const gencodeId = stringValue(record.gencodeId)?.toUpperCase();
		const unversionedGencode = gencodeId?.replace(/\.\d+$/, "");
		return symbol === normalizedQuery || symbolUpper === normalizedQuery || gencodeId === normalizedQuery || unversionedGencode === unversionedQuery;
	}) ?? records[0];
}

async function searchNamedGtex(query: string, limit: number): Promise<Record<string, unknown> | undefined> {
	const datasetInfo = parseNamedValue(query, "gtex_dataset_info");
	if (datasetInfo !== undefined) {
		const url = new URL(`${GTEX_BASE}/metadata/dataset`);
		const payload = await fetchJson(url);
		const rows = (Array.isArray(payload) ? payload : arrayValue(recordValue(payload).data)).map((item) => recordValue(item));
		return gtexEnvelope(query, "dataset-info", "all", rows.length, rows.sort((a, b) => `${stringValue(a.datasetId) ?? ""}`.localeCompare(`${stringValue(b.datasetId) ?? ""}`)), [url.toString()]);
	}
	const tissueSites = parseNamedValue(query, "gtex_tissue_sites");
	if (tissueSites !== undefined) {
		const { values } = parseKeyValues(tissueSites);
		const datasetId = gtexDatasetId(values);
		const page = await fetchGtexPaged("/dataset/tissueSiteDetail", values, limit, {}, 1000);
		const rows = page.results.map((item) => recordValue(item)).sort((a, b) => `${stringValue(a.tissueSiteDetailId) ?? ""}`.localeCompare(`${stringValue(b.tissueSiteDetailId) ?? ""}`));
		return gtexEnvelope(query, "tissue-sites", datasetId, page.totalCount, rows, page.endpoints);
	}
	const sampleInfo = parseNamedValue(query, "gtex_sample_info");
	if (sampleInfo !== undefined) {
		const { values } = parseKeyValues(sampleInfo);
		const datasetId = gtexDatasetId(values);
		const page = await fetchGtexPaged("/dataset/sample", values, limit, {
			dataType: values.data_type,
			subjectId: values.subject_id,
			tissueSiteDetailId: values.tissue_site_detail_id ?? values.tissue,
		});
		return gtexEnvelope(query, "sample-info", datasetId, page.totalCount, page.results.map((item) => recordValue(item)), page.endpoints);
	}
	const resolveGenes = parseNamedValue(query, "gtex_resolve_genes");
	if (resolveGenes !== undefined) {
		const { rest, values } = parseKeyValues(resolveGenes);
		const datasetId = gtexDatasetId(values);
		const geneIds = csvValues(values.gene_ids ?? values.genes ?? values.gene_id) ?? rest.split(/[\s,;]+/).filter(Boolean);
		if (!geneIds.length) throw new Error("gtex_resolve_genes requires one or more gene symbols or Ensembl gene ids.");
		const page = await fetchGtexPaged("/reference/gene", values, limit, { geneId: geneIds }, Math.max(limit, geneIds.length));
		const rows = page.results.map((item) => normalizeGtexGene(recordValue(item))).sort((a, b) => `${stringValue(a.geneSymbol) ?? ""}${stringValue(a.gencodeId) ?? ""}`.localeCompare(`${stringValue(b.geneSymbol) ?? ""}${stringValue(b.gencodeId) ?? ""}`));
		return gtexEnvelope(query, "resolve-genes", datasetId, page.totalCount, rows, page.endpoints, { geneIds });
	}
	const medianExpression = parseNamedValue(query, "gtex_median_expression");
	if (medianExpression !== undefined) {
		const { rest, values } = parseKeyValues(medianExpression);
		const datasetId = gtexDatasetId(values);
		const gencodeIds = csvValues(values.gencode_ids ?? values.gencode_id) ?? rest.split(/[\s,;]+/).filter(Boolean);
		if (!gencodeIds.length) throw new Error("gtex_median_expression requires gencode_id=<versioned GENCODE id> or a bare GENCODE id.");
		const page = await fetchGtexPaged("/expression/medianGeneExpression", values, limit, {
			gencodeId: gencodeIds,
			tissueSiteDetailId: csvValues(values.tissue_site_detail_ids ?? values.tissue_site_detail_id ?? values.tissues ?? values.tissue),
		});
		const rows = page.results.map((item) => normalizeGtexMedianExpression(recordValue(item), {}));
		return gtexEnvelope(query, "median-expression", datasetId, page.totalCount, rows, page.endpoints, { gencodeIds });
	}
	const expressionSummary = parseNamedValue(query, "gtex_expression_summary");
	if (expressionSummary !== undefined) {
		const { rest, values } = parseKeyValues(expressionSummary);
		const geneId = values.gene ?? rest;
		if (!geneId) throw new Error("gtex_expression_summary requires a gene symbol or Ensembl gene id.");
		const resolved = await fetchGtexPaged("/reference/gene", values, limit, { geneId }, Math.max(limit, 10));
		const genes = resolved.results.map((item) => normalizeGtexGene(recordValue(item)));
		const gene = findGtexGene(geneId, genes);
		if (!gene) return gtexEnvelope(query, "expression-summary", gtexDatasetId(values), 0, [], resolved.endpoints, { geneId });
		const med = await fetchGtexPaged("/expression/medianGeneExpression", values, limit, { gencodeId: stringValue(gene.gencodeId) ?? geneId }, 1000);
		const rows = med.results.map((item) => normalizeGtexMedianExpression(recordValue(item), gene)).sort((a, b) => (numberValue(b.medianTpm) ?? -1) - (numberValue(a.medianTpm) ?? -1)).slice(0, limit);
		return gtexEnvelope(query, "expression-summary", gtexDatasetId(values), med.totalCount, rows, [...resolved.endpoints, ...med.endpoints], { gene });
	}
	const geneExpression = parseNamedValue(query, "gtex_gene_expression");
	if (geneExpression !== undefined) {
		const { rest, values } = parseKeyValues(geneExpression);
		const gencodeId = values.gencode_id ?? rest;
		if (!gencodeId) throw new Error("gtex_gene_expression requires gencode_id=<versioned GENCODE id>.");
		const page = await fetchGtexPaged("/expression/geneExpression", values, limit, {
			gencodeId,
			tissueSiteDetailId: csvValues(values.tissue_site_detail_ids ?? values.tissue_site_detail_id ?? values.tissues ?? values.tissue),
		});
		return gtexEnvelope(query, "gene-expression", gtexDatasetId(values), page.totalCount, page.results.map((item) => recordValue(item)), page.endpoints, { gencodeId });
	}
	const topExpressed = parseNamedValue(query, "gtex_top_expressed_genes");
	if (topExpressed !== undefined) {
		const { rest, values } = parseKeyValues(topExpressed);
		const tissue = values.tissue_site_detail_id ?? values.tissue ?? rest;
		if (!tissue) throw new Error("gtex_top_expressed_genes requires a tissue_site_detail_id.");
		const n = Math.max(1, Math.min(Number(values.n ?? values.max_genes ?? limit) || limit, MAX_LIMIT));
		const page = await fetchGtexPaged("/expression/topExpressedGene", values, n, {
			filterMtGene: values.filter_mt_gene ?? "true",
			tissueSiteDetailId: tissue,
		});
		return gtexEnvelope(query, "top-expressed-genes", gtexDatasetId(values), page.totalCount, page.results.map((item) => recordValue(item)), page.endpoints, { tissueSiteDetailId: tissue });
	}
	const eqtlGenes = parseNamedValue(query, "gtex_eqtl_genes");
	if (eqtlGenes !== undefined) {
		const { rest, values } = parseKeyValues(eqtlGenes);
		const tissue = values.tissue_site_detail_id ?? values.tissue ?? rest;
		if (!tissue) throw new Error("gtex_eqtl_genes requires a tissue_site_detail_id.");
		const page = await fetchGtexPaged("/association/egene", values, limit, { tissueSiteDetailId: tissue });
		return gtexEnvelope(query, "eqtl-genes", gtexDatasetId(values), page.totalCount, page.results.map((item) => recordValue(item)), page.endpoints, { tissueSiteDetailId: tissue });
	}
	const singleTissue = parseNamedValue(query, "gtex_single_tissue_eqtls");
	if (singleTissue !== undefined) {
		const { values } = parseKeyValues(singleTissue);
		if (!values.gencode_id && !values.variant_id) throw new Error("gtex_single_tissue_eqtls requires gencode_id and/or variant_id.");
		const page = await fetchGtexPaged("/association/singleTissueEqtl", values, limit, {
			gencodeId: values.gencode_id,
			tissueSiteDetailId: values.tissue_site_detail_id ?? values.tissue,
			variantId: values.variant_id,
		});
		return gtexEnvelope(query, "single-tissue-eqtls", gtexDatasetId(values), page.totalCount, page.results.map((item) => recordValue(item)), page.endpoints);
	}
	const multiTissue = parseNamedValue(query, "gtex_multi_tissue_eqtls");
	if (multiTissue !== undefined) {
		const { rest, values } = parseKeyValues(multiTissue);
		const gencodeId = values.gencode_id ?? rest;
		if (!gencodeId) throw new Error("gtex_multi_tissue_eqtls requires gencode_id=<versioned GENCODE id>.");
		const page = await fetchGtexPaged("/association/metasoft", values, limit, {
			gencodeId,
			variantId: values.variant_id,
		});
		return gtexEnvelope(query, "multi-tissue-eqtls", gtexDatasetId(values), page.totalCount, page.results.map((item) => recordValue(item)), page.endpoints, { gencodeId });
	}
	const calculate = parseNamedValue(query, "gtex_calculate_eqtl");
	if (calculate !== undefined) {
		const { values } = parseKeyValues(calculate);
		const tissue = values.tissue_site_detail_id ?? values.tissue;
		if (!values.gencode_id || !values.variant_id || !tissue) throw new Error("gtex_calculate_eqtl requires gencode_id, variant_id, and tissue_site_detail_id.");
		const url = new URL(`${GTEX_BASE}/association/dyneqtl`);
		url.searchParams.set("datasetId", gtexDatasetId(values));
		url.searchParams.set("gencodeId", values.gencode_id);
		url.searchParams.set("variantId", values.variant_id);
		url.searchParams.set("tissueSiteDetailId", tissue);
		const result = recordValue(await fetchJson(url));
		return gtexEnvelope(query, "calculate-eqtl", gtexDatasetId(values), Object.keys(result).length ? 1 : 0, [result], [url.toString()]);
	}
	return undefined;
}

export async function searchGtex(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const named = await searchNamedGtex(query, limit);
	if (named) return named;
	const datasetId = "gtex_v8";
	const geneUrl = new URL(`${GTEX_BASE}/reference/gene`);
	geneUrl.searchParams.set("datasetId", datasetId);
	geneUrl.searchParams.set("geneId", query);
	geneUrl.searchParams.set("itemsPerPage", String(Math.max(limit, 10)));
	geneUrl.searchParams.set("page", "0");
	const genePayload = recordValue(await fetchJson(geneUrl));
	const genes = arrayValue(genePayload.data).map((item) => normalizeGtexGene(recordValue(item)));
	const gene = findGtexGene(query, genes);
	const endpoints = [geneUrl.toString()];
	if (!gene) {
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "gtex",
			query,
			datasetId,
			totalCount: numberValue(recordValue(genePayload.paging_info).totalNumberOfItems) ?? genes.length,
			returned: genes.length,
			results: genes,
			provenance: {
				docs: "https://gtexportal.org/api/v2/redoc",
				endpoints,
			},
		};
	}
	const expressionUrl = new URL(`${GTEX_BASE}/expression/medianGeneExpression`);
	expressionUrl.searchParams.set("datasetId", datasetId);
	expressionUrl.searchParams.set("gencodeId", stringValue(gene.gencodeId) ?? query);
	expressionUrl.searchParams.set("itemsPerPage", String(Math.max(limit, 10)));
	expressionUrl.searchParams.set("page", "0");
	endpoints.push(expressionUrl.toString());
	const expressionPayload = recordValue(await fetchJson(expressionUrl));
	const results = arrayValue(expressionPayload.data)
		.map((item) => normalizeGtexMedianExpression(recordValue(item), gene))
		.sort((a, b) => (numberValue(b.medianTpm) ?? -1) - (numberValue(a.medianTpm) ?? -1))
		.slice(0, limit);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "gtex",
		query,
		datasetId,
		gene,
		totalCount: numberValue(recordValue(expressionPayload.paging_info).totalNumberOfItems) ?? results.length,
		returned: results.length,
		results,
		provenance: {
			docs: "https://gtexportal.org/api/v2/redoc",
			endpoints,
		},
	};
}
