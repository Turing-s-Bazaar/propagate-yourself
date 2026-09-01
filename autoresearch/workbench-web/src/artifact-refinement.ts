import type { WorkbenchArtifactAnnotation } from "./types.js";

export type ArtifactRefinementMode = "ask" | "edit";
export type ArtifactRefinementPhase = "applying" | "applied" | "input" | "loading" | "suggestion";
export type ArtifactRefinementSource = "fallback" | "model";

export type ArtifactSelectionRect = {
	xPercent: number;
	yPercent: number;
	widthPercent: number;
	heightPercent: number;
};

export type ArtifactTextSelection = {
	anchorKind: "text_selection";
	selectedText: string;
	startOffset?: number;
	endOffset?: number;
	startLine?: number;
	endLine?: number;
	pageNumber?: number;
	selectionPrefix?: string;
	xPercent?: number;
	yPercent?: number;
	widthPercent?: number;
	heightPercent?: number;
	rects?: ArtifactSelectionRect[];
};

export type ArtifactMediaSelection = {
	anchorKind: "point" | "region";
	mediaKind: "image" | "pdf";
	selectedText: string;
	xPercent: number;
	yPercent: number;
	widthPercent?: number;
	heightPercent?: number;
	pageNumber?: number;
};

export type ArtifactAnchorSelection = ArtifactMediaSelection | ArtifactTextSelection;

export type ArtifactRefinementSuggestion = {
	artifactPath: string;
	mode: ArtifactRefinementMode;
	selectedText: string;
	instruction: string;
	suggestion: string;
	source: ArtifactRefinementSource;
};

export type WordDiffPart = {
	type: "add" | "delete" | "equal";
	text: string;
};

const SELECTION_PREFIX_CHARS = 80;
const MIN_REGION_PERCENT = 1.2;

function normalizeSelectedText(value: string): string {
	return value.replace(/\r\n/g, "\n").trim();
}

function clampPercent(value: number | undefined): number | undefined {
	if (value === undefined || !Number.isFinite(value)) return undefined;
	return Math.round(Math.min(100, Math.max(0, value)) * 1000) / 1000;
}

function formatPercent(value: number | undefined): string {
	const clamped = clampPercent(value);
	if (clamped === undefined) return "";
	return `${Number.isInteger(clamped) ? clamped.toFixed(0) : clamped.toFixed(1).replace(/\\.0$/, "")}%`;
}

export function artifactAnnotationsForPath(
	annotations: WorkbenchArtifactAnnotation[],
	artifactPath: string,
): WorkbenchArtifactAnnotation[] {
	return annotations
		.filter((annotation) => annotation.artifactPath === artifactPath)
		.slice()
		.sort((left, right) => right.updatedAtMs - left.updatedAtMs || right.labelIndex - left.labelIndex);
}

export function textSelectionFromOffsets(
	content: string,
	startOffset: number,
	endOffset: number,
): ArtifactTextSelection | null {
	if (!Number.isFinite(startOffset) || !Number.isFinite(endOffset)) return null;
	const start = Math.max(0, Math.floor(startOffset));
	const end = Math.max(start, Math.floor(endOffset));
	if (end <= start || end > content.length) return null;
	const selectedText = normalizeSelectedText(content.slice(start, end));
	if (!selectedText) return null;
	return {
		anchorKind: "text_selection",
		selectedText,
		startOffset: start,
		endOffset: end,
		selectionPrefix: content.slice(Math.max(0, start - SELECTION_PREFIX_CHARS), start),
	};
}

export function textSelectionFromSelectedText(content: string, selectedText: string): ArtifactTextSelection | null {
	const normalized = normalizeSelectedText(selectedText);
	if (!normalized) return null;
	const start = content.indexOf(normalized);
	if (start === -1) {
		return {
			anchorKind: "text_selection",
			selectedText: normalized,
		};
	}
	return textSelectionFromOffsets(content, start, start + normalized.length);
}

