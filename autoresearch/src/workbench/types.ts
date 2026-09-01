import type { ModelStatusSnapshot } from "../model/catalog.js";
import type { WorkbenchMemoryRecord, WorkbenchNoteRecord } from "./memory.js";
import type {
	WorkbenchCustomMcpServer,
	WorkbenchDirectoryAttachment,
	WorkbenchMcpAgentAssignment,
	WorkbenchMcpToolGrant,
} from "./mcp-types.js";
import type { WorkbenchAgentRecord, WorkbenchAnthropicApiKey, WorkbenchArtifactDependency, WorkbenchArtifactFolder, WorkbenchBundledAgentSetting, WorkbenchCapabilitySetting, WorkbenchCloudCredential, WorkbenchCompactionArchive, WorkbenchComputePendingTerminate, WorkbenchComputeProviderRecord, WorkbenchComputeUsageRecord, WorkbenchContactEmailDecision, WorkbenchContentSnapshot, WorkbenchCredentialAskDecision, WorkbenchFrameBackfillPoison, WorkbenchFrameBranchArchive, WorkbenchFrameMessage, WorkbenchFrameRecord, WorkbenchHostCallLogEntry, WorkbenchHostGrant, WorkbenchManagedEndpoint, WorkbenchMarketplaceSource, WorkbenchMemoryCategoryRecord, WorkbenchOAuthTokenRecord, WorkbenchPollerLease, WorkbenchRoutineSchedule, WorkbenchSafetyFeedback, WorkbenchSessionConcurrency, WorkbenchSkillLicenseAssent, WorkbenchUseIntentDeclaration, WorkbenchUserAgent, WorkbenchUserSecret } from "./ledger-types.js";
import type {
	WorkbenchAgentSkillAssignment,
	WorkbenchCustomAgentPrompt,
	WorkbenchCustomSkill,
} from "./skill-types.js";

export type { WorkbenchAgentRecord, WorkbenchAnthropicApiKey, WorkbenchArtifactDependency, WorkbenchArtifactFolder, WorkbenchBundledAgentSetting, WorkbenchCapabilitySetting, WorkbenchCloudCredential, WorkbenchCompactionArchive, WorkbenchComputePendingTerminate, WorkbenchComputeProviderRecord, WorkbenchComputeUsageRecord, WorkbenchContactEmailDecision, WorkbenchContentSnapshot, WorkbenchCredentialAskDecision, WorkbenchFrameBackfillPoison, WorkbenchFrameBranchArchive, WorkbenchFrameMessage, WorkbenchFrameRecord, WorkbenchHostCallLogEntry, WorkbenchHostGrant, WorkbenchManagedEndpoint, WorkbenchMarketplaceSource, WorkbenchMemoryCategoryRecord, WorkbenchOAuthTokenRecord, WorkbenchPollerLease, WorkbenchRoutineSchedule, WorkbenchSafetyFeedback, WorkbenchSessionConcurrency, WorkbenchSkillLicenseAssent, WorkbenchUseIntentDeclaration, WorkbenchUserAgent, WorkbenchUserSecret } from "./ledger-types.js";
export type {
	WorkbenchCustomMcpServer,
	WorkbenchDirectoryAttachment,
	WorkbenchMcpAgentAssignment,
	WorkbenchMcpToolGrant,
} from "./mcp-types.js";
export type {
	WorkbenchAgentSkillAssignment,
	WorkbenchCustomAgentPrompt,
	WorkbenchCustomSkill,
} from "./skill-types.js";

export type ArtifactCategory =
	| "data"
	| "draft"
	| "note"
	| "output"
	| "paper"
	| "plan"
	| "provenance"
	| "verification"
	| "visual";

export type WorkbenchArtifact = {
	path: string;
	name: string;
	title: string;
	displayName?: string;
	category: ArtifactCategory;
	extension: string;
	contentType: string;
	sizeBytes: number;
	updatedAt: string;
	updatedAtMs: number;
	slug: string;
	previewable: boolean;
	starred?: boolean;
	hidden?: boolean;
};

export type WorkbenchArtifactActionItem = {
	artifactPath: string;
	title: string;
	displayName?: string;
	status: "deleted" | "hidden";
	starred: boolean;
	hidden: boolean;
	deleted: boolean;
	deletedAt?: string;
	trashPath?: string;
	updatedAt: string;
	updatedAtMs: number;
};

