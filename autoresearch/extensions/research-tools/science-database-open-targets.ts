type OpenTargetsSearchParams = { limit?: number; query: string };

const GRAPHQL_URL = "https://api.platform.opentargets.org/api/v4/graphql";
const DOCS = [
	"https://platform-docs.opentargets.org/data-access/graphql-api",
	"https://platform.opentargets.org/api",
];
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 45_000;

type ParsedQuery =
	| { mode: "disease"; efoId: string }
	| { mode: "disease-drugs"; efoId: string }
	| { mode: "disease-targets"; efoId: string }
	| { mode: "drug"; chemblId: string }
	| { mode: "evidence"; diseaseId: string; targetId: string }
	| { mode: "search"; value: string }
	| { mode: "target"; ensemblId: string };

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
	if (!clean) throw new Error("Open Targets search requires a non-empty query.");
	return clean;
}

function trimText(text: string | undefined, max = 360): string | undefined {
	if (!text) return undefined;
	const clean = text.replace(/\s+/g, " ").trim();
	if (clean.length <= max) return clean;
	return `${clean.slice(0, max - 1).trimEnd()}...`;
}

function targetUrl(id: string | undefined): string | undefined {
	return id ? `https://platform.opentargets.org/target/${encodeURIComponent(id)}` : undefined;
}

function diseaseUrl(id: string | undefined): string | undefined {
	return id ? `https://platform.opentargets.org/disease/${encodeURIComponent(id)}` : undefined;
}

function drugUrl(id: string | undefined): string | undefined {
	return id ? `https://platform.opentargets.org/drug/${encodeURIComponent(id)}` : undefined;
}

function parsePair(value: string): { diseaseId: string; targetId: string } {
	const atParts = value.split("@").map((part) => part.trim()).filter(Boolean);
	if (atParts.length === 2) return { targetId: atParts[0]!, diseaseId: atParts[1]! };
	const inMatch = value.match(/^(.+?)\s+(?:in|disease=)\s+([A-Za-z0-9_.:-]+)$/i);
	if (inMatch) return { targetId: inMatch[1]!.trim(), diseaseId: inMatch[2]!.trim() };
	const parts = value.split(/\s+/).filter(Boolean);
	if (parts.length >= 2) return { targetId: parts[0]!, diseaseId: parts[1]! };
	throw new Error("Open Targets evidence lookup requires target and disease, for example evidence:ENSG00000157764@MONDO_0005105.");
}

function parseQuery(query: string): ParsedQuery {
	const clean = cleanQuery(query);
	const match = clean.match(/^([a-z][a-z0-9_-]*)\s*:\s*(.+)$/i);
	if (!match) return { mode: "search", value: clean };
	const key = match[1]!.toLowerCase().replace(/_/g, "-");
	const value = cleanQuery(match[2]!);
	if (key === "open-targets-graphql") return parseQuery(value.replace(/^query\s+/i, "search:"));
	if (key === "open-targets-disease-drugs") return { mode: "disease-drugs", efoId: value.replace(/\s+size=\d+\s*$/i, "") };
	if (key === "open-targets-disease-targets") return { mode: "disease-targets", efoId: value.replace(/\s+size=\d+\s*$/i, "") };
	if (key === "open-targets-drug") return { mode: "drug", chemblId: value };
	if (key === "search") return { mode: "search", value };
	if (key === "target") return { mode: "target", ensemblId: value };
	if (key === "disease") return { mode: "disease", efoId: value };
	if (key === "disease-targets" || key === "targets") return { mode: "disease-targets", efoId: value };
	if (key === "disease-drugs" || key === "known-drugs" || key === "clinical-candidates") return { mode: "disease-drugs", efoId: value };
	if (key === "drug") return { mode: "drug", chemblId: value };
	if (key === "evidence" || key === "association") return { mode: "evidence", ...parsePair(value) };
	return { mode: "search", value: clean };
}

function isTransientGraphqlError(errors: unknown): boolean {
	const items = arrayValue(errors);
	return items.length > 0 && items.every((item) => {
		const message = stringValue(recordValue(item).message)?.toLowerCase();
		return message?.includes("internal server error");
	});
}

