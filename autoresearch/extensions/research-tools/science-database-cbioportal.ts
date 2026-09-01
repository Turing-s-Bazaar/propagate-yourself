type CbioportalSearchParams = { limit?: number; query: string };

const CBIOPORTAL_BASE = "https://www.cbioportal.org/api";
const CBIOPORTAL_STUDY_URL = "https://www.cbioportal.org/study/summary";
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const FULL_PAGE_SIZE = 100_000;
const REQUEST_TIMEOUT_MS = 25_000;
const CNA_EVENT_TYPES = new Set(["ALL", "AMP", "DIPLOID", "GAIN", "HETLOSS", "HOMDEL", "HOMDEL_AND_AMP"]);
const CNA_LABELS = new Map<number, string>([
	[-2, "deep_deletion"],
	[-1, "shallow_deletion"],
	[0, "diploid"],
	[1, "gain"],
	[2, "amplification"],
]);
const DOCS = [
	"https://docs.cbioportal.org/web-api-and-clients/",
	"https://www.cbioportal.org/api/swagger-ui/index.html",
];

type RequestResult = {
	endpoint: string;
	headers: Headers;
	payload: unknown;
};

type ParsedQuery =
	| { mode: "cancer-types"; value: string }
	| { mode: "cna-in-gene"; eventType: string; gene: string; studyId: string }
	| { mode: "clinical-attributes"; studyId: string }
	| { mode: "gene-mutations"; gene: string; studyId: string }
	| { mode: "mutation-frequency"; gene: string; studyIds: string[] }
	| { mode: "molecular-profiles"; studyId: string }
	| { mode: "samples"; studyId: string }
	| { mode: "study-detail"; studyId: string }
	| { mode: "study-search"; value: string };

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

function booleanValue(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function safeLimit(value: number | undefined): number {
	if (!Number.isFinite(value) || value === undefined) return DEFAULT_LIMIT;
	return Math.max(1, Math.min(Math.floor(value), MAX_LIMIT));
}

function cleanQuery(query: string): string {
	const clean = query.trim();
	if (!clean) throw new Error("cBioPortal search requires a non-empty query.");
	return clean;
}

function stripHtml(text: string | undefined): string | undefined {
	return text
		?.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim() || undefined;
}

function trimText(text: string | undefined, max = 280): string | undefined {
	const clean = stripHtml(text);
	if (!clean || clean.length <= max) return clean;
	return `${clean.slice(0, max - 1).trimEnd()}...`;
}

function seg(value: string): string {
	return encodeURIComponent(value);
}

function studyUrl(studyId: string | undefined): string | undefined {
	if (!studyId) return undefined;
	const url = new URL(CBIOPORTAL_STUDY_URL);
	url.searchParams.set("id", studyId);
	return url.toString();
}

function endpoint(path: string, params?: Record<string, string | number | undefined>): URL {
	const url = new URL(`${CBIOPORTAL_BASE}${path}`);
	for (const [key, value] of Object.entries(params ?? {})) {
		if (value !== undefined) url.searchParams.set(key, String(value));
	}
	return url;
}

async function requestJson(path: string, params?: Record<string, string | number | undefined>, init?: RequestInit): Promise<RequestResult> {
	const url = endpoint(path, params);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			...init,
			headers: {
				accept: "application/json",
				...(init?.body ? { "content-type": "application/json" } : {}),
				...(init?.headers ?? {}),
			},
			signal: controller.signal,
		});
		if (!response.ok) {
			const body = await response.text().catch(() => "");
			throw new Error(`cBioPortal request failed: ${response.status} ${response.statusText}${body ? ` ${body.slice(0, 180)}` : ""}`);
		}
		const text = await response.text();
		return {
			endpoint: url.toString(),
			headers: response.headers,
			payload: text ? JSON.parse(text) as unknown : undefined,
		};
	} finally {
		clearTimeout(timeout);
	}
}

async function metaCount(path: string, params?: Record<string, string | number | undefined>, init?: RequestInit): Promise<{ count?: number; endpoint: string }> {
	const result = await requestJson(path, { ...params, projection: "META" }, init);
	return {
		count: numberValue(result.headers.get("total-count")),
		endpoint: result.endpoint,
	};
}

function isLikelyStudyId(value: string): boolean {
	return /^[A-Za-z0-9_.-]+$/.test(value);
}

