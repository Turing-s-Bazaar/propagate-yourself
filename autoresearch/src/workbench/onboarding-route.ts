import { randomBytes } from "node:crypto";

import { ensureWorkbenchChatSession, updateWorkbenchChatSessionConfig } from "./chat.js";
import {
	buildOnboardingProjectContext,
	completeWorkbenchOnboardingProfile,
	onboardingSettingsRecords,
} from "./onboarding.js";
import { createWorkbenchProject } from "./projects.js";
import { buildWorkbenchState } from "./scan.js";
import { upsertWorkbenchSettingsRecord } from "./settings-store.js";

type WorkbenchOnboardingRouteOptions = {
	sessionDir?: string;
	version?: string;
	workingDir: string;
};

function newWorkbenchSessionId(): string {
	return `session-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`;
}

function stringField(body: Record<string, unknown>, key: string): string {
	const value = body[key];
	if (typeof value !== "string") throw new Error(`Missing ${key}.`);
	return value;
}

function optionalStringField(body: Record<string, unknown>, key: string): string | undefined {
	const value = body[key];
	return typeof value === "string" ? value : undefined;
}

function optionalStringArrayField(body: Record<string, unknown>, key: string): string[] {
	const value = body[key];
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function expectObject(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Missing ${name}.`);
	return value as Record<string, unknown>;
}

export function completeWorkbenchOnboardingFromRequest(
	options: WorkbenchOnboardingRouteOptions,
	body: Record<string, unknown>,
): unknown {
	const selectedTask = expectObject(body.selectedTask, "selectedTask");
	const input = {
		field: optionalStringField(body, "field"),
		goal: optionalStringField(body, "goal"),
		workflow: optionalStringField(body, "workflow"),
		dataTools: optionalStringArrayField(body, "dataTools"),
		bottlenecks: optionalStringArrayField(body, "bottlenecks"),
		notes: optionalStringField(body, "notes"),
		permissions: optionalStringArrayField(body, "permissions"),
		selectedTask: {
			title: stringField(selectedTask, "title"),
			description: stringField(selectedTask, "description"),
		},
		projectId: "",
		sessionId: "",
	};
	const project = createWorkbenchProject(options.workingDir, {
		name: input.selectedTask.title,
		description: input.selectedTask.description,
		agentContext: buildOnboardingProjectContext(input),
	});
	const session = ensureWorkbenchChatSession({ workingDir: options.workingDir, sessionDir: options.sessionDir }, {
		id: newWorkbenchSessionId(),
		projectId: project.id,
		title: input.selectedTask.title,
	});
	const completedInput = { ...input, projectId: project.id, sessionId: session.id };
	for (const record of onboardingSettingsRecords(completedInput)) {
		upsertWorkbenchSettingsRecord(options.workingDir, record);
	}
	const profile = completeWorkbenchOnboardingProfile(options.workingDir, completedInput);
	const configuredSession = updateWorkbenchChatSessionConfig({ workingDir: options.workingDir, sessionDir: options.sessionDir }, {
		id: session.id,
		projectId: project.id,
		title: input.selectedTask.title,
		config: {
			specialist: profile.suggestedSpecialist ?? "researcher",
			memory: profile.permissions.includes("memory"),
			compute: profile.computeDefault,
			autoReview: profile.bottlenecks.some((item) => /verify|citation|reproduc|trace|number/i.test(item)),
		},
	});
	return {
		onboarding: profile,
		project,
		session: configuredSession,
		state: buildWorkbenchState({ workingDir: options.workingDir, version: options.version }),
	};
}