async function graphql(query: string, variables: Record<string, unknown>): Promise<{ data: Record<string, unknown>; errors?: unknown[]; endpoint: string; attempts: number }> {
	let lastErrors: unknown[] | undefined;
	for (let attempt = 1; attempt <= 3; attempt += 1) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
		try {
			const response = await fetch(GRAPHQL_URL, {
				body: JSON.stringify({ query, variables }),
				headers: {
					accept: "application/json",
					"content-type": "application/json",
					"user-agent": "feynman-open-targets/0.1",
				},
				method: "POST",
				signal: controller.signal,
			});
			const body = recordValue(await response.json());
			const errors = arrayValue(body.errors);
			if (!response.ok) throw new Error(`Open Targets request failed: ${response.status} ${response.statusText}`);
			if (errors.length && isTransientGraphqlError(errors) && attempt < 3) {
				lastErrors = errors;
				await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
				continue;
			}
			if (errors.length) return { data: recordValue(body.data), errors, endpoint: GRAPHQL_URL, attempts: attempt };
			return { data: recordValue(body.data), endpoint: GRAPHQL_URL, attempts: attempt };
		} finally {
			clearTimeout(timeout);
		}
	}
	return { data: {}, errors: lastErrors ?? [{ message: "Open Targets request failed after retries." }], endpoint: GRAPHQL_URL, attempts: 3 };
}

function normalizeSearchHit(record: Record<string, unknown>): Record<string, unknown> {
	const entity = stringValue(record.entity);
	const id = stringValue(record.id);
	return {
		id,
		name: stringValue(record.name),
		entity,
		url: entity === "target" ? targetUrl(id) : entity === "disease" ? diseaseUrl(id) : entity === "drug" ? drugUrl(id) : undefined,
	};
}

function normalizeDiseaseAssociation(record: Record<string, unknown>): Record<string, unknown> {
	const disease = recordValue(record.disease);
	const diseaseId = stringValue(disease.id);
	return {
		score: numberValue(record.score),
		disease: {
			id: diseaseId,
			name: stringValue(disease.name),
			url: diseaseUrl(diseaseId),
		},
	};
}

function normalizeTargetAssociation(record: Record<string, unknown>): Record<string, unknown> {
	const target = recordValue(record.target);
	const targetId = stringValue(target.id);
	return {
		score: numberValue(record.score),
		target: {
			id: targetId,
			approvedSymbol: stringValue(target.approvedSymbol),
			approvedName: stringValue(target.approvedName),
			url: targetUrl(targetId),
		},
	};
}

function normalizeDrugCandidate(record: Record<string, unknown>): Record<string, unknown> {
	const drug = recordValue(record.drug);
	const drugId = stringValue(drug.id);
	return {
		id: stringValue(record.id),
		maxClinicalStage: stringValue(record.maxClinicalStage),
		drug: {
			id: drugId,
			name: stringValue(drug.name),
			drugType: stringValue(drug.drugType),
			url: drugUrl(drugId),
		},
	};
}

function normalizeMechanism(record: Record<string, unknown>): Record<string, unknown> {
	return {
		mechanismOfAction: stringValue(record.mechanismOfAction),
		actionType: stringValue(record.actionType),
		targets: arrayValue(record.targets).map((target) => {
			const item = recordValue(target);
			const id = stringValue(item.id);
			return {
				id,
				approvedSymbol: stringValue(item.approvedSymbol),
				approvedName: stringValue(item.approvedName),
				url: targetUrl(id),
			};
		}),
	};
}

function normalizeEvidence(record: Record<string, unknown>): Record<string, unknown> {
	const target = recordValue(record.target);
	const disease = recordValue(record.disease);
	const targetId = stringValue(target.id);
	const diseaseId = stringValue(disease.id);
	return {
		datasourceId: stringValue(record.datasourceId),
		datatypeId: stringValue(record.datatypeId),
		score: numberValue(record.score),
		target: {
			id: targetId,
			approvedSymbol: stringValue(target.approvedSymbol),
			url: targetUrl(targetId),
		},
		disease: {
			id: diseaseId,
			name: stringValue(disease.name),
			url: diseaseUrl(diseaseId),
		},
	};
}

function provenance(endpoint: string, attempts: number): Record<string, unknown> {
	return { docs: DOCS, endpoints: [endpoint], attempts };
}