export type WorkbenchCloudExportTarget = {
	id: string;
	name: string;
	provider: "azure" | "gcs" | "local" | "s3" | "unknown";
	envVar: string;
	status: "configured" | "missing";
	detail: string;
	description?: string;
};

export type WorkbenchCloudExportRecord = {
	id: string;
	artifactPath: string;
	artifactName: string;
	credentialId: string;
	credentialName: string;
	provider: WorkbenchCloudExportTarget["provider"];
	destinationPath: string;
	target: string;
	status: "complete" | "error";
	sizeBytes: number;
	createdAt: string;
	error?: string;
};

export type WorkbenchRunStatus = "artifact" | "chat" | "draft" | "planned" | "provenance" | "verified";

export type WorkbenchGeneratedPlanStatus =
	| "approved"
	| "awaiting_approval"
	| "complete"
	| "rejected"
	| "running";

export type WorkbenchPlanStepStatus = "blocked" | "complete" | "pending" | "running";

export type WorkbenchGeneratedPlanStep = {
	title: string;
	description: string;
	status: WorkbenchPlanStepStatus;
	notes?: string;
	artifactPaths: string[];
	updatedAt: string;
};

export type WorkbenchGeneratedPlan = {
	schema: "feynman.workbenchPlan.v1";
	id: string;
	sessionId: string;
	projectId: string;
	runSlug: string;
	title: string;
	taskSummary: string;
	status: WorkbenchGeneratedPlanStatus;
	feasibility: {
		confidence: "high" | "low" | "medium";
		rationale: string;
	};
	steps: WorkbenchGeneratedPlanStep[];
	artifactPath: string;
	createdAt: string;
	updatedAt: string;
	source: "pi" | "workbench";
};

export type WorkbenchRun = {
	slug: string;
	title: string;
	taskSummary: string;
	status: WorkbenchRunStatus;
	source: "artifact" | "chat";
	projectId?: string;
	updatedAt: string;
	updatedAtMs: number;
	artifactCount: number;
	artifactPaths?: string[];
	notebookCellCount: number;
	categories: ArtifactCategory[];
	lastArtifactNames: string[];
	primaryArtifact?: WorkbenchArtifact;
	hasPlan: boolean;
	hasProvenance: boolean;
	hasVerification: boolean;
};

export type WorkbenchProjectKind = "custom" | "papers" | "plans" | "seeds" | "verification" | "workspace";

export type WorkbenchProject = {
	id: string;
	name: string;
	description: string;
	kind: WorkbenchProjectKind;
	context?: string;
	userId: string;
	uploadsFrameId: string;
	memoryEnabled: boolean;
	agentContext?: string;
	runSlugs: string[];
	artifactPaths: string[];
	sessionCount: number;
	artifactCount: number;
	createdAt: string;
	createdAtMs: number;
	updatedAt: string;
	updatedAtMs: number;
	primaryRunSlug?: string;
};

export type WorkbenchOnboardingProfile = {
	completed: boolean;
	field?: string;
	goal?: string;
	workflow?: string;
	dataTools: string[];
	bottlenecks: string[];
	notes?: string;
	permissions: string[];
	selectedTask?: {
		title: string;
		description: string;
	};
	projectId?: string;
	sessionId?: string;
	suggestedSpecialist?: string;
	suggestedConnectors: string[];
	suggestedSeedWorkflows: string[];
	computeDefault: "local" | "off";
	createdAt?: string;
	updatedAt?: string;
};

export type WorkbenchNotebookCell = {
	id: string;
	runSlug: string;
	title: string;
	path: string;
	language: string;
	category: ArtifactCategory;
	updatedAt: string;
	updatedAtMs: number;
	previewable: boolean;
};

export type WorkbenchExecutionStatus =
	| "complete"
	| "draft"
	| "error"
	| "planned"
	| "provenance"
	| "queued"
	| "running"
	| "stopped"
	| "verified";

export type WorkbenchExecutionKind =
	| "artifact"
	| "assistant"
	| "bash"
	| "message"
	| "plan"
	| "provenance"
	| "python"
	| "r"
	| "tool"
	| "verification";

export type WorkbenchExecutionPurpose = "exploration" | "verification";

