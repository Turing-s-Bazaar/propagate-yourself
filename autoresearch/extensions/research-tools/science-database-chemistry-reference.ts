type ChemistryReferenceSource = "bindingdb" | "pubchem" | "rhea";

type SearchParams = { limit?: number; query: string; source: ChemistryReferenceSource };

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 25_000;
const PUBCHEM_BASE = "https://pubchem.ncbi.nlm.nih.gov/rest/pug";
const PUBCHEM_VIEW_BASE = "https://pubchem.ncbi.nlm.nih.gov/rest/pug_view";
const BINDINGDB_BASE = "https://bindingdb.org/rest";
const RHEA_SEARCH_URL = "https://www.rhea-db.org/rhea/";
const PUBCHEM_PROPERTY_LIST = [
	"MolecularFormula",
	"MolecularWeight",
	"SMILES",
	"ConnectivitySMILES",
	"InChI",
	"InChIKey",
	"IUPACName",
	"XLogP",
	"ExactMass",
	"TPSA",
	"Charge",
	"HBondDonorCount",
	"HBondAcceptorCount",
	"RotatableBondCount",
	"HeavyAtomCount",
].join(",");

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

function endpointIdentityParams(): Record<string, string> {
	const email = process.env.NCBI_EMAIL?.trim();
	return {
		tool: "feynman",
		...(email ? { email } : {}),
	};
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

function booleanParam(query: string, name: string, fallback = false): boolean {
	const value = stringParam(query, name)?.toLowerCase();
	if (value === "true" || value === "1" || value === "yes") return true;
	if (value === "false" || value === "0" || value === "no") return false;
	return fallback;
}

function prefixedBody(query: string, prefix: string): string | undefined {
	return query.match(new RegExp(`^${prefix}\\s*:\\s*(.+)$`, "i"))?.[1]?.trim();
}

function removeSimpleParams(query: string): string {
	return query
		.replace(/\b(?:namespace|max_cids|max_records|threshold|with_properties|include_synonyms|max_synonyms|active_only|max_rows|cutoff|similarity)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function pubchemParseQuery(query: string): { cids?: string[]; namespace: "inchikey" | "name" | "smiles"; value: string } {
	const cid = query.match(/^cid:\s*(.+)$/i);
	if (cid?.[1]) return { cids: splitTerms(cid[1]).flatMap((item) => item.split(/\s+/)).filter(Boolean), namespace: "name", value: cid[1].trim() };
	const smiles = query.match(/^smiles:\s*(.+)$/i);
	if (smiles?.[1]) return { namespace: "smiles", value: smiles[1].trim() };
	const inchikey = query.match(/^inchikey:\s*(.+)$/i);
	if (inchikey?.[1]) return { namespace: "inchikey", value: inchikey[1].trim() };
	const name = query.match(/^name:\s*(.+)$/i);
	return { namespace: "name", value: name?.[1]?.trim() || query };
}

function pubchemUrl(path: string): URL {
	const url = new URL(`${PUBCHEM_BASE}${path}`);
	for (const [key, value] of Object.entries(endpointIdentityParams())) url.searchParams.set(key, value);
	return url;
}

function pubchemViewUrl(path: string): URL {
	const url = new URL(`${PUBCHEM_VIEW_BASE}${path}`);
	for (const [key, value] of Object.entries(endpointIdentityParams())) url.searchParams.set(key, value);
	return url;
}

async function pubchemResolveCids(parsed: ReturnType<typeof pubchemParseQuery>, limit: number): Promise<{ cids: string[]; endpoints: string[]; searchMode: string }> {
	if (parsed.cids?.length) return { cids: parsed.cids.slice(0, limit), endpoints: [], searchMode: "cid" };
	const cidsUrl = pubchemUrl(`/compound/${parsed.namespace}/cids/JSON`);
	const payload = recordValue(await postFormJson(cidsUrl, { [parsed.namespace]: parsed.value }));
	const cids = arrayValue(recordValue(payload.IdentifierList).CID).map(String).filter(Boolean);
	return { cids: cids.slice(0, limit), endpoints: [cidsUrl.toString()], searchMode: parsed.namespace };
}

async function pubchemSynonyms(cid: string): Promise<string[]> {
	const url = pubchemUrl(`/compound/cid/${encodeURIComponent(cid)}/synonyms/JSON`);
	const payload = recordValue(await fetchJsonOrUndefined(url));
	const info = arrayValue(recordValue(payload.InformationList).Information).map((item) => recordValue(item))[0];
	return arrayValue(info?.Synonym).map(String).filter(Boolean).slice(0, 8);
}

function normalizePubchemProperty(record: Record<string, unknown>, synonyms: string[]): Record<string, unknown> {
	const cid = stringValue(record.CID) ?? String(numberValue(record.CID) ?? "");
	return {
		cid,
		name: stringValue(record.IUPACName) ?? synonyms[0],
		formula: stringValue(record.MolecularFormula),
		molecularWeight: numberValue(record.MolecularWeight),
		smiles: stringValue(record.ConnectivitySMILES) ?? stringValue(record.SMILES),
		canonicalSmiles: stringValue(record.SMILES),
		inchi: stringValue(record.InChI),
		inchiKey: stringValue(record.InChIKey),
		exactMass: numberValue(record.ExactMass),
		xLogP: numberValue(record.XLogP),
		tpsa: numberValue(record.TPSA),
		charge: numberValue(record.Charge),
		hBondDonorCount: numberValue(record.HBondDonorCount),
		hBondAcceptorCount: numberValue(record.HBondAcceptorCount),
		rotatableBondCount: numberValue(record.RotatableBondCount),
		heavyAtomCount: numberValue(record.HeavyAtomCount),
		synonyms,
		url: cid ? `https://pubchem.ncbi.nlm.nih.gov/compound/${encodeURIComponent(cid)}` : undefined,
	};
}

async function fetchPubchemProperties(cids: string[], maxSynonyms: number): Promise<{ endpoints: string[]; results: Array<Record<string, unknown>> }> {
	if (!cids.length) return { endpoints: [], results: [] };
	const propertiesUrl = pubchemUrl(`/compound/cid/property/${PUBCHEM_PROPERTY_LIST}/JSON`);
	const payload = recordValue(await postFormJson(propertiesUrl, { cid: cids.join(",") }));
	const properties = arrayValue(recordValue(payload.PropertyTable).Properties).map((item) => recordValue(item));
	const synonyms = await Promise.all(properties.map((record) => pubchemSynonyms(String(record.CID ?? "")).then((items) => items.slice(0, maxSynonyms))));
	return {
		endpoints: [propertiesUrl.toString()],
		results: properties.map((record, index) => normalizePubchemProperty(record, synonyms[index] ?? [])),
	};
}

function pubchemNamespace(value: string | undefined): "inchikey" | "name" | "smiles" {
	if (value?.toLowerCase() === "smiles") return "smiles";
	if (value?.toLowerCase() === "inchikey") return "inchikey";
	return "name";
}

function extractPubchemNamedQuery(query: string): { body: string; command: string } | undefined {
	const command = query.match(/^(pubchem_(?:search_compounds|get_compounds|similarity_search|get_bioassay_summary|get_safety))\s*:\s*/i)?.[1];
	if (!command) return undefined;
	return { body: query.slice(query.indexOf(":") + 1).trim(), command: command.toLowerCase() };
}

function normalizePubchemAssayRow(columns: string[], cells: unknown[]): Record<string, unknown> {
	return Object.fromEntries(columns.map((column, index) => [column || `column_${index + 1}`, cells[index]]));
}

function sectionText(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (Array.isArray(value)) return value.map(sectionText).filter(Boolean).join("; ");
	const record = recordValue(value);
	if (!Object.keys(record).length) return undefined;
	const stringWithMarkup = arrayValue(record.StringWithMarkup).map((item) => sectionText(recordValue(item).String)).filter(Boolean).join("; ");
	return stringWithMarkup || sectionText(record.Number);
}

function collectPubchemSections(section: Record<string, unknown>, title: string, matches: Record<string, unknown>[] = []): Record<string, unknown>[] {
	const heading = stringValue(section.TOCHeading) ?? stringValue(section.Name);
	if (heading?.toLowerCase() === title.toLowerCase()) matches.push(section);
	for (const child of arrayValue(section.Section).map((item) => recordValue(item))) collectPubchemSections(child, title, matches);
	return matches;
}

function normalizePubchemInformation(info: Record<string, unknown>): Record<string, unknown> {
	return {
		name: stringValue(info.Name),
		value: sectionText(recordValue(info.Value)),
		referenceNumber: numberValue(info.ReferenceNumber),
	};
}

async function pubchemBioassaySummary(query: string, limit: number): Promise<Record<string, unknown>> {
	const body = removeSimpleParams(prefixedBody(query, "pubchem_get_bioassay_summary") ?? query);
	const cid = body.split(/[\s,;]+/).find(Boolean);
	if (!cid) throw new Error("PubChem bioassay summary requires a CID.");
	const maxRows = safeLimit(numberValue(stringParam(query, "max_rows")) ?? limit);
	const activeOnly = booleanParam(query, "active_only");
	const url = pubchemUrl(`/compound/cid/${encodeURIComponent(cid)}/assaysummary/JSON`);
	const table = recordValue(recordValue(await fetchJson(url)).Table);
	const columns = arrayValue(recordValue(table.Columns).Column).map(String);
	const rows = arrayValue(table.Row).map((item) => normalizePubchemAssayRow(columns, arrayValue(recordValue(item).Cell)));
	const filteredRows = activeOnly
		? rows.filter((row) => /^active$/i.test(String(row["Activity Outcome"] ?? row.ActivityOutcome ?? "").trim()))
		: rows;
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "pubchem",
		query,
		searchMode: "pubchem-bioassay-summary",
		cid,
		totalCount: filteredRows.length,
		returned: Math.min(filteredRows.length, maxRows),
		results: filteredRows.slice(0, maxRows),
		provenance: {
			docs: "https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest",
			endpoints: [url.toString()],
		},
	};
}

async function pubchemSafety(query: string): Promise<Record<string, unknown>> {
	const body = removeSimpleParams(prefixedBody(query, "pubchem_get_safety") ?? query);
	const cid = body.split(/[\s,;]+/).find(Boolean);
	if (!cid) throw new Error("PubChem safety lookup requires a CID.");
	const url = pubchemViewUrl(`/data/compound/${encodeURIComponent(cid)}/JSON`);
	url.searchParams.set("heading", "GHS Classification");
	const payload = recordValue(await fetchJsonOrUndefined(url));
	const sections = collectPubchemSections(recordValue(recordValue(payload).Record), "GHS Classification");
	const results = sections.map((section) => ({
		heading: stringValue(section.TOCHeading) ?? "GHS Classification",
		information: arrayValue(section.Information).map((item) => normalizePubchemInformation(recordValue(item))),
		sourceCount: arrayValue(section.Reference).length,
	}));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "pubchem",
		query,
		searchMode: "pubchem-safety",
		cid,
		totalCount: results.length,
		returned: results.length,
		results,
		provenance: {
			docs: "https://pubchem.ncbi.nlm.nih.gov/docs/pug-view",
			endpoints: [url.toString()],
		},
	};
}

async function searchPubChem(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const named = extractPubchemNamedQuery(query);
	if (named?.command === "pubchem_get_bioassay_summary") return pubchemBioassaySummary(query, limit);
	if (named?.command === "pubchem_get_safety") return pubchemSafety(query);
	if (named?.command === "pubchem_similarity_search") {
		const body = removeSimpleParams(named.body);
		if (!body) throw new Error("PubChem similarity search requires a SMILES string.");
		const maxRecords = safeLimit(numberValue(stringParam(query, "max_records")) ?? limit);
		const threshold = stringParam(query, "threshold") ?? "90";
		const url = pubchemUrl("/compound/fastsimilarity_2d/smiles/cids/JSON");
		url.searchParams.set("Threshold", threshold);
		url.searchParams.set("MaxRecords", String(maxRecords));
		const payload = recordValue(await postFormJson(url, { smiles: body }));
		const cids = arrayValue(recordValue(payload.IdentifierList).CID).map(String).filter(Boolean).slice(0, maxRecords);
		const properties = booleanParam(query, "with_properties")
			? await fetchPubchemProperties(cids, 8)
			: { endpoints: [], results: cids.map((cid) => ({ cid, url: `https://pubchem.ncbi.nlm.nih.gov/compound/${encodeURIComponent(cid)}` })) };
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "pubchem",
			query,
			searchMode: "pubchem-similarity-search",
			threshold: numberValue(threshold),
			totalCount: cids.length,
			returned: properties.results.length,
			results: properties.results,
			provenance: {
				docs: "https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest",
				endpoints: [url.toString(), ...properties.endpoints],
			},
		};
	}
	if (named?.command === "pubchem_get_compounds") {
		const cids = splitTerms(removeSimpleParams(named.body)).flatMap((item) => item.split(/\s+/)).filter(Boolean).slice(0, limit);
		const maxSynonyms = safeLimit(numberValue(stringParam(query, "max_synonyms")) ?? (booleanParam(query, "include_synonyms") ? 30 : 8));
		const properties = await fetchPubchemProperties(cids, maxSynonyms);
		return {
			schema: "feynman.scienceDatabaseSearch.v1",
			source: "pubchem",
			query,
			searchMode: "pubchem-get-compounds",
			totalCount: cids.length,
			returned: properties.results.length,
			results: properties.results,
			provenance: {
				docs: "https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest",
				endpoints: properties.endpoints,
			},
		};
	}
	const effectiveLimit = safeLimit(numberValue(stringParam(query, "max_cids")) ?? limit);
	const parsed = named?.command === "pubchem_search_compounds"
		? { namespace: pubchemNamespace(stringParam(query, "namespace")), value: removeSimpleParams(named.body) }
		: pubchemParseQuery(query);
	const resolved = await pubchemResolveCids(parsed, effectiveLimit);
	const properties = await fetchPubchemProperties(resolved.cids, 8);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "pubchem",
		query,
		searchMode: named?.command === "pubchem_search_compounds" ? "pubchem-search-compounds" : resolved.searchMode,
		totalCount: resolved.cids.length,
		returned: properties.results.length,
		results: properties.results,
		provenance: {
			docs: "https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest",
			endpoints: [...resolved.endpoints, ...properties.endpoints],
		},
	};
}

