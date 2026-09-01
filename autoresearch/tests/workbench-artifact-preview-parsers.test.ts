import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";

import type { WorkbenchArtifact } from "../src/workbench/types.js";
import {
	artifactDownloadUrl,
	artifactPreviewKind,
	artifactUsesTextPreview,
	formatBytes,
	inferGenomeBrowserTrack,
	parseDelimitedPreview,
	parseGenomePreview,
	parseLatexPreview,
	parseMoleculePreview,
	parseNotebookPreview,
	parseSequencePreview,
	parseSpreadsheetPreview,
	parseStructurePreview,
	parseTreePreview,
} from "../workbench-web/src/artifacts.js";

function previewArtifact(overrides: Partial<WorkbenchArtifact> = {}): WorkbenchArtifact {
	return {
		path: "outputs/cells.csv",
		name: "cells.csv",
		title: "Cell table",
		category: "data",
		extension: ".csv",
		contentType: "text/csv",
		sizeBytes: 1536,
		updatedAt: "2026-07-02T00:00:00.000Z",
		updatedAtMs: 0,
		slug: "cells",
		previewable: true,
		...overrides,
	};
}

test("artifact preview helpers classify scientific, media, and document artifacts", () => {
	const csvArtifact = previewArtifact();
	const imageArtifact = previewArtifact({ path: "outputs/figure.png", name: "figure.png", extension: ".png", contentType: "image/png" });
	const htmlArtifact = previewArtifact({ path: "outputs/design_report.html", name: "design_report.html", extension: ".html", contentType: "text/html" });
	const pdfArtifact = previewArtifact({ path: "papers/draft.pdf", name: "draft.pdf", extension: ".pdf", contentType: "application/pdf" });
	const fastaArtifact = previewArtifact({ path: "outputs/sample.fasta", name: "sample.fasta", extension: ".fasta", contentType: "text/x-fasta" });
	const vcfArtifact = previewArtifact({ path: "outputs/variants.vcf", name: "variants.vcf", extension: ".vcf", contentType: "text/x-vcf" });
	const moleculeArtifact = previewArtifact({ path: "outputs/compound.sdf", name: "compound.sdf", extension: ".sdf", contentType: "chemical/x-mdl-sdfile" });
	const cxsmilesArtifact = previewArtifact({ path: "outputs/compound.cxsmiles", name: "compound.cxsmiles", extension: ".cxsmiles", contentType: "chemical/x-daylight-smiles" });
	const ketArtifact = previewArtifact({ path: "outputs/sketch.ket", name: "sketch.ket", extension: ".ket", contentType: "application/json" });
	const rxnArtifact = previewArtifact({ path: "outputs/reaction.rxn", name: "reaction.rxn", extension: ".rxn", contentType: "chemical/x-mdl-rxnfile" });
	const cdxmlArtifact = previewArtifact({ path: "outputs/compound.cdxml", name: "compound.cdxml", extension: ".cdxml", contentType: "chemical/x-cdxml" });
	const structureArtifact = previewArtifact({ path: "outputs/model.pdb", name: "model.pdb", extension: ".pdb", contentType: "chemical/x-pdb" });
	const treeArtifact = previewArtifact({ path: "outputs/tree.nwk", name: "tree.nwk", extension: ".nwk", contentType: "text/x-newick" });
	const tensorArtifact = previewArtifact({ path: "outputs/plddt.npy", name: "plddt.npy", extension: ".npy", contentType: "application/x-npy", previewable: false });
	const jsonArtifact = previewArtifact({ path: "outputs/signature_genes.json", name: "signature_genes.json", extension: ".json", contentType: "application/json" });
	const audioArtifact = previewArtifact({ path: "outputs/interview.mp3", name: "interview.mp3", extension: ".mp3", contentType: "audio/mpeg", previewable: false });
	const videoArtifact = previewArtifact({ path: "outputs/assay.mp4", name: "assay.mp4", extension: ".mp4", contentType: "video/mp4", previewable: false });
	const spreadsheetArtifact = previewArtifact({ path: "outputs/results.xlsx", name: "results.xlsx", extension: ".xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", previewable: false });
	const notebookArtifact = previewArtifact({ path: "outputs/analysis.ipynb", name: "analysis.ipynb", extension: ".ipynb", contentType: "application/x-ipynb+json" });
	const latexArtifact = previewArtifact({ path: "papers/draft.tex", name: "draft.tex", extension: ".tex", contentType: "text/x-tex" });

	assert.equal(artifactPreviewKind(csvArtifact), "table");
	assert.equal(artifactPreviewKind(imageArtifact), "image");
	assert.equal(artifactPreviewKind(htmlArtifact), "html");
	assert.equal(artifactPreviewKind(pdfArtifact), "pdf");
	assert.equal(artifactPreviewKind(fastaArtifact), "sequence");
	assert.equal(artifactPreviewKind(vcfArtifact), "genome");
	assert.equal(artifactPreviewKind(moleculeArtifact), "molecule");
	assert.equal(artifactPreviewKind(cxsmilesArtifact), "molecule");
	assert.equal(artifactPreviewKind(ketArtifact), "molecule");
	assert.equal(artifactPreviewKind(rxnArtifact), "molecule");
	assert.equal(artifactPreviewKind(cdxmlArtifact), "molecule");
	assert.equal(artifactPreviewKind(structureArtifact), "structure");
	assert.equal(artifactPreviewKind(treeArtifact), "tree");
	assert.equal(artifactPreviewKind(tensorArtifact), "tensor");
	assert.equal(artifactPreviewKind(jsonArtifact), "json");
	assert.equal(artifactPreviewKind(audioArtifact), "audio");
	assert.equal(artifactPreviewKind(videoArtifact), "video");
	assert.equal(artifactPreviewKind(spreadsheetArtifact), "spreadsheet");
	assert.equal(artifactPreviewKind(notebookArtifact), "notebook");
	assert.equal(artifactPreviewKind(latexArtifact), "latex");
	assert.equal(artifactUsesTextPreview(artifactPreviewKind(audioArtifact)), false);
	assert.equal(artifactUsesTextPreview(artifactPreviewKind(videoArtifact)), false);
	assert.equal(artifactUsesTextPreview(artifactPreviewKind(spreadsheetArtifact)), false);
	assert.equal(artifactUsesTextPreview(artifactPreviewKind(notebookArtifact)), true);
	assert.equal(artifactUsesTextPreview(artifactPreviewKind(latexArtifact)), true);
	assert.equal(formatBytes(1536), "1.5 KB");
	assert.equal(artifactDownloadUrl("outputs/cells.csv"), "/api/file/download?path=outputs%2Fcells.csv");

	const parsed = parseDelimitedPreview("gene,count\nIL2,42\n\"TNF, alpha\",7\n", ",");
	assert.deepEqual(parsed.headers, ["gene", "count"]);
	assert.deepEqual(parsed.rows, [["IL2", "42"], ["TNF, alpha", "7"]]);
	assert.equal(parsed.truncated, false);

	const sequence = parseSequencePreview(">seq1 kinase domain\nACGTACGT\n>seq2\nMMMM\n");
	assert.equal(sequence.recordCount, 2);
	assert.equal(sequence.totalLength, 12);
	assert.equal(sequence.records[0]?.id, "seq1");
	assert.equal(sequence.records[0]?.gcPercent, 50);
	assert.equal(sequence.records[1]?.residueCounts[0]?.residue, "M");

	const genome = parseGenomePreview("#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\nchr1\t10\trs1\tA\tG\t60\tPASS\t.\n", ".vcf");
	assert.equal(genome.format, "vcf");
	assert.equal(genome.recordCount, 1);
	assert.equal(genome.rows[0]?.chrom, "chr1");
	assert.deepEqual(genome.contigs, ["chr1"]);
	assert.deepEqual(inferGenomeBrowserTrack(genome), {
		format: "vcf",
		locus: "chr1:10-11",
		name: "Variant calls",
		type: "variant",
	});

	const bedGenome = parseGenomePreview("chr2\t100\t120\tpeak-1\t42\t+\n", ".bed");
	assert.deepEqual(inferGenomeBrowserTrack(bedGenome), {
		format: "bed",
		locus: "chr2:101-120",
		name: "Genomic intervals",
		type: "annotation",
	});

	const gffGenome = parseGenomePreview("chr3\tRefSeq\texon\t50\t75\t.\t-\t.\tID=exon-1\n", ".gff3");
	assert.deepEqual(inferGenomeBrowserTrack(gffGenome), {
		format: "gff3",
		locus: "chr3:50-75",
		name: "Genome annotations",
		type: "annotation",
	});

	const genbankGenome = parseGenomePreview("LOCUS       SCU49845     5028 bp    DNA             PLN       21-JUN-1999\nACCESSION   U49845\n", ".gb");
	assert.equal(inferGenomeBrowserTrack(genbankGenome), undefined);

	const molecule = parseMoleculePreview("demo\n  feynman\n\n  2  1  0  0  0  0            999 V2000\n    0.0    0.0    0.0 C   0  0\n    1.2    0.0    0.0 O   0  0\n  1  2  1  0\nM  END\n$$$$\n", ".sdf");
	assert.equal(molecule.format, "sdf");
	assert.equal(molecule.moleculeCount, 1);
	assert.equal(molecule.atomCount, 2);
	assert.equal(molecule.bondCount, 1);

	const cxsmiles = parseMoleculePreview("CCO |$;;_R1$| ethanol\n", ".cxsmiles");
	assert.equal(cxsmiles.format, "smiles");
	assert.equal(cxsmiles.moleculeCount, 1);
	assert.equal(cxsmiles.molecules[0]?.smiles, "CCO");

	const ket = parseMoleculePreview(JSON.stringify({
		root: {
			nodes: [
				{ type: "atom", label: "C" },
				{ type: "atom", label: "O" },
				{ type: "bond" },
			],
		},
	}), ".ket");
	assert.equal(ket.format, "ket");
	assert.equal(ket.atomCount, 2);
	assert.equal(ket.bondCount, 1);
	assert.equal(ket.molecules[0]?.format, "KET");

	const rxn = parseMoleculePreview("$RXN\n\n\n\n  1  1\n$MOL\nreactant\n  feynman\n\n  1  0  0  0  0  0            999 V2000\n    0.0    0.0    0.0 C   0  0\nM  END\n$MOL\nproduct\n  feynman\n\n  1  0  0  0  0  0            999 V2000\n    0.0    0.0    0.0 O   0  0\nM  END\n", ".rxn");
	assert.equal(rxn.format, "rxn");
	assert.equal(rxn.moleculeCount, 2);

	const cdxml = parseMoleculePreview("<CDXML><page><fragment><n id=\"1\"/><n id=\"2\"/><b id=\"3\"/></fragment></page></CDXML>", ".cdxml");
	assert.equal(cdxml.format, "cdxml");
	assert.equal(cdxml.atomCount, 2);
	assert.equal(cdxml.bondCount, 1);

	const structure = parseStructurePreview("ATOM      1  CA  GLY A   1      11.104  13.207   8.356  1.00 20.00           C\nATOM      2  O   GLY A   1      12.104  13.207   8.356  1.00 20.00           O\n", ".pdb");
	assert.equal(structure.format, "pdb");
	assert.equal(structure.atomCount, 2);
	assert.equal(structure.chainCount, 1);
	assert.equal(structure.residueCount, 1);
	assert.deepEqual(structure.elements, [{ element: "C", count: 1 }, { element: "O", count: 1 }]);

	const tree = parseTreePreview("((A:0.1,B:0.2)90:0.3,C:0.4);\n", ".nwk");
	assert.equal(tree.format, "newick");
	assert.equal(tree.leafCount, 3);
	assert.equal(tree.branchCount, 4);
	assert.equal(tree.totalBranchLength, 1);
	assert.deepEqual(tree.leafExamples, ["A", "B", "C"]);
	assert.deepEqual(tree.supportLabels, ["90"]);

	const iqtree = parseTreePreview("Tree in newick format:\n\n(A:0.1,(B:0.2,C:0.3)99:0.4);\n\nCONSENSUS TREE\n", ".iqtree");
	assert.equal(iqtree.format, "iqtree");
	assert.equal(iqtree.leafCount, 3);
	assert.deepEqual(iqtree.supportLabels, ["99"]);

	const notebook = parseNotebookPreview(JSON.stringify({
		metadata: { kernelspec: { display_name: "Python 3", language: "python" }, language_info: { name: "python" } },
		cells: [
			{ cell_type: "markdown", source: ["# ESMFold analysis\n", "Inspect confidence."] },
			{ cell_type: "code", execution_count: 2, source: "print('ok')", outputs: [{ output_type: "stream", name: "stdout", text: "ok\n" }] },
		],
	}));
	assert.equal(notebook.title, "ESMFold analysis");
	assert.equal(notebook.cellCount, 2);
	assert.equal(notebook.codeCellCount, 1);
	assert.equal(notebook.markdownCellCount, 1);
	assert.equal(notebook.outputCount, 1);
	assert.equal(notebook.cells[1]?.outputPreview, "ok");

	const latex = parseLatexPreview("\\section{Methods}\\label{sec:methods} We cite \\citep{jumper2021,lin2023}. \\begin{equation}x=1\\end{equation}\\bibliography{refs}");
	assert.deepEqual(latex.sections, ["Methods"]);
	assert.deepEqual(latex.citations, ["jumper2021", "lin2023"]);
	assert.deepEqual(latex.labels, ["sec:methods"]);
	assert.equal(latex.equationCount, 1);
	assert.equal(latex.bibliographyCount, 1);
});

test("spreadsheet preview helper parses bounded XLSX workbooks", async () => {
	const zip = new JSZip();
	zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`);
	zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Scores" sheetId="1" r:id="rId1"/></sheets>
</workbook>`);
	zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`);
	zip.file("xl/sharedStrings.xml", `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4">
  <si><t>gene</t></si><si><t>score</t></si><si><t>TP53</t></si><si><t>0.98</t></si>
</sst>`);
	zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
    <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>
  </sheetData>
</worksheet>`);
	const buffer = await zip.generateAsync({ type: "arraybuffer" });
	const preview = await parseSpreadsheetPreview(buffer);
	assert.equal(preview.format, "xlsx");
	assert.equal(preview.sheetCount, 1);
	assert.equal(preview.sheets[0]?.name, "Scores");
	assert.deepEqual(preview.sheets[0]?.headers, ["gene", "score"]);
	assert.deepEqual(preview.sheets[0]?.rows, [["TP53", "0.98"]]);
});
