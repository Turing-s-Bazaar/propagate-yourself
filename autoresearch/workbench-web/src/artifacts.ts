import type {
	FilePreview,
	WorkbenchArtifact,
	WorkbenchExecutionRecord,
	WorkbenchResearchClaim,
	WorkbenchState,
	WorkbenchVerificationCheck,
	WorkbenchArtifactVersion,
} from "./types.js";
import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import { parseNewick } from "patristic";

export type ArtifactPreviewKind =
	| "audio"
	| "binary"
	| "genome"
	| "html"
	| "image"
	| "json"
	| "latex"
	| "molecule"
	| "msa"
	| "notebook"
	| "pdf"
	| "sequence"
	| "spreadsheet"
	| "structure"
	| "table"
	| "tensor"
	| "text"
	| "tree"
	| "video";

export type DelimitedPreview = {
	headers: string[];
	rows: string[][];
	truncated: boolean;
};

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type JsonPreview = {
	format: "json" | "jsonl";
	data: JsonValue[] | Record<string, JsonValue>;
	rootType: "array" | "object" | "primitive";
	topLevelCount: number;
	topLevelKeys: string[];
	nodeCount: number;
	objectCount: number;
	arrayCount: number;
	primitiveCount: number;
	invalidLineCount: number;
	lineCount?: number;
	truncated: boolean;
	error?: string;
};

export type SpreadsheetSheetPreview = {
	name: string;
	headers: string[];
	rows: string[][];
	rowCount: number;
	columnCount: number;
	truncated: boolean;
};

export type SpreadsheetPreview = {
	format: "xlsx";
	sheetCount: number;
	sheets: SpreadsheetSheetPreview[];
	truncated: boolean;
	error?: string;
};

export type NotebookCellPreview = {
	index: number;
	type: "code" | "markdown" | "raw" | "unknown";
	sourcePreview: string;
	executionCount?: number;
	outputCount: number;
	outputPreview?: string;
};

export type NotebookPreview = {
	format: "ipynb";
	language: string;
	kernel?: string;
	cellCount: number;
	codeCellCount: number;
	markdownCellCount: number;
	rawCellCount: number;
	outputCount: number;
	title?: string;
	cells: NotebookCellPreview[];
	truncated: boolean;
	error?: string;
};

export type LatexPreview = {
	sectionCount: number;
	sections: string[];
	citations: string[];
	labels: string[];
	equationCount: number;
	bibliographyCount: number;
	commandCount: number;
	preview: string;
	truncated: boolean;
};

export type SequenceRecordPreview = {
	id: string;
	description?: string;
	length: number;
	gcPercent?: number;
	preview: string;
	residueCounts: Array<{ residue: string; count: number }>;
};

export type SequencePreview = {
	recordCount: number;
	totalLength: number;
	records: SequenceRecordPreview[];
	truncated: boolean;
};

export type MsaRecordPreview = {
	id: string;
	description?: string;
	sequence: string;
	length: number;
	gapCount: number;
	gapPercent: number;
	preview: string;
};

export type MsaPreview = {
	format: "clustal" | "fasta" | "plain" | "stockholm";
	sequenceCount: number;
	alignmentLength: number;
	gapCount: number;
	gapPercent: number;
	variableColumnCount: number;
	conservedColumnCount: number;
	consensusPreview: string;
	isAlignment: boolean;
	records: MsaRecordPreview[];
	truncated: boolean;
};

export type GenomePreview = {
	format: "bed" | "genbank" | "gff" | "vcf" | "text";
	recordCount: number;
	contigs: string[];
	featureTypes: string[];
	rows: Array<Record<string, string | number | undefined>>;
	truncated: boolean;
};

export type GenomeBrowserTrack =
	| {
		format: "vcf";
		locus: string;
		name: string;
		type: "variant";
	}
	| {
		format: "bed" | "gff3";
		locus: string;
		name: string;
		type: "annotation";
	};

export type MoleculePreview = {
	format: "cdxml" | "ket" | "mol" | "rxn" | "sdf" | "smiles";
	moleculeCount: number;
	atomCount?: number;
	bondCount?: number;
	molecules: Array<Record<string, string | number | undefined>>;
	truncated: boolean;
};

export type StructurePreview = {
	format: "mmcif" | "pdb";
	atomCount: number;
	chainCount: number;
	residueCount: number;
	modelCount: number;
	chains: string[];
	elements: Array<{ element: string; count: number }>;
};

export type TreePreview = {
	format: "iqtree" | "newick";
	newick: string;
	leafCount: number;
	internalNodeCount: number;
	branchCount: number;
	maxDepth: number;
	totalBranchLength?: number;
	leafExamples: string[];
	supportLabels: string[];
	truncated: boolean;
};

type ParsedTreeBranch = {
	id?: string;
	length?: number;
	children?: ParsedTreeBranch[];
};

const audioExtensions = new Set([".aac", ".aiff", ".flac", ".m4a", ".mp3", ".oga", ".ogg", ".opus", ".wav"]);
const imageExtensions = new Set([".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"]);
const htmlExtensions = new Set([".htm", ".html"]);
const latexExtensions = new Set([".latex", ".tex"]);
const notebookExtensions = new Set([".ipynb"]);
const spreadsheetExtensions = new Set([".xlsx"]);
const tableExtensions = new Set([".csv", ".tsv"]);
const msaExtensions = new Set([".afa", ".aln", ".clustal", ".clustalw", ".mfa", ".msf", ".sto", ".stockholm", ".stk"]);
const sequenceExtensions = new Set([".faa", ".fa", ".fasta", ".fna"]);
const genomeExtensions = new Set([".bed", ".gb", ".gbk", ".gff", ".gff3", ".vcf"]);
const jsonExtensions = new Set([".json", ".jsonl"]);
const moleculeExtensions = new Set([".cdxml", ".cxsmiles", ".ket", ".mol", ".rxn", ".sdf", ".smi", ".smiles"]);
const structureExtensions = new Set([".cif", ".ent", ".mmcif", ".pdb"]);
const tensorExtensions = new Set([".npy", ".npz"]);
const treeExtensions = new Set([".iqtree", ".newick", ".nwk", ".tree", ".treefile"]);
const videoExtensions = new Set([".m4v", ".mov", ".mp4", ".mpeg", ".mpg", ".ogv", ".webm"]);

export function artifactDownloadUrl(path: string): string {
	return `/api/file/download?path=${encodeURIComponent(path)}`;
}

const downloadOnlyPreviewKinds = new Set<ArtifactPreviewKind>(["audio", "binary", "image", "pdf", "spreadsheet", "tensor", "video"]);

export function artifactUsesTextPreview(kind: ArtifactPreviewKind | null): boolean {
	return kind === null || !downloadOnlyPreviewKinds.has(kind);
}