function bindingDbParam(query: string, name: string): string | undefined {
	return query.match(new RegExp(`\\b${name}\\s*[:=]\\s*([^\\s,;]+)`, "i"))?.[1];
}

function bindingDbParseQuery(query: string): { cutoff: string; mode: "compound-targets" | "uniprot-ligands"; smiles?: string; uniprot?: string } {
	const compoundBody = prefixedBody(query, "bindingdb_targets_by_compound");
	const ligandBody = prefixedBody(query, "bindingdb_ligands_by_target");
	const cleanEffective = removeSimpleParams(compoundBody ?? ligandBody ?? query);
	const smiles = cleanEffective.match(/^smiles:\s*(.+)$/i)?.[1]?.trim() ?? (compoundBody ? cleanEffective : undefined);
	if (smiles) return { cutoff: bindingDbParam(query, "cutoff") ?? bindingDbParam(query, "similarity") ?? "0.85", mode: "compound-targets", smiles };
	const uniprot = bindingDbParam(query, "uniprot") ?? cleanEffective.match(/\b[A-NR-Z][0-9][A-Z][A-Z0-9]{2}[0-9]\b/i)?.[0] ?? cleanEffective.match(/\b[OPQ][0-9][A-Z0-9]{3}[0-9]\b/i)?.[0] ?? cleanEffective;
	return { cutoff: bindingDbParam(query, "cutoff") ?? "100", mode: "uniprot-ligands", uniprot };
}

