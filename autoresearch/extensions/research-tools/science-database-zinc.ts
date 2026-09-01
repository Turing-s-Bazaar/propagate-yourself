export type ZincScienceDatabaseSource = "zinc";

type SearchParams = { limit?: number; query: string; source: ZincScienceDatabaseSource };
type ZincSearchMode = "id" | "smiles" | "supplier" | "random" | "3d";

const CARTBLANCHE_BASE = "https://cartblanche22.docking.org";
const ZINC_FILES_BASE = "https://files.docking.org/zinc22";
const DEFAULT_OUTPUT_FIELDS = "zinc_id,smiles,tranche_name,catalogs";
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const MAX_IDS_PER_CALL = 100;
const MAX_IDS_3D = 50;
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_RESPONSE_BYTES = 50 * 1024 * 1024;
const POLL_INTERVAL_MS = 1_500;
const TRANSIENT_STATUS = new Set([429, 502, 503, 504]);
const ZINC_ID_RE = /^ZINC[a-zA-Z]?\d+$/i;
const TRANCHE_RE = /^H(\d{2})([PM])(\d{3})$/;
const KNOWN_SUBSETS = ["fragment", "lead-like", "drug-like", "lugs"] as const;
const DOCS = [
	"https://wiki.docking.org/index.php/Zinc22:Searching",
	"https://cartblanche22.docking.org/search/zincid",
	"https://cartblanche22.docking.org/search/smiles",
	"https://cartblanche22.docking.org/search/catitems",
	"https://cartblanche22.docking.org/search/random",
];

export function isZincScienceDatabaseSource(source: string): source is ZincScienceDatabaseSource {
	return source === "zinc";
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
	if (!clean) throw new Error("ZINC search requires a non-empty query.");
	return clean;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function endpointUrl(endpoint: string): string {
	return `${CARTBLANCHE_BASE}/${endpoint}`;
}

function resultUrl(task: string): string {
	return `${CARTBLANCHE_BASE}/search/result/${encodeURIComponent(task)}`;
}

function bodyExcerpt(text: string): string {
	return text.trim().replace(/\s+/g, " ").slice(0, 240) || "<empty body>";
}

function looksLikeHtml(text: string): boolean {
	const head = text.trimStart().slice(0, 300).toLowerCase();
	return head.startsWith("<!doctype") || head.startsWith("<html");
}

async function fetchWithDeadline(url: string, init: RequestInit, deadline: number): Promise<Response> {
	const remaining = Math.max(1_000, Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now()));
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), remaining);
	try {
		return await fetch(url, {
			...init,
			headers: {
				"user-agent": "feynman-bio-tools-zinc/0.1",
				...(init.headers ?? {}),
			},
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timeout);
	}
}

async function readTextCapped(response: Response): Promise<string> {
	const declared = Number(response.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
		throw new Error(`ZINC response exceeded ${MAX_RESPONSE_BYTES} bytes before parsing; narrow the query.`);
	}
	if (!response.body) return response.text();
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		total += value.byteLength;
		if (total > MAX_RESPONSE_BYTES) {
			await reader.cancel();
			throw new Error(`ZINC response exceeded ${MAX_RESPONSE_BYTES} bytes; narrow the query.`);
		}
		chunks.push(value);
	}
	const merged = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(merged);
}

async function submitCartBlanche(endpoint: string, fields: Record<string, string | number>, deadline: number): Promise<string> {
	const url = endpointUrl(endpoint);
	const form = new URLSearchParams();
	for (const [key, value] of Object.entries(fields)) form.set(key, String(value));
	let lastError = "no submit attempt completed";
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const response = await fetchWithDeadline(url, {
			method: "POST",
			headers: {
				accept: "application/json",
				"content-type": "application/x-www-form-urlencoded",
			},
			body: form,
		}, deadline);
		const text = await response.text();
		if (response.status === 400) {
			throw new Error(`CartBlanche22 rejected ${endpoint} parameters: ${bodyExcerpt(text)}`);
		}
		if (TRANSIENT_STATUS.has(response.status)) {
			lastError = `HTTP ${response.status} from ${endpoint}`;
			if (attempt < 2 && Date.now() < deadline) {
				await delay(Math.min(2_000 * (attempt + 1), Math.max(0, deadline - Date.now())));
				continue;
			}
			break;
		}
		if (!response.ok) throw new Error(`CartBlanche22 ${endpoint} returned HTTP ${response.status}: ${bodyExcerpt(text)}`);
		if (looksLikeHtml(text)) throw new Error(`CartBlanche22 returned HTML instead of a task receipt for ${endpoint}.`);
		const payload = recordValue(JSON.parse(text));
		const task = stringValue(payload.task);
		if (!task) throw new Error(`CartBlanche22 ${endpoint} response did not include a task id.`);
		return task;
	}
	throw new Error(`CartBlanche22 ${endpoint} submission failed: ${lastError}`);
}

