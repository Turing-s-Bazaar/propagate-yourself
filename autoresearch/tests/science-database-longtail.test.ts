import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, test } from "node:test";
import { gzipSync } from "node:zlib";

import { registerScienceDatabaseTools } from "../extensions/research-tools/science-databases.js";

type Tool = {
	execute: (toolCallId: string, params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; details: unknown }>;
	name: string;
	promptGuidelines?: string[];
	promptSnippet?: string;
};

const originalFetch = globalThis.fetch;
const originalPanglaoChecksum = process.env.FEYNMAN_PANGLAODB_MARKERS_SHA256;
const originalPanglaoPath = process.env.FEYNMAN_PANGLAODB_MARKERS_PATH;

afterEach(() => {
	globalThis.fetch = originalFetch;
	if (originalPanglaoChecksum === undefined) delete process.env.FEYNMAN_PANGLAODB_MARKERS_SHA256;
	else process.env.FEYNMAN_PANGLAODB_MARKERS_SHA256 = originalPanglaoChecksum;
	if (originalPanglaoPath === undefined) delete process.env.FEYNMAN_PANGLAODB_MARKERS_PATH;
	else process.env.FEYNMAN_PANGLAODB_MARKERS_PATH = originalPanglaoPath;
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

test("science database tool searches AlphaFold DB predicted structure records", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = String(input);
		requests.push(url);
		assert.equal(url, "https://alphafold.ebi.ac.uk/api/prediction/P05067");
		return jsonResponse([{
			entryId: "AF-P05067-F1",
			modelEntityId: "AF-P05067-F1",
			uniprotAccession: "P05067",
			uniprotId: "A4_HUMAN",
			gene: "APP",
			uniprotDescription: "Amyloid-beta precursor protein",
			organismScientificName: "Homo sapiens",
			taxId: 9606,
			isReviewed: true,
			isReferenceProteome: true,
			sequenceStart: 1,
			sequenceEnd: 770,
			sequence: "MAAA",
			globalMetricValue: 67.38,
			fractionPlddtVeryLow: 0.357,
			fractionPlddtLow: 0.088,
			fractionPlddtConfident: 0.266,
			fractionPlddtVeryHigh: 0.288,
			latestVersion: 6,
			pdbUrl: "https://alphafold.ebi.ac.uk/files/AF-P05067-F1-model_v6.pdb",
			cifUrl: "https://alphafold.ebi.ac.uk/files/AF-P05067-F1-model_v6.cif",
			paeDocUrl: "https://alphafold.ebi.ac.uk/files/AF-P05067-F1-predicted_aligned_error_v6.json",
		}]);
	};

	const tool = registerTools().get("feynman_science_database_search");
	const result = await tool?.execute("call-alphafold", { source: "alphafold", query: "uniprot:P05067", limit: 1 });
	const details = result?.details as {
		provenance: { endpoints: string[] };
		results: Array<{ entryId: string; globalPlddt: number; plddtFractions: { veryHigh: number }; pdbUrl: string; url: string }>;
		source: string;
	};

	assert.equal(details.source, "alphafold");
	assert.equal(details.results[0]?.entryId, "AF-P05067-F1");
	assert.equal(details.results[0]?.globalPlddt, 67.38);
	assert.equal(details.results[0]?.plddtFractions.veryHigh, 0.288);
	assert.equal(details.results[0]?.pdbUrl, "https://alphafold.ebi.ac.uk/files/AF-P05067-F1-model_v6.pdb");
	assert.equal(details.results[0]?.url, "https://alphafold.ebi.ac.uk/entry/P05067");
	assert.deepEqual(details.provenance.endpoints, requests);
	assert.match(tool?.promptSnippet ?? "", /AlphaFold DB/);
});

