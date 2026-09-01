import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { searchArxiv } from "./science-database-arxiv.js";
import { searchClinicalTrials } from "./science-database-clinical-trials.js";
import { searchChembl, type ChemblEntity } from "./science-database-chembl.js";
import { searchOpenAlex } from "./science-database-openalex.js";
import { searchOmicsArchiveExact } from "./science-database-omics-archives.js";
import { searchPreprints } from "./science-database-preprints.js";
import { searchProteinAnnotationExact } from "./science-database-protein-annotation.js";
import { searchPubMed } from "./science-database-pubmed.js";
import { searchRegulationExact } from "./science-database-regulation.js";
import { searchVariantExact } from "./science-database-variants.js";
import { searchGnomadExact } from "./science-database-gnomad.js";
import { isEuropePmcFullTextQuery, searchEuropePmcFullText } from "./science-database-europepmc-fulltext.js";
import { isSpecialtyScienceDatabaseSource, searchSpecialtyScienceDatabase, type SpecialtyScienceDatabaseSource } from "./science-database-specialty.js";
import { getUniProtEntries } from "./science-database-genes-ontologies.js";
import { searchEnsembl } from "./science-database-ensembl.js";

type CoreScienceDatabaseSource = "arxiv" | "biorxiv" | "chembl" | "clinicaltrials" | "crossref" | "datacite" | "ensembl" | "europepmc" | "medrxiv" | "openalex" | "pdb" | "pubmed" | "uniprot";
type ScienceDatabaseSource = CoreScienceDatabaseSource | SpecialtyScienceDatabaseSource;

type ScienceDatabaseSearchParams = {
	chemblEntity?: ChemblEntity;
	ensemblSpecies?: string;
	limit?: number;
	query: string;
	sort?: "pub_date" | "relevance";
	source: ScienceDatabaseSource;
};

const CROSSREF_BASE = "https://api.crossref.org";
const EUROPE_PMC_SEARCH_URL = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
const DATACITE_BASE = "https://api.datacite.org";
const UNIPROT_SEARCH_URL = "https://rest.uniprot.org/uniprotkb/search";
const RCSB_SEARCH_URL = "https://search.rcsb.org/rcsbsearch/v2/query";
const RCSB_ENTRY_BASE = "https://data.rcsb.org/rest/v1/core/entry";
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 25_000;
const SCIENCE_DATABASE_SOURCE_IDS = [
	"alphafold",
	"antibodyregistry",
	"arxiv",
	"arrayexpress",
	"biomart",
	"biorxiv",
	"bindingdb",
	"cadd",
	"cbioportal",
	"cellguide",
	"chebi",
	"pubmed",
	"clinicaltrials",
	"clinvar",
	"civic",
	"clingen",
	"cosmic",
	"chembl",
	"complexportal",
	"crossref",
	"datacite",
	"dbsnp",
	"depmap",
	"ensembl",
	"encode",
	"emdb",
	"eqtlcatalogue",
	"europepmc",
	"geo",
	"gnomad",
	"grantsgov",
	"gwascatalog",
	"gtex",
	"interpro",
	"intact",
	"jaspar",
	"kegg",
	"medrxiv",
	"metabolights",
	"mgnify",
	"mygene",
	"ols",
	"openalex",
	"openfda",
	"opentargets",
	"panglaodb",
	"pdb",
	"pheweb",
	"pride",
	"proteinatlas",
	"pubchem",
	"quickgo",
	"rfam",
	"rhea",
	"string",
	"ucsc",
	"unibind",
	"uniprot",
	"variation",
	"reactome",
	"zinc",
] as const;
const SCIENCE_DATABASE_SOURCE_SCHEMA = Type.Unsafe({
	description: "Database to search.",
	enum: [...SCIENCE_DATABASE_SOURCE_IDS],
	type: "string",
});
function formatText(value: unknown): string {
	return typeof value === "string" ? value : JSON.stringify(value, null, 2);
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

async function fetchJson(url: URL): Promise<unknown> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			headers: { accept: "application/json" },
			signal: controller.signal,
		});
		if (!response.ok) {
			throw new Error(`Science database request failed: ${response.status} ${response.statusText}`);
		}
		return response.json();
	} finally {
		clearTimeout(timeout);
	}
}

async function postJson(url: URL, body: unknown): Promise<unknown> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			method: "POST",
			headers: {
				accept: "application/json",
				"content-type": "application/json",
			},
			body: JSON.stringify(body),
			signal: controller.signal,
		});
		if (!response.ok) {
			throw new Error(`Science database request failed: ${response.status} ${response.statusText}`);
		}
		return response.json();
	} finally {
		clearTimeout(timeout);
	}
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

function firstString(value: unknown): string | undefined {
	if (typeof value === "string") return stringValue(value);
	if (Array.isArray(value)) {
		for (const item of value) {
			const text = firstString(item);
			if (text) return text;
		}
	}
	return undefined;
}

function dateParts(value: unknown): string | undefined {
	const parts = arrayValue(recordValue(value)["date-parts"])[0];
	if (!Array.isArray(parts)) return undefined;
	return parts.map((part) => String(part).padStart(2, "0")).join("-");
}

