import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type ChemistrySketcherInput = {
	filename?: string;
	ket?: string;
	molfile?: string;
	rxn?: string;
	smiles?: string;
};

type ChemistrySketcherSeed = {
	artifactPath: string;
	filename: string;
	format: "ket" | "molfile" | "rxn" | "smiles";
	mimeType: string;
	schema: "feynman.chemistrySketcherSeed.v1";
};

const EMPTY_KET = '{"root":{"nodes":[]}}';
const MAX_STRUCTURE_CHARS = 250_000;

function cleanStructure(value: string | undefined, label: string): string | undefined {
	if (value === undefined) return undefined;
	const clean = value.trim();
	if (!clean) return undefined;
	if (clean.length > MAX_STRUCTURE_CHARS) {
		throw new Error(`${label} seed is too large for the chemistry sketcher seed artifact.`);
	}
	return clean;
}

function safeFilenameStem(value: string | undefined): string {
	const clean = (value?.trim() || "sketcher")
		.replace(/\.[a-z0-9]+$/i, "")
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
	return clean || "sketcher";
}

function chooseSeed(input: ChemistrySketcherInput): {
	content: string;
	extension: ".ket" | ".mol" | ".rxn" | ".smi";
	format: ChemistrySketcherSeed["format"];
	mimeType: string;
} {
	const ket = cleanStructure(input.ket, "KET");
	if (ket) return { content: ket, extension: ".ket", format: "ket", mimeType: "application/json" };
	const rxn = cleanStructure(input.rxn, "RXN");
	if (rxn) return { content: rxn, extension: ".rxn", format: "rxn", mimeType: "chemical/x-mdl-rxnfile" };
	const molfile = cleanStructure(input.molfile, "Molfile");
	if (molfile) return { content: molfile, extension: ".mol", format: "molfile", mimeType: "chemical/x-mdl-molfile" };
	const smiles = cleanStructure(input.smiles, "SMILES");
	if (smiles) return { content: smiles, extension: ".smi", format: "smiles", mimeType: "chemical/x-daylight-smiles" };
	return { content: EMPTY_KET, extension: ".ket", format: "ket", mimeType: "application/json" };
}

function createChemistrySketcherSeed(cwd: string, input: ChemistrySketcherInput): ChemistrySketcherSeed {
	const seed = chooseSeed(input);
	const outputDir = join(cwd, "outputs", "chemistry-sketches");
	mkdirSync(outputDir, { recursive: true });
	const filename = `${safeFilenameStem(input.filename)}${seed.extension}`;
	const artifactPath = join(outputDir, filename);
	writeFileSync(artifactPath, `${seed.content}\n`, "utf8");
	return {
		schema: "feynman.chemistrySketcherSeed.v1",
		artifactPath,
		filename,
		format: seed.format,
		mimeType: seed.mimeType,
	};
}

function formatResult(result: ChemistrySketcherSeed): string {
	return [
		"Prepared a Feynman chemistry sketcher artifact.",
		`Artifact: ${result.artifactPath}`,
		`Format: ${result.format}`,
		"Open it from the workbench Files or artifact pane to edit it in the local Ketcher editor and save versions through Feynman artifact history.",
	].join("\n");
}

export function registerChemistrySketcherTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "feynman_open_chemistry_sketcher",
		label: "Feynman Chemistry Sketcher",
		description:
			"Create a workspace artifact seed for Feynman's local Ketcher chemistry editor from KET, Molfile, RXN, or SMILES input.",
		promptSnippet: "Prepare an editable molecule or reaction sketch in Feynman's chemistry editor.",
		promptGuidelines: [
			"Use this when the user wants to draw, inspect, or edit a molecule or reaction instead of only searching chemistry databases.",
			"Prefer KET when available because it preserves Ketcher editor state; otherwise pass RXN, Molfile, or SMILES.",
			"Do not depend on a local Claude Science runtime. This writes a Feynman-owned workspace artifact under outputs/chemistry-sketches/.",
			"After creating the seed, tell the user which artifact to open in the workbench molecule preview/editor.",
		],
		parameters: Type.Object({
			smiles: Type.Optional(Type.String({ description: "SMILES or extended SMILES seed for the sketcher canvas." })),
			molfile: Type.Optional(Type.String({ description: "MDL Molfile V2000/V3000 seed for the sketcher canvas." })),
			ket: Type.Optional(Type.String({ description: "Ketcher KET JSON seed. Preferred when available because it is lossless for Ketcher state." })),
			rxn: Type.Optional(Type.String({ description: "MDL RXN reaction-file seed for the sketcher canvas." })),
			filename: Type.Optional(Type.String({ description: "Filename stem for the saved workspace artifact. Extension is selected from the seed format." })),
		}),
		async execute(_toolCallId, params) {
			const result = createChemistrySketcherSeed(process.cwd(), params);
			return {
				content: [{ type: "text", text: formatResult(result) }],
				details: result,
			};
		},
	});
}

export const testableChemistrySketcher = {
	createChemistrySketcherSeed,
};