function parseGeneStudy(value: string): { gene: string; studyId: string } {
	const atParts = value.split("@").map((part) => part.trim()).filter(Boolean);
	if (atParts.length === 2 && isLikelyStudyId(atParts[1]!)) {
		return { gene: atParts[0]!, studyId: atParts[1]! };
	}
	const inMatch = value.match(/^(.+?)\s+(?:in|study=)\s+([A-Za-z0-9_.-]+)$/i);
	if (inMatch) return { gene: inMatch[1]!.trim(), studyId: inMatch[2]!.trim() };
	const parts = value.split(/\s+/).filter(Boolean);
	const last = parts.at(-1);
	if (parts.length >= 2 && last && isLikelyStudyId(last)) {
		return { gene: parts.slice(0, -1).join(" "), studyId: last };
	}
	throw new Error("cBioPortal mutation lookup requires gene and study, for example mutations:BRAF@msk_impact_2017.");
}

function parseGeneStudies(value: string): { gene: string; studyIds: string[] } {
	const atParts = value.split("@").map((part) => part.trim()).filter(Boolean);
	if (atParts.length !== 2) {
		throw new Error("cBioPortal mutation frequency requires gene and studies, for example mutation-frequency:KRAS@paad_qcmg_uq_2016,msk_impact_2017.");
	}
	const studyIds = atParts[1]!.split(/[,\s;]+/).map((studyId) => studyId.trim()).filter(Boolean);
	if (!studyIds.length || studyIds.length > 12) throw new Error("cBioPortal mutation frequency requires 1 to 12 study ids.");
	return { gene: atParts[0]!, studyIds };
}

function parseCnaQuery(value: string): { eventType: string; gene: string; studyId: string } {
	const eventMatch = value.match(/\s+(?:event(?:[-_ ]?type)?|type)=([A-Za-z_]+)\s*$/i);
	const eventType = (eventMatch?.[1] ?? "HOMDEL_AND_AMP").toUpperCase();
	if (!CNA_EVENT_TYPES.has(eventType)) throw new Error(`cBioPortal CNA event type must be one of ${Array.from(CNA_EVENT_TYPES).sort().join(", ")}.`);
	const geneStudy = parseGeneStudy(eventMatch ? value.slice(0, eventMatch.index).trim() : value);
	return { ...geneStudy, eventType };
}

function parseQuery(query: string): ParsedQuery {
	const clean = cleanQuery(query);
	const match = clean.match(/^([a-z][a-z0-9_-]*)\s*:\s*(.+)$/i);
	if (!match) return { mode: "study-search", value: clean };
	const key = match[1]!.toLowerCase().replace(/_/g, "-");
	const value = cleanQuery(match[2]!);
	if (key === "studies" || key === "study-search" || key === "cbioportal-list-studies") return { mode: "study-search", value };
	if (key === "study" || key === "study-id" || key === "cbioportal-get-study") {
		return isLikelyStudyId(value) ? { mode: "study-detail", studyId: value } : { mode: "study-search", value };
	}
	if (key === "profiles" || key === "molecular-profiles") return { mode: "molecular-profiles", studyId: value };
	if (key === "attributes" || key === "clinical-attributes" || key === "cbioportal-clinical-attributes") return { mode: "clinical-attributes", studyId: value };
	if (key === "samples") return { mode: "samples", studyId: value };
	if (key === "cancer-type" || key === "cancer-types") return { mode: "cancer-types", value };
	if (key === "mutations" || key === "gene-mutations" || key === "cbioportal-mutations-in-gene") return { mode: "gene-mutations", ...parseGeneStudy(value) };
	if (key === "mutation-frequency" || key === "cbioportal-mutation-frequency") return { mode: "mutation-frequency", ...parseGeneStudies(value) };
	if (key === "cna" || key === "copy-number" || key === "cbioportal-cna-in-gene") return { mode: "cna-in-gene", ...parseCnaQuery(value) };
	return { mode: "study-search", value: clean };
}

