export type WorkbenchAgentRecord = {
	id: string;
	name: string;
	url: string;
	description?: string;
	parameters?: string;
	createdAt: string;
	createdAtMs: number;
	updatedAt: string;
	updatedAtMs: number;
};

export type WorkbenchBundledAgentSetting = {
	id: string;
	userId: string;
	agentName: string;
	enabled: boolean;
	createdAt: string;
	createdAtMs: number;
	updatedAt: string;
	updatedAtMs: number;
};

export type WorkbenchArtifactFolder = {
	id: string;
	projectId: string;
	parentId?: string;
	name: string;
	sortOrder: number;
	rootFrameId?: string;
	isConversationFolder: boolean;
	isUserUploadsFolder: boolean;
	artifactCount?: number;
	createdAt: string;
	createdAtMs: number;
	updatedAt: string;
	updatedAtMs: number;
};

export type WorkbenchArtifactDependency = {
	id: string;
	artifactVersionId: string;
	dependsOnVersionId: string;
	referenceName?: string;
	createdAt: string;
	createdAtMs: number;
};

export type WorkbenchContentSnapshot = {
	hash: string;
	content: string;
	sizeBytes: number;
	createdAt: string;
	createdAtMs: number;
	contentTruncated: boolean;
	snapshotPath: string;
	artifactPath: string;
	snapshotId: string;
	stateKind: "after" | "before";
};

export type WorkbenchCapabilitySetting = {
	userId: string;
	kind: string;
	key: string;
	enabled: boolean;
	updatedAt: string;
	updatedAtMs: number;
	source: string;
	status: "available" | "configured" | "disabled" | "read-only";
	settingsCollection?:
		| "allowedDomains"
		| "computeHosts"
		| "computeProviderPreferences"
		| "credentialRefs"
		| "customConnectors"
		| "memoryCategories"
		| "permissionGrants";
	settingsRecordId?: string;
};

export type WorkbenchCloudCredential = {
	id: string;
	userId: string;
	provider: "azure" | "gcs" | "local" | "s3" | "unknown";
	name: string;
	credentialType: string;
	encryptedCredentials: string;
	encryptedRefreshToken?: string;
	tokenExpiresAt?: string;
	tokenExpiresAtMs?: number;
	defaultBucket?: string;
	region?: string;
	createdAt: string;
	createdAtMs: number;
	updatedAt: string;
	updatedAtMs: number;
	status: "configured" | "missing";
	envVar: string;
	settingsRecordId: string;
};

export type WorkbenchHostGrant = {
	id: string;
	userId: string;
	hostPath: string;
	mountName: string;
	mode: "ro" | "rw";
	createdAt: string;
	createdAtMs: number;
	source: string;
	exists: boolean;
};

export type WorkbenchHostCallLogEntry = {
	id: number;
	executionLogId: string;
	seq: number;
	method: string;
	argsJson: string;
	derivable: boolean;
	dataInline?: string;
	dataRef?: string;
	error?: string;
	bytes: number;
	createdAt: string;
	createdAtMs: number;
};

export type WorkbenchSessionConcurrency = {
	rootFrameId: string;
	maxConcurrent: number;
	createdAt: string;
	createdAtMs: number;
	updatedAt: string;
	updatedAtMs: number;
};

export type WorkbenchCompactionArchive = {
	id: string;
	frameId: string;
	compactionIndex: number;
	messageCount: number;
	tokenCount?: number;
	summary: string;
	messages: string;
	createdAt: string;
	createdAtMs: number;
	piSessionId: string;
	piSessionPath: string;
	firstKeptEntryId: string;
	sourceEntryId: string;
};

export type WorkbenchFrameBranchArchive = {
	frameId: string;
	branchId: string;
	payload: string;
	updatedAt: string;
	updatedAtMs: number;
};

export type WorkbenchFrameMessage = {
	frameId: string;
	idx: number;
	msgJson: string;
	messageUuid: string;
	role: "assistant" | "system" | "user";
	status: "complete" | "error" | "queued" | "running" | "stopped";
	projectId?: string;
	runSlug?: string;
	sessionId?: string;
	createdAt: string;
	createdAtMs: number;
	source: "chat-session";
};

