type CivicSearchParams = { limit?: number; query: string };

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 30_000;
const CIVIC_GRAPHQL_URL = "https://civicdb.org/api/graphql";
const CIVIC_BASE_URL = "https://civicdb.org";
const CIVIC_DOCS = [
	"https://civic.readthedocs.io/en/latest/api.html",
	"https://civicdb.org/api/graphiql",
	"https://civicdb.org/pages/help",
];

const CIVIC_GENE_FIELDS = `
  id
  name
  entrezId
  fullName
  featureAliases
  description
  link
`;

const CIVIC_MOLECULAR_PROFILE_FIELDS = `
  id
  name
  rawName
  link
  description
  molecularProfileScore
  isComplex
  isMultiVariant
  molecularProfileAliases
  variants { id name feature { id name } }
  evidenceCountsByStatus { acceptedCount submittedCount rejectedCount }
`;

const CIVIC_EVIDENCE_FIELDS = `
  id
  name
  status
  evidenceLevel
  evidenceType
  evidenceDirection
  significance
  evidenceRating
  variantOrigin
  therapyInteractionType
  description
  link
  disease { id name doid displayName }
  therapies { id name ncitId }
  molecularProfile { id name }
  source { id sourceType citationId citation }
  phenotypes { id hpoId name }
`;

const CIVIC_ASSERTION_FIELDS = `
  id
  name
  status
  assertionType
  assertionDirection
  significance
  ampLevel
  summary
  description
  link
  variantOrigin
  therapyInteractionType
  regulatoryApproval
  fdaCompanionTest
  disease { id name doid displayName }
  therapies { id name ncitId }
  molecularProfile { id name }
  phenotypes { id hpoId name }
  evidenceItemsCount
`;

const CIVIC_VARIANT_FIELDS = `
  id
  name
  link
  variantAliases
  variantTypes { id name soid }
  feature { id name }
  singleVariantMolecularProfileId
  ... on GeneVariant {
    alleleRegistryId
    clinvarIds
    hgvsDescriptions
    coordinates {
      chromosome
      start
      stop
      referenceBases
      variantBases
      referenceBuild
      ensemblVersion
      representativeTranscript
    }
  }
`;

const CIVIC_DISEASE_FIELDS = `
  id
  name
  displayName
  doid
  diseaseUrl
  diseaseAliases
  link
`;

const CIVIC_THERAPY_FIELDS = `
  id
  name
  ncitId
  therapyUrl
  therapyAliases
  link
`;

const CIVIC_GENES_QUERY = `
query CivicGenes($first: Int, $symbols: [String!]) {
  genes(first: $first, entrezSymbols: $symbols) {
    totalCount
    nodes { ${CIVIC_GENE_FIELDS} }
  }
}
`;

const CIVIC_VARIANTS_QUERY = `
query CivicVariants($first: Int, $name: String, $geneId: Int) {
  variants(first: $first, name: $name, geneId: $geneId) {
    totalCount
    nodes { ${CIVIC_VARIANT_FIELDS} }
  }
}
`;

const CIVIC_DISEASES_QUERY = `
query CivicDiseases($first: Int, $name: String) {
  diseases(first: $first, name: $name) {
    totalCount
    nodes { ${CIVIC_DISEASE_FIELDS} }
  }
}
`;

const CIVIC_THERAPIES_QUERY = `
query CivicTherapies($first: Int, $name: String) {
  therapies(first: $first, name: $name) {
    totalCount
    nodes { ${CIVIC_THERAPY_FIELDS} }
  }
}
`;

const CIVIC_SINGLE_VARIANT_QUERY = `
query CivicVariant($id: Int!) {
  variant(id: $id) { ${CIVIC_VARIANT_FIELDS} }
}
`;

const CIVIC_SINGLE_EVIDENCE_QUERY = `
query CivicEvidenceItem($id: Int!) {
  evidenceItem(id: $id) { ${CIVIC_EVIDENCE_FIELDS} }
}
`;

const CIVIC_SINGLE_ASSERTION_QUERY = `
query CivicAssertion($id: Int!) {
  assertion(id: $id) { ${CIVIC_ASSERTION_FIELDS} }
}
`;

const CIVIC_SINGLE_MOLECULAR_PROFILE_QUERY = `
query CivicMolecularProfile($id: Int!) {
  molecularProfile(id: $id) { ${CIVIC_MOLECULAR_PROFILE_FIELDS} }
}
`;

