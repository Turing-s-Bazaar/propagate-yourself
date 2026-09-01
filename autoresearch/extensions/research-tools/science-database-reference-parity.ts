import { searchChemistryReferenceScienceDatabase } from "./science-database-chemistry-reference.js";
import { searchRfamExact } from "./science-database-rfam-exact.js";

export type ReferenceParityScienceDatabaseSource = "bindingdb" | "kegg" | "pubchem" | "rfam" | "rhea" | "string";

type SearchParams = { limit?: number; query: string; source: ReferenceParityScienceDatabaseSource };

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 25_000;
const STRING_BASE = "https://version-12-0.string-db.org/api";
const KEGG_BASE = "https://rest.kegg.jp";
const RFAM_BASE = "https://rfam.org";

const REFERENCE_PARITY_SOURCES = new Set<ReferenceParityScienceDatabaseSource>(["bindingdb", "kegg", "pubchem", "rfam", "rhea", "string"]);

export function isReferenceParityScienceDatabaseSource(source: string): source is ReferenceParityScienceDatabaseSource {
	return REFERENCE_PARITY_SOURCES.has(source as ReferenceParityScienceDatabaseSource);
}

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

async function responseFor(url: URL, init?: RequestInit): Promise<Response> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			...init,
			signal: controller.signal,
		});
		if (!response.ok) throw new Error(`Science database request failed: ${response.status} ${response.statusText}`);
		return response;
	} finally {
		clearTimeout(timeout);
	}
}

async function fetchJson(url: URL, init?: RequestInit): Promise<unknown> {
	const response = await responseFor(url, {
		...init,
		headers: {
			accept: "application/json",
			...(init?.headers ?? {}),
		},
	});
	return response.json();
}

async function fetchJsonOrUndefined(url: URL, init?: RequestInit): Promise<unknown | undefined> {
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
		if (response.status === 404) return undefined;
		if (!response.ok) throw new Error(`Science database request failed: ${response.status} ${response.statusText}`);
		return response.json();
	} finally {
		clearTimeout(timeout);
	}
}

async function fetchText(url: URL, init?: RequestInit): Promise<string> {
	const response = await responseFor(url, {
		...init,
		headers: {
			accept: "text/plain, text/tab-separated-values;q=0.9, */*;q=0.5",
			...(init?.headers ?? {}),
		},
	});
	return response.text();
}

function formBody(values: Record<string, string>): URLSearchParams {
	const body = new URLSearchParams();
	for (const [key, value] of Object.entries(values)) body.set(key, value);
	return body;
}

async function postFormJson(url: URL, values: Record<string, string>): Promise<unknown> {
	return fetchJson(url, {
		body: formBody(values),
		headers: { "content-type": "application/x-www-form-urlencoded" },
		method: "POST",
	});
}

async function postFormText(url: URL, values: Record<string, string>): Promise<string> {
	return fetchText(url, {
		body: formBody(values),
		headers: { "content-type": "application/x-www-form-urlencoded" },
		method: "POST",
	});
}

function splitTerms(value: string): string[] {
	return value
		.split(/[\n\r,;]+|\s{2,}/)
		.map((item) => item.trim())
		.filter(Boolean);
}

function parsedTableRows(text: string): Array<Record<string, string>> {
	const lines = text.split(/\r?\n/).filter((line) => line.trim());
	const header = lines.shift()?.split("\t") ?? [];
	if (!header.length) return [];
	return lines.map((line) => {
		const cells = line.split("\t");
		const row: Record<string, string> = {};
		header.forEach((key, index) => {
			row[key] = cells[index]?.trim() ?? "";
		});
		return row;
	});
}

