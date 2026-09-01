import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import { buildWorkbenchState } from "../src/workbench/scan.js";
import { artifactMetadataPayload } from "../workbench-web/src/artifact-actions.js";
import { artifactClaimsForPath } from "../workbench-web/src/artifacts.js";

function makeClaimsWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-claims-"));
	mkdirSync(join(root, "outputs"), { recursive: true });
	writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n\n### Claims\n\n- Verified: claim ledger.\n", "utf8");
	writeFileSync(join(root, "outputs", "claim-ledger.md"), [
		"# Claim Ledger",
		"",
		"Claim: AlphaFold confidence exceeded 85 pLDDT for the candidate structure.",
		"Finding: H224N keeps the catalytic residue table internally consistent.",
		"",
		"Plain paragraphs are not promoted into durable claims.",
	].join("\n"), "utf8");
	writeFileSync(join(root, "outputs", "claim-ledger-verification.md"), [
		"# Candidate Structure Verification",
		"",
		"Verified: AlphaFold confidence exceeded 85 pLDDT for the candidate structure.",
	].join("\n"), "utf8");
	return root;
}

test("workbench state exposes explicit research claims and links checks to claim ids", () => {
	const root = makeClaimsWorkspace();
	try {
		const state = buildWorkbenchState({ workingDir: root });
		const explicit = state.claims.find((claim) => claim.claim.includes("AlphaFold confidence exceeded 85"));
		const finding = state.claims.find((claim) => claim.claim.includes("H224N keeps the catalytic residue table"));
		const check = state.checks.find((item) => item.evidencePaths.includes("outputs/claim-ledger-verification.md"));

		assert.ok(explicit, "expected explicit Claim marker to become a claim");
		assert.ok(finding, "expected explicit Finding marker to become a claim");
		assert.ok(check?.claimId, "expected verification check to link to a claim id");
		assert.ok(state.claims.some((claim) => claim.id === check?.claimId && claim.status === "verified"));
		assert.equal(state.summary.claimCount, state.claims.length);

		const artifactClaims = artifactClaimsForPath(state, "outputs/claim-ledger.md");
		assert.ok(artifactClaims.some((claim) => claim.id === explicit?.id));
		assert.ok(artifactClaims.some((claim) => claim.id === finding?.id));

		const artifact = state.artifacts.find((item) => item.path === "outputs/claim-ledger.md");
		assert.ok(artifact, "expected claim artifact");
		const metadata = artifactMetadataPayload(artifact, state) as { claims?: Array<{ id: string; claim: string }> };
		assert.ok(metadata.claims?.some((claim) => claim.id === explicit?.id));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