export function formatBytes(bytes?: number): string {
	if (!bytes) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	let value = bytes;
	let index = 0;
	while (value >= 1024 && index < units.length - 1) {
		value /= 1024;
		index += 1;
	}
	return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function shortChecksum(version?: Pick<WorkbenchArtifactVersion, "checksum"> | null): string {
	return version?.checksum ? version.checksum.slice(0, 12) : "not recorded";
}

export function artifactPreviewKind(artifact: WorkbenchArtifact, preview?: FilePreview | null): ArtifactPreviewKind {
	const extension = artifact.extension.toLowerCase();
	const contentType = (artifact.contentType || preview?.category || "").toLowerCase();
	if (audioExtensions.has(extension) || contentType.startsWith("audio/")) return "audio";
	if (videoExtensions.has(extension) || contentType.startsWith("video/")) return "video";
	if (spreadsheetExtensions.has(extension) || contentType.includes("spreadsheetml")) return "spreadsheet";
	if (notebookExtensions.has(extension)) return "notebook";
	if (latexExtensions.has(extension)) return "latex";
	if (tableExtensions.has(extension)) return "table";
	if (msaExtensions.has(extension)) return "msa";
	if (sequenceExtensions.has(extension) && preview?.content && parseMsaPreview(preview.content, extension, 16).isAlignment) return "msa";
	if (sequenceExtensions.has(extension)) return "sequence";
	if (genomeExtensions.has(extension)) return "genome";
	if (moleculeExtensions.has(extension)) return "molecule";
	if (jsonExtensions.has(extension) || contentType === "application/json" || contentType === "application/x-ndjson") return "json";
	if (structureExtensions.has(extension)) return "structure";
	if (tensorExtensions.has(extension)) return "tensor";
	if (treeExtensions.has(extension)) return "tree";
	if (imageExtensions.has(extension) || contentType.startsWith("image/")) return "image";
	if (htmlExtensions.has(extension) || contentType.startsWith("text/html")) return "html";
	if (extension === ".pdf" || contentType === "application/pdf") return "pdf";
	if (!artifact.previewable && !contentType.startsWith("text/") && contentType !== "application/json") return "binary";
	return "text";
}

export function parseJsonPreview(content: string, extension: string, nodeLimit = 20000): JsonPreview {
	const format: JsonPreview["format"] = extension.toLowerCase() === ".jsonl" ? "jsonl" : "json";
	if (format === "jsonl") return parseJsonLinesPreview(content, nodeLimit);
	try {
		const parsed = normalizeJsonValue(JSON.parse(content) as unknown);
		return buildJsonPreview("json", parsed, 0, undefined, nodeLimit);
	} catch (error) {
		return jsonPreviewError("json", errorMessage(error), nodeLimit);
	}
}

function parseJsonLinesPreview(content: string, nodeLimit: number): JsonPreview {
	const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
	const rows: JsonValue[] = [];
	let invalidLineCount = 0;
	let firstError: string | undefined;
	for (const [index, line] of lines.entries()) {
		try {
			rows.push(normalizeJsonValue(JSON.parse(line) as unknown));
		} catch (error) {
			invalidLineCount += 1;
			firstError ??= `Line ${index + 1}: ${errorMessage(error)}`;
		}
	}
	if (!rows.length && firstError) return jsonPreviewError("jsonl", firstError, nodeLimit, lines.length, invalidLineCount);
	const preview = buildJsonPreview("jsonl", rows, invalidLineCount, lines.length, nodeLimit);
	return firstError ? { ...preview, error: firstError } : preview;
}

function normalizeJsonValue(value: unknown): JsonValue {
	if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
	if (Array.isArray(value)) return value.map((item) => normalizeJsonValue(item));
	if (isJsonRecord(value)) {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeJsonValue(item)]));
	}
	return String(value);
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildJsonPreview(format: JsonPreview["format"], value: JsonValue, invalidLineCount: number, lineCount: number | undefined, nodeLimit: number): JsonPreview {
	const rootType = Array.isArray(value) ? "array" : typeof value === "object" && value !== null ? "object" : "primitive";
	const data = rootType === "primitive" ? { value } : value as JsonValue[] | Record<string, JsonValue>;
	const stats = summarizeJsonValue(value, nodeLimit);
	return {
		format,
		data,
		rootType,
		topLevelCount: topLevelCount(value),
		topLevelKeys: topLevelKeys(value),
		nodeCount: stats.nodeCount,
		objectCount: stats.objectCount,
		arrayCount: stats.arrayCount,
		primitiveCount: stats.primitiveCount,
		invalidLineCount,
		...(lineCount !== undefined ? { lineCount } : {}),
		truncated: stats.truncated,
	};
}

function jsonPreviewError(format: JsonPreview["format"], message: string, nodeLimit: number, lineCount?: number, invalidLineCount = 0): JsonPreview {
	return {
		...buildJsonPreview(format, { error: message }, invalidLineCount, lineCount, nodeLimit),
		error: message,
	};
}

function summarizeJsonValue(value: JsonValue, limit: number): Pick<JsonPreview, "arrayCount" | "nodeCount" | "objectCount" | "primitiveCount" | "truncated"> {
	const stats = {
		arrayCount: 0,
		nodeCount: 0,
		objectCount: 0,
		primitiveCount: 0,
		truncated: false,
	};
	const visit = (node: JsonValue) => {
		if (stats.nodeCount >= limit) {
			stats.truncated = true;
			return;
		}
		stats.nodeCount += 1;
		if (Array.isArray(node)) {
			stats.arrayCount += 1;
			for (const item of node) visit(item);
			return;
		}
		if (typeof node === "object" && node !== null) {
			stats.objectCount += 1;
			for (const item of Object.values(node)) visit(item);
			return;
		}
		stats.primitiveCount += 1;
	};
	visit(value);
	return stats;
}

function topLevelCount(value: JsonValue): number {
	if (Array.isArray(value)) return value.length;
	if (typeof value === "object" && value !== null) return Object.keys(value).length;
	return 1;
}

function topLevelKeys(value: JsonValue, limit = 14): string[] {
	const keys = new Set<string>();
	if (Array.isArray(value)) {
		for (const item of value.slice(0, limit)) {
			if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
			for (const key of Object.keys(item)) {
				keys.add(key);
				if (keys.size >= limit) return [...keys];
			}
		}
		return [...keys];
	}
	if (typeof value === "object" && value !== null) return Object.keys(value).slice(0, limit);
	return ["value"];
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "JSON could not be parsed.";
}

const xmlParser = new XMLParser({
	attributeNamePrefix: "@_",
	ignoreAttributes: false,
	parseTagValue: false,
	trimValues: false,
});

