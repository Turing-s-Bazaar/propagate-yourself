import type { WorkbenchChatMessage, WorkbenchChatSession } from "./chat.js";
import { projectUploadFrameId } from "./project-metadata.js";
import type { WorkbenchFrameRecord, WorkbenchProject, WorkbenchRun } from "./types.js";

const MAX_CONTEXT_TEXT_CHARS = 20_000;

function timestampMs(value: string | undefined): number {
	const parsed = Date.parse(value ?? "");
	return Number.isFinite(parsed) ? parsed : 0;
}

function boundedText(value: string | undefined, maxLength = MAX_CONTEXT_TEXT_CHARS): { text: string; truncated: boolean } | undefined {
	const text = value?.trim();
	if (!text) return undefined;
	if (text.length <= maxLength) return { text, truncated: false };
	return { text: text.slice(0, maxLength), truncated: true };
}

function jsonText(value: unknown): string {
	return JSON.stringify(value);
}

function lastMessage(session: WorkbenchChatSession, role: WorkbenchChatMessage["role"]): WorkbenchChatMessage | undefined {
	return session.messages.slice().reverse().find((message) => message.role === role && message.content.trim());
}

function statusFromSession(session: WorkbenchChatSession): string {
	return session.status === "complete" ? "completed" : session.status;
}

function statusFromRun(run: WorkbenchRun): string {
	if (run.status === "planned") return "planned";
	return "completed";
}

function specialistName(session: WorkbenchChatSession): string | undefined {
	const specialist = session.config.specialist.trim();
	return specialist && specialist.toLowerCase() !== "none" ? specialist : undefined;
}

function agentNameFromSession(session: WorkbenchChatSession): string {
	return (specialistName(session) ?? "Feynman").replace(/\s+/g, "_").toUpperCase();
}

function delegateNameFromSession(session: WorkbenchChatSession): string | undefined {
	return specialistName(session)?.trim().replace(/\s+/g, "-").toLowerCase();
}

function completedAtForStatus(status: string, updatedAt: string): Pick<WorkbenchFrameRecord, "completedAt" | "completedAtMs"> {
	if (status !== "completed") return {};
	return {
		completedAt: updatedAt,
		completedAtMs: timestampMs(updatedAt),
	};
}

function inputDataForSession(session: WorkbenchChatSession): string | undefined {
	const message = lastMessage(session, "user");
	const content = boundedText(message?.content);
	if (!message || !content) return undefined;
	return jsonText({
		message_id: message.id,
		text: content.text,
		...(content.truncated ? { truncated: true } : {}),
	});
}

function outputDataForSession(session: WorkbenchChatSession): string | undefined {
	const message = lastMessage(session, "assistant");
	const content = boundedText(message?.content);
	if (!message || !content) return undefined;
	return jsonText({
		message_id: message.id,
		status: message.status,
		text: content.text,
		...(content.truncated ? { truncated: true } : {}),
		tool_event_count: message.toolEvents.length,
	});
}

function mentionedArtifactIdsForSession(session: WorkbenchChatSession): string | undefined {
	if (!session.attachments.length) return undefined;
	return jsonText(session.attachments.map((attachment) => attachment.storagePath));
}

function contextDataForSession(session: WorkbenchChatSession): string {
	return jsonText({
		source: "chat-session",
		session_id: session.id,
		project_id: session.projectId,
		message_count: session.messages.length,
		attachment_count: session.attachments.length,
		pi_session: {
			id: session.piSession.id,
			status: session.piSession.status,
			...(session.piSession.path ? { path: session.piSession.path } : {}),
		},
		config: {
			delegation: session.config.delegation,
			auto_review: session.config.autoReview,
			memory: session.config.memory,
			specialist: session.config.specialist,
			compute: session.config.compute,
			...(session.config.model ? { model: session.config.model } : {}),
		},
	});
}

