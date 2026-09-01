import assert from "node:assert/strict";
import test from "node:test";

import {
	artifactPreviewKind,
	parseMsaPreview,
} from "../workbench-web/src/artifacts.js";
import type {
	FilePreview,
	WorkbenchArtifact,
} from "../workbench-web/src/types.js";

const baseArtifact = {
	path: "outputs/sample.fasta",
	name: "sample.fasta",
	title: "Sample",
	category: "data",
	extension: ".fasta",
	contentType: "text/x-fasta",
	sizeBytes: 32,
	updatedAt: "2026-07-02T00:00:00.000Z",
	updatedAtMs: 0,
	slug: "sample",
	previewable: true,
} satisfies WorkbenchArtifact;

test("MSA preview helpers classify and parse aligned sequence artifacts", () => {
	const alignedFastaPreview = {
		path: "outputs/sample.fasta",
		name: "sample.fasta",
		sizeBytes: 32,
		updatedAt: "2026-07-02T00:00:00.000Z",
		category: "text/x-fasta",
		content: ">seq1\nAC-G\n>seq2\nAT-G\n>seq3\nACAG\n",
		truncated: false,
	} satisfies FilePreview;
	const clustalArtifact = {
		...baseArtifact,
		path: "outputs/aligned.aln",
		name: "aligned.aln",
		extension: ".aln",
		contentType: "text/x-clustal",
	} satisfies WorkbenchArtifact;

	assert.equal(artifactPreviewKind(baseArtifact), "sequence");
	assert.equal(artifactPreviewKind(baseArtifact, alignedFastaPreview), "msa");
	assert.equal(artifactPreviewKind(clustalArtifact), "msa");

	const msa = parseMsaPreview(alignedFastaPreview.content, ".fasta");
	assert.equal(msa.format, "fasta");
	assert.equal(msa.isAlignment, true);
	assert.equal(msa.sequenceCount, 3);
	assert.equal(msa.alignmentLength, 4);
	assert.equal(msa.gapCount, 2);
	assert.equal(msa.gapPercent, 16.7);
	assert.equal(msa.variableColumnCount, 2);
	assert.equal(msa.conservedColumnCount, 2);
	assert.equal(msa.records[0]?.id, "seq1");
	assert.equal(msa.records[0]?.gapPercent, 25);

	const clustal = parseMsaPreview("CLUSTAL W\n\nseq1 AC-G 4\nseq2 AT-G 4\n     *: *\n", ".aln");
	assert.equal(clustal.format, "clustal");
	assert.equal(clustal.isAlignment, true);
	assert.equal(clustal.sequenceCount, 2);
	assert.equal(clustal.records[1]?.sequence, "AT-G");
});
