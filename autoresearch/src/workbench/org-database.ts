import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { getFeynmanOrgDatabasePath } from "../config/paths.js";
import { createReferenceLedgerTables, insertReferenceLedgerRows, REFERENCE_LEDGER_TABLE_NAMES } from "./org-database-ledgers.js";
import type { WorkbenchState } from "./types.js";

const ORG_DATABASE_SCHEMA_VERSION = 1;

type DatabaseRowValue = string | number | null;
type RunStatement = { run: (...values: DatabaseRowValue[]) => unknown };
type CountRow = { count: number };

export type WorkbenchOrgDatabaseSummary = {
	path: string;
	schemaVersion: number;
	updatedAt: string;
	counts: Record<string, number>;
};

const MIRRORED_TABLES = [
	"projects",
	"frames",
	"frame_messages",
	"artifacts",
	"artifact_versions",
	"execution_log",
	"verification_checks",
	"memories",
	"notes",
	"annotations",
	"frame_read_cursors",
	"artifact_folders",
	"compute_providers",
	"mcp_tool_grants",
	"memory_categories",
	"routine_schedules",
	"managed_endpoints",
	"capability_settings",
	...REFERENCE_LEDGER_TABLE_NAMES,
] as const;

function json(value: unknown): string | null {
	if (value === undefined) return null;
	return JSON.stringify(value);
}

