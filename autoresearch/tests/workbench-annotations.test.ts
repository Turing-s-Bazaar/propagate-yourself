import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	readWorkbenchArtifactAnnotations,
	removeWorkbenchArtifactAnnotation,
	upsertWorkbenchArtifactAnnotation,
} from "../src/workbench/annotations.js";
import { buildWorkbenchRpcPrompt } from "../src/workbench/chat-runtime.js";
import { workbenchDataPath } from "../src/workbench/data-root.js";
import { readWorkbenchPdfText } from "../src/workbench/pdf-text.js";
import { buildWorkbenchState } from "../src/workbench/scan.js";
import { startWorkbenchServer } from "../src/workbench/server.js";

function minimalPdf(text: string): Buffer {
	const escaped = text.replace(/[\\()]/g, "\\$&");
	const stream = `BT\n/F1 24 Tf\n72 720 Td\n(${escaped}) Tj\nET`;
	const objects = [
		"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
		"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
		"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
		"4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
		`5 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream\nendobj\n`,
	];
	let body = "%PDF-1.4\n";
	const offsets: number[] = [];
	for (const object of objects) {
		offsets.push(Buffer.byteLength(body));
		body += object;
	}
	const xrefOffset = Buffer.byteLength(body);
	const xrefRows = [
		"0000000000 65535 f ",
		...offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
	].join("\n");
	return Buffer.from(`${body}xref\n0 6\n${xrefRows}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
}

function makeWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-annotations-"));
	mkdirSync(join(root, "outputs"), { recursive: true });
	mkdirSync(join(root, "papers"), { recursive: true });
	mkdirSync(join(root, "notes"), { recursive: true });
	writeFileSync(join(root, "outputs", "scaling-laws.md"), "# Scaling Laws Brief\n\nCited body.\n");
	writeFileSync(join(root, "outputs", "figure.png"), "fake image bytes");
	writeFileSync(join(root, "papers", "selection.pdf"), minimalPdf("TP53 responder signal"));
	return root;
}

function promptFixture(root: string, message: string) {
	return {
		workingDir: root,
		message,
		session: {
			id: "scaling-laws",
			projectId: "workspace",
			title: "Scaling laws",
			createdAt: "2026-07-01T00:00:00.000Z",
			updatedAt: "2026-07-01T00:00:00.000Z",
			status: "complete" as const,
			config: {
				delegation: false,
				autoReview: false,
				memory: false,
				specialist: "None",
				compute: "local" as const,
			},
			piSession: {
				id: "feynman-workbench-scaling-laws",
				status: "active" as const,
				messageCount: 0,
				userMessages: 0,
				assistantMessages: 0,
				toolResults: 0,
				toolCalls: 0,
				bashExecutions: 0,
				customMessages: 0,
				branchCount: 0,
				timeline: [],
				tools: [],
			},
			attachments: [],
			messages: [],
		},
	};
}

test("workbench artifact annotations persist into state and versions", () => {
	const root = makeWorkspace();
	try {
		const annotations = upsertWorkbenchArtifactAnnotation(root, {
			artifactPath: "outputs/scaling-laws.md",
			body: "Tighten the claim around compute scaling before revision.",
			kind: "revision",
			anchorText: "Cited body.",
			projectId: "workspace",
			runSlug: "scaling-laws",
			sessionId: "scaling-laws",
		});
		assert.equal(annotations.length, 1);
		assert.equal(annotations[0]?.labelIndex, 1);
		assert.equal(annotations[0]?.targetKind, "artifact");
		assert.equal(annotations[0]?.targetKey, "outputs/scaling-laws.md");
		assert.match(readFileSync(workbenchDataPath(root, "annotations.json"), "utf8"), /workbenchAnnotations/);

		const state = buildWorkbenchState({ workingDir: root });
		const annotation = state.artifactAnnotations[0];
		assert.equal(annotation?.artifactPath, "outputs/scaling-laws.md");
		assert.match(annotation?.body ?? "", /compute scaling/);
		const version = state.artifactVersions.find((item) => item.artifactPath === "outputs/scaling-laws.md");
		assert.equal(version?.annotations.length, 1);
		assert.match(version?.annotations[0]?.anchorText ?? "", /Cited body/);

		const removed = removeWorkbenchArtifactAnnotation(root, annotation!.id);
		assert.equal(removed.length, 0);
		assert.equal(readWorkbenchArtifactAnnotations(root).length, 0);
		assert.throws(
			() => upsertWorkbenchArtifactAnnotation(root, {
				artifactPath: "../outside.md",
				body: "nope",
			}),
			/inside the workspace|limited to research artifacts/,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("buildWorkbenchRpcPrompt includes artifact annotations for revision turns", () => {
	const root = makeWorkspace();
	try {
		upsertWorkbenchArtifactAnnotation(root, {
			artifactPath: "outputs/scaling-laws.md",
			body: "Revise the paragraph so the benchmark caveat is explicit.",
			kind: "revision",
			anchorText: "Cited body.",
			projectId: "workspace",
			sessionId: "scaling-laws",
			runSlug: "scaling-laws",
		});
		const prompt = buildWorkbenchRpcPrompt(promptFixture(root, "revise outputs/scaling-laws.md"));
		assert.match(prompt, /Artifact annotations and requested refinements:/);
		assert.match(prompt, /outputs\/scaling-laws\.md #1 \(revision\)/);
		assert.match(prompt, /benchmark caveat is explicit/);
		assert.match(prompt, /Preserve provenance/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench artifact annotations preserve media region anchors for Pi prompts", () => {
	const root = makeWorkspace();
	try {
		const annotations = upsertWorkbenchArtifactAnnotation(root, {
			artifactPath: "outputs/figure.png",
			body: "Check whether the highlighted band should be labeled as the responder cluster.",
			kind: "revision",
			anchorKind: "region",
			anchorText: "Image region x=12.346%, y=20%, w=30%, h=15%",
			xPercent: 12.3456,
			yPercent: 20,
			widthPercent: 30,
			heightPercent: 15,
			pageNumber: 2,
			projectId: "workspace",
			sessionId: "scaling-laws",
			runSlug: "scaling-laws",
		});
		const annotation = annotations[0];
		assert.equal(annotation?.anchorKind, "region");
		assert.equal(annotation?.xPercent, 12.346);
		assert.equal(annotation?.pageNumber, 2);

		const prompt = buildWorkbenchRpcPrompt(promptFixture(root, "revise outputs/figure.png"));
		assert.match(prompt, /Anchor type: region/);
		assert.match(prompt, /Page: 2/);
		assert.match(prompt, /Coordinates: x=12\.35%, y=20%, width=30%, height=15%/);
		assert.match(prompt, /highlighted band/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench server mutates artifact annotations through the authenticated API", async () => {
	const root = makeWorkspace();
	const handle = await startWorkbenchServer({
		workingDir: root,
		version: "0.0.0-test",
		host: "127.0.0.1",
		port: 0,
		token: "test-token",
	});
	try {
		const headers = {
			"content-type": "application/json",
			cookie: "feynman_workbench=test-token",
		};
		const created = await fetch(`${handle.url}api/artifact/annotation`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				sessionId: "scaling-laws",
				projectId: "workspace",
				title: "Scaling laws",
				runSlug: "scaling-laws",
				artifactPath: "outputs/scaling-laws.md",
				kind: "revision",
				anchorKind: "text_selection",
				anchorText: "Cited body.",
				startOffset: 24,
				endOffset: 35,
				body: "Turn the caveat into a concrete revision.",
			}),
		});
		assert.equal(created.status, 200);
		const createdPayload = await created.json() as {
			annotations: Array<{ id: string; body: string; anchorKind?: string; startOffset?: number; endOffset?: number }>;
			state: {
				artifactAnnotations: Array<{ body: string; anchorKind?: string; startOffset?: number; endOffset?: number }>;
				artifactVersions: Array<{ artifactPath: string; annotations: Array<{ body: string }> }>;
			};
		};
		const id = createdPayload.annotations[0]?.id;
		assert.ok(id, "expected annotation id");
		assert.match(createdPayload.state.artifactAnnotations[0]?.body ?? "", /concrete revision/);
		assert.equal(createdPayload.state.artifactAnnotations[0]?.anchorKind, "text_selection");
		assert.equal(createdPayload.state.artifactAnnotations[0]?.startOffset, 24);
		assert.equal(createdPayload.state.artifactAnnotations[0]?.endOffset, 35);
		assert.match(
			createdPayload.state.artifactVersions.find((item) => item.artifactPath === "outputs/scaling-laws.md")?.annotations[0]?.body ?? "",
			/concrete revision/,
		);

		const removed = await fetch(`${handle.url}api/artifact/annotation`, {
			method: "POST",
			headers,
			body: JSON.stringify({ action: "remove", id }),
		});
		assert.equal(removed.status, 200);
		const removedPayload = await removed.json() as { state: { artifactAnnotations: unknown[] } };
		assert.equal(removedPayload.state.artifactAnnotations.length, 0);
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench extracts selectable PDF text and stores page line anchors", async () => {
	const root = makeWorkspace();
	const handle = await startWorkbenchServer({
		workingDir: root,
		version: "0.0.0-test",
		host: "127.0.0.1",
		port: 0,
		token: "test-token",
	});
	try {
		const preview = await readWorkbenchPdfText(root, "papers/selection.pdf");
		assert.equal(preview.pages[0]?.pageNumber, 1);
		assert.match(preview.content, /TP53 responder signal/);
		assert.equal(preview.pages[0]?.lines[0]?.lineNumber, 1);

		const headers = {
			"content-type": "application/json",
			cookie: "feynman_workbench=test-token",
		};
		const pdfResponse = await fetch(`${handle.url}api/file/pdf-text?path=${encodeURIComponent("papers/selection.pdf")}`, {
			headers,
		});
		assert.equal(pdfResponse.status, 200);
		const pdfPayload = await pdfResponse.json() as { pages: Array<{ pageNumber: number; text: string }> };
		assert.equal(pdfPayload.pages[0]?.pageNumber, 1);
		assert.match(pdfPayload.pages[0]?.text ?? "", /TP53 responder signal/);

		const created = await fetch(`${handle.url}api/artifact/annotation`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				sessionId: "scaling-laws",
				projectId: "workspace",
				title: "Scaling laws",
				runSlug: "scaling-laws",
				artifactPath: "papers/selection.pdf",
				kind: "revision",
				anchorKind: "text_selection",
				anchorText: "TP53 responder signal",
				startOffset: 0,
				endOffset: 21,
				startLine: 1,
				endLine: 1,
				pageNumber: 1,
				selectionPrefix: "",
				xPercent: 8.5,
				yPercent: 12.25,
				widthPercent: 34,
				heightPercent: 6.5,
				rects: [
					{ xPercent: 8.5, yPercent: 12.25, widthPercent: 18.25, heightPercent: 3.1 },
					{ xPercent: 8.5, yPercent: 15.55, widthPercent: 34, heightPercent: 3.2 },
				],
				body: "Check that the selected PDF claim is supported by the cited experiment.",
			}),
		});
		assert.equal(created.status, 200);
		const createdPayload = await created.json() as {
			state: {
				artifactAnnotations: Array<{
					pageNumber?: number;
					startLine?: number;
					anchorText?: string;
					xPercent?: number;
					yPercent?: number;
					widthPercent?: number;
					heightPercent?: number;
					rects?: Array<{ xPercent: number; yPercent: number; widthPercent: number; heightPercent: number }>;
				}>;
			};
		};
		assert.equal(createdPayload.state.artifactAnnotations[0]?.pageNumber, 1);
		assert.equal(createdPayload.state.artifactAnnotations[0]?.startLine, 1);
		assert.match(createdPayload.state.artifactAnnotations[0]?.anchorText ?? "", /TP53/);
		assert.equal(createdPayload.state.artifactAnnotations[0]?.xPercent, 8.5);
		assert.equal(createdPayload.state.artifactAnnotations[0]?.yPercent, 12.25);
		assert.equal(createdPayload.state.artifactAnnotations[0]?.widthPercent, 34);
		assert.equal(createdPayload.state.artifactAnnotations[0]?.heightPercent, 6.5);
		assert.equal(createdPayload.state.artifactAnnotations[0]?.rects?.length, 2);
		assert.deepEqual(createdPayload.state.artifactAnnotations[0]?.rects?.[0], {
			xPercent: 8.5,
			yPercent: 12.25,
			widthPercent: 18.25,
			heightPercent: 3.1,
		});

		const prompt = buildWorkbenchRpcPrompt(promptFixture(root, "review the PDF selection"));
		assert.match(prompt, /Anchor type: text_selection/);
		assert.match(prompt, /Page: 1/);
		assert.match(prompt, /Lines: 1-1/);
		assert.match(prompt, /Coordinates: x=8\.5%, y=12\.25%, width=34%, height=6\.5%/);
		assert.match(prompt, /Rectangles: x=8\.5%, y=12\.25%, width=18\.25%, height=3\.1%; x=8\.5%, y=15\.55%, width=34%, height=3\.2%/);
		assert.match(prompt, /selected PDF claim/);
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});
