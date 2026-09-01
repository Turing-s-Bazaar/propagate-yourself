import assert from "node:assert/strict";
import test from "node:test";

import {
	annotationAnchorSummary,
	artifactAnnotationsForPath,
	canSuggestArtifactRefinement,
	mediaSelectionFromPoints,
	refinementAnnotationBody,
	refinementApplyBody,
	refinementSuggestBody,
	textSelectionFromOffsets,
	textSelectionFromSelectedText,
	wordDiffParts,
	type ArtifactTextSelection,
} from "../workbench-web/src/artifact-refinement.js";
import type { WorkbenchArtifactAnnotation } from "../workbench-web/src/types.js";

test("React artifact refinement helpers mirror annotation and refinement API contracts", () => {
	const content = "# Result\n\nOriginal claim.\nSecond line.\n";
	const start = content.indexOf("Original");
	const selection = textSelectionFromOffsets(content, start, start + "Original claim.".length);
	assert.ok(selection);
	assert.equal(canSuggestArtifactRefinement(selection), true);
	assert.equal(selection.selectedText, "Original claim.");
	assert.equal(selection.startOffset, start);
	assert.equal(selection.endOffset, start + "Original claim.".length);
	assert.match(selection.selectionPrefix ?? "", /# Result/);

	const repeatedSelection = textSelectionFromSelectedText(content, "Second line.");
	assert.equal(repeatedSelection?.selectedText, "Second line.");

	assert.deepEqual(refinementAnnotationBody({
		artifactPath: "outputs/result.md",
		body: "Needs citation",
		projectId: "project-a",
		runSlug: "run-a",
		selection,
		sessionId: "session-a",
	}), {
		artifactPath: "outputs/result.md",
		body: "Needs citation",
		kind: "revision",
		anchorKind: "text_selection",
		anchorText: "Original claim.",
		startOffset: start,
		endOffset: start + "Original claim.".length,
		selectionPrefix: content.slice(0, start),
		sessionId: "session-a",
		projectId: "project-a",
		runSlug: "run-a",
	});
	assert.deepEqual(refinementSuggestBody({
		artifactPath: "outputs/result.md",
		currentIteration: "Old draft",
		instruction: "Make it precise",
		mode: "edit",
		projectId: "project-a",
		selection,
		sessionId: "session-a",
		title: "Result",
	}), {
		artifactPath: "outputs/result.md",
		currentIteration: "Old draft",
		instruction: "Make it precise",
		mode: "edit",
		projectId: "project-a",
		selectedText: "Original claim.",
		sessionId: "session-a",
		startOffset: start,
		endOffset: start + "Original claim.".length,
		title: "Result",
	});
	assert.deepEqual(refinementApplyBody({
		artifactPath: "outputs/result.md",
		replacementText: "Revised claim.",
		selection,
	}), {
		artifactPath: "outputs/result.md",
		selectedText: "Original claim.",
		replacementText: "Revised claim.",
		startOffset: start,
		endOffset: start + "Original claim.".length,
	});

	const annotations = [
		{
			id: "annotation-old",
			artifactPath: "outputs/result.md",
			targetKind: "artifact",
			targetKey: "outputs/result.md",
			labelIndex: 1,
			body: "Old",
			kind: "note",
			anchorKind: "text_selection",
			anchorText: "Old",
			startOffset: 2,
			endOffset: 5,
			createdAt: "2026-07-02T00:00:00.000Z",
			createdAtMs: 1,
			updatedAt: "2026-07-02T00:00:00.000Z",
			updatedAtMs: 1,
		},
		{
			id: "annotation-new",
			artifactPath: "outputs/result.md",
			targetKind: "artifact",
			targetKey: "outputs/result.md",
			labelIndex: 2,
			body: "New",
			kind: "revision",
			anchorKind: "text_selection",
			anchorText: "Original claim.",
			startOffset: start,
			endOffset: start + "Original claim.".length,
			createdAt: "2026-07-02T00:00:01.000Z",
			createdAtMs: 2,
			updatedAt: "2026-07-02T00:00:01.000Z",
			updatedAtMs: 2,
		},
		{
			id: "annotation-other",
			artifactPath: "outputs/other.md",
			targetKind: "artifact",
			targetKey: "outputs/other.md",
			labelIndex: 1,
			body: "Other",
			kind: "note",
			createdAt: "2026-07-02T00:00:02.000Z",
			createdAtMs: 3,
			updatedAt: "2026-07-02T00:00:02.000Z",
			updatedAtMs: 3,
		},
	] satisfies WorkbenchArtifactAnnotation[];

	assert.deepEqual(artifactAnnotationsForPath(annotations, "outputs/result.md").map((annotation) => annotation.id), [
		"annotation-new",
		"annotation-old",
	]);
	assert.equal(annotationAnchorSummary(annotations[1]!), `text_selection / ${start}-${start + "Original claim.".length}`);
	assert.deepEqual(wordDiffParts("Original claim.", "Revised claim.").map((part) => part.type), ["add", "delete", "equal"]);

	const imageRegion = mediaSelectionFromPoints({
		mediaKind: "image",
		startX: 12.3456,
		startY: 20,
		endX: 42.3456,
		endY: 35,
	});
	assert.ok(imageRegion);
	assert.equal(canSuggestArtifactRefinement(imageRegion), false);
	assert.deepEqual(imageRegion, {
		anchorKind: "region",
		mediaKind: "image",
		selectedText: "Image region x=12.3%, y=20%, w=30%, h=15%",
		xPercent: 12.346,
		yPercent: 20,
		widthPercent: 30,
		heightPercent: 15,
	});
	assert.deepEqual(refinementAnnotationBody({
		artifactPath: "outputs/figure.png",
		body: "Check highlighted band",
		projectId: "project-a",
		runSlug: "run-a",
		selection: imageRegion,
		sessionId: "session-a",
	}), {
		artifactPath: "outputs/figure.png",
		body: "Check highlighted band",
		kind: "revision",
		anchorKind: "region",
		anchorText: "Image region x=12.3%, y=20%, w=30%, h=15%",
		xPercent: 12.346,
		yPercent: 20,
		widthPercent: 30,
		heightPercent: 15,
		sessionId: "session-a",
		projectId: "project-a",
		runSlug: "run-a",
	});

	const pdfPoint = mediaSelectionFromPoints({
		mediaKind: "pdf",
		pageNumber: 2,
		startX: 50,
		startY: 51,
		endX: 50.5,
		endY: 51.5,
	});
	assert.equal(pdfPoint?.anchorKind, "point");
	assert.equal(pdfPoint?.selectedText, "PDF page 2 point x=50.5%, y=51.5%");
	assert.equal(pdfPoint?.pageNumber, 2);

	const pdfTextSelection = {
		anchorKind: "text_selection",
		selectedText: "TP53 responder signal",
		pageNumber: 2,
		startLine: 4,
		endLine: 5,
		selectionPrefix: "Previous paragraph",
		xPercent: 8.5,
		yPercent: 12.25,
		widthPercent: 34,
		heightPercent: 6.5,
		rects: [
			{ xPercent: 8.5, yPercent: 12.25, widthPercent: 18.25, heightPercent: 3.1 },
			{ xPercent: 8.5, yPercent: 15.55, widthPercent: 34, heightPercent: 3.2 },
		],
	} satisfies ArtifactTextSelection;
	assert.equal(canSuggestArtifactRefinement(pdfTextSelection), false);
	assert.deepEqual(refinementAnnotationBody({
		artifactPath: "papers/selection.pdf",
		body: "Check the selected claim",
		projectId: "project-a",
		runSlug: "run-a",
		selection: pdfTextSelection,
		sessionId: "session-a",
	}), {
		artifactPath: "papers/selection.pdf",
		body: "Check the selected claim",
		kind: "revision",
		anchorKind: "text_selection",
		anchorText: "TP53 responder signal",
		pageNumber: 2,
		startLine: 4,
		endLine: 5,
		selectionPrefix: "Previous paragraph",
		xPercent: 8.5,
		yPercent: 12.25,
		widthPercent: 34,
		heightPercent: 6.5,
		rects: [
			{ xPercent: 8.5, yPercent: 12.25, widthPercent: 18.25, heightPercent: 3.1 },
			{ xPercent: 8.5, yPercent: 15.55, widthPercent: 34, heightPercent: 3.2 },
		],
		sessionId: "session-a",
		projectId: "project-a",
		runSlug: "run-a",
	});
});
