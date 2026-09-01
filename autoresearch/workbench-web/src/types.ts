import type {
	WorkbenchArtifact,
	WorkbenchArtifactAnnotation,
	WorkbenchArtifactActionItem,
	WorkbenchArtifactVersion,
	WorkbenchComputeJobRecord,
	WorkbenchComputeProvider,
	WorkbenchCloudCredential,
	WorkbenchCloudExportRecord,
	WorkbenchCloudExportTarget,
	WorkbenchCustomMcpServer,
	WorkbenchDirectoryAttachment,
	WorkbenchExecutionRecord,
	WorkbenchFrameEvent,
	WorkbenchFrameSystemPrompt,
	WorkbenchGeneratedPlan,
	WorkbenchMcpAgentAssignment,
	WorkbenchMcpToolGrant,
	WorkbenchQueuedUserMessage,
	WorkbenchNotebookCell,
	WorkbenchNotebookEnvironmentRecord,
	WorkbenchNotebookKernelRecord,
	WorkbenchPlanStepStatus,
	WorkbenchProject,
	WorkbenchResource,
	WorkbenchResourceGroup,
	WorkbenchResearchClaim,
	WorkbenchRun,
	WorkbenchSessionActivityItem,
	WorkbenchSessionNotification,
	WorkbenchSessionSeenMark,
	WorkbenchState,
	WorkbenchTranscriptAnnotation,
	WorkbenchVerificationCheck,
} from "../../src/workbench/types.js";
import type {
	WorkbenchChatMessage,
	WorkbenchChatSession,
	WorkbenchToolEvent,
} from "../../src/workbench/chat.js";
import type {
	WorkbenchMemoryRecord,
	WorkbenchNoteRecord,
} from "../../src/workbench/memory.js";

export type {
	WorkbenchArtifact,
	WorkbenchArtifactAnnotation,
	WorkbenchArtifactActionItem,
	WorkbenchArtifactVersion,
	WorkbenchChatMessage,
	WorkbenchChatSession,
	WorkbenchCloudCredential,
	WorkbenchCloudExportRecord,
	WorkbenchCloudExportTarget,
	WorkbenchComputeJobRecord,
	WorkbenchComputeProvider,
	WorkbenchCustomMcpServer,
	WorkbenchDirectoryAttachment,
	WorkbenchExecutionRecord,
	WorkbenchFrameEvent,
	WorkbenchFrameSystemPrompt,
	WorkbenchGeneratedPlan,
	WorkbenchMemoryRecord,
	WorkbenchMcpAgentAssignment,
	WorkbenchMcpToolGrant,
	WorkbenchNoteRecord,
	WorkbenchNotebookCell,
	WorkbenchNotebookEnvironmentRecord,
	WorkbenchNotebookKernelRecord,
	WorkbenchPlanStepStatus,
	WorkbenchProject,
	WorkbenchQueuedUserMessage,
	WorkbenchResource,
	WorkbenchResourceGroup,
	WorkbenchResearchClaim,
	WorkbenchRun,
	WorkbenchSessionActivityItem,
	WorkbenchSessionNotification,
	WorkbenchSessionSeenMark,
	WorkbenchState,
	WorkbenchTranscriptAnnotation,
	WorkbenchToolEvent,
	WorkbenchVerificationCheck,
};

export type FilePreview = {
	path: string;
	name: string;
	category: string;
	sizeBytes: number;
	updatedAt: string;
	content: string;
	truncated: boolean;
};

export type EditableArtifact = {
	artifactPath: string;
	content: string;
	sizeBytes: number;
	checksum: string;
};

export type ArtifactEditResult = {
	artifactPath: string;
	sizeBytes: number;
	checksum: string;
	changed: boolean;
	snapshotRecords: Array<{ artifactPath: string; snapshotPath?: string; producerExecutionId?: string }>;
};

export type ArtifactVersionDiffLine = {
	kind: "add" | "context" | "remove";
	text: string;
	oldLine?: number;
	newLine?: number;
};

export type ArtifactVersionDiff = {
	artifactPath: string;
	versionId: string;
	isText: boolean;
	truncated: boolean;
	addedLines: number;
	removedLines: number;
	contextLines: number;
	lines: ArtifactVersionDiffLine[];
};

export type ArtifactVersionRestore = {
	artifactPath: string;
	versionId: string;
	snapshotPath: string;
	bytesWritten: number;
	checksum: string;
	snapshotRecords: Array<{ artifactPath: string; snapshotPath?: string; producerExecutionId?: string }>;
};
