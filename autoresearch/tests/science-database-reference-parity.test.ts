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

afterEach(() => {
	globalThis.fetch = originalFetch;
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

function textResponse(body: string, contentType = "text/plain"): Response {
	return new Response(body, {
		status: 200,
		headers: { "content-type": contentType },
	});
}

function bodyParam(init: RequestInit | undefined, key: string): string | null {
	const body = init?.body;
	if (body instanceof URLSearchParams) return body.get(key);
	return null;
}

test("science database tool resolves PubChem compounds with properties and synonyms", async () => {
	const requests: Array<{ body?: RequestInit["body"]; url: string }> = [];
	globalThis.fetch = async (input, init) => {
		const url = String(input);
		requests.push({ body: init?.body, url });
		if (url.includes("/compound/name/cids/JSON")) {
			assert.equal(bodyParam(init, "name"), "aspirin");
			return jsonResponse({ IdentifierList: { CID: [2244] } });
		}
		if (url.includes("/compound/cid/property/")) {
			assert.equal(bodyParam(init, "cid"), "2244");
			return jsonResponse({
				PropertyTable: {
					Properties: [{
						CID: 2244,
						MolecularFormula: "C9H8O4",
						MolecularWeight: 180.16,
						ConnectivitySMILES: "CC(=O)OC1=CC=CC=C1C(=O)O",
						InChIKey: "BSYNRYMUTXBXSQ-UHFFFAOYSA-N",
						IUPACName: "2-acetyloxybenzoic acid",
					}],
				},
			});
		}
		if (url.includes("/compound/cid/2244/synonyms/JSON")) {
			return jsonResponse({ InformationList: { Information: [{ CID: 2244, Synonym: ["Aspirin", "Acetylsalicylic acid"] }] } });
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tools = registerTools();
	const result = await tools.get("feynman_science_database_search")?.execute("call-pubchem", {
		source: "pubchem",
		query: "aspirin",
		limit: 1,
	});
	const details = result?.details as { provenance: { endpoints: string[] }; results: Array<{ cid: string; formula: string; inchiKey: string; synonyms: string[] }>; source: string };

	assert.equal(details.source, "pubchem");
	assert.equal(details.results[0]?.cid, "2244");
	assert.equal(details.results[0]?.formula, "C9H8O4");
	assert.equal(details.results[0]?.inchiKey, "BSYNRYMUTXBXSQ-UHFFFAOYSA-N");
	assert.deepEqual(details.results[0]?.synonyms.slice(0, 2), ["Aspirin", "Acetylsalicylic acid"]);
	assert.equal(details.provenance.endpoints.length, 2);
	assert.match(tools.get("feynman_science_database_search")?.promptSnippet ?? "", /PubChem/);
	assert.equal(requests.some((request) => request.url.includes("tool=feynman")), true);
});

test("science database tool accepts PubChem reference chemistry query names", async () => {
	const requests: Array<{ body?: RequestInit["body"]; url: string }> = [];
	globalThis.fetch = async (input, init) => {
		const url = String(input);
		requests.push({ body: init?.body, url });
		if (url.includes("/compound/name/cids/JSON")) {
			assert.equal(bodyParam(init, "name"), "aspirin");
			return jsonResponse({ IdentifierList: { CID: [2244] } });
		}
		if (url.includes("/compound/fastsimilarity_2d/smiles/cids/JSON")) {
			const parsed = new URL(url);
			assert.equal(parsed.searchParams.get("Threshold"), "90");
			assert.equal(parsed.searchParams.get("MaxRecords"), "1");
			assert.equal(bodyParam(init, "smiles"), "CCO");
			return jsonResponse({ IdentifierList: { CID: [702] } });
		}
		if (url.includes("/compound/cid/property/")) {
			return jsonResponse({
				PropertyTable: {
					Properties: [{
						CID: bodyParam(init, "cid") === "702" ? 702 : 2244,
						MolecularFormula: bodyParam(init, "cid") === "702" ? "C2H6O" : "C9H8O4",
						InChIKey: bodyParam(init, "cid") === "702" ? "LFQSCWFLJHTTHZ-UHFFFAOYSA-N" : "BSYNRYMUTXBXSQ-UHFFFAOYSA-N",
						IUPACName: bodyParam(init, "cid") === "702" ? "ethanol" : "2-acetyloxybenzoic acid",
					}],
				},
			});
		}
		if (url.includes("/synonyms/JSON")) {
			const cid = url.includes("/702/") ? 702 : 2244;
			return jsonResponse({ InformationList: { Information: [{ CID: cid, Synonym: cid === 702 ? ["Ethanol"] : ["Aspirin"] }] } });
		}
		if (url.includes("/compound/cid/2244/assaysummary/JSON")) {
			return jsonResponse({
				Table: {
					Columns: { Column: ["AID", "Activity Outcome", "Name"] },
					Row: [
						{ Cell: [1, "Active", "COX assay"] },
						{ Cell: [2, "Inactive", "counter screen"] },
					],
				},
			});
		}
		if (url.includes("/rest/pug_view/data/compound/2244/JSON")) {
			assert.equal(new URL(url).searchParams.get("heading"), "GHS Classification");
			return jsonResponse({
				Record: {
					Section: [{
						TOCHeading: "Safety and Hazards",
						Section: [{
							TOCHeading: "GHS Classification",
							Information: [{ Name: "Signal", Value: { StringWithMarkup: [{ String: "Warning" }] } }],
							Reference: [{ SourceName: "source" }],
						}],
					}],
				},
			});
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tool = registerTools().get("feynman_science_database_search");
	const searched = await tool?.execute("call-pubchem-search", { source: "pubchem", query: "pubchem_search_compounds:aspirin namespace=name max_cids=1", limit: 1 });
	const fetched = await tool?.execute("call-pubchem-get", { source: "pubchem", query: "pubchem_get_compounds:2244 include_synonyms=true max_synonyms=12", limit: 1 });
	const similar = await tool?.execute("call-pubchem-similar", { source: "pubchem", query: "pubchem_similarity_search:CCO threshold=90 max_records=1 with_properties=true", limit: 1 });
	const assay = await tool?.execute("call-pubchem-assay", { source: "pubchem", query: "pubchem_get_bioassay_summary:2244 active_only=true max_rows=1", limit: 1 });
	const safety = await tool?.execute("call-pubchem-safety", { source: "pubchem", query: "pubchem_get_safety:2244", limit: 1 });
	const searchDetails = searched?.details as { results: Array<{ cid: string }>; searchMode: string };
	const fetchedDetails = fetched?.details as { results: Array<{ synonyms: string[] }>; searchMode: string };
	const similarDetails = similar?.details as { results: Array<{ cid: string; formula: string }>; searchMode: string; threshold: number };
	const assayDetails = assay?.details as { results: Array<{ AID: number; Name: string }>; searchMode: string; totalCount: number };
	const safetyDetails = safety?.details as { results: Array<{ information: Array<{ name: string; value: string }> }>; searchMode: string };

	assert.equal(searchDetails.searchMode, "pubchem-search-compounds");
	assert.equal(searchDetails.results[0]?.cid, "2244");
	assert.equal(fetchedDetails.searchMode, "pubchem-get-compounds");
	assert.deepEqual(fetchedDetails.results[0]?.synonyms, ["Aspirin"]);
	assert.equal(similarDetails.searchMode, "pubchem-similarity-search");
	assert.equal(similarDetails.threshold, 90);
	assert.equal(similarDetails.results[0]?.formula, "C2H6O");
	assert.equal(assayDetails.searchMode, "pubchem-bioassay-summary");
	assert.equal(assayDetails.totalCount, 1);
	assert.equal(assayDetails.results[0]?.Name, "COX assay");
	assert.equal(safetyDetails.searchMode, "pubchem-safety");
	assert.deepEqual(safetyDetails.results[0]?.information[0], { name: "Signal", value: "Warning", referenceNumber: undefined });
	assert.equal(requests.some((request) => request.url.includes("pug_view")), true);
});

test("science database tool searches BindingDB and STRING reference endpoints", async () => {
	const requests: Array<{ body?: RequestInit["body"]; url: string }> = [];
	globalThis.fetch = async (input, init) => {
		const url = String(input);
		requests.push({ body: init?.body, url });
		if (url.includes("bindingdb.org/rest/getLigandsByUniprots")) {
			const parsed = new URL(url);
			assert.equal(parsed.searchParams.get("uniprot"), "P35355");
			assert.equal(parsed.searchParams.get("cutoff"), "100");
			return jsonResponse({
				getLindsByUniprotsResponse: {
					affinities: [{
						BindingDB_MonomerID: "50373475",
						Ligand_Name: "example ligand",
						Ligand_SMILES: "CCO",
						Target_Name: "Prostaglandin G/H synthase 1",
						"UniProt_(SwissProt)_Primary_ID": "P35355",
						Ki: "12 nM",
						PMID: "12345678",
					}, {
						query: "Prostaglandin G/H synthase 2",
						monomerid: "50289082",
						smile: "COc1ccc2n(Cc3ccc(Br)cc3)c(C)c(CC(C)C(O)=O)c2c1",
						affinity_type: "IC50",
						affinity: "3",
						doi: "10.1016/0960-894X(96)00100-X",
					}],
				},
			});
		}
		if (url.includes("version-12-0.string-db.org/api/json/get_string_ids")) {
			assert.equal(bodyParam(init, "identifiers"), "TP53\rBRCA1");
			return jsonResponse([
				{ queryItem: "TP53", stringId: "9606.ENSP00000269305", preferredName: "TP53", ncbiTaxonId: 9606, annotation: "tumor protein p53" },
				{ queryItem: "BRCA1", stringId: "9606.ENSP00000350283", preferredName: "BRCA1", ncbiTaxonId: 9606, annotation: "DNA repair associated" },
			]);
		}
		if (url.includes("version-12-0.string-db.org/api/tsv/network")) {
			assert.equal(bodyParam(init, "required_score"), "700");
			return textResponse([
				"stringId_A\tstringId_B\tpreferredName_A\tpreferredName_B\tncbiTaxonId\tscore\tnscore\tfscore\tpscore\tascore\tescore\tdscore\ttscore",
				"9606.ENSP00000269305\t9606.ENSP00000350283\tTP53\tBRCA1\t9606\t0.999\t0\t0\t0\t0.2\t0.7\t0.9\t0.8",
			].join("\n"), "text/tab-separated-values");
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tools = registerTools();
	const binding = await tools.get("feynman_science_database_search")?.execute("call-bindingdb", {
		source: "bindingdb",
		query: "uniprot:P35355 cutoff=100",
		limit: 2,
	});
	const string = await tools.get("feynman_science_database_search")?.execute("call-string", {
		source: "string",
		query: "TP53,BRCA1 species=9606 score=700",
		limit: 1,
	});
	const bindingDetails = binding?.details as { results: Array<{ affinity?: string; affinityType?: string; bindingDbMonomerId: string; doiUrl?: string; pubmedUrl?: string; targetName: string }> };
	const stringDetails = string?.details as { mappedIdentifiers: Array<{ preferredName: string }>; results: Array<{ preferredNameA: string; preferredNameB: string; score: number }> };

	assert.equal(bindingDetails.results[0]?.bindingDbMonomerId, "50373475");
	assert.equal(bindingDetails.results[0]?.targetName, "Prostaglandin G/H synthase 1");
	assert.equal(bindingDetails.results[0]?.pubmedUrl, "https://pubmed.ncbi.nlm.nih.gov/12345678/");
	assert.equal(bindingDetails.results[1]?.targetName, "Prostaglandin G/H synthase 2");
	assert.equal(bindingDetails.results[1]?.affinityType, "IC50");
	assert.equal(bindingDetails.results[1]?.affinity, "3");
	assert.equal(bindingDetails.results[1]?.doiUrl, "https://doi.org/10.1016/0960-894X(96)00100-X");
	assert.deepEqual(stringDetails.mappedIdentifiers.map((item) => item.preferredName), ["TP53", "BRCA1"]);
	assert.equal(stringDetails.results[0]?.preferredNameA, "TP53");
	assert.equal(stringDetails.results[0]?.preferredNameB, "BRCA1");
	assert.equal(stringDetails.results[0]?.score, 0.999);
});

test("science database tool accepts BindingDB reference chemistry query names", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = String(input);
		requests.push(url);
		if (url.includes("bindingdb.org/rest/getLigandsByUniprots")) {
			const parsed = new URL(url);
			assert.equal(parsed.searchParams.get("uniprot"), "P35355");
			assert.equal(parsed.searchParams.get("cutoff"), "10000");
			return jsonResponse({ getLigandsByUniprotsResponse: { affinities: [{ BindingDB_MonomerID: "1", Ligand_Name: "ligand", Target_Name: "target" }] } });
		}
		if (url.includes("bindingdb.org/rest/getTargetByCompound")) {
			const parsed = new URL(url);
			assert.equal(parsed.searchParams.get("smiles"), "CCO");
			assert.equal(parsed.searchParams.get("cutoff"), "0.85");
			return jsonResponse({ getTargetByCompoundResponse: { targets: [{ monomerid: "2", query: "target 2", smile: "CCO" }] } });
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tool = registerTools().get("feynman_science_database_search");
	const ligands = await tool?.execute("call-binding-ligands", { source: "bindingdb", query: "bindingdb_ligands_by_target:P35355 cutoff=10000", limit: 1 });
	const targets = await tool?.execute("call-binding-targets", { source: "bindingdb", query: "bindingdb_targets_by_compound:CCO similarity=0.85", limit: 1 });
	const ligandDetails = ligands?.details as { results: Array<{ bindingDbMonomerId: string }>; searchMode: string };
	const targetDetails = targets?.details as { results: Array<{ bindingDbMonomerId: string }>; searchMode: string };

	assert.equal(ligandDetails.searchMode, "uniprot-ligands");
	assert.equal(ligandDetails.results[0]?.bindingDbMonomerId, "1");
	assert.equal(targetDetails.searchMode, "compound-targets");
	assert.equal(targetDetails.results[0]?.bindingDbMonomerId, "2");
	assert.equal(requests.length, 2);
});

test("science database tool searches KEGG, Rhea, and Rfam reference endpoints", async () => {
	globalThis.fetch = async (input) => {
		const url = String(input);
		if (url.includes("rest.kegg.jp/find/compound/aspirin")) {
			return textResponse("cpd:C01405\tAspirin; Acetylsalicylic acid\n");
		}
		if (url.includes("rhea-db.org/rhea/")) {
			return textResponse([
				"rhea-id\tequation\tec\tchebi-id",
				"RHEA:14293\tD-glucose + NAD(+) = D-glucono-1,5-lactone + H(+) + NADH\t1.1.1.47\tCHEBI:4167",
			].join("\n"), "text/tab-separated-values");
		}
		if (url.includes("rfam.org/family/RF00005")) {
			return jsonResponse({
				rfam: {
					acc: "RF00005",
					id: "tRNA",
					comment: "Transfer RNA family.",
					clan: { id: "CL00111" },
					num_seed: "960",
					num_full: "100000",
				},
			});
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tools = registerTools();
	const kegg = await tools.get("feynman_science_database_search")?.execute("call-kegg", {
		source: "kegg",
		query: "find:compound aspirin",
		limit: 1,
	});
	const rhea = await tools.get("feynman_science_database_search")?.execute("call-rhea", {
		source: "rhea",
		query: "rhea_search_reactions:glucose",
		limit: 1,
	});
	const rfam = await tools.get("feynman_science_database_search")?.execute("call-rfam", {
		source: "rfam",
		query: "RF00005",
		limit: 1,
	});
	const keggDetails = kegg?.details as { results: Array<{ entryId: string; url: string }> };
	const rheaDetails = rhea?.details as { results: Array<{ ecNumbers: string[]; rheaId: string; url: string }> };
	const rfamDetails = rfam?.details as { results: Array<{ accession: string; clan: string; id: string }> };

	assert.equal(keggDetails.results[0]?.entryId, "cpd:C01405");
	assert.equal(keggDetails.results[0]?.url, "https://www.kegg.jp/entry/cpd%3AC01405");
	assert.equal(rheaDetails.results[0]?.rheaId, "RHEA:14293");
	assert.deepEqual(rheaDetails.results[0]?.ecNumbers, ["1.1.1.47"]);
	assert.equal(rheaDetails.results[0]?.url, "https://www.rhea-db.org/rhea/14293");
	assert.equal(rfamDetails.results[0]?.accession, "RF00005");
	assert.equal(rfamDetails.results[0]?.id, "tRNA");
	assert.equal(rfamDetails.results[0]?.clan, "CL00111");
});

test("science database tool accepts exact Rfam RNA query names", async () => {
	const requests: Array<{ method: string; url: string }> = [];
	globalThis.fetch = async (input, init) => {
		const url = String(input);
		requests.push({ method: init?.method ?? "GET", url });
		if (url === "https://rfam.org/family/RF00005?content-type=application%2Fjson") {
			return jsonResponse({
				rfam: {
					acc: "RF00005",
					id: "tRNA",
					description: "tRNA family",
					comment: "Transfer RNA",
					clan: { acc: "CL00111", id: "tRNA_clan" },
					curation: { type: "Gene; tRNA;", num_seed: 960, num_full: 5364641, num_species: 1000 },
					cm: { threshold: { gathering: 29.3 } },
					release: { number: "15.1", date: "2024-12-01" },
				},
			});
		}
		if (url === "https://rfam.org/family/RF00005/id?content-type=text%2Fplain") return textResponse("tRNA\n");
		if (url === "https://rfam.org/family/tRNA/acc?content-type=text%2Fplain") return textResponse("RF00005\n");
		if (url === "https://rfam.org/family/RF00005/alignment?content-type=text%2Fplain") {
			return textResponse("# STOCKHOLM 1.0\nseqA ACGU\nseqB A-GU\n//\n");
		}
		if (url === "https://rfam.org/family/RF00005/cm?content-type=text%2Fplain") {
			return textResponse("INFERNAL1/a\nNAME tRNA\nACC RF00005\nSTATES 10\nCLEN 73\nCM\n");
		}
		if (url === "https://rfam.org/family/RF00005/tree?content-type=text%2Fplain") return textResponse("(seqA:0.1,seqB:0.2);\n");
		if (url === "https://rfam.org/family/RF00005/regions?content-type=text%2Fplain") {
			return textResponse("# found 2 regions\nURS000001\t50.1\t1\t73\ttransfer RNA\tHomo sapiens\t9606\nURS000002\t49.8\t2\t74\ttransfer RNA\tMus musculus\t10090\n");
		}
		if (url === "https://rfam.org/family/RF00005/structures?content-type=application%2Fjson") {
			return jsonResponse({
				mapping: [
					{ pdb_id: "2XYZ", chain: "B", pdb_start: 2, pdb_end: 10, cm_start: 2, cm_end: 10 },
					{ pdb_id: "1ABC", chain: "A", pdb_start: 1, pdb_end: 9, cm_start: 1, cm_end: 9 },
				],
			});
		}
		if (url === "https://batch.rfam.org/submit-job") {
			assert.equal(init?.method, "POST");
			return jsonResponse({
				jobId: "infernal_cmscan-test",
				resultURL: "https://batch.rfam.org/result/infernal_cmscan-test",
			});
		}
		if (url === "https://batch.rfam.org/result/infernal_cmscan-test") {
			return jsonResponse({
				searchSequence: "ACGUACGU",
				jobId: "infernal_cmscan-test",
				hits: {
					tRNA: [{ id: "tRNA", acc: "RF00005", start: 1, end: 8, score: 42.5, E: 1e-5 }],
				},
			});
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tool = registerTools().get("feynman_science_database_search");
	const family = await tool?.execute("call-rfam-family", { source: "rfam", query: "get_family:RF00005", limit: 2 });
	const accToId = await tool?.execute("call-rfam-acc-id", { source: "rfam", query: "accession_to_id:RF00005", limit: 1 });
	const idToAcc = await tool?.execute("call-rfam-id-acc", { source: "rfam", query: "id_to_accession:tRNA", limit: 1 });
	const alignment = await tool?.execute("call-rfam-alignment", { source: "rfam", query: "get_seed_alignment:RF00005 fmt=stockholm max_bytes=1000", limit: 2 });
	const cm = await tool?.execute("call-rfam-cm", { source: "rfam", query: "get_covariance_model:RF00005 max_bytes=1000", limit: 1 });
	const tree = await tool?.execute("call-rfam-tree", { source: "rfam", query: "get_tree:RF00005", limit: 1 });
	const regions = await tool?.execute("call-rfam-regions", { source: "rfam", query: "get_sequence_regions:RF00005", limit: 1 });
	const structures = await tool?.execute("call-rfam-structures", { source: "rfam", query: "get_structure_mapping:RF00005", limit: 1 });
	const search = await tool?.execute("call-rfam-search-sequence", { source: "rfam", query: "search_sequence:ACGUACGU max_wait_s=1 poll_interval_s=1", limit: 1 });
	const familyDetails = family?.details as { gathering_cutoff: number; num_full: number; rfam_acc: string; rfam_id: string };
	const accToIdDetails = accToId?.details as { accession: string; rfam_id: string };
	const idToAccDetails = idToAcc?.details as { accession: string; rfam_id: string };
	const alignmentDetails = alignment?.details as { alignment: string; num_sequences: number; sequence_names: string[]; sha256: string };
	const cmDetails = cm?.details as { cm: string; header: { ACC: string; CLEN: number; NAME: string; STATES: number }; sha256: string };
	const treeDetails = tree?.details as { num_leaf_labels: number; tree: string };
	const regionDetails = regions?.details as { declared_count: number; num_regions: number; regions: Array<{ sequence_accession: string }> };
	const structureDetails = structures?.details as { mapping: Array<{ pdb_id: string }>; num_mappings: number; num_pdb_ids: number; pdb_ids: string[] };
	const searchDetails = search?.details as { families: string[]; job_id: string; num_hits: number; search_sequence: string };

	assert.equal(familyDetails.rfam_acc, "RF00005");
	assert.equal(familyDetails.rfam_id, "tRNA");
	assert.equal(familyDetails.num_full, 5364641);
	assert.equal(familyDetails.gathering_cutoff, 29.3);
	assert.equal(accToIdDetails.accession, "RF00005");
	assert.equal(accToIdDetails.rfam_id, "tRNA");
	assert.equal(idToAccDetails.accession, "RF00005");
	assert.equal(idToAccDetails.rfam_id, "tRNA");
	assert.equal(alignmentDetails.num_sequences, 2);
	assert.deepEqual(alignmentDetails.sequence_names, ["seqA", "seqB"]);
	assert.match(alignmentDetails.alignment, /STOCKHOLM/);
	assert.equal(alignmentDetails.sha256.length, 64);
	assert.equal(cmDetails.header.NAME, "tRNA");
	assert.equal(cmDetails.header.ACC, "RF00005");
	assert.equal(cmDetails.header.STATES, 10);
	assert.equal(cmDetails.header.CLEN, 73);
	assert.match(cmDetails.cm, /INFERNAL/);
	assert.equal(cmDetails.sha256.length, 64);
	assert.equal(treeDetails.num_leaf_labels, 2);
	assert.match(treeDetails.tree, /seqA/);
	assert.equal(regionDetails.declared_count, 2);
	assert.equal(regionDetails.num_regions, 1);
	assert.equal(regionDetails.regions[0]?.sequence_accession, "URS000001");
	assert.equal(structureDetails.num_mappings, 1);
	assert.equal(structureDetails.num_pdb_ids, 2);
	assert.deepEqual(structureDetails.pdb_ids, ["1ABC", "2XYZ"]);
	assert.equal(structureDetails.mapping[0]?.pdb_id, "1ABC");
	assert.equal(searchDetails.job_id, "infernal_cmscan-test");
	assert.equal(searchDetails.num_hits, 1);
	assert.deepEqual(searchDetails.families, ["tRNA"]);
	assert.equal(searchDetails.search_sequence, "ACGUACGU");
	assert.deepEqual(requests.map((request) => request.url), [
		"https://rfam.org/family/RF00005?content-type=application%2Fjson",
		"https://rfam.org/family/RF00005/id?content-type=text%2Fplain",
		"https://rfam.org/family/tRNA/acc?content-type=text%2Fplain",
		"https://rfam.org/family/RF00005/alignment?content-type=text%2Fplain",
		"https://rfam.org/family/RF00005/cm?content-type=text%2Fplain",
		"https://rfam.org/family/RF00005/tree?content-type=text%2Fplain",
		"https://rfam.org/family/RF00005/regions?content-type=text%2Fplain",
		"https://rfam.org/family/RF00005/structures?content-type=application%2Fjson",
		"https://batch.rfam.org/submit-job",
		"https://batch.rfam.org/result/infernal_cmscan-test",
	]);
});

test("science database tool accepts Rhea get-reaction reference query name", async () => {
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		assert.equal(url.origin, "https://www.rhea-db.org");
		assert.equal(url.pathname, "/rhea/");
		assert.equal(url.searchParams.get("query"), "14293");
		assert.equal(url.searchParams.get("limit"), "1");
		assert.match(url.searchParams.get("columns") ?? "", /pubmed/);
		return textResponse([
			"rhea-id\tequation\tec\tchebi-id\tchebi\tpubmed\tgo\treaction-xref(KEGG)\treaction-xref(Reactome)",
			"RHEA:14293\tD-glucose + NAD(+) = D-glucono-1,5-lactone + H(+) + NADH\t1.1.1.47\tCHEBI:4167\tD-glucose\t123456\tGO:0016614\tR00658\tR-HSA-1234",
		].join("\n"), "text/tab-separated-values");
	};

	const tool = registerTools().get("feynman_science_database_search");
	const result = await tool?.execute("call-rhea-get", { source: "rhea", query: "rhea_get_reaction:RHEA:14293", limit: 1 });
	const details = result?.details as { results: Array<{ chebiNames: string[]; goTerms: string[]; keggXrefs: string[]; pubmedIds: string[]; rheaId: string }>; searchMode: string };

	assert.equal(details.searchMode, "rhea-get-reaction");
	assert.equal(details.results[0]?.rheaId, "RHEA:14293");
	assert.deepEqual(details.results[0]?.pubmedIds, ["123456"]);
	assert.deepEqual(details.results[0]?.goTerms, ["GO:0016614"]);
	assert.deepEqual(details.results[0]?.keggXrefs, ["R00658"]);
	assert.deepEqual(details.results[0]?.chebiNames, ["D-glucose"]);
});

test("science database tool maps KEGG link and conversion rows with missing ids", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = String(input);
		requests.push(url);
		if (url === "https://rest.kegg.jp/link/pathway/hsa:7157+hsa:672+hsa:9999") {
			return textResponse([
				"hsa:7157\tpath:hsa04115",
				"hsa:7157\tpath:hsa05200",
				"hsa:672\tpath:hsa05200",
			].join("\n"));
		}
		if (url === "https://rest.kegg.jp/conv/ncbi-geneid/hsa:7157+hsa:672") {
			return textResponse([
				"hsa:7157\tncbi-geneid:7157",
				"hsa:672\tncbi-geneid:672",
			].join("\n"));
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tool = registerTools().get("feynman_science_database_search");
	const linked = await tool?.execute("call-kegg-link", { source: "kegg", query: "link:pathway hsa:7157 hsa:672 hsa:9999", limit: 10 });
	const converted = await tool?.execute("call-kegg-conv", { source: "kegg", query: "conv:ncbi-geneid hsa:7157 hsa:672", limit: 10 });
	const linkDetails = linked?.details as { missingIds: string[]; requestLimit: number; results: Array<{ operation: string; sourceId: string; targetDb: string; targetId: string }>; searchMode: string; targetDb: string };
	const convDetails = converted?.details as { results: Array<{ operation: string; sourceDb: string; sourceId: string; targetDb: string; targetId: string }>; searchMode: string; targetDb: string };

	assert.equal(linkDetails.searchMode, "link");
	assert.equal(linkDetails.targetDb, "pathway");
	assert.equal(linkDetails.requestLimit, 10);
	assert.deepEqual(linkDetails.missingIds, ["hsa:9999"]);
	assert.deepEqual(linkDetails.results.map((row) => [row.operation, row.sourceId, row.targetDb, row.targetId]), [
		["link", "hsa:7157", "path", "path:hsa04115"],
		["link", "hsa:7157", "path", "path:hsa05200"],
		["link", "hsa:672", "path", "path:hsa05200"],
	]);
	assert.equal(convDetails.searchMode, "conv");
	assert.equal(convDetails.targetDb, "ncbi-geneid");
	assert.deepEqual(convDetails.results.map((row) => [row.operation, row.sourceId, row.sourceDb, row.targetDb, row.targetId]), [
		["conv", "hsa:7157", "hsa", "ncbi-geneid", "ncbi-geneid:7157"],
		["conv", "hsa:672", "hsa", "ncbi-geneid", "ncbi-geneid:672"],
	]);
	assert.deepEqual(requests, [
		"https://rest.kegg.jp/link/pathway/hsa:7157+hsa:672+hsa:9999",
		"https://rest.kegg.jp/conv/ncbi-geneid/hsa:7157+hsa:672",
	]);
	assert.match(tool?.promptGuidelines?.join("\n") ?? "", /KEGG/);
});