const SEARCH_QUERY = `query($term: String!, $size: Int!) {
	search(queryString: $term, page: { size: $size, index: 0 }) {
		total
		hits { id name entity }
	}
}`;

const TARGET_QUERY = `query($id: String!, $size: Int!) {
	target(ensemblId: $id) {
		id approvedSymbol approvedName biotype functionDescriptions
		geneticConstraint { constraintType score exp obs oe oeLower oeUpper }
		associatedDiseases(page: { size: $size, index: 0 }) {
			count
			rows { score disease { id name } }
		}
		drugAndClinicalCandidates {
			count
			rows { id maxClinicalStage drug { id name drugType } }
		}
	}
}`;

const DISEASE_QUERY = `query($id: String!, $size: Int!) {
	disease(efoId: $id) {
		id name description
		therapeuticAreas { id name }
		associatedTargets(page: { size: $size, index: 0 }) {
			count
			rows { score target { id approvedSymbol approvedName } }
		}
		drugAndClinicalCandidates {
			count
			rows { id maxClinicalStage drug { id name drugType } }
		}
	}
}`;

const DRUG_QUERY = `query($id: String!) {
	drug(chemblId: $id) {
		id name drugType description maximumClinicalStage
		mechanismsOfAction {
			rows { mechanismOfAction actionType targets { id approvedSymbol approvedName } }
		}
	}
}`;

const EVIDENCE_QUERY = `query($disease: String!, $target: String!, $size: Int!) {
	disease(efoId: $disease) {
		id name
		evidences(ensemblIds: [$target], size: $size) {
			count
			rows { datasourceId datatypeId score target { id approvedSymbol } disease { id name } }
		}
	}
}`;

async function search(term: string, limit: number): Promise<Record<string, unknown>> {
	const result = await graphql(SEARCH_QUERY, { term, size: limit });
	const searchNode = recordValue(result.data.search);
	const results = arrayValue(searchNode.hits).map((item) => normalizeSearchHit(recordValue(item)));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "opentargets",
		query: term,
		searchMode: "search",
		totalCount: numberValue(searchNode.total) ?? results.length,
		returned: results.length,
		results,
		...(result.errors ? { errors: result.errors } : {}),
		provenance: provenance(result.endpoint, result.attempts),
	};
}

async function target(ensemblId: string, limit: number): Promise<Record<string, unknown>> {
	const result = await graphql(TARGET_QUERY, { id: ensemblId, size: limit });
	const node = recordValue(result.data.target);
	const id = stringValue(node.id);
	const associatedDiseases = recordValue(node.associatedDiseases);
	const clinicalCandidates = recordValue(node.drugAndClinicalCandidates);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "opentargets",
		query: `target:${ensemblId}`,
		searchMode: "target",
		totalCount: id ? 1 : 0,
		returned: id ? 1 : 0,
		results: id ? [{
			id,
			approvedSymbol: stringValue(node.approvedSymbol),
			approvedName: stringValue(node.approvedName),
			biotype: stringValue(node.biotype),
			functionDescriptions: arrayValue(node.functionDescriptions).map(String).map((text) => trimText(text)).filter(Boolean).slice(0, 3),
			geneticConstraint: arrayValue(node.geneticConstraint).map((item) => recordValue(item)),
			associatedDiseases: {
				count: numberValue(associatedDiseases.count),
				rows: arrayValue(associatedDiseases.rows).map((item) => normalizeDiseaseAssociation(recordValue(item))),
			},
			drugAndClinicalCandidates: {
				count: numberValue(clinicalCandidates.count),
				rows: arrayValue(clinicalCandidates.rows).slice(0, limit).map((item) => normalizeDrugCandidate(recordValue(item))),
			},
			url: targetUrl(id),
		}] : [],
		...(result.errors ? { errors: result.errors } : {}),
		provenance: provenance(result.endpoint, result.attempts),
	};
}

