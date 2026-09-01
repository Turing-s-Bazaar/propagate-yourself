import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { patchAlphaHubSearchResultsSource, patchAlphaHubSearchSource } from "../scripts/lib/alpha-hub-search-patch.mjs";

const SOURCE = `
function getErrorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

async function callTool(name, args) {
  return { name, args };
}

export async function searchByEmbedding(query) {
  return await callTool('embedding_similarity_search', { query });
}

export async function searchByKeyword(query) {
  return await callTool('full_text_papers_search', { query });
}

export async function agenticSearch(query) {
  return await callTool('agentic_paper_retrieval', { query });
}

export async function answerPdfQuery(url, query) {
  try {
    return await callTool('answer_pdf_queries', { urls: [url], queries: [query] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Input validation error') || message.includes('Invalid arguments')) {
      return await callTool('answer_pdf_queries', { url, query });
    }
    throw err;
  }
}
`;

test("patchAlphaHubSearchSource falls back to discover_papers for removed alphaXiv search tools", () => {
	const patched = patchAlphaHubSearchSource(SOURCE);

	assert.match(patched, /function shouldFallbackToDiscoverPapers/);
	assert.match(patched, /function shouldFallbackToSearchFallback/);
	assert.match(patched, /callTool\('discover_papers', args\)/);
	assert.match(patched, /const ALPHAXIV_REST_SEARCH_URL = 'https:\/\/api\.alphaxiv\.org\/search\/v2\/paper\/fast'/);
	assert.match(patched, /url\.searchParams\.set\('q', query\)/);
	assert.match(patched, /url\.searchParams\.set\('includePrivate', 'false'\)/);
	assert.match(patched, /return await searchRestFast\(query\)/);
	assert.match(patched, /question: query/);
	assert.match(patched, /keywords: query/);
	assert.match(patched, /difficulty: mode === 'keyword' \? 'easy' : 'graduate'/);
	assert.match(patched, /Tool embedding_similarity_search not found/);
	assert.match(patched, /return await callTool\('embedding_similarity_search', \{ query \}\)/);
	assert.match(patched, /return await fallbackSearch\(query, 'semantic', err\)/);
	assert.match(patched, /return await fallbackSearch\(query, 'keyword', err\)/);
	assert.match(patched, /return await fallbackSearch\(query, 'agentic', err\)/);
	assert.match(
		patched,
		/return await callTool\('answer_pdf_queries', \{ paper: url, queries: \[query\] \}\)/,
	);
	assert.doesNotMatch(patched, /\{ urls: \[url\], queries: \[query\] \}/);
	assert.doesNotMatch(patched, /\{ url, query \}/);
});

test("patchAlphaHubSearchSource is idempotent", () => {
	const once = patchAlphaHubSearchSource(SOURCE);
	const twice = patchAlphaHubSearchSource(once);
	assert.equal(twice, once);
});