function normalizeBindingDbRecord(record: Record<string, unknown>, mode: string): Record<string, unknown> {
	const monomerId = stringValue(record.BindingDB_MonomerID) ?? stringValue(record.monomerid);
	const doi = stringValue(record.DOI) ?? stringValue(record.article_doi);
	const pmid = stringValue(record.PMID) ?? stringValue(record.PubMed_ID);
	return {
		mode,
		bindingDbMonomerId: monomerId,
		compoundName: stringValue(record["Ligand_Name"]) ?? stringValue(record.Name) ?? stringValue(record.ligand),
		smiles: stringValue(record["Ligand_SMILES"]) ?? stringValue(record.SMILES) ?? stringValue(record.smile),
		targetName: stringValue(record["Target_Name"]) ?? stringValue(record.target_name) ?? stringValue(record.Target) ?? stringValue(record.query),
		uniprot: stringValue(record["UniProt_(SwissProt)_Primary_ID"]) ?? stringValue(record.UniProt) ?? stringValue(record.uniprot),
		affinityType: stringValue(record.affinity_type),
		affinity: stringValue(record.affinity),
		ki: stringValue(record.Ki),
		ic50: stringValue(record.IC50),
		kd: stringValue(record.Kd),
		ec50: stringValue(record.EC50),
		ph: stringValue(record.pH),
		temperature: stringValue(record.Temp),
		doi: doi ?? stringValue(record.doi),
		pmid: pmid ?? stringValue(record.pmid),
		url: monomerId ? `https://www.bindingdb.org/rwd/bind/chemsearch/marvin/MolStructure.jsp?monomerid=${encodeURIComponent(monomerId)}` : undefined,
		pubmedUrl: (pmid ?? stringValue(record.pmid)) ? `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(pmid ?? stringValue(record.pmid) ?? "")}/` : undefined,
		doiUrl: (doi ?? stringValue(record.doi)) ? `https://doi.org/${doi ?? stringValue(record.doi)}` : undefined,
	};
}