async function disease(efoId: string, limit: number, mode: "disease" | "disease-drugs" | "disease-targets"): Promise<Record<string, unknown>> {
	const result = await graphql(DISEASE_QUERY, { id: efoId, size: limit });
	const node = recordValue(result.data.disease);
	const id = stringValue(node.id);
	const associatedTargets = recordValue(node.associatedTargets);
	const clinicalCandidates = recordValue(node.drugAndClinicalCandidates);
	const base = {
		id,
		name: stringValue(node.name),
		description: trimText(stringValue(node.description)),
		therapeuticAreas: arrayValue(node.therapeuticAreas).map((area) => {
			const item = recordValue(area);
			return { id: stringValue(item.id), name: stringValue(item.name) };
		}),
		url: diseaseUrl(id),
	};
	const resultRecord = mode === "disease-targets"
		? { ...base, associatedTargets: { count: numberValue(associatedTargets.count), rows: arrayValue(associatedTargets.rows).map((item) => normalizeTargetAssociation(recordValue(item))) } }
		: mode === "disease-drugs"
			? { ...base, drugAndClinicalCandidates: { count: numberValue(clinicalCandidates.count), rows: arrayValue(clinicalCandidates.rows).slice(0, limit).map((item) => normalizeDrugCandidate(recordValue(item))) } }
			: {
				...base,
				associatedTargets: { count: numberValue(associatedTargets.count), rows: arrayValue(associatedTargets.rows).map((item) => normalizeTargetAssociation(recordValue(item))) },
				drugAndClinicalCandidates: { count: numberValue(clinicalCandidates.count), rows: arrayValue(clinicalCandidates.rows).slice(0, limit).map((item) => normalizeDrugCandidate(recordValue(item))) },
			};
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "opentargets",
		query: `${mode}:${efoId}`,
		searchMode: mode,
		totalCount: id ? 1 : 0,
		returned: id ? 1 : 0,
		results: id ? [resultRecord] : [],
		...(result.errors ? { errors: result.errors } : {}),
		provenance: provenance(result.endpoint, result.attempts),
	};
}

async function drug(chemblId: string): Promise<Record<string, unknown>> {
	const result = await graphql(DRUG_QUERY, { id: chemblId });
	const node = recordValue(result.data.drug);
	const id = stringValue(node.id);
	const mechanisms = recordValue(node.mechanismsOfAction);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "opentargets",
		query: `drug:${chemblId}`,
		searchMode: "drug",
		totalCount: id ? 1 : 0,
		returned: id ? 1 : 0,
		results: id ? [{
			id,
			name: stringValue(node.name),
			drugType: stringValue(node.drugType),
			description: trimText(stringValue(node.description)),
			maximumClinicalStage: stringValue(node.maximumClinicalStage),
			mechanismsOfAction: arrayValue(mechanisms.rows).map((item) => normalizeMechanism(recordValue(item))),
			url: drugUrl(id),
		}] : [],
		...(result.errors ? { errors: result.errors } : {}),
		provenance: provenance(result.endpoint, result.attempts),
	};
}

async function evidence(targetId: string, diseaseId: string, limit: number): Promise<Record<string, unknown>> {
	const result = await graphql(EVIDENCE_QUERY, { target: targetId, disease: diseaseId, size: limit });
	const node = recordValue(result.data.disease);
	const evidences = recordValue(node.evidences);
	const rows = arrayValue(evidences.rows).map((item) => normalizeEvidence(recordValue(item)));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "opentargets",
		query: `evidence:${targetId}@${diseaseId}`,
		searchMode: "target-disease-evidence",
		targetId,
		disease: {
			id: stringValue(node.id),
			name: stringValue(node.name),
			url: diseaseUrl(stringValue(node.id)),
		},
		totalCount: numberValue(evidences.count) ?? rows.length,
		returned: rows.length,
		results: rows,
		...(result.errors ? { errors: result.errors } : {}),
		provenance: provenance(result.endpoint, result.attempts),
	};
}

export async function searchOpenTargets(params: OpenTargetsSearchParams): Promise<Record<string, unknown>> {
	const limit = safeLimit(params.limit);
	const parsed = parseQuery(params.query);
	if (parsed.mode === "target") return target(parsed.ensemblId, limit);
	if (parsed.mode === "disease") return disease(parsed.efoId, limit, "disease");
	if (parsed.mode === "disease-drugs") return disease(parsed.efoId, limit, "disease-drugs");
	if (parsed.mode === "disease-targets") return disease(parsed.efoId, limit, "disease-targets");
	if (parsed.mode === "drug") return drug(parsed.chemblId);
	if (parsed.mode === "evidence") return evidence(parsed.targetId, parsed.diseaseId, limit);
	return search(parsed.value, limit);
}
