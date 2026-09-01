import type { DatabaseSync } from "node:sqlite";

import type { WorkbenchState } from "./types.js";

type DatabaseRowValue = string | number | null;
type RunStatement = { run: (...values: DatabaseRowValue[]) => unknown };

type ReferenceLedgerTable = {
	tableName: string;
	stateKey: keyof WorkbenchState;
};

export const REFERENCE_LEDGER_TABLES: ReferenceLedgerTable[] = [
	{ tableName: "agent_skill_assignments", stateKey: "agentSkillAssignments" },
	{ tableName: "agents", stateKey: "agents" },
	{ tableName: "anthropic_api_keys", stateKey: "anthropicApiKeys" },
	{ tableName: "artifact_dependencies", stateKey: "artifactDependencies" },
	{ tableName: "bundled_agent_settings", stateKey: "bundledAgentSettings" },
	{ tableName: "cloud_credentials", stateKey: "cloudCredentials" },
	{ tableName: "compaction_archives", stateKey: "compactionArchives" },
	{ tableName: "compute_pending_terminate", stateKey: "computePendingTerminates" },
	{ tableName: "compute_usage", stateKey: "computeUsage" },
	{ tableName: "contact_email_decisions", stateKey: "contactEmailDecisions" },
	{ tableName: "content_snapshots", stateKey: "contentSnapshots" },
	{ tableName: "credential_ask_decisions", stateKey: "credentialAskDecisions" },
	{ tableName: "custom_agent_prompts", stateKey: "customAgentPrompts" },
	{ tableName: "custom_mcp_servers", stateKey: "customMcpServers" },
	{ tableName: "custom_skills", stateKey: "customSkills" },
	{ tableName: "directory_attachments", stateKey: "directoryAttachments" },
	{ tableName: "events", stateKey: "events" },
	{ tableName: "frame_backfill_poison", stateKey: "frameBackfillPoison" },
	{ tableName: "frame_branch_archives", stateKey: "frameBranchArchives" },
	{ tableName: "frame_system_prompts", stateKey: "frameSystemPrompts" },
	{ tableName: "host_call_log", stateKey: "hostCallLog" },
	{ tableName: "host_grants", stateKey: "hostGrants" },
	{ tableName: "marketplace_sources", stateKey: "marketplaceSources" },
	{ tableName: "mcp_agent_assignments", stateKey: "mcpAgentAssignments" },
	{ tableName: "notifications", stateKey: "notifications" },
	{ tableName: "oauth_tokens", stateKey: "oauthTokens" },
	{ tableName: "poller_lease", stateKey: "pollerLeases" },
	{ tableName: "queued_user_messages", stateKey: "queuedUserMessages" },
	{ tableName: "safety_feedback", stateKey: "safetyFeedback" },
	{ tableName: "session_claims", stateKey: "claims" },
	{ tableName: "session_concurrency", stateKey: "sessionConcurrency" },
	{ tableName: "session_seen_marks", stateKey: "sessionSeenMarks" },
	{ tableName: "skill_license_assents", stateKey: "skillLicenseAssents" },
	{ tableName: "transcript_annotations", stateKey: "transcriptAnnotations" },
	{ tableName: "use_intent_declarations", stateKey: "useIntentDeclarations" },
	{ tableName: "user_agents", stateKey: "userAgents" },
	{ tableName: "user_secrets", stateKey: "userSecrets" },
];

export const REFERENCE_LEDGER_TABLE_NAMES = REFERENCE_LEDGER_TABLES.map((table) => table.tableName);

export function createReferenceLedgerTables(database: DatabaseSync): void {
	for (const table of REFERENCE_LEDGER_TABLES) {
		database.exec(`
CREATE TABLE IF NOT EXISTS ${table.tableName} (
	id TEXT PRIMARY KEY,
	updated_at INTEGER,
	payload_json TEXT NOT NULL
);
`);
	}
}

function objectRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" && value ? value : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
	const value = record[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function rowId(tableName: string, record: Record<string, unknown>, index: number): string {
	return stringField(record, "id")
		?? stringField(record, "hash")
		?? stringField(record, "name")
		?? stringField(record, "key")
		?? stringField(record, "rootFrameId")
		?? stringField(record, "frameId")
		?? stringField(record, "serverUuid")
		?? `${tableName}:${index}`;
}

function rowUpdatedAt(record: Record<string, unknown>): number | null {
	return numberField(record, "updatedAtMs")
		?? numberField(record, "createdAtMs")
		?? numberField(record, "lastImportedAtMs")
		?? numberField(record, "startedAtMs")
		?? numberField(record, "enqueuedAtMs")
		?? numberField(record, "expiresAtMs")
		?? null;
}

export function insertReferenceLedgerRows(
	database: DatabaseSync,
	state: WorkbenchState,
	insertPayload: (tableName: string, rowId: string, payload: unknown, updatedAt: number) => void,
): void {
	for (const table of REFERENCE_LEDGER_TABLES) {
		const rows = state[table.stateKey];
		if (!Array.isArray(rows)) continue;
		const insert = database.prepare(`
INSERT OR REPLACE INTO ${table.tableName} (id, updated_at, payload_json)
VALUES (?, ?, ?)
`) as RunStatement;
		rows.forEach((row, index) => {
			const record = objectRecord(row);
			const id = rowId(table.tableName, record, index);
			const updatedAt = rowUpdatedAt(record);
			insert.run(id, updatedAt, JSON.stringify(row));
			insertPayload(table.tableName, id, row, updatedAt ?? 0);
		});
	}
}

