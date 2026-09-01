type DepmapSearchParams = { limit?: number; query: string };

const CMP_BASE = "https://api.cellmodelpassports.sanger.ac.uk";
const CMP_MODEL_URL = "https://cellmodelpassports.sanger.ac.uk/passports";
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 30_000;
const DOCS = [
	"https://depmap.sanger.ac.uk/documentation/api/",
	"https://api.cellmodelpassports.sanger.ac.uk/swagger",
	"https://depmap.org/portal/api/download/files",
];

type RequestResult = {
	endpoint: string;
	payload: unknown;
};

type ParsedQuery =
	| { mode: "dependencies"; gene: string; modelId?: string }
	| { mode: "gene-search"; value: string; exact: boolean }
	| { mode: "model-detail"; value: string }
	| { mode: "model-search"; value: string }
	| { mode: "models"; cancerType?: string; tissue?: string };

function recordValue(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function idValue(value: unknown): string | undefined {
	if (typeof value === "string" && value.trim()) return value.trim();
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	return undefined;
}

function numberValue(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
	return undefined;
}

function booleanValue(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function safeLimit(value: number | undefined): number {
	if (!Number.isFinite(value) || value === undefined) return DEFAULT_LIMIT;
	return Math.max(1, Math.min(Math.floor(value), MAX_LIMIT));
}

function cleanQuery(query: string): string {
	const clean = query.trim();
	if (!clean) throw new Error("DepMap search requires a non-empty query.");
	return clean;
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(record).filter(([, value]) => {
		if (value === undefined || value === null) return false;
		if (Array.isArray(value)) return value.length > 0;
		if (typeof value === "object") return Object.keys(recordValue(value)).length > 0;
		return true;
	}));
}

function encodePath(value: string): string {
	return encodeURIComponent(value);
}

function cmpUrl(path: string, params?: Record<string, string | number | undefined>): URL {
	const url = new URL(`${CMP_BASE}${path}`);
	for (const [key, value] of Object.entries(params ?? {})) {
		if (value !== undefined) url.searchParams.set(key, String(value));
	}
	return url;
}

function cmpFilter(spec: Array<Record<string, unknown>>): string {
	return JSON.stringify(spec);
}

async function requestJson(path: string, params?: Record<string, string | number | undefined>): Promise<RequestResult> {
	const url = cmpUrl(path, params);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			headers: { accept: "application/vnd.api+json, application/json" },
			signal: controller.signal,
		});
		if (!response.ok) {
			const body = await response.text().catch(() => "");
			throw new Error(`DepMap Cell Model Passports request failed: ${response.status} ${response.statusText}${body ? ` ${body.slice(0, 180)}` : ""}`);
		}
		return { endpoint: url.toString(), payload: await response.json() };
	} finally {
		clearTimeout(timeout);
	}
}

function parseQuery(query: string): ParsedQuery {
	const clean = cleanQuery(query);
	const match = clean.match(/^([a-z][a-z0-9_-]*)\s*:\s*(.+)$/i);
	if (!match) {
		if (/^SIDM\d+$/i.test(clean)) return { mode: "model-detail", value: clean.toUpperCase() };
		return { mode: "model-search", value: clean };
	}
	const key = match[1]!.toLowerCase().replace(/_/g, "-");
	const value = cleanQuery(match[2]!);
	if (key === "model" || key === "model-id" || key === "get-model") return { mode: "model-detail", value };
	if (key === "models" || key === "list-models") return parseModelsQuery(value);
	if (key === "model-search" || key === "search-models") return { mode: "model-search", value };
	if (key === "gene") return { mode: "gene-search", value, exact: true };
	if (key === "genes" || key === "search-genes") return { mode: "gene-search", value, exact: false };
	if (key === "dependencies" || key === "dependency" || key === "crispr" || key === "gene-dependencies") return parseDependencyQuery(value);
	return { mode: "model-search", value: clean };
}

function parseModelsQuery(value: string): ParsedQuery {
	let tissue: string | undefined;
	let cancerType: string | undefined;
	for (const part of value.split(/[;,]/).map((item) => item.trim()).filter(Boolean)) {
		const match = part.match(/^(tissue|cancer[-_ ]?type)\s*=\s*(.+)$/i);
		if (match?.[1]?.toLowerCase().startsWith("tissue")) tissue = match[2]!.trim();
		else if (match) cancerType = match[2]!.trim();
		else tissue = part;
	}
	return { mode: "models", tissue, cancerType };
}