function doiUrl(doi: string | undefined): string | undefined {
	return doi ? `https://doi.org/${doi}` : undefined;
}

function crossrefAuthors(value: unknown): string[] {
	return arrayValue(value)
		.map((author) => {
			const record = recordValue(author);
			return [stringValue(record.given), stringValue(record.family)].filter(Boolean).join(" ") || stringValue(record.name);
		})
		.filter((name): name is string => Boolean(name))
		.slice(0, 8);
}

async function searchCrossref(params: ScienceDatabaseSearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const url = new URL(`${CROSSREF_BASE}/works`);
	const mailto = process.env.CROSSREF_MAILTO?.trim() || process.env.NCBI_EMAIL?.trim();
	url.search = new URLSearchParams({
		query,
		rows: String(limit),
		select: "DOI,title,published-print,published-online,issued,container-title,author,is-referenced-by-count,URL,type",
		...(mailto ? { mailto } : {}),
	}).toString();
	const payload = recordValue(await fetchJson(url));
	const message = recordValue(payload.message);
	const results = arrayValue(message.items).flatMap((item) => {
		const record = recordValue(item);
		const doi = stringValue(record.DOI);
		return [{
			doi,
			title: firstString(record.title),
			container: firstString(record["container-title"]),
			type: stringValue(record.type),
			publicationDate: dateParts(record["published-print"]) ?? dateParts(record["published-online"]) ?? dateParts(record.issued),
			authors: crossrefAuthors(record.author),
			citationCount: numberValue(record["is-referenced-by-count"]),
			url: stringValue(record.URL) ?? doiUrl(doi),
			...(doiUrl(doi) ? { doiUrl: doiUrl(doi) } : {}),
		}];
	});
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "crossref",
		query,
		totalCount: numberValue(message["total-results"]) ?? results.length,
		returned: results.length,
		results,
		provenance: {
			docs: "https://www.crossref.org/documentation/retrieve-metadata/rest-api/",
			endpoints: [url.toString()],
		},
	};
}

async function searchEuropePmc(params: ScienceDatabaseSearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	if (isEuropePmcFullTextQuery(query)) return searchEuropePmcFullText({ limit, query });
	const url = new URL(EUROPE_PMC_SEARCH_URL);
	url.search = new URLSearchParams({
		query,
		resultType: "lite",
		cursorMark: "*",
		pageSize: String(limit),
		format: "json",
	}).toString();
	const payload = recordValue(await fetchJson(url));
	const results = arrayValue(recordValue(payload.resultList).result).flatMap((item) => {
		const record = recordValue(item);
		const id = stringValue(record.id);
		const source = stringValue(record.source);
		if (!id || !source) return [];
		const doi = stringValue(record.doi);
		return [{
			id,
			source,
			pmid: stringValue(record.pmid),
			pmcid: stringValue(record.pmcid),
			doi,
			title: stringValue(record.title),
			authors: stringValue(record.authorString),
			journal: stringValue(record.journalTitle),
			publicationYear: numberValue(record.pubYear),
			publicationType: stringValue(record.pubType),
			citedByCount: numberValue(record.citedByCount),
			isOpenAccess: record.isOpenAccess === "Y",
			inPmc: record.inPMC === "Y",
			hasReferences: record.hasReferences === "Y",
			hasTextMinedTerms: record.hasTextMinedTerms === "Y",
			url: `https://europepmc.org/article/${encodeURIComponent(source)}/${encodeURIComponent(id)}`,
			...(doiUrl(doi) ? { doiUrl: doiUrl(doi) } : {}),
		}];
	});
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "europepmc",
		query,
		totalCount: numberValue(payload.hitCount) ?? results.length,
		returned: results.length,
		hasMore: Boolean(stringValue(payload.nextCursorMark)),
		results,
		provenance: {
			docs: "https://europepmc.org/RestfulWebService",
			endpoints: [url.toString()],
		},
	};
}

function dataciteCreators(value: unknown): string[] {
	return arrayValue(value)
		.map((creator) => {
			const record = recordValue(creator);
			return stringValue(record.name) || [stringValue(record.givenName), stringValue(record.familyName)].filter(Boolean).join(" ");
		})
		.filter((name): name is string => Boolean(name))
		.slice(0, 8);
}

