import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
	appendWorkbenchChatAssistantMessage,
	ensureWorkbenchChatSession,
	type WorkbenchChatOptions,
	type WorkbenchChatSession,
	type WorkbenchToolEvent,
} from "./chat.js";
import { buildWorkbenchState } from "./scan.js";
import type {
	ArtifactCategory,
	WorkbenchArtifact,
	WorkbenchGeneratedPlan,
	WorkbenchGeneratedPlanStatus,
	WorkbenchGeneratedPlanStep,
	WorkbenchPlanStepStatus,
} from "./types.js";

type EnsureSessionInput = {
	id: string;
	projectId: string;
	title: string;
};

type GeneratePlanInput = EnsureSessionInput & {
	runSlug?: string;
	taskSummary?: string;
};

type UpdatePlanActionInput = EnsureSessionInput & {
	action: "approve" | "reject" | "reopen";
};

type UpdatePlanStepInput = EnsureSessionInput & {
	notes?: string;
	status: WorkbenchPlanStepStatus;
	stepTitle: string;
};

export type WorkbenchPlanMutationResult = {
	plan: WorkbenchGeneratedPlan;
	session: WorkbenchChatSession;
};

const WORKBENCH_PLAN_SCHEMA = "feynman.workbenchPlan.v1";

function nowIso(): string {
	return new Date().toISOString();
}

function normalizeSessionId(value: string): string {
	const id = value.trim();
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) {
		throw new Error("Chat session id must be a simple slug.");
	}
	return id;
}

function normalizeTitle(value: string): string {
	const title = value.trim().replace(/\s+/g, " ");
	return title.slice(0, 140) || "Research chat";
}

function generatedPlanRelPath(sessionId: string): string {
	return `outputs/.plans/${normalizeSessionId(sessionId)}.workbench-plan.json`;
}

function generatedPlanPath(workingDir: string, sessionId: string): string {
	return resolve(workingDir, generatedPlanRelPath(sessionId));
}

function planStatusForSteps(current: WorkbenchGeneratedPlanStatus, steps: WorkbenchGeneratedPlanStep[]): WorkbenchGeneratedPlanStatus {
	if (current === "rejected") return "rejected";
	if (steps.every((step) => step.status === "complete")) return "complete";
	if (steps.some((step) => step.status !== "pending")) return "running";
	return current === "awaiting_approval" ? "approved" : current;
}

function artifactsInCategories(artifacts: WorkbenchArtifact[], categories: ArtifactCategory[]): WorkbenchArtifact[] {
	const allowed = new Set(categories);
	return artifacts.filter((artifact) => allowed.has(artifact.category));
}

function stepDetail(paths: string[], empty: string): string {
	if (!paths.length) return empty;
	const sample = paths.slice(0, 3).join(", ");
	return paths.length > 3 ? `${sample}, and ${paths.length - 3} more artifact(s).` : sample;
}

function createPlanStep(
	title: string,
	description: string,
	artifactPaths: string[],
	updatedAt: string,
): WorkbenchGeneratedPlanStep {
	return {
		title,
		description,
		status: "pending",
		artifactPaths,
		updatedAt,
	};
}

function writeGeneratedPlan(workingDir: string, plan: WorkbenchGeneratedPlan): void {
	const path = generatedPlanPath(workingDir, plan.sessionId);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
}

function readGeneratedPlan(workingDir: string, sessionId: string): WorkbenchGeneratedPlan {
	const path = generatedPlanPath(workingDir, sessionId);
	if (!existsSync(path)) {
		throw new Error("No generated plan exists for this session.");
	}
	const parsed = JSON.parse(readFileSync(path, "utf8")) as WorkbenchGeneratedPlan;
	if (parsed.schema !== WORKBENCH_PLAN_SCHEMA || !Array.isArray(parsed.steps)) {
		throw new Error("Generated plan artifact is not a Feynman workbench plan.");
	}
	return {
		...parsed,
		artifactPath: generatedPlanRelPath(sessionId),
	};
}

function appendPlanMessage(
	options: WorkbenchChatOptions,
	session: WorkbenchChatSession,
	label: string,
	content: string,
	output: string,
): WorkbenchChatSession {
	const event: WorkbenchToolEvent = {
		id: randomUUID(),
		label,
		status: "complete",
		output,
	};
	return appendWorkbenchChatAssistantMessage(options, session, content, [event]);
}

