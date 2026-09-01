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

function textResponse(body: string): Response {
	return new Response(body, {
		status: 200,
		headers: { "content-type": "text/csv" },
	});
}

test("science database tool searches ChEBI records through the public REST API", async () => {
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		assert.equal(url.toString(), "https://www.ebi.ac.uk/chebi/backend/api/public/es_search/?term=aspirin&size=2&page=1");
		return jsonResponse({
			total: 26,
			number_pages: 13,
			results: [{
				_score: 58.7,
				_source: {
					chebi_accession: "CHEBI:759292",
					name: "aspirin trelamine",
					definition: "A salt form of aspirin.",
					stars: 2,
					formula: "C15H21NO4",
					charge: 0,
					mass: 279.336,
					monoisotopicmass: 279.14706,
					smiles: "CCN(CC)CCOC(=O)c1ccccc1OC(C)=O",
					inchi: "InChI=1S/C15H21NO4",
					inchikey: "GHIVDTCFLFLOBV-UHFFFAOYSA-N",
				},
			}],
		});
	};

	const tool = registerTools().get("feynman_science_database_search");
	const result = await tool?.execute("call-chebi", { source: "chebi", query: "aspirin", limit: 2 });
	const details = result?.details as { results: Array<{ chebiAccession: string; formula: string; inchiKey: string; url: string }>; totalCount: number };

	assert.equal(details.totalCount, 26);
	assert.equal(details.results[0]?.chebiAccession, "CHEBI:759292");
	assert.equal(details.results[0]?.formula, "C15H21NO4");
	assert.equal(details.results[0]?.inchiKey, "GHIVDTCFLFLOBV-UHFFFAOYSA-N");
	assert.equal(details.results[0]?.url, "https://www.ebi.ac.uk/chebi/searchId.do?chebiId=CHEBI%3A759292");
	assert.match(tool?.promptSnippet ?? "", /ChEBI/);
});

test("science database tool accepts ChEBI reference chemistry query names", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		requests.push(url.toString());
		if (url.pathname.endsWith("/es_search/")) {
			assert.equal(url.searchParams.get("term"), "aspirin");
			assert.equal(url.searchParams.get("size"), "2");
			assert.equal(url.searchParams.get("page"), "2");
			return jsonResponse({
				total: 3,
				results: [{ _source: { chebi_accession: "CHEBI:15365", name: "aspirin", smiles: "CC(=O)Oc1ccccc1C(O)=O" } }],
			});
		}
		if (url.pathname.endsWith("/compound/15365/")) {
			return jsonResponse({
				chebi_accession: "CHEBI:15365",
				name: "aspirin",
				chemical_data: { formula: "C9H8O4" },
				default_structure: { standard_inchi_key: "BSYNRYMUTXBXSQ-UHFFFAOYSA-N" },
				ontology_relations: {
					outgoing_relations: [{ relation_type: "is_a", init_id: "CHEBI:15365", final_id: "CHEBI:35475", final_name: "NSAID" }],
					incoming_relations: [],
				},
			});
		}
		if (url.pathname.endsWith("/ontology/parents/15365/")) {
			return jsonResponse([{ chebi_accession: "CHEBI:35475", name: "NSAID", relation_type: "is_a" }]);
		}
		if (url.pathname.endsWith("/ontology/children/15365/")) {
			return jsonResponse([{ chebi_accession: "CHEBI:999999", name: "aspirin child", relation_type: "has_role" }]);
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tool = registerTools().get("feynman_science_database_search");
	const searched = await tool?.execute("call-chebi-search", { source: "chebi", query: "chebi_search:aspirin page=2", limit: 2 });
	const entity = await tool?.execute("call-chebi-entity", { source: "chebi", query: "chebi_get_entity:CHEBI:15365", limit: 1 });
	const ontology = await tool?.execute("call-chebi-ontology", { source: "chebi", query: "chebi_get_ontology:CHEBI:15365 relation_type=is_a", limit: 5 });
	const searchDetails = searched?.details as { mode: string; results: Array<{ chebiAccession: string }> };
	const entityDetails = entity?.details as { mode: string; results: Array<{ outgoingRelations: Array<{ finalName: string; relationType: string }> }> };
	const ontologyDetails = ontology?.details as { mode: string; results: Array<{ chebiAccession: string; direction: string; relationType: string }>; totalCount: number };

	assert.equal(searchDetails.mode, "chebi-search");
	assert.equal(searchDetails.results[0]?.chebiAccession, "CHEBI:15365");
	assert.equal(entityDetails.mode, "chebi-get-entity");
	assert.deepEqual(entityDetails.results[0]?.outgoingRelations[0], {
		finalChebiId: "CHEBI:35475",
		finalName: "NSAID",
		initChebiId: "CHEBI:15365",
		initName: undefined,
		relationType: "is_a",
	});
	assert.equal(ontologyDetails.mode, "chebi-get-ontology");
	assert.equal(ontologyDetails.totalCount, 1);
	assert.deepEqual(ontologyDetails.results[0], {
		chebiAccession: "CHEBI:35475",
		definition: undefined,
		direction: "parents",
		name: "NSAID",
		relationType: "is_a",
		stars: undefined,
		url: "https://www.ebi.ac.uk/chebi/searchId.do?chebiId=CHEBI%3A35475",
	});
	assert.equal(requests.length, 4);
});

