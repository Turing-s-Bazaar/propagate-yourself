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

test("science database tool searches Feynman-owned CIViC cancer curation records", async () => {
	const requests: Array<{ body?: string; method: string; url: string }> = [];
	globalThis.fetch = async (input, init) => {
		const url = String(input);
		requests.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
		if (!url.includes("civicdb.org/api/graphql")) throw new Error(`unexpected URL ${url}`);

		const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string; variables?: Record<string, unknown> };
		if (body.query?.includes("molecularProfiles")) {
			return jsonResponse({
				data: {
					molecularProfiles: {
						totalCount: 1,
						nodes: [{
							id: 12,
							name: "BRAF V600E",
							rawName: "#VID12",
							link: "/molecular-profiles/12",
							description: "Curated BRAF V600E profile.",
							molecularProfileScore: 1471.5,
							isComplex: false,
							isMultiVariant: false,
							molecularProfileAliases: ["VAL600GLU", "RS113488022"],
							variants: [{ id: 12, name: "V600E", feature: { id: 5, name: "BRAF" } }],
							evidenceCountsByStatus: { acceptedCount: 94, submittedCount: 104, rejectedCount: 9 },
						}],
					},
				},
			});
		}
		if (body.query?.includes("assertions")) {
			return jsonResponse({
				data: {
					assertions: {
						totalCount: 1,
						nodes: [{
							id: 7,
							name: "AID7",
							status: "ACCEPTED",
							assertionType: "PREDICTIVE",
							assertionDirection: "SUPPORTS",
							significance: "SENSITIVITYRESPONSE",
							ampLevel: "TIER_I_LEVEL_A",
							summary: "BRAF V600E melanoma is sensitive to dabrafenib and trametinib.",
							link: "/assertions/7",
							variantOrigin: "SOMATIC",
							regulatoryApproval: true,
							fdaCompanionTest: true,
							disease: { id: 7, name: "Melanoma", displayName: "Melanoma", doid: "1909" },
							therapies: [
								{ id: 22, name: "Dabrafenib", ncitId: "C82386" },
								{ id: 19, name: "Trametinib", ncitId: "C77908" },
							],
							molecularProfile: { id: 12, name: "BRAF V600E" },
							phenotypes: [],
							evidenceItemsCount: 4,
						}],
					},
				},
			});
		}
		if (body.query?.includes("evidenceItems")) {
			return jsonResponse({
				data: {
					evidenceItems: {
						totalCount: 2,
						nodes: [{
							id: 79,
							name: "EID79",
							status: "ACCEPTED",
							evidenceLevel: "B",
							evidenceType: "DIAGNOSTIC",
							evidenceDirection: "SUPPORTS",
							significance: "POSITIVE",
							evidenceRating: 3,
							variantOrigin: "SOMATIC",
							description: "BRAF V600E is associated with thyroid cancer.",
							link: "/evidence/79",
							disease: { id: 16, name: "Thyroid Cancer", displayName: "Thyroid Cancer", doid: "1781" },
							therapies: [],
							molecularProfile: { id: 12, name: "BRAF V600E" },
							source: { id: 93, sourceType: "PUBMED", citationId: "21594703", citation: "Howell et al., 2011" },
							phenotypes: [],
						}],
					},
				},
			});
		}
		if (body.query?.includes("genes")) {
			return jsonResponse({
				data: {
					genes: {
						totalCount: 1,
						nodes: [{
							id: 5,
							name: "BRAF",
							entrezId: 673,
							fullName: "B-Raf proto-oncogene",
							featureAliases: ["BRAF1"],
							description: "Cancer gene.",
							link: "/features/5",
						}],
					},
				},
			});
		}

		throw new Error(`unexpected CIViC query ${body.query ?? ""}`);
	};

	const tools = registerTools();
	const civic = await tools.get("feynman_science_database_search")?.execute("call-civic", {
		source: "civic",
		query: "BRAF V600E",
		limit: 1,
	});
	const civicGene = await tools.get("feynman_science_database_search")?.execute("call-civic-gene", {
		source: "civic",
		query: "gene:BRAF",
		limit: 1,
	});

	const civicDetails = civic?.details as {
		assertions?: Array<{ ampLevel?: string; therapies?: Array<{ name?: string }> }>;
		evidenceItems?: Array<{ evidenceLevel?: string; source?: { url?: string } }>;
		results: Array<{ evidenceCounts?: { accepted?: number }; id?: number; name?: string }>;
		searchMode?: string;
	};
	const civicGeneDetails = civicGene?.details as {
		results: Array<{ entrezId?: number; name?: string; url?: string }>;
		searchMode?: string;
	};

	assert.equal(civicDetails.searchMode, "molecular-profile-evidence");
	assert.equal(civicDetails.results[0]?.id, 12);
	assert.equal(civicDetails.results[0]?.name, "BRAF V600E");
	assert.equal(civicDetails.results[0]?.evidenceCounts?.accepted, 94);
	assert.equal(civicDetails.assertions?.[0]?.ampLevel, "TIER_I_LEVEL_A");
	assert.deepEqual(civicDetails.assertions?.[0]?.therapies?.map((therapy) => therapy.name), ["Dabrafenib", "Trametinib"]);
	assert.equal(civicDetails.evidenceItems?.[0]?.evidenceLevel, "B");
	assert.equal(civicDetails.evidenceItems?.[0]?.source?.url, "https://pubmed.ncbi.nlm.nih.gov/21594703/");
	assert.equal(civicGeneDetails.searchMode, "gene");
	assert.equal(civicGeneDetails.results[0]?.name, "BRAF");
	assert.equal(civicGeneDetails.results[0]?.entrezId, 673);
	assert.equal(civicGeneDetails.results[0]?.url, "https://civicdb.org/features/5");
	assert.match(requests.find((request) => request.body?.includes("molecularProfiles"))?.body ?? "", /BRAF V600E/);
	assert.match(requests.find((request) => request.body?.includes("genes"))?.body ?? "", /BRAF/);
	assert.match(tools.get("feynman_science_database_search")?.promptSnippet ?? "", /CIViC/);
});