export type WorkbenchExecutionRecord = {
	id: string;
	title: string;
	kind: WorkbenchExecutionKind;
	status: WorkbenchExecutionStatus;
	origin: "chat" | "pi" | "workspace";
	createdAt: string;
	createdAtMs: number;
	detail: string;
	purpose?: WorkbenchExecutionPurpose;
	runSlug?: string;
	sessionId?: string;
	language?: string;
	environment?: string;
	sourceId?: string;
	code?: string;
	details?: string;
	messages?: WorkbenchExecutionMessage[];
	inputPaths: string[];
	outputPaths: string[];
};

export type WorkbenchVerificationStatus = "fail" | "inconclusive" | "pass";

export type WorkbenchVerificationCheck = {
	id: string;
	claimId?: string;
	title: string;
	status: WorkbenchVerificationStatus;
	claim: string;
	detail: string;
	runSlug?: string;
	sessionId?: string;
	executionId?: string;
	evidencePaths: string[];
	createdAt: string;
	createdAtMs: number;
};

export type WorkbenchResearchClaimStatus = "failed" | "unverified" | "verified";

export type WorkbenchResearchClaimSource = "artifact" | "execution" | "verification";

export type WorkbenchResearchClaim = {
	id: string;
	claim: string;
	status: WorkbenchResearchClaimStatus;
	source: WorkbenchResearchClaimSource;
	sourceTitle: string;
	sourcePath?: string;
	runSlug?: string;
	sessionId?: string;
	executionId?: string;
	evidencePaths: string[];
	checkIds: string[];
	createdAt: string;
	createdAtMs: number;
	detail?: string;
};

export type WorkbenchFrameEvent = {
	id: string;
	frameId: string;
	rootFrameId: string;
	projectId?: string;
	runSlug?: string;
	sessionId?: string;
	eventType: string;
	payload: Record<string, unknown>;
	createdAt: string;
	createdAtMs: number;
};

export type WorkbenchNotificationStatus = "complete" | "failed" | "needs_input" | "queued" | "running" | "stopped";

export type WorkbenchSessionNotification = {
	id: string;
	senderFrameId: string;
	recipientFrameId: string;
	rootFrameId: string;
	projectId?: string;
	runSlug?: string;
	sessionId?: string;
	notificationType: string;
	title: string;
	detail: string;
	status: WorkbenchNotificationStatus;
	payload: Record<string, unknown>;
	readAt?: string;
	readAtMs?: number;
	createdAt: string;
	createdAtMs: number;
};

export type WorkbenchQueuedUserMessage = {
	seq: number;
	id: string;
	frameId: string;
	rootFrameId: string;
	projectId?: string;
	runSlug?: string;
	sessionId?: string;
	messageId: string;
	messageIndex: number;
	messageCount: number;
	intentId: string;
	payload: {
		text: string;
		toolEvents: number;
	};
	state: "failed" | "queued" | "resolved";
	resolvedAt?: string;
	resolvedAtMs?: number;
	createdAt: string;
	createdAtMs: number;
};

export type WorkbenchFrameSystemPrompt = {
	frameId: string;
	hash: string;
	payload: {
		stable: string;
		dynamic: string;
	};
	projectId?: string;
	runSlug?: string;
	sessionId?: string;
	updatedAt: string;
	updatedAtMs: number;
};

export type WorkbenchSessionSeenMark = {
	rootFrameId: string;
	seenToken: string;
	messageId?: string;
	messageIndex: number;
	messageCount: number;
	projectId?: string;
	runSlug?: string;
	updatedAt: string;
	updatedAtMs: number;
};

export type WorkbenchSessionActivityKind = "event" | "notification" | "queued_user_message";

export type WorkbenchSessionActivityItem = {
	id: string;
	kind: WorkbenchSessionActivityKind;
	eventType: string;
	title: string;
	detail: string;
	status: WorkbenchNotificationStatus;
	rootFrameId: string;
	projectId?: string;
	runSlug?: string;
	sessionId?: string;
	messageId?: string;
	messageIndex?: number;
	messageCount?: number;
	artifactPaths: string[];
	unread: boolean;
	seenToken?: string;
	readAt?: string;
	readAtMs?: number;
	createdAt: string;
	createdAtMs: number;
	payload: Record<string, unknown>;
};

export type WorkbenchExecutionMessage = {
	id: string;
	role: "assistant" | "system" | "tool" | "user";
	title: string;
	content: string;
	createdAt?: string;
	status?: WorkbenchExecutionStatus;
};

export type WorkbenchArtifactVersionSource = "chat" | "notebook" | "pi" | "workspace";

export type WorkbenchArtifactAnnotationKind = "note" | "revision";
export type WorkbenchArtifactAnnotationAnchorKind = "point" | "region" | "text_selection";

