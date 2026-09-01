import type { WorkbenchChatSession } from "./chat.js";
import type { WorkbenchRun } from "./types.js";

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

function sessionSummary(session: WorkbenchChatSession): string {
	const lastUserMessage = session.messages
		.slice()
		.reverse()
		.find((message) => message.role === "user" && message.content.trim());
	if (lastUserMessage) return lastUserMessage.content.trim().replace(/\s+/g, " ").slice(0, 180);
	const attachmentCount = session.attachments.length;
	if (attachmentCount > 0) return `New research session with ${pluralize(attachmentCount, "attachment")} ready for analysis.`;
	return "New research session ready for a question, file, or experiment.";
}

export function buildWorkbenchChatRun(session: WorkbenchChatSession): WorkbenchRun {
	const updatedAtMs = Date.parse(session.updatedAt) || Date.now();
	return {
		slug: session.id,
		title: session.title,
		taskSummary: sessionSummary(session),
		status: "chat",
		source: "chat",
		projectId: session.projectId,
		updatedAt: session.updatedAt,
		updatedAtMs,
		artifactCount: session.attachments.length,
		artifactPaths: [],
		notebookCellCount: 0,
		categories: [],
		lastArtifactNames: session.attachments.slice(0, 4).map((attachment) => attachment.name),
		hasPlan: false,
		hasProvenance: false,
		hasVerification: false,
	};
}

export function mergeWorkbenchChatRuns(
	artifactRuns: WorkbenchRun[],
	chatSessions: WorkbenchChatSession[],
	maxRuns: number,
): WorkbenchRun[] {
	const artifactSlugs = new Set(artifactRuns.map((run) => run.slug));
	const chatRuns = chatSessions
		.filter((session) => !artifactSlugs.has(session.id))
		.map(buildWorkbenchChatRun);
	return [...artifactRuns, ...chatRuns]
		.sort((a, b) => b.updatedAtMs - a.updatedAtMs || a.slug.localeCompare(b.slug))
		.slice(0, maxRuns);
}
