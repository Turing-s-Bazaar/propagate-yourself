import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { fetchEuropePmcPaperContent, resolvePaperAccess, type PaperRecord } from "../src/rank/paper-rank.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

test("arXiv metadata rejects external XML entities without exposing their value", async () => {
	const outputDir = mkdtempSync(join(tmpdir(), "feynman-arxiv-xml-security-"));
	temporaryDirectories.push(outputDir);
	const fetchImpl = async (input: string | URL | Request) => {
		const url = new URL(String(input));
		if (url.hostname === "export.arxiv.org") {
			return new Response(`<?xml version="1.0"?>
<!DOCTYPE feed [<!ENTITY local_file SYSTEM "file:///etc/passwd">]>
<feed xmlns="http://www.w3.org/2005/Atom">
	<entry>
		<id>https://arxiv.org/abs/2309.08600</id>
		<title>&local_file;</title>
	</entry>
</feed>`, {
				status: 200,
				headers: { "content-type": "application/atom+xml" },
			});
		}
		return new Response(JSON.stringify({
			meta: { count: 0 },
			results: [],
		}), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	};

	const result = await resolvePaperAccess({
		identifier: "2309.08600",
		outputDir,
		fetchImpl: fetchImpl as typeof fetch,
		now: new Date("2026-08-22T00:00:00Z"),
	});

	assert.equal(result.source, "arxiv");
	assert.equal(result.paper.title, "arXiv 2309.08600");
	assert.doesNotMatch(JSON.stringify(result), /root:|local_file|passwd/);
});

test("arXiv metadata accepts only exact arXiv access links", async () => {
	const outputDir = mkdtempSync(join(tmpdir(), "feynman-arxiv-link-security-"));
	temporaryDirectories.push(outputDir);
	const fetchImpl = async (input: string | URL | Request) => {
		const url = new URL(String(input));
		if (url.hostname === "export.arxiv.org") {
			return new Response(`<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
	<entry>
		<id>http://arxiv.org/abs/2309.08600v2</id>
		<title>Safe paper</title>
		<link href="javascript:alert('/pdf/')" title="pdf" type="application/pdf"/>
		<link href="http://arxiv.org/pdf/2309.08600v1" title="pdf" type="application/pdf"/>
		<link href="https://reader@arxiv.org/pdf/2309.08600v1" title="pdf" type="application/pdf"/>
		<link href="https://arxiv.org:8443/pdf/2309.08600v1" title="pdf" type="application/pdf"/>
		<link href="https://arxiv.org.attacker.example/pdf/2309.08600" title="pdf" type="application/pdf"/>
		<link href="https://arxiv.org/pdf/2401.00001" title="pdf" type="application/pdf"/>
		<link href="https://arxiv.org/pdf/2309.08600v2" title="pdf" type="application/pdf"/>
	</entry>
</feed>`, {
				status: 200,
				headers: { "content-type": "application/atom+xml" },
			});
		}
		return new Response(JSON.stringify({
			meta: { count: 0 },
			results: [],
		}), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	};

	const result = await resolvePaperAccess({
		identifier: "2309.08600",
		outputDir,
		fetchImpl: fetchImpl as typeof fetch,
		now: new Date("2026-08-22T00:00:00Z"),
	});

	assert.ok(result.paper.urls.some((url) => url.url === "https://arxiv.org/pdf/2309.08600v2"));
	for (const accessUrl of result.paper.urls) {
		const url = new URL(accessUrl.url);
		assert.equal(url.protocol, "https:");
		assert.equal(url.hostname, "arxiv.org");
		assert.equal(url.port, "");
		assert.equal(url.username, "");
		assert.match(url.pathname, /^\/(?:abs|pdf)\/2309\.08600(?:v\d+)?$/);
	}
});

test("arXiv metadata rejects an Atom entry for a different paper", async () => {
	const outputDir = mkdtempSync(join(tmpdir(), "feynman-arxiv-entry-identity-"));
	temporaryDirectories.push(outputDir);
	const fetchImpl = async (input: string | URL | Request) => {
		const url = new URL(String(input));
		if (url.hostname === "export.arxiv.org") {
			return new Response(`<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
	<entry>
		<id>http://arxiv.org/abs/2401.00001</id>
		<title>Wrong paper metadata</title>
		<author><name>Wrong Author</name></author>
	</entry>
</feed>`, {
				status: 200,
				headers: { "content-type": "application/atom+xml" },
			});
		}
		return new Response(JSON.stringify({ meta: { count: 0 }, results: [] }), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	};

	const result = await resolvePaperAccess({
		identifier: "2309.08600",
		outputDir,
		fetchImpl: fetchImpl as typeof fetch,
		now: new Date("2026-08-22T00:00:00Z"),
	});

	assert.equal(result.paper.title, "arXiv 2309.08600");
	assert.deepEqual(result.paper.authors, []);
	assert.doesNotMatch(JSON.stringify(result), /Wrong paper metadata|Wrong Author/);
});

test("Europe PMC full text decodes XML entities exactly once", async () => {
	const paper: PaperRecord = {
		paperId: "pmc-entity-test",
		openAlexId: "https://openalex.org/WENTITY",
		pmcid: "PMC123456",
		title: "Entity semantics",
		year: 2026,
		type: "article",
		authors: [],
		concepts: [],
		topics: [],
		urls: [],
		citationCount: 0,
		references: [],
		relatedWorks: [],
		sourceRank: 1,
		graphRole: "seed",
		isOpenAccess: true,
		isRetracted: false,
		provenance: [],
	};
	const fetchImpl = async () => new Response([
		"<article><body><p>",
		"single &lt;script&gt; text; ",
		"nested &amp;lt;script&amp;gt; text; ",
		"numeric &#60;tag&#62;; ",
		"nested numeric &amp;#60;tag&amp;#62;; ",
		"valid XML chars &#x41; and &#128512;; ",
		"invalid XML references &AMP; &#X41; &#0; &#xD800;.",
		"</p></body></article>",
	].join(""), {
		status: 200,
		headers: { "content-type": "application/xml" },
	});

	const result = await fetchEuropePmcPaperContent(paper, fetchImpl as typeof fetch);

	assert.ok(result);
	const content = String(result.content);
	assert.match(content, /single <script> text/);
	assert.match(content, /nested &lt;script&gt; text/);
	assert.match(content, /numeric <tag>/);
	assert.match(content, /nested numeric &#60;tag&#62;/);
	assert.match(content, /valid XML chars A and 😀/);
	assert.match(content, /invalid XML references &AMP; &#X41; &#0; &#xD800;/);
});

test("Europe PMC full text removes a complete DOCTYPE internal subset", async () => {
	const paper: PaperRecord = {
		paperId: "pmc-doctype-test",
		openAlexId: "https://openalex.org/WDOCTYPE",
		pmcid: "PMC654321",
		title: "DOCTYPE semantics",
		year: 2026,
		type: "article",
		authors: [],
		concepts: [],
		topics: [],
		urls: [],
		citationCount: 0,
		references: [],
		relatedWorks: [],
		sourceRank: 1,
		graphRole: "seed",
		isOpenAccess: true,
		isRetracted: false,
		provenance: [],
	};
	const fetchImpl = async () => new Response([
		"<?xml version=\"1.0\"?>",
		"<!DOCTYPE article [<!-- valid [ bracket in DTD comment --><?provider [ignored]?><!ENTITY label \"marker > text\">]>",
		"<article><body><p>Measured &lt;LOD and retained &label;.</p></body></article>",
	].join(""), {
		status: 200,
		headers: { "content-type": "application/xml" },
	});

	const result = await fetchEuropePmcPaperContent(paper, fetchImpl as typeof fetch);

	assert.ok(result);
	const content = String(result.content);
	assert.match(content, /Measured <LOD and retained &label;/);
	assert.doesNotMatch(content, /DOCTYPE|<!ENTITY|\]>/);
});
