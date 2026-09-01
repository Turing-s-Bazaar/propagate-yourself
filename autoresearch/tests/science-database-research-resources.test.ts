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

test("science database tool searches Antibody Registry RRIDs, catalog numbers, vendors, stats, and exact command names", async () => {
	const requests: Array<{ body?: unknown; method: string; url: string }> = [];
	globalThis.fetch = async (input, init) => {
		const url = String(input);
		requests.push({ body: init?.body ? JSON.parse(String(init.body)) : undefined, method: init?.method ?? "GET", url });
		if (url.includes("/fts-antibodies")) {
			const parsed = new URL(url);
			assert.equal(parsed.searchParams.get("page"), "1");
			const query = parsed.searchParams.get("q");
			if (query === "TP53") {
				assert.equal(parsed.searchParams.get("size"), "2");
				return jsonResponse({
					totalElements: 5,
					items: [{
						abId: 3717446,
						abName: "Anti-TP53 antibody CPTC-TP53-2",
						abTarget: "TP53",
						catalogNum: "CPTC-TP53-2",
						catAlt: "DSHB CPTC-TP53-2",
						vendorName: "DSHB",
						vendorId: 100,
						cloneId: "CPTC-TP53-2",
						clonality: "monoclonal",
						sourceOrganism: "Mus musculus",
						targetSpecies: ["Homo sapiens"],
						applications: ["Western blot"],
						status: "CURATED",
						numOfCitation: 3,
					}],
				});
			}
			if (query === "9205") {
				assert.equal(parsed.searchParams.get("size"), "100");
				return jsonResponse({
					totalElements: 3,
					items: [{
						abId: 330944,
						abName: "Phospho-p44/42 MAPK antibody",
						abTarget: "MAPK1/MAPK3",
						catalogNum: "9205 (also 9205L, 9205S)",
						catAlt: "9205P",
						vendorName: "Cell Signaling Technology",
						targetSpecies: ["Homo sapiens", "Mus musculus", "Rattus norvegicus"],
						applications: ["Western blot", "Immunofluorescence"],
						numOfCitation: 171,
						status: "CURATED",
					}, {
						abId: 999,
						catalogNum: "9205",
						vendorName: "Other Vendor",
					}],
				});
			}
			throw new Error(`unexpected Antibody Registry FTS query ${query}`);
		}
		if (url === "https://www.antibodyregistry.org/api/antibodies/330944") {
			return jsonResponse([{
				abId: 330944,
				accession: 330944,
				abName: "Phospho-p44/42 MAPK antibody",
				abTarget: "MAPK1/MAPK3",
				catalogNum: "9205 (also 9205L, 9205S)",
				vendorName: "Cell Signaling Technology",
				vendorUrl: ["https://www.cellsignal.com/products/primary-antibodies/9205"],
				targetSpecies: ["Homo sapiens", "Mus musculus", "Rattus norvegicus"],
				applications: ["Western blot", "Immunofluorescence"],
				productIsotype: "IgG",
				numOfCitation: 171,
				status: "CURATED",
			}]);
		}
		if (url === "https://www.antibodyregistry.org/api/vendors") {
			return jsonResponse([
				{ id: 1, name: "21st Century Biochemicals", url: "https://21stcenturybio.com" },
				{ id: 2, name: "Cell Signaling Technology", url: "https://www.cellsignal.com" },
				{ id: 3, name: "Cell Sciences", url: "https://www.cellsciences.com" },
			]);
		}
		if (url === "https://www.antibodyregistry.org/api/datainfo") {
			return jsonResponse({ total: 3186152, lastupdate: "2026-07-03" });
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tool = registerTools().get("feynman_science_database_search");
	const search = await tool?.execute("call-antibody-search", { source: "antibodyregistry", query: "TP53", limit: 2 });
	const detail = await tool?.execute("call-antibody-detail", { source: "antibodyregistry", query: "RRID:AB_330944", limit: 1 });
	const catalog = await tool?.execute("call-antibody-catalog", { source: "antibodyregistry", query: "catalog:9205 vendor=Cell Signaling Technology", limit: 1 });
	const vendors = await tool?.execute("call-antibody-vendors", { source: "antibodyregistry", query: "vendors:Cell", limit: 2 });
	const stats = await tool?.execute("call-antibody-stats", { source: "antibodyregistry", query: "stats", limit: 1 });
	const exactSearch = await tool?.execute("call-exact-antibody-search", { source: "antibodyregistry", query: "search_antibodies:TP53 max_records=2", limit: 2 });
	const exactDetail = await tool?.execute("call-exact-antibody-detail", { source: "antibodyregistry", query: "get_antibody:RRID:AB_330944", limit: 1 });
	const exactCatalog = await tool?.execute("call-exact-antibody-catalog", { source: "antibodyregistry", query: "find_antibodies_by_catalog:9205 vendor=\"Cell Signaling Technology\"", limit: 1 });
	const exactStats = await tool?.execute("call-exact-antibody-stats", { source: "antibodyregistry", query: "get_antibody_registry_stats", limit: 1 });
	const searchDetails = search?.details as { results: Array<{ rrid: string; rridCurie: string; target: string; vendorName: string }>; totalCount: number };
	const detailDetails = detail?.details as { abId: number; results: Array<{ catalogNumber: string; citationCount: number; rridCurie: string; url: string }> };
	const catalogDetails = catalog?.details as { results: Array<{ abId: number; catalogNumber: string; vendorName: string }>; searchTotalElements: number; totalCount: number };
	const vendorDetails = vendors?.details as { registryVendorCount: number; results: Array<{ id: number; name: string }>; totalCount: number };
	const statsDetails = stats?.details as { lastUpdate: string; totalAntibodies: number };
	const exactSearchDetails = exactSearch?.details as { mode: string; records: Array<{ rridCurie: string; target: string }>; total_count: number };
	const exactDetailDetails = exactDetail?.details as { ab_id: number; record_count: number; records: Array<{ citationCount: number; rridCurie: string }> };
	const exactCatalogDetails = exactCatalog?.details as { catalog_number: string; records: Array<{ abId: number; vendorName: string }>; search_total_elements: number };
	const exactStatsDetails = exactStats?.details as { last_update: string; total_antibodies: number };

	assert.equal(searchDetails.totalCount, 5);
	assert.equal(searchDetails.results[0]?.rrid, "AB_3717446");
	assert.equal(searchDetails.results[0]?.rridCurie, "RRID:AB_3717446");
	assert.equal(searchDetails.results[0]?.target, "TP53");
	assert.equal(searchDetails.results[0]?.vendorName, "DSHB");
	assert.equal(detailDetails.abId, 330944);
	assert.equal(detailDetails.results[0]?.rridCurie, "RRID:AB_330944");
	assert.equal(detailDetails.results[0]?.citationCount, 171);
	assert.equal(detailDetails.results[0]?.url, "https://www.antibodyregistry.org/AB_330944");
	assert.equal(catalogDetails.searchTotalElements, 3);
	assert.equal(catalogDetails.totalCount, 1);
	assert.equal(catalogDetails.results[0]?.abId, 330944);
	assert.equal(catalogDetails.results[0]?.catalogNumber, "9205 (also 9205L, 9205S)");
	assert.equal(catalogDetails.results[0]?.vendorName, "Cell Signaling Technology");
	assert.equal(vendorDetails.registryVendorCount, 3);
	assert.equal(vendorDetails.totalCount, 2);
	assert.deepEqual(vendorDetails.results.map((vendor) => vendor.name), ["Cell Sciences", "Cell Signaling Technology"]);
	assert.equal(statsDetails.totalAntibodies, 3186152);
	assert.equal(statsDetails.lastUpdate, "2026-07-03");
	assert.equal(exactSearchDetails.mode, "search_antibodies");
	assert.equal(exactSearchDetails.total_count, 5);
	assert.equal(exactSearchDetails.records[0]?.rridCurie, "RRID:AB_3717446");
	assert.equal(exactSearchDetails.records[0]?.target, "TP53");
	assert.equal(exactDetailDetails.ab_id, 330944);
	assert.equal(exactDetailDetails.record_count, 1);
	assert.equal(exactDetailDetails.records[0]?.citationCount, 171);
	assert.equal(exactCatalogDetails.catalog_number, "9205");
	assert.equal(exactCatalogDetails.search_total_elements, 3);
	assert.equal(exactCatalogDetails.records[0]?.abId, 330944);
	assert.equal(exactCatalogDetails.records[0]?.vendorName, "Cell Signaling Technology");
	assert.equal(exactStatsDetails.total_antibodies, 3186152);
	assert.equal(exactStatsDetails.last_update, "2026-07-03");
	assert.deepEqual(requests, [
		{ body: undefined, method: "GET", url: "https://www.antibodyregistry.org/api/fts-antibodies?q=TP53&page=1&size=2" },
		{ body: undefined, method: "GET", url: "https://www.antibodyregistry.org/api/antibodies/330944" },
		{ body: undefined, method: "GET", url: "https://www.antibodyregistry.org/api/fts-antibodies?q=9205&page=1&size=100" },
		{ body: undefined, method: "GET", url: "https://www.antibodyregistry.org/api/vendors" },
		{ body: undefined, method: "GET", url: "https://www.antibodyregistry.org/api/datainfo" },
		{ body: undefined, method: "GET", url: "https://www.antibodyregistry.org/api/fts-antibodies?q=TP53&page=1&size=2" },
		{ body: undefined, method: "GET", url: "https://www.antibodyregistry.org/api/antibodies/330944" },
		{ body: undefined, method: "GET", url: "https://www.antibodyregistry.org/api/fts-antibodies?q=9205&page=1&size=100" },
		{ body: undefined, method: "GET", url: "https://www.antibodyregistry.org/api/datainfo" },
	]);
	assert.match(tool?.promptSnippet ?? "", /Antibody Registry/);
	assert.match(tool?.promptSnippet ?? "", /Grants\.gov/);
	assert.match(tool?.promptGuidelines?.join("\n") ?? "", /Antibody Registry AB\/RRID accessions/);
	assert.match(tool?.promptGuidelines?.join("\n") ?? "", /search_grants/);
});

test("science database tool searches Grants.gov Search2 with exact reference command shape", async () => {
	const requests: Array<{ body?: unknown; method: string; url: string }> = [];
	globalThis.fetch = async (input, init) => {
		const url = String(input);
		requests.push({ body: init?.body ? JSON.parse(String(init.body)) : undefined, method: init?.method ?? "GET", url });
		assert.equal(url, "https://api.grants.gov/v1/api/search2");
		return jsonResponse({
			errorcode: 0,
			msg: "Webservice Succeeds",
			data: {
				searchParams: {
					agencies: "HHS-NIH11",
					keyword: "cancer",
					oppStatuses: "posted",
					rows: 2,
					startRecordNum: 0,
				},
				hitCount: 12,
				oppHits: [{
					id: "349999",
					number: "PAR-26-001",
					title: "Cancer Biology Funding Opportunity",
					agencyCode: "HHS-NIH11",
					agencyName: "National Institutes of Health",
					openDate: "07/01/2026",
					closeDate: "10/01/2026",
					oppStatus: "posted",
					docType: "synopsis",
					alnist: ["93.393"],
				}],
				oppStatusOptions: [{ label: "posted", value: "posted", count: 12 }],
				dateRangeOptions: [],
				eligibilities: [{ label: "Public and State controlled institutions of higher education", value: "06", count: 6 }],
				fundingCategories: [{ label: "Health", value: "HL", count: 12 }],
				fundingInstruments: [{ label: "Grant", value: "G", count: 12 }],
				agencies: [{ label: "National Institutes of Health", value: "HHS-NIH11", count: 12 }],
			},
		});
	};

	const tool = registerTools().get("feynman_science_database_search");
	const result = await tool?.execute("call-search-grants", {
		source: "grantsgov",
		query: "search_grants:keyword=cancer agencies=HHS-NIH11 opportunity_statuses=posted max_records=2",
		limit: 2,
	});
	const details = result?.details as {
		facets: { agencies: Array<{ count: number; value: string }> };
		hit_count: number;
		n_returned: number;
		records: Array<{ agency_code: string; aln_list: string[]; number: string; status: string; url: string }>;
	};

	assert.equal(details.hit_count, 12);
	assert.equal(details.n_returned, 1);
	assert.equal(details.records[0]?.number, "PAR-26-001");
	assert.equal(details.records[0]?.agency_code, "HHS-NIH11");
	assert.equal(details.records[0]?.status, "posted");
	assert.deepEqual(details.records[0]?.aln_list, ["93.393"]);
	assert.equal(details.records[0]?.url, "https://www.grants.gov/search-results-detail/PAR-26-001");
	assert.equal(details.facets.agencies[0]?.value, "HHS-NIH11");
	assert.equal(details.facets.agencies[0]?.count, 12);
	assert.deepEqual(requests, [{
		body: {
			agencies: "HHS-NIH11",
			keyword: "cancer",
			oppStatuses: "posted",
			rows: 2,
			sortBy: "oppNum|asc",
			startRecordNum: 0,
		},
		method: "POST",
		url: "https://api.grants.gov/v1/api/search2",
	}]);
});