function normalizedKey(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function tableCell(row: Record<string, string>, candidates: string[]): string | undefined {
	for (const candidate of candidates) {
		const direct = stringValue(row[candidate]);
		if (direct) return direct;
	}
	const wanted = new Set(candidates.map(normalizedKey));
	for (const [key, value] of Object.entries(row)) {
		if (wanted.has(normalizedKey(key))) return stringValue(value);
	}
	return undefined;
}

function stringParam(query: string, name: string): string | undefined {
	return query.match(new RegExp(`\\b${name}\\s*[:=]\\s*([^\\s,;]+)`, "i"))?.[1];
}

function parseStringQuery(query: string): { identifiers: string[]; requiredScore: string; species: string } {
	const species = stringParam(query, "species") ?? "9606";
	const requiredScore = stringParam(query, "required_score") ?? stringParam(query, "score") ?? "700";
	const identifiersText = query
		.replace(/\bspecies\s*[:=]\s*\S+/gi, " ")
		.replace(/\brequired_score\s*[:=]\s*\S+/gi, " ")
		.replace(/\bscore\s*[:=]\s*\S+/gi, " ");
	const identifiers = identifiersText.split(/[\s,;\r\n]+/).map((item) => item.trim()).filter(Boolean);
	if (!identifiers.length) throw new Error("STRING search requires at least one gene or protein identifier.");
	return { identifiers, requiredScore, species };
}

function normalizeStringNetworkRow(row: Record<string, string>): Record<string, unknown> {
	return {
		stringIdA: tableCell(row, ["stringId_A"]),
		stringIdB: tableCell(row, ["stringId_B"]),
		preferredNameA: tableCell(row, ["preferredName_A"]),
		preferredNameB: tableCell(row, ["preferredName_B"]),
		taxonId: numberValue(tableCell(row, ["ncbiTaxonId"])),
		score: numberValue(tableCell(row, ["score"])),
		neighborhoodScore: numberValue(tableCell(row, ["nscore"])),
		fusionScore: numberValue(tableCell(row, ["fscore"])),
		cooccurenceScore: numberValue(tableCell(row, ["pscore"])),
		coexpressionScore: numberValue(tableCell(row, ["ascore"])),
		experimentalScore: numberValue(tableCell(row, ["escore"])),
		databaseScore: numberValue(tableCell(row, ["dscore"])),
		textMiningScore: numberValue(tableCell(row, ["tscore"])),
	};
}

async function searchString(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const parsed = parseStringQuery(query);
	const mapUrl = new URL(`${STRING_BASE}/json/get_string_ids`);
	const mappedPayload = arrayValue(await postFormJson(mapUrl, {
		caller_identity: "feynman",
		echo_query: "1",
		identifiers: parsed.identifiers.join("\r"),
		limit: "1",
		species: parsed.species,
	}));
	const mapped = mappedPayload.map((item) => recordValue(item));
	const stringIds = mapped.map((item) => stringValue(item.stringId)).filter((id): id is string => Boolean(id));
	const endpoints = [mapUrl.toString()];
	let rows: Array<Record<string, string>> = [];
	if (stringIds.length) {
		const networkUrl = new URL(`${STRING_BASE}/tsv/network`);
		endpoints.push(networkUrl.toString());
		const tsv = await postFormText(networkUrl, {
			caller_identity: "feynman",
			identifiers: stringIds.join("\r"),
			required_score: parsed.requiredScore,
			species: parsed.species,
		});
		rows = parsedTableRows(tsv);
	}
	const results = rows.slice(0, limit).map(normalizeStringNetworkRow);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "string",
		query,
		species: parsed.species,
		requiredScore: numberValue(parsed.requiredScore),
		mappedIdentifiers: mapped.map((item) => ({
			queryItem: stringValue(item.queryItem),
			stringId: stringValue(item.stringId),
			preferredName: stringValue(item.preferredName),
			annotation: stringValue(item.annotation),
			taxonId: numberValue(item.ncbiTaxonId),
		})),
		totalCount: rows.length,
		returned: results.length,
		results,
		provenance: {
			docs: "https://string-db.org/help/api/",
			endpoints,
		},
	};
}

type KeggQuery = {
	database?: string;
	exactGeneSymbol?: boolean;
	ids?: string[];
	includeRaw?: boolean;
	mode: "conv" | "find" | "get" | "link";
	namedMode?: string;
	targetDb?: string;
	term?: string;
};

function parseBool(value: string | undefined, fallback = false): boolean {
	if (!value) return fallback;
	return /^(?:1|true|yes|y)$/i.test(value);
}

