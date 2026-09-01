import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { registerScienceDatabaseTools } from "../extensions/research-tools/science-databases.js";

type Tool = {
	execute: (toolCallId: string, params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; details: unknown }>;
	name: string;
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

test("science database tool exposes bioRxiv and medRxiv parity modes", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = String(input);
		requests.push(url);
		if (url.includes("api.biorxiv.org/details/biorxiv/2025-03-21/2025-03-28/0/json")) {
			assert.match(url, /category=cell_biology/);
			return jsonResponse({
				messages: [{ status: "ok", total: "1", cursor: 0 }],
				collection: [{
					doi: "10.1101/2025.03.22.123456",
					title: "Cell biology category preprint",
					authors: "Hopper G",
					date: "2025-03-22",
					version: "1",
					category: "cell biology",
					abstract: "A cell biology interval result.",
					server: "biorxiv",
					funding: [{ name: "Example Funder", id: "00k4n6c32", "id-type": "ROR" }],
				}],
			});
		}
		if (url.includes("api.biorxiv.org/pubs/medrxiv/2020-03-01/2020-03-30/0/json")) {
			return jsonResponse({
				messages: [{ status: "ok", total: "1", cursor: 0 }],
				collection: [{
					biorxiv_doi: "10.1101/2020.03.01.123456",
					published_doi: "10.1001/jama.2020.123",
					published_journal: "JAMA",
					preprint_platform: "medRxiv",
					preprint_title: "Clinical preprint now published",
					preprint_authors: "Johnson K",
					preprint_category: "infectious diseases",
					preprint_date: "2020-03-02",
					published_date: "2020-04-01",
					preprint_abstract: "Publication-link metadata.",
				}],
			});
		}
		if (url.includes("api.biorxiv.org/funder/biorxiv/2025-04-10/2025-07-10/00k4n6c32/0/json")) {
			return jsonResponse({
				messages: [{ status: "ok", total: "1", cursor: 0 }],
				collection: [{
					doi: "10.1101/2025.05.01.000001",
					title: "European Commission funded biology",
					authors: "Curie M",
					date: "2025-05-01",
					version: "1",
					category: "genomics",
					abstract: "Funder metadata result.",
					server: "biorxiv",
					funder: [{ name: "European Commission", id: "00k4n6c32", "id-type": "ROR" }],
				}],
			});
		}
		if (url.includes("api.biorxiv.org/sum/y/json")) {
			return jsonResponse({
				messages: [{ status: "ok" }],
				summary: [
					{ year: "2024", new_papers: "100", new_papers_cumulative: "100" },
					{ year: "2025", new_papers: "150", new_papers_cumulative: "250" },
					{ year: "2026", new_papers: "175", new_papers_cumulative: "425" },
				],
			});
		}
		if (url.includes("api.biorxiv.org/usage/m/medrxiv/json")) {
			return jsonResponse({
				messages: [{ status: "ok" }],
				usage: [
					{ month: "2025-04", abstract_views: "10", pdf_downloads: "4" },
					{ month: "2025-05", abstract_views: "20", pdf_downloads: "8" },
					{ month: "2025-06", abstract_views: "30", pdf_downloads: "12" },
				],
			});
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tools = registerTools();
	const categories = await tools.get("feynman_science_database_search")?.execute("call-categories", {
		source: "biorxiv",
		query: "categories",
	});
	const dateWindow = await tools.get("feynman_science_database_search")?.execute("call-date-window", {
		source: "biorxiv",
		query: "cell date_from=2025-03-21 date_to=2025-03-28 category=\"cell biology\"",
		limit: 1,
	});
	const published = await tools.get("feynman_science_database_search")?.execute("call-published", {
		source: "medrxiv",
		query: "published 2020-03-01..2020-03-30",
		limit: 1,
	});
	const funder = await tools.get("feynman_science_database_search")?.execute("call-funder", {
		source: "biorxiv",
		query: "funder:00k4n6c32 2025-04-10..2025-07-10",
		limit: 1,
	});
	const contentStats = await tools.get("feynman_science_database_search")?.execute("call-content-stats", {
		source: "biorxiv",
		query: "content-stats interval=yearly through=2025",
	});
	const usageStats = await tools.get("feynman_science_database_search")?.execute("call-usage-stats", {
		source: "medrxiv",
		query: "usage-stats interval=monthly through=2025-05",
	});

	const categoriesDetails = categories?.details as { results: string[]; searchMode: string };
	const dateDetails = dateWindow?.details as { provenance: { endpoints: string[] }; results: Array<{ category?: string; funding?: unknown[] }>; searchMode: string; totalCount: number };
	const publishedDetails = published?.details as { results: Array<{ preprintDoi?: string; publishedDoi?: string }>; searchMode: string };
	const funderDetails = funder?.details as { results: Array<{ doi?: string }>; rorId: string; searchMode: string };
	const contentStatsDetails = contentStats?.details as { results: Array<{ year?: string }>; searchMode: string };
	const usageStatsDetails = usageStats?.details as { results: Array<{ month?: string }>; searchMode: string };

	assert.equal(categoriesDetails.searchMode, "categories");
	assert.equal(categoriesDetails.results.includes("cell biology"), true);
	assert.equal(dateDetails.searchMode, "recent-60-day-filter");
	assert.equal(dateDetails.totalCount, 1);
	assert.equal(dateDetails.results[0]?.category, "cell biology");
	assert.equal(dateDetails.results[0]?.funding?.length, 1);
	assert.match(dateDetails.provenance.endpoints[0] ?? "", /category=cell_biology/);
	assert.equal(publishedDetails.searchMode, "published-preprints");
	assert.equal(publishedDetails.results[0]?.preprintDoi, "10.1101/2020.03.01.123456");
	assert.equal(publishedDetails.results[0]?.publishedDoi, "10.1001/jama.2020.123");
	assert.equal(funderDetails.searchMode, "funder-ror");
	assert.equal(funderDetails.rorId, "00k4n6c32");
	assert.equal(funderDetails.results[0]?.doi, "10.1101/2025.05.01.000001");
	assert.equal(contentStatsDetails.searchMode, "content-statistics");
	assert.deepEqual(contentStatsDetails.results.map((row) => row.year), ["2024", "2025"]);
	assert.equal(usageStatsDetails.searchMode, "usage-statistics");
	assert.deepEqual(usageStatsDetails.results.map((row) => row.month), ["2025-04", "2025-05"]);
	assert.equal(requests.some((url) => url.includes("/usage/m/medrxiv/json")), true);
});
