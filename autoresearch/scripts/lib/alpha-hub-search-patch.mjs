const SEARCH_BY_EMBEDDING = [
	"export async function searchByEmbedding(query) {",
	"  return await callTool('embedding_similarity_search', { query });",
	"}",
].join("\n");

const SEARCH_BY_KEYWORD = [
	"export async function searchByKeyword(query) {",
	"  return await callTool('full_text_papers_search', { query });",
	"}",
].join("\n");

const AGENTIC_SEARCH = [
	"export async function agenticSearch(query) {",
	"  return await callTool('agentic_paper_retrieval', { query });",
	"}",
].join("\n");

const LEGACY_ANSWER_PDF_QUERY = [
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
].join("\n");

const PATCHED_ANSWER_PDF_QUERY = [
	"export async function answerPdfQuery(url, query) {",
	"  return await callTool('answer_pdf_queries', { paper: url, queries: [query] });",
	"}",
].join("\n");

const FALLBACK_HELPERS = `
function shouldFallbackToDiscoverPapers(err) {
  const message = getErrorMessage(err);
  return (
    message.includes('Tool embedding_similarity_search not found') ||
    message.includes('Tool full_text_papers_search not found') ||
    message.includes('Tool agentic_paper_retrieval not found') ||
    message.includes('embedding_similarity_search not found') ||
    message.includes('full_text_papers_search not found') ||
    message.includes('agentic_paper_retrieval not found')
  );
}

async function discoverPapers(query, mode) {
  const args = {
    question: query,
    keywords: query,
    difficulty: mode === 'keyword' ? 'easy' : 'graduate',
  };
  return await callTool('discover_papers', args);
}
`;

const REST_FALLBACK_HELPERS = `
const ALPHAXIV_REST_SEARCH_URL = 'https://api.alphaxiv.org/search/v2/paper/fast';

function shouldFallbackToSearchFallback(err) {
  const message = getErrorMessage(err);
  return (
    shouldFallbackToDiscoverPapers(err) ||
    message.includes('Tool discover_papers not found') ||
    message.includes('discover_papers not found') ||
    message.includes('-32602')
  );
}

async function searchRestFast(query) {
  const url = new URL(ALPHAXIV_REST_SEARCH_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('includePrivate', 'false');

  const token = await getValidToken();
  const response = await fetch(url, {
    headers: token ? { Authorization: \`Bearer \${token}\` } : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(\`alphaXiv REST search failed (\${response.status}): \${text || response.statusText}\`);
  }

  return await response.json();
}

async function fallbackSearch(query, mode, cause) {
  if (!shouldFallbackToSearchFallback(cause)) {
    throw cause;
  }

  try {
    return await discoverPapers(query, mode);
  } catch (err) {
    if (shouldFallbackToSearchFallback(err)) {
      return await searchRestFast(query);
    }
    throw err;
  }
}
`;

const OLD_PATCHED_SEARCH_BY_EMBEDDING = [
	"export async function searchByEmbedding(query) {",
	"  try {",
	"    return await callTool('embedding_similarity_search', { query });",
	"  } catch (err) {",
	"    if (shouldFallbackToDiscoverPapers(err)) return await discoverPapers(query, 'semantic');",
	"    throw err;",
	"  }",
	"}",
].join("\n");

const OLD_PATCHED_SEARCH_BY_KEYWORD = [
	"export async function searchByKeyword(query) {",
	"  try {",
	"    return await callTool('full_text_papers_search', { query });",
	"  } catch (err) {",
	"    if (shouldFallbackToDiscoverPapers(err)) return await discoverPapers(query, 'keyword');",
	"    throw err;",
	"  }",
	"}",
].join("\n");

const OLD_PATCHED_AGENTIC_SEARCH = [
	"export async function agenticSearch(query) {",
	"  try {",
	"    return await callTool('agentic_paper_retrieval', { query });",
	"  } catch (err) {",
	"    if (shouldFallbackToDiscoverPapers(err)) return await discoverPapers(query, 'agentic');",
	"    throw err;",
	"  }",
	"}",
].join("\n");

const PATCHED_SEARCH_BY_EMBEDDING = [
	"export async function searchByEmbedding(query) {",
	"  try {",
	"    return await callTool('embedding_similarity_search', { query });",
	"  } catch (err) {",
	"    return await fallbackSearch(query, 'semantic', err);",
	"  }",
	"}",
].join("\n");

const PATCHED_SEARCH_BY_KEYWORD = [
	"export async function searchByKeyword(query) {",
	"  try {",
	"    return await callTool('full_text_papers_search', { query });",
	"  } catch (err) {",
	"    return await fallbackSearch(query, 'keyword', err);",
	"  }",
	"}",
].join("\n");

const PATCHED_AGENTIC_SEARCH = [
	"export async function agenticSearch(query) {",
	"  try {",
	"    return await callTool('agentic_paper_retrieval', { query });",
	"  } catch (err) {",
	"    return await fallbackSearch(query, 'agentic', err);",
	"  }",
	"}",
].join("\n");