async function searchDataCite(params: ScienceDatabaseSearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const url = new URL(`${DATACITE_BASE}/dois`);
	url.search = new URLSearchParams({
		query,
		"page[size]": String(limit),
	}).toString();
	const payload = recordValue(await fetchJson(url));
	const meta = recordValue(payload.meta);
	const results = arrayValue(payload.data).flatMap((item) => {
		const record = recordValue(item);
		const attributes = recordValue(record.attributes);
		const doi = stringValue(attributes.doi) ?? stringValue(record.id);
		return [{
			doi,
			title: firstString(arrayValue(attributes.titles).map((title) => recordValue(title).title)),
			creators: dataciteCreators(attributes.creators),
			publisher: stringValue(attributes.publisher),
			publicationYear: numberValue(attributes.publicationYear),
			resourceType: stringValue(recordValue(attributes.types).resourceTypeGeneral) ?? stringValue(recordValue(attributes.types).resourceType),
			citationCount: numberValue(attributes.citationCount),
			url: stringValue(attributes.url) ?? doiUrl(doi),
			...(doiUrl(doi) ? { doiUrl: doiUrl(doi) } : {}),
		}];
	});
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "datacite",
		query,
		totalCount: numberValue(meta.total) ?? results.length,
		returned: results.length,
		results,
		provenance: {
			docs: "https://support.datacite.org/docs/api",
			endpoints: [url.toString()],
		},
	};
}

function uniProtProteinName(record: Record<string, unknown>): string | undefined {
	const description = recordValue(record.proteinDescription);
	return stringValue(recordValue(recordValue(description.recommendedName).fullName).value)
		?? stringValue(recordValue(recordValue(description.submissionNames).fullName).value);
}

async function searchUniProt(params: ScienceDatabaseSearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	if (/^get_uniprot_entries\b/i.test(query)) return getUniProtEntries(query, limit);
	const url = new URL(UNIPROT_SEARCH_URL);
	url.search = new URLSearchParams({
		query,
		format: "json",
		size: String(limit),
		fields: "accession,id,protein_name,gene_names,organism_name,length,cc_function,xref_pdb",
	}).toString();
	const payload = recordValue(await fetchJson(url));
	const results = arrayValue(payload.results).flatMap((item) => {
		const record = recordValue(item);
		const accession = stringValue(record.primaryAccession);
		if (!accession) return [];
		return [{
			accession,
			entryName: stringValue(record.uniProtkbId),
			proteinName: uniProtProteinName(record),
			genes: arrayValue(record.genes).map((gene) => stringValue(recordValue(recordValue(gene).geneName).value)).filter(Boolean).slice(0, 8),
			organism: stringValue(recordValue(record.organism).scientificName),
			taxonId: numberValue(recordValue(record.organism).taxonId),
			length: numberValue(record.sequenceLength),
			functions: arrayValue(record.comments)
				.filter((comment) => stringValue(recordValue(comment).commentType) === "FUNCTION")
				.flatMap((comment) => arrayValue(recordValue(comment).texts).map((text) => stringValue(recordValue(text).value)).filter(Boolean))
				.slice(0, 3),
			pdbIds: arrayValue(record.uniProtKBCrossReferences)
				.filter((xref) => stringValue(recordValue(xref).database) === "PDB")
				.map((xref) => stringValue(recordValue(xref).id))
				.filter(Boolean)
				.slice(0, 12),
			url: `https://www.uniprot.org/uniprotkb/${accession}/entry`,
		}];
	});
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "uniprot",
		query,
		returned: results.length,
		results,
		provenance: {
			docs: "https://www.uniprot.org/help/programmatic_access",
			endpoints: [url.toString()],
		},
	};
}

function pdbCitation(citations: unknown): Record<string, unknown> | undefined {
	const citation = arrayValue(citations).map((item) => recordValue(item)).find((item) => stringValue(item.title) || stringValue(item.pdbx_database_id_DOI));
	if (!citation) return undefined;
	return {
		title: stringValue(citation.title),
		doi: stringValue(citation.pdbx_database_id_DOI),
		pubmedId: stringValue(citation.pdbx_database_id_PubMed),
		year: numberValue(citation.year),
	};
}

async function searchPdb(params: ScienceDatabaseSearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const searchUrl = new URL(RCSB_SEARCH_URL);
	const payload = recordValue(await postJson(searchUrl, {
		query: { type: "terminal", service: "full_text", parameters: { value: query } },
		return_type: "entry",
		request_options: { paginate: { start: 0, rows: limit } },
	}));
	const hits = arrayValue(payload.result_set).map((hit) => recordValue(hit));
	const entries = await Promise.all(hits.map(async (hit) => {
		const id = stringValue(hit.identifier);
		if (!id) return undefined;
		const entryUrl = new URL(`${RCSB_ENTRY_BASE}/${encodeURIComponent(id)}`);
		const entry = recordValue(await fetchJson(entryUrl));
		return { id, score: numberValue(hit.score), entry, entryUrl };
	}));
	const results = entries.flatMap((item) => {
		if (!item) return [];
		const info = recordValue(item.entry.rcsb_entry_info);
		const accession = recordValue(item.entry.rcsb_accession_info);
		const citation = pdbCitation(item.entry.citation);
		return [{
			pdbId: item.id,
			title: stringValue(recordValue(item.entry.struct).title),
			experimentalMethods: arrayValue(item.entry.exptl).map((method) => stringValue(recordValue(method).method)).filter(Boolean),
			initialReleaseDate: stringValue(accession.initial_release_date),
			revisionDate: stringValue(accession.revision_date),
			resolution: arrayValue(info.resolution_combined).map((value) => numberValue(value)).filter(Boolean),
			polymerEntityCount: numberValue(info.polymer_entity_count),
			depositedAtomCount: numberValue(info.deposited_atom_count),
			score: item.score,
			citation,
			url: `https://www.rcsb.org/structure/${encodeURIComponent(item.id)}`,
			dataApiUrl: item.entryUrl.toString(),
		}];
	});
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "pdb",
		query,
		totalCount: numberValue(payload.total_count) ?? results.length,
		returned: results.length,
		results,
		provenance: {
			docs: ["https://search.rcsb.org/", "https://data.rcsb.org/"],
			endpoints: [searchUrl.toString(), ...entries.flatMap((item) => item?.entryUrl.toString() ?? [])],
		},
	};
}

