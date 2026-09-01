import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { WorkbenchState } from "../src/workbench/types.js";

const REFERENCE_TABLES = [
	"agent_skill_assignments",
	"agents",
	"annotations",
	"anthropic_api_keys",
	"artifact_dependencies",
	"artifact_folders",
	"artifact_versions",
	"artifacts",
	"bundled_agent_settings",
	"capability_settings",
	"cloud_credentials",
	"compaction_archives",
	"compute_pending_terminate",
	"compute_providers",
	"compute_usage",
	"contact_email_decisions",
	"content_snapshots",
	"credential_ask_decisions",
	"custom_agent_prompts",
	"custom_mcp_servers",
	"custom_skills",
	"directory_attachments",
	"events",
	"execution_log",
	"frame_backfill_poison",
	"frame_branch_archives",
	"frame_messages",
	"frame_read_cursors",
	"frame_system_prompts",
	"frames",
	"host_call_log",
	"host_grants",
	"managed_endpoints",
	"marketplace_sources",
	"mcp_agent_assignments",
	"mcp_tool_grants",
	"memories",
	"memory_categories",
	"notes",
	"notifications",
	"oauth_tokens",
	"poller_lease",
	"projects",
	"queued_user_messages",
	"routine_schedules",
	"safety_feedback",
	"session_claims",
	"session_concurrency",
	"session_seen_marks",
	"skill_license_assents",
	"transcript_annotations",
	"use_intent_declarations",
	"user_agents",
	"user_secrets",
	"verification_checks",
] as const;

const TABLE_TO_STATE_KEY: Record<(typeof REFERENCE_TABLES)[number], keyof WorkbenchState> = {
	agent_skill_assignments: "agentSkillAssignments",
	agents: "agents",
	annotations: "artifactAnnotations",
	anthropic_api_keys: "anthropicApiKeys",
	artifact_dependencies: "artifactDependencies",
	artifact_folders: "artifactFolders",
	artifact_versions: "artifactVersions",
	artifacts: "artifacts",
	bundled_agent_settings: "bundledAgentSettings",
	capability_settings: "capabilitySettings",
	cloud_credentials: "cloudCredentials",
	compaction_archives: "compactionArchives",
	compute_pending_terminate: "computePendingTerminates",
	compute_providers: "computeProviders",
	compute_usage: "computeUsage",
	contact_email_decisions: "contactEmailDecisions",
	content_snapshots: "contentSnapshots",
	credential_ask_decisions: "credentialAskDecisions",
	custom_agent_prompts: "customAgentPrompts",
	custom_mcp_servers: "customMcpServers",
	custom_skills: "customSkills",
	directory_attachments: "directoryAttachments",
	events: "events",
	execution_log: "execution",
	frame_backfill_poison: "frameBackfillPoison",
	frame_branch_archives: "frameBranchArchives",
	frame_messages: "frameMessages",
	frame_read_cursors: "frameReadCursors",
	frame_system_prompts: "frameSystemPrompts",
	frames: "frames",
	host_call_log: "hostCallLog",
	host_grants: "hostGrants",
	managed_endpoints: "managedEndpoints",
	marketplace_sources: "marketplaceSources",
	mcp_agent_assignments: "mcpAgentAssignments",
	mcp_tool_grants: "mcpToolGrants",
	memories: "memories",
	memory_categories: "memoryCategories",
	notes: "notes",
	notifications: "notifications",
	oauth_tokens: "oauthTokens",
	poller_lease: "pollerLeases",
	projects: "projects",
	queued_user_messages: "queuedUserMessages",
	routine_schedules: "routineSchedules",
	safety_feedback: "safetyFeedback",
	session_claims: "claims",
	session_concurrency: "sessionConcurrency",
	session_seen_marks: "sessionSeenMarks",
	skill_license_assents: "skillLicenseAssents",
	transcript_annotations: "transcriptAnnotations",
	use_intent_declarations: "useIntentDeclarations",
	user_agents: "userAgents",
	user_secrets: "userSecrets",
	verification_checks: "checks",
};

test("reference workbench tables have Feynman-owned state coverage", () => {
	assert.equal(new Set(REFERENCE_TABLES).size, REFERENCE_TABLES.length);
	assert.deepEqual(Object.keys(TABLE_TO_STATE_KEY).sort(), [...REFERENCE_TABLES].sort());
	assert.equal(TABLE_TO_STATE_KEY.frame_backfill_poison, "frameBackfillPoison");
	assert.equal(TABLE_TO_STATE_KEY.projects, "projects");
	assert.equal(TABLE_TO_STATE_KEY.frames, "frames");
	assert.equal(TABLE_TO_STATE_KEY.frame_messages, "frameMessages");
	assert.equal(TABLE_TO_STATE_KEY.session_claims, "claims");
	assert.equal(TABLE_TO_STATE_KEY.verification_checks, "checks");
});

test("reference legacy create-drop migrations stay absent from Feynman state", () => {
	const orgDatabaseSource = readFileSync(new URL("../src/workbench/org-database.ts", import.meta.url), "utf8");
	assert.equal(REFERENCE_TABLES.includes("canvas_drafts" as never), false);
	assert.equal("canvasDrafts" in ({} as WorkbenchState), false);
	assert.equal(orgDatabaseSource.includes("canvas_drafts"), false);
	assert.equal(orgDatabaseSource.includes("child_landed"), false);
});