function parseDependencyQuery(value: string): ParsedQuery {
	const atParts = value.split("@").map((part) => part.trim()).filter(Boolean);
	if (atParts.length === 2) return { mode: "dependencies", gene: atParts[0]!, modelId: atParts[1]!.toUpperCase() };
	const inMatch = value.match(/^(.+?)\s+(?:in|model=)\s+(SIDM\d+)$/i);
	if (inMatch) return { mode: "dependencies", gene: inMatch[1]!.trim(), modelId: inMatch[2]!.toUpperCase() };
	return { mode: "dependencies", gene: value.trim() };
}

function modelUrl(modelId: string | undefined): string | undefined {
	return modelId ? `${CMP_MODEL_URL}/${encodeURIComponent(modelId)}` : undefined;
}

function includedByTypeAndId(included: unknown): Map<string, Record<string, unknown>> {
	const map = new Map<string, Record<string, unknown>>();
	for (const item of arrayValue(included)) {
		const record = recordValue(item);
		const type = stringValue(record.type);
		const id = idValue(record.id);
		if (type && id) map.set(`${type}:${id}`, record);
	}
	return map;
}

function relationshipId(record: Record<string, unknown>, name: string): string | undefined {
	const relationship = recordValue(recordValue(record.relationships)[name]);
	const data = recordValue(relationship.data);
	return idValue(data.id);
}

function relationshipManyIds(record: Record<string, unknown>, name: string): string[] {
	const relationship = recordValue(recordValue(record.relationships)[name]);
	return arrayValue(relationship.data).map((item) => stringValue(recordValue(item).id)).filter(Boolean) as string[];
}

function normalizeModel(record: Record<string, unknown>, included?: unknown): Record<string, unknown> {
	const attrs = recordValue(record.attributes);
	const modelId = idValue(record.id);
	const includedMap = includedByTypeAndId(included);
	const sampleId = relationshipId(record, "sample");
	const tissueId = relationshipId(includedMap.get(`sample:${sampleId}`) ?? {}, "tissue");
	const cancerTypeId = relationshipId(includedMap.get(`sample:${sampleId}`) ?? {}, "cancer_type");
	const msiIds = relationshipManyIds(record, "model_msi_status");
	const currentMsi = msiIds
		.map((id) => recordValue(includedMap.get(`model_msi_status:${id}`)))
		.find((item) => booleanValue(recordValue(item.attributes).current));
	const currentMsiAttrs = recordValue(recordValue(currentMsi).attributes);
	return compactRecord({
		modelId,
		names: arrayValue(attrs.names).map(String).sort((a, b) => a.localeCompare(b)),
		modelType: stringValue(attrs.model_type),
		growthProperties: stringValue(attrs.growth_properties),
		modelTreatment: stringValue(attrs.model_treatment),
		tissue: stringValue(recordValue(recordValue(includedMap.get(`tissue:${tissueId}`)).attributes).name),
		cancerType: stringValue(recordValue(recordValue(includedMap.get(`cancer_type:${cancerTypeId}`)).attributes).name),
		sampleId,
		msiStatus: stringValue(currentMsiAttrs.msi_status),
		ploidyWes: numberValue(attrs.ploidy_wes),
		ploidyWgs: numberValue(attrs.ploidy_wgs),
		mutationsPerMb: numberValue(attrs.mutations_per_mb),
		doi: stringValue(attrs.doi),
		pubmedId: stringValue(attrs.pmed),
		dataAvailability: compactRecord({
			mutations: booleanValue(attrs.mutations_available),
			copyNumber: booleanValue(attrs.cnv_available),
			expression: booleanValue(attrs.expression_available),
			rnaSeq: booleanValue(attrs.rnaseq_available),
			crisprKo: booleanValue(attrs.crispr_ko_available),
			drugs: booleanValue(attrs.drugs_available),
			fusions: booleanValue(attrs.fusions_available),
			methylation: booleanValue(attrs.methylation_available),
			proteomics: booleanValue(attrs.proteomics_available),
			commercial: booleanValue(attrs.commercial_available),
		}),
		url: modelUrl(modelId),
	});
}

