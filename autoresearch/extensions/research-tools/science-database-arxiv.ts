import { XMLParser } from "fast-xml-parser";

type SearchParams = {
	limit?: number;
	query: string;
	sort?: "pub_date" | "relevance";
};

const ARXIV_QUERY_URL = "https://export.arxiv.org/api/query";
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const MAX_ARXIV_EXACT_RESULTS = 100;
const REQUEST_TIMEOUT_MS = 25_000;

const xmlParser = new XMLParser({
	ignoreAttributes: false,
	removeNSPrefix: true,
});

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

async function fetchText(url: URL, accept: string): Promise<string> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			headers: { accept },
			signal: controller.signal,
		});
		if (!response.ok) {
			throw new Error(`Science database request failed: ${response.status} ${response.statusText}`);
		}
		return response.text();
	} finally {
		clearTimeout(timeout);
	}
}

function doiUrl(doi: string | undefined): string | undefined {
	return doi ? `https://doi.org/${doi}` : undefined;
}

function arxivArray(value: unknown): unknown[] {
	if (value === undefined || value === null) return [];
	return Array.isArray(value) ? value : [value];
}

function arxivAuthors(value: unknown): string[] {
	return arxivArray(value)
		.map((author) => stringValue(recordValue(author).name))
		.filter((name): name is string => Boolean(name))
		.slice(0, 8);
}

function arxivLinks(value: unknown): Array<Record<string, unknown>> {
	return arxivArray(value).map((link) => recordValue(link));
}

function parseToolKeyValueQuery(query: string): { flags: Record<string, string>; text: string } {
	const flags: Record<string, string> = {};
	const textParts: string[] = [];
	for (const part of query.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []) {
		const match = part.match(/^([a-z_]+)=(.+)$/i);
		if (match?.[1] && match[2] !== undefined) flags[match[1].toLowerCase()] = match[2].replace(/^"|"$/g, "");
		else textParts.push(part);
	}
	return { flags, text: textParts.join(" ").replace(/^"|"$/g, "").trim() };
}

function arxivExactCommand(query: string): { name: "arxiv_get_papers" | "arxiv_search"; rest: string } | undefined {
	const match = query.trim().match(/^(arxiv_(?:get_papers|search))(?::|\s+)?(.*)$/i);
	if (!match?.[1]) return undefined;
	return { name: match[1].toLowerCase() as "arxiv_get_papers" | "arxiv_search", rest: (match[2] ?? "").trim() };
}

function normalizeArxivId(raw: string): string | undefined {
	let clean = raw.trim();
	clean = clean.replace(/^https?:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf)\//i, "");
	clean = clean.replace(/^arxiv:/i, "");
	clean = clean.replace(/\.pdf$/i, "");
	return clean || undefined;
}

function arxivDateStamp(date: string, hhmm: string): string {
	const digits = date.replace(/-/g, "").trim();
	if (!/^\d{8}$/.test(digits)) throw new Error(`Bad arXiv date ${date}; pass YYYY-MM-DD.`);
	return `${digits}${hhmm}`;
}

function splitArxivVersion(id: string | undefined): { arxivId?: string; version?: number } {
	if (!id) return {};
	const match = id.match(/^(.*?)(?:v(\d+))?$/);
	return {
		arxivId: match?.[1] || id,
		version: match?.[2] ? Number(match[2]) : undefined,
	};
}

function parseArxivEntry(entry: Record<string, unknown>): Record<string, unknown> | undefined {
	const idUrl = stringValue(entry.id);
	if (!idUrl) return undefined;
	const idVersioned = idUrl.split("/abs/").pop() ?? idUrl.split("/").pop();
	const split = splitArxivVersion(idVersioned);
	const doi = stringValue(entry.doi);
	const pdfLink = arxivLinks(entry.link).find((link) => stringValue(link["@_title"]) === "pdf" || stringValue(link["@_type"]) === "application/pdf");
	return {
		arxiv_id: split.arxivId,
		version: split.version,
		id_versioned: idVersioned,
		title: stringValue(entry.title)?.replace(/\s+/g, " "),
		abstract: stringValue(entry.summary)?.replace(/\s+/g, " "),
		authors: arxivAuthors(entry.author),
		published: stringValue(entry.published),
		updated: stringValue(entry.updated),
		primary_category: stringValue(recordValue(entry.primary_category)["@_term"]),
		categories: arxivArray(entry.category).map((category) => stringValue(recordValue(category)["@_term"])).filter(Boolean),
		doi,
		journal_ref: stringValue(entry.journal_ref),
		comment: stringValue(entry.comment),
		abs_url: idUrl,
		pdf_url: stringValue(pdfLink?.["@_href"]),
		...(doiUrl(doi) ? { doi_url: doiUrl(doi) } : {}),
	};
}