export type WorkbenchFrameRecord = {
	id: string;
	parentFrameId?: string;
	rootFrameId: string;
	agentName: string;
	status: string;
	inputData?: string;
	outputData?: string;
	contextData?: string;
	model?: string;
	effort?: string;
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	auxInputTokens?: number;
	auxOutputTokens?: number;
	auxCacheReadTokens?: number;
	auxCacheWriteTokens?: number;
	auxCost?: number;
	tokenClassUsage?: string;
	totalCost?: number;
	createdAt: string;
	createdAtMs: number;
	updatedAt: string;
	updatedAtMs: number;
	completedAt?: string;
	completedAtMs?: number;
	projectId?: string;
	name?: string;
	conversationType: "agent" | "uploads";
	artifactId?: string;
	taskSummary?: string;
	mentionedArtifactIds?: string;
	specialistsUsed?: string;
	isHidden: boolean;
	statusDescription?: string;
	computeEnabled?: string;
	delegateName?: string;
	lastUserMessageAt?: string;
	lastUserMessageAtMs?: number;
	lastExtractMsgIdx?: number;
	rootSeq: number;
	source: "artifact-run" | "chat-session" | "project-uploads";
};

export type WorkbenchFrameBackfillPoison = {
	frameId: string;
	failCount: number;
	terminal: boolean;
	reason?: string;
	updatedAt: string;
	updatedAtMs: number;
};

export type WorkbenchComputeProviderRecord = {
	name: string;
	displayName: string;
	family: string;
	memoryMd: string;
	environments: string[];
	memoryRev: number;
	scratchRoot?: string;
	scheduler?: string;
	probedAt?: string;
	probedAtMs?: number;
	dataRoots: string[];
	sshOverrides?: Record<string, string>;
	maxConcurrentJobs?: number;
	maxTimeoutSec?: number;
	enabled: boolean;
	scratchRootSource: "probe" | "settings" | "workspace";
	home?: string;
	scratchRootRevalidateFailedAt?: string;
	scratchRootRevalidateFailedAtMs?: number;
	inferConfig?: Record<string, string>;
	appName?: string;
	priorAppNames: string[];
	egressPolicy?: string;
	modalEnvironment?: string;
	status: "available" | "configured" | "read-only";
	tierType: "cloud" | "local" | "session";
	settingsCollection?: "computeHosts" | "credentialRefs";
	settingsRecordId?: string;
};

export type WorkbenchComputeUsageRecord = {
	id: string;
	jobId: string;
	environment: string;
	tierType: "cloud" | "local" | "session";
	provider: string;
	frameId?: string;
	projectId?: string;
	startedAt: string;
	startedAtMs: number;
	endedAt?: string;
	endedAtMs?: number;
	expiresAt?: string;
	expiresAtMs?: number;
	status: "complete" | "draft" | "error" | "planned" | "provenance" | "queued" | "running" | "stopped" | "verified";
};

export type WorkbenchComputePendingTerminate = {
	sandboxId: string;
	provider: string;
	enqueuedAt: string;
	enqueuedAtMs: number;
	attempts: number;
	jobId: string;
	remoteHandle?: string;
	status: "pending";
};

export type WorkbenchPollerLease = {
	provider: string;
	holder: string;
	expiresAt: string;
	expiresAtMs: number;
	source: "compute-polling";
	activeJobIds: string[];
	pendingTerminateIds: string[];
};

export type WorkbenchMemoryCategoryRecord = {
	id: string;
	userId: string;
	name: string;
	nameLower: string;
	guidance: string;
	autoRecall: boolean;
	createdAt: string;
	createdAtMs: number;
	updatedAt: string;
	updatedAtMs: number;
	settingsRecordId: string;
};

export type WorkbenchManagedEndpoint = {
	name: string;
	url: string;
	port: number;
	credentialName?: string;
	skillName: string;
	startScript: string;
	stopScript: string;
	livePath: string;
	approvedScriptHash: string;
	state: "failed" | "live" | "starting" | "stopped" | "stopping";
	stateChangedAt?: string;
	stateChangedAtMs?: number;
	lastError?: string;
	transcript?: string;
	createdAt: string;
	createdAtMs: number;
	registeredBy?: string;
	provider: string;
	models: string[];
	status: "disabled" | "missing" | "present";
};