async function scienceDatabaseSearch(params: ScienceDatabaseSearchParams): Promise<Record<string, unknown>> {
	const variantExact = await searchVariantExact(params);
	if (variantExact) return variantExact;
	const gnomadExact = await searchGnomadExact(params.query, params.limit);
	if (gnomadExact) return gnomadExact;
	const regulationExact = await searchRegulationExact(params);
	if (regulationExact) return regulationExact;
	const omicsArchiveExact = await searchOmicsArchiveExact(params);
	if (omicsArchiveExact) return omicsArchiveExact;
	const proteinAnnotationExact = await searchProteinAnnotationExact(params);
	if (proteinAnnotationExact) return proteinAnnotationExact;
	if (isSpecialtyScienceDatabaseSource(params.source)) {
		return searchSpecialtyScienceDatabase({
			limit: params.limit,
			query: params.query,
			source: params.source,
		});
	}
	if (params.source === "arxiv") return searchArxiv(params);
	if (params.source === "biorxiv") return searchPreprints(params, "biorxiv");
	if (params.source === "pubmed") return searchPubMed(params);
	if (params.source === "clinicaltrials") return searchClinicalTrials(params);
	if (params.source === "chembl") return searchChembl({
		chemblEntity: params.chemblEntity,
		limit: params.limit,
		query: params.query,
		source: "chembl",
	});
	if (params.source === "crossref") return searchCrossref(params);
	if (params.source === "datacite") return searchDataCite(params);
	if (params.source === "ensembl") return searchEnsembl({
		ensemblSpecies: params.ensemblSpecies,
		limit: params.limit,
		query: params.query,
		source: "ensembl",
	});
	if (params.source === "medrxiv") return searchPreprints(params, "medrxiv");
	if (params.source === "openalex") {
		return searchOpenAlex({
			limit: params.limit,
			query: params.query,
			source: params.source,
		});
	}
	if (params.source === "pdb") return searchPdb(params);
	if (params.source === "uniprot") return searchUniProt(params);
	return searchEuropePmc(params);
}