function asArray<T>(value: T | T[] | undefined): T[] {
	if (value === undefined) return [];
	return Array.isArray(value) ? value : [value];
}

function recordValue(value: unknown, key: string): unknown {
	return typeof value === "object" && value !== null && key in value ? (value as Record<string, unknown>)[key] : undefined;
}

function stringValue(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
	if (Array.isArray(value)) return value.map((item) => stringValue(item)).join("");
	return stringValue(recordValue(value, "#text"));
}

function parseXmlDocument(xml: string): Record<string, unknown> {
	const parsed = xmlParser.parse(xml) as unknown;
	return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
}

function columnIndexFromCellRef(ref: string | undefined): number {
	const letters = ref?.match(/^[A-Z]+/i)?.[0]?.toUpperCase();
	if (!letters) return 0;
	let index = 0;
	for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
	return Math.max(0, index - 1);
}

function columnLabel(index: number): string {
	let value = index + 1;
	let label = "";
	while (value > 0) {
		const mod = (value - 1) % 26;
		label = String.fromCharCode(65 + mod) + label;
		value = Math.floor((value - mod) / 26);
	}
	return label || "A";
}

function normalizeZipPath(target: string): string {
	const withoutLeadingSlash = target.replace(/^\/+/, "");
	if (withoutLeadingSlash.startsWith("xl/")) return withoutLeadingSlash;
	return `xl/${withoutLeadingSlash.replace(/^(\.\.\/)+/, "").replace(/^\/+/, "")}`;
}

function extractSharedStringText(item: unknown): string {
	const direct = recordValue(item, "t");
	if (direct !== undefined) return stringValue(direct);
	const richParts = asArray(recordValue(item, "r"));
	if (richParts.length) return richParts.map((part) => stringValue(recordValue(part, "t"))).join("");
	return stringValue(item);
}

async function readZipText(zip: JSZip, path: string): Promise<string | undefined> {
	const entry = zip.file(path);
	return entry ? entry.async("string") : undefined;
}

async function readSharedStrings(zip: JSZip): Promise<string[]> {
	const xml = await readZipText(zip, "xl/sharedStrings.xml");
	if (!xml) return [];
	const root = parseXmlDocument(xml);
	const sst = recordValue(root, "sst");
	return asArray(recordValue(sst, "si")).map(extractSharedStringText);
}

function cellText(cell: unknown, sharedStrings: string[]): string {
	const type = stringValue(recordValue(cell, "@_t"));
	const raw = recordValue(cell, "v");
	if (type === "s") return sharedStrings[Number(stringValue(raw))] ?? "";
	if (type === "inlineStr") return extractSharedStringText(recordValue(cell, "is"));
	if (type === "b") return stringValue(raw) === "1" ? "TRUE" : "FALSE";
	return stringValue(raw);
}

function rowsFromWorksheetXml(xml: string, sharedStrings: string[], limit: number): { columnCount: number; rows: string[][]; rowCount: number; truncated: boolean } {
	const root = parseXmlDocument(xml);
	const worksheet = recordValue(root, "worksheet");
	const sheetData = recordValue(worksheet, "sheetData");
	const rawRows = asArray(recordValue(sheetData, "row"));
	const rows: string[][] = [];
	let columnCount = 0;
	for (const rawRow of rawRows) {
		const row: string[] = [];
		for (const cell of asArray(recordValue(rawRow, "c"))) {
			const columnIndex = columnIndexFromCellRef(stringValue(recordValue(cell, "@_r")));
			row[columnIndex] = cellText(cell, sharedStrings);
			columnCount = Math.max(columnCount, columnIndex + 1);
		}
		while (row.length && !row[row.length - 1]) row.pop();
		if (row.some((cell) => cell.trim())) rows.push(row);
	}
	const visibleRows = rows.slice(0, limit + 1);
	const width = Math.max(columnCount, ...visibleRows.map((row) => row.length), 0);
	for (const row of visibleRows) {
		for (let index = 0; index < width; index += 1) row[index] ??= "";
	}
	return {
		columnCount: width,
		rowCount: rows.length,
		rows: visibleRows,
		truncated: rows.length > visibleRows.length,
	};
}

export async function parseSpreadsheetPreview(buffer: ArrayBuffer, rowLimit = 80, sheetLimit = 6): Promise<SpreadsheetPreview> {
	try {
		const zip = await JSZip.loadAsync(buffer);
		const workbookXml = await readZipText(zip, "xl/workbook.xml");
		if (!workbookXml) throw new Error("Workbook metadata is missing.");
		const relationshipsXml = await readZipText(zip, "xl/_rels/workbook.xml.rels");
		const workbook = recordValue(parseXmlDocument(workbookXml), "workbook");
		const sheetsRoot = recordValue(workbook, "sheets");
		const sheets = asArray(recordValue(sheetsRoot, "sheet"));
		const relationshipMap = new Map<string, string>();
		if (relationshipsXml) {
			const rels = recordValue(parseXmlDocument(relationshipsXml), "Relationships");
			for (const rel of asArray(recordValue(rels, "Relationship"))) {
				const id = stringValue(recordValue(rel, "@_Id"));
				const target = stringValue(recordValue(rel, "@_Target"));
				if (id && target) relationshipMap.set(id, normalizeZipPath(target));
			}
		}
		const sharedStrings = await readSharedStrings(zip);
		const previews: SpreadsheetSheetPreview[] = [];
		for (const [index, sheet] of sheets.slice(0, sheetLimit).entries()) {
			const name = stringValue(recordValue(sheet, "@_name")) || `Sheet ${index + 1}`;
			const relationshipId = stringValue(recordValue(sheet, "@_r:id"));
			const path = relationshipMap.get(relationshipId) ?? `xl/worksheets/sheet${index + 1}.xml`;
			const worksheetXml = await readZipText(zip, path);
			if (!worksheetXml) continue;
			const parsedRows = rowsFromWorksheetXml(worksheetXml, sharedStrings, rowLimit);
			const headers = parsedRows.rows[0]?.map((cell, columnIndex) => cell || columnLabel(columnIndex)) ?? [];
			previews.push({
				name,
				headers,
				rows: parsedRows.rows.slice(1),
				rowCount: parsedRows.rowCount,
				columnCount: parsedRows.columnCount,
				truncated: parsedRows.truncated,
			});
		}
		return {
			format: "xlsx",
			sheetCount: sheets.length,
			sheets: previews,
			truncated: sheets.length > previews.length || previews.some((sheet) => sheet.truncated),
		};
	} catch (error) {
		return {
			format: "xlsx",
			sheetCount: 0,
			sheets: [],
			truncated: false,
			error: `Couldn't preview this spreadsheet: ${errorMessage(error)}`,
		};
	}
}

function normalizeNotebookText(value: unknown): string {
	return Array.isArray(value) ? value.map((item) => stringValue(item)).join("") : stringValue(value);
}