const CIVIC_MOLECULAR_PROFILES_QUERY = `
query CivicMolecularProfiles($first: Int, $name: String) {
  molecularProfiles(first: $first, name: $name) {
    totalCount
    nodes { ${CIVIC_MOLECULAR_PROFILE_FIELDS} }
  }
}
`;

const CIVIC_EVIDENCE_QUERY = `
query CivicEvidence($first: Int, $name: String) {
  evidenceItems(first: $first, molecularProfileName: $name, status: ACCEPTED, sortBy: { column: ID, direction: ASC }) {
    totalCount
    nodes { ${CIVIC_EVIDENCE_FIELDS} }
  }
}
`;

const CIVIC_ASSERTIONS_QUERY = `
query CivicAssertions($first: Int, $name: String) {
  assertions(first: $first, molecularProfileName: $name, status: ACCEPTED, sortBy: { column: ID, direction: ASC }) {
    totalCount
    nodes { ${CIVIC_ASSERTION_FIELDS} }
  }
}
`;

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
	if (!clean) throw new Error("Science database search requires a non-empty query.");
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

function absoluteCivicUrl(path: string | undefined): string | undefined {
	if (!path) return undefined;
	if (path.startsWith("http")) return path;
	return `${CIVIC_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

function prefixedCivicValue(query: string, prefixes: string[]): string | undefined {
	const lower = query.toLowerCase();
	const prefix = prefixes.find((item) => lower.startsWith(item));
	return prefix ? query.slice(prefix.length).trim() : undefined;
}

function namedCivicValue(query: string, name: string): string | undefined {
	const prefix = `${name}:`;
	return query.toLowerCase().startsWith(prefix) ? query.slice(prefix.length).trim() : undefined;
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

function positiveInt(value: string | undefined, label: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} requires a positive integer id.`);
	return parsed;
}

async function fetchCivicGraphql(query: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	let payload: Record<string, unknown>;
	try {
		const response = await fetch(CIVIC_GRAPHQL_URL, {
			body: JSON.stringify({ query, variables }),
			headers: {
				accept: "application/json",
				"content-type": "application/json",
			},
			method: "POST",
			signal: controller.signal,
		});
		if (!response.ok) {
			throw new Error(`CIViC GraphQL request failed: ${response.status} ${response.statusText}`);
		}
		payload = recordValue(await response.json());
	} finally {
		clearTimeout(timeout);
	}
	const errors = arrayValue(payload.errors);
	if (errors.length) {
		const messages = errors.map((error) => stringValue(recordValue(error).message) ?? "unknown GraphQL error");
		throw new Error(`CIViC GraphQL errors: ${messages.join("; ")}`);
	}
	return recordValue(payload.data);
}

function normalizeCivicDisease(record: Record<string, unknown>): Record<string, unknown> {
	return compactRecord({
		id: numberValue(record.id),
		name: stringValue(record.name),
		displayName: stringValue(record.displayName),
		doid: stringValue(record.doid),
	});
}

function normalizeCivicTherapy(record: Record<string, unknown>): Record<string, unknown> {
	return compactRecord({
		id: numberValue(record.id),
		name: stringValue(record.name),
		ncitId: stringValue(record.ncitId),
	});
}

function normalizeCivicSource(record: Record<string, unknown>): Record<string, unknown> {
	const citationId = stringValue(record.citationId);
	const sourceType = stringValue(record.sourceType);
	return compactRecord({
		id: numberValue(record.id),
		sourceType,
		citationId,
		citation: stringValue(record.citation),
		url: sourceType === "PUBMED" && citationId ? `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(citationId)}/` : undefined,
	});
}

function normalizeCivicMolecularProfileRef(record: Record<string, unknown>): Record<string, unknown> {
	return compactRecord({
		id: numberValue(record.id),
		name: stringValue(record.name),
		url: numberValue(record.id) ? `${CIVIC_BASE_URL}/molecular-profiles/${record.id}` : undefined,
	});
}

function normalizeCivicGene(record: Record<string, unknown>): Record<string, unknown> {
	return compactRecord({
		id: numberValue(record.id),
		name: stringValue(record.name),
		entrezId: numberValue(record.entrezId),
		fullName: stringValue(record.fullName),
		aliases: arrayValue(record.featureAliases).map(String).sort(),
		description: stringValue(record.description),
		url: absoluteCivicUrl(stringValue(record.link)),
	});
}