export function registerScienceDatabaseTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "feynman_science_database_search",
		label: "Science Database Search",
		description:
			"Search built-in read-only scientific databases from Feynman chat: PubMed search/metadata/ID conversion/related articles/citation lookup/copyright/PMC full-text routing, Europe PMC metadata and open-access full-text sections, OpenAlex, Crossref, arXiv, bioRxiv, medRxiv, DataCite, ClinicalTrials.gov, Grants.gov, ChEMBL, PubChem, ChEBI, BindingDB, ZINC, BioMart, STRING, IntAct, Complex Portal, KEGG, Rhea, Rfam, UniProt, AlphaFold DB, RCSB PDB, EMDB, Ensembl, MyGene.info, CellGuide, PanglaoDB, Antibody Registry, ClinVar, dbSNP, CADD, NCBI Variation Services, ClinGen, COSMIC, DepMap, cBioPortal, CIViC, Open Targets, GWAS Catalog, eQTL Catalogue, PheWeb/FinnGen PheWAS, openFDA, Human Protein Atlas, OLS, ENCODE, GEO, ArrayExpress/BioStudies, MetaboLights, MGnify, UCSC Genome Browser, UniBind, gnomAD, GTEx, InterPro/Pfam exact protein-annotation modes, PRIDE, JASPAR, QuickGO, and Reactome. Returns stable identifiers, bounded section snippets when requested, source URLs, and endpoint provenance.",
		promptSnippet: "Search PubMed search/metadata/ID conversion/related articles/citation lookup/copyright/full-text routing, Europe PMC metadata/open-access full-text sections, OpenAlex, Crossref, arXiv, bioRxiv, medRxiv, DataCite, ClinicalTrials.gov, Grants.gov, ChEMBL, PubChem, ChEBI, BindingDB, BioMart, STRING, IntAct, Complex Portal, KEGG, Rhea, Rfam, UniProt, AlphaFold DB, RCSB PDB, EMDB, Ensembl, MyGene.info, CellGuide, PanglaoDB, Antibody Registry, ClinVar, dbSNP, CADD, NCBI Variation Services, ClinGen, COSMIC, DepMap, cBioPortal, CIViC, Open Targets, GWAS Catalog, eQTL Catalogue, PheWeb/FinnGen PheWAS, openFDA, Human Protein Atlas, OLS, ENCODE, GEO, ArrayExpress/BioStudies, MetaboLights, MGnify, UCSC Genome Browser, UniBind, ZINC, gnomAD, GTEx, InterPro/Pfam exact protein-annotation modes, PRIDE, JASPAR, QuickGO, or Reactome for source-backed scientific evidence.",
		promptGuidelines: [
					"Use feynman_science_database_search for biomedical literature search, PubMed metadata, PMID/PMCID/DOI conversion, related articles and PMC links, citation matching, copyright/license checks, Europe PMC open-access full-text section lookup, scholarly citation graph, preprints, DOI metadata, dataset DOI metadata, clinical trial search/details/sponsor/eligibility/investigator/endpoint analysis, Grants.gov opportunity search, regulatory drug labels, adverse-event reports, recalls, Drugs@FDA application records, application counts, pharmacologic classes, generic equivalents, ChEMBL compound/drug/ADMET/bioactivity/mechanism/target workflows, protein, InterPro/Pfam domain architecture and entry/family/clan lookup, Human Protein Atlas gene/search records, STRING id mapping/network/similarity records, structure, EM map, macromolecular complex, molecular interaction, gene, cell-type/marker/tissue/source-collection lookup, antibody/RRID/reagent lookup, BioMart mart/dataset/attribute/filter/data lookup, genome-browser assembly/track/region/conservation lookup, direct TF-DNA interaction and UniBind TFBS region lookup, purchasable compound/ZINC ID/SMILES analog/supplier catalog/random screening deck/3D tranche lookup, variant, HGVS/SPDI normalization, clinical interpretation, ClinGen validity/dosage/actionability/VCEP curation, COSMIC mutation autocomplete records, DepMap cancer model and CRISPR dependency records, cBioPortal study/detail/mutation-frequency/mutation/CNA/clinical-attribute records, dbSNP, CADD deleteriousness, population frequency, GWAS association, eQTL association, tissue/protein atlas, cancer study/cohort, target-disease association, drug mechanism, ontology, experiment, expression, omics repository, metabolomics study/file lookup, pathway, reaction, RNA family, protein interaction, binding affinity, drug, target, assay, and molecule lookup before making source-backed scientific claims.",
					"Prefer PubMed for biomedical search, PMID metadata, ID conversion, related-article/PMC link discovery, citation matching, and copyright checks; prefer Europe PMC for open-access full-text section snippets; prefer OpenAlex for scholarly works, exact `openalex_search_works`, `openalex_get_work`, `openalex_citations`, `openalex_references`, `openalex_search_authors`, `openalex_get_author`, and `openalex_venue_info` citation/author/source modes, OA status, and cross-discipline search, Crossref for DOI/member metadata, arXiv for e-print metadata, bioRxiv/medRxiv for preprint DOI lookup, date/category windows, published-preprint links, funder/ROR lookup, and usage/content statistics, DataCite for dataset/research-object DOI metadata, ClinicalTrials.gov for trial search, NCT detail records, sponsor-specific programs, eligibility matching, investigator/contact discovery, and endpoint summaries, Grants.gov for exact `search_grants` opportunity search over keyword, opportunity number, ALN, agency, status, eligibility, category, and instrument filters, ChEMBL for compound name/SMILES similarity/substructure search, drug indications and warnings, calculated ADMET properties, ligand-target bioactivity filters, mechanisms of action, targets, assays, and molecules, PubChem for compound search/detail, SMILES similarity, bioassay summaries, and GHS safety sections, ChEBI for compound search/detail and ontology relations, BindingDB for target ligands and compound-target affinities, ZINC for purchasable compounds, ZINC IDs, supplier catalog codes, SMILES exact/analog searches, random screening sets, and 3D tranche repository locations, BioMart for Ensembl mart discovery, dataset metadata, internal attributes/filters, and constrained gene table retrieval, STRING and IntAct for protein interaction networks, Complex Portal for curated macromolecular complexes, KEGG for compound/gene/pathway entries, exact `get_kegg_entries`, `search_kegg`, and `link_kegg_ids` modes, and batched pathway/reaction/database cross-links or ID conversions, Rhea for biochemical reaction search and reaction detail records, Rfam for exact RNA family metadata, accession/id conversion, seed alignments, covariance models, phylogenetic trees, sequence regions, structure mappings, and sequence search, UniProt and AlphaFold DB for protein records, exact `get_uniprot_entries`, and predicted structures, RCSB PDB for experimental structures, EMDB for cryo-EM map metadata, Ensembl for exact `ensembl_lookup`, `ensembl_xrefs`, `ensembl_vep_variant`, `ensembl_homology`, `ensembl_sequence`, and `ensembl_overlap_region` genome modes, MyGene.info for exact `query_genes`, OLS for exact `list_ontologies`, `search_ontology_terms`, and `get_ontology_term`, QuickGO for exact `get_go_annotations`, Reactome for exact `map_reactome_pathways`, CellGuide for Cell Ontology IDs, cell-type descriptions, marker genes, tissue occurrence, and CELLxGENE source collections, PanglaoDB for curated single-cell marker genes by exact `panglaodb_marker_genes`, `panglaodb_cell_types_for_gene`, and `panglaodb_options` query names plus cell type, gene symbol, organ, species, canonical-marker flag, and sensitivity/specificity scores, Antibody Registry for exact `search_antibodies`, `get_antibody`, `find_antibodies_by_catalog`, and `get_antibody_registry_stats` modes plus RRIDs, catalog numbers, vendors, targets, clones, species, applications, and registry stats, UCSC Genome Browser for assembly lists, track search, exact `ucsc_list_tracks`, `ucsc_chrom_sizes`, `ucsc_track_data`, `ucsc_conservation`, and `ucsc_tfbs_clusters` modes, chromosome sizes, bounded genomic region track rows, conservation scores, and ENCODE TFBS clusters, UniBind for direct TF-DNA interaction datasets, TF/cell-line/JASPAR model metadata, model BED/FASTA/plot links, and UCSC hub-backed TFBS region rows, ClinVar for variant clinical interpretation and review status, dbSNP for rsID records and placements, NCBI Variation Services for single or batch HGVS/SPDI contextualization and VCF/HGVS conversion, CADD for single-SNV RawScore/PHRED scoring, ClinGen for gene-disease validity, dosage sensitivity, actionability reports, VCEP variant classifications, and exact `clingen_*` query names, COSMIC for mutation IDs, CDS/amino-acid changes, GRCh37/38 genomic positions, tissue/histology context, and PubMed links through the NLM Clinical Tables route, DepMap for Sanger Cell Model Passports model IDs, names, tissue/cancer-type metadata, model data availability, gene records, and CRISPR dependency scores, gnomAD for short variant IDs, population allele frequency, gene constraint, structural variants, and mitochondrial variants, cBioPortal for cancer study cohorts, molecular profiles, clinical attributes, samples, cancer types, and gene mutation rows, CIViC for curated cancer genes, variants, molecular profiles, evidence, assertions, diseases, therapies, and exact `civic_*` query names, Open Targets for bounded GraphQL-compatible search, disease-drug rows, disease-target rows, drug records, target-disease association scores, mechanisms of action, clinical candidates, evidence datasource rows, and exact `open_targets_*` query names, GWAS Catalog for exact `gwas_associations_for_variant`, `gwas_associations_for_gene`, `gwas_associations_for_trait`, `gwas_search_traits`, `gwas_search_studies`, `gwas_get_study`, and `gwas_get_variant` human-genetics modes, PheWeb/FinnGen for exact `phewas_instances`, `phewas_variant`, `phewas_finngen_gene`, `phewas_list_phenotypes`, and `phewas_search_phenotypes` PheWAS modes, openFDA for FDA drug labels, adverse-event reports, recall enforcement records, Drugs@FDA NDA/ANDA/BLA applications, sponsor/route/status filters, corpus counts, pharmacologic classes, and generic-equivalent active-ingredient sets, Human Protein Atlas for gene/protein expression context, eQTL Catalogue for exact `eqtl_list_datasets` and `eqtl_associations` molecular-QTL modes plus generic variant-gene association rows, ENCODE and JASPAR for functional genomics and regulation, GEO, ArrayExpress/BioStudies, MetaboLights, MGnify, and PRIDE for omics projects, GTEx for tissue expression, dataset/sample metadata, gene resolution, top-expressed genes, and eQTLs with exact `gtex_*` query names, and InterPro for protein families/domains.",
					"Preserve returned PMIDs, PMCIDs, PubMed related-link IDs, citation-match PMIDs, PubMed copyright/license fields, Europe PMC full-text statuses, section inventories, figure/table/reference counts, OpenAlex W/A/S IDs, OpenAlex DOI claimant notes, source/venue IDs, author ORCIDs, citation/reference counts, OA status, arXiv IDs, preprint DOIs, DOIs, NCT IDs, ChEMBL IDs, ChEMBL mechanism ids/action types, pChEMBL values, activity standard values/units, assay/document ids, drug indication ids, EFO/MeSH terms, max phase values, warning classes, and calculated molecular properties, PubChem CIDs/InChIKeys/SMILES, ChEBI accessions/InChIKeys/SMILES/ontology relations, BindingDB monomer IDs/affinity fields/PMIDs, ZINC IDs, ZINC task ids, SMILES, supplier catalog codes, catalog names, source counts, tranche names, tranche heavy-atom/logP bins, and 3D repository path patterns, BioMart mart names, dataset names, internal attribute/filter names, Ensembl gene IDs, STRING IDs/preferred names/edge scores, IntAct interaction accessions/MI scores/PubMed IDs, Complex Portal CPX accessions/participant accessions/stoichiometry fields, KEGG entry IDs, KEGG source/target mapping IDs, missing IDs, operation names, batch indexes, request indexes, Rhea IDs/EC numbers/ChEBI IDs, Rfam accessions/family IDs/clans, UniProt accessions, AlphaFold entry/model IDs and PDB/CIF/PAE links, PDB IDs, EMDB EMD accessions/resolution/map metadata, Ensembl stable IDs, MyGene Entrez/Ensembl/UniProt IDs, CellGuide CL IDs, cell type names, marker symbols/scores/specificity, tissue contexts, snapshot ids, source collection URLs, PanglaoDB cell types, marker gene symbols, nicknames, species tokens, organs, canonical marker flags, sensitivity/specificity scores, and product descriptions, Antibody Registry AB/RRID accessions, vendor names, catalog numbers, clone ids, antibody targets, source organisms, target species, applications, citation counts, and registry last-update dates, UCSC genome db names, track names, chromosome coordinates, itemsReturned/maxItemsLimit, conservation score summaries, TFBS factor names, UniBind TF ids, JASPAR matrix ids, prediction model names, model BED/FASTA/plot URLs, UniBind collection names, and UniBind TFBS chromosome coordinates, ClinVar VCV/RCV accessions and review statuses, dbSNP rsIDs/placements/HGVS/SPDI, NCBI Variation contextual SPDI/HGVS/VCF fields, CADD RawScore/PHRED/version, ClinGen CGGV assertion IDs, HGNC IDs, MONDO IDs, validity classifications, dosage assertion codes/labels, actionability document IDs, CAIDs, ClinVar variation IDs, evidence codes, expert panels, COSMIC mutation IDs, legacy mutation IDs, genomic mutation IDs, COSG/COSO IDs, GRCh versions, mutation CDS/amino-acid/genome-position fields, primary site/histology, DepMap SIDM model IDs, SIDG gene IDs, HGNC IDs, tissue/cancer type labels, model availability flags, dependency scores and source labels, gnomAD short/SV/mitochondrial variant IDs, dataset pins, allele frequencies, heteroplasmy fields, cBioPortal study IDs, cancer type IDs, molecular profile IDs, sample/patient IDs, gene symbols, Entrez IDs, mutation positions/protein changes, CIViC molecular profile/evidence/assertion IDs, AMP levels, evidence levels, diseases, therapies, PubMed-backed sources, Open Targets Ensembl IDs, EFO/MONDO IDs, ChEMBL drug IDs, association scores, datasource IDs, clinical stages, mechanism/action types, GWAS Catalog association IDs, study accessions, rsIDs, EFO/MONDO traits, p-values, odds ratios, betas, ancestry/sample metadata, openFDA set/safety-report/recall IDs, Drugs@FDA application numbers, sponsor names, product routes/statuses/TE codes, submission status dates, pharmacologic-class buckets, and active-ingredient equivalent sets, Human Protein Atlas Ensembl/UniProt/tissue fields, eQTL Catalogue study/dataset/variant/gene/p-value/beta fields, ontology CURIEs, ENCODE accessions, GEO accessions, ArrayExpress accessions, MetaboLights MTBLS accessions/study statuses/assay technologies/file names, MGnify study accessions, GTEx GENCODE IDs, InterPro accessions, PRIDE accessions, JASPAR matrix IDs, QuickGO GO IDs, Reactome stable IDs, citation counts, source URLs, and endpoint provenance in research artifacts and answers.",
					"Use exact protein-annotation commands when the task names a protein/domain/network workflow: `get_domain_architecture`, `search_interpro_entries`, `get_interpro_entry`, `search_pfam_clans`, `get_pfam_clan`, `get_pfam_family_proteins`, `get_pfam_family_proteomes`, `get_protein_atlas_gene`, `search_protein_atlas`, `map_string_ids`, `get_string_network`, `get_string_similarity_scores`, and `get_string_best_similarity_hits`.",
					"Use exact research-resource commands when the task names reagents or grants: `search_antibodies`, `get_antibody`, `find_antibodies_by_catalog`, `get_antibody_registry_stats`, and `search_grants`.",
					"Use exact RNA commands when the task names Rfam or RNA-family workflows: `get_family`, `accession_to_id`, `id_to_accession`, `get_seed_alignment`, `get_covariance_model`, `get_tree`, `get_sequence_regions`, `get_structure_mapping`, and `search_sequence`.",
						"Use exact omics-archive commands when the task names archive project, sample, file, analysis, or protein-evidence workflows: `arrayexpress_search_experiments`, `arrayexpress_get_experiment`, `arrayexpress_get_experiment_files`, `arrayexpress_get_experiment_samples`, `geo_search_series`, `geo_get_series`, `metabolights_list_studies`, `metabolights_get_studies`, `metabolights_get_study_files`, `metabolights_search_data_files`, `mgnify_search_studies`, `mgnify_get_studies`, `mgnify_get_study_analyses`, `pride_search_projects`, `pride_get_projects`, `pride_search_project_proteins`, and `pride_find_projects_for_protein`.",
						"Use exact regulation commands when the task names ENCODE, JASPAR, or UniBind workflows: `encode_search_experiments`, `encode_search_biosamples`, `encode_list_files`, `encode_get_experiment`, `encode_get_file`, `encode_get_biosample`, `jaspar_get_matrix`, `jaspar_matrix_versions`, `jaspar_list_matrices`, `jaspar_list_species`, `jaspar_list_taxa`, `jaspar_list_collections`, `jaspar_list_releases`, `unibind_search_tfbs`, `unibind_get_dataset`, and `unibind_tfbs_in_region`.",
						"Use exact variant commands when the task names gnomAD, CADD, ClinVar, or dbSNP workflows: `get_variant`, `search_variants`, `gene_variants`, `gene_constraint`, `region_variants`, `liftover_variant`, `clinvar_variants`, `structural_variants`, `get_structural_variant`, `mitochondrial_variants`, `cadd_variant_score`, `cadd_position_scores`, `cadd_range_scores`, `clinvar_search`, `clinvar_get_records`, `clinvar_variant_by_rsid`, `dbsnp_get_rsids`, and `dbsnp_search_by_region`.",
						"Treat database summaries as retrieval evidence, then verify decisive claims against full papers, trial records, or primary source details when needed.",
		],
		parameters: Type.Object({
				source: SCIENCE_DATABASE_SOURCE_SCHEMA,
			query: Type.String({
				description:
						"Search query, exact database command, identifier, gene, disease, intervention, paper title, DOI/preprint DOI, dataset, molecule, target, assay, protein, structure, variant ID, rsID, ontology term, experiment, pathway identifier, reaction, RNA family, accession, reagent catalog, grant opportunity filter, or stable ID. Literature examples: openalex_search_works:CRISPR year_from=2024 open_access_only=true, openalex_get_work:W2741809807, openalex_citations:W2741809807, openalex_references:W2741809807, openalex_search_authors:Jennifer Doudna, openalex_get_author:A5065535610, openalex_venue_info:S106963461, arxiv_search:sparse autoencoders category=cs.LG date_from=2023-09-01 date_to=2023-09-30, arxiv_get_papers:2309.08600. Protein examples: get_domain_architecture:P04637, search_interpro_entries:kinase source_db=pfam entry_type=domain, get_protein_atlas_gene:TP53, get_string_network:TP53,BRCA1 species=9606 required_score=700. Variant examples: get_variant:variant_id=19-44908822-C-T, search_variants:rs7412, gene_variants:gene_symbol=APOE, region_variants:chrom=19 start=44908820 stop=44908830, liftover_variant:variant_id=19-45411941-C-T source_build=GRCh37, clinvar_variants:gene_symbol=APOE, cadd_variant_score:chrom=19 pos=44908822 ref=C alt=T, clinvar_variant_by_rsid:rs7412, dbsnp_search_by_region:chrom=19 start=44908820 stop=44908830. RNA examples: get_family:RF00005, id_to_accession:tRNA, get_seed_alignment:RF00005 fmt=stockholm max_bytes=400000, get_covariance_model:RF00005, get_tree:RF00005, search_sequence:ACGUACGU. Regulation examples: encode_search_experiments:assay_title=\"TF ChIP-seq\" target=CTCF organism=\"Homo sapiens\", encode_get_file:ENCFF002JUR, jaspar_get_matrix:MA0106.1, jaspar_list_matrices:search=TP53 tax_id=9606 version=latest, unibind_tfbs_in_region:genome=hg38 chrom=chr17 start=7661779 end=7687546 tf_name=GATA3. Omics archive examples: arrayexpress_search_experiments:query=pancreas organism=\"Homo sapiens\", geo_get_series:GSE12345, metabolights_get_studies:MTBLS1 include_samples=true, mgnify_get_study_analyses:MGYS00010397, pride_find_projects_for_protein:P04637. Research-resource examples: search_antibodies:TP53 max_records=5, get_antibody:RRID:AB_330944, find_antibodies_by_catalog:9205 vendor=\"Cell Signaling Technology\", get_antibody_registry_stats, search_grants:keyword=cancer agencies=HHS-NIH11 opportunity_statuses=posted max_records=2. PubMed examples: pmid:35486828, convert:35486828 id_type=pmid, fulltext:PMC9046468, or citation journal=Nature year=2022 volume=604 first_page=123 author=Doudna.",
			}),
			limit: Type.Optional(Type.Number({ description: `Maximum records to return. Defaults to ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.` })),
			sort: Type.Optional(Type.Union([
				Type.Literal("relevance"),
				Type.Literal("pub_date"),
			], { description: "PubMed/arXiv sort order. Ignored for other sources." })),
			ensemblSpecies: Type.Optional(Type.String({ description: "Ensembl species for symbol lookups. Defaults to homo_sapiens." })),
			chemblEntity: Type.Optional(Type.Union([
				Type.Literal("molecule"),
				Type.Literal("target"),
				Type.Literal("assay"),
				], { description: "Legacy ChEMBL search entity type for unprefixed ChEMBL search queries. Defaults to molecule." })),
		}),
		async execute(_toolCallId, params) {
			const result = await scienceDatabaseSearch(params as ScienceDatabaseSearchParams);
			return {
				content: [{ type: "text", text: formatText(result) }],
				details: result,
			};
		},
	});
}

export const testableScienceDatabases = {
	scienceDatabaseSearch,
};
