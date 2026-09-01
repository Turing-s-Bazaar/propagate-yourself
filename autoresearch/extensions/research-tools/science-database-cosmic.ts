type CosmicSearchParams = { limit?: number; query: string };

const COSMIC_SEARCH_URL = "https://clinicaltables.nlm.nih.gov/api/cosmic/v4/search";
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 25_000;
const DOCS = [
	"https://clinicaltables.nlm.nih.gov/apidoc/cosmic/v4/doc.html",
	"https://www.cosmickb.org/licensing/",
];
const DISPLAY_FIELDS = ["MutationID", "GeneName", "MutationCDS", "MutationAA"];
const EXTRA_FIELDS = [
	"AccessionNumber",
	"GeneName",
	"HGNC_ID",
	"MutationAA",
	"MutationCDS",
	"MutationDescription",
	"MutationGenomePosition",
	"MutationID",
	"LegacyMutationID",
	"GenomicMutationID",
	"PrimaryHistology",
	"PrimarySite",
	"PubmedPMID",
	"GRChVer",
	"COSMIC_GENE_ID",
	"COSMIC_PHENOTYPE_ID",
];

type ParsedQuery = {
	grchv: "37" | "38";
	q?: string;
	terms: string;
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

function safeLimit(value: number | undefined): number {
	if (!Number.isFinite(value) || value === undefined) return DEFAULT_LIMIT;
	return Math.max(1, Math.min(Math.floor(value), MAX_LIMIT));
}

function cleanQuery(query: string): string {
	const clean = query.trim();
	if (!clean) throw new Error("COSMIC search requires a non-empty query.");
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

function parseQuery(query: string): ParsedQuery {
	let clean = cleanQuery(query);
	let grchv: "37" | "38" = "37";
	const buildMatch = clean.match(/^grch(37|38)\s*:\s*(.+)$/i);
	if (buildMatch) {
		grchv = buildMatch[1] as "37" | "38";
		clean = cleanQuery(buildMatch[2]!);
	}
	const qMatch = clean.match(/^(.+?)\s+q=(.+)$/i);
	if (qMatch) return { grchv, terms: cleanQuery(qMatch[1]!), q: cleanQuery(qMatch[2]!) };
	return { grchv, terms: clean };
}

async function fetchCosmic(parsed: ParsedQuery, limit: number): Promise<{ endpoint: string; payload: unknown }> {
	const url = new URL(COSMIC_SEARCH_URL);
	url.searchParams.set("terms", parsed.terms);
	url.searchParams.set("maxList", String(limit));
	url.searchParams.set("df", DISPLAY_FIELDS.join(","));
	url.searchParams.set("ef", EXTRA_FIELDS.join(","));
	url.searchParams.set("grchv", parsed.grchv);
	if (parsed.q) url.searchParams.set("q", parsed.q);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			headers: { accept: "application/json" },
			signal: controller.signal,
		});
		if (!response.ok) {
			const body = await response.text().catch(() => "");
			throw new Error(`NLM COSMIC request failed: ${response.status} ${response.statusText}${body ? ` ${body.slice(0, 180)}` : ""}`);
		}
		return { endpoint: url.toString(), payload: await response.json() };
	} finally {
		clearTimeout(timeout);
	}
}

function fieldAt(extras: Record<string, unknown>, field: string, index: number): string | undefined {
	const values = arrayValue(extras[field]);
	return stringValue(values[index]);
}

function splitIds(value: string | undefined): string[] {
	return value
		?.split(/[;,]/)
		.map((item) => item.trim())
		.filter(Boolean) ?? [];
}

function normalizeCosmicRecord(code: string, display: unknown, extras: Record<string, unknown>, index: number): Record<string, unknown> {
	const displayValues = arrayValue(display).map((item) => stringValue(item));
	const mutationId = fieldAt(extras, "MutationID", index) ?? stringValue(code) ?? displayValues[0];
	const geneName = fieldAt(extras, "GeneName", index) ?? displayValues[1];
	const pubmedId = fieldAt(extras, "PubmedPMID", index);
	const pubmedIds = splitIds(pubmedId);
	return compactRecord({
		mutationId,
		legacyMutationId: fieldAt(extras, "LegacyMutationID", index),
		genomicMutationId: fieldAt(extras, "GenomicMutationID", index),
		geneName,
		hgncId: fieldAt(extras, "HGNC_ID", index),
		cosmicGeneId: fieldAt(extras, "COSMIC_GENE_ID", index),
		cosmicPhenotypeId: fieldAt(extras, "COSMIC_PHENOTYPE_ID", index),
		transcript: fieldAt(extras, "AccessionNumber", index),
		mutationCds: fieldAt(extras, "MutationCDS", index) ?? displayValues[2],
		mutationAa: fieldAt(extras, "MutationAA", index) ?? displayValues[3],
		mutationDescription: fieldAt(extras, "MutationDescription", index),
		genomePosition: fieldAt(extras, "MutationGenomePosition", index),
		grchVersion: fieldAt(extras, "GRChVer", index),
		primarySite: fieldAt(extras, "PrimarySite", index),
		primaryHistology: fieldAt(extras, "PrimaryHistology", index),
		pubmedIds,
		pubmedUrls: pubmedIds.map((id) => `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(id)}/`),
		sourceUrl: mutationId ? `https://cancer.sanger.ac.uk/cosmic/mutation/overview?id=${encodeURIComponent(mutationId)}` : undefined,
	});
}

export async function searchCosmic(params: CosmicSearchParams): Promise<Record<string, unknown>> {
	const parsed = parseQuery(params.query);
	const limit = safeLimit(params.limit);
	const result = await fetchCosmic(parsed, limit);
	const payload = arrayValue(result.payload);
	const totalCount = numberValue(payload[0]) ?? 0;
	const codes = arrayValue(payload[1]).map(String);
	const extras = recordValue(payload[2]);
	const displayRows = arrayValue(payload[3]);
	const results = codes.map((code, index) => normalizeCosmicRecord(code, displayRows[index], extras, index));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "cosmic",
		query: params.query,
		searchMode: parsed.q ? "terms-plus-query" : "terms",
		grchVersion: parsed.grchv,
		totalCount,
		returned: results.length,
		results,
		warnings: [
			"NLM Clinical Tables exposes COSMIC mutation autocomplete/search records only; source COSMIC downloads require a registered COSMIC account and the NLM route does not support pagination.",
		],
		provenance: {
			docs: DOCS,
			endpoints: [result.endpoint],
		},
	};
}