function firstRecordValue(...values: unknown[]): Record<string, unknown> {
	for (const value of values) {
		const record = recordValue(value);
		if (Object.keys(record).length) return record;
	}
	return {};
}

async function searchBindingDb(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const parsed = bindingDbParseQuery(query);
	const url = parsed.mode === "compound-targets"
		? new URL(`${BINDINGDB_BASE}/getTargetByCompound`)
		: new URL(`${BINDINGDB_BASE}/getLigandsByUniprots`);
	if (parsed.mode === "compound-targets") {
		url.searchParams.set("smiles", parsed.smiles ?? "");
		url.searchParams.set("cutoff", parsed.cutoff);
	} else {
		url.searchParams.set("uniprot", parsed.uniprot ?? "");
		url.searchParams.set("cutoff", parsed.cutoff);
	}
	url.searchParams.set("response", "application/json");
	const payload = recordValue(await fetchJson(url));
	const root = firstRecordValue(payload.getLindsByUniprotsResponse, payload.getLigandsByUniprotsResponse, payload.getTargetByCompoundResponse);
	const rows = arrayValue(root.affinities).length ? arrayValue(root.affinities) : arrayValue(root.targets);
	const results = rows.slice(0, limit).map((item) => normalizeBindingDbRecord(recordValue(item), parsed.mode));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "bindingdb",
		query,
		searchMode: parsed.mode,
		totalCount: rows.length,
		returned: results.length,
		results,
		provenance: {
			docs: "https://www.bindingdb.org/rwd/bind/BindingDBRESTfulAPI.jsp",
			endpoints: [url.toString()],
		},
	};
}

