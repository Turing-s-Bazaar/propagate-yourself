import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";

import { artifactDownloadUrl } from "./artifacts.js";
import {
	mediaSelectionFromPoints,
	type ArtifactAnchorSelection,
	type ArtifactSelectionRect,
} from "./artifact-refinement.js";
import type { WorkbenchArtifact, WorkbenchArtifactAnnotation } from "./types.js";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type PdfMediaAnnotationDraft = {
	artifactPath: string;
	mediaKind: "image" | "pdf";
	pageNumber?: number;
	startX: number;
	startY: number;
	endX?: number;
	endY?: number;
};

function cx(...values: Array<string | false | null | undefined>): string {
	return values.filter(Boolean).join(" ");
}

function clampPercent(value: number): number {
	return Math.round(Math.min(100, Math.max(0, value)) * 1000) / 1000;
}

function elementForNode(node: Node | null): Element | null {
	if (!node) return null;
	return node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
}

function pageForSelectionNode(node: Node | null): HTMLElement | null {
	return elementForNode(node)?.closest<HTMLElement>("[data-pdf-page-number]") ?? null;
}

function rectsFromClientRects(rectList: DOMRectList, pageRect: DOMRect): ArtifactSelectionRect[] {
	return Array.from(rectList).map((rect) => {
		const left = Math.max(rect.left, pageRect.left);
		const top = Math.max(rect.top, pageRect.top);
		const right = Math.min(rect.right, pageRect.right);
		const bottom = Math.min(rect.bottom, pageRect.bottom);
		const width = right - left;
		const height = bottom - top;
		if (width <= 0 || height <= 0 || !pageRect.width || !pageRect.height) return null;
		return {
			xPercent: clampPercent(((left - pageRect.left) / pageRect.width) * 100),
			yPercent: clampPercent(((top - pageRect.top) / pageRect.height) * 100),
			widthPercent: clampPercent((width / pageRect.width) * 100),
			heightPercent: clampPercent((height / pageRect.height) * 100),
		};
	}).filter((rect): rect is ArtifactSelectionRect => Boolean(rect)).slice(0, 32);
}

function boundsForRects(rects: ArtifactSelectionRect[]): ArtifactSelectionRect | null {
	if (!rects.length) return null;
	const left = Math.min(...rects.map((rect) => rect.xPercent));
	const top = Math.min(...rects.map((rect) => rect.yPercent));
	const right = Math.max(...rects.map((rect) => rect.xPercent + rect.widthPercent));
	const bottom = Math.max(...rects.map((rect) => rect.yPercent + rect.heightPercent));
	return {
		xPercent: clampPercent(left),
		yPercent: clampPercent(top),
		widthPercent: clampPercent(right - left),
		heightPercent: clampPercent(bottom - top),
	};
}

function selectionPrefix(pageElement: HTMLElement, range: Range): string | undefined {
	const textLayer = pageElement.querySelector(".pdf-text-layer");
	if (!textLayer) return undefined;
	try {
		const prefixRange = document.createRange();
		prefixRange.selectNodeContents(textLayer);
		prefixRange.setEnd(range.startContainer, range.startOffset);
		const prefix = prefixRange.toString().replace(/\s+/g, " ").slice(-80).trim();
		prefixRange.detach();
		return prefix || undefined;
	} catch {
		return undefined;
	}
}

function lineRangeForSelection(pageElement: HTMLElement, range: Range): { startLine?: number; endLine?: number } {
	const spans = Array.from(pageElement.querySelectorAll<HTMLElement>(".pdf-text-layer span"))
		.map((span) => ({ span, rect: span.getBoundingClientRect() }))
		.filter((item) => item.rect.width > 0 && item.rect.height > 0)
		.sort((left, right) => Math.abs(left.rect.top - right.rect.top) > 2
			? left.rect.top - right.rect.top
			: left.rect.left - right.rect.left);
	let currentTop: number | undefined;
	let lineNumber = 0;
	let startLine: number | undefined;
	let endLine: number | undefined;
	for (const { span, rect } of spans) {
		if (currentTop === undefined || Math.abs(rect.top - currentTop) > Math.max(2, rect.height * 0.55)) {
			lineNumber += 1;
			currentTop = rect.top;
		}
		let intersects = false;
		try {
			intersects = range.intersectsNode(span);
		} catch {
			intersects = false;
		}
		if (intersects) {
			startLine = startLine ?? lineNumber;
			endLine = lineNumber;
		}
	}
	return { startLine, endLine };
}

function pointForEvent(event: MouseEvent<HTMLDivElement>): { x: number; y: number } | null {
	const rect = event.currentTarget.getBoundingClientRect();
	if (!rect.width || !rect.height) return null;
	return {
		x: ((event.clientX - rect.left) / rect.width) * 100,
		y: ((event.clientY - rect.top) / rect.height) * 100,
	};
}