export type WorkbenchArtifactAnnotationRect = {
	xPercent: number;
	yPercent: number;
	widthPercent: number;
	heightPercent: number;
};

export type WorkbenchArtifactAnnotation = {
	id: string;
	artifactPath: string;
	targetKind: "artifact";
	targetKey: string;
	labelIndex: number;
	body: string;
	kind: WorkbenchArtifactAnnotationKind;
	anchorKind?: WorkbenchArtifactAnnotationAnchorKind;
	anchorText?: string;
	startOffset?: number;
	endOffset?: number;
	startLine?: number;
	endLine?: number;
	pageNumber?: number;
	selectionPrefix?: string;
	xPercent?: number;
	yPercent?: number;
	widthPercent?: number;
	heightPercent?: number;
	rects?: WorkbenchArtifactAnnotationRect[];
	sessionId?: string;
	projectId?: string;
	runSlug?: string;
	createdAt: string;
	createdAtMs: number;
	updatedAt: string;
	updatedAtMs: number;
};

export type WorkbenchTranscriptAnnotationKind = "bookmark" | "note";
export type WorkbenchTranscriptAnnotationOrigin = "agent" | "user";
export type WorkbenchTranscriptAnnotationSource = "assistant" | "tool_input" | "tool_result" | "user";

export type WorkbenchTranscriptAnnotation = {
	id: string;
	rootFrameId: string;
	messageUuid?: string;
	messageIndex: number;
	blockIndex: number;
	source: WorkbenchTranscriptAnnotationSource;
	toolName?: string;
	anchorText: string;
	startOffset?: number;
	endOffset?: number;
	kind: WorkbenchTranscriptAnnotationKind;
	note: string;
	origin: WorkbenchTranscriptAnnotationOrigin;
	readAt?: string;
	readAtMs?: number;
	projectId?: string;
	runSlug?: string;
	createdAt: string;
	createdAtMs: number;
	updatedAt: string;
	updatedAtMs: number;
};

export type WorkbenchFrameReadCursor = {
	rootFrameId: string;
	messageId?: string;
	messageIndex: number;
	messageCount: number;
	projectId?: string;
	runSlug?: string;
	updatedAt: string;
	updatedAtMs: number;
};

export type WorkbenchArtifactVersion = {
	id: string;
	artifactPath: string;
	versionNumber: number;
	label: string;
	source: WorkbenchArtifactVersionSource;
	contentType: string;
	sizeBytes: number;
	checksum?: string;
	createdAt: string;
	createdAtMs: number;
	parentVersionId?: string;
	producerExecutionId?: string;
	producerSourceId?: string;
	agentName?: string;
	language?: string;
	code?: string;
	codeDescription?: string;
	messages: WorkbenchExecutionMessage[];
	environment?: string;
	environmentDetails?: string;
	inputPaths: string[];
	outputPaths: string[];
	isIntermediate: boolean;
	isCheckpoint: boolean;
	annotations: WorkbenchArtifactAnnotation[];
	snapshotId?: string;
	snapshotPath?: string;
	previousSnapshotPath?: string;
	previousChecksum?: string;
	previousSizeBytes?: number;
	contentChanged?: boolean;
};

export type WorkbenchComputeStatus = "available" | "configured" | "read-only";

export type WorkbenchComputeProviderAction = {
	id: "disable" | "enable" | "remove" | "stop";
	label: string;
	description?: string;
	disabled?: boolean;
};

export type WorkbenchComputeProvider = {
	id: string;
	name: string;
	family: string;
	status: WorkbenchComputeStatus;
	description: string;
	capabilities: string[];
	enabled: boolean;
	checked: boolean;
	tierType: WorkbenchComputeTierType;
	detail?: string;
	diagnostics?: string[];
	managed?: boolean;
	settingsCollection?: "computeHosts" | "credentialRefs";
	settingsRecordId?: string;
	tools?: Array<{ name: string; description?: string }>;
	actions?: WorkbenchComputeProviderAction[];
};

export type WorkbenchComputeTierType = "cloud" | "local" | "session";

