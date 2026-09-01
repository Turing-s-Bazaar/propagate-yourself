import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { getFeynmanOrgDatabasePath } from "../src/config/paths.js";
import { REFERENCE_LEDGER_TABLE_NAMES } from "../src/workbench/org-database-ledgers.js";
import { materializeWorkbenchOrgDatabase } from "../src/workbench/org-database.js";
import { buildWorkbenchState } from "../src/workbench/scan.js";
import type { WorkbenchState } from "../src/workbench/types.js";

function withFeynmanHome<T>(homeParent: string, callback: () => T): T {
	const previousHome = process.env.FEYNMAN_HOME;
	const previousWorkbenchHome = process.env.FEYNMAN_WORKBENCH_HOME;
	try {
		process.env.FEYNMAN_HOME = homeParent;
		delete process.env.FEYNMAN_WORKBENCH_HOME;
		return callback();
	} finally {
		if (previousHome === undefined) {
			delete process.env.FEYNMAN_HOME;
		} else {
			process.env.FEYNMAN_HOME = previousHome;
		}
		if (previousWorkbenchHome === undefined) {
			delete process.env.FEYNMAN_WORKBENCH_HOME;
		} else {
			process.env.FEYNMAN_WORKBENCH_HOME = previousWorkbenchHome;
		}
	}
}

function emptyState(partial: Partial<WorkbenchState>): WorkbenchState {
	return {
		workspacePath: "/tmp/feynman-workspace",
		workspaceName: "feynman-workspace",
		generatedAt: "2026-07-04T12:00:00.000Z",
		summary: {
			activityCount: 0,
			artifactCount: 0,
			transcriptAnnotationCount: 0,
			claimCount: 0,
			notificationCount: 0,
			projectCount: 0,
			queuedMessageCount: 0,
			runCount: 0,
			outputCount: 0,
			paperCount: 0,
			planCount: 0,
			unreadActivityCount: 0,
			verificationCount: 0,
			provenanceCount: 0,
			noteCount: 0,
		},
		onboarding: {
			completed: false,
			dataTools: [],
			bottlenecks: [],
			permissions: [],
			suggestedConnectors: [],
			suggestedSeedWorkflows: [],
			computeDefault: "local",
		},
		projects: [],
		runs: [],
		artifacts: [],
		artifactActions: [],
		cloudExportTargets: [],
		artifactVersions: [],
		artifactAnnotations: [],
		transcriptAnnotations: [],
		frameReadCursors: [],
		memories: [],
		notes: [],
		safetyFeedback: [],
		plans: [],
		notebook: [],
		execution: [],
		checks: [],
		claims: [],
		events: [],
		notifications: [],
		queuedUserMessages: [],
		frameSystemPrompts: [],
		frames: [],
		frameMessages: [],
		frameBackfillPoison: [],
		artifactDependencies: [],
		artifactFolders: [],
		contentSnapshots: [],
		capabilitySettings: [],
		cloudCredentials: [],
		computeProviders: [],
		computeUsage: [],
		computePendingTerminates: [],
		pollerLeases: [],
		managedEndpoints: [],
		marketplaceSources: [],
		skillLicenseAssents: [],
		routineSchedules: [],
		oauthTokens: [],
		userSecrets: [],
		anthropicApiKeys: [],
		contactEmailDecisions: [],
		credentialAskDecisions: [],
		useIntentDeclarations: [],
		hostCallLog: [],
		hostGrants: [],
		sessionConcurrency: [],
		compactionArchives: [],
		frameBranchArchives: [],
		directoryAttachments: [],
		mcpToolGrants: [],
		customMcpServers: [],
		mcpAgentAssignments: [],
		agents: [],
		bundledAgentSettings: [],
		customSkills: [],
		agentSkillAssignments: [],
		customAgentPrompts: [],
		userAgents: [],
		memoryCategories: [],
		sessionSeenMarks: [],
		sessionActivity: [],
		compute: [],
		computeJobs: [],
		environments: [],
		kernels: [],
		resources: [],
		provenance: [],
		changelog: [],
		...partial,
	};
}

