import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";

import { categoryForArtifact, resolveWorkbenchPath } from "./scan.js";
import type { ArtifactCategory } from "./types.js";

const MAX_PDF_TEXT_BYTES = 16_000_000;
const MAX_PDF_TEXT_CHARS = 512_000;
const MAX_PDF_TEXT_PAGES = 80;

export type WorkbenchPdfTextLine = {
	lineNumber: number;
	text: string;
	startOffset: number;
	endOffset: number;
};

export type WorkbenchPdfTextPage = {
	pageNumber: number;
	text: string;
	lines: WorkbenchPdfTextLine[];
};

export type WorkbenchPdfTextPreview = {
	path: string;
	name: string;
	category: ArtifactCategory;
	sizeBytes: number;
	updatedAt: string;
	content: string;
	pages: WorkbenchPdfTextPage[];
	truncated: boolean;
};

type PdfTextItem = {
	str: string;
	transform?: unknown[];
};

function isPdfTextItem(value: unknown): value is PdfTextItem {
	return Boolean(value && typeof value === "object" && typeof (value as { str?: unknown }).str === "string");
}

function itemPosition(item: PdfTextItem): { x: number; y: number } {
	const transform = Array.isArray(item.transform) ? item.transform : [];
	return {
		x: typeof transform[4] === "number" && Number.isFinite(transform[4]) ? transform[4] : 0,
		y: typeof transform[5] === "number" && Number.isFinite(transform[5]) ? transform[5] : 0,
	};
}

function lineText(items: PdfTextItem[]): string {
	return items
		.map((item) => typeof item.str === "string" ? item.str : "")
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();
}

function linesFromTextItems(items: PdfTextItem[]): WorkbenchPdfTextLine[] {
	const groups: Array<{ y: number; items: Array<{ item: PdfTextItem; x: number; y: number }> }> = [];
	for (const entry of items.map((item) => ({ item, ...itemPosition(item) })).filter(({ item }) => item.str?.trim())) {
		const existing = groups.find((line) => Math.abs(line.y - entry.y) <= 2);
		if (existing) {
			existing.items.push(entry);
			existing.y = (existing.y + entry.y) / 2;
		} else {
			groups.push({ y: entry.y, items: [entry] });
		}
	}
	if (!groups.length) {
		const text = lineText(items);
		return text ? [{ lineNumber: 1, text, startOffset: 0, endOffset: text.length }] : [];
	}
	let offset = 0;
	return groups.sort((a, b) => b.y - a.y).map((group, index) => {
		const text = lineText(group.items.sort((a, b) => a.x - b.x).map((entry) => entry.item));
		const startOffset = offset;
		const endOffset = startOffset + text.length;
		offset = endOffset + 1;
		return { lineNumber: index + 1, text, startOffset, endOffset };
	}).filter((line) => line.text);
}

export async function readWorkbenchPdfText(workingDir: string, requestedPath: string): Promise<WorkbenchPdfTextPreview> {
	const { absPath, relPath } = resolveWorkbenchPath(workingDir, requestedPath);
	if (extname(relPath).toLowerCase() !== ".pdf") throw new Error("This artifact is not a PDF.");
	if (!existsSync(absPath)) throw new Error(`Artifact not found: ${relPath}`);
	const stat = statSync(absPath);
	if (!stat.isFile()) throw new Error(`Artifact is not a file: ${relPath}`);
	if (stat.size > MAX_PDF_TEXT_BYTES) {
		return {
			path: relPath,
			name: basename(relPath),
			category: categoryForArtifact(relPath),
			sizeBytes: stat.size,
			updatedAt: stat.mtime.toISOString(),
			content: "",
			pages: [],
			truncated: true,
		};
	}

	const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
	const loadingTask = pdfjs.getDocument({ data: new Uint8Array(readFileSync(absPath)), useSystemFonts: true });
	try {
		const pdf = await loadingTask.promise;
		const pages: WorkbenchPdfTextPage[] = [];
		let content = "";
		let truncated = pdf.numPages > MAX_PDF_TEXT_PAGES;
		for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, MAX_PDF_TEXT_PAGES); pageNumber += 1) {
			const page = await pdf.getPage(pageNumber);
			const textContent = await page.getTextContent();
			const items = (Array.isArray(textContent.items) ? textContent.items : []) as unknown[];
			const lines = linesFromTextItems(items.filter(isPdfTextItem));
			const pageText = lines.map((line) => line.text).join("\n");
			const nextContent = content ? `${content}\n\n${pageText}` : pageText;
			if (nextContent.length > MAX_PDF_TEXT_CHARS) {
				truncated = true;
				break;
			}
			content = nextContent;
			pages.push({ pageNumber, text: pageText, lines });
		}
		return {
			path: relPath,
			name: basename(relPath),
			category: categoryForArtifact(relPath),
			sizeBytes: stat.size,
			updatedAt: stat.mtime.toISOString(),
			content,
			pages,
			truncated,
		};
	} finally {
		await loadingTask.destroy?.();
	}
}