test("science database tool searches Complex Portal participant records", async () => {
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		assert.equal(url.origin, "https://www.ebi.ac.uk");
		assert.equal(url.pathname, "/intact/complex-ws/search/pxref%3A%22P04637%22");
		assert.equal(url.searchParams.get("format"), "json");
		assert.equal(url.searchParams.get("number"), "1");
		return jsonResponse({
			totalNumberOfResults: 11,
			elements: [{
				complexAC: "CPX-6093",
				complexName: "TP53-MDM2-MDM4 transcription regulation complex",
				organismName: "Homo sapiens; 9606",
				predictedComplex: false,
				interactors: [{
					identifier: "P04637",
					identifierLink: "https://www.uniprot.org/uniprotkb/P04637/entry",
					name: "TP53",
					description: "Cellular tumor antigen p53",
					interactorType: "protein",
					organismName: "Homo sapiens; 9606",
				}],
			}],
		});
	};

	const tool = registerTools().get("feynman_science_database_search");
	const result = await tool?.execute("call-complexportal", { source: "complexportal", query: "participant:P04637", limit: 1 });
	const details = result?.details as { mode: string; results: Array<{ complexAc: string; interactors: Array<{ accession: string }>; taxId: number; url: string }>; totalCount: number };

	assert.equal(details.mode, "participant-search");
	assert.equal(details.totalCount, 11);
	assert.equal(details.results[0]?.complexAc, "CPX-6093");
	assert.equal(details.results[0]?.taxId, 9606);
	assert.equal(details.results[0]?.interactors[0]?.accession, "P04637");
	assert.equal(details.results[0]?.url, "https://www.ebi.ac.uk/complexportal/complex/CPX-6093");
});

test("science database tool searches IntAct interaction rows", async () => {
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		assert.equal(url.toString(), "https://www.ebi.ac.uk/intact/ws/interaction/findInteractions/P04637?page=0&pageSize=1");
		return jsonResponse({
			totalElements: 2483,
			content: [{
				ac: "EBI-1562402",
				binaryInteractionId: 2807819,
				idA: "Q9UER7 (uniprotkb)",
				idB: "P04637 (uniprotkb)",
				moleculeA: "DAXX",
				moleculeB: "TP53",
				speciesA: "Homo sapiens",
				speciesB: "Homo sapiens",
				taxIdA: 9606,
				taxIdB: 9606,
				type: "physical association",
				detectionMethod: "anti tag coimmunoprecipitation",
				intactMiscore: 0.56,
				negative: false,
				publicationPubmedIdentifier: "15364928",
				firstAuthor: "Gostissa et al.",
				sourceDatabase: "intact",
			}],
		});
	};

	const tool = registerTools().get("feynman_science_database_search");
	const result = await tool?.execute("call-intact", { source: "intact", query: "P04637", limit: 1 });
	const details = result?.details as { results: Array<{ interactionAc: string; miScore: number; participantB: string; pubmedId: string }>; totalCount: number };

	assert.equal(details.totalCount, 2483);
	assert.equal(details.results[0]?.interactionAc, "EBI-1562402");
	assert.equal(details.results[0]?.participantB, "P04637");
	assert.equal(details.results[0]?.miScore, 0.56);
	assert.equal(details.results[0]?.pubmedId, "15364928");
	assert.match(tool?.promptGuidelines?.join("\n") ?? "", /IntAct interaction accessions/);
});

test("science database tool searches EMDB CSV metadata rows", async () => {
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		assert.equal(url.pathname, "/emdb/api/search/apoferritin");
		assert.equal(url.searchParams.get("rows"), "2");
		assert.equal(url.searchParams.get("fl"), "emdb_id,title,resolution,structure_determination_method,fitted_pdbs,current_status,release_date");
		return textResponse([
			"emdb_id,title,resolution,structure_determination_method,fitted_pdbs,current_status,release_date",
			"EMD-77042,\"Apoferritin with crossed laser phase plate xLPP, xLPP-on\",1.79,singleParticle,,REL,2026-06-24T00:00:00Z",
			"EMD-77047,\"Apoferritin with crossed laser phase plate xLPP-off\",1.93,singleParticle,9abc;8xyz,REL,2026-06-24T00:00:00Z",
		].join("\n"));
	};

	const tool = registerTools().get("feynman_science_database_search");
	const result = await tool?.execute("call-emdb", { source: "emdb", query: "apoferritin", limit: 2 });
	const details = result?.details as { results: Array<{ emdbId: string; fittedPdbIds: string[]; releaseDate: string; resolutionAngstrom: number; url: string }>; returned: number };

	assert.equal(details.returned, 2);
	assert.equal(details.results[0]?.emdbId, "EMD-77042");
	assert.equal(details.results[0]?.resolutionAngstrom, 1.79);
	assert.equal(details.results[0]?.releaseDate, "2026-06-24");
	assert.deepEqual(details.results[1]?.fittedPdbIds, ["9abc", "8xyz"]);
	assert.equal(details.results[0]?.url, "https://www.ebi.ac.uk/emdb/EMD-77042");
});
