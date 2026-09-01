import { createHash } from "node:crypto";

import { readWorkbenchOnboardingProfile } from "./onboarding.js";
import type { WorkbenchOnboardingProfile, WorkbenchUseIntentDeclaration } from "./types.js";

const LOCAL_USER_ID = "local-workbench";
const LOCAL_ORG_ID = "local-workspace";
const FIXED_CREATED_AT = "1970-01-01T00:00:00.000Z";

function stableUuid(namespace: string, value: string): string {
	const bytes = createHash("sha256").update(`${namespace}:${value}`).digest().subarray(0, 16);
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function timestampMs(value: string): number {
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeIntent(value: string): string {
	return value.trim().replace(/\s+/g, " ").slice(0, 512);
}

function intentRow(intent: string, createdAt: string): WorkbenchUseIntentDeclaration | undefined {
	const normalized = normalizeIntent(intent);
	if (!normalized) return undefined;
	return {
		id: stableUuid("feynman-use-intent", `${LOCAL_USER_ID}:${normalized}`),
		userId: LOCAL_USER_ID,
		orgId: LOCAL_ORG_ID,
		intent: normalized,
		createdAt,
		createdAtMs: timestampMs(createdAt),
		source: "onboarding",
	};
}

function onboardingIntents(profile: WorkbenchOnboardingProfile): string[] {
	if (!profile.completed) return [];
	return [
		profile.field ? `field:${profile.field}` : "",
		profile.goal ? `goal:${profile.goal}` : "",
		profile.workflow ? `workflow:${profile.workflow}` : "",
		profile.selectedTask?.title ? `task:${profile.selectedTask.title}` : "",
		profile.suggestedSpecialist ? `specialist:${profile.suggestedSpecialist}` : "",
		`compute:${profile.computeDefault}`,
		...profile.dataTools.map((tool) => `tool:${tool}`),
		...profile.bottlenecks.map((bottleneck) => `bottleneck:${bottleneck}`),
		...profile.permissions.map((permission) => `permission:${permission}`),
		...profile.suggestedConnectors.map((connector) => `connector:${connector}`),
		...profile.suggestedSeedWorkflows.map((workflow) => `seed:${workflow}`),
	].filter(Boolean);
}

export function buildWorkbenchUseIntentDeclarations(workingDir: string): WorkbenchUseIntentDeclaration[] {
	const profile = readWorkbenchOnboardingProfile(workingDir);
	const createdAt = profile.createdAt ?? profile.updatedAt ?? FIXED_CREATED_AT;
	const seen = new Set<string>();
	return onboardingIntents(profile)
		.flatMap((intent) => {
			const normalized = normalizeIntent(intent);
			if (!normalized || seen.has(normalized)) return [];
			seen.add(normalized);
			const row = intentRow(normalized, createdAt);
			return row ? [row] : [];
		})
		.sort((a, b) => a.intent.localeCompare(b.intent));
}
