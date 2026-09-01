import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { registerScienceDatabaseTools } from "../extensions/research-tools/science-databases.js";

type Tool = {
	execute: (toolCallId: string, params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; details: unknown }>;
	name: string;
	promptGuidelines?: string[];
	promptSnippet?: string;
};

const originalFetch = globalThis.fetch;
const originalNcbiEmail = process.env.NCBI_EMAIL;

afterEach(() => {
	globalThis.fetch = originalFetch;
	if (originalNcbiEmail === undefined) delete process.env.NCBI_EMAIL;
	else process.env.NCBI_EMAIL = originalNcbiEmail;
});

function registerTools(): Map<string, Tool> {
	const tools = new Map<string, Tool>();
	registerScienceDatabaseTools({
		registerTool(tool: Tool) {
			tools.set(tool.name, tool);
		},
	} as never);
	return tools;
}

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

test("science database tool searches PubMed through ESearch and ESummary", async () => {
	process.env.NCBI_EMAIL = "research@example.edu";
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = String(input);
		requests.push(url);
		if (url.includes("/esearch.fcgi")) {
			return jsonResponse({
				esearchresult: {
					count: "2",
					idlist: ["123", "456"],
					querytranslation: "crispr cancer",
				},
			});
		}
		if (url.includes("/esummary.fcgi")) {
			return jsonResponse({
				result: {
					uids: ["123", "456"],
					"123": {
						uid: "123",
						title: "CRISPR screen in cancer.",
						fulljournalname: "Example Journal",
						pubdate: "2026 Jan",
						authors: [{ name: "Ada A" }, { name: "Turing T" }],
						articleids: [{ idtype: "doi", value: "10.1000/example" }],
						pubtype: ["Journal Article"],
					},
					"456": {
						uid: "456",
						title: "Second result.",
						source: "Nature",
						pubdate: "2025 Dec",
						authors: [],
					},
				},
			});
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tools = registerTools();
	const result = await tools.get("feynman_science_database_search")?.execute("call-1", {
		source: "pubmed",
		query: "CRISPR cancer",
		limit: 2,
		sort: "pub_date",
	});
	const details = result?.details as { results: Array<{ doi?: string; pmid: string; title: string }>; returned: number; source: string };

	assert.equal(tools.has("feynman_science_database_search"), true);
	assert.equal(details.source, "pubmed");
	assert.equal(details.returned, 2);
	assert.equal(details.results[0]?.pmid, "123");
	assert.equal(details.results[0]?.doi, "10.1000/example");
	assert.match(details.results[0]?.title ?? "", /CRISPR/);
	assert.equal(new URL(requests[0]!).searchParams.get("tool"), "feynman");
	assert.equal(new URL(requests[0]!).searchParams.get("email"), "research@example.edu");
	assert.equal(new URL(requests[0]!).searchParams.get("sort"), "pub_date");
	assert.equal(new URL(requests[1]!).searchParams.get("id"), "123,456");
	assert.match(tools.get("feynman_science_database_search")?.promptSnippet ?? "", /PubMed/);
});

test("science database tool searches ClinicalTrials.gov and ChEMBL", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = String(input);
		requests.push(url);
		if (url.includes("clinicaltrials.gov")) {
			return jsonResponse({
				studies: [{
					protocolSection: {
						identificationModule: {
							nctId: "NCT12345678",
							briefTitle: "A trial of a targeted therapy",
							officialTitle: "Official targeted therapy study",
						},
						statusModule: {
							overallStatus: "RECRUITING",
							startDateStruct: { date: "2026-01-01" },
						},
						conditionsModule: { conditions: ["Glioblastoma"] },
						armsInterventionsModule: { interventions: [{ name: "Drug A" }] },
						designModule: { phases: ["PHASE2"] },
						contactsLocationsModule: { locations: [{ facility: "Lab Hospital", city: "Boston", country: "United States" }] },
					},
				}],
				nextPageToken: "next",
			});
		}
		if (url.includes("chembl")) {
			return jsonResponse({
				targets: [{
					target_chembl_id: "CHEMBL1824",
					pref_name: "ERBB2",
					organism: "Homo sapiens",
					target_type: "SINGLE PROTEIN",
					score: 20,
				}],
				page_meta: { total_count: 1 },
			});
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tools = registerTools();
	const trials = await tools.get("feynman_science_database_search")?.execute("call-2", {
		source: "clinicaltrials",
		query: "glioblastoma targeted therapy",
		limit: 1,
	});
	const chembl = await tools.get("feynman_science_database_search")?.execute("call-3", {
		source: "chembl",
		query: "HER2",
		chemblEntity: "target",
		limit: 1,
	});

	const trialDetails = trials?.details as { hasMore: boolean; results: Array<{ nctId: string; url: string }> };
	const chemblDetails = chembl?.details as { entity: string; results: Array<{ chemblId: string; url: string }> };
	assert.equal(trialDetails.hasMore, true);
	assert.equal(trialDetails.results[0]?.nctId, "NCT12345678");
	assert.equal(trialDetails.results[0]?.url, "https://clinicaltrials.gov/study/NCT12345678");
	assert.equal(chemblDetails.entity, "target");
	assert.equal(chemblDetails.results[0]?.chemblId, "CHEMBL1824");
	assert.equal(new URL(requests[0]!).searchParams.get("query.term"), "glioblastoma targeted therapy");
	assert.equal(new URL(requests[0]!).searchParams.get("pageSize"), "1");
	assert.equal(requests[1], "https://www.ebi.ac.uk/chembl/api/data/target/search.json?q=HER2&limit=1");
});

test("science database tool searches public literature and DOI metadata sources", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = String(input);
		requests.push(url);
		if (url.includes("api.crossref.org")) {
			return jsonResponse({
				message: {
					"total-results": 1,
					items: [{
						DOI: "10.1234/crossref",
						title: ["Crossref CRISPR metadata"],
						"container-title": ["Metadata Journal"],
						"published-online": { "date-parts": [[2026, 2, 3]] },
						author: [{ given: "Ada", family: "Lovelace" }],
						"is-referenced-by-count": 12,
						URL: "https://doi.org/10.1234/crossref",
						type: "journal-article",
					}],
				},
			});
		}
		if (url.includes("europepmc")) {
			return jsonResponse({
				hitCount: 1,
				nextCursorMark: "next",
				resultList: {
					result: [{
						id: "12345678",
						source: "MED",
						pmid: "12345678",
						pmcid: "PMC123456",
						doi: "10.1234/epmc",
						title: "Europe PMC CRISPR record",
						authorString: "Lovelace A",
						journalTitle: "Life Science Journal",
						pubYear: "2026",
						pubType: "research-article",
						citedByCount: "7",
						isOpenAccess: "Y",
						inPMC: "Y",
						hasReferences: "Y",
						hasTextMinedTerms: "Y",
					}],
				},
			});
		}
		if (url.includes("export.arxiv.org")) {
			return new Response([
				"<?xml version='1.0' encoding='UTF-8'?>",
				"<feed xmlns:opensearch='http://a9.com/-/spec/opensearch/1.1/' xmlns:arxiv='http://arxiv.org/schemas/atom' xmlns='http://www.w3.org/2005/Atom'>",
				"<opensearch:totalResults>1</opensearch:totalResults>",
				"<entry>",
				"<id>https://arxiv.org/abs/2601.01234v1</id>",
				"<title> arXiv CRISPR preprint </title>",
				"<summary> CRISPR preprint summary. </summary>",
				"<published>2026-01-02T00:00:00Z</published>",
				"<updated>2026-01-03T00:00:00Z</updated>",
				"<author><name>Ada Lovelace</name></author>",
				"<arxiv:primary_category term='q-bio.BM'/>",
				"<category term='q-bio.BM'/>",
				"<arxiv:doi>10.1234/arxiv</arxiv:doi>",
				"<arxiv:journal_ref>Preprint Journal</arxiv:journal_ref>",
				"<link href='https://arxiv.org/pdf/2601.01234v1' title='pdf' type='application/pdf'/>",
				"</entry>",
				"</feed>",
			].join(""), { status: 200, headers: { "content-type": "application/atom+xml" } });
		}
		if (url.includes("api.datacite.org")) {
			return jsonResponse({
				meta: { total: 1 },
				data: [{
					id: "10.1234/datacite",
					attributes: {
						doi: "10.1234/datacite",
						titles: [{ title: "DataCite CRISPR dataset" }],
						creators: [{ name: "Lovelace, Ada" }],
						publisher: "Example Repository",
						publicationYear: 2026,
						types: { resourceTypeGeneral: "Dataset" },
						citationCount: 3,
						url: "https://example.edu/dataset",
					},
				}],
			});
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tools = registerTools();
	const crossref = await tools.get("feynman_science_database_search")?.execute("call-crossref", {
		source: "crossref",
		query: "crispr metadata",
		limit: 1,
	});
	const europepmc = await tools.get("feynman_science_database_search")?.execute("call-epmc", {
		source: "europepmc",
		query: "crispr",
		limit: 1,
	});
	const arxiv = await tools.get("feynman_science_database_search")?.execute("call-arxiv", {
		source: "arxiv",
		query: "crispr",
		limit: 1,
		sort: "pub_date",
	});
	const datacite = await tools.get("feynman_science_database_search")?.execute("call-datacite", {
		source: "datacite",
		query: "crispr dataset",
		limit: 1,
	});

	const crossrefDetails = crossref?.details as { results: Array<{ doi?: string; title?: string }> };
	const europePmcDetails = europepmc?.details as { hasMore: boolean; results: Array<{ pmcid?: string; pmid?: string; url?: string }> };
	const arxivDetails = arxiv?.details as { results: Array<{ arxivId?: string; pdfUrl?: string; primaryCategory?: string }> };
	const dataciteDetails = datacite?.details as { results: Array<{ doi?: string; resourceType?: string; title?: string }> };

	assert.equal(crossrefDetails.results[0]?.doi, "10.1234/crossref");
	assert.equal(crossrefDetails.results[0]?.title, "Crossref CRISPR metadata");
	assert.equal(europePmcDetails.hasMore, true);
	assert.equal(europePmcDetails.results[0]?.pmid, "12345678");
	assert.equal(europePmcDetails.results[0]?.pmcid, "PMC123456");
	assert.equal(europePmcDetails.results[0]?.url, "https://europepmc.org/article/MED/12345678");
	assert.equal(arxivDetails.results[0]?.arxivId, "2601.01234v1");
	assert.equal(arxivDetails.results[0]?.primaryCategory, "q-bio.BM");
	assert.equal(arxivDetails.results[0]?.pdfUrl, "https://arxiv.org/pdf/2601.01234v1");
	assert.equal(dataciteDetails.results[0]?.doi, "10.1234/datacite");
	assert.equal(dataciteDetails.results[0]?.resourceType, "Dataset");
	assert.equal(dataciteDetails.results[0]?.title, "DataCite CRISPR dataset");
	assert.equal(new URL(requests[0]!).searchParams.get("rows"), "1");
	assert.equal(new URL(requests[1]!).searchParams.get("resultType"), "lite");
	assert.equal(new URL(requests[2]!).searchParams.get("sortBy"), "submittedDate");
	assert.equal(new URL(requests[3]!).searchParams.get("page[size]"), "1");
	assert.match(tools.get("feynman_science_database_search")?.promptSnippet ?? "", /Europe PMC/);
	assert.match(tools.get("feynman_science_database_search")?.promptSnippet ?? "", /DataCite/);
});

test("science database tool searches specialty protein structure gene and preprint sources", async () => {
	const requests: Array<{ body?: string; method: string; url: string }> = [];
	globalThis.fetch = async (input, init) => {
		const url = String(input);
		requests.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
		if (url.includes("rest.uniprot.org")) {
			return jsonResponse({
				results: [{
					primaryAccession: "P38398",
					uniProtkbId: "BRCA1_HUMAN",
					proteinDescription: { recommendedName: { fullName: { value: "Breast cancer type 1 susceptibility protein" } } },
					genes: [{ geneName: { value: "BRCA1" } }],
					organism: { scientificName: "Homo sapiens", taxonId: 9606 },
					sequenceLength: 1863,
					comments: [{ commentType: "FUNCTION", texts: [{ value: "E3 ubiquitin-protein ligase activity." }] }],
					uniProtKBCrossReferences: [{ database: "PDB", id: "1JM7" }],
				}],
			});
		}
		if (url.includes("search.rcsb.org")) {
			assert.equal(init?.method, "POST");
			assert.match(String(init?.body), /hemoglobin/);
			return jsonResponse({
				total_count: 1,
				result_set: [{ identifier: "4HHB", score: 42 }],
			});
		}
		if (url.includes("data.rcsb.org")) {
			return jsonResponse({
				rcsb_id: "4HHB",
				struct: { title: "The crystal structure of human deoxyhaemoglobin" },
				exptl: [{ method: "X-RAY DIFFRACTION" }],
				rcsb_accession_info: { initial_release_date: "1984-07-17", revision_date: "2025-01-01" },
				rcsb_entry_info: { resolution_combined: [1.74], polymer_entity_count: 2, deposited_atom_count: 4779 },
				citation: [{ title: "Human deoxyhaemoglobin", pdbx_database_id_DOI: "10.1234/pdb", pdbx_database_id_PubMed: "12345", year: 1984 }],
			});
		}
			if (url.includes("/lookup/symbol/homo_sapiens/BRCA2") || url.includes("/lookup/id/ENSG00000139618")) {
				return jsonResponse({
					id: "ENSG00000139618",
					display_name: "BRCA2",
				object_type: "Gene",
				species: "homo_sapiens",
				biotype: "protein_coding",
				description: "BRCA2 DNA repair associated",
				assembly_name: "GRCh38",
				seq_region_name: "13",
				start: 32315086,
				end: 32400266,
				strand: 1,
					Transcript: [{ id: "ENST00000380152" }],
				});
			}
			if (url.includes("/xrefs/symbol/")) {
				return jsonResponse([{ id: "ENSG00000139618", type: "gene" }]);
			}
		if (url.includes("api.biorxiv.org/details/biorxiv")) {
			return jsonResponse({
				collection: [{
					doi: "10.1101/2026.01.01.000001",
					title: "Kinase biology preprint",
					authors: "Lovelace A",
					date: "2026-01-02",
					version: "1",
					type: "new results",
					license: "cc_by",
					category: "cell biology",
					abstract: "A kinase biology study.",
					published: "NA",
				}],
			});
		}
		if (url.includes("api.biorxiv.org/details/medrxiv")) {
			return jsonResponse({
				collection: [{
					doi: "10.1101/2020.09.09.20191205",
					title: "Clinical preprint",
					authors: "Turing A",
					date: "2020-09-10",
					version: "2",
					type: "new results",
					license: "cc_by_nc_nd",
					category: "infectious diseases",
					abstract: "A clinical preprint.",
					published: "NA",
				}],
			});
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tools = registerTools();
	const uniprot = await tools.get("feynman_science_database_search")?.execute("call-uniprot", {
		source: "uniprot",
		query: "gene_exact:BRCA1 AND organism_id:9606",
		limit: 1,
	});
	const pdb = await tools.get("feynman_science_database_search")?.execute("call-pdb", {
		source: "pdb",
		query: "hemoglobin",
		limit: 1,
	});
	const ensembl = await tools.get("feynman_science_database_search")?.execute("call-ensembl", {
		source: "ensembl",
		query: "BRCA2",
		ensemblSpecies: "homo_sapiens",
		limit: 1,
	});
	const biorxiv = await tools.get("feynman_science_database_search")?.execute("call-biorxiv", {
		source: "biorxiv",
		query: "kinase",
		limit: 1,
	});
	const medrxiv = await tools.get("feynman_science_database_search")?.execute("call-medrxiv", {
		source: "medrxiv",
		query: "10.1101/2020.09.09.20191205",
		limit: 1,
	});

	const uniprotDetails = uniprot?.details as { results: Array<{ accession?: string; genes?: string[]; pdbIds?: string[] }> };
	const pdbDetails = pdb?.details as { results: Array<{ pdbId?: string; resolution?: number[]; citation?: { doi?: string } }> };
	const ensemblDetails = ensembl?.details as { results: Array<{ stableId?: string; displayName?: string; transcriptCount?: number }> };
	const biorxivDetails = biorxiv?.details as { results: Array<{ doi?: string; title?: string }>; searchMode: string };
	const medrxivDetails = medrxiv?.details as { results: Array<{ doi?: string; url?: string }>; searchMode: string };

	assert.equal(uniprotDetails.results[0]?.accession, "P38398");
	assert.deepEqual(uniprotDetails.results[0]?.genes, ["BRCA1"]);
	assert.deepEqual(uniprotDetails.results[0]?.pdbIds, ["1JM7"]);
	assert.equal(pdbDetails.results[0]?.pdbId, "4HHB");
	assert.deepEqual(pdbDetails.results[0]?.resolution, [1.74]);
	assert.equal(pdbDetails.results[0]?.citation?.doi, "10.1234/pdb");
	assert.equal(ensemblDetails.results[0]?.stableId, "ENSG00000139618");
	assert.equal(ensemblDetails.results[0]?.displayName, "BRCA2");
	assert.equal(ensemblDetails.results[0]?.transcriptCount, 1);
	assert.equal(biorxivDetails.searchMode, "recent-60-day-filter");
	assert.equal(biorxivDetails.results[0]?.title, "Kinase biology preprint");
	assert.equal(medrxivDetails.searchMode, "doi");
	assert.equal(medrxivDetails.results[0]?.doi, "10.1101/2020.09.09.20191205");
	assert.equal(requests.some((request) => request.method === "POST" && request.url.includes("search.rcsb.org")), true);
	assert.match(tools.get("feynman_science_database_search")?.promptSnippet ?? "", /UniProt/);
	assert.match(tools.get("feynman_science_database_search")?.promptSnippet ?? "", /RCSB PDB/);
	assert.match(tools.get("feynman_science_database_search")?.promptSnippet ?? "", /Ensembl/);
	assert.match(tools.get("feynman_science_database_search")?.promptSnippet ?? "", /bioRxiv/);
});

test("science database tool searches Feynman-owned clinical variant databases", async () => {
	process.env.NCBI_EMAIL = "variants@example.edu";
	const requests: Array<{ body?: string; method: string; url: string }> = [];
	globalThis.fetch = async (input, init) => {
		const url = String(input);
		requests.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
		const parsed = new URL(url);
		if (parsed.hostname === "eutils.ncbi.nlm.nih.gov" && parsed.searchParams.get("db") === "clinvar" && parsed.pathname.endsWith("/esearch.fcgi")) {
			return jsonResponse({
				esearchresult: {
					count: "1",
					idlist: ["140484"],
				},
			});
		}
		if (parsed.hostname === "eutils.ncbi.nlm.nih.gov" && parsed.searchParams.get("db") === "clinvar" && parsed.pathname.endsWith("/esummary.fcgi")) {
			return jsonResponse({
				result: {
					uids: ["140484"],
					"140484": {
						uid: "140484",
						accession: "VCV000014048",
						accession_version: "VCV000014048.13",
						title: "NM_000041.4(APOE):c.388T>C",
						obj_type: "single nucleotide variant",
						variation_set: [{
							variant_type: "single nucleotide variant",
							canonical_spdi: "NC_000019.10:44908821:C:T",
							variation_xrefs: [{ db_source: "dbSNP", db_id: "7412" }],
							variation_loc: [{ assembly_name: "GRCh38", chr: "19", start: "44908822", stop: "44908822", ref: "C", alt: "T" }],
						}],
						genes: [{ symbol: "APOE", geneid: "348", strand: "+", source: "submitted" }],
						germline_classification: {
							description: "Pathogenic",
							review_status: "reviewed by expert panel",
							last_evaluated: "2025/01/15 00:00",
							trait_set: [{ trait_name: "Alzheimer disease", trait_xrefs: [{ db_source: "MedGen", db_id: "C0002395" }] }],
						},
						supporting_submissions: { scv: ["SCV000001"], rcv: ["RCV000001"] },
						molecular_consequence_list: ["missense variant"],
						protein_change: "p.Cys130Arg",
					},
				},
			});
		}
		if (parsed.hostname === "api.ncbi.nlm.nih.gov" && parsed.pathname.endsWith("/variation/v0/refsnp/7412")) {
			return jsonResponse({
				refsnp_id: 7412,
				create_date: "2000-01-01",
				last_update_date: "2026-01-01",
				last_update_build_id: "158",
				citations: [12345678],
				mane_select_ids: ["NM_000041.4"],
				primary_snapshot_data: {
					variant_type: "snv",
					placements_with_allele: [{
						is_ptlp: true,
						seq_id: "NC_000019.10",
						placement_annot: { seq_id_traits_by_assembly: [{ assembly_name: "GRCh38.p14", is_chromosome: true }] },
						alleles: [
							{ allele: { spdi: { seq_id: "NC_000019.10", position: 44908821, deleted_sequence: "C", inserted_sequence: "C" } }, hgvs: "NC_000019.10:g.44908822C=" },
							{ allele: { spdi: { seq_id: "NC_000019.10", position: 44908821, deleted_sequence: "C", inserted_sequence: "T" } }, hgvs: "NC_000019.10:g.44908822C>T" },
						],
					}],
					allele_annotations: [{}, {
						frequency: [{ study_name: "TOPMed", study_version: 3, allele_count: 2, total_count: 1000 }],
						clinical: [{
							accession_version: "RCV000001.1",
							clinical_significances: ["Pathogenic"],
							review_status: "criteria provided, single submitter",
							disease_names: ["Example disease"],
						}],
						assembly_annotation: [{
							genes: [{
								locus: "APOE",
								id: "348",
								name: "apolipoprotein E",
								orientation: "plus",
								rnas: [{
									id: "NM_000041.4",
									hgvs: "NM_000041.4:c.388T>C",
									sequence_ontology: [{ name: "missense_variant" }],
									protein: {
										sequence_ontology: [{ name: "missense_variant" }],
										variant: { spdi: { seq_id: "NP_000032.1", position: 129, deleted_sequence: "C", inserted_sequence: "R" } },
									},
								}],
							}],
						}],
					}],
				},
			});
		}
		if (parsed.hostname === "cadd.gs.washington.edu" && parsed.pathname.endsWith("/api/v1.0/GRCh38-v1.7/19:44908822_C_T")) {
			return jsonResponse([{ Chrom: "19", Pos: 44908822, Ref: "C", Alt: "T", RawScore: "2.100000", PHRED: "24.7" }]);
		}
		if (parsed.hostname === "api.ncbi.nlm.nih.gov" && parsed.pathname.endsWith("/variation/v0/hgvs/NM_000518.4:c.27dupG/contextuals")) {
			return jsonResponse({
				data: {
					spdis: [{ seq_id: "NM_000518.4", position: 76, deleted_sequence: "G", inserted_sequence: "GG" }],
					input_hgvs_validity: "valid",
				},
			});
		}
		if (parsed.hostname === "api.ncbi.nlm.nih.gov" && parsed.pathname.endsWith("/variation/v0/spdi/NM_000518.4:76:G:GG/canonical_representative")) {
			return jsonResponse({ data: { seq_id: "NC_000011.10", position: 5226994, deleted_sequence: "C", inserted_sequence: "CC" } });
		}
		if (parsed.hostname === "api.ncbi.nlm.nih.gov" && parsed.pathname.endsWith("/variation/v0/spdi/NM_000518.4:76:G:GG/hgvs")) {
			return jsonResponse({ data: { hgvs: "NM_000518.4:c.27dupG" } });
		}
		if (parsed.hostname === "api.ncbi.nlm.nih.gov" && parsed.pathname.endsWith("/variation/v0/spdi/NM_000518.4:76:G:GG/rsids")) {
			return jsonResponse({ data: { rsids: ["334"] } });
		}
		if (parsed.hostname === "api.ncbi.nlm.nih.gov" && parsed.pathname.endsWith("/variation/v0/spdi/NM_000518.4:76:G:GG/vcf_fields")) {
			return jsonResponse({ data: { chrom: "NC_000011.10", pos: 5226995, ref: "C", alt: "CC" } });
		}
		if (parsed.hostname === "api.ncbi.nlm.nih.gov" && parsed.pathname.includes("/variation/v0/spdi/NC_000001.10:12345:0:C/")) {
			return new Response(JSON.stringify({ error: { code: 500, message: "NCBI transient SPDI lookup failure" } }), {
				status: 500,
				headers: { "content-type": "application/json" },
			});
		}
		if (parsed.hostname === "api.ncbi.nlm.nih.gov" && parsed.pathname.endsWith("/variation/v0/hgvs/batch/contextuals")) {
			return jsonResponse({
				data: [
					{
						hgvs: "NM_000518.4:c.27dupG",
						alleles: { spdis: [{ seq_id: "NM_000518.4", position: 76, deleted_sequence: "G", inserted_sequence: "GG" }] },
						input_hgvs_validity: "valid",
					},
					{
						hgvs: "NC_000001.10:g.12345T>A",
						alleles: { spdis: [{ seq_id: "NC_000001.10", position: 12344, deleted_sequence: "T", inserted_sequence: "A" }] },
						input_hgvs_validity: "valid",
					},
				],
			});
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tools = registerTools();
	const clinvar = await tools.get("feynman_science_database_search")?.execute("call-clinvar", {
		source: "clinvar",
		query: "APOE rs7412",
		limit: 1,
	});
	const dbsnp = await tools.get("feynman_science_database_search")?.execute("call-dbsnp", {
		source: "dbsnp",
		query: "rs7412",
		limit: 1,
	});
	const cadd = await tools.get("feynman_science_database_search")?.execute("call-cadd", {
		source: "cadd",
		query: "GRCh38-v1.7 19-44908822-C-T",
		limit: 1,
	});
	const variation = await tools.get("feynman_science_database_search")?.execute("call-variation", {
		source: "variation",
		query: "NM_000518.4:c.27dupG",
		limit: 1,
	});
	const variationSpdiFallback = await tools.get("feynman_science_database_search")?.execute("call-variation-spdi", {
		source: "variation",
		query: "NC_000001.10:12345:0:C",
		limit: 1,
	});
	const variationBatch = await tools.get("feynman_science_database_search")?.execute("call-variation-batch", {
		source: "variation",
		query: "NM_000518.4:c.27dupG\nNC_000001.10:g.12345T>A",
		limit: 5,
	});

	const clinvarDetails = clinvar?.details as { results: Array<{ genes?: Array<{ symbol?: string }>; germlineClassification?: { goldStars?: number; reviewStatus?: string }; rsids?: string[]; variationId?: number }> };
	const dbsnpDetails = dbsnp?.details as { results: Array<{ alleles?: Array<{ clinvar?: Array<{ rcvAccession?: string }>; frequencies?: Array<{ alleleFrequency?: number }>; genes?: Array<{ symbol?: string }> }>; placements?: Array<{ chrom?: string; position?: number }>; rsid?: string }> };
	const caddDetails = cadd?.details as { results: Array<{ phred?: string; rawScore?: string; version?: string }>; searchMode?: string; version?: string };
	const variationDetails = variation?.details as { inputHgvsValidity?: string; results: Array<{ canonicalSpdi?: string; contextualSpdi?: string; hgvs?: string; rsids?: string[]; vcfFields?: { alt?: string; chrom?: string; pos?: number; ref?: string } }>; searchMode?: string };
	const variationFallbackDetails = variationSpdiFallback?.details as { results: Array<{ contextualSpdi?: string }>; searchMode?: string; warnings?: Array<{ error?: string }> };
	const variationBatchDetails = variationBatch?.details as { inputs?: string[]; results: Array<{ contextualSpdis?: string[]; input?: string; inputHgvsValidity?: string }>; searchMode?: string };

	assert.equal(clinvarDetails.results[0]?.variationId, 140484);
	assert.deepEqual(clinvarDetails.results[0]?.rsids, ["rs7412"]);
	assert.equal(clinvarDetails.results[0]?.genes?.[0]?.symbol, "APOE");
	assert.equal(clinvarDetails.results[0]?.germlineClassification?.reviewStatus, "reviewed by expert panel");
	assert.equal(clinvarDetails.results[0]?.germlineClassification?.goldStars, 3);
	assert.equal(dbsnpDetails.results[0]?.rsid, "rs7412");
	assert.equal(dbsnpDetails.results[0]?.placements?.[0]?.chrom, "19");
	assert.equal(dbsnpDetails.results[0]?.placements?.[0]?.position, 44908822);
	assert.equal(dbsnpDetails.results[0]?.alleles?.[0]?.frequencies?.[0]?.alleleFrequency, 0.002);
	assert.equal(dbsnpDetails.results[0]?.alleles?.[0]?.clinvar?.[0]?.rcvAccession, "RCV000001.1");
	assert.equal(dbsnpDetails.results[0]?.alleles?.[0]?.genes?.[0]?.symbol, "APOE");
	assert.equal(caddDetails.searchMode, "single-snv");
	assert.equal(caddDetails.version, "GRCh38-v1.7");
	assert.equal(caddDetails.results[0]?.rawScore, "2.100000");
	assert.equal(caddDetails.results[0]?.phred, "24.7");
	assert.equal(variationDetails.searchMode, "hgvs-contextuals");
	assert.equal(variationDetails.inputHgvsValidity, "valid");
	assert.equal(variationDetails.results[0]?.contextualSpdi, "NM_000518.4:76:G:GG");
	assert.equal(variationDetails.results[0]?.canonicalSpdi, "NC_000011.10:5226994:C:CC");
	assert.equal(variationDetails.results[0]?.hgvs, "NM_000518.4:c.27dupG");
	assert.deepEqual(variationDetails.results[0]?.rsids, ["rs334"]);
	assert.deepEqual(variationDetails.results[0]?.vcfFields, { chrom: "NC_000011.10", pos: 5226995, ref: "C", alt: "CC" });
	assert.equal(variationFallbackDetails.searchMode, "spdi-contextual");
	assert.equal(variationFallbackDetails.results[0]?.contextualSpdi, "NC_000001.10:12345:0:C");
	assert.equal(variationFallbackDetails.warnings?.some((warning) => warning.error?.includes("500")), true);
	assert.equal(variationBatchDetails.searchMode, "hgvs-batch-contextuals");
	assert.deepEqual(variationBatchDetails.inputs, ["NM_000518.4:c.27dupG", "NC_000001.10:g.12345T>A"]);
	assert.equal(variationBatchDetails.results[0]?.inputHgvsValidity, "valid");
	assert.deepEqual(variationBatchDetails.results[0]?.contextualSpdis, ["NM_000518.4:76:G:GG"]);
	assert.deepEqual(variationBatchDetails.results[1]?.contextualSpdis, ["NC_000001.10:12344:T:A"]);
	assert.equal(new URL(requests[0]!.url).searchParams.get("tool"), "feynman");
	assert.equal(new URL(requests[0]!.url).searchParams.get("email"), "variants@example.edu");
	assert.equal(requests.some((request) => request.url === "https://api.ncbi.nlm.nih.gov/variation/v0/refsnp/7412"), true);
	assert.equal(requests.some((request) => request.url === "https://cadd.gs.washington.edu/api/v1.0/GRCh38-v1.7/19:44908822_C_T"), true);
	assert.equal(requests.some((request) => request.url === "https://api.ncbi.nlm.nih.gov/variation/v0/hgvs/NM_000518.4:c.27dupG/contextuals"), true);
	const batchRequest = requests.find((request) => request.method === "POST" && request.url === "https://api.ncbi.nlm.nih.gov/variation/v0/hgvs/batch/contextuals");
	assert.deepEqual(batchRequest?.body ? JSON.parse(batchRequest.body) : undefined, { hgvs: ["NM_000518.4:c.27dupG", "NC_000001.10:g.12345T>A"] });
	assert.match(tools.get("feynman_science_database_search")?.promptSnippet ?? "", /ClinVar/);
	assert.match(tools.get("feynman_science_database_search")?.promptSnippet ?? "", /dbSNP/);
	assert.match(tools.get("feynman_science_database_search")?.promptSnippet ?? "", /CADD/);
	assert.match(tools.get("feynman_science_database_search")?.promptSnippet ?? "", /NCBI Variation Services/);
});

test("science database tool searches Feynman-owned specialty bio databases", async () => {
	const requests: Array<{ body?: string; method: string; url: string }> = [];
	globalThis.fetch = async (input, init) => {
		const url = String(input);
		requests.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
		if (url.includes("encodeproject.org/search")) {
			return jsonResponse({
				total: 1,
				"@graph": [{
					"@id": "/experiments/ENCSR000ABC/",
					accession: "ENCSR000ABC",
					status: "released",
					assay_title: "ChIP-seq",
					assay_term_name: "ChIP-seq",
					target: { label: "CTCF" },
					biosample_ontology: { term_name: "K562", classification: "cell line" },
					lab: { title: "ENCODE Lab" },
					date_released: "2026-01-02",
				}],
			});
		}
		if (url.includes("/esearch.fcgi")) {
			return jsonResponse({
				esearchresult: {
					count: "1",
					idlist: ["200000000"],
				},
			});
		}
		if (url.includes("/esummary.fcgi")) {
			return jsonResponse({
				result: {
					uids: ["200000000"],
					"200000000": {
						uid: "200000000",
						accession: "GSE12345",
						title: "Single-cell tumor atlas",
						summary: "A GEO series summary.",
						gdstype: "Expression profiling by high throughput sequencing",
						taxon: "Homo sapiens",
						n_samples: 24,
						pdat: "2026/01/10",
						gpl: "GPL24676",
						pubmedids: ["12345678"],
						samples: [{ accession: "GSM1", title: "sample one" }],
					},
				},
			});
		}
		if (url.includes("gtexportal.org/api/v2/reference/gene")) {
			return jsonResponse({
				paging_info: { totalNumberOfItems: 1 },
				data: [{
					geneSymbol: "BRCA1",
					geneSymbolUpper: "BRCA1",
					gencodeId: "ENSG00000012048.23",
					gencodeVersion: "v26",
					genomeBuild: "GRCh38",
				}],
			});
		}
		if (url.includes("gtexportal.org/api/v2/expression/medianGeneExpression")) {
			return jsonResponse({
				paging_info: { totalNumberOfItems: 2 },
				data: [
					{ geneSymbol: "BRCA1", gencodeId: "ENSG00000012048.23", tissueSiteDetailId: "Breast_Mammary_Tissue", median: 12.3 },
					{ geneSymbol: "BRCA1", gencodeId: "ENSG00000012048.23", tissueSiteDetailId: "Ovary", median: 8.4 },
				],
			});
		}
		if (url.includes("gnomad.broadinstitute.org/api")) {
			const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string; variables?: Record<string, unknown> };
			if (body.query?.includes("structural_variant(variantId")) {
				return jsonResponse({
					data: {
						structural_variant: {
							variant_id: body.variables?.variantId,
							reference_genome: "GRCh38",
							chrom: "17",
							pos: 2481242,
							end: 21559655,
							chrom2: "17",
							pos2: null,
							type: "DEL",
							length: 19078413,
							ac: 35,
							an: 124536,
							af: 0.000281,
							homozygote_count: 0,
							hemizygote_count: 0,
							filters: ["UNRESOLVED"],
							qual: 112,
							major_consequence: "lof",
							consequence: "lof",
							consequences: [{ consequence: "lof", genes: ["TP53", "ACADVL"] }],
							algorithms: ["Depth", "PE"],
							evidence: ["RD", "SR"],
						},
					},
				});
			}
			if (body.query?.includes("structural_variants")) {
				return jsonResponse({
					data: {
						gene: {
							gene_id: "ENSG00000141510",
							symbol: "TP53",
							structural_variants: [
								{
									variant_id: "BND_chr3_0f54dfa6",
									reference_genome: "GRCh38",
									consequence: "promoter",
									major_consequence: "promoter",
									ac: 1,
									an: 126092,
									af: 0.000008,
									homozygote_count: 0,
									hemizygote_count: 0,
									chrom: "3",
									pos: 48044046,
									end: 48044046,
									chrom2: "17",
									pos2: 7688285,
									type: "BND",
									length: -1,
									filters: ["UNRESOLVED"],
								},
								{
									variant_id: "DEL_chr17_599b1512",
									reference_genome: "GRCh38",
									consequence: "lof",
									major_consequence: "lof",
									ac: 35,
									an: 124536,
									af: 0.000281,
									homozygote_count: 0,
									hemizygote_count: 0,
									chrom: "17",
									pos: 2481242,
									end: 21559655,
									chrom2: "17",
									pos2: null,
									type: "DEL",
									length: 19078413,
									filters: ["UNRESOLVED"],
								},
							],
						},
					},
				});
			}
			if (body.query?.includes("mitochondrial_variant(variant_id")) {
				return jsonResponse({
					data: {
						mitochondrial_variant: {
							variant_id: body.variables?.variantId,
							reference_genome: "GRCh38",
							pos: 3243,
							ref: "A",
							alt: "G",
							ac_het: 6,
							ac_hom: 0,
							an: 56383,
							max_heteroplasmy: 0.464,
							filters: [],
							flags: [],
							rsid: "rs199474657",
							rsids: ["rs199474657"],
						},
					},
				});
			}
			if (body.query?.includes("mitochondrial_variants") && body.query.includes("region(")) {
				return jsonResponse({
					data: {
						region: {
							mitochondrial_variants: [
								{ variant_id: "M-3-T-C", reference_genome: "GRCh38", pos: 3, ac_het: 1, ac_hom: 19, an: 56434, max_heteroplasmy: 0.997, filters: [], flags: [], rsid: "rs879008702", rsids: ["rs879008702"] },
								{ variant_id: "M-6-C-CCTCAA", reference_genome: "GRCh38", pos: 6, ac_het: 0, ac_hom: 0, an: 56433, max_heteroplasmy: 0, filters: ["No passing genotype"], flags: [], rsid: undefined, rsids: [] },
							],
						},
					},
				});
			}
			if (body.query?.includes("mitochondrial_variants")) {
				return jsonResponse({
					data: {
						gene: {
							gene_id: "ENSG00000209082",
							symbol: "MT-TL1",
							mitochondrial_variants: [
								{ variant_id: "M-3236-A-G", reference_genome: "GRCh38", pos: 3236, ac_het: 0, ac_hom: 7, an: 56434, max_heteroplasmy: 1, filters: [], flags: [], rsid: undefined, rsids: [], consequence: "non_coding_transcript_exon_variant", gene_id: "ENSG00000209082", gene_symbol: "MT-TL1", transcript_id: "ENST00000387347" },
								{ variant_id: "M-3238-G-A", reference_genome: "GRCh38", pos: 3238, ac_het: 3, ac_hom: 0, an: 56410, max_heteroplasmy: 0.276, filters: [], flags: [], rsid: "rs879008704", rsids: ["rs879008704"], consequence: "non_coding_transcript_exon_variant", gene_id: "ENSG00000209082", gene_symbol: "MT-TL1", transcript_id: "ENST00000387347" },
							],
						},
					},
				});
			}
			if (body.query?.includes("variant_search")) {
				return jsonResponse({
					data: {
						variant_search: [
							{ variant_id: "19-44908822-C-T" },
						],
					},
				});
			}
			if (body.query?.includes("variant(variantId")) {
				return jsonResponse({
					data: {
						variant: {
							variant_id: body.variables?.variantId,
							reference_genome: "GRCh38",
							chrom: "19",
							pos: 44908822,
							ref: "C",
							alt: "T",
							rsids: ["rs7412"],
							exome: { ac: 42, an: 100000, af: 0.00042, homozygote_count: 0, filters: [] },
							genome: { ac: 12, an: 80000, af: 0.00015, homozygote_count: 0, filters: ["PASS"] },
						},
					},
				});
			}
			if (body.query?.includes("gnomad_constraint")) {
				return jsonResponse({
					data: {
						gene: {
							gene_id: "ENSG00000141510",
							symbol: "TP53",
							canonical_transcript_id: "ENST00000269305",
							chrom: "17",
							start: 7661779,
							stop: 7687538,
							strand: "-",
							gnomad_constraint: {
								exp_lof: 55.2,
								obs_lof: 6,
								oe_lof: 0.109,
								oe_lof_lower: 0.05,
								oe_lof_upper: 0.22,
								exp_mis: 1200,
								obs_mis: 900,
								oe_mis: 0.75,
								oe_mis_lower: 0.7,
								oe_mis_upper: 0.8,
								exp_syn: 400,
								obs_syn: 395,
								oe_syn: 0.99,
								oe_syn_lower: 0.9,
								oe_syn_upper: 1.1,
								pli: 1,
								lof_z: 7.1,
								mis_z: 3.4,
								syn_z: 0.1,
							},
						},
					},
				});
			}
		}
		if (url.includes("interpro/api/entry/interpro")) {
			return jsonResponse({
				count: 1,
				results: [{
					metadata: {
						accession: "IPR000001",
						name: "Kringle",
						type: "Domain",
						source_database: "interpro",
						integrated: "integrated",
						go_terms: [{ identifier: "GO:0005515", name: "protein binding" }],
						member_databases: { pfam: { PF00051: "Kringle" } },
					},
				}],
			});
		}
		if (url.includes("ols4/api/search")) {
			return jsonResponse({
				response: {
					numFound: 1,
					docs: [{
						obo_id: "GO:0006281",
						iri: "http://purl.obolibrary.org/obo/GO_0006281",
						label: "DNA repair",
						ontology_name: "go",
						short_form: "GO_0006281",
						description: ["The process of restoring DNA."],
						synonyms: ["DNA repair process"],
						has_children: true,
					}],
				},
			});
		}
		if (url.includes("QuickGO/services/annotation/search")) {
			return jsonResponse({
				numberOfHits: 1,
				results: [{
					geneProductId: "UniProtKB:P38398",
					symbol: "BRCA1",
					goId: "GO:0006281",
					goName: "DNA repair",
					goAspect: "biological_process",
					evidenceCode: "ECO:0000314",
					goEvidence: "IDA",
					reference: "PMID:12345678",
					taxonId: 9606,
					assignedBy: "UniProt",
					date: "20260101",
				}],
			});
		}
		if (url.includes("pride/ws/archive/v2/search/projects")) {
			return new Response(JSON.stringify([{
				accession: "PXD000001",
				title: "Proteome project",
				organisms: ["Homo sapiens (human)"],
				instruments: ["Orbitrap"],
				experimentTypes: ["Shotgun proteomics"],
				keywords: ["proteome"],
				submissionDate: "2026-01-03T00:00:00Z",
				publicationDate: "2026-02-03T00:00:00Z",
				references: [{ pubmedID: 12345678, doi: "10.1234/pride", referenceLine: "Example reference" }],
			}]), {
				status: 200,
				headers: {
					"content-type": "application/json",
					total_records: "1",
				},
			});
		}
		if (url.includes("reactome.org/AnalysisService/identifiers")) {
			return jsonResponse({
				summary: { token: "token-1" },
				identifiersNotFound: 0,
				pathwaysFound: 1,
				pathways: [{
					stId: "R-HSA-73857",
					dbId: 73857,
					name: "RNA Polymerase II Transcription",
					species: { name: "Homo sapiens", taxId: 9606 },
					llp: true,
					inDisease: false,
					entities: { found: 2, total: 10, pValue: 0.001, fdr: 0.01 },
					reactions: { found: 1, total: 5 },
				}],
			});
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tools = registerTools();
	const encode = await tools.get("feynman_science_database_search")?.execute("call-encode", {
		source: "encode",
		query: "CTCF K562",
		limit: 1,
	});
	const geo = await tools.get("feynman_science_database_search")?.execute("call-geo", {
		source: "geo",
		query: "single cell tumor",
		limit: 1,
	});
	const gtex = await tools.get("feynman_science_database_search")?.execute("call-gtex", {
		source: "gtex",
		query: "BRCA1",
		limit: 1,
	});
	const gnomadSearch = await tools.get("feynman_science_database_search")?.execute("call-gnomad-search", {
		source: "gnomad",
		query: "rs7412",
		limit: 1,
	});
	const gnomadVariant = await tools.get("feynman_science_database_search")?.execute("call-gnomad-variant", {
		source: "gnomad",
		query: "19-44908822-C-T",
		limit: 1,
	});
	const gnomadConstraint = await tools.get("feynman_science_database_search")?.execute("call-gnomad-constraint", {
		source: "gnomad",
		query: "constraint:TP53",
		limit: 1,
	});
	const gnomadStructuralGene = await tools.get("feynman_science_database_search")?.execute("call-gnomad-structural-gene", {
		source: "gnomad",
		query: "sv:TP53",
		limit: 1,
	});
	const gnomadStructuralVariant = await tools.get("feynman_science_database_search")?.execute("call-gnomad-structural-variant", {
		source: "gnomad",
		query: "sv-id:DEL_chr17_599b1512",
		limit: 1,
	});
	const gnomadMitoGene = await tools.get("feynman_science_database_search")?.execute("call-gnomad-mito-gene", {
		source: "gnomad",
		query: "mito:MT-TL1",
		limit: 1,
	});
	const gnomadMitoRegion = await tools.get("feynman_science_database_search")?.execute("call-gnomad-mito-region", {
		source: "gnomad",
		query: "mito:1-200",
		limit: 1,
	});
	const gnomadMitoVariant = await tools.get("feynman_science_database_search")?.execute("call-gnomad-mito-variant", {
		source: "gnomad",
		query: "M-3243-A-G",
		limit: 1,
	});
	const interpro = await tools.get("feynman_science_database_search")?.execute("call-interpro", {
		source: "interpro",
		query: "kringle",
		limit: 1,
	});
	const ols = await tools.get("feynman_science_database_search")?.execute("call-ols", {
		source: "ols",
		query: "DNA repair",
		limit: 1,
	});
	const pride = await tools.get("feynman_science_database_search")?.execute("call-pride", {
		source: "pride",
		query: "proteome",
		limit: 1,
	});
	const quickgo = await tools.get("feynman_science_database_search")?.execute("call-quickgo", {
		source: "quickgo",
		query: "P38398",
		limit: 1,
	});
	const reactome = await tools.get("feynman_science_database_search")?.execute("call-reactome", {
		source: "reactome",
		query: "BRCA1 TP53",
		limit: 1,
	});

	const encodeDetails = encode?.details as { results: Array<{ accession?: string; targetLabel?: string }> };
	const geoDetails = geo?.details as { results: Array<{ accession?: string; sampleCount?: number }> };
	const gtexDetails = gtex?.details as { gene?: { gencodeId?: string }; results: Array<{ tissueSiteDetailId?: string; medianTpm?: number }> };
	const gnomadSearchDetails = gnomadSearch?.details as { dataset?: string; results: Array<{ variantId?: string }> };
	const gnomadVariantDetails = gnomadVariant?.details as { results: Array<{ variantId?: string; exome?: { af?: number }; genome?: { filters?: string[] } }> };
	const gnomadConstraintDetails = gnomadConstraint?.details as { results: Array<{ geneId?: string; constraint?: { pli?: number; oeLofUpper?: number } }> };
	const gnomadStructuralGeneDetails = gnomadStructuralGene?.details as { dataset?: string; results: Array<{ variantId?: string; type?: string; af?: number }>; searchMode?: string; truncated?: boolean };
	const gnomadStructuralVariantDetails = gnomadStructuralVariant?.details as { dataset?: string; results: Array<{ algorithms?: string[]; consequences?: Array<{ geneCount?: number; genes?: string[]; genesTruncated?: boolean }>; variantId?: string; qual?: number }>; searchMode?: string };
	const gnomadMitoGeneDetails = gnomadMitoGene?.details as { results: Array<{ acHom?: number; maxHeteroplasmy?: number; variantId?: string }>; searchMode?: string; truncated?: boolean };
	const gnomadMitoRegionDetails = gnomadMitoRegion?.details as { region?: { start?: number; stop?: number }; results: Array<{ filters?: string[]; pos?: number; variantId?: string }>; searchMode?: string; truncated?: boolean };
	const gnomadMitoVariantDetails = gnomadMitoVariant?.details as { results: Array<{ alt?: string; maxHeteroplasmy?: number; rsids?: string[]; variantId?: string }>; searchMode?: string };
	const interproDetails = interpro?.details as { results: Array<{ accession?: string; goTerms?: Array<{ identifier?: string }> }> };
	const olsDetails = ols?.details as { results: Array<{ curie?: string; label?: string }> };
	const prideDetails = pride?.details as { results: Array<{ accession?: string; references?: Array<{ doi?: string }> }> };
	const quickgoDetails = quickgo?.details as { accession?: string; results: Array<{ goId?: string; evidenceCode?: string }> };
	const reactomeDetails = reactome?.details as { identifiers?: string[]; results: Array<{ stableId?: string; entitiesPValue?: number }> };

	assert.equal(encodeDetails.results[0]?.accession, "ENCSR000ABC");
	assert.equal(encodeDetails.results[0]?.targetLabel, "CTCF");
	assert.equal(geoDetails.results[0]?.accession, "GSE12345");
	assert.equal(geoDetails.results[0]?.sampleCount, 24);
	assert.equal(gtexDetails.gene?.gencodeId, "ENSG00000012048.23");
	assert.equal(gtexDetails.results[0]?.tissueSiteDetailId, "Breast_Mammary_Tissue");
	assert.equal(gtexDetails.results[0]?.medianTpm, 12.3);
	assert.equal(gnomadSearchDetails.dataset, "gnomad_r4");
	assert.equal(gnomadSearchDetails.results[0]?.variantId, "19-44908822-C-T");
	assert.equal(gnomadVariantDetails.results[0]?.variantId, "19-44908822-C-T");
	assert.equal(gnomadVariantDetails.results[0]?.exome?.af, 0.00042);
	assert.deepEqual(gnomadVariantDetails.results[0]?.genome?.filters, ["PASS"]);
	assert.equal(gnomadConstraintDetails.results[0]?.geneId, "ENSG00000141510");
	assert.equal(gnomadConstraintDetails.results[0]?.constraint?.pli, 1);
	assert.equal(gnomadConstraintDetails.results[0]?.constraint?.oeLofUpper, 0.22);
	assert.equal(gnomadStructuralGeneDetails.searchMode, "structural-variants-gene");
	assert.equal(gnomadStructuralGeneDetails.dataset, "gnomad_sv_r4");
	assert.equal(gnomadStructuralGeneDetails.results[0]?.variantId, "DEL_chr17_599b1512");
	assert.equal(gnomadStructuralGeneDetails.results[0]?.type, "DEL");
	assert.equal(gnomadStructuralGeneDetails.results[0]?.af, 0.000281);
	assert.equal(gnomadStructuralGeneDetails.truncated, true);
	assert.equal(gnomadStructuralVariantDetails.searchMode, "structural-variant");
	assert.equal(gnomadStructuralVariantDetails.results[0]?.variantId, "DEL_chr17_599b1512");
	assert.equal(gnomadStructuralVariantDetails.results[0]?.qual, 112);
	assert.deepEqual(gnomadStructuralVariantDetails.results[0]?.algorithms, ["Depth", "PE"]);
	assert.deepEqual(gnomadStructuralVariantDetails.results[0]?.consequences?.[0]?.genes, ["ACADVL", "TP53"]);
	assert.equal(gnomadStructuralVariantDetails.results[0]?.consequences?.[0]?.geneCount, 2);
	assert.equal(gnomadStructuralVariantDetails.results[0]?.consequences?.[0]?.genesTruncated, false);
	assert.equal(gnomadMitoGeneDetails.searchMode, "mitochondrial-variants-gene");
	assert.equal(gnomadMitoGeneDetails.results[0]?.variantId, "M-3236-A-G");
	assert.equal(gnomadMitoGeneDetails.results[0]?.acHom, 7);
	assert.equal(gnomadMitoGeneDetails.results[0]?.maxHeteroplasmy, 1);
	assert.equal(gnomadMitoGeneDetails.truncated, true);
	assert.equal(gnomadMitoRegionDetails.searchMode, "mitochondrial-variants-region");
	assert.equal(gnomadMitoRegionDetails.region?.start, 1);
	assert.equal(gnomadMitoRegionDetails.region?.stop, 200);
	assert.equal(gnomadMitoRegionDetails.results[0]?.variantId, "M-3-T-C");
	assert.equal(gnomadMitoRegionDetails.results[0]?.pos, 3);
	assert.equal(gnomadMitoRegionDetails.truncated, true);
	assert.equal(gnomadMitoVariantDetails.searchMode, "mitochondrial-variant");
	assert.equal(gnomadMitoVariantDetails.results[0]?.variantId, "M-3243-A-G");
	assert.equal(gnomadMitoVariantDetails.results[0]?.alt, "G");
	assert.equal(gnomadMitoVariantDetails.results[0]?.maxHeteroplasmy, 0.464);
	assert.deepEqual(gnomadMitoVariantDetails.results[0]?.rsids, ["rs199474657"]);
	assert.equal(interproDetails.results[0]?.accession, "IPR000001");
	assert.equal(interproDetails.results[0]?.goTerms?.[0]?.identifier, "GO:0005515");
	assert.equal(olsDetails.results[0]?.curie, "GO:0006281");
	assert.equal(olsDetails.results[0]?.label, "DNA repair");
	assert.equal(prideDetails.results[0]?.accession, "PXD000001");
	assert.equal(prideDetails.results[0]?.references?.[0]?.doi, "10.1234/pride");
	assert.equal(quickgoDetails.accession, "P38398");
	assert.equal(quickgoDetails.results[0]?.goId, "GO:0006281");
	assert.equal(quickgoDetails.results[0]?.evidenceCode, "ECO:0000314");
	assert.deepEqual(reactomeDetails.identifiers, ["BRCA1", "TP53"]);
	assert.equal(reactomeDetails.results[0]?.stableId, "R-HSA-73857");
	assert.equal(reactomeDetails.results[0]?.entitiesPValue, 0.001);
	assert.equal(new URL(requests.find((request) => request.url.includes("encodeproject.org"))?.url ?? "").searchParams.get("searchTerm"), "CTCF K562");
	assert.equal(new URL(requests.find((request) => request.url.includes("gtexportal.org/api/v2/expression"))?.url ?? "").searchParams.get("gencodeId"), "ENSG00000012048.23");
	assert.match(requests.find((request) => request.url.includes("gnomad.broadinstitute.org"))?.body ?? "", /gnomad_r4/);
	assert.match(requests.find((request) => request.body?.includes("structural_variants"))?.body ?? "", /gnomad_sv_r4/);
	assert.match(requests.find((request) => request.body?.includes("mitochondrial_variants") && request.body.includes("region"))?.body ?? "", /"start":1/);
	assert.equal(new URL(requests.find((request) => request.url.includes("interpro/api"))?.url ?? "").searchParams.get("page_size"), "1");
	assert.equal(new URL(requests.find((request) => request.url.includes("ols4/api"))?.url ?? "").searchParams.get("rows"), "1");
	assert.equal(new URL(requests.find((request) => request.url.includes("pride/ws"))?.url ?? "").searchParams.get("pageSize"), "1");
	assert.equal(new URL(requests.find((request) => request.url.includes("QuickGO/services"))?.url ?? "").searchParams.get("geneProductId"), "UniProtKB:P38398");
	assert.match(requests.find((request) => request.url.includes("reactome.org"))?.body ?? "", /BRCA1\nTP53/);
	assert.match(tools.get("feynman_science_database_search")?.promptSnippet ?? "", /Reactome/);
});