test("patchAlphaHubSearchSource upgrades the discover_papers-only fallback", () => {
	const discoverOnly = patchAlphaHubSearchSource(SOURCE).replace(
		/const ALPHAXIV_REST_SEARCH_URL[\s\S]*?\nasync function callTool\(name, args\) \{/,
		"async function callTool(name, args) {",
	).replaceAll("return await fallbackSearch(query, 'semantic', err);", "if (shouldFallbackToDiscoverPapers(err)) return await discoverPapers(query, 'semantic');\n    throw err;")
		.replaceAll("return await fallbackSearch(query, 'keyword', err);", "if (shouldFallbackToDiscoverPapers(err)) return await discoverPapers(query, 'keyword');\n    throw err;")
		.replaceAll("return await fallbackSearch(query, 'agentic', err);", "if (shouldFallbackToDiscoverPapers(err)) return await discoverPapers(query, 'agentic');\n    throw err;");

	const upgraded = patchAlphaHubSearchSource(discoverOnly);

	assert.match(upgraded, /async function searchRestFast/);
	assert.match(upgraded, /return await fallbackSearch\(query, 'semantic', err\)/);
	assert.match(upgraded, /return await fallbackSearch\(query, 'keyword', err\)/);
	assert.match(upgraded, /return await fallbackSearch\(query, 'agentic', err\)/);
});

test("patchAlphaHubSearchSource sends the current alphaXiv paper Q&A schema", async () => {
	const patched = patchAlphaHubSearchSource(SOURCE);
	const moduleUrl = `data:text/javascript;base64,${Buffer.from(patched).toString("base64")}`;
	const { answerPdfQuery } = await import(moduleUrl);

	assert.deepEqual(
		await answerPdfQuery("https://arxiv.org/abs/2401.12345", "What optimizer did they use?"),
		{
			name: "answer_pdf_queries",
			args: {
				paper: "https://arxiv.org/abs/2401.12345",
				queries: ["What optimizer did they use?"],
			},
		},
	);
});

test("patchAlphaHubSearchSource repairs Q&A after the search fallback was already patched", () => {
	const searchPatched = patchAlphaHubSearchSource(SOURCE).replace(
		[
			"export async function answerPdfQuery(url, query) {",
			"  return await callTool('answer_pdf_queries', { paper: url, queries: [query] });",
			"}",
		].join("\n"),
		[
			"export async function answerPdfQuery(url, query) {",
			"  try {",
			"    return await callTool('answer_pdf_queries', { urls: [url], queries: [query] });",
			"  } catch (err) {",
			"    const message = err instanceof Error ? err.message : String(err);",
			"    if (message.includes('Input validation error') || message.includes('Invalid arguments')) {",
			"      return await callTool('answer_pdf_queries', { url, query });",
			"    }",
			"    throw err;",
			"  }",
			"}",
		].join("\n"),
	);

	const repaired = patchAlphaHubSearchSource(searchPatched);
	assert.match(
		repaired,
		/return await callTool\('answer_pdf_queries', \{ paper: url, queries: \[query\] \}\)/,
	);
	assert.equal(repaired.includes("async function searchRestFast("), true);
});

test("patchAlphaHubSearchSource fails closed on unknown Q&A layouts", () => {
	assert.throws(
		() =>
			patchAlphaHubSearchSource(
				SOURCE.replace(
					"return await callTool('answer_pdf_queries', { urls: [url], queries: [query] });",
					"return await callTool('answer_pdf_queries', { document: url, questions: [query] });",
				),
			),
		/Unsupported alpha-hub answerPdfQuery layout/,
	);
});

test("patchAlphaHubSearchResultsSource parses structured JSON search payloads", async () => {
	const input = [
		"function cleanSearchField(value) {",
		"  return typeof value === 'string' && value.trim() ? value.trim() : null;",
		"}",
		"",
		"export function parsePaperSearchResults(text, options = {}) {",
		"  const includeRaw = options.includeRaw === true;",
		"  if (typeof text !== 'string') {",
		"    return { results: [] };",
		"  }",
		"  return includeRaw ? { raw: text, results: [] } : { results: [] };",
		"}",
		"",
	].join("\n");

	const patched = patchAlphaHubSearchResultsSource(input);

	assert.match(patched, /function parseStructuredSearchResults\(/);
	assert.match(patched, /parseStructuredSearchResults\(text, includeRaw\) \?\? \{ results: \[\] \}/);

	const moduleUrl = `data:text/javascript;base64,${Buffer.from(patched).toString("base64")}`;
	const { parsePaperSearchResults } = await import(moduleUrl);

	const structured = parsePaperSearchResults([
		{ link: "/abs/1706.03762", paperId: "1706.03762", title: "Attention Is All You Need", snippet: "We propose the Transformer." },
		{ link: "/abs/2502.19214", title: "A Hybrid Transformer Architecture", snippet: "Quantized self-attention." },
	]);
	assert.equal(structured.results.length, 2);
	assert.equal(structured.results[0].arxivId, "1706.03762");
	assert.equal(structured.results[0].arxivUrl, "https://arxiv.org/abs/1706.03762");
	assert.equal(structured.results[0].alphaXivUrl, "https://www.alphaxiv.org/overview/1706.03762");
	assert.equal(structured.results[0].abstract, "We propose the Transformer.");
	assert.equal(structured.results[1].arxivId, "2502.19214");

	const wrapped = parsePaperSearchResults({ results: [{ paperId: "2401.00001", title: "Wrapped", snippet: "s" }] });
	assert.equal(wrapped.results.length, 1);
	assert.equal(wrapped.results[0].arxivId, "2401.00001");

	assert.deepEqual(parsePaperSearchResults({ unexpected: true }), { results: [] });
	assert.deepEqual(parsePaperSearchResults(null), { results: [] });

	const twice = patchAlphaHubSearchResultsSource(patched);
	assert.equal(twice, patched);
});

test("runtime rebuilds and package verification preserve the structured alphaXiv parser", () => {
	const runtimeWorkspaceSource = readFileSync("scripts/prepare-runtime-workspace.mjs", "utf8");
	const packageVerifierSource = readFileSync("scripts/verify-package-artifact.mjs", "utf8");

	assert.match(
		runtimeWorkspaceSource,
		/import \{\s*patchAlphaHubSearchResultsSource,\s*patchAlphaHubSearchSource,\s*\} from "\.\/lib\/alpha-hub-search-patch\.mjs"/,
	);
	assert.match(
		runtimeWorkspaceSource,
		/\["index\.js", patchAlphaHubSearchResultsSource\]/,
	);
	assert.match(
		packageVerifierSource,
		/\["index\.js", "parser", \["function parseStructuredSearchResults\("\]\]/,
	);
	assert.match(packageVerifierSource, /`npm\/node_modules\/@companion-ai\/alpha-hub\/src\/lib\/\$\{fileName\}`/);
});