function normalizeModelRow(record: Record<string, unknown>): Record<string, unknown> {
	const attrs = recordValue(record.attributes);
	const modelId = idValue(record.id);
	return compactRecord({
		modelId,
		names: arrayValue(attrs.names).map(String).sort((a, b) => a.localeCompare(b)),
		modelType: stringValue(attrs.model_type),
		growthProperties: stringValue(attrs.growth_properties),
		crisprKoAvailable: booleanValue(attrs.crispr_ko_available),
		rnaSeqAvailable: booleanValue(attrs.rnaseq_available),
		mutationsAvailable: booleanValue(attrs.mutations_available),
		url: modelUrl(modelId),
	});
}

function normalizeGene(record: Record<string, unknown>): Record<string, unknown> {
	const attrs = recordValue(record.attributes);
	const geneId = idValue(record.id);
	return compactRecord({
		geneId,
		symbol: stringValue(attrs.symbol),
		hgncId: stringValue(attrs.hgnc_id),
		hgncStatus: stringValue(attrs.hgnc_status),
		location: stringValue(attrs.location),
		cancerDriver: booleanValue(attrs.cancer_driver),
		tumourSuppressor: booleanValue(attrs.tumour_suppressor),
		methodOfAction: stringValue(attrs.method_of_action),
		inYusaLibrary: booleanValue(attrs.in_yusa_lib),
		url: geneId ? `${CMP_BASE}/genes/${encodeURIComponent(geneId)}` : undefined,
	});
}

function normalizeDependency(record: Record<string, unknown>): Record<string, unknown> {
	const attrs = recordValue(record.attributes);
	return compactRecord({
		geneId: relationshipId(record, "gene"),
		modelId: relationshipId(record, "model"),
		source: stringValue(attrs.source),
		bayesFactor: numberValue(attrs.bf),
		scaledBayesFactor: numberValue(attrs.bf_scaled),
		cleanFoldChange: numberValue(attrs.fc_clean),
		quantileNormalizedCleanFoldChange: numberValue(attrs.fc_clean_qn),
		mageckFdr: numberValue(attrs.mageck_fdr),
		qcPass: booleanValue(attrs.qc_pass),
	});
}

async function searchModels(params: DepmapSearchParams, parsed: Extract<ParsedQuery, { mode: "models" }>): Promise<Record<string, unknown>> {
	const limit = safeLimit(params.limit);
	const filter: Array<Record<string, unknown>> = [];
	if (parsed.tissue) {
		filter.push({ name: "sample", op: "has", val: { name: "tissue", op: "has", val: { name: "name", op: "eq", val: parsed.tissue } } });
	}
	if (parsed.cancerType) {
		filter.push({ name: "sample", op: "has", val: { name: "cancer_type", op: "has", val: { name: "name", op: "eq", val: parsed.cancerType } } });
	}
	const result = await requestJson("/models", {
		...(filter.length ? { filter: cmpFilter(filter) } : {}),
		"page[size]": limit,
		"page[number]": 1,
	});
	const payload = recordValue(result.payload);
	const results = arrayValue(payload.data).map((item) => normalizeModelRow(recordValue(item)));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "depmap",
		query: params.query,
		searchMode: "model-list",
		tissue: parsed.tissue,
		cancerType: parsed.cancerType,
		totalCount: numberValue(recordValue(payload.meta).count) ?? results.length,
		returned: results.length,
		results,
		provenance: { docs: DOCS, endpoints: [result.endpoint] },
	};
}

async function searchModelName(params: DepmapSearchParams, value: string): Promise<Record<string, unknown>> {
	const limit = safeLimit(params.limit);
	const result = await requestJson(`/search/${encodePath(value)}`);
	const payload = recordValue(result.payload);
	const rows = arrayValue(payload.data)
		.map((item) => recordValue(item))
		.filter((item) => stringValue(item.type) === "model")
		.slice(0, limit)
		.map(normalizeModelRow);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "depmap",
		query: params.query,
		searchMode: "model-search",
		totalCount: numberValue(recordValue(payload.meta).count) ?? rows.length,
		returned: rows.length,
		results: rows,
		provenance: { docs: DOCS, endpoints: [result.endpoint] },
	};
}