function normalizeStudy(record: Record<string, unknown>, options?: { detailed?: boolean }): Record<string, unknown> {
	const cancerType = recordValue(record.cancerType);
	const studyId = stringValue(record.studyId);
	return {
		studyId,
		name: stringValue(record.name),
		description: options?.detailed ? stripHtml(stringValue(record.description)) : trimText(stringValue(record.description)),
		cancerTypeId: stringValue(record.cancerTypeId),
		cancerTypeName: stringValue(cancerType.name),
		cancerTypeShortName: stringValue(cancerType.shortName),
		referenceGenome: stringValue(record.referenceGenome),
		pmid: stringValue(record.pmid),
		citation: stringValue(record.citation),
		groups: stringValue(record.groups),
		publicStudy: booleanValue(record.publicStudy),
		status: numberValue(record.status),
		importDate: stringValue(record.importDate),
		allSampleCount: numberValue(record.allSampleCount),
		sequencedSampleCount: numberValue(record.sequencedSampleCount),
		cnaSampleCount: numberValue(record.cnaSampleCount),
		mrnaRnaSeqSampleCount: numberValue(record.mrnaRnaSeqSampleCount),
		mrnaRnaSeqV2SampleCount: numberValue(record.mrnaRnaSeqV2SampleCount),
		treatmentCount: numberValue(record.treatmentCount),
		structuralVariantCount: numberValue(record.structuralVariantCount),
		url: studyUrl(studyId),
	};
}

function normalizeMolecularProfile(record: Record<string, unknown>): Record<string, unknown> {
	return {
		molecularProfileId: stringValue(record.molecularProfileId),
		studyId: stringValue(record.studyId),
		molecularAlterationType: stringValue(record.molecularAlterationType),
		datatype: stringValue(record.datatype),
		name: stringValue(record.name),
		description: trimText(stringValue(record.description)),
		showProfileInAnalysisTab: booleanValue(record.showProfileInAnalysisTab),
		patientLevel: booleanValue(record.patientLevel),
		genericAssayType: stringValue(record.genericAssayType),
	};
}

function normalizeCancerType(record: Record<string, unknown>): Record<string, unknown> {
	const cancerTypeId = stringValue(record.cancerTypeId) ?? stringValue(record.id);
	return {
		cancerTypeId,
		name: stringValue(record.name),
		shortName: stringValue(record.shortName),
		parent: stringValue(record.parent),
		dedicatedColor: stringValue(record.dedicatedColor),
	};
}

function normalizeClinicalAttribute(record: Record<string, unknown>): Record<string, unknown> {
	return {
		clinicalAttributeId: stringValue(record.clinicalAttributeId),
		studyId: stringValue(record.studyId),
		displayName: stringValue(record.displayName),
		description: trimText(stringValue(record.description)),
		datatype: stringValue(record.datatype),
		level: record.patientAttribute === true ? "patient" : "sample",
		priority: numberValue(record.priority),
	};
}

function normalizeSample(record: Record<string, unknown>): Record<string, unknown> {
	return {
		sampleId: stringValue(record.sampleId),
		patientId: stringValue(record.patientId),
		studyId: stringValue(record.studyId),
		sampleType: stringValue(record.sampleType),
		cancerTypeId: stringValue(record.cancerTypeId),
		cancerTypeDetailed: stringValue(record.cancerTypeDetailed),
	};
}

function normalizeGene(record: Record<string, unknown>): Record<string, unknown> {
	const symbol = stringValue(record.hugoGeneSymbol);
	return {
		hugoGeneSymbol: symbol,
		entrezGeneId: numberValue(record.entrezGeneId),
		type: stringValue(record.type),
		url: symbol ? `https://www.cbioportal.org/results/mutations?gene_list=${encodeURIComponent(symbol)}` : undefined,
	};
}

function normalizeMutation(record: Record<string, unknown>): Record<string, unknown> {
	return {
		studyId: stringValue(record.studyId),
		molecularProfileId: stringValue(record.molecularProfileId),
		sampleId: stringValue(record.sampleId),
		patientId: stringValue(record.patientId),
		entrezGeneId: numberValue(record.entrezGeneId),
		proteinChange: stringValue(record.proteinChange),
		mutationType: stringValue(record.mutationType),
		mutationStatus: stringValue(record.mutationStatus),
		chromosome: stringValue(record.chr),
		startPosition: numberValue(record.startPosition),
		endPosition: numberValue(record.endPosition),
		referenceAllele: stringValue(record.referenceAllele),
		variantAllele: stringValue(record.variantAllele),
		variantType: stringValue(record.variantType),
		ncbiBuild: stringValue(record.ncbiBuild),
		refseqMrnaId: stringValue(record.refseqMrnaId),
		proteinPosStart: numberValue(record.proteinPosStart),
		proteinPosEnd: numberValue(record.proteinPosEnd),
		tumorAltCount: numberValue(record.tumorAltCount),
		tumorRefCount: numberValue(record.tumorRefCount),
		keyword: stringValue(record.keyword),
	};
}