export type WorkbenchComputeJobRecord = {
	id: string;
	title: string;
	providerId: string;
	providerName: string;
	family: string;
	status: WorkbenchExecutionStatus;
	tierType: WorkbenchComputeTierType;
	intent: WorkbenchExecutionPurpose;
	sessionId: string;
	projectId: string;
	runSlug?: string;
	language: string;
	environment: string;
	command: string;
	cwd: string;
	executionId: string;
	remoteUrl?: string;
	remoteHandle?: string;
	scriptPath?: string;
	hardwareDetails?: string;
	pendingTermination?: boolean;
	terminationDetail?: string;
	detail: string;
	error?: string;
	inputPaths: string[];
	outputPaths: string[];
	startedAt: string;
	startedAtMs: number;
	endedAt: string;
	endedAtMs: number;
	durationMs: number;
};

export type WorkbenchNotebookEnvironmentStatus = "available" | "configured" | "error";
export type WorkbenchNotebookRuntimeSource = "configured" | "managed" | "path" | "recorded" | "system";

export type WorkbenchNotebookEnvironmentRecord = {
	id: string;
	name: string;
	language: string;
	executionModes: string[];
	status: WorkbenchNotebookEnvironmentStatus;
	source: WorkbenchNotebookRuntimeSource;
	managed: boolean;
	command: string;
	commandDetail: string;
	executable?: string;
	version?: string;
	detail: string;
	diagnostics: string[];
	packageManager?: string;
	managedPackages: string[];
	actionCount: number;
	latestActionStatus?: WorkbenchExecutionStatus;
	latestActionAt?: string;
	latestActionAtMs?: number;
	environmentFiles: string[];
	sessionCount: number;
	executionCount: number;
	latestExecutionAt?: string;
	latestExecutionAtMs?: number;
};

export type WorkbenchNotebookKernelRecord = {
	id: string;
	sessionId: string;
	projectId: string;
	runSlug?: string;
	language: string;
	status: WorkbenchExecutionStatus;
	active: boolean;
	cwd: string;
	executable?: string;
	version?: string;
	source: WorkbenchNotebookRuntimeSource;
	detail: string;
	executionCount: number;
	latestExecutionId?: string;
	latestExecutionAt: string;
	latestExecutionAtMs: number;
};

export type WorkbenchResourceStatus = "available" | "configured" | "disabled" | "read-only";

export type WorkbenchResource = {
	id: string;
	name: string;
	description: string;
	status: WorkbenchResourceStatus;
	source: string;
	connectorKind?: "custom" | "directory" | "featured" | "organization" | "package";
	section?: string;
	path?: string;
	command?: string;
	detail?: string;
	diagnostics?: string[];
	oauthAction?: "connect" | "disconnect" | "reconnect";
	oauthConnectorId?: string;
	oauthStatus?: "connected" | "expired" | "missing" | "not_configured";
	packageSources?: string[];
	packageAction?: "disable" | "enable";
	settingsCollection?: "allowedDomains" | "computeHosts" | "credentialRefs" | "customConnectors" | "memoryCategories" | "permissionGrants";
	settingsRecordId?: string;
	settingsRecord?: Record<string, unknown>;
	tags: string[];
	tools?: Array<{ name: string; description?: string }>;
};

export type WorkbenchPiCommand = {
	name: string;
	command: string;
	description?: string;
	source?: string;
	location?: string;
	path?: string;
	sourceInfo?: {
		path?: string;
		source?: string;
		scope?: string;
		origin?: string;
		baseDir?: string;
	};
};

export type WorkbenchResourceGroupId =
	| "commands"
	| "connectors"
	| "compute"
	| "credentials"
	| "general"
	| "memory"
	| "network"
	| "permissions"
	| "prompts"
	| "skills"
	| "specialists"
	| "storage"
	| "usage";

export type WorkbenchResourceGroup = {
	id: WorkbenchResourceGroupId;
	title: string;
	description: string;
	resources: WorkbenchResource[];
};

export type WorkbenchProvenanceRecord = {
	id: string;
	title: string;
	kind: "changelog" | "provenance" | "verification";
	runSlug?: string;
	path?: string;
	updatedAt?: string;
	excerpt: string;
};

export type WorkbenchChangelogEntry = {
	title: string;
	body: string;
	updatedAt?: string;
};

export type WorkbenchSummary = {
	activityCount: number;
	artifactCount: number;
	transcriptAnnotationCount: number;
	claimCount: number;
	notificationCount: number;
	projectCount: number;
	queuedMessageCount: number;
	runCount: number;
	outputCount: number;
	paperCount: number;
	planCount: number;
	unreadActivityCount: number;
	verificationCount: number;
	provenanceCount: number;
	noteCount: number;
};

