type ClingenSearchParams = { limit?: number; query: string };

const SEARCH_BASE = "https://search.clinicalgenome.org";
const ACTIONABILITY_BASE = "https://actionability.clinicalgenome.org/ac";
const EREPO_SUMMARY_BASE = "https://erepo.genome.network/evrepo/api/summary";
const EREPO_UI_BASE = "https://erepo.clinicalgenome.org/evrepo/ui/summary/classifications";
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 35_000;
const DOCS = [
	"https://search.clinicalgenome.org/kb/downloads",
	"https://genboree.org/gitlab/clingen/actionability/-/wikis/Actionabilty-APIs",
	"https://genboree.org/gitlab/clingen/erepo/erepo-records-table/-/wikis/Evidence-Repository-API",
	"https://clinicalgenome.org/docs/terms-of-use/",
];

type ParsedQuery =
	| { mode: "actionability"; context: "adult" | "both" | "pediatric"; gene: string }
	| { mode: "classification"; column: "caId" | "cvId" | "gene" | "hgvs"; matchType: "contains" | "exact"; value: string }
	| { mode: "dosage"; gene: string; includeRegions: boolean }
	| { mode: "gene-summary"; gene: string }
	| { mode: "validity"; gene: string };

type RequestResult = {
	endpoint: string;
	payload: unknown;
};

type SourceAccumulator = {
	endpoints: string[];
	warnings: string[];
};

const DOSAGE_ASSERTION_LABELS: Record<string, string> = {
	"-5": "Not yet evaluated",
	"0": "No Evidence",
	"1": "Little Evidence",
	"2": "Emerging Evidence",
	"3": "Sufficient Evidence",
	"30": "Gene Associated with Autosomal Recessive Phenotype",
	"40": "Dosage Sensitivity Unlikely",
};

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

function booleanish(value: unknown): boolean | undefined {
	if (typeof value === "boolean") return value;
	if (typeof value === "number") return value !== 0;
	if (typeof value === "string" && value.trim()) {
		const clean = value.trim().toLowerCase();
		if (clean === "true" || clean === "yes" || clean === "1") return true;
		if (clean === "false" || clean === "no" || clean === "0") return false;
	}
	return undefined;
}

function safeLimit(value: number | undefined): number {
	if (!Number.isFinite(value) || value === undefined) return DEFAULT_LIMIT;
	return Math.max(1, Math.min(Math.floor(value), MAX_LIMIT));
}

function cleanQuery(query: string): string {
	const clean = query.trim();
	if (!clean) throw new Error("ClinGen search requires a non-empty query.");
	return clean;
}

function trimText(value: string | undefined, max = 420): string | undefined {
	if (!value) return undefined;
	const clean = value.replace(/\s+/g, " ").trim();
	if (!clean) return undefined;
	if (clean.length <= max) return clean;
	return `${clean.slice(0, max - 1).trimEnd()}...`;
}

function geneUrl(kind: "dosage" | "validity", gene: string | undefined): string | undefined {
	if (!gene) return undefined;
	const path = kind === "validity" ? "gene-validity" : "gene-dosage";
	return `${SEARCH_BASE}/kb/${path}/${encodeURIComponent(gene)}`;
}

function erepoUiUrl(column: string, value: string, matchType: string): string {
	const url = new URL(EREPO_UI_BASE);
	url.searchParams.set("columns", column);
	url.searchParams.set("values", value);
	url.searchParams.set("matchTypes", matchType);
	return url.toString();
}

async function requestJson(url: URL): Promise<RequestResult> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			headers: {
				accept: "application/json",
				"user-agent": "feynman-clingen/0.1",
			},
			signal: controller.signal,
		});
		const text = await response.text();
		if (!response.ok) {
			throw new Error(`ClinGen request failed: ${response.status} ${response.statusText}${text ? ` ${text.slice(0, 180)}` : ""}`);
		}
		return {
			endpoint: url.toString(),
			payload: text ? JSON.parse(text) as unknown : undefined,
		};
	} finally {
		clearTimeout(timeout);
	}
}

function pushEndpoint(state: SourceAccumulator, endpoint: string): void {
	if (!state.endpoints.includes(endpoint)) state.endpoints.push(endpoint);
}

function pushWarning(state: SourceAccumulator, message: string): void {
	if (!state.warnings.includes(message)) state.warnings.push(message);
}