function notebookOutputPreview(output: unknown): string | undefined {
	const outputType = stringValue(recordValue(output, "output_type"));
	if (outputType === "stream") return normalizeNotebookText(recordValue(output, "text")).trim();
	if (outputType === "error") return [recordValue(output, "ename"), recordValue(output, "evalue")].map(stringValue).filter(Boolean).join(": ");
	const data = recordValue(output, "data");
	const plain = recordValue(data, "text/plain");
	return plain !== undefined ? normalizeNotebookText(plain).trim() : outputType || undefined;
}

export function parseNotebookPreview(content: string, limit = 16): NotebookPreview {
	try {
		const notebook = JSON.parse(content) as unknown;
		const cells = asArray(recordValue(notebook, "cells"));
		let codeCellCount = 0;
		let markdownCellCount = 0;
		let rawCellCount = 0;
		let outputCount = 0;
		const previewCells: NotebookCellPreview[] = [];
		let title: string | undefined;
		for (const [index, cell] of cells.entries()) {
			const rawType = stringValue(recordValue(cell, "cell_type"));
			const type: NotebookCellPreview["type"] = rawType === "code" || rawType === "markdown" || rawType === "raw" ? rawType : "unknown";
			if (type === "code") codeCellCount += 1;
			if (type === "markdown") markdownCellCount += 1;
			if (type === "raw") rawCellCount += 1;
			const source = normalizeNotebookText(recordValue(cell, "source"));
			title ??= source.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim();
			const outputs = asArray(recordValue(cell, "outputs"));
			outputCount += outputs.length;
			if (previewCells.length < limit) {
				previewCells.push({
					index: index + 1,
					type,
					sourcePreview: source.trim().slice(0, 900),
					...(recordValue(cell, "execution_count") !== undefined ? { executionCount: Number(recordValue(cell, "execution_count")) } : {}),
					outputCount: outputs.length,
					outputPreview: outputs.map(notebookOutputPreview).filter(Boolean).join("\n").slice(0, 900) || undefined,
				});
			}
		}
		const metadata = recordValue(notebook, "metadata");
		const kernelSpec = recordValue(metadata, "kernelspec");
		const languageInfo = recordValue(metadata, "language_info");
		return {
			format: "ipynb",
			language: stringValue(recordValue(languageInfo, "name")) || stringValue(recordValue(kernelSpec, "language")) || "unknown",
			kernel: stringValue(recordValue(kernelSpec, "display_name")) || stringValue(recordValue(kernelSpec, "name")) || undefined,
			cellCount: cells.length,
			codeCellCount,
			markdownCellCount,
			rawCellCount,
			outputCount,
			title,
			cells: previewCells,
			truncated: cells.length > previewCells.length,
		};
	} catch (error) {
		return {
			format: "ipynb",
			language: "unknown",
			cellCount: 0,
			codeCellCount: 0,
			markdownCellCount: 0,
			rawCellCount: 0,
			outputCount: 0,
			cells: [],
			truncated: false,
			error: `Couldn't preview this notebook: ${errorMessage(error)}`,
		};
	}
}

function uniqueMatches(content: string, regex: RegExp, limit: number): string[] {
	const values = new Set<string>();
	for (const match of content.matchAll(regex)) {
		const value = match[1]?.trim();
		if (!value) continue;
		for (const part of value.split(",").map((item) => item.trim()).filter(Boolean)) {
			values.add(part);
			if (values.size >= limit) return [...values];
		}
	}
	return [...values];
}

export function parseLatexPreview(content: string, limit = 16): LatexPreview {
	const sections = uniqueMatches(content, /\\(?:part|chapter|section|subsection|subsubsection)\*?\{([^{}]+)\}/g, limit);
	const citations = uniqueMatches(content, /\\(?:cite|citep|citet|autocite|parencite)(?:\[[^\]]*\]){0,2}\{([^{}]+)\}/g, limit);
	const labels = uniqueMatches(content, /\\label\{([^{}]+)\}/g, limit);
	const equationCount = (content.match(/\\begin\{(?:equation|align|gather|multline)\*?\}/g) ?? []).length + (content.match(/\$\$|\\\[/g) ?? []).length;
	const bibliographyCount = (content.match(/\\(?:bibliography|addbibresource|printbibliography)\b/g) ?? []).length;
	const commandCount = (content.match(/\\[a-zA-Z]+/g) ?? []).length;
	return {
		sectionCount: sections.length,
		sections,
		citations,
		labels,
		equationCount,
		bibliographyCount,
		commandCount,
		preview: content.slice(0, 5_000),
		truncated: content.length > 5_000,
	};
}

export function parseDelimitedPreview(content: string, delimiter: "," | "\t", limit = 14): DelimitedPreview {
	const rows: string[][] = [];
	let row: string[] = [];
	let value = "";
	let quoted = false;
	for (let index = 0; index < content.length; index += 1) {
		const char = content[index];
		const next = content[index + 1];
		if (char === '"' && quoted && next === '"') {
			value += '"';
			index += 1;
			continue;
		}
		if (char === '"') {
			quoted = !quoted;
			continue;
		}
		if (char === delimiter && !quoted) {
			row.push(value);
			value = "";
			continue;
		}
		if ((char === "\n" || char === "\r") && !quoted) {
			if (char === "\r" && next === "\n") index += 1;
			row.push(value);
			if (row.some((cell) => cell.trim())) rows.push(row);
			row = [];
			value = "";
			if (rows.length > limit) break;
			continue;
		}
		value += char;
	}
	if (value || row.length) {
		row.push(value);
		if (row.some((cell) => cell.trim())) rows.push(row);
	}
	const visibleRows = rows.slice(0, limit + 1);
	return {
		headers: visibleRows[0] ?? [],
		rows: visibleRows.slice(1, limit + 1),
		truncated: rows.length > limit + 1,
	};
}