function normalizeCivicMolecularProfile(record: Record<string, unknown>): Record<string, unknown> {
	const evidenceCounts = recordValue(record.evidenceCountsByStatus);
	return compactRecord({
		id: numberValue(record.id),
		name: stringValue(record.name),
		rawName: stringValue(record.rawName),
		description: stringValue(record.description),
		score: numberValue(record.molecularProfileScore),
		isComplex: booleanValue(record.isComplex),
		isMultiVariant: booleanValue(record.isMultiVariant),
		aliases: arrayValue(record.molecularProfileAliases).map(String).sort(),
		variants: arrayValue(record.variants).map((variant) => {
			const item = recordValue(variant);
			const feature = recordValue(item.feature);
			return compactRecord({
				id: numberValue(item.id),
				name: stringValue(item.name),
				geneId: numberValue(feature.id),
				gene: stringValue(feature.name),
			});
		}),
		evidenceCounts: compactRecord({
			accepted: numberValue(evidenceCounts.acceptedCount),
			submitted: numberValue(evidenceCounts.submittedCount),
			rejected: numberValue(evidenceCounts.rejectedCount),
		}),
		url: absoluteCivicUrl(stringValue(record.link)),
	});
}

function normalizeCivicVariant(record: Record<string, unknown>): Record<string, unknown> {
	const feature = recordValue(record.feature);
	return compactRecord({
		id: numberValue(record.id),
		name: stringValue(record.name),
		aliases: arrayValue(record.variantAliases).map(String).sort(),
		variantTypes: arrayValue(record.variantTypes).map((variantType) => {
			const item = recordValue(variantType);
			return compactRecord({
				id: numberValue(item.id),
				name: stringValue(item.name),
				soid: stringValue(item.soid),
			});
		}).sort((a, b) => `${stringValue(a.soid) ?? ""}${numberValue(a.id) ?? 0}`.localeCompare(`${stringValue(b.soid) ?? ""}${numberValue(b.id) ?? 0}`)),
		feature: compactRecord({
			id: numberValue(feature.id),
			name: stringValue(feature.name),
		}),
		singleVariantMolecularProfileId: numberValue(record.singleVariantMolecularProfileId),
		alleleRegistryId: stringValue(record.alleleRegistryId),
		clinvarIds: arrayValue(record.clinvarIds).map(String).sort(),
		hgvsDescriptions: arrayValue(record.hgvsDescriptions).map(String).sort(),
		coordinates: recordValue(record.coordinates),
		url: absoluteCivicUrl(stringValue(record.link)),
	});
}

function normalizeCivicSearchDisease(record: Record<string, unknown>): Record<string, unknown> {
	return compactRecord({
		id: numberValue(record.id),
		name: stringValue(record.name),
		displayName: stringValue(record.displayName),
		doid: stringValue(record.doid),
		diseaseUrl: stringValue(record.diseaseUrl),
		aliases: arrayValue(record.diseaseAliases).map(String).sort(),
		url: absoluteCivicUrl(stringValue(record.link)),
	});
}

function normalizeCivicSearchTherapy(record: Record<string, unknown>): Record<string, unknown> {
	return compactRecord({
		id: numberValue(record.id),
		name: stringValue(record.name),
		ncitId: stringValue(record.ncitId),
		therapyUrl: stringValue(record.therapyUrl),
		aliases: arrayValue(record.therapyAliases).map(String).sort(),
		url: absoluteCivicUrl(stringValue(record.link)),
	});
}

function normalizeCivicEvidence(record: Record<string, unknown>): Record<string, unknown> {
	return compactRecord({
		id: numberValue(record.id),
		name: stringValue(record.name),
		status: stringValue(record.status),
		evidenceLevel: stringValue(record.evidenceLevel),
		evidenceType: stringValue(record.evidenceType),
		evidenceDirection: stringValue(record.evidenceDirection),
		significance: stringValue(record.significance),
		evidenceRating: numberValue(record.evidenceRating),
		variantOrigin: stringValue(record.variantOrigin),
		therapyInteractionType: stringValue(record.therapyInteractionType),
		description: stringValue(record.description),
		disease: normalizeCivicDisease(recordValue(record.disease)),
		therapies: arrayValue(record.therapies).map((therapy) => normalizeCivicTherapy(recordValue(therapy))),
		molecularProfile: normalizeCivicMolecularProfileRef(recordValue(record.molecularProfile)),
		source: normalizeCivicSource(recordValue(record.source)),
		phenotypes: arrayValue(record.phenotypes).map((phenotype) => {
			const item = recordValue(phenotype);
			return compactRecord({
				id: numberValue(item.id),
				hpoId: stringValue(item.hpoId),
				name: stringValue(item.name),
			});
		}),
		url: absoluteCivicUrl(stringValue(record.link)),
	});
}