async function getModel(params: DepmapSearchParams, value: string): Promise<Record<string, unknown>> {
	const endpoints: string[] = [];
	let record: Record<string, unknown> | undefined;
	let included: unknown;
	if (/^SIDM\d+$/i.test(value)) {
		const result = await requestJson(`/models/${encodePath(value.toUpperCase())}`, { include: "sample.tissue,sample.cancer_type,model_msi_status" });
		endpoints.push(result.endpoint);
		const payload = recordValue(result.payload);
		record = recordValue(payload.data);
		included = payload.included;
	} else {
		const result = await requestJson("/models", {
			filter: cmpFilter([{ name: "names", op: "any", val: value }]),
			include: "sample.tissue,sample.cancer_type,model_msi_status",
			"page[size]": 5,
		});
		endpoints.push(result.endpoint);
		const payload = recordValue(result.payload);
		const data = arrayValue(payload.data);
		record = recordValue(data[0]);
		included = payload.included;
	}
	const results = record && Object.keys(record).length ? [normalizeModel(record, included)] : [];
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "depmap",
		query: params.query,
		searchMode: "model-detail",
		totalCount: results.length,
		returned: results.length,
		results,
		provenance: { docs: DOCS, endpoints },
	};
}

async function searchGenes(params: DepmapSearchParams, parsed: Extract<ParsedQuery, { mode: "gene-search" }>): Promise<Record<string, unknown>> {
	const limit = safeLimit(params.limit);
	const result = await requestJson("/genes", {
		filter: cmpFilter([{ name: "symbol", op: parsed.exact ? "eq" : "ilike", val: parsed.exact ? parsed.value : `%${parsed.value}%` }]),
		"page[size]": limit,
		"page[number]": 1,
	});
	const payload = recordValue(result.payload);
	const results = arrayValue(payload.data).map((item) => normalizeGene(recordValue(item)));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "depmap",
		query: params.query,
		searchMode: parsed.exact ? "exact-gene" : "gene-search",
		totalCount: numberValue(recordValue(payload.meta).count) ?? results.length,
		returned: results.length,
		results,
		provenance: { docs: DOCS, endpoints: [result.endpoint] },
	};
}

async function resolveGene(symbol: string): Promise<{ endpoint: string; gene?: Record<string, unknown>; geneId?: string }> {
	const result = await requestJson("/genes", {
		filter: cmpFilter([{ name: "symbol", op: "eq", val: symbol }]),
		"page[size]": 5,
	});
	const payload = recordValue(result.payload);
	const record = recordValue(arrayValue(payload.data)[0]);
	const gene = Object.keys(record).length ? normalizeGene(record) : undefined;
	return { endpoint: result.endpoint, gene, geneId: idValue(record.id) };
}

async function searchDependencies(params: DepmapSearchParams, parsed: Extract<ParsedQuery, { mode: "dependencies" }>): Promise<Record<string, unknown>> {
	const limit = safeLimit(params.limit);
	const endpoints: string[] = [];
	const geneResult = await resolveGene(parsed.gene);
	endpoints.push(geneResult.endpoint);
	if (!geneResult.geneId) {
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "depmap",
			query: params.query,
			searchMode: "crispr-dependencies",
			gene: parsed.gene,
			modelId: parsed.modelId,
			totalCount: 0,
			returned: 0,
			results: [],
			warnings: [`No Cell Model Passports gene record found for ${parsed.gene}.`],
			provenance: { docs: DOCS, endpoints },
		};
	}
	const filter = parsed.modelId
		? { filter: cmpFilter([{ name: "model", op: "has", val: { name: "id", op: "eq", val: parsed.modelId } }]) }
		: {};
	const result = await requestJson(`/genes/${encodePath(geneResult.geneId)}/datasets/crispr_ko`, {
		...filter,
		"page[size]": limit,
		"page[number]": 1,
	});
	endpoints.push(result.endpoint);
	const payload = recordValue(result.payload);
	const results = arrayValue(payload.data).map((item) => normalizeDependency(recordValue(item)));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "depmap",
		query: params.query,
		searchMode: "crispr-dependencies",
		gene: geneResult.gene,
		modelId: parsed.modelId,
		totalCount: numberValue(recordValue(payload.meta).count) ?? results.length,
		returned: results.length,
		results,
		provenance: { docs: DOCS, endpoints },
	};
}

export async function searchDepmap(params: DepmapSearchParams): Promise<Record<string, unknown>> {
	const parsed = parseQuery(params.query);
	if (parsed.mode === "models") return searchModels(params, parsed);
	if (parsed.mode === "model-detail") return getModel(params, parsed.value);
	if (parsed.mode === "gene-search") return searchGenes(params, parsed);
	if (parsed.mode === "dependencies") return searchDependencies(params, parsed);
	return searchModelName(params, parsed.value);
}