export function parseSequencePreview(content: string, limit = 4): SequencePreview {
	const records: SequenceRecordPreview[] = [];
	let header = "";
	let chunks: string[] = [];
	const flush = () => {
		if (!header) return;
		const [id = "sequence", ...descriptionParts] = header.split(/\s+/);
		const sequence = chunks.join("").replace(/\s+/g, "").toUpperCase();
		const residueMap = new Map<string, number>();
		for (const residue of sequence) residueMap.set(residue, (residueMap.get(residue) ?? 0) + 1);
		const gc = (residueMap.get("G") ?? 0) + (residueMap.get("C") ?? 0);
		const acgt = ["A", "C", "G", "T"].reduce((sum, residue) => sum + (residueMap.get(residue) ?? 0), 0);
		records.push({
			id,
			...(descriptionParts.length ? { description: descriptionParts.join(" ") } : {}),
			length: sequence.length,
			...(acgt ? { gcPercent: Number(((gc / acgt) * 100).toFixed(1)) } : {}),
			preview: sequence.slice(0, 96),
			residueCounts: [...residueMap.entries()]
				.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
				.slice(0, 8)
				.map(([residue, count]) => ({ residue, count })),
		});
	};
	for (const line of content.split(/\r?\n/)) {
		if (line.startsWith(">")) {
			flush();
			header = line.slice(1).trim() || `sequence-${records.length + 1}`;
			chunks = [];
		} else if (line.trim()) {
			chunks.push(line.trim());
		}
	}
	flush();
	if (!records.length && content.trim()) {
		header = "sequence";
		chunks = [content.trim()];
		flush();
	}
	return {
		recordCount: records.length,
		totalLength: records.reduce((sum, record) => sum + record.length, 0),
		records: records.slice(0, limit),
		truncated: records.length > limit,
	};
}

export function parseMsaPreview(content: string, extension = "", limit = 80): MsaPreview {
	const ext = extension.toLowerCase();
	const format = msaFormatForContent(content, ext);
	const parsedRecords = format === "clustal"
		? parseClustalMsaRecords(content)
		: format === "stockholm"
			? parseStockholmMsaRecords(content)
			: format === "fasta"
				? parseFastaMsaRecords(content)
				: parsePlainMsaRecords(content);
	const lengths = parsedRecords.map((record) => record.sequence.length).filter((length) => length > 0);
	const alignmentLength = lengths.length ? Math.max(...lengths) : 0;
	const equalLengths = lengths.length > 1 && lengths.every((length) => length === alignmentLength);
	const gapCount = parsedRecords.reduce((sum, record) => sum + countAlignmentGaps(record.sequence), 0);
	const isAlignmentExtension = msaExtensions.has(ext);
	const isAlignment = parsedRecords.length >= 2 && equalLengths && (gapCount > 0 || isAlignmentExtension || format !== "fasta");
	const visibleRecords = parsedRecords.slice(0, limit).map((record): MsaRecordPreview => {
		const recordGapCount = countAlignmentGaps(record.sequence);
		return {
			id: record.id,
			...(record.description ? { description: record.description } : {}),
			sequence: record.sequence,
			length: record.sequence.length,
			gapCount: recordGapCount,
			gapPercent: record.sequence.length ? Number(((recordGapCount / record.sequence.length) * 100).toFixed(1)) : 0,
			preview: record.sequence.slice(0, 96),
		};
	});
	const columns = summarizeMsaColumns(parsedRecords, alignmentLength);
	return {
		format,
		sequenceCount: parsedRecords.length,
		alignmentLength,
		gapCount,
		gapPercent: parsedRecords.length && alignmentLength ? Number(((gapCount / (parsedRecords.length * alignmentLength)) * 100).toFixed(1)) : 0,
		variableColumnCount: columns.variableColumnCount,
		conservedColumnCount: columns.conservedColumnCount,
		consensusPreview: columns.consensus.slice(0, 120),
		isAlignment,
		records: visibleRecords,
		truncated: parsedRecords.length > limit,
	};
}

type ParsedMsaRecord = {
	id: string;
	description?: string;
	sequence: string;
};

function msaFormatForContent(content: string, extension: string): MsaPreview["format"] {
	const firstLine = content.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
	if (firstLine.startsWith(">")) return "fasta";
	if (/^CLUSTAL/i.test(firstLine) || extension === ".aln" || extension === ".clustal" || extension === ".clustalw") return "clustal";
	if (/^#\s*STOCKHOLM/i.test(firstLine) || extension === ".sto" || extension === ".stockholm" || extension === ".stk") return "stockholm";
	if (extension === ".afa" || extension === ".mfa") return "fasta";
	return "plain";
}

function parseFastaMsaRecords(content: string): ParsedMsaRecord[] {
	const records: ParsedMsaRecord[] = [];
	let header = "";
	let chunks: string[] = [];
	const flush = () => {
		if (!header) return;
		const [id = `sequence-${records.length + 1}`, ...descriptionParts] = header.split(/\s+/);
		const sequence = normalizeMsaSequence(chunks.join(""));
		if (!sequence) return;
		records.push({
			id,
			...(descriptionParts.length ? { description: descriptionParts.join(" ") } : {}),
			sequence,
		});
	};
	for (const line of content.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		if (trimmed.startsWith(">")) {
			flush();
			header = trimmed.slice(1).trim() || `sequence-${records.length + 1}`;
			chunks = [];
			continue;
		}
		if (!trimmed.startsWith(";")) chunks.push(trimmed);
	}
	flush();
	return records;
}

function parseClustalMsaRecords(content: string): ParsedMsaRecord[] {
	const records = new Map<string, string[]>();
	const order: string[] = [];
	for (const line of content.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || /^CLUSTAL/i.test(trimmed) || /^[*:.\s-]+$/.test(line)) continue;
		const match = trimmed.match(/^(\S+)\s+([A-Za-z*.\-]+)(?:\s+\d+)?/);
		if (!match) continue;
		const [, id, sequence] = match;
		if (!records.has(id)) {
			records.set(id, []);
			order.push(id);
		}
		records.get(id)?.push(sequence);
	}
	return order.map((id) => ({ id, sequence: normalizeMsaSequence(records.get(id)?.join("") ?? "") })).filter((record) => record.sequence);
}

function parseStockholmMsaRecords(content: string): ParsedMsaRecord[] {
	const records = new Map<string, string[]>();
	const order: string[] = [];
	for (const line of content.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#") || trimmed === "//") continue;
		const [id, sequence] = trimmed.split(/\s+/);
		if (!id || !sequence) continue;
		if (!records.has(id)) {
			records.set(id, []);
			order.push(id);
		}
		records.get(id)?.push(sequence);
	}
	return order.map((id) => ({ id, sequence: normalizeMsaSequence(records.get(id)?.join("") ?? "") })).filter((record) => record.sequence);
}

function parsePlainMsaRecords(content: string): ParsedMsaRecord[] {
	const records = new Map<string, string[]>();
	const order: string[] = [];
	for (const line of content.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const [id, sequence] = trimmed.split(/\s+/);
		if (!id || !sequence || !/[A-Za-z*.\-]/.test(sequence)) continue;
		if (!records.has(id)) {
			records.set(id, []);
			order.push(id);
		}
		records.get(id)?.push(sequence);
	}
	return order.map((id) => ({ id, sequence: normalizeMsaSequence(records.get(id)?.join("") ?? "") })).filter((record) => record.sequence);
}

function normalizeMsaSequence(sequence: string): string {
	return sequence.replace(/\s+/g, "").replace(/\./g, "-").toUpperCase();
}