function normalizeCivicAssertion(record: Record<string, unknown>): Record<string, unknown> {
	return compactRecord({
		id: numberValue(record.id),
		name: stringValue(record.name),
		status: stringValue(record.status),
		assertionType: stringValue(record.assertionType),
		assertionDirection: stringValue(record.assertionDirection),
		significance: stringValue(record.significance),
		ampLevel: stringValue(record.ampLevel),
		summary: stringValue(record.summary),
		description: stringValue(record.description),
		variantOrigin: stringValue(record.variantOrigin),
		therapyInteractionType: stringValue(record.therapyInteractionType),
		regulatoryApproval: booleanValue(record.regulatoryApproval),
		fdaCompanionTest: booleanValue(record.fdaCompanionTest),
		disease: normalizeCivicDisease(recordValue(record.disease)),
		therapies: arrayValue(record.therapies).map((therapy) => normalizeCivicTherapy(recordValue(therapy))),
		molecularProfile: normalizeCivicMolecularProfileRef(recordValue(record.molecularProfile)),
		phenotypes: arrayValue(record.phenotypes).map((phenotype) => {
			const item = recordValue(phenotype);
			return compactRecord({
				id: numberValue(item.id),
				hpoId: stringValue(item.hpoId),
				name: stringValue(item.name),
			});
		}),
		evidenceItemsCount: numberValue(record.evidenceItemsCount),
		url: absoluteCivicUrl(stringValue(record.link)),
	});
}

async function civicSingle(
	query: string,
	graphQl: string,
	root: "assertion" | "evidenceItem" | "molecularProfile" | "variant",
	id: number,
	normalizer: (record: Record<string, unknown>) => Record<string, unknown>,
	mode: string,
): Promise<Record<string, unknown>> {
	const data = await fetchCivicGraphql(graphQl, { id });
	const record = recordValue(data[root]);
	const found = Object.keys(record).length > 0;
	return resultEnvelope(query, mode, found ? 1 : 0, found ? [normalizer(record)] : [], {
		found,
		id,
	});
}

async function civicVariants(query: string, searchMode: string, value: string, limit: number): Promise<Record<string, unknown>> {
	const { rest, values } = parseKeyValues(value);
	const rawGeneId = values.gene_id ?? values.geneid;
	const geneId = rawGeneId ? positiveInt(rawGeneId, `${searchMode} gene_id`) : undefined;
	const name = rest || values.name;
	if (searchMode === "gene-variants" && geneId === undefined) throw new Error("civic_gene_variants requires gene_id=<CIViC gene id> or a bare integer gene id.");
	if (searchMode === "variants" && !name) throw new Error("civic_search_variants requires a variant name substring.");
	const data = await fetchCivicGraphql(CIVIC_VARIANTS_QUERY, {
		first: limit,
		geneId,
		name: searchMode === "gene-variants" ? undefined : name,
	});
	const connection = recordValue(data.variants);
	const results = arrayValue(connection.nodes)
		.map((record) => normalizeCivicVariant(recordValue(record)))
		.sort((a, b) => (numberValue(a.id) ?? 0) - (numberValue(b.id) ?? 0));
	return resultEnvelope(query, searchMode, numberValue(connection.totalCount) ?? results.length, results, compactRecord({
		geneId,
		name,
	}));
}

async function civicNamedConnection(
	query: string,
	searchMode: string,
	graphQl: string,
	connectionName: "diseases" | "molecularProfiles" | "therapies",
	name: string,
	limit: number,
	normalizer: (record: Record<string, unknown>) => Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const data = await fetchCivicGraphql(graphQl, { first: limit, name });
	const connection = recordValue(data[connectionName]);
	const results = arrayValue(connection.nodes)
		.map((record) => normalizer(recordValue(record)))
		.sort((a, b) => (numberValue(a.id) ?? 0) - (numberValue(b.id) ?? 0));
	return resultEnvelope(query, searchMode, numberValue(connection.totalCount) ?? results.length, results);
}

