import {
	submitWorkbenchChatMessage,
	type WorkbenchChatOptions,
	type WorkbenchChatSession,
} from "./chat.js";
import { recordWorkbenchSafetyFeedback } from "./safety-feedback.js";
import type { ArtifactCategory, WorkbenchArtifact, WorkbenchState } from "./types.js";

type ReviewRequestInput = {
	id: string;
	projectId: string;
	title: string;
	artifactPath?: string;
	runSlug?: string;
};

export type WorkbenchReviewRequestResult = {
	artifact: WorkbenchArtifact;
	session: WorkbenchChatSession;
};

const REVIEW_CATEGORY_PRIORITY: Record<ArtifactCategory, number> = {
	output: 0,
	draft: 1,
	paper: 2,
	verification: 3,
	provenance: 4,
	note: 5,
	data: 6,
	visual: 7,
	plan: 8,
};

function compareReviewTargets(a: WorkbenchArtifact, b: WorkbenchArtifact): number {
	const category = REVIEW_CATEGORY_PRIORITY[a.category] - REVIEW_CATEGORY_PRIORITY[b.category];
	if (category !== 0) return category;
	return b.updatedAtMs - a.updatedAtMs || a.path.localeCompare(b.path);
}

function projectArtifactPaths(state: WorkbenchState, projectId: string): Set<string> {
	const project = state.projects.find((item) => item.id === projectId);
	return new Set(project?.artifactPaths ?? state.artifacts.map((artifact) => artifact.path));
}

export function selectWorkbenchReviewArtifact(
	state: WorkbenchState,
	input: Pick<ReviewRequestInput, "artifactPath" | "projectId" | "runSlug">,
): WorkbenchArtifact {
	if (input.artifactPath) {
		const artifact = state.artifacts.find((item) => item.path === input.artifactPath);
		if (!artifact) {
			throw new Error("Review artifact was not found in this workbench.");
		}
		return artifact;
	}

	const artifactPaths = projectArtifactPaths(state, input.projectId);
	const projectArtifacts = state.artifacts.filter((artifact) => artifactPaths.has(artifact.path));
	const runArtifacts = input.runSlug
		? projectArtifacts.filter((artifact) => artifact.slug === input.runSlug)
		: [];
	const artifact = (runArtifacts.length ? runArtifacts : projectArtifacts)
		.slice()
		.sort(compareReviewTargets)[0];
	if (!artifact) {
		throw new Error("No research artifact is available to review in this frame.");
	}
	return artifact;
}

export function workbenchReviewMessage(artifact: WorkbenchArtifact): string {
	return `/review ${artifact.path}`;
}

export async function requestWorkbenchReview(
	options: WorkbenchChatOptions,
	input: ReviewRequestInput,
	state: WorkbenchState,
): Promise<WorkbenchReviewRequestResult> {
	const artifact = selectWorkbenchReviewArtifact(state, input);
	const reviewMessage = workbenchReviewMessage(artifact);
	const session = await submitWorkbenchChatMessage(options, {
		id: input.id,
		projectId: input.projectId,
		title: input.title,
		message: reviewMessage,
	});
	const assistantResponse = session.messages.filter((message) => message.role === "assistant").at(-1);
	recordWorkbenchSafetyFeedback(options.workingDir, {
		rootFrameId: input.id,
		type: "review_requested",
		model: session.config.model || undefined,
		reason: `User requested reviewer feedback for ${artifact.path}.`,
		responseId: assistantResponse?.id,
		contextSnapshot: JSON.stringify({
			artifactPath: artifact.path,
			projectId: input.projectId,
			runSlug: input.runSlug ?? artifact.slug,
			reviewMessage,
			sessionConfig: session.config,
		}),
	});
	return { artifact, session };
}