function normalizeCna(record: Record<string, unknown>): Record<string, unknown> {
	const alteration = numberValue(record.alteration);
	return {
		sampleId: stringValue(record.sampleId),
		patientId: stringValue(record.patientId),
		alteration,
		alterationLabel: alteration === undefined ? undefined : CNA_LABELS.get(alteration),
	};
}

async function searchStudies(query: string, limit: number): Promise<Record<string, unknown>> {
	const meta = await metaCount("/studies", { keyword: query });
	const result = await requestJson("/studies", {
		keyword: query,
		pageNumber: 0,
		pageSize: limit,
		projection: "SUMMARY",
	});
	const results = arrayValue(result.payload).map((item) => normalizeStudy(recordValue(item)));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "cbioportal",
		query,
		searchMode: "study-search",
		totalCount: meta.count ?? results.length,
		returned: results.length,
		results,
		provenance: { docs: DOCS, endpoints: [meta.endpoint, result.endpoint] },
	};
}

async function studyDetail(studyId: string, limit: number): Promise<Record<string, unknown>> {
	const detail = await requestJson(`/studies/${seg(studyId)}`, { projection: "DETAILED" });
	const sampleMeta = await metaCount(`/studies/${seg(studyId)}/samples`);
	const patientMeta = await metaCount(`/studies/${seg(studyId)}/patients`);
	const profiles = await requestJson(`/studies/${seg(studyId)}/molecular-profiles`, {
		pageNumber: 0,
		pageSize: limit,
		projection: "SUMMARY",
	});
	const result = normalizeStudy(recordValue(detail.payload), { detailed: true });
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "cbioportal",
		query: `study:${studyId}`,
		searchMode: "study-detail",
		totalCount: 1,
		returned: 1,
		results: [{
			...result,
			sampleCount: sampleMeta.count,
			patientCount: patientMeta.count,
			molecularProfiles: arrayValue(profiles.payload).map((item) => normalizeMolecularProfile(recordValue(item))),
		}],
		provenance: { docs: DOCS, endpoints: [detail.endpoint, sampleMeta.endpoint, patientMeta.endpoint, profiles.endpoint] },
	};
}

async function molecularProfiles(studyId: string, limit: number): Promise<Record<string, unknown>> {
	const meta = await metaCount(`/studies/${seg(studyId)}/molecular-profiles`);
	const result = await requestJson(`/studies/${seg(studyId)}/molecular-profiles`, {
		pageNumber: 0,
		pageSize: limit,
		projection: "SUMMARY",
	});
	const results = arrayValue(result.payload).map((item) => normalizeMolecularProfile(recordValue(item)));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "cbioportal",
		query: `profiles:${studyId}`,
		searchMode: "molecular-profiles",
		studyId,
		totalCount: meta.count ?? results.length,
		returned: results.length,
		results,
		provenance: { docs: DOCS, endpoints: [meta.endpoint, result.endpoint] },
	};
}

async function clinicalAttributes(studyId: string, limit: number): Promise<Record<string, unknown>> {
	const meta = await metaCount(`/studies/${seg(studyId)}/clinical-attributes`);
	const result = await requestJson(`/studies/${seg(studyId)}/clinical-attributes`, {
		pageNumber: 0,
		pageSize: limit,
		projection: "SUMMARY",
	});
	const results = arrayValue(result.payload).map((item) => normalizeClinicalAttribute(recordValue(item)));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "cbioportal",
		query: `clinical-attributes:${studyId}`,
		searchMode: "clinical-attributes",
		studyId,
		totalCount: meta.count ?? results.length,
		returned: results.length,
		results,
		provenance: { docs: DOCS, endpoints: [meta.endpoint, result.endpoint] },
	};
}

async function samples(studyId: string, limit: number): Promise<Record<string, unknown>> {
	const meta = await metaCount(`/studies/${seg(studyId)}/samples`);
	const result = await requestJson(`/studies/${seg(studyId)}/samples`, {
		pageNumber: 0,
		pageSize: limit,
		projection: "SUMMARY",
	});
	const results = arrayValue(result.payload).map((item) => normalizeSample(recordValue(item)));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "cbioportal",
		query: `samples:${studyId}`,
		searchMode: "samples",
		studyId,
		totalCount: meta.count ?? results.length,
		returned: results.length,
		results,
		provenance: { docs: DOCS, endpoints: [meta.endpoint, result.endpoint] },
	};
}