function countAlignmentGaps(sequence: string): number {
	return [...sequence].filter((char) => char === "-" || char === ".").length;
}

function summarizeMsaColumns(records: ParsedMsaRecord[], alignmentLength: number): { consensus: string; conservedColumnCount: number; variableColumnCount: number } {
	let conservedColumnCount = 0;
	let variableColumnCount = 0;
	let consensus = "";
	for (let index = 0; index < alignmentLength; index += 1) {
		const residues = records.map((record) => record.sequence[index] ?? "-");
		const nonGapResidues = residues.filter((residue) => residue !== "-" && residue !== ".");
		const uniqueResidues = new Set(nonGapResidues);
		const hasGap = nonGapResidues.length !== residues.length;
		if (uniqueResidues.size === 1 && !hasGap) {
			conservedColumnCount += 1;
			consensus += nonGapResidues[0] ?? "-";
		} else {
			if (uniqueResidues.size > 1 || hasGap) variableColumnCount += 1;
			consensus += uniqueResidues.size === 1 ? nonGapResidues[0]?.toLowerCase() ?? "-" : ".";
		}
	}
	return { consensus, conservedColumnCount, variableColumnCount };
}

export function parseGenomePreview(content: string, extension: string, limit = 8): GenomePreview {
	const ext = extension.toLowerCase();
	if (ext === ".vcf") return parseVcfPreview(content, limit);
	if (ext === ".bed") return parseBedPreview(content, limit);
	if (ext === ".gb" || ext === ".gbk") return parseGenbankPreview(content);
	if (ext === ".gff" || ext === ".gff3") return parseGffPreview(content, limit);
	return parsePlainGenomePreview(content, limit);
}

function parseVcfPreview(content: string, limit: number): GenomePreview {
	const rows: Array<Record<string, string | number | undefined>> = [];
	const contigs = new Set<string>();
	let recordCount = 0;
	for (const line of content.split(/\r?\n/)) {
		if (!line.trim() || line.startsWith("#")) continue;
		recordCount += 1;
		const [chrom, pos, id, ref, alt, qual, filter] = line.split("\t");
		if (chrom) contigs.add(chrom);
		if (rows.length < limit) rows.push({ chrom, pos: Number(pos) || pos, id, ref, alt, qual, filter });
	}
	return { format: "vcf", recordCount, contigs: [...contigs].slice(0, 8), featureTypes: ["variant"], rows, truncated: recordCount > rows.length };
}

function parseBedPreview(content: string, limit: number): GenomePreview {
	const rows: Array<Record<string, string | number | undefined>> = [];
	const contigs = new Set<string>();
	let recordCount = 0;
	for (const line of content.split(/\r?\n/)) {
		if (!line.trim() || line.startsWith("#") || line.startsWith("track") || line.startsWith("browser")) continue;
		recordCount += 1;
		const [chrom, start, end, name, score, strand] = line.split("\t");
		if (chrom) contigs.add(chrom);
		if (rows.length < limit) rows.push({ chrom, start: Number(start) || start, end: Number(end) || end, name, score, strand });
	}
	return { format: "bed", recordCount, contigs: [...contigs].slice(0, 8), featureTypes: ["interval"], rows, truncated: recordCount > rows.length };
}

function parseGffPreview(content: string, limit: number): GenomePreview {
	const rows: Array<Record<string, string | number | undefined>> = [];
	const contigs = new Set<string>();
	const featureTypes = new Set<string>();
	let recordCount = 0;
	for (const line of content.split(/\r?\n/)) {
		if (!line.trim() || line.startsWith("#")) continue;
		recordCount += 1;
		const [seqid, source, type, start, end, score, strand] = line.split("\t");
		if (seqid) contigs.add(seqid);
		if (type) featureTypes.add(type);
		if (rows.length < limit) rows.push({ seqid, source, type, start: Number(start) || start, end: Number(end) || end, score, strand });
	}
	return { format: "gff", recordCount, contigs: [...contigs].slice(0, 8), featureTypes: [...featureTypes].slice(0, 8), rows, truncated: recordCount > rows.length };
}

function parseGenbankPreview(content: string): GenomePreview {
	const valueFor = (label: string) => content.match(new RegExp(`^${label}\\s+(.+)$`, "m"))?.[1]?.trim();
	const locus = valueFor("LOCUS");
	return {
		format: "genbank",
		recordCount: locus ? 1 : 0,
		contigs: [valueFor("ACCESSION")].filter(Boolean) as string[],
		featureTypes: ["sequence"],
		rows: [{
			locus,
			definition: valueFor("DEFINITION"),
			accession: valueFor("ACCESSION"),
			version: valueFor("VERSION"),
			source: valueFor("SOURCE"),
		}],
		truncated: false,
	};
}

function parsePlainGenomePreview(content: string, limit: number): GenomePreview {
	const rows = content.split(/\r?\n/).filter((line) => line.trim()).slice(0, limit).map((line, index) => ({ line: index + 1, value: line }));
	return { format: "text", recordCount: rows.length, contigs: [], featureTypes: [], rows, truncated: content.split(/\r?\n/).length > limit };
}

function numberField(value: string | number | undefined): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
	return undefined;
}

function locusFromParts(chrom: string | number | undefined, start: number | undefined, end: number | undefined): string | undefined {
	if (chrom === undefined || start === undefined) return undefined;
	const cleanChrom = String(chrom).trim();
	if (!cleanChrom) return undefined;
	const safeStart = Math.max(1, Math.floor(start));
	const safeEnd = Math.max(safeStart, Math.floor(end ?? safeStart + 1));
	return `${cleanChrom}:${safeStart}-${safeEnd}`;
}

export function inferGenomeBrowserTrack(preview: GenomePreview): GenomeBrowserTrack | undefined {
	const firstRow = preview.rows[0];
	if (!firstRow) return undefined;
	if (preview.format === "vcf") {
		const pos = numberField(firstRow.pos);
		const ref = typeof firstRow.ref === "string" ? firstRow.ref : "";
		const locus = locusFromParts(firstRow.chrom, pos, pos === undefined ? undefined : pos + Math.max(1, ref.length));
		return locus ? { format: "vcf", locus, name: "Variant calls", type: "variant" } : undefined;
	}
	if (preview.format === "bed") {
		const start = numberField(firstRow.start);
		const end = numberField(firstRow.end);
		const locus = locusFromParts(firstRow.chrom, start === undefined ? undefined : start + 1, end);
		return locus ? { format: "bed", locus, name: "Genomic intervals", type: "annotation" } : undefined;
	}
	if (preview.format === "gff") {
		const locus = locusFromParts(firstRow.seqid, numberField(firstRow.start), numberField(firstRow.end));
		return locus ? { format: "gff3", locus, name: "Genome annotations", type: "annotation" } : undefined;
	}
	return undefined;
}