export type WorkbenchState = {
	workspacePath: string;
	workspaceName: string;
	version?: string;
	generatedAt: string;
	modelStatus?: ModelStatusSnapshot;
	summary: WorkbenchSummary;
	onboarding: WorkbenchOnboardingProfile;
	projects: WorkbenchProject[];
	runs: WorkbenchRun[];
	artifacts: WorkbenchArtifact[];
	artifactActions: WorkbenchArtifactActionItem[];
	cloudExportTargets: WorkbenchCloudExportTarget[];
	artifactVersions: WorkbenchArtifactVersion[];
	artifactAnnotations: WorkbenchArtifactAnnotation[];
	transcriptAnnotations: WorkbenchTranscriptAnnotation[];
	frameReadCursors: WorkbenchFrameReadCursor[];
	memories: WorkbenchMemoryRecord[];
	notes: WorkbenchNoteRecord[];
	safetyFeedback: WorkbenchSafetyFeedback[];
	plans: WorkbenchGeneratedPlan[];
	notebook: WorkbenchNotebookCell[];
	execution: WorkbenchExecutionRecord[];
	checks: WorkbenchVerificationCheck[];
	claims: WorkbenchResearchClaim[];
	events: WorkbenchFrameEvent[];
	notifications: WorkbenchSessionNotification[];
	queuedUserMessages: WorkbenchQueuedUserMessage[];
	frameSystemPrompts: WorkbenchFrameSystemPrompt[];
	frames: WorkbenchFrameRecord[];
	frameMessages: WorkbenchFrameMessage[];
	frameBackfillPoison: WorkbenchFrameBackfillPoison[];
	artifactDependencies: WorkbenchArtifactDependency[];
	artifactFolders: WorkbenchArtifactFolder[];
	contentSnapshots: WorkbenchContentSnapshot[];
	capabilitySettings: WorkbenchCapabilitySetting[];
	cloudCredentials: WorkbenchCloudCredential[];
	computeProviders: WorkbenchComputeProviderRecord[];
	computeUsage: WorkbenchComputeUsageRecord[];
	computePendingTerminates: WorkbenchComputePendingTerminate[];
	pollerLeases: WorkbenchPollerLease[];
	managedEndpoints: WorkbenchManagedEndpoint[];
	marketplaceSources: WorkbenchMarketplaceSource[];
	skillLicenseAssents: WorkbenchSkillLicenseAssent[];
	routineSchedules: WorkbenchRoutineSchedule[];
	oauthTokens: WorkbenchOAuthTokenRecord[];
	userSecrets: WorkbenchUserSecret[];
	anthropicApiKeys: WorkbenchAnthropicApiKey[];
	contactEmailDecisions: WorkbenchContactEmailDecision[];
	credentialAskDecisions: WorkbenchCredentialAskDecision[];
	useIntentDeclarations: WorkbenchUseIntentDeclaration[];
	hostCallLog: WorkbenchHostCallLogEntry[];
	hostGrants: WorkbenchHostGrant[];
	sessionConcurrency: WorkbenchSessionConcurrency[];
	compactionArchives: WorkbenchCompactionArchive[];
	frameBranchArchives: WorkbenchFrameBranchArchive[];
	directoryAttachments: WorkbenchDirectoryAttachment[];
	mcpToolGrants: WorkbenchMcpToolGrant[];
	customMcpServers: WorkbenchCustomMcpServer[];
	mcpAgentAssignments: WorkbenchMcpAgentAssignment[];
	agents: WorkbenchAgentRecord[];
	bundledAgentSettings: WorkbenchBundledAgentSetting[];
	customSkills: WorkbenchCustomSkill[];
	agentSkillAssignments: WorkbenchAgentSkillAssignment[];
	customAgentPrompts: WorkbenchCustomAgentPrompt[];
	userAgents: WorkbenchUserAgent[];
	memoryCategories: WorkbenchMemoryCategoryRecord[];
	sessionSeenMarks: WorkbenchSessionSeenMark[];
	sessionActivity: WorkbenchSessionActivityItem[];
	compute: WorkbenchComputeProvider[];
	computeJobs: WorkbenchComputeJobRecord[];
	environments: WorkbenchNotebookEnvironmentRecord[];
	kernels: WorkbenchNotebookKernelRecord[];
	resources: WorkbenchResourceGroup[];
	provenance: WorkbenchProvenanceRecord[];
	changelog: WorkbenchChangelogEntry[];
};