function arxivFeedEntries(feed: Record<string, unknown>): Record<string, unknown>[] {
	const entries = arxivArray(feed.entry).map(recordValue);
	if (entries.length === 1 && stringValue(entries[0]?.id)?.includes("/api/errors")) {
		throw new Error(`arXiv API error: ${stringValue(entries[0]?.summary) ?? stringValue(entries[0]?.title) ?? "unknown error"}`);
	}
	return entries;
}

function paramsLimitFromQuery(query: string): number | undefined {
	const match = query.match(/\blimit=(\d+)/i);
	return match?.[1] ? Number(match[1]) : undefined;
}

async function searchArxivExact(query: string, command: { name: "arxiv_get_papers" | "arxiv_search"; rest: string }): Promise<Record<string, unknown>> {
	if (command.name === "arxiv_search") {
		const parsed = parseToolKeyValueQuery(command.rest);
		const clauses: string[] = [];
		if (parsed.text) clauses.push(/(?:\bAND\b|\bOR\b|\bANDNOT\b)/.test(parsed.text) ? `(${parsed.text})` : parsed.text);
		if (parsed.flags.category) clauses.push(`cat:${parsed.flags.category}`);
		if (parsed.flags.date_from || parsed.flags.date_to) {
			const lo = parsed.flags.date_from ? arxivDateStamp(parsed.flags.date_from, "0000") : "199101010000";
			const hi = parsed.flags.date_to ? arxivDateStamp(parsed.flags.date_to, "2359") : "299912312359";
			clauses.push(`submittedDate:[${lo} TO ${hi}]`);
		}
		if (!clauses.length) throw new Error("arxiv_search requires a query, category, or date range.");
		const maxResults = Math.max(1, Math.min(numberValue(parsed.flags.max_results) ?? paramsLimitFromQuery(command.rest) ?? DEFAULT_LIMIT, MAX_ARXIV_EXACT_RESULTS));
		const start = Math.max(0, numberValue(parsed.flags.start) ?? 0);
		const sortBy = parsed.flags.sort_by ?? "relevance";
		const sortOrder = parsed.flags.sort_order ?? "descending";
		if (!["relevance", "lastUpdatedDate", "submittedDate"].includes(sortBy)) throw new Error("arxiv_search sort_by must be relevance, lastUpdatedDate, or submittedDate.");
		if (!["ascending", "descending"].includes(sortOrder)) throw new Error("arxiv_search sort_order must be ascending or descending.");
		const searchQuery = clauses.join(" AND ");
		const url = new URL(ARXIV_QUERY_URL);
		url.search = new URLSearchParams({ search_query: searchQuery, start: String(start), max_results: String(maxResults), sortBy, sortOrder }).toString();
		const xml = await fetchText(url, "application/atom+xml, application/xml;q=0.9, text/xml;q=0.8");
		const feed = recordValue(xmlParser.parse(xml).feed);
		const rows = arxivFeedEntries(feed).flatMap((entry) => parseArxivEntry(entry) ?? []);
		const total = numberValue(feed.totalResults) ?? rows.length;
		const startIndex = numberValue(feed.startIndex) ?? start;
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "arxiv",
			query,
			mode: "arxiv_search",
			search_query: searchQuery,
			api_total: total,
			start_index: startIndex,
			n_records_returned: rows.length,
			records_truncated: startIndex + rows.length < total,
			sort_by: sortBy,
			sort_order: sortOrder,
			records: rows,
			results: rows,
			provenance: { docs: "https://info.arxiv.org/help/api/user-manual.html", endpoints: [url.toString()] },
		};
	}
	const parsed = parseToolKeyValueQuery(command.rest);
	const requested = (parsed.flags.ids ?? parsed.text).split(/[,\s]+/).map((id) => id.trim()).filter(Boolean).slice(0, MAX_ARXIV_EXACT_RESULTS);
	if (!requested.length) throw new Error("arxiv_get_papers requires at least one arXiv id.");
	const arxivIdPattern = /^(\d{4}\.\d{4,5}|[a-z][a-z-]*(\.[A-Za-z-]+)?\/\d{7})(v\d+)?$/;
	const ids: string[] = [];
	const notFound: string[] = [];
	for (const raw of requested) {
		const normalized = normalizeArxivId(raw);
		if (normalized && arxivIdPattern.test(normalized)) ids.push(normalized);
		else notFound.push(raw);
	}
	const rows: Record<string, unknown>[] = [];
	const duplicates: Array<Record<string, unknown>> = [];
	const endpoints: string[] = [];
	if (ids.length) {
		const url = new URL(ARXIV_QUERY_URL);
		url.search = new URLSearchParams({ id_list: ids.join(","), max_results: String(ids.length) }).toString();
		endpoints.push(url.toString());
		const xml = await fetchText(url, "application/atom+xml, application/xml;q=0.9, text/xml;q=0.8");
		const feed = recordValue(xmlParser.parse(xml).feed);
		const byId = new Map<string, Record<string, unknown>>();
		for (const row of arxivFeedEntries(feed).map(parseArxivEntry).filter((item): item is Record<string, unknown> => Boolean(item))) {
			if (row.arxiv_id) byId.set(String(row.arxiv_id), row);
			if (row.id_versioned) byId.set(String(row.id_versioned), row);
		}
		const seen = new Map<Record<string, unknown>, string>();
		for (const id of ids) {
			const bare = id.replace(/v\d+$/i, "");
			const row = byId.get(id) ?? byId.get(bare);
			if (!row) notFound.push(id);
			else if (seen.has(row)) duplicates.push({ requested: id, resolved_as: seen.get(row) });
			else {
				seen.set(row, id);
				rows.push(row);
			}
		}
	}
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "arxiv",
		query,
		mode: "arxiv_get_papers",
		n_requested: requested.length,
		n_found: rows.length,
		duplicates,
		not_found: notFound,
		records: rows,
		results: rows,
		provenance: { docs: "https://info.arxiv.org/help/api/user-manual.html", endpoints },
	};
}

