import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	requestWorkbenchReview,
	selectWorkbenchReviewArtifact,
	workbenchReviewMessage,
} from "../src/workbench/review.js";
import { buildWorkbenchState } from "../src/workbench/scan.js";

function makeReviewWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-review-"));
	mkdirSync(join(root, "outputs", ".plans"), { recursive: true });
	mkdirSync(join(root, "outputs", ".drafts"), { recursive: true });
	mkdirSync(join(root, "papers"), { recursive: true });
	mkdirSync(join(root, "notes"), { recursive: true });
	writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n");
	writeFileSync(join(root, "outputs", ".plans", "scaling-laws.md"), "# Scaling Laws Plan\n");
	writeFileSync(join(root, "outputs", ".drafts", "scaling-laws-draft.md"), "# Scaling Laws Draft\n");
	writeFileSync(join(root, "outputs", "scaling-laws.md"), "# Scaling Laws Brief\n\nCited body.\n");
	writeFileSync(join(root, "outputs", "scaling-laws.provenance.md"), "# Scaling Laws Provenance\n");
	writeFileSync(join(root, "notes", "scaling-laws-verification.md"), "# Scaling Laws Verification\n");
	writeFileSync(join(root, "papers", "scaling-laws.pdf"), "%PDF fixture\n");
	return root;
}

test("workbench review request runs the review prompt against the active artifact", async () => {
	const root = makeReviewWorkspace();
	try {
		const state = buildWorkbenchState({ workingDir: root, version: "0.0.0-test" });
		const artifact = selectWorkbenchReviewArtifact(state, {
			projectId: "workspace",
			runSlug: "scaling-laws",
		});
		assert.equal(artifact.path, "outputs/scaling-laws.md");
		assert.equal(workbenchReviewMessage(artifact), "/review outputs/scaling-laws.md");

		let observedMessage = "";
		const result = await requestWorkbenchReview({
			workingDir: root,
			executor: async (request) => {
				observedMessage = request.message;
				return {
					content: `reviewed ${request.message}`,
					toolEvents: [{ id: "review-tool", label: "fixture review", status: "complete", output: request.message }],
				};
			},
		}, {
			id: "scaling-laws",
			projectId: "workspace",
			title: "Scaling laws",
			runSlug: "scaling-laws",
		}, state);

		assert.equal(observedMessage, "/review outputs/scaling-laws.md");
		assert.equal(result.artifact.path, "outputs/scaling-laws.md");
		assert.equal(result.session.messages[0]?.content, "/review outputs/scaling-laws.md");
		assert.equal(result.session.messages[1]?.content, "reviewed /review outputs/scaling-laws.md");
		assert.equal(result.session.messages[1]?.toolEvents[0]?.label, "fixture review");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