async function requestJsonOptional(url: URL, state: SourceAccumulator, label: string): Promise<RequestResult | undefined> {
	try {
		const result = await requestJson(url);
		pushEndpoint(state, result.endpoint);
		return result;
	} catch (error) {
		pushEndpoint(state, url.toString());
		pushWarning(state, `${label}: ${error instanceof Error ? error.message : String(error)}`);
		return undefined;
	}
}

function normalizeDosageAssertion(value: unknown): Record<string, unknown> | undefined {
	if (value === null || value === undefined) return undefined;
	const raw = String(value).trim();
	if (!raw) return undefined;
	const code = raw === "Not yet evaluated" ? "-5" : raw.split(":")[0]!.trim();
	return {
		code,
		label: DOSAGE_ASSERTION_LABELS[code] ?? raw,
	};
}

function normalizeValidityRecord(row: Record<string, unknown>): Record<string, unknown> {
	const geneSymbol = stringValue(row.symbol);
	return {
		geneSymbol,
		hgncId: stringValue(row.hgnc_id),
		diseaseLabel: stringValue(row.disease_name),
		mondoId: stringValue(row.mondo),
		modeOfInheritance: stringValue(row.moi),
		sop: stringValue(row.sop),
		classification: stringValue(row.classification),
		expertPanel: stringValue(row.ep),
		affiliateId: stringValue(row.affiliate_id),
		animalModelOnly: booleanish(row.animal_model_only),
		assertionId: stringValue(row.perm_id),
		released: stringValue(row.released),
		url: geneUrl("validity", geneSymbol),
	};
}

function normalizeDosageRecord(row: Record<string, unknown>): Record<string, unknown> {
	const isRegion = numberValue(row.type) === 1;
	const symbol = stringValue(row.symbol);
	return {
		recordType: isRegion ? "region" : "gene",
		symbol,
		id: stringValue(row.hgnc_id),
		cytoband: stringValue(row.location),
		grch37: stringValue(row.grch37),
		grch38: stringValue(row.grch38),
		haploinsufficiency: normalizeDosageAssertion(row.haplo_assertion),
		triplosensitivity: normalizeDosageAssertion(row.triplo_assertion),
		haploDisease: stringValue(row.haplo_disease),
		haploMondo: stringValue(row.haplo_mondo) ?? stringValue(row.haplo_disease_id),
		triploDisease: stringValue(row.triplo_disease),
		triploMondo: stringValue(row.triplo_mondo) ?? stringValue(row.triplo_disease_id),
		omim: stringValue(row.omim),
		morbid: stringValue(row.morbid),
		released: stringValue(row.date),
		url: symbol ? geneUrl("dosage", symbol) : undefined,
	};
}

function normalizeActionabilityRecord(columns: string[], row: unknown[]): Record<string, unknown> {
	const record: Record<string, unknown> = {};
	columns.forEach((column, index) => {
		record[column] = row[index];
	});
	const genes = String(record.geneOrVariant ?? "")
		.split(",")
		.map((gene) => gene.trim())
		.filter(Boolean);
	return {
		docId: stringValue(record.docId),
		curationType: stringValue(record.curationType),
		context: stringValue(record.context),
		release: stringValue(record.release),
		releaseDate: stringValue(record.releaseDate),
		genes,
		geneOmim: stringValue(record.geneOmim),
		disease: stringValue(record.disease),
		diseaseOmim: stringValue(record.omim),
		statusOverall: stringValue(record["status-overall"]),
		outcome: stringValue(record.outcome),
		outcomeScoringGroup: stringValue(record.outcomeScoringGroup),
		intervention: stringValue(record.intervention),
		interventionScoringGroup: stringValue(record.interventionScoringGroup),
		severity: stringValue(record.severity),
		likelihood: stringValue(record.likelihood),
		natureOfIntervention: stringValue(record.natureOfIntervention),
		effectiveness: stringValue(record.effectiveness),
		overallScore: stringValue(record.overall),
		url: stringValue(record.docId) ? `${ACTIONABILITY_BASE}/${encodeURIComponent(stringValue(record.context) ?? "Adult")}/ui/summ?search=${encodeURIComponent(stringValue(record.docId)!)}`
			: undefined,
	};
}