export async function searchArxiv(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const exact = arxivExactCommand(query);
	if (exact) return searchArxivExact(query, exact);
	const limit = safeLimit(params.limit);
	const url = new URL(ARXIV_QUERY_URL);
	url.search = new URLSearchParams({
		search_query: `all:${query}`,
		start: "0",
		max_results: String(limit),
		...(params.sort === "pub_date" ? { sortBy: "submittedDate", sortOrder: "descending" } : {}),
	}).toString();
	const xml = await fetchText(url, "application/atom+xml, application/xml;q=0.9, text/xml;q=0.8");
	const feed = recordValue(xmlParser.parse(xml).feed);
	const results = arxivArray(feed.entry).flatMap((entry) => {
		const record = recordValue(entry);
		const idUrl = stringValue(record.id);
		if (!idUrl) return [];
		const arxivId = idUrl.split("/abs/").pop() ?? idUrl.split("/").pop();
		const doi = stringValue(record.doi);
		const pdfLink = arxivLinks(record.link).find((link) => stringValue(link["@_title"]) === "pdf" || stringValue(link["@_type"]) === "application/pdf");
		return [{
			arxivId,
			title: stringValue(record.title)?.replace(/\s+/g, " "),
			summary: stringValue(record.summary)?.replace(/\s+/g, " "),
			authors: arxivAuthors(record.author),
			published: stringValue(record.published),
			updated: stringValue(record.updated),
			primaryCategory: stringValue(recordValue(record.primary_category)["@_term"]),
			categories: arxivArray(record.category).map((category) => stringValue(recordValue(category)["@_term"])).filter(Boolean),
			doi,
			journalRef: stringValue(record.journal_ref),
			url: idUrl,
			pdfUrl: stringValue(pdfLink?.["@_href"]),
			...(doiUrl(doi) ? { doiUrl: doiUrl(doi) } : {}),
		}];
	});
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "arxiv",
		query,
		totalCount: numberValue(feed.totalResults) ?? results.length,
		returned: results.length,
		results,
		provenance: { docs: "https://info.arxiv.org/help/api/user-manual.html", endpoints: [url.toString()] },
	};
}