function normalizeRheaRow(row: Record<string, string>): Record<string, unknown> {
	const rheaId = tableCell(row, ["rhea-id", "Rhea ID", "Reaction identifier"])?.replace(/^RHEA:/i, "RHEA:");
	const ec = tableCell(row, ["ec", "EC number", "ec-number"]);
	const pubmed = tableCell(row, ["pubmed", "PubMed"]);
	const go = tableCell(row, ["go", "Gene Ontology"]);
	return {
		rheaId,
		equation: tableCell(row, ["equation", "Equation"]),
		ecNumbers: ec ? ec.split(/[;,]\s*/).filter(Boolean) : [],
		chebiIds: (tableCell(row, ["chebi-id", "ChEBI ID", "chebi"]) ?? "").split(/[;,]\s*/).filter(Boolean),
		chebiNames: (tableCell(row, ["chebi", "ChEBI name"]) ?? "").split(/[;,]\s*/).filter(Boolean),
		pubmedIds: pubmed ? pubmed.split(/[;,]\s*/).filter(Boolean) : [],
		goTerms: go ? go.split(/[;,]\s*/).filter(Boolean) : [],
		keggXrefs: (tableCell(row, ["reaction-xref(KEGG)", "KEGG"]) ?? "").split(/[;,]\s*/).filter(Boolean),
		reactomeXrefs: (tableCell(row, ["reaction-xref(Reactome)", "Reactome"]) ?? "").split(/[;,]\s*/).filter(Boolean),
		url: rheaId ? `https://www.rhea-db.org/rhea/${encodeURIComponent(rheaId.replace(/^RHEA:/i, ""))}` : undefined,
	};
}

async function searchRhea(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const getBody = prefixedBody(query, "rhea_get_reaction");
	const searchBody = prefixedBody(query, "rhea_search_reactions");
	const effectiveQuery = removeSimpleParams(getBody ?? searchBody ?? query);
	const url = new URL(RHEA_SEARCH_URL);
	url.searchParams.set("query", getBody ? effectiveQuery.replace(/^RHEA:/i, "") : effectiveQuery);
	url.searchParams.set("columns", getBody ? "rhea-id,equation,ec,chebi-id,chebi,pubmed,go,reaction-xref(KEGG),reaction-xref(Reactome)" : "rhea-id,equation,ec,chebi-id");
	url.searchParams.set("format", "tsv");
	url.searchParams.set("limit", String(getBody ? 1 : limit));
	const rows = parsedTableRows(await fetchText(url));
	const results = rows.map(normalizeRheaRow).slice(0, getBody ? 1 : limit);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "rhea",
		query,
		searchMode: getBody ? "rhea-get-reaction" : "rhea-search-reactions",
		totalCount: rows.length,
		returned: results.length,
		results,
		provenance: {
			docs: "https://www.rhea-db.org/help/rest-api",
			endpoints: [url.toString()],
		},
	};
}

export async function searchChemistryReferenceScienceDatabase(params: SearchParams): Promise<Record<string, unknown>> {
	if (params.source === "bindingdb") return searchBindingDb(params);
	if (params.source === "pubchem") return searchPubChem(params);
	return searchRhea(params);
}