async function cancerTypes(query: string, limit: number): Promise<Record<string, unknown>> {
	const meta = await metaCount("/cancer-types");
	const result = await requestJson("/cancer-types", {
		pageNumber: 0,
		pageSize: 10_000,
		projection: "SUMMARY",
	});
	const queryLower = query.toLowerCase();
	const results = arrayValue(result.payload)
		.map((item) => normalizeCancerType(recordValue(item)))
		.filter((item) => [item.cancerTypeId, item.name, item.shortName, item.parent]
			.some((value) => String(value ?? "").toLowerCase().includes(queryLower)))
		.slice(0, limit);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "cbioportal",
		query: `cancer-type:${query}`,
		searchMode: "cancer-types",
		totalCount: meta.count,
		returned: results.length,
		results,
		provenance: { docs: DOCS, endpoints: [meta.endpoint, result.endpoint] },
	};
}

async function mutationProfileForStudy(studyId: string): Promise<{ endpoint: string; profile: Record<string, unknown> }> {
	return molecularProfileForStudy(studyId, "MUTATION_EXTENDED");
}

async function molecularProfileForStudy(studyId: string, alterationType: string, datatype?: string): Promise<{ endpoint: string; profile: Record<string, unknown> }> {
	const result = await requestJson(`/studies/${seg(studyId)}/molecular-profiles`, { projection: "SUMMARY" });
	const profiles = arrayValue(result.payload).map((item) => recordValue(item));
	const profile = profiles.find((item) => stringValue(item.molecularAlterationType) === alterationType && (!datatype || stringValue(item.datatype) === datatype));
	if (!profile) {
		const available = profiles.map((item) => [stringValue(item.molecularAlterationType), stringValue(item.datatype)].filter(Boolean).join("/")).filter(Boolean).sort();
		throw new Error(`cBioPortal study ${studyId} has no ${alterationType}${datatype ? `/${datatype}` : ""} molecular profile. Available profiles: ${available.join(", ") || "none"}.`);
	}
	return { endpoint: result.endpoint, profile };
}

async function allSampleListId(studyId: string): Promise<{ endpoint: string; sampleListId: string }> {
	const sampleListId = `${studyId}_all`;
	const result = await requestJson("/sample-lists/fetch", { projection: "SUMMARY" }, {
		method: "POST",
		body: JSON.stringify([sampleListId]),
	});
	const found = arrayValue(result.payload).some((item) => stringValue(recordValue(item).sampleListId) === sampleListId);
	if (!found) throw new Error(`cBioPortal study ${studyId} has no ${sampleListId} sample list.`);
	return { endpoint: result.endpoint, sampleListId };
}

async function geneMutations(geneSymbol: string, studyId: string, limit: number): Promise<Record<string, unknown>> {
	const gene = await requestJson(`/genes/${seg(geneSymbol.toUpperCase())}`);
	const normalizedGene = normalizeGene(recordValue(gene.payload));
	const entrezGeneId = numberValue(normalizedGene.entrezGeneId);
	if (entrezGeneId === undefined) throw new Error(`cBioPortal could not resolve gene ${geneSymbol}.`);
	const profile = await mutationProfileForStudy(studyId);
	const profileRecord = normalizeMolecularProfile(profile.profile);
	const molecularProfileId = stringValue(profileRecord.molecularProfileId);
	if (!molecularProfileId) throw new Error(`cBioPortal study ${studyId} returned a mutation profile without an id.`);
	const sampleList = await allSampleListId(studyId);
	const body = { sampleListId: sampleList.sampleListId, entrezGeneIds: [entrezGeneId] };
	const meta = await metaCount(`/molecular-profiles/${seg(molecularProfileId)}/mutations/fetch`, {
		pageNumber: 0,
		pageSize: 1,
	}, { method: "POST", body: JSON.stringify(body) });
	const result = await requestJson(`/molecular-profiles/${seg(molecularProfileId)}/mutations/fetch`, {
		pageNumber: 0,
		pageSize: limit,
		projection: "SUMMARY",
	}, { method: "POST", body: JSON.stringify(body) });
	const results = arrayValue(result.payload).map((item) => normalizeMutation(recordValue(item)));
	const totalCount = meta.count ?? results.length;
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "cbioportal",
		query: `mutations:${geneSymbol}@${studyId}`,
		searchMode: "gene-mutations",
		studyId,
		sampleListId: body.sampleListId,
		gene: normalizedGene,
		molecularProfile: profileRecord,
		totalCount,
		returned: results.length,
		truncated: totalCount > results.length,
		results,
		provenance: { docs: DOCS, endpoints: [gene.endpoint, profile.endpoint, sampleList.endpoint, meta.endpoint, result.endpoint] },
	};
}

