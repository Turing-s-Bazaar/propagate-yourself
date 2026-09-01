import { buildWorkbenchAgentLedgers } from "./agent-ledgers.js";
import { buildWorkbenchArtifactFolders } from "./artifact-folders.js";
import { buildWorkbenchArtifactDependencies, buildWorkbenchContentSnapshots } from "./artifact-provenance-ledgers.js";
import { buildWorkbenchCapabilitySettings } from "./capability-settings.js";
import { buildWorkbenchCloudCredentials } from "./cloud-credentials.js";
import { buildWorkbenchComputeProviderRecords } from "./compute-provider-records.js";
import { readWorkbenchFrameBackfillPoison } from "./frame-backfill-poison.js";
import { buildWorkbenchFrameMessages } from "./frame-messages.js";
import { buildWorkbenchFrames } from "./frames.js";
import { buildWorkbenchHostCallLog } from "./host-call-log.js";
import { buildWorkbenchHostGrants } from "./host-grants.js";
import { buildWorkbenchManagedEndpoints } from "./managed-endpoints.js";
import { buildWorkbenchMarketplaceLedgers } from "./marketplace-ledgers.js";
import { buildWorkbenchMemoryCategories } from "./memory-categories.js";
import { buildWorkbenchMcpLedgers } from "./mcp-ledgers.js";
import { buildWorkbenchOAuthTokenRecords } from "./oauth-token-ledger.js";
import { buildWorkbenchRoutineSchedules } from "./routine-schedules.js";
import { buildWorkbenchSecretLedgers } from "./secret-ledgers.js";
import { buildWorkbenchContactEmailDecisions, buildWorkbenchCredentialAskDecisions } from "./setup-decision-ledgers.js";
import { buildWorkbenchSessionArchives } from "./session-archives.js";
import { buildWorkbenchSkillLedgers } from "./skill-ledgers.js";
import { buildWorkbenchUseIntentDeclarations } from "./use-intent-declarations.js";
import { buildWorkbenchUserAgents } from "./user-agents.js";
import type { WorkbenchChatSession } from "./chat.js";
import type {
	WorkbenchArtifact,
	WorkbenchArtifactDependency,
	WorkbenchArtifactFolder,
	WorkbenchArtifactVersion,
	WorkbenchAgentRecord,
	WorkbenchAnthropicApiKey,
	WorkbenchBundledAgentSetting,
	WorkbenchCapabilitySetting,
	WorkbenchCloudCredential,
	WorkbenchComputeProvider,
	WorkbenchComputeProviderRecord,
	WorkbenchContentSnapshot,
	WorkbenchCompactionArchive,
	WorkbenchContactEmailDecision,
	WorkbenchCredentialAskDecision,
	WorkbenchFrameBackfillPoison,
	WorkbenchCustomAgentPrompt,
	WorkbenchCustomMcpServer,
	WorkbenchCustomSkill,
	WorkbenchDirectoryAttachment,
	WorkbenchExecutionRecord,
	WorkbenchFrameBranchArchive,
	WorkbenchFrameMessage,
	WorkbenchFrameRecord,
	WorkbenchHostCallLogEntry,
	WorkbenchHostGrant,
	WorkbenchManagedEndpoint,
	WorkbenchMarketplaceSource,
	WorkbenchMemoryCategoryRecord,
	WorkbenchMcpAgentAssignment,
	WorkbenchMcpToolGrant,
	WorkbenchOAuthTokenRecord,
	WorkbenchAgentSkillAssignment,
	WorkbenchProject,
	WorkbenchResourceGroup,
	WorkbenchRoutineSchedule,
	WorkbenchRun,
	WorkbenchSessionConcurrency,
	WorkbenchSkillLicenseAssent,
	WorkbenchUseIntentDeclaration,
	WorkbenchUserAgent,
	WorkbenchUserSecret,
} from "./types.js";

export function buildWorkbenchStateLedgers({
	artifacts,
	artifactVersions,
	authPath,
	chatSessions,
	compute,
	execution,
	projects,
	resources,
	runs,
	workingDir,
}: {
	artifacts: WorkbenchArtifact[];
	artifactVersions: WorkbenchArtifactVersion[];
	authPath?: string;
	chatSessions: WorkbenchChatSession[];
	compute: WorkbenchComputeProvider[];
	execution: WorkbenchExecutionRecord[];
	projects: WorkbenchProject[];
	resources: WorkbenchResourceGroup[];
	runs: WorkbenchRun[];
	workingDir: string;
}): {
	artifactDependencies: WorkbenchArtifactDependency[];
	artifactFolders: WorkbenchArtifactFolder[];
	contentSnapshots: WorkbenchContentSnapshot[];
	capabilitySettings: WorkbenchCapabilitySetting[];
	cloudCredentials: WorkbenchCloudCredential[];
	computeProviders: WorkbenchComputeProviderRecord[];
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
	frames: WorkbenchFrameRecord[];
	frameMessages: WorkbenchFrameMessage[];
	frameBackfillPoison: WorkbenchFrameBackfillPoison[];
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
} {
	const skillLedgers = buildWorkbenchSkillLedgers(workingDir);
	const marketplaceLedgers = buildWorkbenchMarketplaceLedgers(workingDir, skillLedgers.customSkills);
	const mcpLedgers = buildWorkbenchMcpLedgers({ resources, workingDir });
	const agentLedgers = buildWorkbenchAgentLedgers(workingDir);
	const sessionArchives = buildWorkbenchSessionArchives(workingDir, chatSessions);
	const secretLedgers = buildWorkbenchSecretLedgers({ authPath, workingDir });
	const frames = buildWorkbenchFrames({ projects, runs, sessions: chatSessions });
	return {
		artifactDependencies: buildWorkbenchArtifactDependencies(artifactVersions),
		artifactFolders: buildWorkbenchArtifactFolders({ artifacts, projects, runs }),
		contentSnapshots: buildWorkbenchContentSnapshots(workingDir),
		capabilitySettings: buildWorkbenchCapabilitySettings({ compute, resources, workingDir }),
		cloudCredentials: buildWorkbenchCloudCredentials(workingDir),
		computeProviders: buildWorkbenchComputeProviderRecords(workingDir, compute),
		managedEndpoints: buildWorkbenchManagedEndpoints(workingDir),
		...marketplaceLedgers,
		routineSchedules: buildWorkbenchRoutineSchedules(workingDir),
		oauthTokens: buildWorkbenchOAuthTokenRecords(workingDir, mcpLedgers.customMcpServers),
		...secretLedgers,
		contactEmailDecisions: buildWorkbenchContactEmailDecisions(),
		credentialAskDecisions: buildWorkbenchCredentialAskDecisions(secretLedgers.userSecrets),
		useIntentDeclarations: buildWorkbenchUseIntentDeclarations(workingDir),
		hostCallLog: buildWorkbenchHostCallLog(execution),
		hostGrants: buildWorkbenchHostGrants(workingDir),
		frames,
		frameMessages: buildWorkbenchFrameMessages(chatSessions),
		frameBackfillPoison: readWorkbenchFrameBackfillPoison(workingDir, frames),
		...sessionArchives,
		...mcpLedgers,
		...agentLedgers,
		...skillLedgers,
		userAgents: buildWorkbenchUserAgents(workingDir, skillLedgers.customSkills),
		memoryCategories: buildWorkbenchMemoryCategories(workingDir),
	};
}
