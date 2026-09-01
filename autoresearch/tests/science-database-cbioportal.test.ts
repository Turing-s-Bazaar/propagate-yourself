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

function jsonResponse(body: unknown, headers?: Record<string, string>): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json", ...(headers ?? {}) },
	});
}

function emptyResponse(headers?: Record<string, string>): Response {
	return new Response("", {
		status: 200,
		headers: headers ?? {},
	});
}

test("science database tool searches Feynman-owned cBioPortal studies and details", async () => {
	const requests: Array<{ body?: string; method: string; path: string; url: string }> = [];
	globalThis.fetch = async (input, init) => {
		const url = new URL(String(input));
		requests.push({ url: url.toString(), path: url.pathname, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
		if (url.hostname !== "www.cbioportal.org" || !url.pathname.startsWith("/api/")) throw new Error(`unexpected URL ${url.toString()}`);
		if (url.pathname === "/api/studies" && url.searchParams.get("projection") === "META") return emptyResponse({ "total-count": "12" });
		if (url.pathname === "/api/studies") {
			assert.equal(url.searchParams.get("keyword"), "melanoma");
			assert.equal(url.searchParams.get("pageSize"), "2");
			return jsonResponse([{
				studyId: "skcm_tcga_gdc",
				cancerTypeId: "skcm",
				name: "Cutaneous Melanoma (TCGA GDC, 2025)",
				description: "TCGA <A HREF=\"https://gdc.cancer.gov\">Cutaneous Melanoma</A> cohort.",
				publicStudy: true,
				pmid: "12345",
				citation: "TCGA GDC 2025",
				groups: "PUBLIC",
				allSampleCount: 473,
				referenceGenome: "hg38",
			}]);
		}
		if (url.pathname === "/api/studies/msk_impact_2017") {
			return jsonResponse({
				studyId: "msk_impact_2017",
				cancerTypeId: "mixed",
				name: "MSK-IMPACT Clinical Sequencing Cohort (MSK, Nat Med 2017)",
				description: "Targeted sequencing of 10,000 clinical cases using the MSK-IMPACT assay.",
				publicStudy: true,
				pmid: "28481359",
				citation: "Zehir et al. Nat Med 2017",
				groups: "PUBLIC",
				allSampleCount: 10945,
				sequencedSampleCount: 10945,
				cnaSampleCount: 10945,
				structuralVariantCount: 1667,
				referenceGenome: "hg19",
				cancerType: { id: "mixed", name: "Mixed Cancer Types", shortName: "MIXED" },
			});
		}
		if (url.pathname === "/api/studies/msk_impact_2017/samples" && url.searchParams.get("projection") === "META") return emptyResponse({ "total-count": "10945" });
		if (url.pathname === "/api/studies/msk_impact_2017/patients" && url.searchParams.get("projection") === "META") return emptyResponse({ "total-count": "10000" });
		if (url.pathname === "/api/studies/msk_impact_2017/molecular-profiles") {
			return jsonResponse([{
				molecularProfileId: "msk_impact_2017_mutations",
				studyId: "msk_impact_2017",
				molecularAlterationType: "MUTATION_EXTENDED",
				datatype: "MAF",
				name: "Mutations (MSK-IMPACT)",
				description: "Targeted sequencing mutation profile.",
				showProfileInAnalysisTab: true,
				patientLevel: false,
			}]);
		}
		throw new Error(`unexpected cBioPortal request ${url.toString()}`);
	};

	const tools = registerTools();
	const search = await tools.get("feynman_science_database_search")?.execute("call-cbio-search", {
		source: "cbioportal",
		query: "melanoma",
		limit: 2,
	});
	const detail = await tools.get("feynman_science_database_search")?.execute("call-cbio-detail", {
		source: "cbioportal",
		query: "study:msk_impact_2017",
		limit: 3,
	});
	const searchDetails = search?.details as { results: Array<{ description?: string; studyId?: string; url?: string }>; searchMode?: string; totalCount?: number };
	const detailDetails = detail?.details as { results: Array<{ molecularProfiles?: Array<{ molecularProfileId?: string }>; patientCount?: number; sampleCount?: number; studyId?: string; structuralVariantCount?: number }>; searchMode?: string };

	assert.equal(searchDetails.searchMode, "study-search");
	assert.equal(searchDetails.totalCount, 12);
	assert.equal(searchDetails.results[0]?.studyId, "skcm_tcga_gdc");
	assert.equal(searchDetails.results[0]?.description, "TCGA Cutaneous Melanoma cohort.");
	assert.equal(searchDetails.results[0]?.url, "https://www.cbioportal.org/study/summary?id=skcm_tcga_gdc");
	assert.equal(detailDetails.searchMode, "study-detail");
	assert.equal(detailDetails.results[0]?.studyId, "msk_impact_2017");
	assert.equal(detailDetails.results[0]?.sampleCount, 10945);
	assert.equal(detailDetails.results[0]?.patientCount, 10000);
	assert.equal(detailDetails.results[0]?.structuralVariantCount, 1667);
	assert.equal(detailDetails.results[0]?.molecularProfiles?.[0]?.molecularProfileId, "msk_impact_2017_mutations");
	assert.equal(requests.some((request) => request.path === "/api/studies/msk_impact_2017/samples" && request.url.includes("projection=META")), true);
	assert.match(tools.get("feynman_science_database_search")?.promptSnippet ?? "", /cBioPortal/);
});

test("science database tool fetches bounded cBioPortal gene mutation rows", async () => {
	const requests: Array<{ body?: string; method: string; path: string; url: string }> = [];
	globalThis.fetch = async (input, init) => {
		const url = new URL(String(input));
		requests.push({ url: url.toString(), path: url.pathname, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
		if (url.pathname === "/api/genes/BRAF") return jsonResponse({ entrezGeneId: 673, hugoGeneSymbol: "BRAF", type: "protein-coding" });
		if (url.pathname === "/api/studies/msk_impact_2017/molecular-profiles") {
			return jsonResponse([{
				molecularProfileId: "msk_impact_2017_mutations",
				studyId: "msk_impact_2017",
				molecularAlterationType: "MUTATION_EXTENDED",
				datatype: "MAF",
				name: "Mutations (MSK-IMPACT)",
			}]);
		}
		if (url.pathname === "/api/sample-lists/fetch") {
			assert.equal(init?.method, "POST");
			assert.deepEqual(JSON.parse(String(init?.body)), ["msk_impact_2017_all"]);
			return jsonResponse([{ sampleListId: "msk_impact_2017_all", studyId: "msk_impact_2017" }]);
		}
		if (url.pathname === "/api/molecular-profiles/msk_impact_2017_mutations/mutations/fetch" && url.searchParams.get("projection") === "META") {
			return emptyResponse({ "total-count": "592", "sample-count": "564" });
		}
		if (url.pathname === "/api/molecular-profiles/msk_impact_2017_mutations/mutations/fetch") {
			assert.equal(init?.method, "POST");
			assert.equal(url.searchParams.get("pageSize"), "2");
			assert.deepEqual(JSON.parse(String(init?.body)), { sampleListId: "msk_impact_2017_all", entrezGeneIds: [673] });
			return jsonResponse([{
				uniqueSampleKey: "wire-only",
				uniquePatientKey: "wire-only",
				molecularProfileId: "msk_impact_2017_mutations",
				sampleId: "P-0000030-T01-IM3",
				patientId: "P-0000030",
				entrezGeneId: 673,
				studyId: "msk_impact_2017",
				mutationStatus: "NA",
				tumorAltCount: 330,
				tumorRefCount: 169,
				startPosition: 140494253,
				endPosition: 140494253,
				referenceAllele: "G",
				proteinChange: "T332I",
				mutationType: "Missense_Mutation",
				ncbiBuild: "GRCh37",
				variantType: "SNP",
				keyword: "BRAF T332 missense",
				chr: "7",
				variantAllele: "A",
				refseqMrnaId: "NM_004333.4",
				proteinPosStart: 332,
				proteinPosEnd: 332,
			}]);
		}
		throw new Error(`unexpected cBioPortal request ${url.toString()}`);
	};

	const tools = registerTools();
	const result = await tools.get("feynman_science_database_search")?.execute("call-cbio-mutations", {
		source: "cbioportal",
		query: "mutations:BRAF@msk_impact_2017",
		limit: 2,
	});
	const details = result?.details as {
		gene?: { entrezGeneId?: number; hugoGeneSymbol?: string };
		molecularProfile?: { molecularProfileId?: string };
		results: Array<Record<string, unknown>>;
		searchMode?: string;
		totalCount?: number;
		truncated?: boolean;
	};

	assert.equal(details.searchMode, "gene-mutations");
	assert.equal(details.gene?.hugoGeneSymbol, "BRAF");
	assert.equal(details.gene?.entrezGeneId, 673);
	assert.equal(details.molecularProfile?.molecularProfileId, "msk_impact_2017_mutations");
	assert.equal(details.totalCount, 592);
	assert.equal(details.truncated, true);
	assert.equal(details.results[0]?.sampleId, "P-0000030-T01-IM3");
	assert.equal(details.results[0]?.proteinChange, "T332I");
	assert.equal(details.results[0]?.startPosition, 140494253);
	assert.equal("uniqueSampleKey" in details.results[0]!, false);
	assert.equal("uniquePatientKey" in details.results[0]!, false);
	assert.equal(requests.filter((request) => request.path.endsWith("/mutations/fetch") && request.method === "POST").length, 2);
});

test("science database tool exposes cBioPortal reference cancer-model frequency and CNA modes", async () => {
	const requests: Array<{ body?: string; method: string; path: string; url: string }> = [];
	globalThis.fetch = async (input, init) => {
		const url = new URL(String(input));
		requests.push({ url: url.toString(), path: url.pathname, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
		if (url.hostname !== "www.cbioportal.org" || !url.pathname.startsWith("/api/")) throw new Error(`unexpected URL ${url.toString()}`);
		if (url.pathname === "/api/genes/KRAS") return jsonResponse({ entrezGeneId: 3845, hugoGeneSymbol: "KRAS", type: "protein-coding" });
		if (url.pathname === "/api/genes/EGFR") return jsonResponse({ entrezGeneId: 1956, hugoGeneSymbol: "EGFR", type: "protein-coding" });
		if (url.pathname === "/api/studies/fetch") {
			assert.deepEqual(JSON.parse(String(init?.body)), ["paad_qcmg_uq_2016", "msk_impact_2017", "unknown_study"]);
			return jsonResponse([
				{ studyId: "paad_qcmg_uq_2016", name: "Pancreatic Cancer (QCMG/UQ, Nature 2016)", sequencedSampleCount: 96 },
				{ studyId: "msk_impact_2017", name: "MSK-IMPACT Clinical Sequencing Cohort", sequencedSampleCount: 100 },
			]);
		}
		if (url.pathname === "/api/molecular-profiles/fetch") {
			assert.deepEqual(JSON.parse(String(init?.body)), { studyIds: ["msk_impact_2017", "paad_qcmg_uq_2016"] });
			return jsonResponse([
				{ studyId: "paad_qcmg_uq_2016", molecularProfileId: "paad_qcmg_uq_2016_mutations", molecularAlterationType: "MUTATION_EXTENDED" },
				{ studyId: "msk_impact_2017", molecularProfileId: "msk_impact_2017_mutations", molecularAlterationType: "MUTATION_EXTENDED" },
			]);
		}
		if (url.pathname === "/api/sample-lists/fetch") {
			const body = JSON.parse(String(init?.body));
			if (Array.isArray(body) && body.includes("paad_qcmg_uq_2016_all")) {
				return jsonResponse([
					{ sampleListId: "paad_qcmg_uq_2016_all", studyId: "paad_qcmg_uq_2016" },
					{ sampleListId: "msk_impact_2017_all", studyId: "msk_impact_2017" },
				]);
			}
			assert.deepEqual(body, ["msk_impact_2017_all"]);
			return jsonResponse([{ sampleListId: "msk_impact_2017_all", studyId: "msk_impact_2017" }]);
		}
		if (url.pathname === "/api/molecular-profiles/paad_qcmg_uq_2016_mutations/mutations/fetch") {
			return jsonResponse([
				{ sampleId: "PAAD-1", patientId: "P1", proteinChange: "G12D" },
				{ sampleId: "PAAD-2", patientId: "P2", proteinChange: "G12V" },
				{ sampleId: "PAAD-2", patientId: "P2", proteinChange: "Q61H" },
			]);
		}
		if (url.pathname === "/api/molecular-profiles/msk_impact_2017_mutations/mutations/fetch") {
			return jsonResponse([{ sampleId: "MSK-1", patientId: "M1", proteinChange: "G12D" }]);
		}
		if (url.pathname === "/api/studies/msk_impact_2017/molecular-profiles") {
			return jsonResponse([{
				molecularProfileId: "msk_impact_2017_cna",
				studyId: "msk_impact_2017",
				molecularAlterationType: "COPY_NUMBER_ALTERATION",
				datatype: "DISCRETE",
				name: "Putative copy-number alterations",
			}]);
		}
		if (url.pathname === "/api/molecular-profiles/msk_impact_2017_cna/discrete-copy-number/fetch" && url.searchParams.get("projection") === "META") {
			assert.equal(url.searchParams.get("discreteCopyNumberEventType"), "AMP");
			return emptyResponse({ "total-count": "2" });
		}
		if (url.pathname === "/api/molecular-profiles/msk_impact_2017_cna/discrete-copy-number/fetch") {
			assert.deepEqual(JSON.parse(String(init?.body)), { sampleListId: "msk_impact_2017_all", entrezGeneIds: [1956] });
			return jsonResponse([
				{ sampleId: "P-0001-T01", patientId: "P-0001", alteration: 2 },
				{ sampleId: "P-0002-T01", patientId: "P-0002", alteration: 2 },
			]);
		}
		throw new Error(`unexpected cBioPortal request ${url.toString()}`);
	};

	const tools = registerTools();
	const frequency = await tools.get("feynman_science_database_search")?.execute("call-cbio-frequency", {
		source: "cbioportal",
		query: "cbioportal_mutation_frequency:KRAS@paad_qcmg_uq_2016,msk_impact_2017,unknown_study",
	});
	const cna = await tools.get("feynman_science_database_search")?.execute("call-cbio-cna", {
		source: "cbioportal",
		query: "cbioportal_cna_in_gene:EGFR@msk_impact_2017 event=AMP",
		limit: 5,
	});
	const frequencyDetails = frequency?.details as { results: Array<{ frequency?: number; mutationCount?: number; mutatedSamples?: number; studyId?: string }>; searchMode?: string; unknownStudies?: string[] };
	const cnaDetails = cna?.details as { alterationCounts?: Record<string, number>; eventType?: string; results: Array<{ alterationLabel?: string; sampleId?: string }>; searchMode?: string; totalCount?: number };

	assert.equal(frequencyDetails.searchMode, "mutation-frequency");
	assert.equal(frequencyDetails.results[0]?.studyId, "paad_qcmg_uq_2016");
	assert.equal(frequencyDetails.results[0]?.mutationCount, 3);
	assert.equal(frequencyDetails.results[0]?.mutatedSamples, 2);
	assert.equal(frequencyDetails.results[0]?.frequency, 0.0208);
	assert.deepEqual(frequencyDetails.unknownStudies, ["unknown_study"]);
	assert.equal(cnaDetails.searchMode, "cna-in-gene");
	assert.equal(cnaDetails.eventType, "AMP");
	assert.equal(cnaDetails.totalCount, 2);
	assert.equal(cnaDetails.alterationCounts?.amplification, 2);
	assert.equal(cnaDetails.results[0]?.alterationLabel, "amplification");
	assert.equal(requests.some((request) => request.path === "/api/molecular-profiles/msk_impact_2017_cna/discrete-copy-number/fetch"), true);
});
