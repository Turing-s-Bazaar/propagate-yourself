import assert from "node:assert/strict";
import test from "node:test";

import { buildResearchRunId, createResearchArtifact, validateResearchRun, type ResearchRun } from "../src/research/contracts.js";
import { validateFeynmanPluginManifest } from "../src/research/plugin-manifest.js";

test("ResearchRun validation requires a bounded typed artifact spine", () => {
	const run: ResearchRun = {
		schemaVersion: "feynman.researchRun.v1",
		runId: buildResearchRunId({ workflow: "paper_rank", slug: "demo", generatedAt: "2026-06-23T00:00:00.000Z" }),
		workflow: "paper_rank",
		slug: "demo",
		topic: "demo",
		generatedAt: "2026-06-23T00:00:00.000Z",
		status: "completed",
		researchJobs: ["discovering_prior_art", "ranking_evidence", "extracting_research_entities"],
		sources: [{ id: "openalex", kind: "paper_index", fields: ["works"] }],
		papers: [],
		entities: [
			{
				id: "entity:1",
				kind: "molecular_structure_diagram",
				value: "figure 2 ligand sketch",
				confidence: 0.7,
				source: { artifactPath: "/tmp/demo-paper-rank.md", field: "figure_caption" },
				status: "candidate",
			},
		],
		tools: [],
		artifacts: [
			createResearchArtifact({
				kind: "report",
				path: "/tmp/demo-paper-rank.md",
				label: "ranked brief",
				role: "primary_ranked_brief",
				primary: true,
			})!,
		],
		nextActions: [],
		verification: {
			state: "partial",
			summary: "ranked papers only",
			caveats: ["not a completed replication"],
		},
		constraints: {
			rawFullTextStored: false,
			promptsStored: false,
			modelOutputsStored: false,
		},
	};

	assert.equal(validateResearchRun(run).valid, true);

	const invalid = validateResearchRun({
		...run,
		researchJobs: [],
		artifacts: [{ ...run.artifacts[0]!, primary: false }],
		constraints: { ...run.constraints, rawFullTextStored: true },
	});
	assert.equal(invalid.valid, false);
	assert.match(invalid.errors.join("\n"), /researchJobs must be non-empty/);
	assert.match(invalid.errors.join("\n"), /at least one artifact must be primary/);
	assert.match(invalid.errors.join("\n"), /rawFullTextStored true/);
});

test("plugin manifest validation accepts entity extractors and experiment runners only inside research jobs", () => {
	const valid = validateFeynmanPluginManifest({
		manifest_version: 1,
		name: "bionemo-lite",
		research_jobs: ["extracting_research_entities", "running_research_experiments"],
		slots: {
			entity_extractors: ["./dist/molecule-diagram-extractor.js"],
			experiment_runners: ["./dist/fold-runner.js"],
		},
		pi: {
			skills: ["./skills"],
		},
		requires_env: [{ name: "NVIDIA_API_KEY", secret: true }],
	});

	assert.equal(valid.valid, true, valid.errors.join("; "));
	assert.deepEqual(valid.errors, []);

	const invalid = validateFeynmanPluginManifest({
		manifest_version: 1,
		name: "../bad",
		research_jobs: ["cold_outreach"],
		slots: {
			outreach: ["./paper-outreach.js"],
			entity_extractors: ["../escape.js"],
		},
		pi: {
			extensions: ["/tmp/outside.js"],
		},
		requires_env: ["not-loud"],
	});

	assert.equal(invalid.valid, false);
	assert.match(invalid.errors.join("\n"), /name must be a package-safe identifier/);
	assert.match(invalid.errors.join("\n"), /research_jobs\[0\] is not a supported/);
	assert.match(invalid.errors.join("\n"), /unknown plugin slot: outreach/);
	assert.match(invalid.errors.join("\n"), /slots\.entity_extractors\[0\] must stay inside/);
	assert.match(invalid.errors.join("\n"), /pi\.extensions\[0\] must stay inside/);
	assert.match(invalid.errors.join("\n"), /requires_env\[0\] must be an environment variable name/);
});