function normalizeClassificationRecord(row: Record<string, unknown>): Record<string, unknown> {
	const caId = stringValue(row.caId);
	const uuid = stringValue(row.uuid);
	const hgvs = arrayValue(row.hgvs).map(String).filter(Boolean);
	const metCodes = arrayValue(row.metCodes).map(String).filter(Boolean);
	const unMetCodes = arrayValue(row.unMetCodes).map(String).filter(Boolean);
	return {
		id: stringValue(row.PCERDocID) ?? uuid,
		uuid,
		caId,
		clinvarVariationId: stringValue(row.cvId),
		geneSymbol: stringValue(row.gene),
		geneNcbiId: stringValue(row.geneNcbiId),
		condition: stringValue(row.condition),
		mondoId: stringValue(row.mondoId),
		classification: stringValue(row.classification),
		expertPanel: stringValue(row.ep),
		modeOfInheritance: stringValue(row.moi),
		docVersion: stringValue(row.docVersion),
		approvedDate: stringValue(row.approvedDate),
		publishedDate: stringValue(row.publishedDate),
		preferredVariantTitle: stringValue(row.preferredVarTitle),
		hgvs: hgvs.slice(0, 8),
		hgvsCount: hgvs.length,
		evidenceCodesMet: metCodes.slice(0, 12),
		evidenceCodesNotMet: unMetCodes.slice(0, 12),
		retracted: booleanish(row.retracted),
		summary: trimText(stringValue(row.summaryDesc), 700),
		url: uuid ? `${EREPO_SUMMARY_BASE.replace("/summary", "")}/classification/${encodeURIComponent(uuid)}` : caId ? `https://reg.clinicalgenome.org/redmine/projects/registry/genboree_registry/by_caid?caid=${encodeURIComponent(caId)}` : undefined,
	};
}

function parseActionabilityValue(value: string): { context: "adult" | "both" | "pediatric"; gene: string } {
	const parts = value.split(/\s+/).filter(Boolean);
	const contextToken = parts.find((part) => /^(?:context=)?(?:adult|pediatric|both)$/i.test(part));
	const contextPart = contextToken?.replace(/^context=/i, "");
	const context = contextPart ? contextPart.toLowerCase() as "adult" | "both" | "pediatric" : "both";
	const gene = parts.filter((part) => part !== contextToken).join(" ").trim();
	return { context, gene: cleanQuery(gene || value) };
}

function parseQuery(query: string): ParsedQuery {
	const clean = cleanQuery(query);
	const match = clean.match(/^([a-z][a-z0-9_-]*)\s*:\s*(.+)$/i);
	if (!match) return { mode: "gene-summary", gene: clean };
	const key = match[1]!.toLowerCase().replace(/_/g, "-");
	const value = cleanQuery(match[2]!);
	if (key === "clingen-gene-validity") return { mode: "validity", gene: value };
	if (key === "clingen-dosage-sensitivity") {
		const includeRegions = /\binclude_?regions=(?:true|1|yes)\b/i.test(value);
		const gene = cleanQuery(value.replace(/\binclude_?regions=(?:true|false|1|0|yes|no)\b/ig, "").trim());
		return { mode: "dosage", gene, includeRegions };
	}
	if (key === "clingen-actionability") return { mode: "actionability", ...parseActionabilityValue(value) };
	if (key === "clingen-variant-classifications") {
		const caid = value.match(/\bcaid=([^\s]+)/i)?.[1];
		const hgvs = value.match(/\bhgvs=([^\s]+)/i)?.[1];
		const gene = value.match(/\bgene=([^\s]+)/i)?.[1];
		if (caid) return { mode: "classification", column: "caId", matchType: "exact", value: caid };
		if (hgvs) return { mode: "classification", column: "hgvs", matchType: "contains", value: hgvs };
		return { mode: "classification", column: "gene", matchType: "exact", value: gene ?? value };
	}
	if (key === "validity" || key === "gene-validity") return { mode: "validity", gene: value };
	if (key === "dosage" || key === "gene-dosage") return { mode: "dosage", gene: value, includeRegions: false };
	if (key === "region" || key === "dosage-region") return { mode: "dosage", gene: value, includeRegions: true };
	if (key === "actionability" || key === "clinical-actionability") return { mode: "actionability", ...parseActionabilityValue(value) };
	if (key === "caid" || key === "ca") return { mode: "classification", column: "caId", matchType: "exact", value };
	if (key === "cv" || key === "cvid" || key === "clinvar") return { mode: "classification", column: "cvId", matchType: "exact", value: value.replace(/^VCV/i, "") };
	if (key === "hgvs") return { mode: "classification", column: "hgvs", matchType: "contains", value };
	if (key === "classification" || key === "classifications" || key === "variant" || key === "variants" || key === "gene") {
		return { mode: "classification", column: "gene", matchType: "exact", value };
	}
	return { mode: "gene-summary", gene: clean };
}