async function fetchAllMutations(molecularProfileId: string, sampleListId: string, entrezGeneId: number): Promise<{ endpoint: string; results: Array<Record<string, unknown>> }> {
	const result = await requestJson(`/molecular-profiles/${seg(molecularProfileId)}/mutations/fetch`, {
		pageNumber: 0,
		pageSize: FULL_PAGE_SIZE,
		projection: "SUMMARY",
	}, { method: "POST", body: JSON.stringify({ sampleListId, entrezGeneIds: [entrezGeneId] }) });
	return {
		endpoint: result.endpoint,
		results: arrayValue(result.payload).map((item) => recordValue(item)),
	};
}

async function mutationFrequency(geneSymbol: string, studyIds: string[]): Promise<Record<string, unknown>> {
	const gene = await requestJson(`/genes/${seg(geneSymbol.toUpperCase())}`);
	const normalizedGene = normalizeGene(recordValue(gene.payload));
	const entrezGeneId = numberValue(normalizedGene.entrezGeneId);
	if (entrezGeneId === undefined) throw new Error(`cBioPortal could not resolve gene ${geneSymbol}.`);
	const studies = await requestJson("/studies/fetch", { projection: "DETAILED" }, { method: "POST", body: JSON.stringify(studyIds) });
	const studyRecords = new Map(arrayValue(studies.payload).map((item) => {
		const record = recordValue(item);
		return [stringValue(record.studyId), record] as const;
	}).filter((entry): entry is [string, Record<string, unknown>] => Boolean(entry[0])));
	const knownStudyIds = [...studyRecords.keys()].sort();
	const profiles = knownStudyIds.length
		? await requestJson("/molecular-profiles/fetch", { projection: "SUMMARY" }, { method: "POST", body: JSON.stringify({ studyIds: knownStudyIds }) })
		: undefined;
	const mutationProfiles = new Map(arrayValue(profiles?.payload).map((item) => recordValue(item))
		.filter((item) => stringValue(item.molecularAlterationType) === "MUTATION_EXTENDED")
		.map((item) => [stringValue(item.studyId), stringValue(item.molecularProfileId)] as const)
		.filter((entry): entry is [string, string] => Boolean(entry[0] && entry[1])));
	const wantedSampleLists = knownStudyIds.map((studyId) => `${studyId}_all`);
	const sampleLists = wantedSampleLists.length
		? await requestJson("/sample-lists/fetch", { projection: "SUMMARY" }, { method: "POST", body: JSON.stringify(wantedSampleLists) })
		: undefined;
	const foundSampleLists = new Set(arrayValue(sampleLists?.payload).map((item) => stringValue(recordValue(item).sampleListId)).filter(Boolean));
	const endpoints = [gene.endpoint, studies.endpoint, profiles?.endpoint, sampleLists?.endpoint].filter(Boolean) as string[];
	const results: Array<Record<string, unknown>> = [];
	const noMutationData: string[] = [];
	for (const studyId of knownStudyIds) {
		const molecularProfileId = mutationProfiles.get(studyId);
		const sampleListId = `${studyId}_all`;
		if (!molecularProfileId || !foundSampleLists.has(sampleListId)) {
			noMutationData.push(studyId);
			continue;
		}
		const mutations = await fetchAllMutations(molecularProfileId, sampleListId, entrezGeneId);
		endpoints.push(mutations.endpoint);
		const mutatedSamples = new Set(mutations.results.map((item) => stringValue(item.sampleId)).filter(Boolean)).size;
		const study = studyRecords.get(studyId) ?? {};
		const sequencedSamples = numberValue(study.sequencedSampleCount) ?? 0;
		results.push({
			studyId,
			studyName: stringValue(study.name),
			molecularProfileId,
			mutationCount: mutations.results.length,
			mutatedSamples,
			sequencedSamples,
			frequency: sequencedSamples ? Math.round((mutatedSamples / sequencedSamples) * 10_000) / 10_000 : undefined,
		});
	}
	results.sort((a, b) => (numberValue(b.frequency) ?? 0) - (numberValue(a.frequency) ?? 0) || String(a.studyId).localeCompare(String(b.studyId)));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "cbioportal",
		query: `mutation-frequency:${geneSymbol}@${studyIds.join(",")}`,
		searchMode: "mutation-frequency",
		gene: normalizedGene,
		totalCount: results.length,
		returned: results.length,
		results,
		unknownStudies: studyIds.filter((studyId) => !studyRecords.has(studyId)).sort(),
		noMutationData,
		provenance: { docs: DOCS, endpoints },
	};
}