export function patchAlphaHubSearchSource(source) {
	let patched = source;
	if (!patched.includes("async function searchRestFast(")) {
		const hasSearchFunctions =
			patched.includes(SEARCH_BY_EMBEDDING) ||
			patched.includes(SEARCH_BY_KEYWORD) ||
			patched.includes(AGENTIC_SEARCH) ||
			patched.includes(OLD_PATCHED_SEARCH_BY_EMBEDDING) ||
			patched.includes(OLD_PATCHED_SEARCH_BY_KEYWORD) ||
			patched.includes(OLD_PATCHED_AGENTIC_SEARCH);
		if (hasSearchFunctions) {
			const anchor = "async function callTool(name, args) {";
			if (patched.includes(anchor)) {
				const helpers = patched.includes("function shouldFallbackToDiscoverPapers(")
					? REST_FALLBACK_HELPERS
					: `${FALLBACK_HELPERS}\n${REST_FALLBACK_HELPERS}`;
				patched = patched.replace(anchor, `${helpers}\n${anchor}`);
			}
			patched = patched
				.replace(OLD_PATCHED_SEARCH_BY_EMBEDDING, PATCHED_SEARCH_BY_EMBEDDING)
				.replace(OLD_PATCHED_SEARCH_BY_KEYWORD, PATCHED_SEARCH_BY_KEYWORD)
				.replace(OLD_PATCHED_AGENTIC_SEARCH, PATCHED_AGENTIC_SEARCH)
				.replace(SEARCH_BY_EMBEDDING, PATCHED_SEARCH_BY_EMBEDDING)
				.replace(SEARCH_BY_KEYWORD, PATCHED_SEARCH_BY_KEYWORD)
				.replace(AGENTIC_SEARCH, PATCHED_AGENTIC_SEARCH);
		}
	}

	if (!patched.includes(PATCHED_ANSWER_PDF_QUERY)) {
		if (patched.includes(LEGACY_ANSWER_PDF_QUERY)) {
			patched = patched.replace(LEGACY_ANSWER_PDF_QUERY, PATCHED_ANSWER_PDF_QUERY);
		} else if (patched.includes("export async function answerPdfQuery(")) {
			throw new Error("Unsupported alpha-hub answerPdfQuery layout");
		}
	}

	return patched;
}

// Issue #167: alphaXiv search tools now return structured JSON (an array of
// { link, paperId, title, snippet } entries) instead of the old numbered
// markdown text. parsePaperSearchResults only parsed the text format and
// silently returned `results: []` for every structured payload.
const STRUCTURED_RESULTS_HELPER = [
	"function normalizeStructuredSearchResult(entry, index, includeRaw) {",
	"  const linkId = typeof entry.link === 'string' ? entry.link.replace(/^\\/abs\\//, '').trim() : '';",
	"  const paperId = typeof entry.paperId === 'string' && entry.paperId.trim() ? entry.paperId.trim() : (linkId || null);",
	"  const snippet = typeof entry.snippet === 'string' ? entry.snippet : (typeof entry.abstract === 'string' ? entry.abstract : null);",
	"  return {",
	"    rank: index + 1,",
	"    title: cleanSearchField(typeof entry.title === 'string' ? entry.title : null),",
	"    visits: null,",
	"    likes: null,",
	"    publishedAt: null,",
	"    organizations: null,",
	"    authors: cleanSearchField(typeof entry.authors === 'string' ? entry.authors : null),",
	"    abstract: cleanSearchField(snippet),",
	"    arxivId: cleanSearchField(paperId),",
	"    arxivUrl: paperId ? `https://arxiv.org/abs/${paperId}` : null,",
	"    alphaXivUrl: paperId ? `https://www.alphaxiv.org/overview/${paperId}` : null,",
	"    ...(includeRaw ? { raw: JSON.stringify(entry) } : {}),",
	"  };",
	"}",
	"",
	"function parseStructuredSearchResults(payload, includeRaw) {",
	"  const entries = Array.isArray(payload)",
	"    ? payload",
	"    : ['results', 'papers', 'data'].map((key) => payload?.[key]).find((value) => Array.isArray(value));",
	"  if (!Array.isArray(entries)) {",
	"    return null;",
	"  }",
	"  const results = entries",
	"    .filter((entry) => entry && typeof entry === 'object')",
	"    .map((entry, index) => normalizeStructuredSearchResult(entry, index, includeRaw));",
	"  return includeRaw ? { raw: JSON.stringify(payload), results } : { results };",
	"}",
].join("\n");

const PARSE_GUARD_ORIGINAL = [
	"  const includeRaw = options.includeRaw === true;",
	"  if (typeof text !== 'string') {",
	"    return { results: [] };",
	"  }",
].join("\n");

const PARSE_GUARD_PATCHED = [
	"  const includeRaw = options.includeRaw === true;",
	"  if (typeof text !== 'string') {",
	"    return parseStructuredSearchResults(text, includeRaw) ?? { results: [] };",
	"  }",
].join("\n");

export function patchAlphaHubSearchResultsSource(source) {
	if (source.includes("function parseStructuredSearchResults(")) {
		return source;
	}
	if (!source.includes(PARSE_GUARD_ORIGINAL)) {
		return source;
	}

	const anchor = "export function parsePaperSearchResults(";
	let patched = source.replace(PARSE_GUARD_ORIGINAL, PARSE_GUARD_PATCHED);
	patched = patched.replace(anchor, `${STRUCTURED_RESULTS_HELPER}\n\n${anchor}`);
	return patched;
}