test("science database tool searches ArrayExpress BioStudies and MGnify studies", async () => {
	globalThis.fetch = async (input) => {
		const url = String(input);
		if (url.includes("biostudies/api/v1/search")) {
			const parsed = new URL(url);
			assert.equal(parsed.searchParams.get("query"), "breast cancer AND collection:ArrayExpress");
			assert.equal(parsed.searchParams.get("pageSize"), "1");
			return jsonResponse({
				totalHits: 2051,
				hits: [{
					accession: "E-GEOD-17155",
					type: "study",
					title: "MicroRNA expression profiling of male breast cancer",
					author: "Example Author",
					files: 78,
					links: 3,
					release_date: "2010-05-16",
					views: 353,
					isPublic: true,
					content: "functional genomics study",
				}],
			});
		}
		if (url.includes("metagenomics/api/v2/studies")) {
			const parsed = new URL(url);
			assert.equal(parsed.searchParams.get("search"), "human gut");
			assert.equal(parsed.searchParams.get("page_size"), "1");
			return jsonResponse({
				count: 102,
				items: [{
					accession: "MGYS00006825",
					ena_accessions: ["ERP160132", "PRJEB75554"],
					title: "Human gut metagenome assembly",
					biome: { biome_name: "Large intestine", lineage: "root:Host-associated:Human:Digestive system:Large intestine" },
					updated_at: "2026-06-11T22:16:50.929Z",
					metadata: {
						study_accession: "PRJEB75554",
						secondary_study_accession: "ERP160132",
						center_name: "EMG",
						study_description: "TPA assembly from a human gut dataset.",
					},
				}],
			});
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tool = registerTools().get("feynman_science_database_search");
	const arrayexpress = await tool?.execute("call-arrayexpress", { source: "arrayexpress", query: "breast cancer", limit: 1 });
	const mgnify = await tool?.execute("call-mgnify", { source: "mgnify", query: "human gut", limit: 1 });
	const arrayDetails = arrayexpress?.details as { results: Array<{ accession: string; fileCount: number; url: string }>; totalCount: number };
	const mgnifyDetails = mgnify?.details as { results: Array<{ accession: string; biomeName: string; enaAccessions: string[]; studyAccession: string; url: string }>; totalCount: number };

	assert.equal(arrayDetails.totalCount, 2051);
	assert.equal(arrayDetails.results[0]?.accession, "E-GEOD-17155");
	assert.equal(arrayDetails.results[0]?.fileCount, 78);
	assert.equal(arrayDetails.results[0]?.url, "https://www.ebi.ac.uk/biostudies/arrayexpress/studies/E-GEOD-17155");
	assert.equal(mgnifyDetails.totalCount, 102);
	assert.equal(mgnifyDetails.results[0]?.accession, "MGYS00006825");
	assert.equal(mgnifyDetails.results[0]?.biomeName, "Large intestine");
	assert.deepEqual(mgnifyDetails.results[0]?.enaAccessions, ["ERP160132", "PRJEB75554"]);
	assert.equal(mgnifyDetails.results[0]?.studyAccession, "PRJEB75554");
	assert.equal(mgnifyDetails.results[0]?.url, "https://www.ebi.ac.uk/metagenomics/studies/MGYS00006825");
});

test("science database tool retrieves MetaboLights studies, metadata, and files", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = String(input);
		requests.push(url);
		if (url === "https://www.ebi.ac.uk/metabolights/ws/studies") {
			return jsonResponse({
				content: ["MTBLS2", "MTBLS1", "MTBLS10"],
				studies: 3,
			});
		}
		if (url === "https://www.ebi.ac.uk/metabolights/ws/studies/public/study/MTBLS1") {
			return jsonResponse({
				content: {
					studyIdentifier: "MTBLS1",
					title: "A metabolomic study of urinary changes in type 2 diabetes in human compared to the control group",
					studyDescription: "NMR metabolomics for type 2 diabetes urine samples.",
					studyStatus: "Public",
					studySize: "100",
					studyHumanReadable: "1.2 GB",
					organism: [{ organismName: "Homo sapiens", organismPart: "urine" }],
					factors: [{ name: "disease" }],
					descriptors: [{ description: "case-control design" }],
					assays: [{
						assayNumber: 1,
						measurement: "metabolite profiling",
						technology: "NMR spectroscopy",
						platform: "NMR",
						fileName: "a_MTBLS1_NMR_metabolite_profiling_NMR_spectroscopy.txt",
					}],
					sampleTable: { data: [{ sample: "S1" }, { sample: "S2" }] },
					derivedData: { releaseYear: "2012", submissionYear: "2012" },
				},
			});
		}
		if (url === "https://www.ebi.ac.uk/metabolights/ws/studies/MTBLS1/files?include_raw_data=true") {
			return jsonResponse({
				study: [
					{ file: "FILES", type: "folder", directory: true },
					{ file: "i_Investigation.txt", type: "metadata", status: "active", directory: false },
					{ file: "m_MTBLS1_metabolite_profiling_NMR_spectroscopy_v2_maf.tsv", type: "metadata", status: "active", directory: false },
				],
			});
		}
		if (url === "https://www.ebi.ac.uk/metabolights/ws/studies/MTBLS1/public-data-files?file_match=true&folder_match=false&search_pattern=*.mzML") {
			return jsonResponse({
				files: ["FILES/example-a.mzML", { name: "FILES/example-b.mzML" }],
			});
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tool = registerTools().get("feynman_science_database_search");
	const studies = await tool?.execute("call-metabolights-studies", { source: "metabolights", query: "studies", limit: 2 });
	const study = await tool?.execute("call-metabolights-study", { source: "metabolights", query: "MTBLS1", limit: 1 });
	const files = await tool?.execute("call-metabolights-files", { source: "metabolights", query: "files:MTBLS1", limit: 2 });
	const dataFiles = await tool?.execute("call-metabolights-data-files", { source: "metabolights", query: "data-files:MTBLS1 pattern=*.mzML", limit: 2 });
	const studyListDetails = studies?.details as { mode: string; results: Array<{ accession: string; url: string }>; totalCount: number };
	const studyDetails = study?.details as { mode: string; results: Array<{ accession: string; assayCount: number; organisms: Array<{ organism: string }>; releaseYear: number; sampleCount: number; technologies: string[]; title: string; url: string }> };
	const fileDetails = files?.details as { mode: string; results: Array<{ directory: boolean; file: string; type?: string }>; totalCount: number };
	const dataFileDetails = dataFiles?.details as { mode: string; results: Array<{ file: string }>; totalCount: number };

	assert.equal(studyListDetails.mode, "studies");
	assert.equal(studyListDetails.totalCount, 3);
	assert.deepEqual(studyListDetails.results.map((record) => record.accession), ["MTBLS1", "MTBLS2"]);
	assert.equal(studyListDetails.results[0]?.url, "https://www.ebi.ac.uk/metabolights/MTBLS1");
	assert.equal(studyDetails.mode, "study");
	assert.equal(studyDetails.results[0]?.accession, "MTBLS1");
	assert.equal(studyDetails.results[0]?.title, "A metabolomic study of urinary changes in type 2 diabetes in human compared to the control group");
	assert.equal(studyDetails.results[0]?.organisms[0]?.organism, "Homo sapiens");
	assert.equal(studyDetails.results[0]?.assayCount, 1);
	assert.deepEqual(studyDetails.results[0]?.technologies, ["NMR spectroscopy"]);
	assert.equal(studyDetails.results[0]?.sampleCount, 2);
	assert.equal(studyDetails.results[0]?.releaseYear, 2012);
	assert.equal(fileDetails.mode, "files");
	assert.equal(fileDetails.totalCount, 3);
	assert.equal(fileDetails.results[0]?.file, "FILES");
	assert.equal(fileDetails.results[0]?.directory, true);
	assert.equal(dataFileDetails.mode, "data-files");
	assert.deepEqual(dataFileDetails.results.map((record) => record.file), ["FILES/example-a.mzML", "FILES/example-b.mzML"]);
	assert.deepEqual(requests, [
		"https://www.ebi.ac.uk/metabolights/ws/studies",
		"https://www.ebi.ac.uk/metabolights/ws/studies/public/study/MTBLS1",
		"https://www.ebi.ac.uk/metabolights/ws/studies/MTBLS1/files?include_raw_data=true",
		"https://www.ebi.ac.uk/metabolights/ws/studies/MTBLS1/public-data-files?file_match=true&folder_match=false&search_pattern=*.mzML",
	]);
	assert.match(tool?.promptGuidelines?.join("\n") ?? "", /MetaboLights MTBLS accessions/);
});

test("science database tool searches CellGuide cell types, markers, source collections, and tissues", async () => {
	globalThis.fetch = async (input) => {
		const url = String(input);
		if (url === "https://cellguide.cellxgene.cziscience.com/latest_snapshot_identifier") {
			return new Response("snap-1", { status: 200, headers: { "content-type": "text/plain" } });
		}
		if (url === "https://cellguide.cellxgene.cziscience.com/snap-1/celltype_metadata.json") {
			return jsonResponse({
				"CL:0000084": {
					id: "CL:0000084",
					name: "T cell",
					clDescription: "A type of lymphocyte whose defining characteristic is the expression of a T cell receptor complex.",
					synonyms: ["T lymphocyte", "T-cell"],
				},
				"CL:0000236": {
					id: "CL:0000236",
					name: "B cell",
					clDescription: "A lymphocyte of B lineage.",
					synonyms: ["B lymphocyte"],
				},
			});
		}
		if (url === "https://cellguide.cellxgene.cziscience.com/validated_descriptions/CL_0000084.json") {
			return jsonResponse({
				description: "T cells are adaptive immune lymphocytes.",
				references: [{ title: "Cell Ontology", url: "https://example.org/cell-ontology" }],
			});
		}
		if (url === "https://cellguide.cellxgene.cziscience.com/snap-1/computational_marker_genes/CL_0000084.json") {
			return jsonResponse([
				{ symbol: "LCK", name: "LCK proto-oncogene", marker_score: 1.1, specificity: 0.9, me: 2.5, pc: 0.7, groupby_dims: { organism_ontology_term_label: "Homo sapiens", tissue_ontology_term_label: "blood" } },
				{ symbol: "CD3D", name: "CD3 delta", marker_score: 1.4, specificity: 1, me: 3, pc: 0.8, groupby_dims: { organism_ontology_term_label: "Homo sapiens", tissue_ontology_term_label: "blood" } },
			]);
		}
		if (url === "https://cellguide.cellxgene.cziscience.com/snap-1/canonical_marker_genes/CL_0000084.json") {
			return jsonResponse([
				{ tissue: "blood", symbol: "CD3D", name: "CD3 delta", publication: "10.1000/cd3d", publication_titles: "Marker paper" },
				{ tissue: "blood", symbol: "CD3E", name: "CD3 epsilon", publication: "", publication_titles: "" },
			]);
		}
		if (url === "https://cellguide.cellxgene.cziscience.com/snap-1/source_collections/CL_0000084.json") {
			return jsonResponse([{
				collection_name: "Immune atlas",
				collection_url: "https://cellxgene.cziscience.com/collections/example",
				publication_title: "Immune Atlas Study",
				publication_url: "10.1016/example",
				tissue: [{ label: "blood" }],
				disease: [{ label: "normal" }],
				organism: [{ label: "Homo sapiens" }],
			}]);
		}
		if (url === "https://cellguide.cellxgene.cziscience.com/snap-1/ontology_tree/NCBITaxon_9606/celltype_to_tissue_mapping.json") {
			return jsonResponse({ "CL:0000084": ["UBERON:0000178"] });
		}
		if (url === "https://cellguide.cellxgene.cziscience.com/snap-1/tissue_metadata.json") {
			return jsonResponse({
				"UBERON:0000178": { name: "blood", uberonDescription: "A fluid connective tissue." },
			});
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tool = registerTools().get("feynman_science_database_search");
	const search = await tool?.execute("call-cellguide-search", { source: "cellguide", query: "search:T cell", limit: 1 });
	const info = await tool?.execute("call-cellguide-info", { source: "cellguide", query: "T cell", limit: 2 });
	const markers = await tool?.execute("call-cellguide-markers", { source: "cellguide", query: "canonical:T cell", limit: 2 });
	const sources = await tool?.execute("call-cellguide-sources", { source: "cellguide", query: "sources:T cell", limit: 1 });
	const tissues = await tool?.execute("call-cellguide-tissues", { source: "cellguide", query: "tissues:T cell", limit: 1 });
	const searchDetails = search?.details as { results: Array<{ id: string; name: string; synonyms: string[] }>; snapshot: string };
	const infoDetails = info?.details as { results: Array<{ id: string; topMarkerGenes: Array<{ symbol: string }>; validatedDescription: string }> };
	const markerDetails = markers?.details as { markerType: string; results: Array<{ publication: string; symbol: string; tissueContext: string }> };
	const sourceDetails = sources?.details as { results: Array<{ collectionName: string; publicationUrl: string; tissues: string[] }> };
	const tissueDetails = tissues?.details as { results: Array<{ id: string; name: string }> };

	assert.equal(searchDetails.snapshot, "snap-1");
	assert.equal(searchDetails.results[0]?.id, "CL:0000084");
	assert.equal(searchDetails.results[0]?.name, "T cell");
	assert.deepEqual(searchDetails.results[0]?.synonyms, ["T lymphocyte", "T-cell"]);
	assert.equal(infoDetails.results[0]?.id, "CL:0000084");
	assert.equal(infoDetails.results[0]?.validatedDescription, "T cells are adaptive immune lymphocytes.");
	assert.deepEqual(infoDetails.results[0]?.topMarkerGenes.map((gene) => gene.symbol), ["CD3D", "LCK"]);
	assert.equal(markerDetails.markerType, "canonical");
	assert.equal(markerDetails.results[0]?.symbol, "CD3D");
	assert.equal(markerDetails.results[0]?.publication, "10.1000/cd3d");
	assert.equal(markerDetails.results[0]?.tissueContext, "blood");
	assert.equal(sourceDetails.results[0]?.collectionName, "Immune atlas");
	assert.equal(sourceDetails.results[0]?.publicationUrl, "https://doi.org/10.1016/example");
	assert.deepEqual(sourceDetails.results[0]?.tissues, ["blood"]);
	assert.deepEqual(tissueDetails.results[0], { id: "UBERON:0000178", name: "blood", description: "A fluid connective tissue." });
	assert.match(tool?.promptGuidelines?.join("\n") ?? "", /CellGuide CL IDs/);
});

test("science database tool searches PanglaoDB marker genes and options from the pinned TSV", async () => {
	const tsv = [
		"species\tofficial gene symbol\tcell type\tnicknames\tubiquitousness index\tproduct description\tgene type\tcanonical marker\tgerm layer\torgan\tsensitivity_human\tsensitivity_mouse\tspecificity_human\tspecificity_mouse",
		"Hs\tCD3D\tT cells\tT3D|CD3-DELTA\t0.01\tCD3 delta chain\tprotein-coding\t1\tmesoderm\tImmune system\t0.94\tNA\t0.10\tNA",
		"Hs Mm\tLCK\tT cells\tp56lck\t0.02\tLCK proto-oncogene\tprotein-coding\t0\tmesoderm\tImmune system\t0.82\t0.79\t0.18\t0.20",
		"Mm\tCd19\tB cells\tNA\t0.03\tCD19 antigen\tprotein-coding\t1\tmesoderm\tImmune system\tNA\t0.88\tNA\t0.12",
	].join("\n");
	const gz = gzipSync(Buffer.from(tsv));
	process.env.FEYNMAN_PANGLAODB_MARKERS_SHA256 = createHash("sha256").update(gz).digest("hex");
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = String(input);
		requests.push(url);
		assert.equal(url, "https://panglaodb.se/markers/PanglaoDB_markers_27_Mar_2020.tsv.gz");
		return new Response(gz, { status: 200, headers: { "content-type": "application/gzip" } });
	};

	const tool = registerTools().get("feynman_science_database_search");
	const markers = await tool?.execute("call-panglaodb-cell", { source: "panglaodb", query: "cell:T cells species=Hs canonical=true sensitivity_min=0.5 specificity_max=0.2", limit: 2 });
	const gene = await tool?.execute("call-panglaodb-gene", { source: "panglaodb", query: "gene:CD3D synonyms=true", limit: 2 });
	const options = await tool?.execute("call-panglaodb-options", { source: "panglaodb", query: "options", limit: 1 });
	const markerDetails = markers?.details as { mode: string; results: Array<{ canonicalMarker: boolean; cellType: string; geneSymbol: string; nicknames: string[]; sensitivityHuman: number; specificityHuman: number }>; totalCount: number };
	const geneDetails = gene?.details as { mode: string; results: Array<{ cellType: string; geneSymbol: string; matchedVia: string }> };
	const optionsDetails = options?.details as { results: Array<{ cellTypeCount: number; cellTypes: string[]; organCount: number; organs: string[]; species: string[] }>; totalRows: number };

	assert.equal(markerDetails.mode, "cell");
	assert.equal(markerDetails.totalCount, 1);
	assert.equal(markerDetails.results[0]?.geneSymbol, "CD3D");
	assert.equal(markerDetails.results[0]?.cellType, "T cells");
	assert.equal(markerDetails.results[0]?.canonicalMarker, true);
	assert.deepEqual(markerDetails.results[0]?.nicknames, ["T3D", "CD3-DELTA"]);
	assert.equal(markerDetails.results[0]?.sensitivityHuman, 0.94);
	assert.equal(markerDetails.results[0]?.specificityHuman, 0.1);
	assert.equal(geneDetails.mode, "gene");
	assert.equal(geneDetails.results[0]?.cellType, "T cells");
	assert.equal(geneDetails.results[0]?.matchedVia, "official symbol");
	assert.equal(optionsDetails.totalRows, 3);
	assert.equal(optionsDetails.results[0]?.cellTypeCount, 2);
	assert.deepEqual(optionsDetails.results[0]?.cellTypes, ["B cells", "T cells"]);
	assert.deepEqual(optionsDetails.results[0]?.organs, ["Immune system"]);
	assert.deepEqual(optionsDetails.results[0]?.species, ["Hs", "Mm"]);
	assert.deepEqual(requests, ["https://panglaodb.se/markers/PanglaoDB_markers_27_Mar_2020.tsv.gz"]);
	assert.match(tool?.promptGuidelines?.join("\n") ?? "", /PanglaoDB/);
});

test("science database tool searches JASPAR matrices and MyGene annotations", async () => {
	globalThis.fetch = async (input) => {
		const url = String(input);
		if (url.includes("jaspar.elixir.no/api/v1/matrix/")) {
			const parsed = new URL(url);
			assert.equal(parsed.searchParams.get("search"), "TP53");
			assert.equal(parsed.searchParams.get("format"), "json");
			return jsonResponse({
				count: 5,
				results: [{
					matrix_id: "MA0106.1",
					name: "TP53",
					collection: "CORE",
					base_id: "MA0106",
					version: "1",
					sequence_logo: "https://jaspar.elixir.no/static/logos/svg/MA0106.1.svg",
					url: "https://jaspar.elixir.no/api/v1/matrix/MA0106.1/",
				}],
			});
		}
		if (url.includes("mygene.info/v3/query")) {
			const parsed = new URL(url);
			assert.equal(parsed.searchParams.get("q"), "TP53");
			assert.equal(parsed.searchParams.get("species"), "human");
			return jsonResponse({
				total: 389,
				hits: [{
					_id: "7157",
					_score: 144.09,
					symbol: "TP53",
					name: "tumor protein p53",
					entrezgene: "7157",
					ensembl: { gene: "ENSG00000141510" },
					uniprot: { "Swiss-Prot": "P04637" },
					summary: "This gene encodes a tumor suppressor protein.",
					taxid: 9606,
				}],
			});
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tool = registerTools().get("feynman_science_database_search");
	const jaspar = await tool?.execute("call-jaspar", { source: "jaspar", query: "TP53", limit: 1 });
	const mygene = await tool?.execute("call-mygene", { source: "mygene", query: "TP53", limit: 1 });
	const jasparDetails = jaspar?.details as { results: Array<{ matrixId: string; sequenceLogo: string; url: string }>; totalCount: number };
	const mygeneDetails = mygene?.details as { results: Array<{ entrezGene: number; ensemblGenes: string[]; id: string; symbol: string; uniprotSwissProt: string[] }>; totalCount: number };

	assert.equal(jasparDetails.totalCount, 5);
	assert.equal(jasparDetails.results[0]?.matrixId, "MA0106.1");
	assert.equal(jasparDetails.results[0]?.sequenceLogo, "https://jaspar.elixir.no/static/logos/svg/MA0106.1.svg");
	assert.equal(jasparDetails.results[0]?.url, "https://jaspar.elixir.no/matrix/MA0106.1/");
	assert.equal(mygeneDetails.totalCount, 389);
	assert.equal(mygeneDetails.results[0]?.id, "7157");
	assert.equal(mygeneDetails.results[0]?.symbol, "TP53");
	assert.equal(mygeneDetails.results[0]?.entrezGene, 7157);
	assert.deepEqual(mygeneDetails.results[0]?.ensemblGenes, ["ENSG00000141510"]);
	assert.deepEqual(mygeneDetails.results[0]?.uniprotSwissProt, ["P04637"]);
	assert.match(tool?.promptGuidelines?.join("\n") ?? "", /JASPAR matrix IDs/);
});