export function parseMoleculePreview(content: string, extension: string, limit = 6): MoleculePreview {
	const ext = extension.toLowerCase();
	if (ext === ".smi" || ext === ".smiles" || ext === ".cxsmiles") return parseSmilesPreview(content, limit);
	if (ext === ".ket") return parseKetPreview(content);
	if (ext === ".rxn") return parseRxnPreview(content, limit);
	if (ext === ".cdxml") return parseCdxmlPreview(content);
	const molecules = content.split(/\n\$\$\$\$\s*(?:\r?\n|$)/).map((item) => item.trim()).filter(Boolean);
	const records = molecules.slice(0, limit).map((mol, index) => {
		const lines = mol.split(/\r?\n/);
		const counts = parseMolCounts(lines);
		return {
			index: index + 1,
			title: lines[0]?.trim() || `Molecule ${index + 1}`,
			atomCount: counts.atomCount,
			bondCount: counts.bondCount,
			format: lines.some((line) => line.includes("V3000")) ? "V3000" : "V2000",
		};
	});
	const firstCounts = parseMolCounts(molecules[0]?.split(/\r?\n/) ?? []);
	return {
		format: ext === ".mol" ? "mol" : "sdf",
		moleculeCount: molecules.length,
		atomCount: firstCounts.atomCount,
		bondCount: firstCounts.bondCount,
		molecules: records,
		truncated: molecules.length > records.length,
	};
}

function visitJsonNodes(value: unknown, visit: (record: Record<string, unknown>) => void): void {
	if (Array.isArray(value)) {
		for (const item of value) visitJsonNodes(item, visit);
		return;
	}
	if (typeof value !== "object" || value === null) return;
	const record = value as Record<string, unknown>;
	visit(record);
	for (const item of Object.values(record)) visitJsonNodes(item, visit);
}

function parseKetPreview(content: string): MoleculePreview {
	let atomCount = 0;
	let bondCount = 0;
	let nodeCount = 0;
	let fragmentCount = 0;
	try {
		const parsed = JSON.parse(content) as unknown;
		visitJsonNodes(parsed, (record) => {
			const type = typeof record.type === "string" ? record.type.toLowerCase() : "";
			if (type === "atom") atomCount += 1;
			if (type === "bond") bondCount += 1;
			if (type === "fragment") fragmentCount += 1;
			if (type) nodeCount += 1;
		});
	} catch {
		return {
			format: "ket",
			moleculeCount: 1,
			molecules: [{ index: 1, format: "KET", title: "Ketcher structure", parseStatus: "invalid JSON" }],
			truncated: false,
		};
	}
	return {
		format: "ket",
		moleculeCount: Math.max(1, fragmentCount || (atomCount || bondCount ? 1 : 0)),
		...(atomCount ? { atomCount } : {}),
		...(bondCount ? { bondCount } : {}),
		molecules: [{
			index: 1,
			format: "KET",
			title: "Ketcher structure",
			...(atomCount ? { atomCount } : {}),
			...(bondCount ? { bondCount } : {}),
			...(nodeCount ? { nodeCount } : {}),
		}],
		truncated: false,
	};
}

function parseRxnPreview(content: string, limit: number): MoleculePreview {
	const molecules = content.split(/\$MOL\b/g).slice(1).map((item) => item.trim()).filter(Boolean);
	const records = molecules.slice(0, limit).map((mol, index) => {
		const lines = mol.split(/\r?\n/);
		const counts = parseMolCounts(lines);
		return {
			index: index + 1,
			title: lines[0]?.trim() || `Reaction molecule ${index + 1}`,
			atomCount: counts.atomCount,
			bondCount: counts.bondCount,
			format: lines.some((line) => line.includes("V3000")) ? "V3000" : "V2000",
		};
	});
	const firstCounts = parseMolCounts(molecules[0]?.split(/\r?\n/) ?? []);
	return {
		format: "rxn",
		moleculeCount: molecules.length || 1,
		atomCount: firstCounts.atomCount,
		bondCount: firstCounts.bondCount,
		molecules: records.length ? records : [{ index: 1, format: "RXN", title: "Reaction sketch" }],
		truncated: molecules.length > records.length,
	};
}

function parseCdxmlPreview(content: string): MoleculePreview {
	const atomCount = (content.match(/<n\b/gi) ?? []).length;
	const bondCount = (content.match(/<b\b/gi) ?? []).length;
	const fragmentCount = (content.match(/<fragment\b/gi) ?? []).length;
	return {
		format: "cdxml",
		moleculeCount: Math.max(1, fragmentCount || (atomCount || bondCount ? 1 : 0)),
		...(atomCount ? { atomCount } : {}),
		...(bondCount ? { bondCount } : {}),
		molecules: [{
			index: 1,
			format: "CDXML",
			title: "ChemDraw structure",
			...(atomCount ? { atomCount } : {}),
			...(bondCount ? { bondCount } : {}),
			...(fragmentCount ? { fragmentCount } : {}),
		}],
		truncated: false,
	};
}

function parseMolCounts(lines: string[]): { atomCount?: number; bondCount?: number } {
	const countsLine = lines.find((line) => /^\s*\d+\s+\d+/.test(line));
	if (!countsLine) return {};
	const atomCount = Number(countsLine.slice(0, 3).trim());
	const bondCount = Number(countsLine.slice(3, 6).trim());
	return {
		...(Number.isFinite(atomCount) ? { atomCount } : {}),
		...(Number.isFinite(bondCount) ? { bondCount } : {}),
	};
}

function parseSmilesPreview(content: string, limit: number): MoleculePreview {
	const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
	const molecules = lines.slice(0, limit).map((line, index) => {
		const [smiles = "", ...nameParts] = line.split(/\s+/);
		return { index: index + 1, smiles, name: nameParts.join(" ") || undefined, atomEstimate: estimateSmilesAtoms(smiles) };
	});
	return { format: "smiles", moleculeCount: lines.length, molecules, truncated: lines.length > molecules.length };
}

function estimateSmilesAtoms(smiles: string): number {
	return smiles.match(/Br|Cl|[A-Z][a-z]?|[cnops]/g)?.length ?? 0;
}

export function parseStructurePreview(content: string, extension: string): StructurePreview {
	const ext = extension.toLowerCase();
	return ext === ".pdb" || ext === ".ent" ? parsePdbPreview(content) : parseMmcifPreview(content);
}

