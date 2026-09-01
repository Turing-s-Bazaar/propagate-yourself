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

function xmlResponse(body: string): Response {
	return new Response(body, {
		status: 200,
		headers: { "content-type": "application/xml" },
	});
}

function availabilityResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		resultList: {
			result: [{
				id: "29456894",
				source: "MED",
				pmid: "29456894",
				pmcid: "PMC5815332",
				doi: "10.7717/peerj.4375",
				title: "Search title",
				authorString: "A Researcher",
				journalTitle: "PeerJ",
				pubYear: "2018",
				isOpenAccess: "Y",
				inEPMC: "Y",
				inPMC: "Y",
				license: "CC BY",
				citedByCount: "10",
				abstractText: "Search abstract.",
				...overrides,
			}],
		},
	};
}

const jatsXml = [
	"<article>",
	"<front><article-meta><title-group><article-title>Fetched title</article-title></title-group><abstract><p>Structured abstract text.</p></abstract></article-meta></front>",
	"<body>",
	"<sec sec-type='intro'><title>Introduction</title><p>Intro paragraph.</p><fig id='f1'><label>Figure 1</label><caption><p>Caption text.</p></caption></fig></sec>",
	"<sec sec-type='methods'><title>Methods</title><p>Methods paragraph.</p><table-wrap id='t1'><label>Table 1</label><caption><p>Table caption.</p></caption></table-wrap></sec>",
	"</body>",
	"<back><ref-list><ref id='r1'/><ref id='r2'/></ref-list></back>",
	"</article>",
].join("");

test("Europe PMC full-text mode fetches OA JATS sections through the database tool", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = String(input);
		requests.push(url);
		if (url.endsWith("/search?query=PMCID%3APMC5815332&format=json&resultType=core&pageSize=1")) {
			return jsonResponse(availabilityResult());
		}
		if (url.endsWith("/PMC5815332/fullTextXML")) return xmlResponse(jatsXml);
		throw new Error(`unexpected URL ${url}`);
	};

	const tools = registerTools();
	const result = await tools.get("feynman_science_database_search")?.execute("call-fulltext", {
		source: "europepmc",
		query: "fulltext:PMC5815332",
		limit: 1,
	});
	const details = result?.details as {
		mode: string;
		results: Array<{
			abstract?: string;
			contentPolicy?: string;
			fullTextAvailable?: boolean;
			fullTextStatus?: string;
			nFigures?: number;
			nReferences?: number;
			nTables?: number;
			rawXmlBytes?: number;
			sectionCount?: number;
			sectionInventory?: Array<{ imrad: string; title: string }>;
			sections?: Array<{ imrad: string; textSnippet: string; title: string }>;
			title?: string;
		}>;
		source: string;
	};

	assert.equal(details.source, "europepmc");
	assert.equal(details.mode, "fulltext");
	assert.equal(details.results[0]?.fullTextStatus, "retrieved");
	assert.equal(details.results[0]?.fullTextAvailable, true);
	assert.equal(details.results[0]?.title, "Fetched title");
	assert.equal(details.results[0]?.abstract, "Structured abstract text.");
	assert.equal(details.results[0]?.sectionCount, 2);
	assert.deepEqual(details.results[0]?.sectionInventory?.map((section) => section.imrad), ["introduction", "methods"]);
	assert.match(details.results[0]?.sections?.[0]?.textSnippet ?? "", /Intro paragraph/);
	assert.equal(details.results[0]?.nFigures, 1);
	assert.equal(details.results[0]?.nTables, 1);
	assert.equal(details.results[0]?.nReferences, 2);
	assert.equal(details.results[0]?.contentPolicy, "Returned section snippets are bounded; raw fullTextXML is not included in tool output.");
	assert.equal(typeof details.results[0]?.rawXmlBytes, "number");
	assert.equal(requests.length, 2);
	assert.match(tools.get("feynman_science_database_search")?.promptSnippet ?? "", /full-text sections/);
	assert.match(tools.get("feynman_science_database_search")?.promptGuidelines?.join("\n") ?? "", /section inventories/);
});

test("Europe PMC full-text mode reports not-open-access records without fetching XML", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = String(input);
		requests.push(url);
		if (url.includes("/search")) {
			const query = new URL(url).searchParams.get("query");
			assert.equal(query, "EXT_ID:29456894 AND SRC:MED");
			return jsonResponse(availabilityResult({ isOpenAccess: "N" }));
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tools = registerTools();
	const result = await tools.get("feynman_science_database_search")?.execute("call-fulltext-pmid", {
		source: "europepmc",
		query: "pmid:29456894",
		limit: 1,
	});
	const details = result?.details as { mode: string; results: Array<{ fullTextAvailable?: boolean; fullTextStatus?: string; inputIdType?: string }> };

	assert.equal(details.mode, "fulltext");
	assert.equal(details.results[0]?.inputIdType, "pmid");
	assert.equal(details.results[0]?.fullTextStatus, "not_open_access");
	assert.equal(details.results[0]?.fullTextAvailable, false);
	assert.equal(requests.length, 1);
});

test("Europe PMC full-text mode returns invalid ID status records", async () => {
	const tools = registerTools();
	const result = await tools.get("feynman_science_database_search")?.execute("call-fulltext-invalid", {
		source: "europepmc",
		query: "fulltext:not-a-paper-id",
		limit: 1,
	});
	const details = result?.details as { results: Array<{ found?: boolean; fullTextStatus?: string; inputIdType?: string }> };

	assert.equal(details.results[0]?.inputIdType, "unknown");
	assert.equal(details.results[0]?.found, false);
	assert.equal(details.results[0]?.fullTextStatus, "invalid_id");
});