function annotationRects(annotation: WorkbenchArtifactAnnotation): ArtifactSelectionRect[] {
	if (annotation.rects?.length) return annotation.rects;
	if (
		typeof annotation.xPercent === "number" &&
		typeof annotation.yPercent === "number" &&
		typeof annotation.widthPercent === "number" &&
		typeof annotation.heightPercent === "number"
	) {
		return [{
			xPercent: annotation.xPercent,
			yPercent: annotation.yPercent,
			widthPercent: annotation.widthPercent,
			heightPercent: annotation.heightPercent,
		}];
	}
	return [];
}

function annotationTitle(annotation: WorkbenchArtifactAnnotation): string {
	return [
		`#${annotation.labelIndex}`,
		annotation.anchorKind || "annotation",
		annotation.pageNumber ? `page ${annotation.pageNumber}` : "",
		annotation.body,
	].filter(Boolean).join(" / ");
}

function PdfAnnotationMarker({ annotation }: { annotation: WorkbenchArtifactAnnotation }) {
	if (typeof annotation.xPercent !== "number" || typeof annotation.yPercent !== "number") return null;
	const title = annotationTitle(annotation);
	if (annotation.anchorKind === "region") {
		return (
			<div
				className="media-annotation-region"
				style={{
					left: `${annotation.xPercent}%`,
					top: `${annotation.yPercent}%`,
					width: `${Math.max(1.2, annotation.widthPercent ?? 3)}%`,
					height: `${Math.max(1.2, annotation.heightPercent ?? 3)}%`,
				}}
				title={title}
			>
				<span>#{annotation.labelIndex}</span>
			</div>
		);
	}
	return (
		<span className="media-annotation-point" style={{ left: `${annotation.xPercent}%`, top: `${annotation.yPercent}%` }} title={title}>
			#{annotation.labelIndex}
		</span>
	);
}

function PdfDraftMarker({ selection }: { selection: ArtifactAnchorSelection }) {
	if (selection.anchorKind === "text_selection") return null;
	if (selection.anchorKind === "region") {
		return (
			<div
				className="media-annotation-region draft"
				style={{
					left: `${selection.xPercent}%`,
					top: `${selection.yPercent}%`,
					width: `${Math.max(1.2, selection.widthPercent ?? 3)}%`,
					height: `${Math.max(1.2, selection.heightPercent ?? 3)}%`,
				}}
			>
				<span>draft</span>
			</div>
		);
	}
	return (
		<span className="media-annotation-point draft" style={{ left: `${selection.xPercent}%`, top: `${selection.yPercent}%` }}>
			draft
		</span>
	);
}