export function generateWorkbenchPlan(
	options: WorkbenchChatOptions,
	input: GeneratePlanInput,
): WorkbenchPlanMutationResult {
	let session = ensureWorkbenchChatSession(options, input);
	const state = buildWorkbenchState({ workingDir: options.workingDir, version: options.feynmanVersion });
	const runSlug = normalizeSessionId(input.runSlug || session.id);
	const run = state.runs.find((item) => item.slug === runSlug);
	const artifacts = state.artifacts
		.filter((artifact) => artifact.slug === runSlug && artifact.path !== generatedPlanRelPath(session.id))
		.sort((a, b) => a.updatedAtMs - b.updatedAtMs || a.path.localeCompare(b.path));
	const sourceArtifacts = artifactsInCategories(artifacts, ["paper", "note", "data"]);
	const executionArtifacts = artifactsInCategories(artifacts, ["output", "draft", "visual"]);
	const verificationArtifacts = artifactsInCategories(artifacts, ["verification", "provenance"]);
	const planArtifacts = artifactsInCategories(artifacts, ["plan"]);
	const now = nowIso();
	const taskSummary = normalizeTitle(input.taskSummary || run?.taskSummary || session.title);
	const confidence = sourceArtifacts.length || executionArtifacts.length ? "high" : "medium";
	const plan: WorkbenchGeneratedPlan = {
		schema: WORKBENCH_PLAN_SCHEMA,
		id: randomUUID(),
		sessionId: session.id,
		projectId: session.projectId,
		runSlug,
		title: `${session.title} execution plan`,
		taskSummary,
		status: "awaiting_approval",
		feasibility: {
			confidence,
			rationale: artifacts.length
				? `Grounded in ${artifacts.length} local artifact(s) from this research frame.`
				: "Grounded in the active chat session; no local artifacts are attached yet.",
		},
		steps: [
			createPlanStep(
				"Define the research question and success criteria",
				planArtifacts.length
					? `Start from the existing plan material: ${stepDetail(planArtifacts.map((artifact) => artifact.path), "plan artifact")}`
					: "Write the concrete research question, success criteria, and expected evidence threshold before running more work.",
				planArtifacts.map((artifact) => artifact.path),
				now,
			),
			createPlanStep(
				"Collect source evidence and reusable context",
				sourceArtifacts.length
					? `Read and reconcile source artifacts: ${stepDetail(sourceArtifacts.map((artifact) => artifact.path), "source artifact")}`
					: "Gather papers, notes, datasets, code links, and prior-art context needed to answer the research question.",
				sourceArtifacts.map((artifact) => artifact.path),
				now,
			),
			createPlanStep(
				"Run the analysis or reproduction path",
				executionArtifacts.length
					? `Inspect current outputs before rerunning: ${stepDetail(executionArtifacts.map((artifact) => artifact.path), "output artifact")}`
					: "Execute the smallest analysis, extraction, or reproduction that can change the research decision.",
				executionArtifacts.map((artifact) => artifact.path),
				now,
			),
			createPlanStep(
				"Save artifacts with lineage",
				artifacts.length
					? `Keep generated files tied to this frame: ${stepDetail(artifacts.map((artifact) => artifact.path), "workspace artifact")}`
					: "Persist outputs under the run slug so transcript, files, notebook, and provenance panes agree.",
				artifacts.map((artifact) => artifact.path),
				now,
			),
			createPlanStep(
				"Verify claims and provenance",
				verificationArtifacts.length
					? `Use the existing checks: ${stepDetail(verificationArtifacts.map((artifact) => artifact.path), "verification artifact")}`
					: "Check citations, numbers, code/output alignment, and unresolved assumptions before treating the result as verified.",
				verificationArtifacts.map((artifact) => artifact.path),
				now,
			),
		],
		artifactPath: generatedPlanRelPath(session.id),
		createdAt: now,
		updatedAt: now,
		source: "workbench",
	};
	writeGeneratedPlan(options.workingDir, plan);
	session = appendPlanMessage(
		options,
		session,
		"generate_plan",
		"I generated an execution plan for this research frame. It is saved as a local artifact and is waiting for approval.",
		`Plan saved to ${plan.artifactPath}. Step titles: ${plan.steps.map((step) => step.title).join(" | ")}`,
	);
	return { plan, session };
}

export function updateWorkbenchPlanAction(
	options: WorkbenchChatOptions,
	input: UpdatePlanActionInput,
): WorkbenchPlanMutationResult {
	const session = ensureWorkbenchChatSession(options, input);
	const current = readGeneratedPlan(options.workingDir, session.id);
	const now = nowIso();
	const status: WorkbenchGeneratedPlanStatus = input.action === "approve"
		? "approved"
		: input.action === "reject"
			? "rejected"
			: "awaiting_approval";
	const plan = {
		...current,
		status,
		updatedAt: now,
		steps: current.steps.map((step) => ({ ...step, updatedAt: now })),
	};
	writeGeneratedPlan(options.workingDir, plan);
	const label = input.action === "approve" ? "approve_plan" : input.action === "reject" ? "discard_plan" : "reopen_plan";
	const updatedSession = appendPlanMessage(
		options,
		session,
		label,
		input.action === "approve"
			? "I approved the execution plan for this research frame."
			: input.action === "reject"
				? "I marked the execution plan as rejected so it can be regenerated."
				: "I reopened the execution plan for another approval pass.",
		`Plan ${plan.id} is now ${plan.status}.`,
	);
	return { plan, session: updatedSession };
}

export function updateWorkbenchPlanStep(
	options: WorkbenchChatOptions,
	input: UpdatePlanStepInput,
): WorkbenchPlanMutationResult {
	const session = ensureWorkbenchChatSession(options, input);
	const current = readGeneratedPlan(options.workingDir, session.id);
	const stepTitle = input.stepTitle.trim();
	const index = current.steps.findIndex((step) => step.title === stepTitle);
	if (index === -1) {
		throw new Error(`Plan step not found: ${stepTitle}`);
	}
	const now = nowIso();
	const steps = current.steps.map((step, stepIndex) => {
		if (stepIndex !== index) return step;
		const notes = input.notes?.trim();
		return {
			...step,
			status: input.status,
			...(notes ? { notes } : {}),
			updatedAt: now,
		};
	});
	const plan = {
		...current,
		status: planStatusForSteps(current.status === "awaiting_approval" ? "approved" : current.status, steps),
		steps,
		updatedAt: now,
	};
	writeGeneratedPlan(options.workingDir, plan);
	const updatedSession = appendPlanMessage(
		options,
		session,
		"update_step_status",
		`I updated the plan step "${stepTitle}" to ${input.status}.`,
		input.notes?.trim() || `Plan ${plan.id} status is ${plan.status}.`,
	);
	return { plan, session: updatedSession };
}