async function searchValidity(gene: string, params: { limit: number; state: SourceAccumulator }): Promise<Record<string, unknown>> {
	const url = new URL(`${SEARCH_BASE}/api/validity`);
	const result = await requestJsonOptional(url, params.state, "ClinGen gene-disease validity");
	const payload = recordValue(result?.payload);
	const rows = arrayValue(payload.rows).map((row) => normalizeValidityRecord(recordValue(row)));
	const upper = gene.toUpperCase();
	const filtered = rows.filter((row) => stringValue(row.geneSymbol)?.toUpperCase() === upper);
	const totalCount = numberValue(payload.total);
	const records = filtered
		.sort((a, b) => `${stringValue(a.diseaseLabel) ?? ""}${stringValue(a.assertionId) ?? ""}`.localeCompare(`${stringValue(b.diseaseLabel) ?? ""}${stringValue(b.assertionId) ?? ""}`))
		.slice(0, params.limit);
	return {
		totalCount: filtered.length,
		tableTotalCount: totalCount,
		returned: records.length,
		truncated: filtered.length > records.length,
		records,
	};
}

async function searchDosage(gene: string, params: { includeRegions: boolean; limit: number; state: SourceAccumulator }): Promise<Record<string, unknown>> {
	const url = new URL(`${SEARCH_BASE}/api/dosage`);
	const result = await requestJsonOptional(url, params.state, "ClinGen dosage sensitivity");
	const payload = recordValue(result?.payload);
	const rows = arrayValue(payload.rows).map((row) => normalizeDosageRecord(recordValue(row)));
	const upper = gene.toUpperCase();
	const filtered = rows.filter((row) => {
		if (!params.includeRegions && stringValue(row.recordType) === "region") return false;
		return stringValue(row.symbol)?.toUpperCase() === upper || stringValue(row.id)?.toUpperCase() === upper;
	});
	const records = filtered
		.sort((a, b) => `${stringValue(a.recordType) ?? ""}${stringValue(a.symbol) ?? ""}${stringValue(a.id) ?? ""}`.localeCompare(`${stringValue(b.recordType) ?? ""}${stringValue(b.symbol) ?? ""}${stringValue(b.id) ?? ""}`))
		.slice(0, params.limit);
	return {
		totalCount: filtered.length,
		tableTotalCount: numberValue(payload.total),
		returned: records.length,
		truncated: filtered.length > records.length,
		records,
	};
}

async function searchActionability(gene: string, params: { context: "adult" | "both" | "pediatric"; limit: number; state: SourceAccumulator }): Promise<Record<string, unknown>> {
	const contexts = params.context === "both" ? ["Adult", "Pediatric"] : [params.context === "adult" ? "Adult" : "Pediatric"];
	const upper = gene.toUpperCase();
	const output: Record<string, unknown> = {};
	let total = 0;
	for (const context of contexts) {
		const url = new URL(`${ACTIONABILITY_BASE}/${context}/api/summ`);
		url.searchParams.set("flavor", "flat");
		url.searchParams.set("format", "json");
		const result = await requestJsonOptional(url, params.state, `ClinGen actionability ${context}`);
		const payload = recordValue(result?.payload);
		const columns = arrayValue(payload.columns).map(String);
		const records = arrayValue(payload.rows)
			.map((row) => normalizeActionabilityRecord(columns, arrayValue(row)))
			.filter((row) => arrayValue(row.genes).map(String).some((item) => item.toUpperCase() === upper))
			.sort((a, b) => `${stringValue(a.docId) ?? ""}${stringValue(a.outcome) ?? ""}${stringValue(a.intervention) ?? ""}`.localeCompare(`${stringValue(b.docId) ?? ""}${stringValue(b.outcome) ?? ""}${stringValue(b.intervention) ?? ""}`));
		total += records.length;
		output[context.toLowerCase()] = {
			totalCount: records.length,
			returned: Math.min(records.length, params.limit),
			truncated: records.length > params.limit,
			records: records.slice(0, params.limit),
		};
	}
	return {
		totalCount: total,
		...output,
	};
}