function integer(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

function real(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bool(value: unknown): number {
	return value ? 1 : 0;
}

function text(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function execSchema(database: DatabaseSync): void {
	database.exec(`
CREATE TABLE IF NOT EXISTS __feynman_mirror_meta (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feynman_state_payloads (
	table_name TEXT NOT NULL,
	row_id TEXT NOT NULL,
	payload_json TEXT NOT NULL,
	updated_at INTEGER NOT NULL,
	PRIMARY KEY (table_name, row_id)
);

CREATE TABLE IF NOT EXISTS projects (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	description TEXT,
	context TEXT,
	created_at INTEGER,
	updated_at INTEGER,
	user_id TEXT,
	uploads_frame_id TEXT,
	memory_enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS frames (
	id TEXT PRIMARY KEY,
	parent_frame_id TEXT,
	root_frame_id TEXT NOT NULL,
	agent_name TEXT NOT NULL,
	status TEXT NOT NULL,
	input_data TEXT,
	output_data TEXT,
	context_data TEXT,
	model TEXT,
	effort TEXT,
	input_tokens INTEGER,
	output_tokens INTEGER,
	cache_read_tokens INTEGER,
	cache_write_tokens INTEGER,
	total_cost REAL,
	created_at INTEGER,
	updated_at INTEGER,
	completed_at INTEGER,
	project_id TEXT,
	name TEXT,
	conversation_type TEXT NOT NULL,
	artifact_id TEXT,
	task_summary TEXT,
	mentioned_artifact_ids TEXT,
	specialists_used TEXT,
	is_hidden INTEGER NOT NULL DEFAULT 0,
	status_description TEXT,
	compute_enabled TEXT,
	delegate_name TEXT,
	last_user_message_at INTEGER,
	last_extract_msg_idx INTEGER,
	root_seq INTEGER NOT NULL DEFAULT 0,
	aux_input_tokens INTEGER,
	aux_output_tokens INTEGER,
	aux_cache_read_tokens INTEGER,
	aux_cache_write_tokens INTEGER,
	aux_cost REAL,
	token_class_usage TEXT
);

CREATE TABLE IF NOT EXISTS frame_messages (
	frame_id TEXT NOT NULL,
	idx INTEGER NOT NULL,
	msg_json TEXT NOT NULL,
	PRIMARY KEY (frame_id, idx)
);

CREATE TABLE IF NOT EXISTS artifacts (
	id TEXT PRIMARY KEY,
	project_id TEXT,
	root_frame_id TEXT,
	frame_id TEXT,
	filename TEXT NOT NULL,
	created_at INTEGER,
	latest_version_id TEXT,
	is_user_upload INTEGER NOT NULL DEFAULT 0,
	is_ephemeral INTEGER NOT NULL DEFAULT 0,
	folder_id TEXT,
	sort_order INTEGER,
	priority INTEGER,
	superseded_by_artifact_id TEXT,
	consumed_at INTEGER,
	is_branch_mint INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS artifact_versions (
	id TEXT PRIMARY KEY,
	artifact_id TEXT NOT NULL,
	version_number INTEGER NOT NULL,
	frame_id TEXT,
	content_type TEXT NOT NULL,
	size_bytes INTEGER NOT NULL DEFAULT 0,
	checksum TEXT,
	storage_path TEXT,
	created_at INTEGER,
	extracted_code TEXT,
	code_description TEXT,
	lineage_messages TEXT,
	agent_name TEXT,
	language TEXT,
	is_intermediate INTEGER NOT NULL DEFAULT 0,
	dependency_mappings TEXT,
	environment_snapshot TEXT,
	annotations TEXT,
	parent_version_id TEXT,
	lineage_snapshot_hash TEXT,
	env_snapshot_hash TEXT,
	producing_cell_id TEXT,
	cell_sources TEXT,
	is_checkpoint INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS execution_log (
	id TEXT PRIMARY KEY,
	frame_id TEXT,
	cell_index INTEGER,
	kernel_id TEXT,
	conda_env TEXT,
	language TEXT,
	source TEXT,
	stdout TEXT,
	stderr TEXT,
	exit_status INTEGER,
	created_at INTEGER,
	files_written TEXT,
	error_lineno INTEGER,
	kernel_kind TEXT,
	origin TEXT,
	detection TEXT,
	files_read TEXT
);

CREATE TABLE IF NOT EXISTS verification_checks (
	id TEXT PRIMARY KEY,
	root_frame_id TEXT,
	artifact_version_id TEXT,
	claim_id TEXT,
	claim TEXT NOT NULL,
	verdict TEXT NOT NULL CHECK (verdict IN ('pass', 'warn', 'fail', 'inconclusive')),
	severity TEXT,
	evidence TEXT,
	rebuttal TEXT,
	reviewer_idx INTEGER,
	reviewer_model TEXT,
	reviewer_frame_id TEXT,
	source_ref TEXT,
	status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'unaddressed')),
	reflag_count INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER,
	reviewer_kind TEXT
);

CREATE TABLE IF NOT EXISTS memories (
	id TEXT PRIMARY KEY,
	user_id TEXT,
	body TEXT NOT NULL,
	subject_project_id TEXT,
	subject_artifact_id TEXT,
	subject_version_id TEXT,
	subject_frame_id TEXT,
	source_frame_id TEXT,
	origin TEXT NOT NULL,
	evidence TEXT NOT NULL,
	superseded_by TEXT,
	created_at INTEGER,
	updated_at INTEGER,
	last_surfaced_at INTEGER,
	category_id TEXT
);

CREATE TABLE IF NOT EXISTS notes (
	id TEXT PRIMARY KEY,
	project_id TEXT,
	user_id TEXT,
	target_type TEXT NOT NULL,
	target_frame_id TEXT,
	target_message_index INTEGER,
	target_artifact_id TEXT,
	content TEXT NOT NULL,
	created_at INTEGER,
	updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS annotations (
	id TEXT PRIMARY KEY,
	target_type TEXT NOT NULL,
	target_id TEXT NOT NULL,
	body TEXT NOT NULL,
	kind TEXT NOT NULL,
	anchor_kind TEXT,
	project_id TEXT,
	root_frame_id TEXT,
	message_index INTEGER,
	artifact_id TEXT,
	created_at INTEGER,
	updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS frame_read_cursors (
	root_frame_id TEXT PRIMARY KEY,
	message_id TEXT,
	message_index INTEGER NOT NULL DEFAULT 0,
	message_count INTEGER NOT NULL DEFAULT 0,
	project_id TEXT,
	run_slug TEXT,
	updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS artifact_folders (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL,
	parent_id TEXT,
	name TEXT NOT NULL,
	sort_order INTEGER NOT NULL DEFAULT 0,
	root_frame_id TEXT,
	is_conversation_folder INTEGER NOT NULL DEFAULT 0,
	is_user_uploads_folder INTEGER NOT NULL DEFAULT 0,
	artifact_count INTEGER,
	created_at INTEGER,
	updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS compute_providers (
	name TEXT PRIMARY KEY,
	display_name TEXT NOT NULL,
	family TEXT NOT NULL,
	status TEXT NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 0,
	tier_type TEXT NOT NULL,
	settings_collection TEXT,
	settings_record_id TEXT,
	probed_at INTEGER,
	egress_policy TEXT,
	modal_environment TEXT
);

CREATE TABLE IF NOT EXISTS mcp_tool_grants (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	server_id TEXT NOT NULL,
	tool_name TEXT NOT NULL,
	decision TEXT NOT NULL,
	name TEXT NOT NULL,
	scope TEXT NOT NULL,
	description TEXT,
	settings_record_id TEXT,
	created_at INTEGER
);

CREATE TABLE IF NOT EXISTS memory_categories (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	name TEXT NOT NULL,
	name_lower TEXT NOT NULL,
	guidance TEXT,
	auto_recall INTEGER NOT NULL DEFAULT 0,
	settings_record_id TEXT,
	created_at INTEGER,
	updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS routine_schedules (
	id TEXT PRIMARY KEY,
	root_frame_id TEXT NOT NULL,
	owner_user_id TEXT NOT NULL,
	label TEXT,
	on_tick TEXT NOT NULL,
	every_minutes INTEGER NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 0,
	next_due INTEGER,
	tick_count INTEGER NOT NULL DEFAULT 0,
	missed_ticks INTEGER NOT NULL DEFAULT 0,
	last_fire_at INTEGER,
	last_ok_at INTEGER,
	paused_reason TEXT,
	source TEXT NOT NULL,
	created_at INTEGER,
	updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS managed_endpoints (
	name TEXT PRIMARY KEY,
	url TEXT NOT NULL,
	port INTEGER NOT NULL,
	credential_name TEXT,
	skill_name TEXT NOT NULL,
	live_path TEXT NOT NULL,
	state TEXT NOT NULL,
	state_changed_at INTEGER,
	last_error TEXT,
	provider TEXT NOT NULL,
	models TEXT NOT NULL,
	status TEXT NOT NULL,
	created_at INTEGER
);

CREATE TABLE IF NOT EXISTS capability_settings (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	key TEXT NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 0,
	status TEXT NOT NULL,
	source TEXT NOT NULL,
	settings_collection TEXT,
	settings_record_id TEXT,
	updated_at INTEGER
);
`);
	ensureColumn(database, "compute_providers", "egress_policy", "TEXT");
	ensureColumn(database, "compute_providers", "modal_environment", "TEXT");
	createReferenceLedgerTables(database);
}

function ensureColumn(database: DatabaseSync, tableName: string, columnName: string, definition: string): void {
	const columns = database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
	if (columns.some((column) => column.name === columnName)) return;
	database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

function clearMirroredTables(database: DatabaseSync): void {
	for (const table of [...MIRRORED_TABLES].reverse()) {
		database.exec(`DELETE FROM ${table}`);
	}
	database.exec("DELETE FROM feynman_state_payloads");
}

function insertPayload(database: DatabaseSync, tableName: string, rowId: string, payload: unknown, updatedAt: number): void {
	const insert = database.prepare(`
INSERT OR REPLACE INTO feynman_state_payloads (table_name, row_id, payload_json, updated_at)
VALUES (?, ?, ?, ?)
`) as RunStatement;
	insert.run(tableName, rowId, JSON.stringify(payload), updatedAt);
}

function insertRows(database: DatabaseSync, state: WorkbenchState): void {
	const projectInsert = database.prepare(`
INSERT OR REPLACE INTO projects (id, name, description, context, created_at, updated_at, user_id, uploads_frame_id, memory_enabled)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`) as RunStatement;
	for (const project of state.projects) {
		projectInsert.run(project.id, project.name, project.description, text(project.context), project.createdAtMs, project.updatedAtMs, project.userId, project.uploadsFrameId, bool(project.memoryEnabled));
		insertPayload(database, "projects", project.id, project, project.updatedAtMs);
	}

	const frameInsert = database.prepare(`
INSERT OR REPLACE INTO frames (
	id, parent_frame_id, root_frame_id, agent_name, status, input_data, output_data, context_data, model, effort,
	input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_cost, created_at, updated_at, completed_at,
	project_id, name, conversation_type, artifact_id, task_summary, mentioned_artifact_ids, specialists_used, is_hidden,
	status_description, compute_enabled, delegate_name, last_user_message_at, last_extract_msg_idx, root_seq,
	aux_input_tokens, aux_output_tokens, aux_cache_read_tokens, aux_cache_write_tokens, aux_cost, token_class_usage
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`) as RunStatement;
	for (const frame of state.frames) {
		frameInsert.run(
			frame.id,
			text(frame.parentFrameId),
			frame.rootFrameId,
			frame.agentName,
			frame.status,
			text(frame.inputData),
			text(frame.outputData),
			text(frame.contextData),
			text(frame.model),
			text(frame.effort),
			integer(frame.inputTokens),
			integer(frame.outputTokens),
			integer(frame.cacheReadTokens),
			integer(frame.cacheWriteTokens),
			real(frame.totalCost),
			frame.createdAtMs,
			frame.updatedAtMs,
			integer(frame.completedAtMs),
			text(frame.projectId),
			text(frame.name),
			frame.conversationType,
			text(frame.artifactId),
			text(frame.taskSummary),
			text(frame.mentionedArtifactIds),
			text(frame.specialistsUsed),
			bool(frame.isHidden),
			text(frame.statusDescription),
			text(frame.computeEnabled),
			text(frame.delegateName),
			integer(frame.lastUserMessageAtMs),
			integer(frame.lastExtractMsgIdx),
			frame.rootSeq,
			integer(frame.auxInputTokens),
			integer(frame.auxOutputTokens),
			integer(frame.auxCacheReadTokens),
			integer(frame.auxCacheWriteTokens),
			real(frame.auxCost),
			text(frame.tokenClassUsage),
		);
		insertPayload(database, "frames", frame.id, frame, frame.updatedAtMs);
	}

	const messageInsert = database.prepare(`
INSERT OR REPLACE INTO frame_messages (frame_id, idx, msg_json)
VALUES (?, ?, ?)
`) as RunStatement;
	for (const message of state.frameMessages) {
		messageInsert.run(message.frameId, message.idx, message.msgJson);
		insertPayload(database, "frame_messages", `${message.frameId}:${message.idx}`, message, message.createdAtMs);
	}

	const artifactInsert = database.prepare(`
INSERT OR REPLACE INTO artifacts (
	id, project_id, root_frame_id, frame_id, filename, created_at, latest_version_id, is_user_upload,
	is_ephemeral, folder_id, sort_order, priority, superseded_by_artifact_id, consumed_at, is_branch_mint
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`) as RunStatement;
	for (const artifact of state.artifacts) {
		const latest = state.artifactVersions.find((version) => version.artifactPath === artifact.path);
		const project = state.projects.find((candidate) => candidate.artifactPaths.includes(artifact.path));
		artifactInsert.run(
			artifact.path,
			text(project?.id),
			text(project?.primaryRunSlug),
			text(latest?.producerExecutionId),
			artifact.name,
			artifact.updatedAtMs,
			text(latest?.id),
			0,
			0,
			null,
			null,
			artifact.starred ? 1 : 0,
			null,
			null,
			0,
		);
		insertPayload(database, "artifacts", artifact.path, artifact, artifact.updatedAtMs);
	}

	const versionInsert = database.prepare(`
INSERT OR REPLACE INTO artifact_versions (
	id, artifact_id, version_number, frame_id, content_type, size_bytes, checksum, storage_path, created_at,
	extracted_code, code_description, lineage_messages, agent_name, language, is_intermediate, dependency_mappings,
	environment_snapshot, annotations, parent_version_id, lineage_snapshot_hash, env_snapshot_hash, producing_cell_id,
	cell_sources, is_checkpoint
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`) as RunStatement;
	for (const version of state.artifactVersions) {
		versionInsert.run(
			version.id,
			version.artifactPath,
			version.versionNumber,
			text(version.producerExecutionId),
			version.contentType,
			version.sizeBytes,
			text(version.checksum),
			text(version.snapshotPath ?? version.artifactPath),
			version.createdAtMs,
			text(version.code),
			text(version.codeDescription),
			json(version.messages),
			text(version.agentName),
			text(version.language),
			bool(version.isIntermediate),
			json({ inputPaths: version.inputPaths, outputPaths: version.outputPaths }),
			json({ environment: version.environment, environmentDetails: version.environmentDetails }),
			json(version.annotations),
			text(version.parentVersionId),
			text(version.snapshotId),
			text(version.previousChecksum),
			text(version.producerSourceId),
			json(version.outputPaths),
			bool(version.isCheckpoint),
		);
		insertPayload(database, "artifact_versions", version.id, version, version.createdAtMs);
	}

	const executionInsert = database.prepare(`
INSERT OR REPLACE INTO execution_log (
	id, frame_id, cell_index, kernel_id, conda_env, language, source, stdout, stderr, exit_status, created_at,
	files_written, error_lineno, kernel_kind, origin, detection, files_read
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`) as RunStatement;
	for (const execution of state.execution) {
		executionInsert.run(
			execution.id,
			text(execution.sessionId ?? execution.runSlug),
			null,
			text(execution.sourceId),
			text(execution.environment),
			text(execution.language ?? execution.kind),
			text(execution.code ?? execution.detail),
			null,
			execution.status === "error" ? text(execution.details) : null,
			execution.status === "error" ? 1 : 0,
			execution.createdAtMs,
			json(execution.outputPaths),
			null,
			text(execution.kind),
			execution.origin,
			json({ purpose: execution.purpose, status: execution.status, title: execution.title }),
			json(execution.inputPaths),
		);
		insertPayload(database, "execution_log", execution.id, execution, execution.createdAtMs);
	}

	const checkInsert = database.prepare(`
INSERT OR REPLACE INTO verification_checks (
	id, root_frame_id, artifact_version_id, claim_id, claim, verdict, severity, evidence, rebuttal, reviewer_idx,
	reviewer_model, reviewer_frame_id, source_ref, status, reflag_count, created_at, reviewer_kind
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`) as RunStatement;
	for (const check of state.checks) {
		checkInsert.run(
			check.id,
			text(check.sessionId ?? check.runSlug),
			text(check.executionId),
			text(check.claimId),
			check.claim,
			check.status,
			check.status === "fail" ? "high" : check.status === "inconclusive" ? "medium" : "info",
			json(check.evidencePaths),
			text(check.detail),
			null,
			null,
			null,
			text(check.executionId),
			check.status === "pass" ? "resolved" : "open",
			0,
			check.createdAtMs,
			"feynman",
		);
		insertPayload(database, "verification_checks", check.id, check, check.createdAtMs);
	}

	const memoryInsert = database.prepare(`
INSERT OR REPLACE INTO memories (
	id, user_id, body, subject_project_id, subject_artifact_id, subject_version_id, subject_frame_id, source_frame_id,
	origin, evidence, superseded_by, created_at, updated_at, last_surfaced_at, category_id
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`) as RunStatement;
	for (const memory of state.memories) {
		memoryInsert.run(
			memory.id,
			"local",
			memory.body,
			text(memory.projectId),
			text(memory.artifactPath),
			null,
			text(memory.sessionId),
			text(memory.sessionId),
			memory.origin,
			memory.evidence,
			null,
			Date.parse(memory.createdAt) || null,
			Date.parse(memory.updatedAt) || null,
			null,
			text(memory.categoryId),
		);
		insertPayload(database, "memories", memory.id, memory, Date.parse(memory.updatedAt) || Date.parse(memory.createdAt) || 0);
	}

	const noteInsert = database.prepare(`
INSERT OR REPLACE INTO notes (
	id, project_id, user_id, target_type, target_frame_id, target_message_index, target_artifact_id, content, created_at, updated_at
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`) as RunStatement;
	for (const note of state.notes) {
		noteInsert.run(
			note.id,
			text(note.projectId),
			"local",
			note.targetType,
			text(note.targetFrameId),
			integer(note.targetMessageIndex),
			text(note.targetArtifactPath),
			note.content,
			Date.parse(note.createdAt) || null,
			Date.parse(note.updatedAt) || null,
		);
		insertPayload(database, "notes", note.id, note, Date.parse(note.updatedAt) || Date.parse(note.createdAt) || 0);
	}

	const annotationInsert = database.prepare(`
INSERT OR REPLACE INTO annotations (
	id, target_type, target_id, body, kind, anchor_kind, project_id, root_frame_id, message_index, artifact_id, created_at, updated_at
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`) as RunStatement;
	for (const annotation of state.artifactAnnotations) {
		annotationInsert.run(
			annotation.id,
			"artifact",
			annotation.targetKey,
			annotation.body,
			annotation.kind,
			text(annotation.anchorKind),
			text(annotation.projectId),
			text(annotation.runSlug ?? annotation.sessionId),
			null,
			annotation.artifactPath,
			annotation.createdAtMs,
			annotation.updatedAtMs,
		);
		insertPayload(database, "annotations", annotation.id, annotation, annotation.updatedAtMs);
	}
	for (const annotation of state.transcriptAnnotations) {
		annotationInsert.run(
			annotation.id,
			"message",
			annotation.messageUuid ?? `${annotation.rootFrameId}:${annotation.messageIndex}:${annotation.blockIndex}`,
			annotation.note,
			annotation.kind,
			"text_selection",
			text(annotation.projectId),
			annotation.rootFrameId,
			annotation.messageIndex,
			null,
			annotation.createdAtMs,
			annotation.updatedAtMs,
		);
		insertPayload(database, "annotations", annotation.id, annotation, annotation.updatedAtMs);
	}

	const cursorInsert = database.prepare(`
INSERT OR REPLACE INTO frame_read_cursors (root_frame_id, message_id, message_index, message_count, project_id, run_slug, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?)
`) as RunStatement;
	for (const cursor of state.frameReadCursors) {
		cursorInsert.run(cursor.rootFrameId, text(cursor.messageId), cursor.messageIndex, cursor.messageCount, text(cursor.projectId), text(cursor.runSlug), cursor.updatedAtMs);
		insertPayload(database, "frame_read_cursors", cursor.rootFrameId, cursor, cursor.updatedAtMs);
	}

	const folderInsert = database.prepare(`
INSERT OR REPLACE INTO artifact_folders (
	id, project_id, parent_id, name, sort_order, root_frame_id, is_conversation_folder, is_user_uploads_folder, artifact_count, created_at, updated_at
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`) as RunStatement;
	for (const folder of state.artifactFolders) {
		folderInsert.run(
			folder.id,
			folder.projectId,
			text(folder.parentId),
			folder.name,
			folder.sortOrder,
			text(folder.rootFrameId),
			bool(folder.isConversationFolder),
			bool(folder.isUserUploadsFolder),
			integer(folder.artifactCount),
			folder.createdAtMs,
			folder.updatedAtMs,
		);
		insertPayload(database, "artifact_folders", folder.id, folder, folder.updatedAtMs);
	}

	const computeProviderInsert = database.prepare(`
INSERT OR REPLACE INTO compute_providers (
	name, display_name, family, status, enabled, tier_type, settings_collection, settings_record_id, probed_at, egress_policy, modal_environment
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`) as RunStatement;
	for (const provider of state.computeProviders) {
		computeProviderInsert.run(
			provider.name,
			provider.displayName,
			provider.family,
			provider.status,
			bool(provider.enabled),
			provider.tierType,
			text(provider.settingsCollection),
			text(provider.settingsRecordId),
			integer(provider.probedAtMs),
			text(provider.egressPolicy),
			text(provider.modalEnvironment),
		);
		insertPayload(database, "compute_providers", provider.name, provider, provider.probedAtMs ?? 0);
	}

	const mcpGrantInsert = database.prepare(`
INSERT OR REPLACE INTO mcp_tool_grants (
	id, user_id, server_id, tool_name, decision, name, scope, description, settings_record_id, created_at
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`) as RunStatement;
	for (const grant of state.mcpToolGrants) {
		mcpGrantInsert.run(grant.id, grant.userId, grant.serverId, grant.toolName, grant.decision, grant.name, grant.scope, text(grant.description), grant.settingsRecordId, grant.createdAtMs);
		insertPayload(database, "mcp_tool_grants", grant.id, grant, grant.createdAtMs);
	}

	const categoryInsert = database.prepare(`
INSERT OR REPLACE INTO memory_categories (
	id, user_id, name, name_lower, guidance, auto_recall, settings_record_id, created_at, updated_at
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`) as RunStatement;
	for (const category of state.memoryCategories) {
		categoryInsert.run(category.id, category.userId, category.name, category.nameLower, category.guidance, bool(category.autoRecall), category.settingsRecordId, category.createdAtMs, category.updatedAtMs);
		insertPayload(database, "memory_categories", category.id, category, category.updatedAtMs);
	}

	const routineInsert = database.prepare(`
INSERT OR REPLACE INTO routine_schedules (
	id, root_frame_id, owner_user_id, label, on_tick, every_minutes, enabled, next_due, tick_count,
	missed_ticks, last_fire_at, last_ok_at, paused_reason, source, created_at, updated_at
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`) as RunStatement;
	for (const routine of state.routineSchedules) {
		routineInsert.run(
			routine.id,
			routine.rootFrameId,
			routine.ownerUserId,
			text(routine.label),
			routine.onTick,
			routine.everyMinutes,
			bool(routine.enabled),
			routine.nextDueMs,
			routine.tickCount,
			routine.missedTicks,
			integer(routine.lastFireAtMs),
			integer(routine.lastOkAtMs),
			text(routine.pausedReason),
			routine.source,
			routine.createdAtMs,
			routine.updatedAtMs,
		);
		insertPayload(database, "routine_schedules", routine.id, routine, routine.updatedAtMs);
	}

	const endpointInsert = database.prepare(`
INSERT OR REPLACE INTO managed_endpoints (
	name, url, port, credential_name, skill_name, live_path, state, state_changed_at, last_error, provider, models, status, created_at
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`) as RunStatement;
	for (const endpoint of state.managedEndpoints) {
		endpointInsert.run(
			endpoint.name,
			endpoint.url,
			endpoint.port,
			text(endpoint.credentialName),
			endpoint.skillName,
			endpoint.livePath,
			endpoint.state,
			integer(endpoint.stateChangedAtMs),
			text(endpoint.lastError),
			endpoint.provider,
			json(endpoint.models),
			endpoint.status,
			endpoint.createdAtMs,
		);
		insertPayload(database, "managed_endpoints", endpoint.name, endpoint, endpoint.stateChangedAtMs ?? endpoint.createdAtMs);
	}

	const capabilityInsert = database.prepare(`
INSERT OR REPLACE INTO capability_settings (
	id, user_id, kind, key, enabled, status, source, settings_collection, settings_record_id, updated_at
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`) as RunStatement;
	for (const setting of state.capabilitySettings) {
		const id = `${setting.userId}:${setting.kind}:${setting.key}`;
		capabilityInsert.run(
			id,
			setting.userId,
			setting.kind,
			setting.key,
			bool(setting.enabled),
			setting.status,
			setting.source,
			text(setting.settingsCollection),
			text(setting.settingsRecordId),
			setting.updatedAtMs,
		);
		insertPayload(database, "capability_settings", id, setting, setting.updatedAtMs);
	}
	insertReferenceLedgerRows(database, state, (tableName, rowId, payload, updatedAt) => insertPayload(database, tableName, rowId, payload, updatedAt));
}

function readCounts(database: DatabaseSync): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const table of MIRRORED_TABLES) {
		const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as CountRow;
		counts[table] = row.count;
	}
	return counts;
}

export function ensureWorkbenchOrgDatabase(path = getFeynmanOrgDatabasePath()): string {
	mkdirSync(dirname(path), { recursive: true });
	const database = new DatabaseSync(path);
	try {
		execSchema(database);
		database.prepare("INSERT OR REPLACE INTO __feynman_mirror_meta (key, value) VALUES (?, ?)").run("schema_version", String(ORG_DATABASE_SCHEMA_VERSION));
	} finally {
		database.close();
	}
	return path;
}

export function materializeWorkbenchOrgDatabase(state: WorkbenchState, path = getFeynmanOrgDatabasePath()): WorkbenchOrgDatabaseSummary {
	mkdirSync(dirname(path), { recursive: true });
	const updatedAt = state.generatedAt;
	const database = new DatabaseSync(path);
	try {
		execSchema(database);
		database.exec("BEGIN IMMEDIATE");
		try {
			clearMirroredTables(database);
			insertRows(database, state);
			const meta = database.prepare("INSERT OR REPLACE INTO __feynman_mirror_meta (key, value) VALUES (?, ?)") as RunStatement;
			meta.run("schema_version", String(ORG_DATABASE_SCHEMA_VERSION));
			meta.run("updated_at", updatedAt);
			meta.run("workspace_path", state.workspacePath);
			database.exec("COMMIT");
		} catch (error) {
			database.exec("ROLLBACK");
			throw error;
		}
		return {
			path,
			schemaVersion: ORG_DATABASE_SCHEMA_VERSION,
			updatedAt,
			counts: readCounts(database),
		};
	} finally {
		database.close();
	}
}
