import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { requestWorkbenchReview } from "../src/workbench/review.js";
import { buildWorkbenchState } from "../src/workbench/scan.js";
import { startWorkbenchServer } from "../src/workbench/server.js";

function makeSafetyFeedbackWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-safety-feedback-"));
	mkdirSync(join(root, "outputs"), { recursive: true });
	mkdirSync(join(root, "papers"), { recursive: true });
	mkdirSync(join(root, "notes"), { recursive: true });
	writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n");
	writeFileSync(join(root, "outputs", "safety-case.md"), "# Safety Case\n\nClaim: review this evidence.\n");
	return root;
}

test("workbench review requests create Claude-style safety feedback rows", async () => {
	const root = makeSafetyFeedbackWorkspace();
	try {
		const initialState = buildWorkbenchState({ workingDir: root, version: "0.0.0-test" });
		const executor = async (request: { message: string }) => ({ content: `reviewed ${request.message}` });

		await requestWorkbenchReview({
			workingDir: root,
			executor,
		}, {
			id: "safety-case",
			projectId: "workspace",
			title: "Safety case",
			runSlug: "safety-case",
		}, initialState);
		await requestWorkbenchReview({
			workingDir: root,
			executor,
		}, {
			id: "safety-case",
			projectId: "workspace",
			title: "Safety case",
			runSlug: "safety-case",
		}, buildWorkbenchState({ workingDir: root, version: "0.0.0-test" }));

		const state = buildWorkbenchState({ workingDir: root, version: "0.0.0-test" });
		assert.equal(state.safetyFeedback.length, 1);
		const row = state.safetyFeedback[0]!;
		assert.match(row.id, /^[0-9a-f-]{36}$/);
		assert.equal(row.rootFrameId, "safety-case");
		assert.equal(row.userId, "local-user");
		assert.equal(row.type, "review_requested");
		assert.equal(row.source, "review-request");
		assert.match(row.reason ?? "", /outputs\/safety-case\.md/);
		assert.match(row.responseId ?? "", /^[0-9a-f-]{36}$/);
		assert.match(row.contextSnapshot ?? "", /"artifactPath":"outputs\/safety-case\.md"/);
		assert.doesNotMatch(row.contextSnapshot ?? "", /api[_-]?key|secret|token/i);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench review request endpoint returns safety feedback through authenticated state", async () => {
	const root = makeSafetyFeedbackWorkspace();
	const handle = await startWorkbenchServer({
		workingDir: root,
		version: "0.0.0-test",
		host: "127.0.0.1",
		port: 0,
		token: "test-token",
		promptExecutor: async (request) => ({ content: `reviewed ${request.message}` }),
	});
	try {
		const response = await fetch(`${handle.url}api/chat/review/request`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				cookie: "feynman_workbench=test-token",
			},
			body: JSON.stringify({
				sessionId: "safety-case",
				projectId: "workspace",
				title: "Safety case",
				runSlug: "safety-case",
			}),
		});
		assert.equal(response.status, 200);
		const payload = await response.json() as {
			state: {
				safetyFeedback: Array<{ rootFrameId: string; type: string; source: string; contextSnapshot?: string }>;
			};
		};
		assert.equal(payload.state.safetyFeedback.length, 1);
		assert.equal(payload.state.safetyFeedback[0]?.rootFrameId, "safety-case");
		assert.equal(payload.state.safetyFeedback[0]?.type, "review_requested");
		assert.equal(payload.state.safetyFeedback[0]?.source, "review-request");
		assert.match(payload.state.safetyFeedback[0]?.contextSnapshot ?? "", /outputs\/safety-case\.md/);
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});