export type WorkbenchMarketplaceSource = {
	id: string;
	userId: string;
	slug: string;
	kind: "github" | "local" | "npm" | "unknown";
	marketplaceName: string;
	pinnedSha: string;
	license: string;
	offeredSkills: string[];
	offeredSkillsJson: string;
	createdAt: string;
	createdAtMs: number;
	lastImportedAt: string;
	lastImportedAtMs: number;
};

export type WorkbenchSkillLicenseAssent = {
	id: string;
	userId: string;
	orgId?: string;
	resourceKey: string;
	skillName: string;
	decision: "accepted" | "declined" | "pending";
	noticeVersion: string;
	noticeText: string;
	createdAt: string;
	createdAtMs: number;
	projectId?: string;
	source: "project-skill-pack";
};

export type WorkbenchRoutineSchedule = {
	id: string;
	rootFrameId: string;
	ownerUserId: string;
	label?: string;
	onTick: string;
	everyMinutes: number;
	enabled: boolean;
	lockedAt?: string;
	lockedAtMs?: number;
	pausedReason?: string;
	nextDue: string;
	nextDueMs: number;
	tickCount: number;
	missedTicks: number;
	lastFireAt?: string;
	lastFireAtMs?: number;
	lastOkAt?: string;
	lastOkAtMs?: number;
	idleStreak: number;
	lastResults?: string;
	createdAt: string;
	createdAtMs: number;
	updatedAt: string;
	updatedAtMs: number;
	source: "watch-plan";
	planPath: string;
	baselinePath?: string;
};

export type WorkbenchSafetyFeedback = {
	id: string;
	rootFrameId: string;
	userId: string;
	type: string;
	model?: string;
	reason?: string;
	responseId?: string;
	contextSnapshot?: string;
	createdAt: string;
	createdAtMs: number;
	source: "review-request" | "store";
};

export type WorkbenchOAuthTokenRecord = {
	id: string;
	userId: string;
	mcpServerId: string;
	encryptedAccessToken: string;
	encryptedRefreshToken?: string;
	tokenType: string;
	expiresAt?: string;
	expiresAtMs?: number;
	scopes?: string;
	createdAt: string;
	createdAtMs: number;
	updatedAt: string;
	updatedAtMs: number;
	clientId?: string;
	connectorId: string;
	settingsRecordId: string;
	status: "active" | "expired";
};

export type WorkbenchUserSecret = {
	id: string;
	userId: string;
	name: string;
	provider: string;
	encryptedValue: string;
	credentialType: string;
	buckets?: string[];
	region?: string;
	description?: string;
	createdAt: string;
	createdAtMs: number;
	updatedAt: string;
	updatedAtMs: number;
	source: "auth-storage" | "environment" | "settings";
	status: "configured" | "missing";
	envVar?: string;
	settingsRecordId?: string;
};

export type WorkbenchAnthropicApiKey = {
	id: string;
	userId: string;
	encryptedApiKey: string;
	createdAt: string;
	createdAtMs: number;
	updatedAt: string;
	updatedAtMs: number;
	source: "auth-storage" | "environment" | "settings";
	status: "configured";
	envVar?: string;
	settingsRecordId?: string;
};

export type WorkbenchContactEmailDecision = {
	id: string;
	userId: string;
	decision: "accepted" | "declined" | "pending";
	email?: string;
	noticeVersion: string;
	noticeText: string;
	createdAt: string;
	createdAtMs: number;
	source: "environment" | "settings";
	envVar: string;
};

export type WorkbenchCredentialAskDecision = {
	id: string;
	userId: string;
	provider: string;
	decision: "accepted" | "declined" | "pending";
	createdAt: string;
	createdAtMs: number;
	source: "auth-storage" | "environment" | "settings";
	credentialRecordIds: string[];
};

export type WorkbenchUseIntentDeclaration = {
	id: string;
	userId: string;
	orgId?: string;
	intent: string;
	createdAt: string;
	createdAtMs: number;
	source: "onboarding";
};

export type WorkbenchUserAgent = {
	id: string;
	userId: string;
	name: string;
	displayName: string;
	description: string;
	systemPrompt: string;
	iconKey: string;
	colorKey: string;
	tags: string[];
	skillNames: string[];
	enabled: boolean;
	createdAt: string;
	createdAtMs: number;
	updatedAt: string;
	updatedAtMs: number;
	skillTombstones: string[];
	connectorTombstones: string[];
	unrestricted: boolean;
};