export function mediaSelectionFromPoints(input: {
	endX: number;
	endY: number;
	mediaKind: "image" | "pdf";
	pageNumber?: number;
	startX: number;
	startY: number;
}): ArtifactMediaSelection | null {
	const startX = clampPercent(input.startX);
	const startY = clampPercent(input.startY);
	const endX = clampPercent(input.endX);
	const endY = clampPercent(input.endY);
	if (startX === undefined || startY === undefined || endX === undefined || endY === undefined) return null;
	const left = Math.min(startX, endX);
	const top = Math.min(startY, endY);
	const width = Math.abs(endX - startX);
	const height = Math.abs(endY - startY);
	const isRegion = width >= 2 || height >= 2;
	const pageNumber = input.mediaKind === "pdf" ? Math.max(1, Math.floor(input.pageNumber ?? 1)) : undefined;
	if (isRegion) {
		const widthPercent = Math.max(MIN_REGION_PERCENT, clampPercent(width) ?? MIN_REGION_PERCENT);
		const heightPercent = Math.max(MIN_REGION_PERCENT, clampPercent(height) ?? MIN_REGION_PERCENT);
		const selectedText = `${input.mediaKind === "pdf" ? `PDF page ${pageNumber ?? 1}` : "Image"} region x=${formatPercent(left)}, y=${formatPercent(top)}, w=${formatPercent(widthPercent)}, h=${formatPercent(heightPercent)}`;
		return {
			anchorKind: "region",
			mediaKind: input.mediaKind,
			selectedText,
			xPercent: left,
			yPercent: top,
			widthPercent,
			heightPercent,
			...(pageNumber ? { pageNumber } : {}),
		};
	}
	const selectedText = `${input.mediaKind === "pdf" ? `PDF page ${pageNumber ?? 1}` : "Image"} point x=${formatPercent(endX)}, y=${formatPercent(endY)}`;
	return {
		anchorKind: "point",
		mediaKind: input.mediaKind,
		selectedText,
		xPercent: endX,
		yPercent: endY,
		...(pageNumber ? { pageNumber } : {}),
	};
}

export function annotationAnchorSummary(annotation: WorkbenchArtifactAnnotation): string {
	const parts = [
		annotation.anchorKind || "note",
		annotation.pageNumber ? `page ${annotation.pageNumber}` : "",
		typeof annotation.startLine === "number" ? `line ${annotation.startLine}${annotation.endLine && annotation.endLine !== annotation.startLine ? `-${annotation.endLine}` : ""}` : "",
		typeof annotation.startOffset === "number" && typeof annotation.endOffset === "number" ? `${annotation.startOffset}-${annotation.endOffset}` : "",
		typeof annotation.xPercent === "number" && typeof annotation.yPercent === "number"
			? `x=${formatPercent(annotation.xPercent)}, y=${formatPercent(annotation.yPercent)}${
				typeof annotation.widthPercent === "number" && typeof annotation.heightPercent === "number"
					? `, w=${formatPercent(annotation.widthPercent)}, h=${formatPercent(annotation.heightPercent)}`
					: ""
			}`
			: "",
		annotation.rects?.length ? `${annotation.rects.length} rect${annotation.rects.length === 1 ? "" : "s"}` : "",
	].filter(Boolean);
	return parts.join(" / ") || "artifact";
}

export function canSuggestArtifactRefinement(selection: ArtifactAnchorSelection): selection is ArtifactTextSelection {
	return selection.anchorKind === "text_selection" &&
		typeof selection.startOffset === "number" &&
		typeof selection.endOffset === "number";
}