async function civicConnection(
	query: string,
	variables: Record<string, unknown>,
	connectionName: "assertions" | "evidenceItems" | "genes" | "molecularProfiles",
): Promise<{ nodes: Record<string, unknown>[]; totalCount: number }> {
	const data = await fetchCivicGraphql(query, variables);
	const connection = recordValue(data[connectionName]);
	return {
		nodes: arrayValue(connection.nodes).map((node) => recordValue(node)),
		totalCount: numberValue(connection.totalCount) ?? 0,
	};
}

function resultEnvelope(
	query: string,
	searchMode: string,
	totalCount: number,
	results: Record<string, unknown>[],
	extra: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "civic",
		query,
		searchMode,
		totalCount,
		returned: results.length,
		truncated: totalCount > results.length,
		results,
		...extra,
		provenance: {
			docs: CIVIC_DOCS,
			endpoints: [CIVIC_GRAPHQL_URL],
		},
	};
}

export async function searchCivic(params: CivicSearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const searchGenes = namedCivicValue(query, "civic_search_genes");
	if (searchGenes !== undefined) {
		if (!searchGenes) throw new Error("civic_search_genes requires an Entrez gene symbol.");
		const connection = await civicConnection(CIVIC_GENES_QUERY, { first: limit, symbols: [searchGenes] }, "genes");
		const results = connection.nodes.map((record) => normalizeCivicGene(record));
		return resultEnvelope(query, "genes", connection.totalCount, results);
	}
	const geneVariants = namedCivicValue(query, "civic_gene_variants");
	if (geneVariants !== undefined) {
		const { rest, values } = parseKeyValues(geneVariants);
		const geneId = values.gene_id ?? values.geneid ?? rest;
		return civicVariants(query, "gene-variants", `gene_id=${geneId}`, limit);
	}
	const getVariant = namedCivicValue(query, "civic_get_variant");
	if (getVariant !== undefined) {
		return civicSingle(query, CIVIC_SINGLE_VARIANT_QUERY, "variant", positiveInt(getVariant, "civic_get_variant"), normalizeCivicVariant, "variant");
	}
	const searchVariants = namedCivicValue(query, "civic_search_variants");
	if (searchVariants !== undefined) return civicVariants(query, "variants", searchVariants, limit);
	const getEvidence = namedCivicValue(query, "civic_get_evidence_item");
	if (getEvidence !== undefined) {
		return civicSingle(query, CIVIC_SINGLE_EVIDENCE_QUERY, "evidenceItem", positiveInt(getEvidence, "civic_get_evidence_item"), normalizeCivicEvidence, "evidence-item");
	}
	const searchEvidence = namedCivicValue(query, "civic_search_evidence");
	if (searchEvidence !== undefined) {
		const { rest, values } = parseKeyValues(searchEvidence);
		const evidenceQuery = values.molecular_profile_name ?? values.profile ?? rest;
		if (!evidenceQuery) throw new Error("civic_search_evidence requires a molecular profile name or molecular_profile_name=<name>.");
		const connection = await civicConnection(CIVIC_EVIDENCE_QUERY, { first: limit, name: evidenceQuery }, "evidenceItems");
		const results = connection.nodes.map((record) => normalizeCivicEvidence(record));
		return resultEnvelope(query, "evidence", connection.totalCount, results, { molecularProfileName: evidenceQuery });
	}
	const getAssertion = namedCivicValue(query, "civic_get_assertion");
	if (getAssertion !== undefined) {
		return civicSingle(query, CIVIC_SINGLE_ASSERTION_QUERY, "assertion", positiveInt(getAssertion, "civic_get_assertion"), normalizeCivicAssertion, "assertion");
	}
	const searchAssertions = namedCivicValue(query, "civic_search_assertions");
	if (searchAssertions !== undefined) {
		const { rest, values } = parseKeyValues(searchAssertions);
		const assertionQuery = values.molecular_profile_name ?? values.profile ?? rest;
		if (!assertionQuery) throw new Error("civic_search_assertions requires a molecular profile name or molecular_profile_name=<name>.");
		const connection = await civicConnection(CIVIC_ASSERTIONS_QUERY, { first: limit, name: assertionQuery }, "assertions");
		const results = connection.nodes.map((record) => normalizeCivicAssertion(record));
		return resultEnvelope(query, "assertions", connection.totalCount, results, { molecularProfileName: assertionQuery });
	}
	const getMolecularProfile = namedCivicValue(query, "civic_get_molecular_profile");
	if (getMolecularProfile !== undefined) {
		return civicSingle(query, CIVIC_SINGLE_MOLECULAR_PROFILE_QUERY, "molecularProfile", positiveInt(getMolecularProfile, "civic_get_molecular_profile"), normalizeCivicMolecularProfile, "molecular-profile");
	}
	const searchMolecularProfiles = namedCivicValue(query, "civic_search_molecular_profiles");
	if (searchMolecularProfiles !== undefined) {
		if (!searchMolecularProfiles) throw new Error("civic_search_molecular_profiles requires a molecular profile name substring.");
		return civicNamedConnection(query, "molecular-profiles", CIVIC_MOLECULAR_PROFILES_QUERY, "molecularProfiles", searchMolecularProfiles, limit, normalizeCivicMolecularProfile);
	}
	const searchDiseases = namedCivicValue(query, "civic_search_diseases");
	if (searchDiseases !== undefined) {
		if (!searchDiseases) throw new Error("civic_search_diseases requires a disease name substring.");
		return civicNamedConnection(query, "diseases", CIVIC_DISEASES_QUERY, "diseases", searchDiseases, limit, normalizeCivicSearchDisease);
	}
	const searchTherapies = namedCivicValue(query, "civic_search_therapies");
	if (searchTherapies !== undefined) {
		if (!searchTherapies) throw new Error("civic_search_therapies requires a therapy name substring.");
		return civicNamedConnection(query, "therapies", CIVIC_THERAPIES_QUERY, "therapies", searchTherapies, limit, normalizeCivicSearchTherapy);
	}
	const gene = prefixedCivicValue(query, ["gene:", "genes:"]);
	if (gene !== undefined) {
		if (!gene) throw new Error("CIViC gene search requires an Entrez gene symbol.");
		const connection = await civicConnection(CIVIC_GENES_QUERY, { first: limit, symbols: [gene] }, "genes");
		const results = connection.nodes.map((record) => normalizeCivicGene(record));
		return resultEnvelope(query, "gene", connection.totalCount, results);
	}
	const profileQuery = prefixedCivicValue(query, ["profile:", "molecular-profile:", "mp:"]);
	if (profileQuery !== undefined) {
		if (!profileQuery) throw new Error("CIViC molecular profile search requires a profile name.");
		const connection = await civicConnection(CIVIC_MOLECULAR_PROFILES_QUERY, { first: limit, name: profileQuery }, "molecularProfiles");
		const results = connection.nodes.map((record) => normalizeCivicMolecularProfile(record));
		return resultEnvelope(query, "molecular-profiles", connection.totalCount, results);
	}
	const evidenceQuery = prefixedCivicValue(query, ["evidence:", "evidence-profile:"]);
	if (evidenceQuery !== undefined) {
		if (!evidenceQuery) throw new Error("CIViC evidence search requires a molecular profile name.");
		const connection = await civicConnection(CIVIC_EVIDENCE_QUERY, { first: limit, name: evidenceQuery }, "evidenceItems");
		const results = connection.nodes.map((record) => normalizeCivicEvidence(record));
		return resultEnvelope(query, "evidence", connection.totalCount, results);
	}
	const assertionQuery = prefixedCivicValue(query, ["assertion:", "assertions:"]);
	if (assertionQuery !== undefined) {
		if (!assertionQuery) throw new Error("CIViC assertion search requires a molecular profile name.");
		const connection = await civicConnection(CIVIC_ASSERTIONS_QUERY, { first: limit, name: assertionQuery }, "assertions");
		const results = connection.nodes.map((record) => normalizeCivicAssertion(record));
		return resultEnvelope(query, "assertions", connection.totalCount, results);
	}
	const [profiles, assertions, evidence] = await Promise.all([
		civicConnection(CIVIC_MOLECULAR_PROFILES_QUERY, { first: limit, name: query }, "molecularProfiles"),
		civicConnection(CIVIC_ASSERTIONS_QUERY, { first: limit, name: query }, "assertions"),
		civicConnection(CIVIC_EVIDENCE_QUERY, { first: limit, name: query }, "evidenceItems"),
	]);
	return resultEnvelope(
		query,
		"molecular-profile-evidence",
		profiles.totalCount,
		profiles.nodes.map((record) => normalizeCivicMolecularProfile(record)),
		{
			assertionsTotalCount: assertions.totalCount,
			assertions: assertions.nodes.map((record) => normalizeCivicAssertion(record)),
			evidenceTotalCount: evidence.totalCount,
			evidenceItems: evidence.nodes.map((record) => normalizeCivicEvidence(record)),
		},
	);
}
