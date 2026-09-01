import { createHash } from "node:crypto";

export const researchJobValues = [
	"discovering_prior_art",
	"reading_paper_content",
	"extracting_research_entities",
	"ranking_evidence",
	"verifying_claims",
	"planning_reproduction",
	"running_research_experiments",
	"synthesizing_artifacts",
	"visualizing_research_structure",
	"improving_research_loop",
] as const;

export type ResearchJob = (typeof researchJobValues)[number];

export const researchRunStatusValues = ["planned", "running", "completed", "partial", "blocked", "failed"] as const;
export type ResearchRunStatus = (typeof researchRunStatusValues)[number];

export const verificationStateValues = ["not_checked", "inferred", "partial", "verified", "blocked", "failed"] as const;
export type VerificationState = (typeof verificationStateValues)[number];

export const researchArtifactKindValues = [
	"report",
	"json",
	"jsonl",
	"graph",
	"html",
	"audit",
	"provenance",
	"template",
	"prompt",
	"model_output",
	"ledger",
	"plan",
	"manifest",
] as const;

export type ResearchArtifactKind = (typeof researchArtifactKindValues)[number];

export type ResearchArtifact = {
	kind: ResearchArtifactKind;
	path: string;
	label: string;
	role: string;
	primary?: boolean;
	format?: string;
};

export type ResearchSource = {
	id: string;
	kind: "paper_index" | "paper_access" | "full_text" | "citation_graph" | "fixture" | "model" | "manual" | "other";
	url?: string;
	path?: string;
	fields: string[];
};

export type ResearchEntity = {
	id: string;
	kind: string;
	value: string;
	paperId?: string;
	confidence: number;
	source: {
		artifactPath?: string;
		field?: string;
		section?: string;
	};
	evidence?: string;
	status: "extracted" | "candidate" | "missing" | "not_checked";
};

export type ResearchRunPaper = {
	id: string;
	title: string;
	rank?: number;
	score?: number;
	year?: number;
	doi?: string;
	arxivId?: string;
	pmid?: string;
	pmcid?: string;
	openAlexId?: string;
	url?: string;
	roles?: string[];
	verification: {
		state: VerificationState;
		summary: string;
	};
};

export type ResearchToolRun = {
	id: string;
	kind: "source_adapter" | "access_resolver" | "entity_extractor" | "rank_scorer" | "experiment_runner" | "artifact_exporter" | "visualizer" | "model";
	label: string;
	status: "not_run" | "completed" | "partial" | "failed";
	inputs?: string[];
	outputArtifacts?: string[];
	caveats?: string[];
};

export type ResearchRun = {
	schemaVersion: "feynman.researchRun.v1";
	runId: string;
	workflow: string;
	slug: string;
	topic: string;
	generatedAt: string;
	status: ResearchRunStatus;
	researchJobs: ResearchJob[];
	sources: ResearchSource[];
	papers: ResearchRunPaper[];
	entities: ResearchEntity[];
	tools: ResearchToolRun[];
	artifacts: ResearchArtifact[];
	nextActions: Array<{
		id: string;
		title: string;
		priority: "high" | "medium" | "low";
		artifactPointers: string[];
	}>;
	verification: {
		state: VerificationState;
		summary: string;
		caveats: string[];
	};
	constraints: {
		rawFullTextStored: boolean;
		promptsStored: boolean;
		modelOutputsStored: boolean;
	};
};

export type ResearchRunValidationResult = {
	valid: boolean;
	errors: string[];
};

export function buildResearchRunId(input: { workflow: string; slug: string; generatedAt: string }): string {
	const digest = createHash("sha256")
		.update(`${input.workflow}\0${input.slug}\0${input.generatedAt}`)
		.digest("hex")
		.slice(0, 16);
	return `${input.workflow}:${input.slug}:${digest}`;
}

export function createResearchArtifact(input: {
	kind: ResearchArtifactKind;
	path: string | undefined;
	label: string;
	role: string;
	primary?: boolean;
	format?: string;
}): ResearchArtifact | undefined {
	if (!input.path) return undefined;
	return {
		kind: input.kind,
		path: input.path,
		label: input.label,
		role: input.role,
		...(input.primary === undefined ? {} : { primary: input.primary }),
		...(input.format ? { format: input.format } : {}),
	};
}

export function validateResearchRun(run: ResearchRun): ResearchRunValidationResult {
	const errors: string[] = [];
	if (run.schemaVersion !== "feynman.researchRun.v1") errors.push("schemaVersion must be feynman.researchRun.v1");
	if (!run.runId.trim()) errors.push("runId is required");
	if (!run.workflow.trim()) errors.push("workflow is required");
	if (!run.slug.trim()) errors.push("slug is required");
	if (!run.topic.trim()) errors.push("topic is required");
	if (!Date.parse(run.generatedAt)) errors.push("generatedAt must be an ISO timestamp");
	if (!researchRunStatusValues.includes(run.status)) errors.push(`status is unsupported: ${run.status}`);
	if (run.researchJobs.length === 0) errors.push("researchJobs must be non-empty");
	for (const job of run.researchJobs) {
		if (!researchJobValues.includes(job)) errors.push(`researchJobs contains unsupported value: ${job}`);
	}
	if (run.artifacts.length === 0) errors.push("artifacts must be non-empty");
	if (!run.artifacts.some((artifact) => artifact.primary)) errors.push("at least one artifact must be primary");
	for (const artifact of run.artifacts) {
		if (!researchArtifactKindValues.includes(artifact.kind)) errors.push(`artifact kind is unsupported: ${artifact.kind}`);
		if (!artifact.path.trim()) errors.push(`artifact path is required for ${artifact.label}`);
		if (!artifact.role.trim()) errors.push(`artifact role is required for ${artifact.label}`);
	}
	if (!verificationStateValues.includes(run.verification.state)) errors.push(`verification state is unsupported: ${run.verification.state}`);
	if (run.constraints.rawFullTextStored) errors.push("ResearchRun manifests must not mark rawFullTextStored true");
	return {
		valid: errors.length === 0,
		errors,
	};
}
