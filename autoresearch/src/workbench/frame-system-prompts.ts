import { createHash } from "node:crypto";

import type { WorkbenchChatSession } from "./chat.js";
import type { WorkbenchFrameSystemPrompt, WorkbenchProject, WorkbenchResourceGroup } from "./types.js";

const STABLE_FRAME_PROMPT = [
	"You are Feynman, a standalone open-science research workbench.",
	"Use Feynman-owned sessions, artifacts, skills, connectors, compute, memory, provenance, and verification state.",
	"Produce auditable research artifacts, preserve source and execution provenance, and keep scientific claims tied to evidence.",
	"Claude Science is a reference blueprint only; normal Feynman behavior must not require or shell into ~/.claude-science.",
].join("\n");

type BuildWorkbenchFrameSystemPromptOptions = {
	projects: WorkbenchProject[];
	resources: WorkbenchResourceGroup[];
	sessions: WorkbenchChatSession[];
	workingDir: string;
};

function hashPayload(payload: WorkbenchFrameSystemPrompt["payload"]): string {
	return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function resourceSummary(resources: WorkbenchResourceGroup[]): string {
	return resources
		.map((group) => `${group.title}: ${group.resources.length}`)
		.join(", ");
}

function sessionConfigSummary(session: WorkbenchChatSession): string {
	const config = session.config;
	return [
		`delegation=${config.delegation ? "on" : "off"}`,
		`autoReview=${config.autoReview ? "on" : "off"}`,
		`memory=${config.memory ? "on" : "off"}`,
		`specialist=${config.specialist || "None"}`,
		`compute=${config.compute}`,
		`model=${config.model || "auto"}`,
	].join(", ");
}

function timestampMs(value: string): number {
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : Date.now();
}

export function buildWorkbenchFrameSystemPrompts({
	projects,
	resources,
	sessions,
	workingDir,
}: BuildWorkbenchFrameSystemPromptOptions): WorkbenchFrameSystemPrompt[] {
	return sessions
		.map((session) => {
			const project = projects.find((item) => item.id === session.projectId);
			const dynamic = [
				`Workspace: ${workingDir}`,
				`Project: ${project?.name ?? session.projectId}`,
				`Frame: ${session.id}`,
				`Session: ${session.title}`,
				`Status: ${session.status}`,
				`Config: ${sessionConfigSummary(session)}`,
				`Resource groups: ${resourceSummary(resources)}`,
			].join("\n");
			const payload = { stable: STABLE_FRAME_PROMPT, dynamic };
			return {
				frameId: session.id,
				hash: hashPayload(payload),
				payload,
				projectId: session.projectId,
				runSlug: session.id,
				sessionId: session.id,
				updatedAt: session.updatedAt,
				updatedAtMs: timestampMs(session.updatedAt),
			};
		})
		.sort((a, b) => b.updatedAtMs - a.updatedAtMs || a.frameId.localeCompare(b.frameId));
}