function PdfTextHighlights({ annotations }: { annotations: WorkbenchArtifactAnnotation[] }) {
	return (
		<div className="pdf-text-highlights" aria-hidden>
			{annotations.flatMap((annotation) =>
				annotationRects(annotation).map((rect, index) => (
					<div
						className="pdf-text-highlight"
						key={`${annotation.id}-${index}`}
						style={{
							left: `${rect.xPercent}%`,
							top: `${rect.yPercent}%`,
							width: `${rect.widthPercent}%`,
							height: `${rect.heightPercent}%`,
						}}
						title={annotationTitle(annotation)}
					>
						{index === 0 ? <span>#{annotation.labelIndex}</span> : null}
					</div>
				))
			)}
		</div>
	);
}

function PdfRenderedPage({
	active,
	annotations,
	draft,
	pageNumber,
	pageWidth,
	pdf,
	artifactPath,
	onDraft,
	onMode,
	onSelection,
}: {
	active: boolean;
	annotations: WorkbenchArtifactAnnotation[];
	draft: PdfMediaAnnotationDraft | null;
	pageNumber: number;
	pageWidth: number;
	pdf: PDFDocumentProxy;
	artifactPath: string;
	onDraft: (draft: PdfMediaAnnotationDraft | null) => void;
	onMode: (artifactPath: string | null) => void;
	onSelection: (selection: ArtifactAnchorSelection) => void;
}) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const textLayerRef = useRef<HTMLDivElement | null>(null);
	const [size, setSize] = useState<{ width: number; height: number } | null>(null);
	const [status, setStatus] = useState("Rendering page...");
	const savedMediaAnnotations = annotations.filter((annotation) =>
		(annotation.anchorKind === "point" || annotation.anchorKind === "region") &&
		annotation.pageNumber === pageNumber
	);
	const savedTextAnnotations = annotations.filter((annotation) =>
		annotation.anchorKind === "text_selection" &&
		annotation.pageNumber === pageNumber &&
		(annotation.rects?.length || (typeof annotation.xPercent === "number" && typeof annotation.yPercent === "number"))
	);
	const currentDraft = draft?.artifactPath === artifactPath && draft.mediaKind === "pdf" && draft.pageNumber === pageNumber ? draft : null;
	const draftSelection = currentDraft && typeof currentDraft.endX === "number" && typeof currentDraft.endY === "number"
		? mediaSelectionFromPoints({
			endX: currentDraft.endX,
			endY: currentDraft.endY,
			mediaKind: "pdf",
			pageNumber,
			startX: currentDraft.startX,
			startY: currentDraft.startY,
		})
		: null;

	useEffect(() => {
		let cancelled = false;
		let renderTask: RenderTask | null = null;
		let textLayer: TextLayer | null = null;

		async function renderPage() {
			const canvas = canvasRef.current;
			const textLayerElement = textLayerRef.current;
			if (!canvas || !textLayerElement) return;
			setStatus("Rendering page...");
			try {
				const page: PDFPageProxy = await pdf.getPage(pageNumber);
				if (cancelled) return;
				const unscaledViewport = page.getViewport({ scale: 1 });
				const scale = Math.max(0.2, pageWidth / unscaledViewport.width);
				const viewport = page.getViewport({ scale });
				const outputScale = window.devicePixelRatio || 1;
				const context = canvas.getContext("2d");
				if (!context) throw new Error("Canvas rendering is unavailable.");
				canvas.width = Math.floor(viewport.width * outputScale);
				canvas.height = Math.floor(viewport.height * outputScale);
				canvas.style.width = `${Math.floor(viewport.width)}px`;
				canvas.style.height = `${Math.floor(viewport.height)}px`;
				textLayerElement.innerHTML = "";
				textLayerElement.style.width = `${Math.floor(viewport.width)}px`;
				textLayerElement.style.height = `${Math.floor(viewport.height)}px`;
				setSize({ width: viewport.width, height: viewport.height });
				renderTask = page.render({
					canvas,
					canvasContext: context,
					transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
					viewport,
				});
				const textContent = await page.getTextContent();
				if (cancelled) return;
				textLayer = new TextLayer({
					container: textLayerElement,
					textContentSource: textContent,
					viewport,
				});
				await Promise.all([renderTask.promise, textLayer.render()]);
				if (!cancelled) setStatus("Page ready");
			} catch (error) {
				if (!cancelled) setStatus(error instanceof Error ? error.message : String(error));
			}
		}

		void renderPage();
		return () => {
			cancelled = true;
			renderTask?.cancel();
			textLayer?.cancel();
		};
	}, [pageNumber, pageWidth, pdf]);

	const begin = (event: MouseEvent<HTMLDivElement>) => {
		if (!active) return;
		const point = pointForEvent(event);
		if (!point) return;
		event.preventDefault();
		event.stopPropagation();
		onDraft({
			artifactPath,
			mediaKind: "pdf",
			pageNumber,
			startX: point.x,
			startY: point.y,
			endX: point.x,
			endY: point.y,
		});
	};
	const move = (event: MouseEvent<HTMLDivElement>) => {
		if (!active || !currentDraft) return;
		const point = pointForEvent(event);
		if (!point) return;
		onDraft({ ...currentDraft, endX: point.x, endY: point.y });
	};
	const finish = (event: MouseEvent<HTMLDivElement>) => {
		if (!active || !currentDraft) return;
		const point = pointForEvent(event);
		if (!point) return;
		event.preventDefault();
		event.stopPropagation();
		const selection = mediaSelectionFromPoints({ ...currentDraft, endX: point.x, endY: point.y });
		onDraft(null);
		onMode(null);
		if (selection) onSelection(selection);
	};

	return (
		<section
			className="pdf-rendered-page"
			data-pdf-page-number={pageNumber}
			style={size ? { width: `${Math.floor(size.width)}px`, minHeight: `${Math.floor(size.height)}px` } : { width: `${Math.floor(pageWidth)}px` }}
			aria-label={`PDF page ${pageNumber}`}
		>
			<canvas ref={canvasRef} className="pdf-page-canvas" />
			<div ref={textLayerRef} className="textLayer pdf-text-layer" />
			<PdfTextHighlights annotations={savedTextAnnotations} />
			<div
				className={cx("pdf-page-region-overlay", active && "active")}
				onMouseDown={begin}
				onMouseMove={move}
				onMouseUp={finish}
			>
				{savedMediaAnnotations.map((annotation) => <PdfAnnotationMarker annotation={annotation} key={annotation.id} />)}
				{draftSelection ? <PdfDraftMarker selection={draftSelection} /> : null}
			</div>
			<span className="pdf-rendered-page-label">Page {pageNumber}</span>
			{status === "Page ready" ? null : <span className="pdf-render-status">{status}</span>}
		</section>
	);
}