export function refinementAnnotationBody(input: {
	artifactPath: string;
	body: string;
	projectId?: string;
	runSlug?: string;
	selection: ArtifactAnchorSelection;
	sessionId?: string;
}): Record<string, unknown> {
	const body: Record<string, unknown> = {
		artifactPath: input.artifactPath,
		body: input.body,
		kind: "revision",
		anchorKind: input.selection.anchorKind,
		anchorText: input.selection.selectedText,
		sessionId: input.sessionId,
		projectId: input.projectId,
		runSlug: input.runSlug,
	};
	if (input.selection.anchorKind === "text_selection") {
		if (input.selection.startOffset !== undefined) body.startOffset = input.selection.startOffset;
		if (input.selection.endOffset !== undefined) body.endOffset = input.selection.endOffset;
		if (input.selection.startLine !== undefined) body.startLine = input.selection.startLine;
		if (input.selection.endLine !== undefined) body.endLine = input.selection.endLine;
		if (input.selection.pageNumber !== undefined) body.pageNumber = input.selection.pageNumber;
		if (input.selection.selectionPrefix !== undefined) body.selectionPrefix = input.selection.selectionPrefix;
		if (input.selection.xPercent !== undefined) body.xPercent = input.selection.xPercent;
		if (input.selection.yPercent !== undefined) body.yPercent = input.selection.yPercent;
		if (input.selection.widthPercent !== undefined) body.widthPercent = input.selection.widthPercent;
		if (input.selection.heightPercent !== undefined) body.heightPercent = input.selection.heightPercent;
		if (input.selection.rects?.length) body.rects = input.selection.rects;
	} else {
		body.xPercent = input.selection.xPercent;
		body.yPercent = input.selection.yPercent;
		if (input.selection.widthPercent !== undefined) body.widthPercent = input.selection.widthPercent;
		if (input.selection.heightPercent !== undefined) body.heightPercent = input.selection.heightPercent;
		if (input.selection.pageNumber !== undefined) body.pageNumber = input.selection.pageNumber;
	}
	return body;
}

export function refinementSuggestBody(input: {
	artifactPath: string;
	currentIteration?: string;
	instruction: string;
	mode: ArtifactRefinementMode;
	projectId: string;
	selection: ArtifactTextSelection;
	sessionId: string;
	title: string;
}): Record<string, unknown> {
	return {
		artifactPath: input.artifactPath,
		currentIteration: input.currentIteration,
		instruction: input.instruction,
		mode: input.mode,
		projectId: input.projectId,
		selectedText: input.selection.selectedText,
		sessionId: input.sessionId,
		startOffset: input.selection.startOffset,
		endOffset: input.selection.endOffset,
		title: input.title,
	};
}

export function refinementApplyBody(input: {
	artifactPath: string;
	replacementText: string;
	selection: ArtifactTextSelection;
}): Record<string, unknown> {
	return {
		artifactPath: input.artifactPath,
		selectedText: input.selection.selectedText,
		replacementText: input.replacementText,
		startOffset: input.selection.startOffset,
		endOffset: input.selection.endOffset,
	};
}

export function wordDiffParts(oldText: string, newText: string): WordDiffPart[] {
	const oldTokens = oldText.match(/\s+|\S+/g) ?? [];
	const newTokens = newText.match(/\s+|\S+/g) ?? [];
	const rows = Array.from({ length: oldTokens.length + 1 }, () => Array<number>(newTokens.length + 1).fill(0));
	for (let oldIndex = oldTokens.length - 1; oldIndex >= 0; oldIndex -= 1) {
		for (let newIndex = newTokens.length - 1; newIndex >= 0; newIndex -= 1) {
			rows[oldIndex]![newIndex] = oldTokens[oldIndex] === newTokens[newIndex]
				? rows[oldIndex + 1]![newIndex + 1]! + 1
				: Math.max(rows[oldIndex + 1]![newIndex]!, rows[oldIndex]![newIndex + 1]!);
		}
	}
	const parts: WordDiffPart[] = [];
	let oldIndex = 0;
	let newIndex = 0;
	while (oldIndex < oldTokens.length || newIndex < newTokens.length) {
		if (oldIndex < oldTokens.length && newIndex < newTokens.length && oldTokens[oldIndex] === newTokens[newIndex]) {
			parts.push({ type: "equal", text: oldTokens[oldIndex]! });
			oldIndex += 1;
			newIndex += 1;
			continue;
		}
		if (
			newIndex < newTokens.length &&
			(oldIndex === oldTokens.length || rows[oldIndex]![newIndex + 1]! >= rows[oldIndex + 1]![newIndex]!)
		) {
			parts.push({ type: "add", text: newTokens[newIndex]! });
			newIndex += 1;
			continue;
		}
		if (oldIndex < oldTokens.length) {
			parts.push({ type: "delete", text: oldTokens[oldIndex]! });
			oldIndex += 1;
		}
	}
	return parts.reduce<WordDiffPart[]>((merged, part) => {
		const previous = merged.at(-1);
		if (previous && previous.type === part.type) previous.text += part.text;
		else merged.push({ ...part });
		return merged;
	}, []);
}