export function extractNewickTree(content: string, extension: string): string | undefined {
	const source = extension.toLowerCase() === ".iqtree" ? extractIqtreeNewick(content) : content;
	const trimmed = source.trim();
	if (!trimmed) return undefined;
	if (trimmed.startsWith("(") && trimmed.includes(";")) return trimmed.slice(0, trimmed.indexOf(";") + 1);
	return trimmed.match(/(\([^;]+;)/s)?.[1]?.trim();
}

function extractIqtreeNewick(content: string): string {
	const markers = ["Tree in newick format:", "Consensus tree in newick format:"];
	for (const marker of markers) {
		const index = content.indexOf(marker);
		if (index === -1) continue;
		const afterMarker = content.slice(index + marker.length);
		const match = afterMarker.match(/(\([^;]+;)/s);
		if (match?.[1]) return match[1];
	}
	return content;
}

export function parseTreePreview(content: string, extension: string, limit = 12): TreePreview {
	const newick = extractNewickTree(content, extension);
	if (!newick) {
		return {
			format: extension.toLowerCase() === ".iqtree" ? "iqtree" : "newick",
			newick: "",
			leafCount: 0,
			internalNodeCount: 0,
			branchCount: 0,
			maxDepth: 0,
			leafExamples: [],
			supportLabels: [],
			truncated: false,
		};
	}
	const root = parseNewick(newick) as ParsedTreeBranch;
	const stats = summarizeTreeBranch(root);
	return {
		format: extension.toLowerCase() === ".iqtree" ? "iqtree" : "newick",
		newick,
		leafCount: stats.leafCount,
		internalNodeCount: stats.internalNodeCount,
		branchCount: stats.branchCount,
		maxDepth: stats.maxDepth,
		...(stats.totalBranchLength > 0 ? { totalBranchLength: Number(stats.totalBranchLength.toFixed(4)) } : {}),
		leafExamples: stats.leafExamples.slice(0, limit),
		supportLabels: stats.supportLabels.slice(0, limit),
		truncated: stats.leafExamples.length > limit || stats.supportLabels.length > limit,
	};
}

function summarizeTreeBranch(root: ParsedTreeBranch): {
	branchCount: number;
	internalNodeCount: number;
	leafCount: number;
	leafExamples: string[];
	maxDepth: number;
	supportLabels: string[];
	totalBranchLength: number;
} {
	const leafExamples: string[] = [];
	const supportLabels: string[] = [];
	let branchCount = 0;
	let internalNodeCount = 0;
	let leafCount = 0;
	let maxDepth = 0;
	let totalBranchLength = 0;
	const visit = (branch: ParsedTreeBranch, depth: number) => {
		const children = branch.children ?? [];
		maxDepth = Math.max(maxDepth, depth);
		if (branch.length && Number.isFinite(branch.length)) totalBranchLength += Math.abs(branch.length);
		if (depth > 0) branchCount += 1;
		if (children.length) {
			internalNodeCount += 1;
			if (branch.id) supportLabels.push(branch.id);
			for (const child of children) visit(child, depth + 1);
			return;
		}
		leafCount += 1;
		if (branch.id) leafExamples.push(branch.id);
	};
	visit(root, 0);
	return { branchCount, internalNodeCount, leafCount, leafExamples, maxDepth, supportLabels, totalBranchLength };
}

function parsePdbPreview(content: string): StructurePreview {
	const chains = new Set<string>();
	const residues = new Set<string>();
	const elements = new Map<string, number>();
	let atomCount = 0;
	let modelCount = 0;
	for (const line of content.split(/\r?\n/)) {
		if (line.startsWith("MODEL")) modelCount += 1;
		if (!line.startsWith("ATOM") && !line.startsWith("HETATM")) continue;
		atomCount += 1;
		const chain = line.slice(21, 22).trim() || "_";
		const residue = `${chain}:${line.slice(17, 20).trim()}:${line.slice(22, 27).trim()}`;
		const element = line.slice(76, 78).trim() || line.slice(12, 14).trim().replace(/[^A-Za-z]/g, "").slice(0, 1) || "?";
		chains.add(chain);
		residues.add(residue);
		elements.set(element, (elements.get(element) ?? 0) + 1);
	}
	return {
		format: "pdb",
		atomCount,
		chainCount: chains.size,
		residueCount: residues.size,
		modelCount: modelCount || (atomCount ? 1 : 0),
		chains: [...chains].slice(0, 12),
		elements: sortedCounts(elements),
	};
}

function parseMmcifPreview(content: string): StructurePreview {
	const chains = new Set<string>();
	const residues = new Set<string>();
	const elements = new Map<string, number>();
	let atomCount = 0;
	for (const line of content.split(/\r?\n/)) {
		if (!line.startsWith("ATOM") && !line.startsWith("HETATM")) continue;
		atomCount += 1;
		const parts = line.trim().split(/\s+/);
		const element = parts[2] || parts[3] || "?";
		const chain = parts[6] || parts[5] || "_";
		const residue = `${chain}:${parts[5] || parts[4] || "res"}:${parts[8] || atomCount}`;
		chains.add(chain);
		residues.add(residue);
		elements.set(element, (elements.get(element) ?? 0) + 1);
	}
	return {
		format: "mmcif",
		atomCount,
		chainCount: chains.size,
		residueCount: residues.size,
		modelCount: atomCount ? 1 : 0,
		chains: [...chains].slice(0, 12),
		elements: sortedCounts(elements),
	};
}

function sortedCounts(counts: Map<string, number>): Array<{ element: string; count: number }> {
	return [...counts.entries()]
		.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
		.slice(0, 10)
		.map(([element, count]) => ({ element, count }));
}

export function artifactVersionsForPath(state: WorkbenchState, path: string): WorkbenchArtifactVersion[] {
	return state.artifactVersions
		.filter((version) => version.artifactPath === path)
		.slice()
		.sort((left, right) => right.versionNumber - left.versionNumber);
}

export function artifactExecutionsForPath(state: WorkbenchState, path: string): WorkbenchExecutionRecord[] {
	return state.execution
		.filter((record) => record.outputPaths.includes(path) || record.inputPaths.includes(path))
		.slice()
		.sort((left, right) => right.createdAtMs - left.createdAtMs);
}

export function artifactChecksForPath(state: WorkbenchState, path: string): WorkbenchVerificationCheck[] {
	return state.checks
		.filter((check) => check.evidencePaths.includes(path))
		.slice()
		.sort((left, right) => right.createdAtMs - left.createdAtMs);
}

export function artifactClaimsForPath(state: WorkbenchState, path: string): WorkbenchResearchClaim[] {
	return (state.claims ?? [])
		.filter((claim) => claim.evidencePaths.includes(path) || claim.sourcePath === path)
		.slice()
		.sort((left, right) => {
			const leftScore = left.status === "failed" ? 3 : left.status === "unverified" ? 2 : 1;
			const rightScore = right.status === "failed" ? 3 : right.status === "unverified" ? 2 : 1;
			return rightScore - leftScore || right.createdAtMs - left.createdAtMs || left.claim.localeCompare(right.claim);
		});
}