test("materializeWorkbenchOrgDatabase writes Feynman-owned reference-shaped tables", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-org-db-"));
	try {
		withFeynmanHome(join(root, "home-parent"), () => {
			const now = "2026-07-04T12:00:00.000Z";
			const nowMs = Date.parse(now);
			const state = emptyState({
				workspacePath: join(root, "workspace"),
				workspaceName: "workspace",
				generatedAt: now,
				projects: [{
					id: "project-1",
					name: "Enzyme Design",
					description: "Protein engineering run",
					kind: "seeds",
					context: "screen variants",
					userId: "local",
					uploadsFrameId: "project-1-uploads",
					memoryEnabled: true,
					runSlugs: ["run-1"],
					artifactPaths: ["outputs/report.md"],
					sessionCount: 1,
					artifactCount: 1,
					createdAt: now,
					createdAtMs: nowMs,
					updatedAt: now,
					updatedAtMs: nowMs,
					primaryRunSlug: "run-1",
				}],
				artifacts: [{
					path: "outputs/report.md",
					name: "report.md",
					title: "Report",
					category: "output",
					extension: ".md",
					contentType: "text/markdown",
					sizeBytes: 42,
					updatedAt: now,
					updatedAtMs: nowMs,
					slug: "report",
					previewable: true,
					starred: true,
				}],
				artifactVersions: [{
					id: "version-1",
					artifactPath: "outputs/report.md",
					versionNumber: 1,
					label: "Current",
					source: "workspace",
					contentType: "text/markdown",
					sizeBytes: 42,
					checksum: "sha256:abc",
					createdAt: now,
					createdAtMs: nowMs,
					messages: [],
					inputPaths: [],
					outputPaths: ["outputs/report.md"],
					isIntermediate: false,
					isCheckpoint: true,
					annotations: [],
				}],
				execution: [{
					id: "execution-1",
					title: "Notebook cell",
					kind: "python",
					status: "complete",
					origin: "workspace",
					createdAt: now,
					createdAtMs: nowMs,
					detail: "ran analysis",
					language: "python",
					code: "print('ok')",
					inputPaths: [],
					outputPaths: ["outputs/report.md"],
				}],
				checks: [{
					id: "check-1",
					title: "Claim check",
					status: "pass",
					claim: "Variant improves stability",
					detail: "source-backed",
					evidencePaths: ["outputs/report.md"],
					createdAt: now,
					createdAtMs: nowMs,
					claimId: "claim-1",
				}],
				claims: [{
					id: "claim-1",
					claim: "Variant improves stability",
					status: "verified",
					source: "verification",
					sourceTitle: "Claim check",
					runSlug: "run-1",
					evidencePaths: ["outputs/report.md"],
					checkIds: ["check-1"],
					createdAt: now,
					createdAtMs: nowMs,
				}],
				events: [{
					id: "event-1",
					frameId: "frame-1",
					rootFrameId: "run-1",
					projectId: "project-1",
					runSlug: "run-1",
					eventType: "tool.completed",
					payload: { toolName: "pubmed_search" },
					createdAt: now,
					createdAtMs: nowMs,
				}],
				frames: [{
					id: "frame-1",
					rootFrameId: "run-1",
					agentName: "operon",
					status: "complete",
					createdAt: now,
					createdAtMs: nowMs,
					updatedAt: now,
					updatedAtMs: nowMs,
					projectId: "project-1",
					name: "Enzyme run",
					conversationType: "agent",
					isHidden: false,
					rootSeq: 1,
					source: "chat-session",
				}],
				frameMessages: [{
					frameId: "frame-1",
					idx: 0,
					msgJson: JSON.stringify({ role: "user", content: "design variants" }),
					messageUuid: "message-1",
					role: "user",
					status: "complete",
					projectId: "project-1",
					sessionId: "run-1",
					createdAt: now,
					createdAtMs: nowMs,
					source: "chat-session",
				}],
				memories: [{
					id: "memory-1",
					body: "Prefer auditable protein-engineering workflows.",
					scope: "profile",
					origin: "user",
					evidence: "stated",
					createdAt: now,
					updatedAt: now,
				}],
				notes: [{
					id: "note-1",
					targetType: "artifact",
					targetArtifactPath: "outputs/report.md",
					content: "Review before export.",
					createdAt: now,
					updatedAt: now,
				}],
				artifactAnnotations: [{
					id: "annotation-1",
					artifactPath: "outputs/report.md",
					targetKind: "artifact",
					targetKey: "outputs/report.md",
					labelIndex: 1,
					body: "Check method details.",
					kind: "note",
					anchorKind: "text_selection",
					projectId: "project-1",
					runSlug: "run-1",
					createdAt: now,
					createdAtMs: nowMs,
					updatedAt: now,
					updatedAtMs: nowMs,
				}],
				frameReadCursors: [{
					rootFrameId: "run-1",
					messageId: "message-1",
					messageIndex: 0,
					messageCount: 1,
					projectId: "project-1",
					runSlug: "run-1",
					updatedAt: now,
					updatedAtMs: nowMs,
				}],
				artifactFolders: [{
					id: "folder-1",
					projectId: "project-1",
					name: "Results",
					sortOrder: 1,
					rootFrameId: "run-1",
					isConversationFolder: false,
					isUserUploadsFolder: false,
					artifactCount: 1,
					createdAt: now,
					createdAtMs: nowMs,
					updatedAt: now,
					updatedAtMs: nowMs,
				}],
				computeProviders: [{
					name: "local-python",
					displayName: "Local Python",
					family: "local",
					memoryMd: "",
					environments: ["python"],
					memoryRev: 1,
					dataRoots: [],
					enabled: true,
					scratchRootSource: "workspace",
					priorAppNames: [],
					status: "available",
					tierType: "local",
					probedAt: now,
					probedAtMs: nowMs,
					egressPolicy: "Feynman Settings Network policy",
					modalEnvironment: "main",
				}],
				directoryAttachments: [{
					serverUuid: "33a01bea-6243-57c7-9c7a-0e3502d0b0d9",
					agentName: "feynman",
					userId: "local-workbench",
					connectorId: "variants",
					connectorName: "Variants",
					connectorKind: "featured",
					status: "configured",
					source: "Built-in science database tool",
					section: "Featured",
					excludedTools: [],
					toolNames: ["feynman_science_database_search"],
					createdAt: now,
					createdAtMs: nowMs,
				}],
				mcpToolGrants: [{
					id: "grant-1",
					userId: "local",
					serverId: "feynman-bio-tools",
					toolName: "pubmed_search",
					decision: "allow",
					name: "PubMed search",
					scope: "project",
					settingsRecordId: "settings-1",
					createdAt: now,
					createdAtMs: nowMs,
				}],
				customMcpServers: [{
					id: "custom-server-1",
					userId: "local-workbench",
					name: "Lab MCP",
					description: "Lab-local science tools.",
					url: "https://mcp.example.edu/mcp",
					transport: "streamable_http",
					source: "custom",
					resourceIdentifier: "https://mcp.example.edu/mcp",
					settingsRecordId: "lab-mcp",
					createdAt: now,
					createdAtMs: nowMs,
					updatedAt: now,
					updatedAtMs: nowMs,
				}],
				mcpAgentAssignments: [{
					id: "assignment-1",
					mcpServerId: "custom-server-1",
					agentName: "Verifier",
					userId: "local-workbench",
					excludedTools: ["dangerous_write"],
					settingsRecordId: "lab-mcp",
					createdAt: now,
					createdAtMs: nowMs,
				}],
				memoryCategories: [{
					id: "category-1",
					userId: "local",
					name: "Protein engineering",
					nameLower: "protein engineering",
					guidance: "Recall assay preferences.",
					autoRecall: true,
					createdAt: now,
					createdAtMs: nowMs,
					updatedAt: now,
					updatedAtMs: nowMs,
					settingsRecordId: "settings-category-1",
				}],
				routineSchedules: [{
					id: "routine-1",
					rootFrameId: "run-1",
					ownerUserId: "local",
					label: "Watch PubMed",
					onTick: "/watch pubmed",
					planPath: "outputs/.plans/watch-pubmed.json",
					everyMinutes: 1440,
					enabled: false,
					nextDue: now,
					nextDueMs: nowMs,
					tickCount: 0,
					missedTicks: 0,
					idleStreak: 0,
					createdAt: now,
					createdAtMs: nowMs,
					updatedAt: now,
					updatedAtMs: nowMs,
					source: "watch-plan",
				}],
				managedEndpoints: [{
					name: "local-bionemo",
					url: "http://127.0.0.1:8000",
					port: 8000,
					skillName: "managed-model-endpoints",
					startScript: "start.sh",
					stopScript: "stop.sh",
					livePath: "/health",
					approvedScriptHash: "sha256:endpoint",
					state: "stopped",
					createdAt: now,
					createdAtMs: nowMs,
					provider: "local",
					models: ["esmfold"],
					status: "present",
				}],
				capabilitySettings: [{
					userId: "local",
					kind: "connector",
					key: "feynman-bio-tools",
					enabled: true,
					updatedAt: now,
					updatedAtMs: nowMs,
					source: "settings",
					status: "configured",
					settingsCollection: "customConnectors",
					settingsRecordId: "settings-connector-1",
				}],
			});

			const summary = materializeWorkbenchOrgDatabase(state);
			assert.match(summary.path, /\/\.feynman\/orgs\/[0-9a-f-]{36}\/feynman-workbench\.db$/);
			assert.equal(summary.path.includes(".claude-science"), false);
			assert.equal(summary.path.includes("operon-cli"), false);
			assert.equal(summary.counts.projects, 1);
			assert.equal(summary.counts.frames, 1);
			assert.equal(summary.counts.frame_messages, 1);
			assert.equal(summary.counts.artifacts, 1);
			assert.equal(summary.counts.artifact_versions, 1);
			assert.equal(summary.counts.execution_log, 1);
			assert.equal(summary.counts.verification_checks, 1);
			assert.equal(summary.counts.memories, 1);
			assert.equal(summary.counts.notes, 1);
			assert.equal(summary.counts.annotations, 1);
			assert.equal(summary.counts.frame_read_cursors, 1);
			assert.equal(summary.counts.artifact_folders, 1);
			assert.equal(summary.counts.compute_providers, 1);
			assert.equal(summary.counts.mcp_tool_grants, 1);
			assert.equal(summary.counts.directory_attachments, 1);
			assert.equal(summary.counts.custom_mcp_servers, 1);
			assert.equal(summary.counts.mcp_agent_assignments, 1);
			assert.equal(summary.counts.memory_categories, 1);
			assert.equal(summary.counts.routine_schedules, 1);
			assert.equal(summary.counts.managed_endpoints, 1);
			assert.equal(summary.counts.capability_settings, 1);
			assert.equal(summary.counts.session_claims, 1);
			assert.equal(summary.counts.events, 1);
			for (const name of REFERENCE_LEDGER_TABLE_NAMES) {
				if (name === "session_claims" || name === "events" || name === "directory_attachments" || name === "custom_mcp_servers" || name === "mcp_agent_assignments") continue;
				assert.equal(summary.counts[name], 0, `expected empty ${name} table`);
			}

			const database = new DatabaseSync(summary.path, { readOnly: true });
			try {
				const tableNames = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>;
				const visibleTableNames = tableNames.map((row) => row.name).filter((name) => !name.startsWith("__"));
				for (const name of REFERENCE_LEDGER_TABLE_NAMES) {
					assert.ok(visibleTableNames.includes(name), `expected ${name} table`);
				}
				assert.deepEqual(visibleTableNames.filter((name) => !REFERENCE_LEDGER_TABLE_NAMES.includes(name)), [
					"annotations",
					"artifact_folders",
					"artifact_versions",
					"artifacts",
					"capability_settings",
					"compute_providers",
					"execution_log",
					"feynman_state_payloads",
					"frame_messages",
					"frame_read_cursors",
					"frames",
					"managed_endpoints",
					"mcp_tool_grants",
					"memories",
					"memory_categories",
					"notes",
					"projects",
					"routine_schedules",
					"verification_checks",
				]);
				assert.equal((database.prepare("SELECT value FROM __feynman_mirror_meta WHERE key = 'schema_version'").get() as { value: string }).value, "1");
				assert.equal((database.prepare("SELECT name FROM projects WHERE id = 'project-1'").get() as { name: string }).name, "Enzyme Design");
				assert.equal((database.prepare("SELECT verdict FROM verification_checks WHERE id = 'check-1'").get() as { verdict: string }).verdict, "pass");
				assert.equal((database.prepare("SELECT display_name FROM compute_providers WHERE name = 'local-python'").get() as { display_name: string }).display_name, "Local Python");
				const localProviderPolicy = database.prepare("SELECT egress_policy, modal_environment FROM compute_providers WHERE name = 'local-python'").get() as { egress_policy: string; modal_environment: string };
				assert.equal(localProviderPolicy.egress_policy, "Feynman Settings Network policy");
				assert.equal(localProviderPolicy.modal_environment, "main");
				assert.equal((database.prepare("SELECT decision FROM mcp_tool_grants WHERE id = 'grant-1'").get() as { decision: string }).decision, "allow");
				assert.equal((database.prepare("SELECT server_id FROM mcp_tool_grants WHERE id = 'grant-1'").get() as { server_id: string }).server_id, "feynman-bio-tools");
				assert.match((database.prepare("SELECT payload_json FROM directory_attachments WHERE id = '33a01bea-6243-57c7-9c7a-0e3502d0b0d9'").get() as { payload_json: string }).payload_json, /"connectorId":"variants"/);
				assert.match((database.prepare("SELECT payload_json FROM custom_mcp_servers WHERE id = 'custom-server-1'").get() as { payload_json: string }).payload_json, /"resourceIdentifier":"https:\/\/mcp\.example\.edu\/mcp"/);
				assert.equal((database.prepare("SELECT enabled FROM capability_settings WHERE id = 'local:connector:feynman-bio-tools'").get() as { enabled: number }).enabled, 1);
				assert.match((database.prepare("SELECT payload_json FROM events WHERE id = 'event-1'").get() as { payload_json: string }).payload_json, /pubmed_search/);
				assert.match((database.prepare("SELECT payload_json FROM session_claims WHERE id = 'claim-1'").get() as { payload_json: string }).payload_json, /Variant improves stability/);
				assert.match((database.prepare("SELECT payload_json FROM feynman_state_payloads WHERE table_name = 'artifacts' AND row_id = 'outputs/report.md'").get() as { payload_json: string }).payload_json, /"starred":true/);
			} finally {
				database.close();
			}
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("built workbench state can refresh the org database on demand", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-org-db-"));
	try {
		const workspace = join(root, "workspace");
		mkdirSync(workspace, { recursive: true });
		withFeynmanHome(join(root, "home-parent"), () => {
			const state = buildWorkbenchState({ workingDir: workspace });
			const { path } = materializeWorkbenchOrgDatabase(state);

			assert.equal(existsSync(path), true);
			const database = new DatabaseSync(path, { readOnly: true });
			try {
				assert.equal((database.prepare("SELECT value FROM __feynman_mirror_meta WHERE key = 'workspace_path'").get() as { value: string }).value, state.workspacePath);
				assert.equal((database.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number }).count, state.projects.length);
			} finally {
				database.close();
			}
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("materializeWorkbenchOrgDatabase upgrades existing compute provider policy columns", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-org-db-upgrade-"));
	const path = join(root, "existing-feynman-workbench.db");
	const database = new DatabaseSync(path);
	try {
		database.exec(`
CREATE TABLE compute_providers (
	name TEXT PRIMARY KEY,
	display_name TEXT NOT NULL,
	family TEXT NOT NULL,
	status TEXT NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 0,
	tier_type TEXT NOT NULL,
	settings_collection TEXT,
	settings_record_id TEXT,
	probed_at INTEGER
);
`);
	} finally {
		database.close();
	}
	try {
		const now = "2026-07-04T12:00:00.000Z";
		const nowMs = Date.parse(now);
		const state = emptyState({
			generatedAt: now,
			computeProviders: [{
				name: "modal",
				displayName: "Modal",
				family: "cloud",
				memoryMd: "",
				environments: ["modal"],
				memoryRev: 1,
				dataRoots: [],
				enabled: true,
				scratchRootSource: "probe",
				appName: "feynman-modal",
				priorAppNames: [],
				egressPolicy: "Feynman Settings Network policy",
				modalEnvironment: "main",
				status: "configured",
				tierType: "cloud",
				probedAt: now,
				probedAtMs: nowMs,
			}],
		});

		materializeWorkbenchOrgDatabase(state, path);
		const upgraded = new DatabaseSync(path, { readOnly: true });
		try {
			const columns = upgraded.prepare("PRAGMA table_info(compute_providers)").all() as Array<{ name: string }>;
			assert.equal(columns.some((column) => column.name === "egress_policy"), true);
			assert.equal(columns.some((column) => column.name === "modal_environment"), true);
			const modalProviderPolicy = upgraded.prepare("SELECT egress_policy, modal_environment FROM compute_providers WHERE name = 'modal'").get() as { egress_policy: string; modal_environment: string };
			assert.equal(modalProviderPolicy.egress_policy, "Feynman Settings Network policy");
			assert.equal(modalProviderPolicy.modal_environment, "main");
		} finally {
			upgraded.close();
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