async function searchClassifications(parsed: Extract<ParsedQuery, { mode: "classification" }>, params: { limit: number; state: SourceAccumulator }): Promise<Record<string, unknown>> {
	const url = new URL(`${EREPO_SUMMARY_BASE}/classifications`);
	url.searchParams.set("columns", parsed.column);
	url.searchParams.set("values", parsed.value);
	url.searchParams.set("matchTypes", parsed.matchType);
	url.searchParams.set("pgSize", String(params.limit));
	url.searchParams.set("pg", "1");
	url.searchParams.set("matchMode", "and");
	const result = await requestJsonOptional(url, params.state, "ClinGen Evidence Repository classifications");
	const payload = recordValue(result?.payload);
	const records = arrayValue(payload.data).map((row) => normalizeClassificationRecord(recordValue(row)));
	return {
		totalCount: records.length,
		returned: records.length,
		results: records,
		uiUrl: erepoUiUrl(parsed.column, parsed.value, parsed.matchType),
	};
}

function provenance(state: SourceAccumulator): Record<string, unknown> {
	return {
		docs: DOCS,
		endpoints: state.endpoints,
	};
}

export async function searchClingen(params: ClingenSearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const parsed = parseQuery(query);
	const state: SourceAccumulator = { endpoints: [], warnings: [] };
	if (parsed.mode === "validity") {
		const validity = await searchValidity(parsed.gene, { limit, state });
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "clingen",
			query,
			searchMode: "gene-disease-validity",
			gene: parsed.gene,
			totalCount: numberValue(validity.totalCount),
			returned: numberValue(validity.returned),
			results: arrayValue(validity.records),
			...(state.warnings.length ? { warnings: state.warnings } : {}),
			provenance: provenance(state),
		};
	}
	if (parsed.mode === "dosage") {
		const dosage = await searchDosage(parsed.gene, { includeRegions: parsed.includeRegions, limit, state });
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "clingen",
			query,
			searchMode: "dosage-sensitivity",
			gene: parsed.gene,
			includeRegions: parsed.includeRegions,
			totalCount: numberValue(dosage.totalCount),
			returned: numberValue(dosage.returned),
			results: arrayValue(dosage.records),
			...(state.warnings.length ? { warnings: state.warnings } : {}),
			provenance: provenance(state),
		};
	}
	if (parsed.mode === "actionability") {
		const actionability = await searchActionability(parsed.gene, { context: parsed.context, limit, state });
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "clingen",
			query,
			searchMode: "clinical-actionability",
			gene: parsed.gene,
			context: parsed.context,
			...actionability,
			...(state.warnings.length ? { warnings: state.warnings } : {}),
			provenance: provenance(state),
		};
	}
	if (parsed.mode === "classification") {
		const classifications = await searchClassifications(parsed, { limit, state });
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "clingen",
			query,
			searchMode: "variant-classifications",
			classificationQuery: {
				column: parsed.column,
				matchType: parsed.matchType,
				value: parsed.value,
			},
			...classifications,
			...(state.warnings.length ? { warnings: state.warnings } : {}),
			provenance: provenance(state),
		};
	}
	const validity = await searchValidity(parsed.gene, { limit, state });
	const dosage = await searchDosage(parsed.gene, { includeRegions: false, limit, state });
	const actionability = await searchActionability(parsed.gene, { context: "both", limit, state });
	const classifications = await searchClassifications({ mode: "classification", column: "gene", matchType: "exact", value: parsed.gene }, { limit, state });
	const validityCount = numberValue(validity.totalCount) ?? 0;
	const dosageCount = numberValue(dosage.totalCount) ?? 0;
	const actionabilityCount = numberValue(actionability.totalCount) ?? 0;
	const classificationCount = numberValue(classifications.totalCount) ?? 0;
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "clingen",
		query,
		searchMode: "gene-summary",
		gene: parsed.gene,
		totalCount: validityCount + dosageCount + actionabilityCount + classificationCount,
		returned: 1,
		results: [{
			geneSymbol: parsed.gene,
			validity,
			dosage,
			actionability,
			classifications,
		}],
		...(state.warnings.length ? { warnings: state.warnings } : {}),
		provenance: provenance(state),
	};
}