async function pollCartBlanche(task: string, deadline: number): Promise<Record<string, unknown>> {
	const url = resultUrl(task);
	let lastTransportError: string | undefined;
	while (Date.now() < deadline) {
		try {
			const response = await fetchWithDeadline(url, { headers: { accept: "application/json" } }, deadline);
			if (TRANSIENT_STATUS.has(response.status)) {
				lastTransportError = `HTTP ${response.status}`;
			} else {
				const text = await readTextCapped(response);
				if (!response.ok) throw new Error(`polling ZINC task ${task} returned HTTP ${response.status}: ${bodyExcerpt(text)}`);
				if (looksLikeHtml(text)) throw new Error(`polling ZINC task ${task} returned HTML instead of JSON.`);
				const payload = recordValue(JSON.parse(text));
				const status = stringValue(payload.status);
				if (status === "FAILURE") throw new Error(`ZINC task ${task} failed server-side.`);
				if (status === "SUCCESS" || (!status && Object.hasOwn(payload, "result"))) return payload;
				if (status && !["PENDING", "STARTED", "PROGRESS", "RETRY"].includes(status)) {
					throw new Error(`ZINC task ${task} returned unexpected status ${status}.`);
				}
			}
		} catch (error) {
			if (!(error instanceof Error)) throw error;
			if (/unexpected status|failed server-side|returned HTML|returned HTTP/.test(error.message)) throw error;
			lastTransportError = error.name || error.message;
		}
		await delay(Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
	}
	throw new Error(`ZINC task ${task} did not complete within ${Math.round(DEFAULT_TIMEOUT_MS / 1000)}s${lastTransportError ? `; last poll error: ${lastTransportError}` : ""}.`);
}

async function cartBlancheSearch(endpoint: string, fields: Record<string, string | number>): Promise<{ endpoints: string[]; missing: string[]; result: Record<string, unknown>; taskId: string }> {
	const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
	const taskId = await submitCartBlanche(endpoint, fields, deadline);
	const payload = await pollCartBlanche(taskId, deadline);
	const result = recordValue(payload.result);
	return {
		endpoints: [endpointUrl(endpoint), resultUrl(taskId)],
		missing: arrayValue(result.missing).map(String),
		result,
		taskId,
	};
}

function normalizeZincId(id: string): string {
	const match = /^ZINC([a-zA-Z]?)(\d+)$/i.exec(id.trim());
	if (!match) return id.trim();
	return `ZINC${match[1]?.toUpperCase() ?? ""}${String(Number(match[2])).padStart(12, "0")}`;
}

function splitEntries(value: string): string[] {
	return value
		.split(/[\s,;]+/)
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function requireZincIds(value: string, max: number): string[] {
	const ids = splitEntries(value);
	if (!ids.length) throw new Error("ZINC lookup requires at least one ZINC id.");
	if (ids.length > max) throw new Error(`ZINC lookup accepts at most ${max} ids per call.`);
	for (const id of ids) {
		if (!ZINC_ID_RE.test(id)) throw new Error(`Invalid ZINC id ${id}.`);
	}
	return ids;
}

function optionValue(query: string, key: string): string | undefined {
	const match = new RegExp(`(?:^|\\s)${key}=([^\\s]+)`, "i").exec(query);
	return match?.[1];
}

function removeOptions(query: string, keys: string[]): string {
	let clean = query;
	for (const key of keys) clean = clean.replace(new RegExp(`(?:^|\\s)${key}=[^\\s]+`, "ig"), " ");
	return clean.trim();
}

function parseQuery(rawQuery: string, limit: number): { fields: Record<string, string | number>; ids?: string[]; mode: ZincSearchMode; query: Record<string, unknown>; endpoint: string } {
	const query = cleanQuery(rawQuery);
	const threeD = /^(?:3d|structure|files)\s*[:= ]\s*(.+)$/i.exec(query);
	if (threeD) {
		const ids = requireZincIds(threeD[1] ?? "", MAX_IDS_3D);
		const canonical = ids.map(normalizeZincId);
		return {
			endpoint: "substances.txt",
			fields: { zinc_ids: canonical.join(","), output_fields: DEFAULT_OUTPUT_FIELDS },
			ids,
			mode: "3d",
			query: { zincIds: ids },
		};
	}
	const random = /^(?:random|sample)(?:\b|[:= ])/i.test(query);
	if (random) {
		const count = Math.max(1, Math.min(Number(optionValue(query, "count") ?? limit), MAX_LIMIT));
		const subset = optionValue(query, "subset") ?? /\b(fragment|lead-like|drug-like|lugs)\b/i.exec(query)?.[1];
		return {
			endpoint: "substance/random.txt",
			fields: {
				count,
				output_fields: DEFAULT_OUTPUT_FIELDS,
				...(subset ? { subset } : {}),
			},
			mode: "random",
			query: { count, subset, knownSubsets: [...KNOWN_SUBSETS] },
		};
	}
	const supplier = /^(?:supplier|supplier_codes|catalog|catitem)s?\s*[:= ]\s*(.+)$/i.exec(query);
	if (supplier) {
		const codes = splitEntries(removeOptions(supplier[1] ?? "", ["limit"]));
		if (!codes.length) throw new Error("ZINC supplier lookup requires at least one supplier code.");
		if (codes.length > MAX_IDS_PER_CALL) throw new Error(`ZINC supplier lookup accepts at most ${MAX_IDS_PER_CALL} codes per call.`);
		return {
			endpoint: "catitems.txt",
			fields: {
				supplier_codes: codes.join(","),
				output_fields: "zinc_id,smiles,supplier_code,catalogs,tranche_name",
			},
			mode: "supplier",
			query: { supplierCodes: codes },
		};
	}
	const idMatch = /^(?:id|zinc_ids?)\s*[:= ]\s*(.+)$/i.exec(query);
	if (idMatch) {
		const ids = requireZincIds(idMatch[1] ?? "", MAX_IDS_PER_CALL);
		const canonical = ids.map(normalizeZincId);
		return {
			endpoint: "substances.txt",
			fields: { zinc_ids: canonical.join(","), output_fields: DEFAULT_OUTPUT_FIELDS },
			ids,
			mode: "id",
			query: { zincIds: ids },
		};
	}
	const smilesMatch = /^(?:smiles|structure)\s*[:=]\s*(.+)$/i.exec(query);
	if (smilesMatch || (!/[\s,;]/.test(query) && !ZINC_ID_RE.test(query))) {
		const body = smilesMatch ? smilesMatch[1] ?? "" : query;
		const dist = Math.max(0, Math.min(Number(optionValue(body, "dist") ?? 0), 10));
		const adist = Math.max(0, Math.min(Number(optionValue(body, "adist") ?? dist), 10));
		const smiles = removeOptions(body, ["dist", "adist", "limit"]);
		if (!smiles) throw new Error("ZINC SMILES lookup requires a SMILES string.");
		return {
			endpoint: "smiles.txt",
			fields: { smiles, dist, adist, output_fields: DEFAULT_OUTPUT_FIELDS },
			mode: "smiles",
			query: { smiles, dist, adist },
		};
	}
	const ids = requireZincIds(query, MAX_IDS_PER_CALL);
	const canonical = ids.map(normalizeZincId);
	return {
		endpoint: "substances.txt",
		fields: { zinc_ids: canonical.join(","), output_fields: DEFAULT_OUTPUT_FIELDS },
		ids,
		mode: "id",
		query: { zincIds: ids },
	};
}

function trancheCode(record: Record<string, unknown>): string | undefined {
	const direct = stringValue(record.tranche_name) ?? stringValue(record.tranche);
	if (direct) return direct;
	const tranche = recordValue(record.tranche);
	const h = stringValue(tranche.h_num);
	const p = stringValue(tranche.p_num);
	return h && p ? `${h}${p}` : undefined;
}

function parseTranche(value: string | undefined): { heavyAtoms: number; logp: number } | undefined {
	if (!value) return undefined;
	const match = TRANCHE_RE.exec(value.trim());
	if (!match) return undefined;
	const sign = match[2] === "P" ? 1 : -1;
	return { heavyAtoms: Number(match[1]), logp: sign * Number(match[3]) / 100 };
}

function trancheProperties(record: Record<string, unknown>): Record<string, unknown> | undefined {
	const details = recordValue(record.tranche_details);
	if (numberValue(details.heavy_atoms) !== undefined || numberValue(details.logp) !== undefined) {
		return {
			heavyAtoms: numberValue(details.heavy_atoms),
			logp: numberValue(details.logp),
			molecularWeightBin: details.mwt,
		};
	}
	return parseTranche(trancheCode(record));
}

function normalizeCatalog(catalog: unknown): Record<string, unknown> {
	const record = recordValue(catalog);
	return {
		catalogName: stringValue(record.catalog_name),
		shortName: stringValue(record.short_name),
		supplierCode: stringValue(record.supplier_code),
		price: numberValue(record.price),
		quantity: numberValue(record.quantity),
		unit: stringValue(record.unit),
		shipping: stringValue(record.shipping),
		urlTemplate: stringValue(record.url),
	};
}

function normalizeRecord(record: Record<string, unknown>): Record<string, unknown> {
	const zincId = stringValue(record.zinc_id);
	const catalogs = arrayValue(record.catalogs).map(normalizeCatalog).slice(0, 12);
	const code = trancheCode(record);
	return {
		zincId,
		smiles: stringValue(record.smiles),
		source: stringValue(record.source),
		supplierCodes: arrayValue(record.supplier_code).map(String),
		catalogCount: arrayValue(record.catalogs).length,
		catalogs,
		trancheName: code,
		trancheProperties: trancheProperties(record),
		url: zincId ? `https://zinc.docking.org/substances/${encodeURIComponent(zincId)}` : undefined,
	};
}

function flattenResult(result: Record<string, unknown>): { counts: Record<string, number>; records: Record<string, unknown>[] } {
	const ordered = ["zinc22", "zinc20", ...Object.keys(result).filter((key) => !["zinc22", "zinc20", "missing"].includes(key)).sort()];
	const records: Record<string, unknown>[] = [];
	const counts: Record<string, number> = {};
	for (const source of ordered) {
		const rows = arrayValue(result[source]).filter((item) => Object.keys(recordValue(item)).length).map((item) => ({ ...recordValue(item), source }));
		if (!rows.length) continue;
		counts[source] = rows.length;
		records.push(...rows);
	}
	return { counts, records };
}

function pageResult(records: Record<string, unknown>[], limit: number): { results: Record<string, unknown>[]; returned: number; totalAvailable: number; truncated: boolean } {
	const page = records.slice(0, limit).map(normalizeRecord);
	return {
		results: page,
		returned: page.length,
		totalAvailable: records.length,
		truncated: records.length > page.length,
	};
}

function structureDownloads(record: Record<string, unknown>): Record<string, unknown> | undefined {
	const code = trancheCode(record);
	const props = trancheProperties(record);
	if (!code || !props || typeof props.heavyAtoms !== "number") return undefined;
	const heavyDir = `H${String(props.heavyAtoms).padStart(2, "0")}`;
	return {
		repository: `${ZINC_FILES_BASE}/`,
		tranchePathPattern: `zinc-22*/${heavyDir}/${code}/`,
		formats: {
			"db2.gz": "DOCK multi-conformer database",
			"mol2.gz": "Tripos MOL2 with 3D coordinates",
			"sdf.gz": "SDF with 3D coordinates",
			smi: "SMILES bookkeeping file",
		},
	};
}

function structureRows(ids: string[], records: Record<string, unknown>[]): Record<string, unknown>[] {
	const byId = new Map(records.flatMap((record) => {
		const id = stringValue(record.zinc_id);
		return id ? [[normalizeZincId(id), record] as const] : [];
	}));
	return ids.map((id) => {
		const canonical = normalizeZincId(id);
		const record = byId.get(canonical);
		if (!record) return { zincId: id, canonicalZincId: canonical, found: false };
		const normalized = normalizeRecord(record);
		return {
			...normalized,
			canonicalZincId: canonical,
			found: true,
			download: structureDownloads(record),
		};
	});
}

export async function searchZinc(params: SearchParams): Promise<Record<string, unknown>> {
	const limit = safeLimit(params.limit);
	const parsed = parseQuery(params.query, limit);
	const search = await cartBlancheSearch(parsed.endpoint, parsed.fields);
	const flattened = flattenResult(search.result);
	if (parsed.mode === "3d") {
		const structures = structureRows(parsed.ids ?? [], flattened.records);
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "zinc",
			query: params.query,
			searchMode: parsed.mode,
			taskId: search.taskId,
			returned: structures.length,
			structures,
			repositoryNote: "Browse sub-release directories under the tranche path for exact filenames before bulk download.",
			provenance: { docs: DOCS, endpoints: search.endpoints },
		};
	}
	const page = pageResult(flattened.records, limit);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "zinc",
		query: params.query,
		searchMode: parsed.mode,
		parsedQuery: parsed.query,
		taskId: search.taskId,
		totalAvailable: page.totalAvailable,
		totalCount: page.totalAvailable,
		returned: page.returned,
		truncated: page.truncated,
		sourceCounts: flattened.counts,
		missing: search.missing,
		results: page.results,
		provenance: { docs: DOCS, endpoints: search.endpoints },
	};
}