function queryParamMap(text: string): Record<string, string> {
	const params: Record<string, string> = {};
	for (const match of text.matchAll(/\b([a-z][a-z0-9_-]*)\s*=\s*("[^"]+"|'[^']+'|[^\s;]+)/gi)) {
		const key = match[1]?.toLowerCase();
		const raw = match[2]?.trim();
		if (!key || !raw) continue;
		params[key] = raw.replace(/^["']|["']$/g, "");
	}
	return params;
}

function stripQueryParams(text: string): string {
	return text.replace(/\b[a-z][a-z0-9_-]*\s*=\s*("[^"]+"|'[^']+'|[^\s;]+)/gi, " ").trim();
}

function parseKeggQuery(query: string): KeggQuery {
	const getNamed = query.match(/^get_kegg_entries\s*:?\s*(.*)$/i);
	if (getNamed) {
		const rest = getNamed[1] ?? "";
		const params = queryParamMap(rest);
		return {
			ids: splitTerms(stripQueryParams(rest)).flatMap((item) => item.split(/[+\s]+/)).filter(Boolean),
			includeRaw: parseBool(params.include_raw),
			mode: "get",
			namedMode: "get-kegg-entries",
		};
	}
	const searchNamed = query.match(/^search_kegg\s*:?\s*(.*)$/i);
	if (searchNamed) {
		const rest = searchNamed[1] ?? "";
		const params = queryParamMap(rest);
		return {
			database: (params.database ?? "hsa").toLowerCase(),
			exactGeneSymbol: parseBool(params.exact_gene_symbol),
			mode: "find",
			namedMode: "search-kegg",
			term: stripQueryParams(rest),
		};
	}
	const linkNamed = query.match(/^link_kegg_ids\s*:?\s*(.*)$/i);
	if (linkNamed) {
		const rest = linkNamed[1] ?? "";
		const params = queryParamMap(rest);
		const operation = params.operation?.toLowerCase() === "conv" ? "conv" : "link";
		return {
			ids: splitTerms(stripQueryParams(rest)).flatMap((item) => item.split(/[+\s]+/)).filter(Boolean),
			mode: operation,
			namedMode: "link-kegg-ids",
			targetDb: (params.target_db ?? params.target ?? params.database ?? "").toLowerCase(),
		};
	}
	const link = query.match(/^link:([a-z0-9_-]+)\s+(.+)$/i);
	if (link?.[1] && link[2]) return { ids: splitTerms(link[2]).flatMap((item) => item.split(/[+\s]+/)).filter(Boolean), mode: "link", targetDb: link[1].toLowerCase() };
	const conv = query.match(/^conv:([a-z0-9_-]+)\s+(.+)$/i);
	if (conv?.[1] && conv[2]) return { ids: splitTerms(conv[2]).flatMap((item) => item.split(/[+\s]+/)).filter(Boolean), mode: "conv", targetDb: conv[1].toLowerCase() };
	const find = query.match(/^find:([a-z0-9_]+)\s+(.+)$/i);
	if (find?.[1] && find[2]) return { database: find[1].toLowerCase(), mode: "find", term: find[2].trim() };
	const get = query.match(/^get:\s*(.+)$/i);
	if (get?.[1]) return { ids: splitTerms(get[1]).flatMap((item) => item.split(/\s+/)).filter(Boolean), mode: "get" };
	if (/^(?:[a-z]{2,4}:\d+|[CDKRG]\d{5})(?:[\s,;+].*)?$/i.test(query)) return { ids: splitTerms(query).flatMap((item) => item.split(/[+\s]+/)).filter(Boolean), mode: "get" };
	return { database: "compound", mode: "find", term: query };
}

function keggSplitPrefix(keggId: string): { database?: string; localId: string } {
	if (!keggId.includes(":")) return { localId: keggId };
	const [database, localId] = keggId.split(":", 2);
	return { database, localId: localId ?? "" };
}

function normalizeKeggQueryId(returnedId: string, queryIds: string[]): string {
	if (queryIds.includes(returnedId)) return returnedId;
	const returnedLocal = keggSplitPrefix(returnedId).localId;
	return queryIds.find((id) => id === returnedLocal || keggSplitPrefix(id).localId === returnedLocal) ?? returnedId;
}

function parseKeggTwoColumn(text: string): Array<{ left: string; right: string }> {
	return text.split(/\r?\n/).flatMap((line) => {
		if (!line.trim()) return [];
		const parts = line.split("\t");
		if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error(`Unexpected KEGG mapping row: ${line}`);
		return [{ left: parts[0].trim(), right: parts[1].trim() }];
	});
}

function keggBatches(ids: string[], size = 10): string[][] {
	const seen = new Set<string>();
	const ordered = ids.filter((id) => {
		if (seen.has(id)) return false;
		seen.add(id);
		return true;
	});
	const batches: string[][] = [];
	for (let index = 0; index < ordered.length; index += size) batches.push(ordered.slice(index, index + size));
	return batches;
}

function keggMappingUrl(operation: "conv" | "link", targetDb: string, ids: string[]): URL {
	return new URL(`${KEGG_BASE}/${operation}/${encodeURIComponent(targetDb)}/${ids.map((id) => encodeURIComponent(id).replace(/%3A/gi, ":")).join("+")}`);
}

function normalizeKeggMappingRows(text: string, queryIds: string[], operation: "conv" | "link", targetDb: string, batchIndex: number, requestIndex: number): Array<Record<string, unknown>> {
	const queryOrder = new Map(queryIds.map((id, index) => [id, index]));
	return parseKeggTwoColumn(text).map(({ left, right }) => {
		const sourceId = normalizeKeggQueryId(left, queryIds);
		const sourceParts = keggSplitPrefix(sourceId);
		const targetParts = keggSplitPrefix(right);
		return {
			sourceId,
			sourceDb: sourceParts.database,
			targetId: right,
			targetDb: targetParts.database ?? targetDb,
			operation,
			batchIndex,
			requestIndex,
			url: `https://www.kegg.jp/entry/${encodeURIComponent(right)}`,
			sourceUrl: `https://www.kegg.jp/entry/${encodeURIComponent(sourceId)}`,
		};
	}).sort((a, b) => {
		const leftOrder = queryOrder.get(String(a.sourceId)) ?? queryOrder.size;
		const rightOrder = queryOrder.get(String(b.sourceId)) ?? queryOrder.size;
		return leftOrder - rightOrder || String(a.targetId).localeCompare(String(b.targetId));
	});
}

function parseKeggFind(text: string): Array<Record<string, unknown>> {
	return text.split(/\r?\n/).flatMap((line) => {
		const [id, description] = line.split("\t");
		if (!id) return [];
		return [{
			entryId: id.trim(),
			description: description?.trim(),
			url: `https://www.kegg.jp/entry/${encodeURIComponent(id.trim())}`,
		}];
	});
}

function parseKeggGet(text: string, includeRaw = false): Array<Record<string, unknown>> {
	return text.split(/\n\/\/\/\s*/).flatMap((entry) => {
		const fields: Record<string, string[]> = {};
		let current = "";
		for (const line of entry.split(/\r?\n/)) {
			if (!line.trim()) continue;
			const field = line.slice(0, 12).trim();
			const value = line.slice(12).trim();
			if (field) current = field;
			if (!current || !value) continue;
			fields[current] = fields[current] ?? [];
			fields[current]!.push(value);
		}
		const entryValue = fields.ENTRY?.[0];
		const entryId = entryValue?.split(/\s+/)[0];
		if (!entryId) return [];
		return [{
			entryId,
			name: fields.NAME?.join(" ").replace(/;\s*$/, ""),
			definition: fields.DEFINITION?.join(" "),
			organism: fields.ORGANISM?.join(" "),
			pathways: (fields.PATHWAY ?? []).slice(0, 8),
			dblinks: (fields.DBLINKS ?? []).slice(0, 12),
			rawFields: fields,
			...(includeRaw ? { raw: entry.trim() } : {}),
			url: `https://www.kegg.jp/entry/${encodeURIComponent(entryId)}`,
		}];
	});
}

function isExactKeggSymbol(record: Record<string, unknown>, symbol: string): boolean {
	const description = String(record.description ?? "");
	const aliases = description.split(";")[0]?.split(",").map((part) => part.trim().toLowerCase()) ?? [];
	return aliases.includes(symbol.trim().toLowerCase());
}

async function searchKegg(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const parsed = parseKeggQuery(query);
	if (parsed.mode === "link" || parsed.mode === "conv") {
		const ids = parsed.ids ?? [];
		if (!ids.length || !parsed.targetDb) throw new Error(`KEGG ${parsed.mode} requires a target database and at least one identifier.`);
		const batches = keggBatches(ids);
		const endpoints: string[] = [];
		const records: Array<Record<string, unknown>> = [];
		const hitIds = new Set<string>();
		for (const [batchIndex, batch] of batches.entries()) {
			const url = keggMappingUrl(parsed.mode, parsed.targetDb, batch);
			endpoints.push(url.toString());
			const text = await fetchText(url);
			const rows = normalizeKeggMappingRows(text, batch, parsed.mode, parsed.targetDb, batchIndex, endpoints.length - 1);
			rows.forEach((row) => hitIds.add(String(row.sourceId)));
			records.push(...rows);
		}
		const missingIds = ids.filter((id, index) => ids.indexOf(id) === index && !hitIds.has(id));
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "kegg",
			query,
			searchMode: parsed.namedMode ?? parsed.mode,
			targetDb: parsed.targetDb,
			operation: parsed.mode,
			totalCount: records.length,
			returned: Math.min(records.length, limit),
			missingIds,
			requestLimit: 10,
			results: records.slice(0, limit),
			provenance: {
				docs: ["https://www.kegg.jp/kegg/rest/keggapi.html", "https://www.kegg.jp/kegg/api.html"],
				endpoints,
			},
		};
	}
	const url = parsed.mode === "find"
		? new URL(`${KEGG_BASE}/find/${encodeURIComponent(parsed.database ?? "compound")}/${encodeURIComponent(parsed.term ?? query)}`)
		: new URL(`${KEGG_BASE}/get/${(parsed.ids ?? []).slice(0, Math.min(limit, 10)).map(encodeURIComponent).join("+")}`);
	const text = await fetchText(url);
	const records = parsed.mode === "find"
		? parseKeggFind(text).filter((record) => parsed.exactGeneSymbol ? isExactKeggSymbol(record, parsed.term ?? query) : true)
		: parseKeggGet(text, parsed.includeRaw);
	const results = records.slice(0, limit);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "kegg",
		query,
		searchMode: parsed.namedMode ?? parsed.mode,
		database: parsed.database,
		exactGeneSymbol: parsed.exactGeneSymbol,
		totalCount: records.length,
		returned: results.length,
		results,
		provenance: {
			docs: "https://www.kegg.jp/kegg/rest/keggapi.html",
			endpoints: [url.toString()],
		},
	};
}

function rfamField(record: Record<string, unknown>, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = stringValue(record[key]);
		if (value) return value;
	}
	return undefined;
}

function normalizeRfamFamily(query: string, payload: Record<string, unknown>): Record<string, unknown> {
	const rfam = recordValue(payload.rfam);
	const accession = rfamField(rfam, ["acc", "rfam_acc", "accession"]) ?? query;
	const familyId = rfamField(rfam, ["id", "rfam_id"]);
	return {
		accession,
		id: familyId,
		description: rfamField(rfam, ["description", "comment"]),
		clan: rfamField(recordValue(rfam.clan), ["id", "clan_acc", "acc"]) ?? rfamField(rfam, ["clan"]),
		type: rfamField(rfam, ["type"]),
		seedCount: numberValue(rfam.num_seed),
		fullCount: numberValue(rfam.num_full),
		author: rfamField(rfam, ["author"]),
		gatheringCutoff: numberValue(rfam.gathering_cutoff),
		url: `https://rfam.org/family/${encodeURIComponent(accession || familyId || query)}`,
	};
}

async function searchRfam(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query).replace(/^family:\s*/i, "");
	const limit = safeLimit(params.limit);
	const url = new URL(`${RFAM_BASE}/family/${encodeURIComponent(query)}`);
	url.searchParams.set("content-type", "application/json");
	const payload = recordValue(await fetchJsonOrUndefined(url));
	const results = Object.keys(payload).length ? [normalizeRfamFamily(query, payload)] : [];
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "rfam",
		query,
		totalCount: results.length,
		returned: results.slice(0, limit).length,
		results: results.slice(0, limit),
		provenance: {
			docs: "https://docs.rfam.org/en/latest/api.html",
			endpoints: [url.toString()],
		},
	};
}

export async function searchReferenceParityScienceDatabase(params: SearchParams): Promise<Record<string, unknown>> {
	if (params.source === "bindingdb" || params.source === "pubchem" || params.source === "rhea") {
		return searchChemistryReferenceScienceDatabase({ limit: params.limit, query: params.query, source: params.source });
	}
	if (params.source === "kegg") return searchKegg(params);
	if (params.source === "rfam") {
		const exact = await searchRfamExact(params);
		if (exact) return exact;
		return searchRfam(params);
	}
	return searchString(params);
}
