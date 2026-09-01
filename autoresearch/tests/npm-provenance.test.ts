import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveVerifiedNpmSourceCommit } from "../scripts/lib/npm-provenance.mjs";

const name = "@companion-ai/feynman";
const version = "0.3.6";
const commit = "ccc8030c1090efb6afab8c4f907115309d1eb788";
const repository = "https://github.com/companion-inc/feynman";
const workflowPath = ".github/workflows/publish.yml";
const ref = "refs/heads/main";
const digest = Buffer.alloc(64, 7);
const integrity = `sha512-${digest.toString("base64")}`;
const invocationId =
	`${repository}/actions/runs/30367434326/attempts/1`;
const certificate = readFileSync(
	new URL("./fixtures/npm-provenance-0.3.6.der", import.meta.url),
).toString("base64");

function auditFixture(overrides: {
	commit?: string;
	repository?: string;
	workflowPath?: string;
	ref?: string;
	digest?: string;
	invocationId?: string;
	certificate?: string | null;
	verified?: boolean;
} = {}) {
	const sourceRepository = overrides.repository ?? repository;
	const sourceRef = overrides.ref ?? ref;
	const statement = {
		_type: "https://in-toto.io/Statement/v1",
		subject: [
			{
				name: "pkg:npm/%40companion-ai/feynman@0.3.6",
				digest: { sha512: overrides.digest ?? digest.toString("hex") },
			},
		],
		predicateType: "https://slsa.dev/provenance/v1",
		predicate: {
			buildDefinition: {
				buildType:
					"https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
				externalParameters: {
					workflow: {
						ref: sourceRef,
						repository: sourceRepository,
						path: overrides.workflowPath ?? workflowPath,
					},
				},
				resolvedDependencies: [
					{
						uri: `git+${sourceRepository}@${sourceRef}`,
						digest: { gitCommit: overrides.commit ?? commit },
					},
				],
			},
			runDetails: {
				metadata: {
					invocationId: overrides.invocationId ?? invocationId,
				},
			},
		},
	};
	const entry = {
		name,
		version,
		registry: "https://registry.npmjs.org/",
		attestationBundles: [
			{
				predicateType: "https://slsa.dev/provenance/v1",
				bundle: {
					verificationMaterial: {
						certificate:
							overrides.certificate === null
								? undefined
								: { rawBytes: overrides.certificate ?? certificate },
					},
					dsseEnvelope: {
						payload: Buffer.from(JSON.stringify(statement)).toString("base64"),
					},
				},
			},
		],
	};
	return {
		invalid: overrides.verified === false ? [entry] : [],
		missing: [],
		verified: overrides.verified === false ? [] : [entry],
	};
}

const expected = {
	name,
	version,
	integrity,
	repository,
	workflowPath,
	ref,
};

test("resolves the source commit from npm-verified SLSA provenance", () => {
	assert.equal(resolveVerifiedNpmSourceCommit(auditFixture(), expected), commit);
});

test("rejects unverified, wrong-package, and wrong-source provenance", () => {
	for (const audit of [
		auditFixture({ verified: false }),
		auditFixture({ digest: "0".repeat(128) }),
		auditFixture({ repository: "https://github.com/example/feynman" }),
		auditFixture({ workflowPath: ".github/workflows/other.yml" }),
		auditFixture({ ref: "refs/heads/release" }),
		auditFixture({ commit: "not-a-git-commit" }),
		auditFixture({ commit: "a".repeat(40) }),
		auditFixture({
			invocationId: `${repository}/actions/runs/30367434326/attempts/2`,
		}),
		auditFixture({ certificate: null }),
	]) {
		assert.throws(
			() => resolveVerifiedNpmSourceCommit(audit, expected),
			/feynman npm provenance/,
		);
	}
});