async function cnaInGene(geneSymbol: string, studyId: string, eventType: string, limit: number): Promise<Record<string, unknown>> {
	const gene = await requestJson(`/genes/${seg(geneSymbol.toUpperCase())}`);
	const normalizedGene = normalizeGene(recordValue(gene.payload));
	const entrezGeneId = numberValue(normalizedGene.entrezGeneId);
	if (entrezGeneId === undefined) throw new Error(`cBioPortal could not resolve gene ${geneSymbol}.`);
	const profile = await molecularProfileForStudy(studyId, "COPY_NUMBER_ALTERATION", "DISCRETE");
	const profileRecord = normalizeMolecularProfile(profile.profile);
	const molecularProfileId = stringValue(profileRecord.molecularProfileId);
	if (!molecularProfileId) throw new Error(`cBioPortal study ${studyId} returned a discrete copy-number profile without an id.`);
	const sampleList = await allSampleListId(studyId);
	const body = { sampleListId: sampleList.sampleListId, entrezGeneIds: [entrezGeneId] };
	const path = `/molecular-profiles/${seg(molecularProfileId)}/discrete-copy-number/fetch`;
	const meta = await metaCount(path, {
		discreteCopyNumberEventType: eventType,
		pageNumber: 0,
		pageSize: 1,
	}, { method: "POST", body: JSON.stringify(body) });
	const result = await requestJson(path, {
		discreteCopyNumberEventType: eventType,
		pageNumber: 0,
		pageSize: limit,
		projection: "SUMMARY",
	}, { method: "POST", body: JSON.stringify(body) });
	const results = arrayValue(result.payload).map((item) => normalizeCna(recordValue(item)));
	const alterationCounts: Record<string, number> = {};
	for (const row of results) {
		const key = stringValue(row.alterationLabel) ?? String(row.alteration ?? "unknown");
		alterationCounts[key] = (alterationCounts[key] ?? 0) + 1;
	}
	const totalCount = meta.count ?? results.length;
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "cbioportal",
		query: `cna:${geneSymbol}@${studyId} event=${eventType}`,
		searchMode: "cna-in-gene",
		studyId,
		eventType,
		gene: normalizedGene,
		molecularProfile: profileRecord,
		totalCount,
		returned: results.length,
		alteredSampleCount: new Set(results.map((item) => stringValue(item.sampleId)).filter(Boolean)).size,
		alterationCounts,
		truncated: totalCount > results.length,
		results,
		provenance: { docs: DOCS, endpoints: [gene.endpoint, profile.endpoint, sampleList.endpoint, meta.endpoint, result.endpoint] },
	};
}

export async function searchCbioportal(params: CbioportalSearchParams): Promise<Record<string, unknown>> {
	const limit = safeLimit(params.limit);
	const parsed = parseQuery(params.query);
	if (parsed.mode === "study-detail") return studyDetail(parsed.studyId, limit);
	if (parsed.mode === "molecular-profiles") return molecularProfiles(parsed.studyId, limit);
	if (parsed.mode === "clinical-attributes") return clinicalAttributes(parsed.studyId, limit);
	if (parsed.mode === "samples") return samples(parsed.studyId, limit);
	if (parsed.mode === "cancer-types") return cancerTypes(parsed.value, limit);
	if (parsed.mode === "gene-mutations") return geneMutations(parsed.gene, parsed.studyId, limit);
	if (parsed.mode === "mutation-frequency") return mutationFrequency(parsed.gene, parsed.studyIds);
	if (parsed.mode === "cna-in-gene") return cnaInGene(parsed.gene, parsed.studyId, parsed.eventType, limit);
	return searchStudies(parsed.value, limit);
}