export function PdfArtifactPreview({
	annotations,
	artifact,
	draft,
	modePath,
	onDraft,
	onMode,
	onSelection,
}: {
	annotations: WorkbenchArtifactAnnotation[];
	artifact: WorkbenchArtifact;
	draft: PdfMediaAnnotationDraft | null;
	modePath: string | null;
	onDraft: (draft: PdfMediaAnnotationDraft | null) => void;
	onMode: (artifactPath: string | null) => void;
	onSelection: (selection: ArtifactAnchorSelection) => void;
}) {
	const rootRef = useRef<HTMLDivElement | null>(null);
	const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
	const [loadStatus, setLoadStatus] = useState("Loading PDF...");
	const [pageWidth, setPageWidth] = useState(720);
	const active = modePath === artifact.path;
	const pdfAnnotations = annotations.filter((annotation) => annotation.pageNumber);
	const pageNumbers = useMemo(() => Array.from({ length: pdf?.numPages ?? 0 }, (_, index) => index + 1), [pdf?.numPages]);

	useEffect(() => {
		const root = rootRef.current;
		if (!root) return;
		const updateWidth = () => {
			const width = Math.max(320, Math.min(860, root.clientWidth - 28));
			setPageWidth(width);
		};
		updateWidth();
		const observer = new ResizeObserver(updateWidth);
		observer.observe(root);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		let cancelled = false;
		const loadingTask = getDocument({ url: artifactDownloadUrl(artifact.path) });
		setPdf(null);
		setLoadStatus("Loading PDF...");
		loadingTask.promise.then((document) => {
			if (cancelled) {
				void document.cleanup();
				return;
			}
			setPdf(document);
			setLoadStatus("");
		}).catch((error: unknown) => {
			if (!cancelled) setLoadStatus(error instanceof Error ? error.message : String(error));
		});
		return () => {
			cancelled = true;
			void loadingTask.destroy();
		};
	}, [artifact.path]);

	function captureTextSelection() {
		if (active) return;
		const root = rootRef.current;
		const selection = window.getSelection();
		if (!root || !selection || selection.isCollapsed || selection.rangeCount === 0) return;
		const anchorPage = pageForSelectionNode(selection.anchorNode);
		const focusPage = pageForSelectionNode(selection.focusNode);
		if (!anchorPage || !focusPage || anchorPage !== focusPage || !root.contains(anchorPage)) return;
		const text = selection.toString().replace(/\s+/g, " ").trim().slice(0, 2_000);
		if (!text) return;
		const range = selection.getRangeAt(0);
		const pageRect = anchorPage.getBoundingClientRect();
		const rects = rectsFromClientRects(range.getClientRects(), pageRect);
		const bounds = boundsForRects(rects);
		if (!bounds) return;
		const pageNumber = Number(anchorPage.dataset.pdfPageNumber);
		const lineRange = lineRangeForSelection(anchorPage, range);
		onSelection({
			anchorKind: "text_selection",
			selectedText: text,
			pageNumber: Number.isFinite(pageNumber) ? pageNumber : undefined,
			startLine: lineRange.startLine,
			endLine: lineRange.endLine,
			selectionPrefix: selectionPrefix(anchorPage, range),
			xPercent: bounds.xPercent,
			yPercent: bounds.yPercent,
			widthPercent: bounds.widthPercent,
			heightPercent: bounds.heightPercent,
			rects,
		});
	}

	return (
		<div className={cx("artifact-media-preview", "pdf-artifact-preview", active && "annotating")} ref={rootRef}>
			<header className="media-annotation-toolbar">
				<div>
					<strong>{artifact.name}</strong>
					<span>PDF / {pdfAnnotations.length} annotation{pdfAnnotations.length === 1 ? "" : "s"}</span>
				</div>
				<button
					type="button"
					className={cx(active && "active")}
					aria-pressed={active}
					onClick={() => {
						onDraft(null);
						onMode(active ? null : artifact.path);
					}}
				>
					Annotate
				</button>
			</header>
			<div className="pdf-rendered-scroll" onMouseUp={() => window.requestAnimationFrame(captureTextSelection)}>
				{pdf ? pageNumbers.map((pageNumber) => (
					<PdfRenderedPage
						active={active}
						annotations={annotations}
						artifactPath={artifact.path}
						draft={draft}
						key={`${artifact.path}-${pageNumber}`}
						onDraft={onDraft}
						onMode={onMode}
						onSelection={onSelection}
						pageNumber={pageNumber}
						pageWidth={pageWidth}
						pdf={pdf}
					/>
				)) : <div className="panel-empty">{loadStatus}</div>}
			</div>
		</div>
	);
}
