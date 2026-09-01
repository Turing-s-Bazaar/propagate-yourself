import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseJsonPreview } from "../workbench-web/src/artifacts.js";

test("JSON preview helpers parse structured seed artifacts and JSONL records", () => {
	const topCandidates = parseJsonPreview(readFileSync("fixtures/open-science-seeds/example_enzyme_engineering/top5.json", "utf8"), ".json");
	assert.equal(topCandidates.format, "json");
	assert.equal(topCandidates.rootType, "array");
	assert.equal(topCandidates.topLevelCount, 5);
	assert.equal(topCandidates.invalidLineCount, 0);
	assert.ok(topCandidates.nodeCount > 40);
	assert.ok(topCandidates.topLevelKeys.includes("mutation"));
	assert.ok(topCandidates.topLevelKeys.includes("consensus_z"));

	const signatureGenes = parseJsonPreview(readFileSync("fixtures/open-science-seeds/example_immunotherapy/signature_genes.json", "utf8"), ".json");
	assert.equal(signatureGenes.rootType, "object");
	assert.equal(signatureGenes.topLevelCount, 5);
	assert.deepEqual(signatureGenes.topLevelKeys.slice(0, 3), ["responder_up", "responder_down_NRup", "paper_responder"]);
	assert.ok(signatureGenes.arrayCount >= 4);
	assert.ok(signatureGenes.objectCount >= 2);

	const records = parseJsonPreview("{\"gene\":\"IL2\",\"score\":1}\n{\"gene\":\"TNF\",\"score\":2}\n", ".jsonl");
	assert.equal(records.format, "jsonl");
	assert.equal(records.rootType, "array");
	assert.equal(records.lineCount, 2);
	assert.equal(records.topLevelCount, 2);
	assert.deepEqual(records.topLevelKeys, ["gene", "score"]);

	const invalid = parseJsonPreview("{\"ok\":true}\nnot-json\n", ".jsonl");
	assert.equal(invalid.invalidLineCount, 1);
	assert.match(invalid.error ?? "", /Line 2/);
	assert.equal(invalid.topLevelCount, 1);
});