test("science database tool accepts CIViC reference clinical-genomics query names", async () => {
	const seen: string[] = [];
	globalThis.fetch = async (input, init) => {
		const url = String(input);
		if (!url.includes("civicdb.org/api/graphql")) throw new Error(`unexpected URL ${url}`);
		const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string; variables?: Record<string, unknown> };
		const query = body.query ?? "";
		seen.push(query);
		if (query.includes("genes(")) return jsonResponse({ data: { genes: { totalCount: 1, nodes: [{ id: 5, name: "BRAF", entrezId: 673, link: "/features/5" }] } } });
		if (query.includes("variant(id")) return jsonResponse({ data: { variant: { id: 12, name: "V600E", link: "/variants/12", feature: { id: 5, name: "BRAF" } } } });
		if (query.includes("variants(")) return jsonResponse({ data: { variants: { totalCount: 1, nodes: [{ id: 12, name: "V600E", link: "/variants/12", feature: { id: 5, name: "BRAF" } }] } } });
		if (query.includes("evidenceItem")) return jsonResponse({ data: { evidenceItem: { id: 79, name: "EID79", status: "ACCEPTED", evidenceLevel: "B", source: { sourceType: "PUBMED", citationId: "21594703" }, link: "/evidence/79" } } });
		if (query.includes("evidenceItems")) return jsonResponse({ data: { evidenceItems: { totalCount: 1, nodes: [{ id: 79, name: "EID79", status: "ACCEPTED", evidenceLevel: "B", source: { sourceType: "PUBMED", citationId: "21594703" }, link: "/evidence/79" }] } } });
		if (query.includes("assertion(id")) return jsonResponse({ data: { assertion: { id: 7, name: "AID7", status: "ACCEPTED", ampLevel: "TIER_I_LEVEL_A", link: "/assertions/7" } } });
		if (query.includes("assertions")) return jsonResponse({ data: { assertions: { totalCount: 1, nodes: [{ id: 7, name: "AID7", status: "ACCEPTED", ampLevel: "TIER_I_LEVEL_A", link: "/assertions/7" }] } } });
		if (query.includes("molecularProfile(id")) return jsonResponse({ data: { molecularProfile: { id: 12, name: "BRAF V600E", rawName: "#VID12", link: "/molecular-profiles/12" } } });
		if (query.includes("molecularProfiles")) return jsonResponse({ data: { molecularProfiles: { totalCount: 1, nodes: [{ id: 12, name: "BRAF V600E", rawName: "#VID12", link: "/molecular-profiles/12" }] } } });
		if (query.includes("diseases")) return jsonResponse({ data: { diseases: { totalCount: 1, nodes: [{ id: 16, name: "Melanoma", displayName: "Melanoma", doid: "1909", link: "/diseases/16" }] } } });
		if (query.includes("therapies")) return jsonResponse({ data: { therapies: { totalCount: 1, nodes: [{ id: 22, name: "Vemurafenib", ncitId: "C64768", link: "/therapies/22" }] } } });
		throw new Error(`unexpected CIViC query ${query}`);
	};

	const tool = registerTools().get("feynman_science_database_search");
	const calls = [
		"civic_search_genes:BRAF",
		"civic_gene_variants:5",
		"civic_get_variant:12",
		"civic_search_variants:V600E gene_id=5",
		"civic_get_evidence_item:79",
		"civic_search_evidence:molecular_profile_name=BRAF V600E",
		"civic_get_assertion:7",
		"civic_search_assertions:molecular_profile_name=BRAF V600E",
		"civic_get_molecular_profile:12",
		"civic_search_molecular_profiles:BRAF V600E",
		"civic_search_diseases:Melanoma",
		"civic_search_therapies:Vemurafenib",
	];
	const modes: string[] = [];
	for (const [index, query] of calls.entries()) {
		const result = await tool?.execute(`call-civic-reference-${index}`, { source: "civic", query, limit: 2 });
		modes.push((result?.details as { searchMode?: string }).searchMode ?? "");
	}

	assert.deepEqual(modes, [
		"genes",
		"gene-variants",
		"variant",
		"variants",
		"evidence-item",
		"evidence",
		"assertion",
		"assertions",
		"molecular-profile",
		"molecular-profiles",
		"diseases",
		"therapies",
	]);
	assert.equal(seen.length, calls.length);
});