function frameFromSession(session: WorkbenchChatSession, rootSeq: number): WorkbenchFrameRecord {
	const status = statusFromSession(session);
	const lastUser = lastMessage(session, "user");
	const lastUserAtMs = timestampMs(lastUser?.createdAt);
	const specialist = specialistName(session);
	const inputData = inputDataForSession(session);
	const outputData = outputDataForSession(session);
	const mentionedArtifactIds = mentionedArtifactIdsForSession(session);
	return {
		id: session.id,
		rootFrameId: session.id,
		agentName: agentNameFromSession(session),
		status,
		...(inputData ? { inputData } : {}),
		...(outputData ? { outputData } : {}),
		contextData: contextDataForSession(session),
		...(session.config.model ? { model: session.config.model } : {}),
		createdAt: session.createdAt,
		createdAtMs: timestampMs(session.createdAt),
		updatedAt: session.updatedAt,
		updatedAtMs: timestampMs(session.updatedAt),
		...completedAtForStatus(status, session.updatedAt),
		projectId: session.projectId,
		name: session.title,
		conversationType: "agent",
		taskSummary: lastUser?.content.trim().replace(/\s+/g, " ").slice(0, 240) ?? "New research session ready for a question, file, or experiment.",
		...(mentionedArtifactIds ? { mentionedArtifactIds } : {}),
		...(specialist ? { specialistsUsed: jsonText([specialist]), delegateName: delegateNameFromSession(session) } : {}),
		isHidden: false,
		statusDescription: status === "completed" ? "Feynman workbench session is complete." : `Feynman workbench session is ${status}.`,
		computeEnabled: session.config.compute,
		...(lastUser ? { lastUserMessageAt: lastUser.createdAt, lastUserMessageAtMs: lastUserAtMs } : {}),
		...(session.messages.length ? { lastExtractMsgIdx: session.messages.length - 1 } : {}),
		rootSeq,
		source: "chat-session",
	};
}

function frameFromRun(run: WorkbenchRun, rootSeq: number): WorkbenchFrameRecord {
	const status = statusFromRun(run);
	const artifactIds = run.primaryArtifact ? [run.primaryArtifact.path] : run.lastArtifactNames;
	return {
		id: run.slug,
		rootFrameId: run.slug,
		agentName: "FEYNMAN",
		status,
		contextData: jsonText({
			source: "artifact-run",
			run_slug: run.slug,
			artifact_count: run.artifactCount,
			notebook_cell_count: run.notebookCellCount,
			categories: run.categories,
			has_plan: run.hasPlan,
			has_provenance: run.hasProvenance,
			has_verification: run.hasVerification,
		}),
		createdAt: run.updatedAt,
		createdAtMs: run.updatedAtMs,
		updatedAt: run.updatedAt,
		updatedAtMs: run.updatedAtMs,
		...completedAtForStatus(status, run.updatedAt),
		...(run.projectId ? { projectId: run.projectId } : {}),
		name: run.title,
		conversationType: "agent",
		...(run.primaryArtifact ? { artifactId: run.primaryArtifact.path } : {}),
		taskSummary: run.taskSummary,
		...(artifactIds.length ? { mentionedArtifactIds: jsonText(artifactIds) } : {}),
		isHidden: false,
		statusDescription: status === "completed" ? "Feynman artifact frame is complete." : `Feynman artifact frame is ${status}.`,
		rootSeq,
		source: "artifact-run",
	};
}

function uploadFrameFromProject(project: WorkbenchProject): WorkbenchFrameRecord {
	const id = projectUploadFrameId(project.id);
	return {
		id,
		rootFrameId: id,
		projectId: project.id,
		name: "User Uploads",
		agentName: "UPLOADS",
		status: "completed",
		contextData: jsonText({
			source: "project-uploads",
			project_id: project.id,
			artifact_count: project.artifactCount,
			run_count: project.runSlugs.length,
		}),
		createdAt: project.updatedAt,
		createdAtMs: project.updatedAtMs,
		updatedAt: project.updatedAt,
		updatedAtMs: project.updatedAtMs,
		conversationType: "uploads",
		isHidden: false,
		statusDescription: "Feynman project upload frame is available.",
		rootSeq: 1,
		source: "project-uploads",
	};
}

export function buildWorkbenchFrames({
	projects,
	runs,
	sessions,
}: {
	projects: WorkbenchProject[];
	runs: WorkbenchRun[];
	sessions: WorkbenchChatSession[];
}): WorkbenchFrameRecord[] {
	const sessionsById = new Map(sessions.map((session) => [session.id, session]));
	const rootSeqByProjectRun = new Map<string, number>();
	for (const project of projects) {
		project.runSlugs.forEach((slug, index) => rootSeqByProjectRun.set(`${project.id}:${slug}`, index + 2));
	}
	const sessionFrames = sessions.map((session) =>
		frameFromSession(session, rootSeqByProjectRun.get(`${session.projectId}:${session.id}`) ?? 2)
	);
	const runFrames = runs
		.filter((run) => run.source !== "chat" || !sessionsById.has(run.slug))
		.map((run) => frameFromRun(run, rootSeqByProjectRun.get(`${run.projectId ?? "workspace"}:${run.slug}`) ?? 2));
	const uploadFrames = projects.map((project) => uploadFrameFromProject(project));
	return [...sessionFrames, ...runFrames, ...uploadFrames]
		.sort((a, b) =>
			(a.projectId ?? "").localeCompare(b.projectId ?? "") ||
			a.rootSeq - b.rootSeq ||
			b.updatedAtMs - a.updatedAtMs ||
			a.id.localeCompare(b.id)
		);
}
