import {
	ArrowLeft,
	Atom,
	AtSign,
	BookOpen,
	Bot,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	CloudUpload,
	Copy,
	Database,
	Download,
	EyeOff,
	FileJson,
	FileText,
	FolderOpen,
	GitCompare,
	Hash,
	History,
	Image as ImageIcon,
	Layers,
	Link,
	MessageSquare,
	Pencil,
	PanelLeft,
	PanelRightOpen,
	Play,
	Plus,
	RotateCcw,
	Save,
	Search,
	Send,
	Settings,
	Slash,
	Star,
	StickyNote,
	Table2,
	Trash2,
	Upload,
	X,
} from "lucide-react";
import { createElement, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from "react";
import { createRoot } from "react-dom/client";
import { JsonView, allExpanded, collapseAllNested, defaultStyles } from "react-json-view-lite";
import { ScrollArea, Tabs } from "radix-ui";

import type {
	ArtifactVersionDiff,
	FilePreview,
	WorkbenchChatMessage,
	WorkbenchArtifact,
	WorkbenchArtifactAnnotation,
	WorkbenchArtifactActionItem,
	WorkbenchArtifactVersion,
	WorkbenchCloudCredential,
	WorkbenchCloudExportTarget,
	WorkbenchChatSession,
	WorkbenchComputeJobRecord,
	WorkbenchComputeProvider,
	WorkbenchGeneratedPlan,
	WorkbenchMemoryRecord,
	WorkbenchNoteRecord,
	WorkbenchNotebookCell,
	WorkbenchNotebookEnvironmentRecord,
	WorkbenchNotebookKernelRecord,
	WorkbenchPlanStepStatus,
	WorkbenchProject,
	WorkbenchResource,
	WorkbenchResourceGroup,
	WorkbenchRun,
	WorkbenchSessionActivityItem,
	WorkbenchState,
	WorkbenchTranscriptAnnotation,
	WorkbenchToolEvent,
} from "./types.js";
import {
	isTerminalChatStreamEvent,
	parseStreamChunk,
	patchLastAssistant,
	upsertAssistantTool,
	type WorkbenchChatStreamEvent,
} from "./stream.js";
import {
	artifactClaimsForPath,
	artifactChecksForPath,
	artifactDownloadUrl,
	artifactExecutionsForPath,
	artifactPreviewKind,
	artifactUsesTextPreview,
	artifactVersionsForPath,
	formatBytes,
	inferGenomeBrowserTrack,
	parseDelimitedPreview,
	parseGenomePreview,
	parseJsonPreview,
	parseLatexPreview,
	parseMoleculePreview,
	parseMsaPreview,
	parseNotebookPreview,
	parseSequencePreview,
	parseSpreadsheetPreview,
	parseStructurePreview,
	parseTreePreview,
	shortChecksum,
	type ArtifactPreviewKind,
	type SpreadsheetPreview,
} from "./artifacts.js";
import {
	artifactEditDisabledReason,
	artifactEditReadPath,
	artifactMetadataFilename,
	artifactMetadataPayload,
	artifactMutationBody,
	artifactRecoveryAction,
	artifactRecoveryLabel,
	artifactReferenceUrl,
	artifactVersionActionBody,
	cloudExportBody,
	configuredCloudExportTarget,
	versionActionKey,
	type ArtifactActionPayload,
	type ArtifactCloudExportPayload,
	type ArtifactEditReadPayload,
	type ArtifactEditSavePayload,
	type ArtifactMutationAction,
	type ArtifactVersionDiffPayload,
	type ArtifactVersionRestorePayload,
} from "./artifact-actions.js";
import {
	annotationAnchorSummary,
	artifactAnnotationsForPath,
	canSuggestArtifactRefinement,
	mediaSelectionFromPoints,
	refinementAnnotationBody,
	refinementApplyBody,
	refinementSuggestBody,
	textSelectionFromOffsets,
	textSelectionFromSelectedText,
	wordDiffParts,
	type ArtifactAnchorSelection,
	type ArtifactRefinementMode,
	type ArtifactRefinementPhase,
	type ArtifactRefinementSuggestion,
	type ArtifactTextSelection,
} from "./artifact-refinement.js";
import {
	artifactCategoryCounts,
	artifactsForFileScope,
	defaultArtifactPathForRun,
	fileScopeCounts,
	fileScopeLabel,
	filterArtifactsForBrowser,
	type FileBrowserScope,
	type FileCategoryFilter,
} from "./files.js";
import {
	attachmentDownloadUrl,
	filterUploadsForBrowser,
	uploadPreviewText,
	type WorkbenchUpload,
} from "./uploads.js";
import {
	activeComposerTrigger,
	applyComposerSuggestion,
	beginComposerTrigger,
	composerSuggestions,
	type ComposerSuggestion,
	type ComposerTrigger,
} from "./composer.js";
import { PdfArtifactPreview } from "./pdf-preview.js";
import {
	filterResourceGroups,
	resourceActions,
	resourceDirectoryCounts,
	type ResourceAction,
	type ResourceDirectoryGroupFilter,
	type ResourceDirectoryStatusFilter,
} from "./resources.js";
import {
	defaultMemoryScope,
	memoriesForScope,
	memoryScopeLabel,
	notesForTarget,
	type MemoryScopeFilter,
} from "./memory.js";
import {
	computeJobAction,
	computeJobsForRun,
	defaultNotebookCode,
	environmentsByLanguage,
	kernelsForRun,
	normalizeNotebookPackageInput,
	notebookEnvironmentActionLabel,
	notebookEnvironmentLanguages,
	notebookCellsForRun,
	type ComputeJobAction,
	type NotebookEnvironmentLanguage,
	type NotebookEnvironmentMode,
	type NotebookExecutionMode,
	type NotebookLanguage,
	type NotebookPurpose,
} from "./notebook.js";
import {
	parseWorkbenchRoute,
	resolveWorkbenchRoute,
	workbenchHomePath,
	workbenchProjectPath,
	workbenchRoutesEqual,
	type WorkbenchViewRoute,
} from "./routes.js";
import {
	connectorApprovalRetryPrompt,
	toolActivityViews,
	type ConnectorApprovalDecision,
	type ConnectorApprovalView,
	type ToolActivityTone,
	type ToolActivityView,
} from "./tool-activity.js";
import {
	IgvGenomePreview,
	KetcherMoleculeEditor,
	RdkitMoleculePreview,
	ThreeDmolPreview,
	TidyTreePreview,
} from "./science-viewers.js";
import {
	formatTensorValue,
	parseTensorArchivePreview,
	type TensorArchivePreview,
	type TensorArrayPreview,
	type TensorValueCell,
} from "./tensor-preview.js";

import "react-json-view-lite/dist/index.css";
import "./styles.css";

type SidePanel = "compute" | "customize" | "files" | "memory" | "notebook" | null;
type CenterPane = "chat" | "files";

type ViewerStatus = {
	state: "error" | "loading" | "ready";
	message: string;
};

type ArtifactEditState = {
	path: string;
	original: string;
	draft: string;
	status: string;
	loading: boolean;
	saving: boolean;
};

type VersionDiffState = {
	loading?: boolean;
	diff?: ArtifactVersionDiff;
	error?: string;
};

type WorkbenchPlanAction = "approve" | "reject" | "reopen";

type ArtifactRefinementState = {
	artifactPath: string;
	instruction: string;
	phase: ArtifactRefinementPhase;
	selection: ArtifactAnchorSelection;
	source?: "fallback" | "model";
	status: string;
	suggestion: string;
	suggestionDraft: string;
	suggestionMode: ArtifactRefinementMode;
};

type MediaAnnotationDraft = {
	artifactPath: string;
	endX?: number;
	endY?: number;
	mediaKind: "image" | "pdf";
	pageNumber?: number;
	startX: number;
	startY: number;
};

type ArtifactRefinementControls = {
	annotationBusyId: string | null;
	state: ArtifactRefinementState | null;
	mediaDraft: MediaAnnotationDraft | null;
	mediaModePath: string | null;
	onApply: () => void;
	onClose: () => void;
	onDraft: (draft: string) => void;
	onMediaDraft: (draft: MediaAnnotationDraft | null) => void;
	onMediaMode: (artifactPath: string | null) => void;
	onInstruction: (instruction: string) => void;
	onRemoveAnnotation: (annotationId: string) => void;
	onSaveAnnotation: () => void;
	onSuggest: (mode: ArtifactRefinementMode) => void;
	onTextSelection: (selection: ArtifactAnchorSelection) => void;
	onUseAnnotation: (annotation: WorkbenchArtifactAnnotation) => void;
};

type ArtifactActionControls = {
	busyKey: string | null;
	cloudTarget: WorkbenchCloudExportTarget | null;
	status: string;
	onAction: (artifact: WorkbenchArtifact, action: ArtifactMutationAction) => void;
	onCloudExport: (artifact: WorkbenchArtifact) => void;
	onCopyLink: (artifact: WorkbenchArtifact) => void;
	onExportMetadata: (artifact: WorkbenchArtifact) => void;
	onNotes: (artifact: WorkbenchArtifact) => void;
	onRecover: (item: WorkbenchArtifactActionItem) => void;
	onViewContext: () => void;
};

type CloudExportDraft = {
	artifactPath: string;
	credentialId: string;
	destinationPath: string;
};

type FileHostOption = {
	id: string;
	name: string;
	kind: "byoc" | "cloud" | "local" | "ssh";
	detail?: string;
	reachable: boolean;
	errorSummary?: string;
};

type NotebookExecutionResult = {
	id: string;
	language: string;
	executionMode: NotebookExecutionMode;
	status: string;
	stdout: string;
	stderr: string;
	durationMs: number;
	outputPaths: string[];
	error?: string;
};

type NotebookEnvironmentActionResult = {
	id: string;
	mode: NotebookEnvironmentMode;
	language: NotebookEnvironmentLanguage;
	environmentName: string;
	packages: string[];
	status: string;
	command: string;
	stdout: string;
	stderr: string;
	durationMs: number;
	updatedAt: string;
};

type ComputeProviderAction = NonNullable<WorkbenchComputeProvider["actions"]>[number]["id"];

type AppMode = "launcher" | "onboarding" | "workbench";

type OnboardingDraft = {
	field: string;
	goal: string;
	workflow: string;
	dataTools: string[];
	bottlenecks: string[];
	notes: string;
	permissions: string[];
	selectedTaskIndex: number;
};

type OnboardingTask = {
	title: string;
	description: string;
};

type OnboardingCompletePayload = {
	onboarding: WorkbenchState["onboarding"];
	project: WorkbenchProject;
	session: WorkbenchChatSession;
	state: WorkbenchState;
};

type LauncherQueueTone = "complete" | "needs_input" | "running";

type LauncherQueueItem = {
	artifactPath?: string;
	badge: string;
	description: string;
	project: WorkbenchProject;
	run: WorkbenchRun;
	sortMs: number;
	title: string;
	tone: LauncherQueueTone;
};

type CommandPaletteGroup = {
	label: string;
	items: CommandPaletteItem[];
};

type CommandPaletteItem =
	| { id: string; kind: "artifact"; artifact: WorkbenchArtifact; project: WorkbenchProject; run?: WorkbenchRun; label: string; sublabel: string; updatedAtMs: number }
	| { id: string; kind: "new-project"; label: string; sublabel: string; updatedAtMs: number }
	| { id: string; kind: "project"; project: WorkbenchProject; run?: WorkbenchRun; label: string; sublabel: string; updatedAtMs: number }
	| { id: string; kind: "session"; project: WorkbenchProject; run: WorkbenchRun; label: string; sublabel: string; updatedAtMs: number };

const maxVisibleRuns = 6;
const clientToken = new URLSearchParams(window.location.search).get("token") || "";
const sessionSpecialistOptions = ["None", "researcher", "reviewer", "writer", "verifier"];

function formatSpecialistLabel(value: string): string {
	if (!value || value === "None") return "None";
	return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function formatModelLabel(spec: string | undefined): string {
	if (!spec) return "Default";
	const modelId = spec.split("/").slice(1).join("/") || spec;
	return modelId
		.replace(/^claude-/i, "")
		.replace(/-/g, " ")
		.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

const emptyOnboardingDraft: OnboardingDraft = {
	field: "",
	goal: "",
	workflow: "",
	dataTools: [],
	bottlenecks: [],
	notes: "",
	permissions: ["files", "science-databases", "web", "memory"],
	selectedTaskIndex: 0,
};

const onboardingFieldOptions = [
	"Biology / medicine",
	"Chemistry / materials",
	"AI / computation",
	"Climate / earth systems",
	"Social science",
	"Interdisciplinary",
];

const onboardingGoalOptions = [
	"Find and rank evidence",
	"Design an experiment",
	"Reproduce a result",
	"Analyze a dataset",
	"Write or revise a paper",
	"Build a literature map",
];

const onboardingWorkflowOptions = [
	"Paper-first reading",
	"Code and notebooks",
	"Bench or field data",
	"Clinical or regulatory evidence",
	"Model evaluation",
	"Figure and report production",
];

const onboardingToolOptions = [
	"PDFs",
	"CSV / tables",
	"Sequences / FASTA",
	"Protein structures",
	"Literature databases",
	"Local code",
	"Remote compute",
	"Images / figures",
];

const onboardingBottleneckOptions = [
	"Finding the right sources",
	"Citation verification",
	"Reproduction setup",
	"Messy data formats",
	"Compute environments",
	"Connecting tools",
	"Tracking provenance",
	"Turning results into writing",
];

const onboardingPermissionOptions = [
	{ id: "files", title: "Local files", description: "Import PDFs, datasets, code, figures, and generated outputs." },
	{ id: "science-databases", title: "Science databases", description: "Use Feynman Bio Tools for public papers, genes, variants, proteins, structures, trials, and datasets." },
	{ id: "web", title: "Web evidence", description: "Search public papers, docs, datasets, and source pages." },
	{ id: "compute", title: "Local compute", description: "Run notebook cells after the project opens." },
	{ id: "connectors", title: "MCP connectors", description: "Register project-scoped tool connectors when selected." },
	{ id: "memory", title: "Project memory", description: "Recall setup preferences and verified findings for this project." },
	{ id: "credentials", title: "Credential references", description: "Show credential placeholders without exposing secrets." },
];

function cx(...parts: Array<string | false | null | undefined>): string {
	return parts.filter(Boolean).join(" ");
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(path, {
		...init,
		headers: {
			accept: "application/json",
			...(clientToken ? { "x-feynman-token": clientToken } : {}),
			...(init?.body ? { "content-type": "application/json" } : {}),
			...(init?.headers ?? {}),
		},
	});
	if (!response.ok) throw new Error(await response.text());
	return await response.json() as T;
}

async function loadFilePreview(artifactPath: string): Promise<FilePreview> {
	try {
		return await fetchJson<FilePreview>(`/api/file?path=${encodeURIComponent(artifactPath)}`);
	} catch (loadError) {
		return {
			path: artifactPath,
			name: artifactPath.split("/").at(-1) ?? artifactPath,
			category: "output",
			sizeBytes: 0,
			updatedAt: "",
			content: loadError instanceof Error ? loadError.message : String(loadError),
			truncated: false,
		};
	}
}

function parseRoute(): WorkbenchViewRoute | null {
	return parseWorkbenchRoute(window.location.pathname);
}

function parseArtifactParam(): string | null {
	const value = new URLSearchParams(window.location.search).get("artifact")?.trim();
	return value || null;
}

function projectPath(projectId: string, runSlug: string, artifactPath?: string | null): string {
	return workbenchProjectPath(projectId, runSlug, window.location.pathname, { artifactPath });
}

function launcherPath(): string {
	return workbenchHomePath(window.location.pathname);
}

function formatShortDate(value?: string): string {
	if (!value) return "";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	}).format(date);
}

function transcriptAnnotationsForMessage(
	annotations: WorkbenchTranscriptAnnotation[],
	rootFrameId: string | undefined,
	messageId: string,
	messageIndex: number,
): WorkbenchTranscriptAnnotation[] {
	if (!rootFrameId) return [];
	return annotations
		.filter((annotation) =>
			annotation.rootFrameId === rootFrameId &&
			(annotation.messageUuid === messageId || annotation.messageIndex === messageIndex)
		)
		.sort((a, b) => a.blockIndex - b.blockIndex || a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id));
}

function selectedTranscriptAnchor(messageId: string, fallback: string): string {
	const selection = window.getSelection();
	const selectedText = selection?.toString().trim();
	if (selection && selectedText) {
		const node = selection.anchorNode;
		const element = node instanceof Element ? node : node?.parentElement;
		const messageElement = document.querySelector(`[data-transcript-message-id="${CSS.escape(messageId)}"] [data-transcript-content]`);
		if (messageElement && element && messageElement.contains(element)) return selectedText.slice(0, 1_200);
	}
	return (fallback.trim() || "No content recorded yet.").slice(0, 1_200);
}

function runStatusLabel(run: WorkbenchRun): string {
	if (run.hasVerification) return "Verified";
	if (run.hasProvenance) return "Provenance";
	if (run.hasPlan) return "Plan";
	return run.status;
}

function sidePanelMeta(panel: Exclude<SidePanel, null>): { label: string; title: string } {
	if (panel === "notebook") return { label: "Notebook", title: "Run code" };
	if (panel === "compute") return { label: "Compute", title: "Jobs" };
	if (panel === "memory") return { label: "Memory", title: "Research notes" };
	if (panel === "customize") return { label: "Capabilities", title: "Customize" };
	return { label: "Run files", title: "Artifacts" };
}

function createClientJobId(prefix: string): string {
	if (window.crypto?.randomUUID) return `${prefix}-${window.crypto.randomUUID()}`;
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function defaultSidePanel(): SidePanel {
	return null;
}

function toggleListValue(items: string[], value: string): string[] {
	return items.includes(value) ? items.filter((item) => item !== value) : [...items, value];
}

function shortValue(value: string | undefined, fallback: string): string {
	return value?.trim() || fallback;
}

function deriveOnboardingTasks(draft: OnboardingDraft): OnboardingTask[] {
	const field = shortValue(draft.field, "open science");
	const goal = shortValue(draft.goal, "find and rank evidence").toLowerCase();
	const workflow = shortValue(draft.workflow, "research workflow").toLowerCase();
	const tools = draft.dataTools.length ? draft.dataTools.join(", ") : "papers, data, and code";
	const bottleneck = draft.bottlenecks[0]?.toLowerCase() ?? "provenance";
	const prefix = field.split("/")[0].trim();
	return [
		{
			title: `${prefix} evidence map`,
			description: `Map the strongest sources for ${goal}, preserve identifiers and URLs, and rank what should be read or reproduced first.`,
		},
		{
			title: `${prefix} reproducibility plan`,
			description: `Turn the current ${workflow} into a stepwise reproduction plan using ${tools}, with checks for ${bottleneck}.`,
		},
		{
			title: `${prefix} artifact and provenance audit`,
			description: `Organize the available files, methods, figures, and claims into an auditable project with verification records attached to outputs.`,
		},
	];
}

function launcherSeedCards(state: WorkbenchState): string[] {
	const seedProject = state.projects.find((project) => project.id === "seed-workflows");
	if (!seedProject) return [];
	return state.runs
		.filter((run) => seedProject.runSlugs.includes(run.slug))
		.sort((left, right) => right.updatedAtMs - left.updatedAtMs || left.title.localeCompare(right.title))
		.slice(0, 4)
		.map((run) => `${run.title}: ${run.artifactCount} artifacts`);
}

function primaryRunForProject(state: WorkbenchState, project: WorkbenchProject): WorkbenchRun | undefined {
	return state.runs.find((run) => run.slug === project.primaryRunSlug)
		?? state.runs.find((run) => project.runSlugs.includes(run.slug) || run.projectId === project.id);
}

function recentRunsForLauncher(state: WorkbenchState): WorkbenchRun[] {
	return state.runs.slice().sort((left, right) => right.updatedAtMs - left.updatedAtMs).slice(0, 6);
}

function timestampMs(value?: string): number {
	if (!value) return 0;
	const time = new Date(value).getTime();
	return Number.isFinite(time) ? time : 0;
}

function projectForRun(state: WorkbenchState, run: WorkbenchRun): WorkbenchProject {
	return state.projects.find((project) => project.id === run.projectId)
		?? state.projects.find((project) => project.runSlugs.includes(run.slug))
		?? state.projects[0];
}

function queuePlanItems(state: WorkbenchState): LauncherQueueItem[] {
	return state.plans.flatMap((plan): LauncherQueueItem[] => {
		const run = state.runs.find((item) => item.slug === plan.runSlug || item.slug === plan.sessionId);
		if (!run) return [];
		const project = projectForRun(state, run);
		const base = {
			artifactPath: plan.artifactPath,
			description: plan.taskSummary,
			project,
			run,
			sortMs: timestampMs(plan.updatedAt),
			title: run.title || plan.title,
		};
		if (plan.status === "awaiting_approval") return [{ ...base, badge: "Plan ready", tone: "needs_input" as const }];
		if (plan.status === "rejected") return [{ ...base, badge: "Needs revision", tone: "needs_input" as const }];
		if (plan.status === "running") return [{ ...base, badge: "Running", tone: "running" as const }];
		if (plan.status === "complete") return [{ ...base, badge: "Completed", tone: "complete" as const }];
		return [];
	});
}

function queueComputeItems(state: WorkbenchState): LauncherQueueItem[] {
	return state.computeJobs.flatMap((job): LauncherQueueItem[] => {
		const run = state.runs.find((item) => item.slug === job.runSlug || item.slug === job.sessionId);
		if (!run) return [];
		const project = projectForRun(state, run);
		if (job.status === "queued" || job.status === "running") {
			return [{
				badge: job.status === "queued" ? "Queued" : "Running",
				description: job.detail || job.command,
				project,
				run,
				sortMs: job.startedAtMs || timestampMs(job.startedAt),
				title: job.title,
				tone: "running" as const,
			}];
		}
		if (job.status === "error" || job.status === "stopped") {
			return [{
				badge: job.status === "error" ? "Failed" : "Stopped",
				description: job.error || job.detail || job.command,
				project,
				run,
				sortMs: job.endedAtMs || timestampMs(job.endedAt),
				title: job.title,
				tone: "needs_input" as const,
			}];
		}
		if (job.status === "complete" || job.status === "verified") {
			return [{
				badge: job.status === "verified" ? "Verified" : "Completed",
				description: job.outputPaths.length ? `${job.outputPaths.length} output artifact(s) returned.` : job.detail || job.command,
				project,
				run,
				sortMs: job.endedAtMs || timestampMs(job.endedAt),
				title: job.title,
				tone: "complete" as const,
			}];
		}
		return [];
	});
}

function shouldShowActivityInQueue(activity: WorkbenchSessionActivityItem): boolean {
	if (activity.eventType === "plan_status" || activity.eventType === "compute_done" || activity.eventType === "compute_update") return false;
	if (activity.kind === "queued_user_message" && activity.status !== "complete") return true;
	if (activity.status === "failed" || activity.status === "stopped" || activity.status === "needs_input") return true;
	if (activity.status === "queued" || activity.status === "running") return true;
	if (!activity.unread) return false;
	return activity.eventType === "assistant_message" || activity.eventType === "tool_event" || activity.eventType === "queued_user_message";
}

function activityBadge(activity: WorkbenchSessionActivityItem): string {
	if (activity.status === "failed") return "Failed";
	if (activity.status === "stopped") return "Stopped";
	if (activity.status === "needs_input") return "Needs input";
	if (activity.status === "queued") return "Queued";
	if (activity.status === "running") return "Running";
	return activity.unread ? "Unread" : "Updated";
}

function activityTone(activity: WorkbenchSessionActivityItem): LauncherQueueTone {
	if (activity.status === "failed" || activity.status === "stopped" || activity.status === "needs_input") return "needs_input";
	if (activity.status === "queued" || activity.status === "running") return "running";
	return activity.unread ? "needs_input" : "complete";
}

function queueActivityItems(state: WorkbenchState): LauncherQueueItem[] {
	return state.sessionActivity
		.filter(shouldShowActivityInQueue)
		.flatMap((activity): LauncherQueueItem[] => {
			const run = state.runs.find((item) => item.slug === activity.runSlug || item.slug === activity.sessionId || item.slug === activity.rootFrameId);
			if (!run) return [];
			const project = projectForRun(state, run);
			if (!project) return [];
			return [{
				artifactPath: activity.artifactPaths[0],
				badge: activityBadge(activity),
				description: activity.detail,
				project,
				run,
				sortMs: activity.createdAtMs,
				title: activity.title,
				tone: activityTone(activity),
			}];
		});
}

function launcherQueueItems(state: WorkbenchState): LauncherQueueItem[] {
	const priority: Record<LauncherQueueTone, number> = {
		needs_input: 0,
		running: 1,
		complete: 2,
	};
	return [...queuePlanItems(state), ...queueComputeItems(state), ...queueActivityItems(state)]
		.sort((left, right) => priority[left.tone] - priority[right.tone] || right.sortMs - left.sortMs || left.title.localeCompare(right.title))
		.slice(0, 6);
}

function commandText(value: string | undefined): string {
	return (value ?? "").toLowerCase();
}

function commandMatches(query: string, fields: string[]): boolean {
	const needle = commandText(query.trim());
	if (!needle) return true;
	return fields.some((field) => commandText(field).includes(needle));
}

function projectForArtifact(state: WorkbenchState, artifact: WorkbenchArtifact): WorkbenchProject | undefined {
	return state.projects.find((item) => item.artifactPaths.includes(artifact.path)) ?? state.projects[0];
}

function runForArtifact(state: WorkbenchState, project: WorkbenchProject, artifact: WorkbenchArtifact): WorkbenchRun | undefined {
	return state.runs.find((item) => item.primaryArtifact?.path === artifact.path)
		?? state.runs.find((item) => project.runSlugs.includes(item.slug) && artifact.path.includes(item.slug))
		?? primaryRunForProject(state, project);
}

function commandPaletteGroups(state: WorkbenchState, query: string): CommandPaletteGroup[] {
	const projects = state.projects
		.filter((project) => commandMatches(query, [project.name, project.description, project.id]))
		.sort((left, right) => right.updatedAtMs - left.updatedAtMs || left.name.localeCompare(right.name))
		.slice(0, 5)
		.map((project): CommandPaletteItem => ({
			id: `project:${project.id}`,
			kind: "project",
			label: project.name,
			project,
			run: primaryRunForProject(state, project),
			sublabel: `${project.description} / ${project.sessionCount} sessions / ${project.artifactCount} artifacts`,
			updatedAtMs: project.updatedAtMs,
		}));
	const sessions = state.runs
		.filter((run) => commandMatches(query, [run.title, run.taskSummary, run.slug, runStatusLabel(run)]))
		.sort((left, right) => right.updatedAtMs - left.updatedAtMs || left.title.localeCompare(right.title))
		.slice(0, 6)
		.flatMap((run): CommandPaletteItem[] => {
			const project = projectForRun(state, run);
			if (!project) return [];
			return [{
				id: `session:${run.slug}`,
				kind: "session",
				label: run.title,
				project,
				run,
				sublabel: `${project.name} / ${runStatusLabel(run)} / ${run.artifactCount} artifacts`,
				updatedAtMs: run.updatedAtMs,
			}];
		});
	const artifacts = state.artifacts
		.filter((artifact) => commandMatches(query, [artifact.title, artifact.displayName ?? "", artifact.name, artifact.path, artifact.category, artifact.extension]))
		.sort((left, right) => right.updatedAtMs - left.updatedAtMs || left.name.localeCompare(right.name))
		.slice(0, 8)
		.flatMap((artifact): CommandPaletteItem[] => {
			const project = projectForArtifact(state, artifact);
			if (!project) return [];
			const run = runForArtifact(state, project, artifact);
			return [{
				id: `artifact:${artifact.path}`,
				artifact,
				kind: "artifact",
				label: artifact.name,
				project,
				run,
				sublabel: `${project.name} / ${artifact.displayName || artifact.title} / ${artifact.category} / ${formatBytes(artifact.sizeBytes)}`,
				updatedAtMs: artifact.updatedAtMs,
			}];
		});
	const newProject: CommandPaletteItem[] = commandMatches(query, ["new project", "create project", "start project"])
		? [{
			id: "new-project",
			kind: "new-project",
			label: "New project",
			sublabel: "Create a Feynman science project",
			updatedAtMs: Number.MAX_SAFE_INTEGER,
		}]
		: [];
	return [
		{ label: "Projects", items: projects },
		{ label: "Sessions", items: sessions },
		{ label: "Artifacts", items: artifacts },
		{ label: "Create", items: newProject },
	].filter((group) => group.items.length);
}

function commandPaletteFlatItems(groups: CommandPaletteGroup[]): CommandPaletteItem[] {
	return groups.flatMap((group) => group.items);
}

function fileHostsForState(state: WorkbenchState | null): FileHostOption[] {
	const local: FileHostOption = {
		id: "local",
		name: "Local",
		kind: "local",
		detail: state?.workspaceName ?? "Workspace files",
		reachable: true,
	};
	if (!state) return [local];
	const computeHosts = state.compute
		.filter((provider) => provider.family === "ssh" || provider.family === "byoc")
		.map((provider) => ({
			id: provider.name,
			name: provider.name.replace(/^ssh:/, ""),
			kind: provider.family === "ssh" ? "ssh" as const : "byoc" as const,
			detail: provider.detail || provider.description,
			reachable: provider.enabled,
			errorSummary: provider.diagnostics?.[0],
		}));
	const cloudHosts = state.cloudCredentials
		.filter((credential) => credential.defaultBucket)
		.map((credential) => ({
			id: `cloud:${credential.id}:${credential.defaultBucket}`,
			name: credential.defaultBucket ?? credential.name,
			kind: "cloud" as const,
			detail: credential.name,
			reachable: credential.status === "configured",
			errorSummary: credential.status === "missing" ? `${credential.envVar} is missing` : undefined,
		}));
	return [local, ...computeHosts, ...cloudHosts];
}

function App() {
	const [data, setData] = useState<WorkbenchState | null>(null);
	const [mode, setMode] = useState<AppMode>("workbench");
	const [route, setRoute] = useState<WorkbenchViewRoute | null>(null);
	const [session, setSession] = useState<WorkbenchChatSession | null>(null);
	const [selectedArtifactPath, setSelectedArtifactPath] = useState<string | null>(null);
	const [filePreview, setFilePreview] = useState<FilePreview | null>(null);
	const [artifactTab, setArtifactTab] = useState<"preview" | "provenance">("preview");
	const [artifactEdit, setArtifactEdit] = useState<ArtifactEditState | null>(null);
	const [artifactRefinement, setArtifactRefinement] = useState<ArtifactRefinementState | null>(null);
	const [annotationBusyId, setAnnotationBusyId] = useState<string | null>(null);
	const [transcriptAnnotationBusyId, setTranscriptAnnotationBusyId] = useState<string | null>(null);
	const [mediaAnnotationModePath, setMediaAnnotationModePath] = useState<string | null>(null);
	const [mediaAnnotationDraft, setMediaAnnotationDraft] = useState<MediaAnnotationDraft | null>(null);
	const [artifactActionBusyKey, setArtifactActionBusyKey] = useState<string | null>(null);
	const [artifactActionStatus, setArtifactActionStatus] = useState("");
	const [cloudStorageOpen, setCloudStorageOpen] = useState(false);
	const [cloudExportDraft, setCloudExportDraft] = useState<CloudExportDraft | null>(null);
	const [noteModalArtifactPath, setNoteModalArtifactPath] = useState<string | null>(null);
	const [notePreviewId, setNotePreviewId] = useState<string | null>(null);
	const [versionDiffs, setVersionDiffs] = useState<Record<string, VersionDiffState>>({});
	const [versionStatuses, setVersionStatuses] = useState<Record<string, string>>({});
	const [fileScope, setFileScope] = useState<FileBrowserScope>("run");
	const [fileCategory, setFileCategory] = useState<FileCategoryFilter>("all");
	const [fileHostId, setFileHostId] = useState("local");
	const [centerPane, setCenterPane] = useState<CenterPane>("chat");
	const [sidePanel, setSidePanel] = useState<SidePanel>(() => defaultSidePanel());
	const [filesOverlayOpen, setFilesOverlayOpen] = useState(false);
	const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null);
	const [uploading, setUploading] = useState(false);
	const [notebookLanguage, setNotebookLanguage] = useState<NotebookLanguage>("python");
	const [notebookExecutionMode, setNotebookExecutionMode] = useState<NotebookExecutionMode>("session");
	const [notebookPurpose, setNotebookPurpose] = useState<NotebookPurpose>("exploration");
	const [notebookCode, setNotebookCode] = useState(defaultNotebookCode("python"));
	const [notebookRunning, setNotebookRunning] = useState(false);
	const [notebookJobId, setNotebookJobId] = useState<string | null>(null);
	const [notebookResult, setNotebookResult] = useState<NotebookExecutionResult | null>(null);
	const [computeBusyJobId, setComputeBusyJobId] = useState<string | null>(null);
	const [computeBusyProviderId, setComputeBusyProviderId] = useState<string | null>(null);
	const [environmentLanguage, setEnvironmentLanguage] = useState<NotebookEnvironmentLanguage>("python");
	const [environmentMode, setEnvironmentMode] = useState<NotebookEnvironmentMode>("create");
	const [environmentPackages, setEnvironmentPackages] = useState("");
	const [environmentBusy, setEnvironmentBusy] = useState(false);
	const [environmentResult, setEnvironmentResult] = useState<NotebookEnvironmentActionResult | null>(null);
	const [onboardingStep, setOnboardingStep] = useState(0);
	const [onboardingDraft, setOnboardingDraft] = useState<OnboardingDraft>(emptyOnboardingDraft);
	const [onboardingFiles, setOnboardingFiles] = useState<File[]>([]);
	const [query, setQuery] = useState("");
	const [message, setMessage] = useState("");
	const [composerCursor, setComposerCursor] = useState(0);
	const [composerActiveIndex, setComposerActiveIndex] = useState(0);
	const [composerMenuOpen, setComposerMenuOpen] = useState(false);
	const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
	const [modelMenuOpen, setModelMenuOpen] = useState(false);
	const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState("Loading workspace");
	const [error, setError] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const onboardingFileInputRef = useRef<HTMLInputElement>(null);
	const composerTextareaRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		const onPopState = () => {
			const parsed = parseRoute();
			const linkedArtifact = parseArtifactParam();
			const validLinkedArtifact = linkedArtifact && data?.artifacts.some((artifact) => artifact.path === linkedArtifact)
				? linkedArtifact
				: null;
			const nextRoute = data && parsed ? resolveWorkbenchRoute(data, parsed) : parsed;
			const nextRun = data && nextRoute ? data.runs.find((item) => item.slug === nextRoute.runSlug) : undefined;
			const defaultArtifactPath = data ? defaultArtifactPathForRun(data, nextRun) : null;
			const nextArtifactPath = validLinkedArtifact ?? defaultArtifactPath;
			setRoute(nextRoute);
			setSelectedArtifactPath(nextArtifactPath);
			setSidePanel((current) => validLinkedArtifact ? "files" : current === "files" ? null : current);
			if (parsed && nextRoute && (!workbenchRoutesEqual(parsed, nextRoute) || Boolean(linkedArtifact && !validLinkedArtifact))) {
				window.history.replaceState(null, "", projectPath(nextRoute.projectId, nextRoute.runSlug, validLinkedArtifact));
			}
			setMode(parsed ? "workbench" : data?.onboarding.completed ? "launcher" : "onboarding");
		};
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, [data]);

	useEffect(() => {
		const onKeyDown = (event: globalThis.KeyboardEvent) => {
			if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
			event.preventDefault();
			setCommandPaletteOpen((open) => !open);
			setComposerMenuOpen(false);
			setSessionMenuOpen(false);
			setModelMenuOpen(false);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	useEffect(() => {
		let cancelled = false;
		async function load() {
			try {
				const state = await fetchJson<WorkbenchState>("/api/state");
				if (cancelled) return;
				const parsed = parseRoute();
				const nextRoute = resolveWorkbenchRoute(state, parsed);
				const linkedArtifact = parseArtifactParam();
				const validLinkedArtifact = linkedArtifact && state.artifacts.some((artifact) => artifact.path === linkedArtifact)
					? linkedArtifact
					: null;
				const nextRun = state.runs.find((item) => item.slug === nextRoute.runSlug);
				const defaultArtifactPath = defaultArtifactPathForRun(state, nextRun);
				const nextArtifactPath = validLinkedArtifact ?? defaultArtifactPath;
				setData(state);
				setRoute(nextRoute);
				setSelectedArtifactPath(nextArtifactPath);
				setSidePanel((current) => validLinkedArtifact ? "files" : current === "files" ? null : current);
				if (parsed && (!workbenchRoutesEqual(parsed, nextRoute) || Boolean(linkedArtifact && !validLinkedArtifact))) {
					window.history.replaceState(null, "", projectPath(nextRoute.projectId, nextRoute.runSlug, validLinkedArtifact));
				}
				setStatus("Workspace ready");
				if (parsed) setMode("workbench");
				else setMode(state.onboarding.completed ? "launcher" : "onboarding");
			} catch (loadError) {
				setError(loadError instanceof Error ? loadError.message : String(loadError));
			}
		}
		void load();
		return () => {
			cancelled = true;
		};
	}, []);

	const project = useMemo(() => {
		if (!data || !route) return undefined;
		return data.projects.find((item) => item.id === route.projectId) ?? data.projects[0];
	}, [data, route]);

	const run = useMemo(() => {
		if (!data || !route) return undefined;
		return data.runs.find((item) => item.slug === route.runSlug) ?? data.runs.find((item) => item.projectId === project?.id) ?? data.runs[0];
	}, [data, project?.id, route]);

	const runArtifacts = useMemo(() => data ? artifactsForFileScope(data, project, run, "run") : [], [data, project, run]);
	const selectedArtifact = useMemo(() => {
		if (!data || !selectedArtifactPath) return null;
		return data.artifacts.find((artifact) => artifact.path === selectedArtifactPath) ?? null;
	}, [data, selectedArtifactPath]);
	const noteModalArtifact = useMemo(() => {
		if (!data || !noteModalArtifactPath) return null;
		return data.artifacts.find((artifact) => artifact.path === noteModalArtifactPath) ?? null;
	}, [data, noteModalArtifactPath]);
	const selectedArtifactKind = selectedArtifact ? artifactPreviewKind(selectedArtifact) : null;
	const selectedPlan = useMemo(() => {
		if (!data || !selectedArtifactPath) return null;
		return data.plans.find((plan) => plan.artifactPath === selectedArtifactPath) ?? null;
	}, [data, selectedArtifactPath]);
	const scienceArtifactPanelOpen = sidePanel === "files"
		&& (selectedArtifactKind === "genome" || selectedArtifactKind === "html" || selectedArtifactKind === "json" || selectedArtifactKind === "molecule" || selectedArtifactKind === "structure" || selectedArtifactKind === "tensor" || selectedArtifactKind === "tree");
	const modelMenuSpecs = useMemo(() => {
		const specs = [
			data?.modelStatus?.recommended,
			...(data?.modelStatus?.availableModels ?? []),
		].filter((spec): spec is string => Boolean(spec));
		return Array.from(new Set(specs)).slice(0, 4);
	}, [data?.modelStatus]);
	const fileScopeArtifacts = useMemo(() => {
		if (!data) return [];
		return artifactsForFileScope(data, project, run, fileScope);
	}, [data, fileScope, project, run]);
	const fileCategoryCounts = useMemo(() => artifactCategoryCounts(fileScopeArtifacts), [fileScopeArtifacts]);
	const fileScopeCountItems = useMemo(() => data ? fileScopeCounts(data, project, run) : [], [data, project, run]);
	const filteredArtifacts = useMemo(() => {
		return filterArtifactsForBrowser(fileScopeArtifacts, query, fileCategory);
	}, [fileCategory, fileScopeArtifacts, query]);
	const uploads = session?.attachments ?? [];
	const filteredUploads = useMemo(() => filterUploadsForBrowser(uploads, query), [query, uploads]);
	const selectedUpload = useMemo(() => {
		if (!selectedUploadId) return null;
		return uploads.find((upload) => upload.id === selectedUploadId) ?? null;
	}, [selectedUploadId, uploads]);
	const runNotebookCells = useMemo(() => notebookCellsForRun(data?.notebook ?? [], run), [data?.notebook, run]);
	const runComputeJobs = useMemo(() => computeJobsForRun(data?.computeJobs ?? [], run), [data?.computeJobs, run]);
	const runKernels = useMemo(() => kernelsForRun(data?.kernels ?? [], run), [data?.kernels, run]);
	const environmentGroups = useMemo(() => environmentsByLanguage(data?.environments ?? []), [data?.environments]);
	const cloudExportTargets = data?.cloudExportTargets ?? [];
	const cloudExportTarget = useMemo(() => configuredCloudExportTarget(cloudExportTargets), [cloudExportTargets]);
	const fileHosts = useMemo(() => fileHostsForState(data), [data]);
	const notePreviewNote = useMemo(() => data?.notes.find((note) => note.id === notePreviewId) ?? null, [data?.notes, notePreviewId]);
	const notePreviewArtifact = useMemo(() => {
		if (!data || !notePreviewNote?.targetArtifactPath) return null;
		return data.artifacts.find((artifact) => artifact.path === notePreviewNote.targetArtifactPath) ?? null;
	}, [data, notePreviewNote]);
	const composerTrigger = useMemo(() => activeComposerTrigger(message, composerCursor), [composerCursor, message]);
	const composerItems = useMemo(() => {
		if (!data || !composerTrigger) return [];
		return composerSuggestions(data, project, run, composerTrigger);
	}, [composerTrigger, data, project, run]);
	const composerPickerOpen = Boolean(composerTrigger && composerItems.length);

	const projectRuns = useMemo(() => {
		if (!data || !project) return [];
		const runSlugs = new Set(project.runSlugs);
		return data.runs
			.filter((item) => runSlugs.has(item.slug) || item.projectId === project.id)
			.sort((left, right) => right.updatedAtMs - left.updatedAtMs);
	}, [data, project]);

	const visibleRuns = useMemo(() => {
		if (!run) return projectRuns.slice(0, maxVisibleRuns);
		const selected = projectRuns.find((item) => item.slug === run.slug);
		const rest = projectRuns.filter((item) => item.slug !== run.slug);
		return [...(selected ? [selected] : []), ...rest].slice(0, maxVisibleRuns);
	}, [projectRuns, run]);

	useEffect(() => {
		setComposerActiveIndex(0);
	}, [composerTrigger?.kind, composerTrigger?.query, composerItems.length]);

	useEffect(() => {
		if (!fileHosts.some((host) => host.id === fileHostId)) setFileHostId("local");
	}, [fileHostId, fileHosts]);

	useEffect(() => {
		if (mode !== "workbench") return;
		if (!project || !run) return;
		let cancelled = false;
		async function loadSession() {
			try {
				setStatus("Opening chat");
				const payload = await fetchJson<{ session: WorkbenchChatSession }>("/api/chat/session", {
					method: "POST",
					body: JSON.stringify({
						sessionId: run!.slug,
						projectId: project!.id,
						title: run!.title || project!.name,
					}),
				});
				if (!cancelled) {
					setSession(payload.session);
					setStatus("Chat ready");
				}
			} catch (loadError) {
				if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
			}
		}
		void loadSession();
		return () => {
			cancelled = true;
		};
	}, [mode, project, run]);

	useEffect(() => {
		if (!notebookRunning) return;
		let cancelled = false;
		const refresh = async () => {
			try {
				const state = await fetchJson<WorkbenchState>("/api/state");
				if (!cancelled) setData(state);
			} catch {
				// The foreground notebook request remains the source of user-visible failure.
			}
		};
		const interval = window.setInterval(() => void refresh(), 900);
		void refresh();
		return () => {
			cancelled = true;
			window.clearInterval(interval);
		};
	}, [notebookRunning]);

	useEffect(() => {
		if (fileCategory === "all") return;
		if (!fileCategoryCounts.some((item) => item.category === fileCategory)) setFileCategory("all");
	}, [fileCategory, fileCategoryCounts]);

	useEffect(() => {
		if (selectedUploadId && !uploads.some((upload) => upload.id === selectedUploadId)) setSelectedUploadId(null);
	}, [selectedUploadId, uploads]);

	useEffect(() => {
		if (!selectedArtifactPath) {
			setFilePreview(null);
			setArtifactRefinement(null);
			setMediaAnnotationModePath(null);
			setMediaAnnotationDraft(null);
			return;
		}
		const artifactPath = selectedArtifactPath;
		let cancelled = false;
		const kind = selectedArtifact ? artifactPreviewKind(selectedArtifact) : null;
		if (!artifactUsesTextPreview(kind)) {
			setFilePreview(null);
			setArtifactEdit((current) => current && current.path !== artifactPath ? null : current);
			setArtifactRefinement((current) => current && current.artifactPath !== artifactPath ? null : current);
			setMediaAnnotationModePath((current) => current === artifactPath ? current : null);
			setMediaAnnotationDraft((current) => current?.artifactPath === artifactPath ? current : null);
			return;
		}
		async function loadFile() {
			const preview = await loadFilePreview(artifactPath);
			if (!cancelled) setFilePreview(preview);
		}
		setArtifactEdit((current) => current && current.path !== artifactPath ? null : current);
		setArtifactRefinement((current) => current && current.artifactPath !== artifactPath ? null : current);
		setMediaAnnotationModePath((current) => current === artifactPath ? current : null);
		setMediaAnnotationDraft((current) => current?.artifactPath === artifactPath ? current : null);
		void loadFile();
		return () => {
			cancelled = true;
		};
	}, [selectedArtifact, selectedArtifactPath]);

	function selectRun(nextRun: WorkbenchRun) {
		if (!project) return;
		const nextRoute = { projectId: project.id, runSlug: nextRun.slug };
		const defaultArtifactPath = data ? defaultArtifactPathForRun(data, nextRun) : null;
		setRoute(nextRoute);
		setMode("workbench");
		setSelectedArtifactPath(defaultArtifactPath);
		setSelectedUploadId(null);
		setFilePreview(null);
		setArtifactTab("preview");
		setArtifactEdit(null);
		setArtifactRefinement(null);
		setMediaAnnotationModePath(null);
		setMediaAnnotationDraft(null);
		setVersionDiffs({});
		setVersionStatuses({});
		setCenterPane("chat");
		setSidePanel((current) => current === "files" ? null : current);
		window.history.pushState(null, "", projectPath(nextRoute.projectId, nextRoute.runSlug));
	}

	function openProjectRun(nextProject: WorkbenchProject, nextRun?: WorkbenchRun, artifactPath?: string) {
		const runSlug = nextRun?.slug ?? nextProject.primaryRunSlug ?? nextProject.runSlugs[0] ?? "workspace";
		const nextRoute = { projectId: nextProject.id, runSlug };
		const resolvedRun = nextRun ?? data?.runs.find((item) => item.slug === runSlug);
		const defaultArtifactPath = data ? defaultArtifactPathForRun(data, resolvedRun) : null;
		const selectedPath = artifactPath ?? defaultArtifactPath;
		setRoute(nextRoute);
		setMode("workbench");
		setSelectedArtifactPath(selectedPath);
		setSelectedUploadId(null);
		setFilePreview(null);
		setArtifactEdit(null);
		setArtifactRefinement(null);
		setMediaAnnotationModePath(null);
		setMediaAnnotationDraft(null);
		setArtifactTab("preview");
		setVersionDiffs({});
		setVersionStatuses({});
		setFilesOverlayOpen(false);
		setCenterPane("chat");
		setSidePanel((current) => artifactPath ? "files" : current === "files" ? null : current);
		window.history.pushState(null, "", projectPath(nextRoute.projectId, nextRoute.runSlug, artifactPath));
	}

	function startNewProjectFromPalette() {
		setCommandPaletteOpen(false);
		setOnboardingDraft(emptyOnboardingDraft);
		setOnboardingStep(0);
		setArtifactRefinement(null);
		setMediaAnnotationModePath(null);
		setMediaAnnotationDraft(null);
		setMode("onboarding");
		window.history.pushState(null, "", launcherPath());
	}

	function openCommandPaletteItem(item: CommandPaletteItem) {
		setCommandPaletteOpen(false);
		if (item.kind === "new-project") {
			startNewProjectFromPalette();
			return;
		}
		if (item.kind === "artifact") {
			openProjectRun(item.project, item.run, item.artifact.path);
			return;
		}
		openProjectRun(item.project, item.run);
	}

	function openLauncher() {
		setMode(data?.onboarding.completed ? "launcher" : "onboarding");
		setSidePanel(null);
		setFilesOverlayOpen(false);
		setArtifactRefinement(null);
		setMediaAnnotationModePath(null);
		setMediaAnnotationDraft(null);
		window.history.pushState(null, "", launcherPath());
	}

	async function uploadOnboardingFiles(files: File[], target: { sessionId: string; projectId: string; title: string }) {
		let nextSession: WorkbenchChatSession | null = null;
		for (const file of files) {
			const payload = await fetchJson<{ session: WorkbenchChatSession }>("/api/chat/attachment", {
				method: "POST",
				body: JSON.stringify({
					sessionId: target.sessionId,
					projectId: target.projectId,
					title: target.title,
					name: file.name,
					contentType: file.type || "application/octet-stream",
					contentBase64: arrayBufferToBase64(await file.arrayBuffer()),
				}),
			});
			nextSession = payload.session;
		}
		return nextSession;
	}

	async function completeOnboarding() {
		const tasks = deriveOnboardingTasks(onboardingDraft);
		const selectedTask = tasks[Math.min(onboardingDraft.selectedTaskIndex, tasks.length - 1)] ?? tasks[0];
		if (!selectedTask || busy) return;
		setBusy(true);
		setError(null);
		setStatus("Creating science project");
		try {
			const payload = await fetchJson<OnboardingCompletePayload>("/api/onboarding/complete", {
				method: "POST",
				body: JSON.stringify({
					field: onboardingDraft.field,
					goal: onboardingDraft.goal,
					workflow: onboardingDraft.workflow,
					dataTools: onboardingDraft.dataTools,
					bottlenecks: onboardingDraft.bottlenecks,
					notes: onboardingDraft.notes,
					permissions: onboardingDraft.permissions,
					selectedTask,
				}),
			});
			setData(payload.state);
			setSession(payload.session);
			if (onboardingFiles.length) {
				setStatus("Attaching onboarding files");
				const nextSession = await uploadOnboardingFiles(onboardingFiles, {
					sessionId: payload.session.id,
					projectId: payload.project.id,
					title: payload.session.title,
				});
				if (nextSession) setSession(nextSession);
			}
			const nextRoute = { projectId: payload.project.id, runSlug: payload.session.id };
			setRoute(nextRoute);
			setMode("workbench");
			setOnboardingFiles([]);
			setArtifactRefinement(null);
			setMediaAnnotationModePath(null);
			setMediaAnnotationDraft(null);
			setSidePanel("files");
			setStatus("Project ready");
			window.history.pushState(null, "", projectPath(nextRoute.projectId, nextRoute.runSlug));
		} catch (completeError) {
			setError(completeError instanceof Error ? completeError.message : String(completeError));
			setStatus("Onboarding failed");
		} finally {
			setBusy(false);
		}
	}

	async function openArtifactEditor(artifact: WorkbenchArtifact) {
		const disabledReason = artifactEditDisabledReason(artifact);
		if (disabledReason) {
			setStatus(disabledReason);
			return;
		}
		setArtifactTab("preview");
		setArtifactEdit({
			path: artifact.path,
			original: "",
			draft: "",
			status: "Loading full artifact text...",
			loading: true,
			saving: false,
		});
		try {
			const payload = await fetchJson<ArtifactEditReadPayload>(artifactEditReadPath(artifact.path));
			setArtifactEdit({
				path: payload.artifact.artifactPath,
				original: payload.artifact.content,
				draft: payload.artifact.content,
				status: "Ready",
				loading: false,
				saving: false,
			});
			setStatus("Artifact editor ready");
		} catch (editError) {
			setArtifactEdit((current) => current?.path === artifact.path ? {
				...current,
				status: editError instanceof Error ? editError.message : String(editError),
				loading: false,
			} : current);
		}
	}

	async function saveArtifactEditor() {
		if (!artifactEdit || artifactEdit.saving || artifactEdit.loading) return;
		if (artifactEdit.draft === artifactEdit.original) {
			setArtifactEdit({ ...artifactEdit, status: "No changes to save." });
			return;
		}
		setArtifactEdit({ ...artifactEdit, saving: true, status: "Saving artifact..." });
		try {
			const payload = await fetchJson<ArtifactEditSavePayload>("/api/artifact/edit", {
				method: "POST",
				body: JSON.stringify({
					artifactPath: artifactEdit.path,
					content: artifactEdit.draft,
				}),
			});
			setData(payload.state);
			setArtifactEdit(null);
			setVersionDiffs({});
			setVersionStatuses({});
			setSelectedArtifactPath(payload.edit.artifactPath);
			setFilePreview(await loadFilePreview(payload.edit.artifactPath));
			setStatus(payload.edit.changed ? "Artifact saved" : "No artifact changes");
		} catch (saveError) {
			setArtifactEdit((current) => current ? {
				...current,
				saving: false,
				status: saveError instanceof Error ? saveError.message : String(saveError),
			} : current);
		}
	}

	async function saveMoleculeArtifact(artifact: WorkbenchArtifact, content: string) {
		setStatus("Saving molecule artifact...");
		try {
			const payload = await fetchJson<ArtifactEditSavePayload>("/api/artifact/edit", {
				method: "POST",
				body: JSON.stringify({
					artifactPath: artifact.path,
					content,
				}),
			});
			setData(payload.state);
			setArtifactEdit(null);
			setVersionDiffs({});
			setVersionStatuses({});
			setSelectedArtifactPath(payload.edit.artifactPath);
			setFilePreview(await loadFilePreview(payload.edit.artifactPath));
			setStatus(payload.edit.changed ? "Molecule artifact saved" : "No molecule changes");
		} catch (saveError) {
			setStatus(saveError instanceof Error ? saveError.message : String(saveError));
			throw saveError;
		}
	}

	function startArtifactRefinement(selection: ArtifactAnchorSelection) {
		if (!selectedArtifactPath) return;
		setArtifactTab("preview");
		setArtifactEdit(null);
		setMediaAnnotationModePath(null);
		setMediaAnnotationDraft(null);
		setArtifactRefinement({
			artifactPath: selectedArtifactPath,
			instruction: "",
			phase: "input",
			selection,
			status: "Selection ready",
			suggestion: "",
			suggestionDraft: "",
			suggestionMode: "edit",
		});
		setStatus("Artifact selection ready");
	}

	async function saveArtifactRefinementAnnotation() {
		if (!artifactRefinement) return;
		const bodyText = artifactRefinement.instruction.trim();
		if (!bodyText) {
			setArtifactRefinement({ ...artifactRefinement, status: "Add a note first." });
			return;
		}
		const body = chatRequestBody(refinementAnnotationBody({
			artifactPath: artifactRefinement.artifactPath,
			body: bodyText,
			projectId: project?.id,
			runSlug: run?.slug,
			selection: artifactRefinement.selection,
			sessionId: session?.id ?? run?.slug,
		}));
		if (!body) return;
		setArtifactRefinement({ ...artifactRefinement, phase: "loading", status: "Saving note..." });
		try {
			const payload = await fetchJson<{ annotations: WorkbenchArtifactAnnotation[]; state: WorkbenchState }>("/api/artifact/annotation", {
				method: "POST",
				body: JSON.stringify(body),
			});
			setData(payload.state);
			setArtifactRefinement((current) => current?.artifactPath === artifactRefinement.artifactPath
				? { ...current, phase: "input", status: "Annotation saved" }
				: current);
			setMediaAnnotationModePath(null);
			setMediaAnnotationDraft(null);
			setStatus("Annotation saved");
		} catch (annotationError) {
			setArtifactRefinement((current) => current?.artifactPath === artifactRefinement.artifactPath
				? {
					...current,
					phase: "input",
					status: annotationError instanceof Error ? annotationError.message : String(annotationError),
				}
				: current);
		}
	}

	async function requestArtifactRefinementSuggestion(mode: ArtifactRefinementMode) {
		if (!artifactRefinement || !project || !run) return;
		if (!canSuggestArtifactRefinement(artifactRefinement.selection)) {
			setArtifactRefinement({ ...artifactRefinement, status: "Region selections can be saved and used in chat; text refinement applies only to selectable text." });
			return;
		}
		const instruction = artifactRefinement.instruction.trim();
		if (!instruction) {
			setArtifactRefinement({ ...artifactRefinement, status: "Add an instruction first." });
			return;
		}
		const artifactTitle = selectedArtifact?.title || selectedArtifact?.name || run.title || project.name;
		const body = chatRequestBody(refinementSuggestBody({
			artifactPath: artifactRefinement.artifactPath,
			currentIteration: artifactRefinement.suggestionDraft || artifactRefinement.suggestion || undefined,
			instruction,
			mode,
			projectId: project.id,
			selection: artifactRefinement.selection,
			sessionId: session?.id ?? run.slug,
			title: artifactTitle,
		}));
		if (!body) return;
		setArtifactRefinement({
			...artifactRefinement,
			phase: "loading",
			status: mode === "edit" ? "Drafting edit..." : "Asking about selection...",
			suggestionMode: mode,
		});
		try {
			const payload = await fetchJson<{ suggestion: ArtifactRefinementSuggestion }>("/api/artifact/refinement/suggest", {
				method: "POST",
				body: JSON.stringify(body),
			});
			setArtifactRefinement((current) => current?.artifactPath === payload.suggestion.artifactPath
				? {
					...current,
					phase: "suggestion",
					source: payload.suggestion.source,
					status: payload.suggestion.source === "model" ? "Suggestion ready" : "Fallback suggestion ready",
					suggestion: payload.suggestion.suggestion,
					suggestionDraft: payload.suggestion.suggestion,
					suggestionMode: payload.suggestion.mode,
				}
				: current);
			setStatus(mode === "edit" ? "Edit suggestion ready" : "Answer ready");
		} catch (suggestionError) {
			setArtifactRefinement((current) => current?.artifactPath === artifactRefinement.artifactPath
				? {
					...current,
					phase: "input",
					status: suggestionError instanceof Error ? suggestionError.message : String(suggestionError),
				}
				: current);
		}
	}

	async function applyArtifactRefinementSuggestion() {
		if (!artifactRefinement || artifactRefinement.phase !== "suggestion") return;
		if (!canSuggestArtifactRefinement(artifactRefinement.selection)) return;
		const replacementText = artifactRefinement.suggestionDraft.trim();
		if (!replacementText) {
			setArtifactRefinement({ ...artifactRefinement, status: "Replacement text required." });
			return;
		}
		setArtifactRefinement({ ...artifactRefinement, phase: "applying", status: "Applying edit..." });
		try {
			const payload = await fetchJson<{ edit: { artifactPath: string; changed: boolean }; state: WorkbenchState }>("/api/artifact/refinement/apply", {
				method: "POST",
				body: JSON.stringify(refinementApplyBody({
					artifactPath: artifactRefinement.artifactPath,
					replacementText,
					selection: artifactRefinement.selection,
				})),
			});
			setData(payload.state);
			setArtifactEdit(null);
			setVersionDiffs({});
			setVersionStatuses({});
			setSelectedArtifactPath(payload.edit.artifactPath);
			setFilePreview(await loadFilePreview(payload.edit.artifactPath));
			setArtifactRefinement((current) => current?.artifactPath === payload.edit.artifactPath
				? {
					...current,
					phase: "applied",
					status: payload.edit.changed ? "Edit applied" : "No matching text changed",
					suggestionDraft: replacementText,
				}
				: current);
			setStatus(payload.edit.changed ? "Artifact refinement applied" : "No artifact changes");
		} catch (applyError) {
			setArtifactRefinement((current) => current?.artifactPath === artifactRefinement.artifactPath
				? {
					...current,
					phase: "suggestion",
					status: applyError instanceof Error ? applyError.message : String(applyError),
				}
				: current);
		}
	}

	async function removeArtifactAnnotation(annotationId: string) {
		setAnnotationBusyId(annotationId);
		try {
			const payload = await fetchJson<{ annotations: WorkbenchArtifactAnnotation[]; state: WorkbenchState }>("/api/artifact/annotation", {
				method: "POST",
				body: JSON.stringify({ action: "remove", id: annotationId }),
			});
			setData(payload.state);
			setStatus("Annotation removed");
		} catch (annotationError) {
			setError(annotationError instanceof Error ? annotationError.message : String(annotationError));
			setStatus("Annotation remove failed");
		} finally {
			setAnnotationBusyId(null);
		}
	}

	function useArtifactAnnotationInChat(annotation: WorkbenchArtifactAnnotation) {
		const targetPath = annotation.artifactPath || selectedArtifactPath || "the selected artifact";
		const summary = annotationAnchorSummary(annotation);
		insertComposerText([
			`Revise ${targetPath}.`,
			"Use this artifact annotation as the edit contract:",
			`- #${annotation.labelIndex} ${annotation.kind}${summary ? ` target: ${summary}` : ""}${annotation.anchorText ? ` / anchor: ${annotation.anchorText}` : ""} / ${annotation.body}`,
			"Preserve provenance. Write the revised artifact under outputs/, papers/, or notes/ and explain what changed.",
		].join("\n"));
		setStatus("Annotation inserted into chat");
	}

	async function saveTranscriptAnnotation(chatMessage: WorkbenchChatMessage, messageIndex: number) {
		if (!project || !run) return;
		const rootFrameId = session?.id ?? run.slug;
		setTranscriptAnnotationBusyId(chatMessage.id);
		try {
			const payload = await fetchJson<{ annotations: WorkbenchTranscriptAnnotation[]; state: WorkbenchState }>("/api/transcript/annotation", {
				method: "POST",
				body: JSON.stringify({
					rootFrameId,
					messageUuid: chatMessage.id,
					messageIndex,
					blockIndex: 0,
					source: chatMessage.role === "user" ? "user" : "assistant",
					anchorText: selectedTranscriptAnchor(chatMessage.id, chatMessage.content),
					kind: "bookmark",
					note: "Bookmarked for follow-up in this research thread.",
					origin: "user",
					projectId: project.id,
					runSlug: run.slug,
				}),
			});
			setData(payload.state);
			setStatus("Transcript bookmark saved");
		} catch (annotationError) {
			setError(annotationError instanceof Error ? annotationError.message : String(annotationError));
			setStatus("Transcript bookmark failed");
		} finally {
			setTranscriptAnnotationBusyId(null);
		}
	}

	async function removeTranscriptAnnotation(annotationId: string) {
		setTranscriptAnnotationBusyId(annotationId);
		try {
			const payload = await fetchJson<{ annotations: WorkbenchTranscriptAnnotation[]; state: WorkbenchState }>("/api/transcript/annotation", {
				method: "POST",
				body: JSON.stringify({ action: "remove", id: annotationId }),
			});
			setData(payload.state);
			setStatus("Transcript bookmark removed");
		} catch (annotationError) {
			setError(annotationError instanceof Error ? annotationError.message : String(annotationError));
			setStatus("Transcript bookmark remove failed");
		} finally {
			setTranscriptAnnotationBusyId(null);
		}
	}

	function useTranscriptAnnotationInChat(annotation: WorkbenchTranscriptAnnotation) {
		insertComposerText([
			"Use this transcript bookmark as context:",
			`- Message ${annotation.messageIndex + 1} (${annotation.source}): ${annotation.anchorText}`,
			annotation.note ? `- Note: ${annotation.note}` : "",
			"Continue the research from this point and tie the answer back to sources, artifacts, or verification checks.",
		].filter(Boolean).join("\n"));
		setStatus("Transcript bookmark inserted into chat");
	}

	function nextArtifactPathAfterRemoval(nextState: WorkbenchState, artifactPath: string): string | null {
		return nextState.artifacts.find((artifact) => artifact.slug === run?.slug && artifact.path !== artifactPath)?.path
			?? nextState.artifacts.find((artifact) => artifact.path !== artifactPath)?.path
			?? null;
	}

	async function mutateArtifactAction(
		artifactPath: string,
		action: ArtifactMutationAction,
		options: { displayName?: string; focusRestored?: boolean } = {},
	) {
		const busyKey = `${artifactPath}:${action}`;
		setArtifactActionBusyKey(busyKey);
		setArtifactActionStatus(action === "rename" ? "Renaming artifact" : action === "delete" ? "Moving artifact to trash" : "Updating artifact");
		try {
			const payload = await fetchJson<ArtifactActionPayload>("/api/artifact/action", {
				method: "POST",
				body: JSON.stringify(artifactMutationBody(artifactPath, action, options.displayName)),
			});
			const stillVisible = payload.state.artifacts.some((artifact) => artifact.path === artifactPath);
			setData(payload.state);
			setVersionDiffs({});
			setVersionStatuses({});
			if (stillVisible || options.focusRestored) {
				setSelectedArtifactPath(artifactPath);
			} else if (selectedArtifactPath === artifactPath) {
				setSelectedArtifactPath(nextArtifactPathAfterRemoval(payload.state, artifactPath));
				setFilePreview(null);
				setArtifactEdit(null);
				setArtifactRefinement(null);
				setMediaAnnotationModePath(null);
				setMediaAnnotationDraft(null);
			}
			setArtifactActionStatus(action === "delete"
				? "Artifact moved to workbench trash"
				: action === "hide"
					? "Artifact hidden"
					: action === "restore"
						? "Artifact restored"
						: action === "unhide"
							? "Artifact unhidden"
							: action === "star" || action === "unstar"
								? "Artifact pin updated"
								: "Artifact renamed");
		} catch (actionError) {
			setError(actionError instanceof Error ? actionError.message : String(actionError));
			setArtifactActionStatus("Artifact action failed");
		} finally {
			setArtifactActionBusyKey(null);
		}
	}

	function handleArtifactAction(artifact: WorkbenchArtifact, action: ArtifactMutationAction) {
		let displayName: string | undefined;
		if (action === "rename") {
			const nextName = window.prompt("Artifact display name", artifact.displayName || artifact.title || artifact.name);
			if (!nextName?.trim()) return;
			displayName = nextName;
		}
		if (action === "delete" && !window.confirm(`Move ${artifact.name} to workbench trash?`)) return;
		void mutateArtifactAction(artifact.path, action, { displayName });
	}

	function recoverArtifactAction(item: WorkbenchArtifactActionItem) {
		void mutateArtifactAction(item.artifactPath, artifactRecoveryAction(item), { focusRestored: true });
	}

	function copyArtifactReference(artifact: WorkbenchArtifact) {
		if (!project) return;
		void copyText(artifactReferenceUrl(artifact, project.id, window.location.origin, window.location.pathname));
		setArtifactActionStatus("Artifact link copied");
	}

	function exportArtifactMetadata(artifact: WorkbenchArtifact) {
		if (!data || !project) return;
		const link = artifactReferenceUrl(artifact, project.id, window.location.origin, window.location.pathname);
		downloadJsonFile(
			artifactMetadataFilename(artifact),
			artifactMetadataPayload(artifact, data, filePreview?.path === artifact.path ? filePreview : null, link),
		);
		setArtifactActionStatus("Artifact metadata exported");
	}

	function openCloudExportModal(artifact: WorkbenchArtifact) {
		const defaultTarget = cloudExportTarget ?? cloudExportTargets[0] ?? null;
		setCloudExportDraft({
			artifactPath: artifact.path,
			credentialId: defaultTarget?.id ?? "",
			destinationPath: artifact.name,
		});
		setArtifactActionStatus(defaultTarget ? "Choose export target" : "Cloud export needs a configured target in Customize");
	}

	async function exportArtifactToCloud(artifact: WorkbenchArtifact, target: WorkbenchCloudExportTarget | null, destinationPath?: string) {
		if (!target || target.status !== "configured") {
			setArtifactActionStatus("Cloud export needs a configured target in Customize");
			return;
		}
		const busyKey = `${artifact.path}:export-cloud`;
		setArtifactActionBusyKey(busyKey);
		setArtifactActionStatus(`Exporting to ${target.name}`);
		try {
			const payload = await fetchJson<ArtifactCloudExportPayload>("/api/artifact/export-cloud", {
				method: "POST",
				body: JSON.stringify(cloudExportBody(artifact.path, target, destinationPath)),
			});
			setData(payload.state);
			setCloudExportDraft(null);
			setArtifactActionStatus(payload.export.status === "complete" ? "Artifact exported" : "Artifact export recorded");
		} catch (exportError) {
			setError(exportError instanceof Error ? exportError.message : String(exportError));
			setArtifactActionStatus("Cloud export failed");
		} finally {
			setArtifactActionBusyKey(null);
		}
	}

	async function removeCloudStorageCredential(settingsRecordId: string) {
		const payload = await fetchJson<{ state: WorkbenchState }>("/api/resources/settings", {
			method: "POST",
			body: JSON.stringify({ action: "remove", collection: "credentialRefs", id: settingsRecordId }),
		});
		setData(payload.state);
		setStatus("Cloud credential removed");
	}

	async function diffArtifactVersion(version: WorkbenchArtifactVersion) {
		const key = versionActionKey(version);
		setArtifactTab("provenance");
		setVersionDiffs((current) => ({ ...current, [key]: { loading: true } }));
		setVersionStatuses((current) => ({ ...current, [key]: "Diffing" }));
		try {
			const payload = await fetchJson<ArtifactVersionDiffPayload>("/api/artifact/version/diff", {
				method: "POST",
				body: JSON.stringify(artifactVersionActionBody(version)),
			});
			setVersionDiffs((current) => ({ ...current, [key]: { diff: payload.diff } }));
			setVersionStatuses((current) => ({ ...current, [key]: "Diff ready" }));
		} catch (diffError) {
			setVersionDiffs((current) => ({
				...current,
				[key]: { error: diffError instanceof Error ? diffError.message : String(diffError) },
			}));
			setVersionStatuses((current) => ({ ...current, [key]: "Diff failed" }));
		}
	}

	async function restoreArtifactVersion(version: WorkbenchArtifactVersion) {
		const key = versionActionKey(version);
		setArtifactTab("provenance");
		setVersionStatuses((current) => ({ ...current, [key]: "Restoring" }));
		try {
			const payload = await fetchJson<ArtifactVersionRestorePayload>("/api/artifact/version/restore", {
				method: "POST",
				body: JSON.stringify(artifactVersionActionBody(version)),
			});
			setData(payload.state);
			setArtifactEdit(null);
			setVersionDiffs({});
			setVersionStatuses({});
			setSelectedArtifactPath(payload.restore.artifactPath);
			setFilePreview(await loadFilePreview(payload.restore.artifactPath));
			setStatus("Artifact version restored");
		} catch (restoreError) {
			setVersionStatuses((current) => ({
				...current,
				[key]: restoreError instanceof Error ? restoreError.message : String(restoreError),
			}));
		}
	}

	function uploadDownloadUrl(upload: WorkbenchUpload): string {
		if (!project || !run) return "#";
		return attachmentDownloadUrl({
			sessionId: session?.id ?? run.slug,
			projectId: project.id,
			title: run.title || project.name,
			attachmentId: upload.id,
		});
	}

	function arrayBufferToBase64(buffer: ArrayBuffer): string {
		const bytes = new Uint8Array(buffer);
		const chunkSize = 0x8000;
		let binary = "";
		for (let index = 0; index < bytes.length; index += chunkSize) {
			binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
		}
		return btoa(binary);
	}

	async function uploadFiles(fileList: FileList | null) {
		const files = Array.from(fileList ?? []);
		if (!files.length || !project || !run) return;
		setUploading(true);
		setStatus("Importing files");
		setError(null);
		try {
			for (const file of files) {
				const payload = await fetchJson<{ session: WorkbenchChatSession }>("/api/chat/attachment", {
					method: "POST",
					body: JSON.stringify({
						...chatRequestBody(),
						name: file.name,
						contentType: file.type || "application/octet-stream",
						contentBase64: arrayBufferToBase64(await file.arrayBuffer()),
					}),
				});
				setSession(payload.session);
				setSelectedArtifactPath(null);
				setArtifactEdit(null);
				setArtifactRefinement(null);
				setMediaAnnotationModePath(null);
				setMediaAnnotationDraft(null);
				setSelectedUploadId(payload.session.attachments.at(-1)?.id ?? null);
			}
			setSidePanel("files");
			setFilesOverlayOpen(true);
			setStatus(`Imported ${files.length} ${files.length === 1 ? "file" : "files"}`);
		} catch (uploadError) {
			setError(uploadError instanceof Error ? uploadError.message : String(uploadError));
			setStatus("Import failed");
		} finally {
			setUploading(false);
			if (fileInputRef.current) fileInputRef.current.value = "";
		}
	}

	async function removeUpload(uploadId: string) {
		if (!project || !run) return;
		setStatus("Removing upload");
		try {
			const payload = await fetchJson<{ session: WorkbenchChatSession }>("/api/chat/attachment/delete", {
				method: "POST",
				body: JSON.stringify({
					...chatRequestBody(),
					attachmentId: uploadId,
				}),
			});
			setSession(payload.session);
			if (selectedUploadId === uploadId) setSelectedUploadId(null);
			setStatus("Upload removed");
		} catch (removeError) {
			setError(removeError instanceof Error ? removeError.message : String(removeError));
			setStatus("Remove failed");
		}
	}

	async function createSession() {
		if (!project) return;
		setBusy(true);
		try {
			const payload = await fetchJson<{ session: WorkbenchChatSession; state: WorkbenchState }>("/api/chat/session/new", {
				method: "POST",
				body: JSON.stringify({
					projectId: project.id,
					title: "New research session",
				}),
			});
			setData(payload.state);
			setSession(payload.session);
			const nextRoute = { projectId: payload.session.projectId, runSlug: payload.session.id };
			setRoute(nextRoute);
			setMode("workbench");
			window.history.pushState(null, "", projectPath(nextRoute.projectId, nextRoute.runSlug));
			setSidePanel(null);
			setSelectedArtifactPath(null);
			setSelectedUploadId(null);
			setFilePreview(null);
			setArtifactEdit(null);
			setArtifactRefinement(null);
			setMediaAnnotationModePath(null);
			setMediaAnnotationDraft(null);
		} catch (createError) {
			setError(createError instanceof Error ? createError.message : String(createError));
		} finally {
			setBusy(false);
		}
	}

	function chatRequestBody(extra: Record<string, unknown> = {}) {
		if (!project || !run) return undefined;
		return {
			sessionId: session?.id ?? run.slug,
			projectId: project.id,
			title: run.title || project.name,
			viewportContext: {
				activePath: selectedArtifactPath ?? undefined,
				openPaths: selectedArtifactPath ? [selectedArtifactPath] : [],
				rightTab: sidePanel ?? undefined,
			},
			...extra,
		};
	}

	function planMutationBody(plan: WorkbenchGeneratedPlan, extra: Record<string, unknown> = {}) {
		const planRun = data?.runs.find((item) => item.slug === plan.runSlug);
		const activeTitle = session?.id === plan.sessionId ? session.title : undefined;
		const artifactTitleBase = plan.title.replace(/\s+execution plan$/i, "").trim();
		return {
			sessionId: plan.sessionId,
			projectId: plan.projectId || planRun?.projectId || project?.id || "workspace",
			title: activeTitle || planRun?.title || artifactTitleBase || plan.title || "Research chat",
			...extra,
		};
	}

	async function updateSessionConfig(patch: Partial<WorkbenchChatSession["config"]>, nextStatus: string) {
		const body = chatRequestBody({ config: patch });
		if (!body) return;
		setSessionMenuOpen(false);
		setModelMenuOpen(false);
		setComposerMenuOpen(false);
		const payload = await fetchJson<{ session: WorkbenchChatSession }>("/api/chat/config", {
			method: "POST",
			body: JSON.stringify(body),
		});
		setSession(payload.session);
		setStatus(nextStatus);
	}

	function insertComposerText(text: string) {
		setMessage((current) => {
			const trimmed = current.trim();
			return trimmed ? `${trimmed}\n${text}` : text;
		});
		setStatus("Command inserted");
	}

	function openArtifactPath(artifactPath: string, nextStatus: string) {
		if (!project || !run) return;
		setSelectedArtifactPath(artifactPath);
		setSelectedUploadId(null);
		setArtifactTab("preview");
		setArtifactEdit(null);
		setArtifactRefinement(null);
		setMediaAnnotationModePath(null);
		setMediaAnnotationDraft(null);
		setCenterPane("files");
		setSidePanel("files");
		setFilesOverlayOpen(false);
		setStatus(nextStatus);
		window.history.pushState(null, "", projectPath(project.id, run.slug, artifactPath));
	}

	async function openWorkbenchPlan() {
		setComposerMenuOpen(false);
		if (!project || !run) return;
		const sessionId = session?.id ?? run.slug;
		const existingPlan = data?.plans.find((plan) =>
			plan.sessionId === sessionId || plan.runSlug === run.slug
		);
		if (existingPlan) {
			openArtifactPath(existingPlan.artifactPath, "Showing plan");
			return;
		}
		setStatus("Generating plan");
		try {
			const payload = await fetchJson<{ plan: { artifactPath: string }; session: WorkbenchChatSession; state: WorkbenchState }>("/api/chat/plan/generate", {
				method: "POST",
				body: JSON.stringify({
					...chatRequestBody(),
					runSlug: run.slug,
					taskSummary: run.taskSummary,
				}),
			});
			setData(payload.state);
			setSession(payload.session);
			openArtifactPath(payload.plan.artifactPath, "Plan ready");
		} catch (planError) {
			setError(planError instanceof Error ? planError.message : String(planError));
			setStatus("Plan failed");
		}
	}

	async function updateWorkbenchPlanActionFromPreview(plan: WorkbenchGeneratedPlan, action: WorkbenchPlanAction) {
		setStatus(action === "approve" ? "Approving plan" : action === "reject" ? "Rejecting plan" : "Reopening plan");
		try {
			const payload = await fetchJson<{ plan: WorkbenchGeneratedPlan; session: WorkbenchChatSession; state: WorkbenchState }>("/api/chat/plan/action", {
				method: "POST",
				body: JSON.stringify(planMutationBody(plan, { action })),
			});
			setData(payload.state);
			if (session?.id === payload.session.id || run?.slug === payload.session.id) setSession(payload.session);
			openArtifactPath(payload.plan.artifactPath, action === "approve" ? "Plan approved" : action === "reject" ? "Plan rejected" : "Plan reopened");
		} catch (planError) {
			setError(planError instanceof Error ? planError.message : String(planError));
			setStatus("Plan update failed");
		}
	}

	async function updateWorkbenchPlanStepFromPreview(plan: WorkbenchGeneratedPlan, stepTitle: string, status: WorkbenchPlanStepStatus) {
		setStatus(`Marking step ${status}`);
		try {
			const payload = await fetchJson<{ plan: WorkbenchGeneratedPlan; session: WorkbenchChatSession; state: WorkbenchState }>("/api/chat/plan/step", {
				method: "POST",
				body: JSON.stringify(planMutationBody(plan, { stepTitle, status })),
			});
			setData(payload.state);
			if (session?.id === payload.session.id || run?.slug === payload.session.id) setSession(payload.session);
			openArtifactPath(payload.plan.artifactPath, `Step marked ${status}`);
		} catch (planError) {
			setError(planError instanceof Error ? planError.message : String(planError));
			setStatus("Step update failed");
		}
	}

	async function requestReviewFromComposer() {
		setComposerMenuOpen(false);
		const body = chatRequestBody({ runSlug: run?.slug, artifactPath: selectedArtifactPath ?? undefined });
		if (!body) return;
		setStatus("Requesting review");
		try {
			const payload = await fetchJson<{ artifact: WorkbenchArtifact; session: WorkbenchChatSession; state: WorkbenchState }>("/api/chat/review/request", {
				method: "POST",
				body: JSON.stringify(body),
			});
			setData(payload.state);
			setSession(payload.session);
			openArtifactPath(payload.artifact.path, "Review requested");
		} catch (reviewError) {
			setError(reviewError instanceof Error ? reviewError.message : String(reviewError));
			setStatus("Review failed");
		}
	}

	function saveAsSkillFromComposer() {
		setComposerMenuOpen(false);
		insertComposerText("/skill:skill-creator");
	}

	async function useSpecialist(specialist: string) {
		await updateSessionConfig({ specialist }, `${formatSpecialistLabel(specialist)} specialist selected`);
	}

	async function updatePackageResource(action: Extract<ResourceAction, { kind: "package" }>) {
		const payload = await fetchJson<{ state: WorkbenchState }>("/api/resources/package", {
			method: "POST",
			body: JSON.stringify({ action: action.action, sources: action.sources }),
		});
		setData(payload.state);
		setStatus(action.action === "enable" ? "Package enabled" : "Package disabled");
	}

	async function removeSettingsResource(action: Extract<ResourceAction, { kind: "remove" }>) {
		const payload = await fetchJson<{ state: WorkbenchState }>("/api/resources/settings", {
			method: "POST",
			body: JSON.stringify({ action: "remove", collection: action.collection, id: action.id }),
		});
		setData(payload.state);
		setStatus("Resource removed");
	}

	async function upsertSettingsResource(action: Extract<ResourceAction, { kind: "settings" }>) {
		const payload = await fetchJson<{ state: WorkbenchState }>("/api/resources/settings", {
			method: "POST",
			body: JSON.stringify({ collection: action.collection, record: action.record }),
		});
		setData(payload.state);
		setStatus(action.collection === "customConnectors" ? "Connector added" : "Resource added");
	}

	async function updateResourceOAuth(action: Extract<ResourceAction, { kind: "oauth" }>) {
		const endpoint = action.action === "disconnect" ? "/api/connectors/oauth/disconnect" : "/api/connectors/oauth/start";
		const payload = await fetchJson<{ state?: WorkbenchState; authorizationUrl?: string }>(endpoint, {
			method: "POST",
			body: JSON.stringify({ connectorId: action.connectorId }),
		});
		if (payload.state) setData(payload.state);
		if (payload.authorizationUrl) window.open(payload.authorizationUrl, "_blank", "noopener");
		setStatus(action.action === "disconnect" ? "OAuth disconnected" : "OAuth authorization opened");
	}

	async function handleResourceAction(action: ResourceAction) {
		try {
			setError(null);
			if (action.kind === "command") insertComposerText(action.command);
			if (action.kind === "specialist") await useSpecialist(action.specialist);
			if (action.kind === "package") await updatePackageResource(action);
			if (action.kind === "settings") await upsertSettingsResource(action);
			if (action.kind === "remove") await removeSettingsResource(action);
			if (action.kind === "oauth") await updateResourceOAuth(action);
		} catch (actionError) {
			setError(actionError instanceof Error ? actionError.message : String(actionError));
			setStatus("Customize action failed");
		}
	}

	async function upsertMemory(record: Partial<WorkbenchMemoryRecord>) {
		try {
			const payload = await fetchJson<{ state: WorkbenchState }>("/api/memory", {
				method: "POST",
				body: JSON.stringify({ record }),
			});
			setData(payload.state);
			setStatus("Memory saved");
		} catch (memoryError) {
			setError(memoryError instanceof Error ? memoryError.message : String(memoryError));
			setStatus("Memory save failed");
		}
	}

	async function removeMemory(id: string) {
		const payload = await fetchJson<{ state: WorkbenchState }>("/api/memory", {
			method: "POST",
			body: JSON.stringify({ action: "remove", id }),
		});
		setData(payload.state);
		setStatus("Memory removed");
	}

	async function upsertNote(record: Partial<WorkbenchNoteRecord>) {
		try {
			const payload = await fetchJson<{ state: WorkbenchState }>("/api/notes", {
				method: "POST",
				body: JSON.stringify({ record }),
			});
			setData(payload.state);
			setStatus("Note saved");
		} catch (noteError) {
			setError(noteError instanceof Error ? noteError.message : String(noteError));
			setStatus("Note save failed");
		}
	}

	async function removeNote(id: string) {
		const payload = await fetchJson<{ state: WorkbenchState }>("/api/notes", {
			method: "POST",
			body: JSON.stringify({ action: "remove", id }),
		});
		setData(payload.state);
		setStatus("Note removed");
	}

	async function updateConnectorApproval(
		approval: ConnectorApprovalView,
		decision: ConnectorApprovalDecision,
		target: "connector" | "tool",
	) {
		const baseRecord = target === "connector" ? approval.wildcardRecord : approval.exactRecord;
		try {
			setError(null);
			const payload = await fetchJson<{ state: WorkbenchState }>("/api/resources/settings", {
				method: "POST",
				body: JSON.stringify({
					collection: "permissionGrants",
					record: { ...baseRecord, decision },
				}),
			});
			setData(payload.state);
			setSidePanel("customize");
			setStatus(decision === "allow" ? "Connector permission allowed" : "Connector permission blocked");
		} catch (approvalError) {
			setError(approvalError instanceof Error ? approvalError.message : String(approvalError));
			setStatus("Connector permission failed");
		}
	}

	function updateNotebookLanguage(language: NotebookLanguage) {
		setNotebookLanguage(language);
		if (language !== "python" && notebookExecutionMode === "modal") setNotebookExecutionMode("session");
		setNotebookCode((current) => current.trim() ? current : defaultNotebookCode(language));
	}

	async function runNotebookCell() {
		const code = notebookCode.trim();
		const jobId = createClientJobId("notebook");
		const body = chatRequestBody({
			code,
			jobId,
			language: notebookLanguage,
			executionMode: notebookExecutionMode,
			purpose: notebookPurpose,
			runSlug: run?.slug,
			taskSummary: run?.taskSummary,
		});
		if (!body || !code) {
			setStatus("Notebook code required");
			return;
		}
		setNotebookRunning(true);
		setNotebookJobId(jobId);
		setNotebookResult(null);
		setError(null);
		setStatus("Running notebook cell");
		try {
			const payload = await fetchJson<{ execution: NotebookExecutionResult; state: WorkbenchState }>("/api/notebook/execute", {
				method: "POST",
				body: JSON.stringify(body),
			});
			setData(payload.state);
			setNotebookResult(payload.execution);
			setStatus(payload.execution.status === "complete" ? "Notebook cell complete" : `Notebook cell ${payload.execution.status}`);
			setSidePanel("notebook");
		} catch (runError) {
			setError(runError instanceof Error ? runError.message : String(runError));
			setStatus("Notebook run failed");
		} finally {
			setNotebookRunning(false);
			setNotebookJobId(null);
		}
	}

	async function stopNotebookCell() {
		if (!notebookJobId) return;
		setComputeBusyJobId(`compute:${notebookJobId}`);
		setError(null);
		setStatus("Stopping notebook cell");
		try {
			const payload = await fetchJson<{ state: WorkbenchState }>("/api/compute/job/action", {
				method: "POST",
				body: JSON.stringify({ jobId: notebookJobId, action: "cancel" }),
			});
			setData(payload.state);
			setStatus("Stop requested");
		} catch (stopError) {
			setError(stopError instanceof Error ? stopError.message : String(stopError));
			setStatus("Notebook stop failed");
		} finally {
			setComputeBusyJobId(null);
		}
	}

	async function manageNotebookEnvironment() {
		const packages = normalizeNotebookPackageInput(environmentPackages);
		setEnvironmentBusy(true);
		setEnvironmentResult(null);
		setError(null);
		setStatus(notebookEnvironmentActionLabel(environmentMode, environmentLanguage, packages));
		try {
			const payload = await fetchJson<{ action: NotebookEnvironmentActionResult; state: WorkbenchState }>("/api/notebook/environment", {
				method: "POST",
				body: JSON.stringify({
					language: environmentLanguage,
					mode: environmentMode,
					packages,
				}),
			});
			setData(payload.state);
			setEnvironmentResult(payload.action);
			setStatus(payload.action.status === "complete" ? "Environment ready" : `Environment ${payload.action.status}`);
			if (payload.action.status === "complete" && environmentMode === "install") setEnvironmentPackages("");
		} catch (environmentError) {
			setError(environmentError instanceof Error ? environmentError.message : String(environmentError));
			setStatus("Environment action failed");
		} finally {
			setEnvironmentBusy(false);
		}
	}

	async function handleComputeJobAction(job: WorkbenchComputeJobRecord, action: ComputeJobAction) {
		setComputeBusyJobId(job.id);
		setError(null);
		setStatus(action === "retry" ? "Retrying compute job" : "Stopping compute job");
		try {
			const payload = await fetchJson<{ execution?: NotebookExecutionResult; state: WorkbenchState }>("/api/compute/job/action", {
				method: "POST",
				body: JSON.stringify({ jobId: job.id, action }),
			});
			setData(payload.state);
			if (payload.execution) setNotebookResult(payload.execution);
			setStatus(payload.execution ? `Compute job ${payload.execution.status}` : "Compute action recorded");
		} catch (actionError) {
			setError(actionError instanceof Error ? actionError.message : String(actionError));
			setStatus("Compute action failed");
		} finally {
			setComputeBusyJobId(null);
		}
	}

	async function handleComputeProviderAction(provider: WorkbenchComputeProvider, action: ComputeProviderAction) {
		setComputeBusyProviderId(provider.id);
		setError(null);
		setStatus(action === "remove" ? `Removing ${provider.name}` : `${action === "enable" ? "Enabling" : "Disabling"} ${provider.name}`);
		try {
			const payload = await fetchJson<{ state: WorkbenchState }>("/api/compute/provider/action", {
				method: "POST",
				body: JSON.stringify({ providerId: provider.id, action }),
			});
			setData(payload.state);
			setStatus(action === "remove" ? `${provider.name} removed` : `${provider.name} ${action === "enable" ? "enabled" : "disabled"}`);
		} catch (actionError) {
			setError(actionError instanceof Error ? actionError.message : String(actionError));
			setStatus("Compute provider action failed");
		} finally {
			setComputeBusyProviderId(null);
		}
	}

	async function steerMessage(trimmed: string) {
		const body = chatRequestBody({ message: trimmed });
		if (!body || !session) return;
		const queuedMessage: WorkbenchChatMessage = {
			id: `queued-${Date.now()}`,
			role: "user",
			content: trimmed,
			createdAt: new Date().toISOString(),
			status: "queued",
			toolEvents: [{
				id: `queued-tool-${Date.now()}`,
				label: "Queued to active Pi turn",
				status: "running",
				output: "Sending to the running Feynman session",
			}],
		};
		setSession({
			...session,
			status: "running",
			messages: [...session.messages, queuedMessage],
		});
		setMessage("");
		setStatus("Queued follow-up");
		const payload = await fetchJson<{ session: WorkbenchChatSession }>("/api/chat/message/steer", {
			method: "POST",
			body: JSON.stringify(body),
		});
		setSession(payload.session);
	}

	async function abortMessage() {
		const body = chatRequestBody();
		if (!body) return;
		setBusy(true);
		try {
			const payload = await fetchJson<{ session: WorkbenchChatSession }>("/api/chat/abort", {
				method: "POST",
				body: JSON.stringify(body),
			});
			setSession(payload.session);
			setStatus("Stopped");
		} catch (abortError) {
			setError(abortError instanceof Error ? abortError.message : String(abortError));
		} finally {
			setBusy(false);
		}
	}

	function applyStreamEvent(streamEvent: WorkbenchChatStreamEvent) {
		if (streamEvent.type === "session" || streamEvent.type === "done" || streamEvent.type === "error") {
			if (streamEvent.session) setSession(streamEvent.session);
			else if (streamEvent.type === "error") setSession((current) => current ? {
				...patchLastAssistant(current, { content: streamEvent.message || "Stream failed", status: "error" }),
				status: "error",
			} : current);
			if ((streamEvent.type === "done" || streamEvent.type === "error") && streamEvent.state) setData(streamEvent.state);
			if (streamEvent.type === "done") {
				setBusy(false);
				setStatus("Reply complete");
			}
			if (streamEvent.type === "error") {
				setBusy(false);
				setError(streamEvent.message || "Stream failed");
				setStatus("Reply failed");
			}
			return;
		}
		if (streamEvent.type === "delta") {
			setSession((current) => current ? patchLastAssistant(current, {
				content: streamEvent.content || "",
				status: "running",
			}) : current);
			return;
		}
		if (streamEvent.type === "tool") {
			setSession((current) => current ? upsertAssistantTool(current, streamEvent.toolEvent) : current);
		}
	}

	async function sendChatText(
		trimmed: string,
		options: { clearComposer?: boolean; status?: string } = {},
	) {
		if (!trimmed || !project || !run) return;
		if (busy) {
			try {
				await steerMessage(trimmed);
				if (options.clearComposer !== false) setMessage("");
			} catch (steerError) {
				setError(steerError instanceof Error ? steerError.message : String(steerError));
			}
			return;
		}
		const body = chatRequestBody({ message: trimmed });
		if (!body) return;
		const existing = session ?? {
			id: run.slug,
			projectId: project.id,
			title: run.title || project.name,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			status: "complete" as const,
			config: {
				delegation: false,
				autoReview: false,
				memory: false,
				specialist: "None",
				compute: "local" as const,
				model: "",
			},
				piSession: {
					id: "",
					status: "pending",
					messageCount: 0,
					userMessages: 0,
				assistantMessages: 0,
				toolResults: 0,
				toolCalls: 0,
				bashExecutions: 0,
				customMessages: 0,
				branchCount: 0,
				timeline: [],
				tools: [],
			},
			attachments: [],
			messages: [],
		} satisfies WorkbenchChatSession;
		const createdAt = new Date().toISOString();
		setBusy(true);
		setStatus(options.status ?? "Feynman is working");
		setError(null);
		if (options.clearComposer !== false) setMessage("");
		setSession({
			...existing,
			status: "running",
			messages: [
				...existing.messages,
				{
					id: `local-user-${Date.now()}`,
					role: "user",
					content: trimmed,
					createdAt,
					status: "complete",
					toolEvents: [],
				},
				{
					id: `local-assistant-${Date.now()}`,
					role: "assistant",
					content: "Starting Feynman inside this workspace...",
					createdAt,
					status: "running",
					toolEvents: [{
						id: "pi-turn",
						label: "Feynman Pi turn",
						status: "running",
					}],
				},
			],
		});
		try {
			const response = await fetch("/api/chat/message/stream", {
				method: "POST",
				headers: {
					accept: "text/event-stream",
					"content-type": "application/json",
					...(clientToken ? { "x-feynman-token": clientToken } : {}),
				},
				body: JSON.stringify(body),
			});
			if (!response.ok || !response.body) throw new Error(await response.text());
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			let receivedTerminalEvent = false;
			const applyEvent = (streamEvent: WorkbenchChatStreamEvent) => {
				if (isTerminalChatStreamEvent(streamEvent)) receivedTerminalEvent = true;
				applyStreamEvent(streamEvent);
			};
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer = parseStreamChunk(buffer + decoder.decode(value, { stream: true }), applyEvent);
			}
			parseStreamChunk(buffer + decoder.decode(), applyEvent);
			if (!receivedTerminalEvent) throw new Error("Chat stream ended before completion.");
			const state = await fetchJson<WorkbenchState>("/api/state");
			setData(state);
		} catch (sendError) {
			setError(sendError instanceof Error ? sendError.message : String(sendError));
			setSession((current) => current ? {
				...current,
				status: "error",
				messages: current.messages.map((item, index, messages) =>
					index === messages.length - 1 && item.role === "assistant"
						? { ...item, content: sendError instanceof Error ? sendError.message : String(sendError), status: "error" }
						: item
				),
			} : current);
			setStatus("Reply failed");
		} finally {
			setBusy(false);
		}
	}

	async function sendMessage(event: FormEvent) {
		event.preventDefault();
		setComposerMenuOpen(false);
		setSessionMenuOpen(false);
		setModelMenuOpen(false);
		await sendChatText(message.trim(), { clearComposer: true });
	}

	function focusComposer(cursor: number) {
		window.requestAnimationFrame(() => {
			const input = composerTextareaRef.current;
			if (!input) return;
			input.focus();
			input.setSelectionRange(cursor, cursor);
			setComposerCursor(cursor);
		});
	}

	function updateComposerDraft(value: string, cursor?: number | null) {
		setComposerMenuOpen(false);
		setSessionMenuOpen(false);
		setModelMenuOpen(false);
		setMessage(value);
		setComposerCursor(cursor ?? value.length);
	}

	function openComposerTrigger(marker: ComposerTrigger["marker"]) {
		setComposerMenuOpen(false);
		setSessionMenuOpen(false);
		setModelMenuOpen(false);
		const cursor = composerTextareaRef.current?.selectionStart ?? composerCursor;
		const next = beginComposerTrigger(message, cursor, marker);
		setMessage(next.value);
		setComposerActiveIndex(0);
		focusComposer(next.cursor);
	}

	function chooseComposerSuggestion(suggestion: ComposerSuggestion | undefined) {
		if (!composerTrigger || !suggestion) return;
		const next = applyComposerSuggestion(message, composerTrigger, suggestion);
		setMessage(next.value);
		setComposerActiveIndex(0);
		focusComposer(next.cursor);
	}

	function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
		if (!composerPickerOpen) return;
		if (event.key === "ArrowDown") {
			event.preventDefault();
			setComposerActiveIndex((current) => Math.min(current + 1, composerItems.length - 1));
			return;
		}
		if (event.key === "ArrowUp") {
			event.preventDefault();
			setComposerActiveIndex((current) => Math.max(current - 1, 0));
			return;
		}
		if (event.key === "Enter" || event.key === "Tab") {
			event.preventDefault();
			chooseComposerSuggestion(composerItems[composerActiveIndex]);
		}
	}

	async function retryApprovedConnectorCall(activity: ToolActivityView) {
		if (!activity.approval || activity.approval.decision !== "allow") return;
		await sendChatText(connectorApprovalRetryPrompt(activity.approval, activity.input), {
			clearComposer: false,
			status: "Retrying approved connector call",
		});
	}

	if (error && !data) {
		return (
			<div className="boot-screen">
				<div>
					<p className="eyebrow">Feynman Science</p>
					<h1>Workbench failed to load</h1>
					<p>{error}</p>
				</div>
			</div>
		);
	}

	if (!data) {
		return (
			<div className="boot-screen">
				<div>
					<p className="eyebrow">Feynman Science</p>
					<h1>Loading workbench</h1>
					<p>{status}</p>
				</div>
			</div>
		);
	}

	if (mode === "onboarding") {
		return (
			<OnboardingScreen
				busy={busy}
				draft={onboardingDraft}
				error={error}
				files={onboardingFiles}
				fileInputRef={onboardingFileInputRef}
				onComplete={() => void completeOnboarding()}
				onFiles={(files) => setOnboardingFiles(files)}
				onLauncher={data.onboarding.completed ? openLauncher : undefined}
				onStep={setOnboardingStep}
				onUpdate={(patch) => setOnboardingDraft((current) => ({ ...current, ...patch }))}
				step={onboardingStep}
			/>
		);
	}

	if (mode === "launcher") {
		return (
			<>
				<ProjectLauncher
					state={data}
					onNewSetup={() => {
						setOnboardingDraft(emptyOnboardingDraft);
						setOnboardingStep(0);
						setArtifactRefinement(null);
						setMode("onboarding");
					}}
					onOpenProject={(nextProject, nextRun, artifactPath) => openProjectRun(nextProject, nextRun, artifactPath)}
					onSearch={() => setCommandPaletteOpen(true)}
				/>
				<GlobalCommandPalette
					open={commandPaletteOpen}
					state={data}
					onClose={() => setCommandPaletteOpen(false)}
					onSelect={openCommandPaletteItem}
				/>
			</>
		);
	}

	const panelMeta = sidePanel ? sidePanelMeta(sidePanel) : null;
	const artifactRefinementControls = {
		annotationBusyId,
		mediaDraft: mediaAnnotationDraft,
		mediaModePath: mediaAnnotationModePath,
		state: artifactRefinement,
		onApply: () => void applyArtifactRefinementSuggestion(),
		onClose: () => setArtifactRefinement(null),
		onDraft: (draft: string) => setArtifactRefinement((current) => current ? { ...current, suggestionDraft: draft, status: "Draft edited" } : current),
		onMediaDraft: setMediaAnnotationDraft,
		onMediaMode: setMediaAnnotationModePath,
		onInstruction: (instruction: string) => setArtifactRefinement((current) => current ? { ...current, instruction, status: current.phase === "input" ? "Selection ready" : current.status } : current),
		onRemoveAnnotation: (annotationId: string) => void removeArtifactAnnotation(annotationId),
		onSaveAnnotation: () => void saveArtifactRefinementAnnotation(),
		onSuggest: (mode: ArtifactRefinementMode) => void requestArtifactRefinementSuggestion(mode),
		onTextSelection: startArtifactRefinement,
		onUseAnnotation: useArtifactAnnotationInChat,
	} satisfies ArtifactRefinementControls;
	const artifactActionControls = {
		busyKey: artifactActionBusyKey,
		cloudTarget: cloudExportTarget,
		status: artifactActionStatus,
		onAction: handleArtifactAction,
		onCloudExport: openCloudExportModal,
		onCopyLink: copyArtifactReference,
		onExportMetadata: exportArtifactMetadata,
		onNotes: (artifact: WorkbenchArtifact) => setNoteModalArtifactPath(artifact.path),
		onRecover: recoverArtifactAction,
		onViewContext: () => {
			setArtifactTab("provenance");
			setArtifactActionStatus("Showing artifact context");
		},
	} satisfies ArtifactActionControls;
	const sessionConfig = session?.config;
	const selectedModel = sessionConfig?.model ?? "";
	const filesPanelElement = (
		<FilesPanel
			actions={artifactActionControls}
			artifacts={filteredArtifacts}
			artifactTab={artifactTab}
			category={fileCategory}
			categoryCounts={fileCategoryCounts}
			editState={artifactEdit}
			filePreview={filePreview}
			filteredUploads={filteredUploads}
			hostId={fileHostId}
			hosts={fileHosts}
			scope={fileScope}
			scopeCounts={fileScopeCountItems}
			query={query}
			refinement={artifactRefinementControls}
			selectedArtifact={selectedArtifact}
			selectedPlan={selectedPlan}
			selectedPath={selectedArtifactPath}
			selectedUpload={selectedUpload}
			state={data}
			uploading={uploading}
			versionDiffs={versionDiffs}
			versionStatuses={versionStatuses}
			onArtifactTab={setArtifactTab}
			onCategory={setFileCategory}
			onEditCancel={() => setArtifactEdit(null)}
			onEditDraft={(draft) => setArtifactEdit((current) => current ? { ...current, draft, status: "Unsaved changes" } : current)}
			onEditOpen={(artifact) => void openArtifactEditor(artifact)}
			onEditSave={() => void saveArtifactEditor()}
			onMoleculeSave={(artifact, content) => saveMoleculeArtifact(artifact, content)}
			onHost={setFileHostId}
			onImport={() => fileInputRef.current?.click()}
			onOpenOverlay={() => setFilesOverlayOpen(true)}
			onPlanAction={(plan, action) => void updateWorkbenchPlanActionFromPreview(plan, action)}
			onPlanStep={(plan, stepTitle, stepStatus) => void updateWorkbenchPlanStepFromPreview(plan, stepTitle, stepStatus)}
			onQuery={setQuery}
			onSelect={(path) => {
				setSelectedArtifactPath(path);
				setSelectedUploadId(null);
				setArtifactTab("preview");
			}}
			onScope={setFileScope}
			onUploadDownloadUrl={uploadDownloadUrl}
			onUploadRemove={(uploadId) => void removeUpload(uploadId)}
			onUploadSelect={(uploadId) => {
				setSelectedUploadId(uploadId);
				setSelectedArtifactPath(null);
				setArtifactEdit(null);
			}}
			onVersionDiff={(version) => void diffArtifactVersion(version)}
			onVersionRestore={(version) => void restoreArtifactVersion(version)}
		/>
	);

	return (
		<div className={cx("app-shell", sidePanel && "has-side-panel", scienceArtifactPanelOpen && "science-artifact-open")}>
			<GlobalCommandPalette
				open={commandPaletteOpen}
				state={data}
				onClose={() => setCommandPaletteOpen(false)}
				onSelect={openCommandPaletteItem}
			/>
			<CloudExportModal
				artifact={cloudExportDraft ? data.artifacts.find((artifact) => artifact.path === cloudExportDraft.artifactPath) ?? null : null}
				busy={Boolean(cloudExportDraft && artifactActionBusyKey === `${cloudExportDraft.artifactPath}:export-cloud`)}
				draft={cloudExportDraft}
				status={artifactActionStatus}
				targets={cloudExportTargets}
				onClose={() => setCloudExportDraft(null)}
				onDraft={setCloudExportDraft}
				onExport={(artifact, target, destinationPath) => void exportArtifactToCloud(artifact, target, destinationPath)}
			/>
			<CloudStorageModal
				credentials={data.cloudCredentials}
				open={cloudStorageOpen}
				targets={cloudExportTargets}
				onClose={() => setCloudStorageOpen(false)}
				onNavigateToCredentials={() => {
					setCloudStorageOpen(false);
					setSidePanel("customize");
					setStatus("Open Credentials in Customize");
				}}
				onRemoveCredential={(settingsRecordId) => void removeCloudStorageCredential(settingsRecordId)}
			/>
			<NotesModal
				artifact={noteModalArtifact}
				notes={data.notes}
				onClose={() => setNoteModalArtifactPath(null)}
				onRemove={(id) => void removeNote(id)}
				onSave={(record) => void upsertNote(record)}
				onPreview={(note) => setNotePreviewId(note.id)}
				project={project}
				run={run}
			/>
			<NotePreviewModal
				artifact={notePreviewArtifact}
				note={notePreviewNote}
				onClose={() => setNotePreviewId(null)}
				onOpenArtifact={(artifactPath) => {
					setNotePreviewId(null);
					openArtifactPath(artifactPath, "Showing note artifact");
				}}
			/>
			<input
				ref={fileInputRef}
				type="file"
				multiple
				hidden
				onChange={(event) => void uploadFiles(event.currentTarget.files)}
			/>
			<aside className="rail" aria-label="Research sessions">
				<div className="project-header">
					<button
						type="button"
						className="rail-icon-button"
						aria-label="Back to projects"
						onClick={() => {
							setMode(data?.onboarding.completed ? "launcher" : "onboarding");
							window.history.pushState(null, "", launcherPath());
						}}
					>
						<ArrowLeft size={22} aria-hidden />
					</button>
					<button
						type="button"
						className="project-title-button"
						aria-label="Open project switcher"
						onClick={() => setCommandPaletteOpen(true)}
					>
						<span>{project?.name ?? "Workspace"}</span>
						<ChevronDown size={18} aria-hidden />
					</button>
					<button
						type="button"
						className="rail-icon-button"
						aria-label="Toggle files pane"
						onClick={() => setCenterPane((current) => current === "files" ? "chat" : "files")}
					>
						<PanelLeft size={22} aria-hidden />
					</button>
				</div>

				<div className="rail-actions">
					<button type="button" className="primary-action" onClick={createSession} disabled={busy || !project}>
						<Plus size={16} aria-hidden />
						<span>New chat</span>
					</button>
					<button type="button" onClick={() => setSidePanel(sidePanel === "customize" ? null : "customize")}>
						<Settings size={16} aria-hidden />
						<span>Customize</span>
					</button>
					<button type="button" onClick={() => setCenterPane("files")}>
						<FolderOpen size={16} aria-hidden />
						<span>Files</span>
					</button>
				</div>

				<div className="session-heading">
					<span>Sessions</span>
					<span>{projectRuns.length}</span>
				</div>
				<div className="session-list">
					{visibleRuns.map((item) => (
						<button
							type="button"
							key={item.slug}
							className={cx("session-row", item.slug === run?.slug && "selected")}
							onClick={() => selectRun(item)}
						>
							<span className="session-row-main">
								<span>{item.title}</span>
								<small>{runStatusLabel(item)}</small>
							</span>
							<ChevronRight size={14} aria-hidden />
						</button>
					))}
					{projectRuns.length > visibleRuns.length ? (
						<div className="session-more">{projectRuns.length - visibleRuns.length} more sessions</div>
					) : null}
				</div>
			</aside>

			<main className="conversation">
				<header className="topbar">
					<div>
						<h1>{run?.title ?? project?.name ?? "Research chat"}</h1>
					</div>
					<div className="topbar-right">
						<div className="topbar-status">
							<span>{status}</span>
							<span>{data?.version ? `v${data.version}` : "local"}</span>
						</div>
						<div className="topbar-controls">
							<div className="topbar-menu-control">
								<button
									type="button"
									className="topbar-menu-button"
									aria-label="Open model menu"
									aria-haspopup="menu"
									aria-expanded={modelMenuOpen}
									onClick={() => {
										setModelMenuOpen((open) => !open);
										setSessionMenuOpen(false);
										setComposerMenuOpen(false);
									}}
								>
									<Layers size={15} aria-hidden />
									<span>{formatModelLabel(selectedModel)}</span>
								</button>
								{modelMenuOpen ? (
									<div className="topbar-menu-panel model-menu" role="menu" aria-label="Model menu">
										<button
											type="button"
											role="menuitemradio"
											aria-checked={!selectedModel}
											onClick={() => void updateSessionConfig({ model: "" }, "Default model selected")}
											disabled={!session}
										>
											<span>Default</span>
											<small>{data?.modelStatus?.current ? `Uses ${data.modelStatus.current}` : "Uses the configured Feynman default"}</small>
										</button>
										{modelMenuSpecs.map((spec) => (
											<button
												type="button"
												key={spec}
												role="menuitemradio"
												aria-checked={selectedModel === spec}
												onClick={() => void updateSessionConfig({ model: spec }, `${formatModelLabel(spec)} selected`)}
												disabled={!session}
											>
												<span>{formatModelLabel(spec)}</span>
												<small>{spec === data?.modelStatus?.recommended ? "Recommended" : spec}</small>
											</button>
										))}
										{!modelMenuSpecs.length ? (
											<button type="button" role="menuitem" disabled>
												<span>No authenticated models</span>
												<small>Use model setup first</small>
											</button>
										) : null}
										<button
											type="button"
											role="menuitem"
											onClick={() => {
												setModelMenuOpen(false);
												setSidePanel("customize");
												setStatus("Showing model setup");
											}}
										>
											<span>More models</span>
											<small>Open credentials and model setup</small>
										</button>
									</div>
								) : null}
							</div>
							<div className="topbar-menu-control">
								<button
									type="button"
									className="topbar-menu-button"
									aria-label="Open session options"
									aria-haspopup="menu"
									aria-expanded={sessionMenuOpen}
									onClick={() => {
										setSessionMenuOpen((open) => !open);
										setModelMenuOpen(false);
										setComposerMenuOpen(false);
									}}
								>
									<Settings size={15} aria-hidden />
									<span>{formatSpecialistLabel(sessionConfig?.specialist ?? "None")}</span>
								</button>
								{sessionMenuOpen ? (
									<div className="topbar-menu-panel session-options-menu" role="menu" aria-label="Session options">
										<button
											type="button"
											role="menuitemcheckbox"
											aria-checked={Boolean(sessionConfig?.delegation)}
											onClick={() => void updateSessionConfig({ delegation: !sessionConfig?.delegation }, sessionConfig?.delegation ? "Delegation disabled" : "Delegation enabled")}
											disabled={!session}
										>
											<span>Delegation</span>
											<small>Use bundled research subagents</small>
										</button>
										<button
											type="button"
											role="menuitemcheckbox"
											aria-checked={Boolean(sessionConfig?.autoReview)}
											onClick={() => void updateSessionConfig({ autoReview: !sessionConfig?.autoReview }, sessionConfig?.autoReview ? "Auto-review disabled" : "Auto-review enabled")}
											disabled={!session}
										>
											<span>Auto-review</span>
											<small>Ask the reviewer after runs</small>
										</button>
										<button
											type="button"
											role="menuitemcheckbox"
											aria-checked={Boolean(sessionConfig?.memory)}
											onClick={() => void updateSessionConfig({ memory: !sessionConfig?.memory }, sessionConfig?.memory ? "Memory disabled" : "Memory enabled")}
											disabled={!session}
										>
											<span>Memory</span>
											<small>Include saved research context</small>
										</button>
										<div className="topbar-menu-section">
											<div>
												<span>Specialist</span>
												<strong>{formatSpecialistLabel(sessionConfig?.specialist ?? "None")}</strong>
											</div>
											<div className="topbar-menu-grid">
												{sessionSpecialistOptions.map((specialist) => (
													<button
														type="button"
														key={specialist}
														role="menuitemradio"
														aria-checked={(sessionConfig?.specialist ?? "None") === specialist}
														onClick={() => void updateSessionConfig({ specialist }, `${formatSpecialistLabel(specialist)} specialist selected`)}
														disabled={!session}
													>
														{formatSpecialistLabel(specialist)}
													</button>
												))}
											</div>
										</div>
										<button
											type="button"
											role="menuitemcheckbox"
											aria-checked={sessionConfig?.compute !== "off"}
											onClick={() => void updateSessionConfig({ compute: sessionConfig?.compute === "off" ? "local" : "off" }, sessionConfig?.compute === "off" ? "Compute enabled" : "Compute disabled")}
											disabled={!session}
										>
											<span>Compute</span>
											<small>{sessionConfig?.compute === "off" ? "Disabled" : "Local workspace available"}</small>
										</button>
									</div>
								) : null}
							</div>
						</div>
					</div>
				</header>

				<nav className="workspace-tab-strip" aria-label="Workspace views">
					<button
						type="button"
						className={cx(centerPane === "chat" && "active")}
						aria-current={centerPane === "chat" ? "page" : undefined}
						onClick={() => setCenterPane("chat")}
					>
						<MessageSquare size={13} aria-hidden />
						<span>{run?.title ?? "Chat"}</span>
					</button>
					<button
						type="button"
						className={cx(centerPane === "files" && "active")}
						aria-current={centerPane === "files" ? "page" : undefined}
						onClick={() => setCenterPane("files")}
					>
						<FolderOpen size={13} aria-hidden />
						<span>Files</span>
						<small>{filteredArtifacts.length + filteredUploads.length}</small>
					</button>
				</nav>

				<section className="context-strip" aria-label="Run context">
					<div>
						<span className="metric-label">Artifacts</span>
						<strong>{runArtifacts.length}</strong>
					</div>
					<div>
						<span className="metric-label">Checks</span>
						<strong>{data?.checks.filter((check) => check.runSlug === run?.slug).length ?? 0}</strong>
					</div>
					<div>
						<span className="metric-label">Updated</span>
						<strong>{formatShortDate(run?.updatedAt) || "Now"}</strong>
					</div>
					<button type="button" onClick={() => setSidePanel(sidePanel ? null : "files")} aria-label="Toggle side panel">
						<PanelRightOpen size={16} aria-hidden />
					</button>
				</section>

				{centerPane === "chat" ? (
					<section className="transcript" aria-label="Chat transcript">
						{session?.messages.length ? (
							session.messages.map((chatMessage, messageIndex) => {
								const rootFrameId = session?.id ?? run?.slug;
								const transcriptAnnotations = transcriptAnnotationsForMessage(data.transcriptAnnotations ?? [], rootFrameId, chatMessage.id, messageIndex);
								return (
									<article key={chatMessage.id} className={cx("message", chatMessage.role)} data-transcript-message-id={chatMessage.id}>
										<div className="message-icon">
											{chatMessage.role === "assistant" ? <Bot size={16} aria-hidden /> : <span>{chatMessage.role === "user" ? "U" : "S"}</span>}
										</div>
										<div className="message-body">
											<div className="message-meta">
												<span>{chatMessage.role === "assistant" ? "Feynman" : chatMessage.role}</span>
												<span className="message-meta-actions">
													{transcriptAnnotations.length ? <span>{transcriptAnnotations.length} bookmark{transcriptAnnotations.length === 1 ? "" : "s"}</span> : null}
													<button
														type="button"
														aria-label="Bookmark transcript message"
														title="Bookmark transcript message"
														disabled={transcriptAnnotationBusyId === chatMessage.id}
														onClick={() => void saveTranscriptAnnotation(chatMessage, messageIndex)}
													>
														<BookOpen size={13} aria-hidden />
													</button>
													<span>{chatMessage.status}</span>
												</span>
											</div>
											<p data-transcript-content>{chatMessage.content || "No content recorded yet."}</p>
											{transcriptAnnotations.length ? (
												<div className="transcript-annotations" data-testid="transcript-annotations">
													{transcriptAnnotations.map((annotation) => (
														<div className="transcript-annotation-row" key={annotation.id}>
															<div>
																<strong>{annotation.kind === "bookmark" ? "Bookmark" : "Note"} / message {annotation.messageIndex + 1}</strong>
																<span>{annotation.source}{annotation.toolName ? ` / ${annotation.toolName}` : ""}</span>
															</div>
															<blockquote>{annotation.anchorText}</blockquote>
															{annotation.note ? <p>{annotation.note}</p> : null}
															<div className="transcript-annotation-actions">
																<button type="button" onClick={() => useTranscriptAnnotationInChat(annotation)}>
																	<Send size={12} aria-hidden />
																	<span>Use in chat</span>
																</button>
																<button
																	type="button"
																	disabled={transcriptAnnotationBusyId === annotation.id}
																	onClick={() => void removeTranscriptAnnotation(annotation.id)}
																>
																	<Trash2 size={12} aria-hidden />
																	<span>Remove</span>
																</button>
															</div>
														</div>
													))}
												</div>
											) : null}
											<ToolEvents
												events={chatMessage.toolEvents}
												groups={data?.resources ?? []}
												onOpenPermissions={() => setSidePanel("customize")}
												onPermissionDecision={(approval, decision, target) => void updateConnectorApproval(approval, decision, target)}
												onRetryApproval={(activity) => void retryApprovedConnectorCall(activity)}
											/>
										</div>
									</article>
								);
							})
						) : (
							runArtifacts.length ? (
								<GeneratedArtifactsBlock
									artifacts={runArtifacts}
									clientToken={clientToken}
									onSelect={(artifact) => openArtifactPath(artifact.path, "Showing artifact")}
								/>
							) : (
								<div className="empty-state">
									<Bot size={18} aria-hidden />
									<h2>Ask Feynman to research, verify, reproduce, or synthesize.</h2>
									<p>The chat is attached to this project, its files, Pi subagents, compute records, and provenance state.</p>
								</div>
							)
						)}
						{error ? <div className="inline-error">{error}</div> : null}
					</section>
				) : (
					<section className="center-files-panel" aria-label="Workspace files">
						{filesPanelElement}
					</section>
				)}

				{centerPane === "chat" ? (
					<form className="composer" onSubmit={sendMessage}>
					<div className="composer-tools">
						<div className="composer-action-menu">
							<button
								type="button"
								aria-label="Open composer actions"
								aria-haspopup="menu"
								aria-expanded={composerMenuOpen}
								onClick={() => setComposerMenuOpen((open) => !open)}
							>
								<Plus size={16} aria-hidden />
							</button>
							{composerMenuOpen ? (
								<div className="composer-menu" role="menu" aria-label="Composer actions">
									<button type="button" role="menuitem" onClick={() => {
										setComposerMenuOpen(false);
										fileInputRef.current?.click();
									}} disabled={uploading}>
										<Upload size={15} aria-hidden />
										<span>Attach files</span>
									</button>
									<button type="button" role="menuitem" onClick={() => {
										setComposerMenuOpen(false);
										setSidePanel("files");
										setFilesOverlayOpen(true);
									}}>
										<FolderOpen size={15} aria-hidden />
										<span>Your files</span>
									</button>
									<button type="button" role="menuitem" onClick={() => void openWorkbenchPlan()} disabled={busy || !project || !run}>
										<FileText size={15} aria-hidden />
										<span>View plan</span>
									</button>
									<button type="button" role="menuitem" onClick={() => void requestReviewFromComposer()} disabled={busy || !project || !run}>
										<GitCompare size={15} aria-hidden />
										<span>Request review</span>
									</button>
									<button type="button" role="menuitem" onClick={saveAsSkillFromComposer}>
										<Save size={15} aria-hidden />
										<span>Save as skill</span>
									</button>
								</div>
							) : null}
						</div>
						<button type="button" aria-label="Mention artifact" title="Mention artifact" onClick={() => openComposerTrigger("@")}>
							<AtSign size={16} aria-hidden />
						</button>
						<button type="button" aria-label="Mention session" title="Mention session" onClick={() => openComposerTrigger("#")}>
							<Hash size={16} aria-hidden />
						</button>
						<button type="button" aria-label="Insert command" title="Insert command" onClick={() => openComposerTrigger("/")}>
							<Slash size={16} aria-hidden />
						</button>
					</div>
					<div className="composer-input-shell">
						<textarea
							ref={composerTextareaRef}
							value={message}
							onChange={(event) => updateComposerDraft(event.target.value, event.currentTarget.selectionStart)}
							onClick={(event) => setComposerCursor(event.currentTarget.selectionStart)}
							onKeyDown={handleComposerKeyDown}
							onKeyUp={(event) => setComposerCursor(event.currentTarget.selectionStart)}
							onSelect={(event) => setComposerCursor(event.currentTarget.selectionStart)}
							placeholder="Ask about papers, evidence, code, data, or a reproduction plan"
							rows={1}
							aria-controls={composerPickerOpen ? "composer-suggestions" : undefined}
							aria-expanded={composerPickerOpen}
							aria-autocomplete="list"
						/>
						{composerPickerOpen ? (
							<div className="composer-suggestions" id="composer-suggestions" role="listbox" aria-label="Composer suggestions">
								<div className="composer-suggestions-heading">
									<span>{composerTrigger?.kind === "artifact" ? "Artifacts" : composerTrigger?.kind === "session" ? "Sessions" : "Commands"}</span>
									<small>{composerTrigger?.marker}{composerTrigger?.query}</small>
								</div>
								{composerItems.map((item, index) => (
									<button
										type="button"
										key={item.id}
										className={cx("composer-suggestion", index === composerActiveIndex && "selected")}
										role="option"
										aria-selected={index === composerActiveIndex}
										onMouseDown={(event) => {
											event.preventDefault();
											chooseComposerSuggestion(item);
										}}
									>
										<span className="composer-suggestion-kind">{item.kind === "artifact" ? "@" : item.kind === "session" ? "#" : "/"}</span>
										<span className="composer-suggestion-main">
											<strong>{item.label}</strong>
											<small>{item.detail}</small>
										</span>
									</button>
								))}
							</div>
						) : null}
					</div>
					{busy ? (
						<button type="button" className="send-button stop-button" onClick={abortMessage} aria-label="Stop running turn">
							<X size={16} aria-hidden />
						</button>
					) : (
						<button type="submit" className="send-button" disabled={!message.trim()} aria-label="Send message">
						<Send size={16} aria-hidden />
						</button>
					)}
					</form>
				) : null}
			</main>

			{sidePanel ? (
				<aside className="side-panel" aria-label={panelMeta?.title}>
					<header>
						<div>
							<p className="eyebrow">{panelMeta?.label}</p>
							<h2>{panelMeta?.title}</h2>
						</div>
						<button type="button" onClick={() => setSidePanel(null)} aria-label="Close side panel">
							<X size={16} aria-hidden />
						</button>
					</header>
					{sidePanel === "files" ? (
						filesPanelElement
					) : sidePanel === "notebook" ? (
						<NotebookPanel
							code={notebookCode}
							environmentGroups={environmentGroups}
							environmentBusy={environmentBusy}
							environmentLanguage={environmentLanguage}
							environmentMode={environmentMode}
							environmentPackages={environmentPackages}
							environmentResult={environmentResult}
							executionMode={notebookExecutionMode}
							kernels={runKernels}
							language={notebookLanguage}
							notebookCells={runNotebookCells}
							purpose={notebookPurpose}
							result={notebookResult}
							running={notebookRunning}
							onCode={setNotebookCode}
							onEnvironmentLanguage={setEnvironmentLanguage}
							onEnvironmentMode={setEnvironmentMode}
							onEnvironmentPackages={setEnvironmentPackages}
							onEnvironmentRun={() => void manageNotebookEnvironment()}
							onExecutionMode={setNotebookExecutionMode}
							onLanguage={updateNotebookLanguage}
							onPurpose={setNotebookPurpose}
							onRun={() => void runNotebookCell()}
							onStop={() => void stopNotebookCell()}
						/>
					) : sidePanel === "compute" ? (
						<ComputePanel
							busyJobId={computeBusyJobId}
							busyProviderId={computeBusyProviderId}
							jobs={runComputeJobs}
							onProviderAction={(provider, action) => void handleComputeProviderAction(provider, action)}
							providers={data?.compute ?? []}
							onAction={(job, action) => void handleComputeJobAction(job, action)}
						/>
					) : sidePanel === "memory" ? (
						<MemoryPanel
							artifact={selectedArtifact}
							notes={data?.notes ?? []}
							memories={data?.memories ?? []}
							project={project}
							run={run}
							resources={data?.resources ?? []}
							onRemoveMemory={(id) => void removeMemory(id)}
							onRemoveNote={(id) => void removeNote(id)}
							onSaveMemory={(record) => void upsertMemory(record)}
							onSaveNote={(record) => void upsertNote(record)}
						/>
					) : (
						<CustomizePanel
							groups={data?.resources ?? []}
							onAction={(action) => void handleResourceAction(action)}
							onCloudStorage={() => setCloudStorageOpen(true)}
						/>
					)}
				</aside>
			) : null}
			{filesOverlayOpen ? (
				<FilesOverlay
					actions={artifactActionControls}
					artifacts={filteredArtifacts}
					artifactTab={artifactTab}
					category={fileCategory}
					categoryCounts={fileCategoryCounts}
					editState={artifactEdit}
					filePreview={filePreview}
					filteredUploads={filteredUploads}
					hostId={fileHostId}
					hosts={fileHosts}
					onArtifactTab={setArtifactTab}
					onCategory={setFileCategory}
					onClose={() => setFilesOverlayOpen(false)}
					onEditCancel={() => setArtifactEdit(null)}
					onEditDraft={(draft) => setArtifactEdit((current) => current ? { ...current, draft, status: "Unsaved changes" } : current)}
					onEditOpen={(artifact) => void openArtifactEditor(artifact)}
					onEditSave={() => void saveArtifactEditor()}
					onMoleculeSave={(artifact, content) => saveMoleculeArtifact(artifact, content)}
					onHost={setFileHostId}
					onImport={() => fileInputRef.current?.click()}
					onPlanAction={(plan, action) => void updateWorkbenchPlanActionFromPreview(plan, action)}
					onPlanStep={(plan, stepTitle, stepStatus) => void updateWorkbenchPlanStepFromPreview(plan, stepTitle, stepStatus)}
					onQuery={setQuery}
					onScope={setFileScope}
					onSelect={(path) => {
						setSelectedArtifactPath(path);
						setSelectedUploadId(null);
						setArtifactTab("preview");
					}}
					onUploadDownloadUrl={uploadDownloadUrl}
					onUploadRemove={(uploadId) => void removeUpload(uploadId)}
					onUploadSelect={(uploadId) => {
						setSelectedUploadId(uploadId);
						setSelectedArtifactPath(null);
						setArtifactEdit(null);
					}}
					onVersionDiff={(version) => void diffArtifactVersion(version)}
					onVersionRestore={(version) => void restoreArtifactVersion(version)}
					query={query}
					refinement={artifactRefinementControls}
					scope={fileScope}
					scopeCounts={fileScopeCountItems}
					selectedArtifact={selectedArtifact}
					selectedPlan={selectedPlan}
					selectedPath={selectedArtifactPath}
					selectedUpload={selectedUpload}
					state={data}
					uploading={uploading}
					versionDiffs={versionDiffs}
					versionStatuses={versionStatuses}
				/>
			) : null}
		</div>
	);
}

function CloudExportModal({
	artifact,
	busy,
	draft,
	onClose,
	onDraft,
	onExport,
	status,
	targets,
}: {
	artifact: WorkbenchArtifact | null;
	busy: boolean;
	draft: CloudExportDraft | null;
	onClose: () => void;
	onDraft: (draft: CloudExportDraft | null) => void;
	onExport: (artifact: WorkbenchArtifact, target: WorkbenchCloudExportTarget | null, destinationPath: string) => void;
	status: string;
	targets: WorkbenchCloudExportTarget[];
}) {
	if (!draft || !artifact) return null;
	const selectedTarget = targets.find((target) => target.id === draft.credentialId) ?? null;
	const configuredTargets = targets.filter((target) => target.status === "configured");
	const canExport = Boolean(selectedTarget && selectedTarget.status === "configured" && !busy);
	const updateDraft = (patch: Partial<CloudExportDraft>) => onDraft({ ...draft, ...patch });
	return (
		<div className="command-palette-backdrop cloud-export-backdrop" role="presentation" onMouseDown={onClose}>
			<section
				aria-label="Cloud export"
				aria-modal="true"
				className="cloud-export-modal"
				role="dialog"
				onMouseDown={(event) => event.stopPropagation()}
			>
				<header className="cloud-export-header">
					<div>
						<CloudUpload size={16} aria-hidden />
						<strong>Cloud export</strong>
						<span>{artifact.path}</span>
					</div>
					<button type="button" aria-label="Close cloud export" onClick={onClose}>
						<X size={15} aria-hidden />
					</button>
				</header>
				<div className="cloud-export-body">
					<div className="cloud-export-targets" role="radiogroup" aria-label="Cloud export targets">
						{targets.length ? targets.map((target) => (
							<button
								key={target.id}
								type="button"
								className={cx(target.id === draft.credentialId && "active")}
								onClick={() => updateDraft({ credentialId: target.id })}
								role="radio"
								aria-checked={target.id === draft.credentialId}
							>
								<span>
									<strong>{target.name}</strong>
									<small>{target.detail}</small>
								</span>
								<em>{target.status === "configured" ? target.provider.toUpperCase() : "Missing"}</em>
							</button>
						)) : (
							<div className="panel-empty">No cloud storage targets are configured in Credentials.</div>
						)}
					</div>
					<label className="cloud-export-field">
						<span>Destination path</span>
						<input
							value={draft.destinationPath}
							onChange={(event) => updateDraft({ destinationPath: event.currentTarget.value })}
							placeholder={artifact.name}
						/>
					</label>
					<div className="cloud-export-summary">
						<span>{configuredTargets.length ? `${configuredTargets.length} configured target${configuredTargets.length === 1 ? "" : "s"}` : "Configure a target in Customize > Credentials"}</span>
						<span>{status}</span>
					</div>
				</div>
				<footer className="cloud-export-actions">
					<button type="button" onClick={onClose}>Cancel</button>
					<button
						type="button"
						disabled={!canExport}
						onClick={() => onExport(artifact, selectedTarget, draft.destinationPath)}
					>
						<CloudUpload size={14} aria-hidden />
						<span>{busy ? "Exporting" : "Export"}</span>
					</button>
				</footer>
			</section>
		</div>
	);
}

function CloudStorageModal({
	credentials,
	open,
	targets,
	onClose,
	onNavigateToCredentials,
	onRemoveCredential,
}: {
	credentials: WorkbenchCloudCredential[];
	open: boolean;
	targets: WorkbenchCloudExportTarget[];
	onClose: () => void;
	onNavigateToCredentials: () => void;
	onRemoveCredential: (settingsRecordId: string) => void;
}) {
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [testResult, setTestResult] = useState<Record<string, string>>({});
	const targetById = useMemo(() => new Map(targets.map((target) => [target.id, target])), [targets]);
	const providerLabel = (provider: WorkbenchCloudCredential["provider"]) => {
		if (provider === "s3") return "Amazon S3";
		if (provider === "gcs") return "Google Cloud Storage";
		if (provider === "azure") return "Azure Blob Storage";
		if (provider === "local") return "Local filesystem";
		return "Cloud target";
	};
	if (!open) return null;
	return (
		<div className="command-palette-backdrop cloud-storage-backdrop" role="presentation" onMouseDown={onClose}>
			<section
				aria-label="Cloud Storage"
				className="cloud-storage-modal"
				onMouseDown={(event) => event.stopPropagation()}
			>
				<header className="cloud-storage-header">
					<div>
						<strong><CloudUpload size={16} aria-hidden />Cloud storage</strong>
						<span>Browse and manage bucket connections used by artifact export</span>
					</div>
					<div className="cloud-storage-header-actions">
						<button type="button" onClick={onNavigateToCredentials}>Go to Credentials</button>
						<button type="button" aria-label="Close" onClick={onClose}><X size={15} aria-hidden /></button>
					</div>
				</header>
				<div className="cloud-storage-body">
					{credentials.length ? (
						<div className="cloud-storage-list">
							{credentials.map((credential) => {
								const expanded = expandedId === credential.id;
								const target = targetById.get(credential.settingsRecordId);
								const statusText = credential.status === "configured" ? "Connected" : "Not connected";
								return (
									<article key={credential.id} className={cx("cloud-storage-row", expanded && "expanded")}>
										<button
											type="button"
											aria-expanded={expanded}
											className="cloud-storage-row-main"
											onClick={() => setExpandedId(expanded ? null : credential.id)}
										>
											<ChevronRight size={14} aria-hidden />
											<span>
												<strong>{credential.name}</strong>
												<small>{credential.defaultBucket || target?.detail || credential.envVar}</small>
											</span>
											<em>{providerLabel(credential.provider)}</em>
											<b className={cx("cloud-storage-status", credential.status)}>{statusText}</b>
										</button>
										{expanded ? (
											<div className="cloud-storage-details">
												<dl>
													<div><dt>Provider</dt><dd>{providerLabel(credential.provider)}</dd></div>
													<div><dt>Auth type</dt><dd>{credential.credentialType.replace(/_/g, " ")}</dd></div>
													<div><dt>Target</dt><dd>{target?.detail ?? "No export target resolved"}</dd></div>
													<div><dt>Environment</dt><dd>{credential.envVar}</dd></div>
													<div><dt>Created</dt><dd>{formatShortDate(credential.createdAt)}</dd></div>
													<div><dt>Updated</dt><dd>{formatShortDate(credential.updatedAt)}</dd></div>
												</dl>
												{testResult[credential.id] ? <p className="cloud-storage-test-result">{testResult[credential.id]}</p> : null}
												<div className="cloud-storage-detail-actions">
													<button
														type="button"
														onClick={() => setTestResult((current) => ({
															...current,
															[credential.id]: credential.status === "configured"
																? `Connection reference is configured for ${target?.detail ?? credential.envVar}.`
																: `${credential.envVar} is missing, so this target cannot export artifacts yet.`,
														}))}
													>
														Test connection
													</button>
													<button
														type="button"
														onClick={() => {
															if (window.confirm(`Remove ${credential.name} from Feynman cloud storage?`)) onRemoveCredential(credential.settingsRecordId);
														}}
													>
														Delete credential
													</button>
												</div>
											</div>
										) : null}
									</article>
								);
							})}
						</div>
					) : (
						<div className="panel-empty">
							No cloud storage configured. Add credentials with bucket access in the Credentials tab to connect cloud storage.
						</div>
					)}
				</div>
			</section>
		</div>
	);
}

function NotesModal({
	artifact,
	notes,
	onClose,
	onRemove,
	onSave,
	onPreview,
	project,
	run,
}: {
	artifact: WorkbenchArtifact | null;
	notes: WorkbenchNoteRecord[];
	onClose: () => void;
	onRemove: (id: string) => void;
	onSave: (record: Partial<WorkbenchNoteRecord>) => void;
	onPreview: (note: WorkbenchNoteRecord) => void;
	project?: WorkbenchProject;
	run?: WorkbenchRun;
}) {
	const [draft, setDraft] = useState("");
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editingContent, setEditingContent] = useState("");
	const targetNotes = useMemo(() => notesForTarget(notes, run, artifact), [artifact, notes, run]);
	if (!artifact) return null;
	const targetLabel = artifact.displayName || artifact.title || artifact.name;
	const baseRecord = {
		...(project ? { projectId: project.id } : {}),
		targetType: "artifact" as const,
		targetFrameId: run?.slug,
		targetArtifactPath: artifact.path,
	};
	const saveDraft = () => {
		const content = draft.trim();
		if (!content) return;
		onSave({ ...baseRecord, content });
		setDraft("");
	};
	const saveEdit = (note: WorkbenchNoteRecord) => {
		const content = editingContent.trim();
		if (!content) return;
		onSave({ ...note, content });
		setEditingId(null);
		setEditingContent("");
	};
	return (
		<div className="command-palette-backdrop notes-modal-backdrop" role="presentation" onMouseDown={onClose}>
			<section
				aria-label="Artifact notes"
				aria-modal="true"
				className="notes-modal"
				role="dialog"
				onMouseDown={(event) => event.stopPropagation()}
			>
				<header className="notes-modal-header">
					<div>
						<StickyNote size={16} aria-hidden />
						<strong>Artifact notes</strong>
						<span>{targetLabel}</span>
					</div>
					<button type="button" aria-label="Close notes" onClick={onClose}>
						<X size={15} aria-hidden />
					</button>
				</header>
				<div className="notes-modal-body">
					<label className="notes-modal-field">
						<span>Add a note</span>
						<textarea
							value={draft}
							onChange={(event) => setDraft(event.currentTarget.value)}
							onKeyDown={(event) => {
								if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
									event.preventDefault();
									saveDraft();
								}
							}}
							placeholder="Write a note linked to this artifact."
							rows={3}
						/>
					</label>
					<button type="button" className="notes-modal-primary" onClick={saveDraft} disabled={!draft.trim()}>
						<StickyNote size={14} aria-hidden />
						<span>Add note</span>
					</button>
					<section className="notes-modal-list" aria-label="Existing notes">
						<header>
							<strong>Existing notes</strong>
							<span>{targetNotes.length}</span>
						</header>
						{targetNotes.length ? targetNotes.map((note) => (
							<article className="notes-modal-row" key={note.id}>
								{editingId === note.id ? (
									<>
										<textarea value={editingContent} onChange={(event) => setEditingContent(event.currentTarget.value)} rows={3} />
										<div>
											<button type="button" onClick={() => setEditingId(null)}>Cancel</button>
											<button type="button" onClick={() => saveEdit(note)} disabled={!editingContent.trim()}>Save</button>
										</div>
									</>
								) : (
									<>
										<p>{note.content}</p>
										<div>
											<span>{formatShortDate(note.updatedAt)}</span>
											<button type="button" onClick={() => onPreview(note)}>Preview</button>
											<button type="button" onClick={() => {
												setEditingId(note.id);
												setEditingContent(note.content);
											}}>Edit</button>
											<button type="button" onClick={() => onRemove(note.id)}>Delete</button>
										</div>
									</>
								)}
							</article>
						)) : (
							<div className="panel-empty">No notes are linked to this artifact yet.</div>
						)}
					</section>
				</div>
			</section>
		</div>
	);
}

function NotePreviewModal({
	artifact,
	note,
	onClose,
	onOpenArtifact,
}: {
	artifact: WorkbenchArtifact | null;
	note: WorkbenchNoteRecord | null;
	onClose: () => void;
	onOpenArtifact: (artifactPath: string) => void;
}) {
	if (!note) return null;
	const targetName = artifact?.displayName || artifact?.title || artifact?.name || note.targetArtifactPath || note.targetFrameId || "Research context";
	const targetType = note.targetType === "artifact" ? "Artifact" : note.targetType === "message" ? "Message" : "Session";
	return (
		<div className="command-palette-backdrop note-preview-backdrop" role="presentation" onMouseDown={onClose}>
			<section
				aria-label="Note preview"
				aria-modal="true"
				className="note-preview-modal"
				role="dialog"
				onMouseDown={(event) => event.stopPropagation()}
			>
				<header className="note-preview-header">
					<div>
						<strong><StickyNote size={16} aria-hidden />Note preview</strong>
						<span>{targetType} / {targetName}</span>
					</div>
					<button type="button" aria-label="Close note preview" onClick={onClose}>
						<X size={15} aria-hidden />
					</button>
				</header>
				<div className="note-preview-body">
					<section className="note-preview-context" aria-label="Note target context">
						<div>
							<dt>Target</dt>
							<dd>{targetName}</dd>
						</div>
						{note.targetFrameId ? (
							<div>
								<dt>Session</dt>
								<dd>{note.targetFrameId}</dd>
							</div>
						) : null}
						{note.targetArtifactPath ? (
							<div>
								<dt>Artifact path</dt>
								<dd>{note.targetArtifactPath}</dd>
							</div>
						) : null}
						<div>
							<dt>Updated</dt>
							<dd>{formatShortDate(note.updatedAt)}</dd>
						</div>
					</section>
					<section className="note-preview-content" aria-label="Note content">
						<strong>Note</strong>
						<p>{note.content}</p>
					</section>
				</div>
				<footer className="note-preview-actions">
					<button type="button" onClick={onClose}>Close</button>
					{note.targetArtifactPath ? (
						<button type="button" onClick={() => onOpenArtifact(note.targetArtifactPath!)}>Open artifact</button>
					) : null}
				</footer>
			</section>
		</div>
	);
}

function OnboardingScreen({
	busy,
	draft,
	error,
	fileInputRef,
	files,
	onComplete,
	onFiles,
	onLauncher,
	onStep,
	onUpdate,
	step,
}: {
	busy: boolean;
	draft: OnboardingDraft;
	error: string | null;
	fileInputRef: RefObject<HTMLInputElement | null>;
	files: File[];
	onComplete: () => void;
	onFiles: (files: File[]) => void;
	onLauncher?: () => void;
	onStep: (step: number) => void;
	onUpdate: (patch: Partial<OnboardingDraft>) => void;
	step: number;
}) {
	const tasks = deriveOnboardingTasks(draft);
	const canContinue = (() => {
		if (step === 0) return Boolean(draft.field);
		if (step === 1) return Boolean(draft.goal && draft.workflow);
		if (step === 2) return draft.dataTools.length > 0;
		if (step === 3) return draft.bottlenecks.length > 0;
		return true;
	})();
	const stepTitle = [
		"What kind of science are we setting up?",
		"What should the first workbench optimize for?",
		"What material will Feynman work with?",
		"Where does the workflow get stuck?",
		"Add context, choose the first task, and grant setup scopes.",
	][step] ?? "Set up Feynman";
	return (
		<div className="entry-shell onboarding-shell">
			<input
				ref={fileInputRef}
				type="file"
				multiple
				hidden
				onChange={(event) => onFiles(Array.from(event.currentTarget.files ?? []))}
			/>
			<section className="entry-panel onboarding-panel">
				<div className="entry-brand">
					<div className="brand-mark"><Atom size={18} aria-hidden /></div>
					<div>
						<div className="brand-title">Feynman</div>
						<div className="brand-subtitle">Open science setup</div>
					</div>
					{onLauncher ? <button type="button" onClick={onLauncher}>Projects</button> : null}
				</div>
				<div className="onboarding-progress" aria-label="Setup progress">
					{[0, 1, 2, 3, 4].map((item) => <span key={item} className={cx(item <= step && "active")} />)}
				</div>
				<div className="onboarding-copy">
					<p className="eyebrow">Conversational setup</p>
					<h1>{stepTitle}</h1>
				</div>

				{step === 0 ? (
					<OptionGrid
						options={onboardingFieldOptions}
						selected={[draft.field]}
						onToggle={(value) => onUpdate({ field: value })}
					/>
				) : null}

				{step === 1 ? (
					<div className="onboarding-stack">
						<OptionGroup title="Primary goal">
							<OptionGrid
								options={onboardingGoalOptions}
								selected={[draft.goal]}
								onToggle={(value) => onUpdate({ goal: value })}
							/>
						</OptionGroup>
						<OptionGroup title="Daily workflow">
							<OptionGrid
								options={onboardingWorkflowOptions}
								selected={[draft.workflow]}
								onToggle={(value) => onUpdate({ workflow: value })}
							/>
						</OptionGroup>
					</div>
				) : null}

				{step === 2 ? (
					<OptionGrid
						multiple
						options={onboardingToolOptions}
						selected={draft.dataTools}
						onToggle={(value) => onUpdate({ dataTools: toggleListValue(draft.dataTools, value) })}
					/>
				) : null}

				{step === 3 ? (
					<OptionGrid
						multiple
						options={onboardingBottleneckOptions}
						selected={draft.bottlenecks}
						onToggle={(value) => onUpdate({ bottlenecks: toggleListValue(draft.bottlenecks, value) })}
					/>
				) : null}

				{step === 4 ? (
					<div className="onboarding-stack">
						<label className="onboarding-freeform">
							<span>Anything else to carry into the project?</span>
							<textarea
								value={draft.notes}
								onChange={(event) => onUpdate({ notes: event.target.value })}
								placeholder="Add constraints, preferred sources, organisms, datasets, methods, collaborators, or evaluation criteria."
							/>
						</label>
						<div className="file-drop-card">
							<div>
								<strong>Files for the first session</strong>
								<p>{files.length ? files.map((file) => file.name).join(", ") : "Drop in PDFs, data, code, or figures after setup."}</p>
							</div>
							<button type="button" onClick={() => fileInputRef.current?.click()}>
								<Upload size={15} aria-hidden />
								<span>{files.length ? "Change" : "Add files"}</span>
							</button>
						</div>
						<OptionGroup title="First research task">
							<div className="task-proposals">
								{tasks.map((task, index) => (
									<button
										type="button"
										key={task.title}
										className={cx("task-card", draft.selectedTaskIndex === index && "selected")}
										onClick={() => onUpdate({ selectedTaskIndex: index })}
									>
										<strong>{task.title}</strong>
										<span>{task.description}</span>
									</button>
								))}
							</div>
						</OptionGroup>
						<OptionGroup title="Setup scopes">
							<div className="permission-grid">
								{onboardingPermissionOptions.map((option) => (
									<button
										type="button"
										key={option.id}
										className={cx("permission-card", draft.permissions.includes(option.id) && "selected")}
										onClick={() => onUpdate({ permissions: toggleListValue(draft.permissions, option.id) })}
									>
										<strong>{option.title}</strong>
										<span>{option.description}</span>
									</button>
								))}
							</div>
						</OptionGroup>
					</div>
				) : null}

				{error ? <div className="inline-error">{error}</div> : null}
				<div className="onboarding-actions">
					<button type="button" onClick={() => onStep(Math.max(0, step - 1))} disabled={step === 0 || busy}>Back</button>
					{step < 4 ? (
						<button type="button" className="primary-action" onClick={() => onStep(Math.min(4, step + 1))} disabled={!canContinue || busy}>
							Continue
						</button>
					) : (
						<button type="button" className="primary-action" onClick={onComplete} disabled={busy}>
							{busy ? "Creating project" : "Start project"}
						</button>
					)}
				</div>
			</section>
		</div>
	);
}

function OptionGroup({ children, title }: { children: ReactNode; title: string }) {
	return (
		<section className="option-group">
			<h2>{title}</h2>
			{children}
		</section>
	);
}

function OptionGrid({
	multiple,
	onToggle,
	options,
	selected,
}: {
	multiple?: boolean;
	onToggle: (value: string) => void;
	options: string[];
	selected: string[];
}) {
	return (
		<div className={cx("option-grid", multiple && "multiple")}>
			{options.map((option) => (
				<button
					type="button"
					key={option}
					className={cx("option-card", selected.includes(option) && "selected")}
					onClick={() => onToggle(option)}
				>
					<span>{option}</span>
				</button>
			))}
		</div>
	);
}

function ProjectLauncher({
	onNewSetup,
	onOpenProject,
	onSearch,
	state,
}: {
	onNewSetup: () => void;
	onOpenProject: (project: WorkbenchProject, run?: WorkbenchRun, artifactPath?: string) => void;
	onSearch: () => void;
	state: WorkbenchState;
}) {
	const customProjects = state.projects.filter((project) => project.kind === "custom");
	const primaryProjects = customProjects.length ? customProjects : state.projects.slice(0, 4);
	const queueItems = launcherQueueItems(state);
	const recentRuns = recentRunsForLauncher(state);
	const seeds = launcherSeedCards(state);
	return (
		<div className="entry-shell launcher-shell">
			<section className="launcher-panel">
				<header className="launcher-header">
					<div className="entry-brand">
						<div className="brand-mark"><Atom size={18} aria-hidden /></div>
						<div>
							<div className="brand-title">Feynman</div>
							<div className="brand-subtitle">Open science workbench</div>
						</div>
					</div>
					<div className="launcher-header-actions">
						<button type="button" onClick={onSearch}>
							<Search size={16} aria-hidden />
							<span>Search</span>
							<kbd>⌘K</kbd>
						</button>
						<button type="button" className="primary-action" onClick={onNewSetup}>
							<Plus size={16} aria-hidden />
							<span>New project</span>
						</button>
					</div>
				</header>

				<section className="launcher-section launcher-queue-section">
					<div className="launcher-section-heading">
						<p className="eyebrow">Research queue</p>
						<span>{queueItems.length}</span>
					</div>
					<div className="launcher-queue">
						{queueItems.map((item) => (
							<button
								type="button"
								key={`${item.tone}:${item.project.id}:${item.run.slug}:${item.title}:${item.artifactPath ?? ""}`}
								className={`launcher-queue-card ${item.tone}`}
								onClick={() => onOpenProject(item.project, item.run, item.artifactPath)}
							>
								<span className="launcher-queue-icon" aria-hidden>
									{item.tone === "needs_input" ? <PanelRightOpen size={15} /> : item.tone === "running" ? <Play size={15} /> : <CheckCircle2 size={15} />}
								</span>
								<span className="launcher-queue-copy">
									<strong>{item.title}</strong>
									<span>{item.description}</span>
								</span>
								<span className="launcher-queue-badge">{item.badge}</span>
							</button>
						))}
						{!queueItems.length ? (
							<div className="launcher-queue-card complete">
								<span className="launcher-queue-icon" aria-hidden><CheckCircle2 size={15} /></span>
								<span className="launcher-queue-copy">
									<strong>All caught up</strong>
									<span>No plans, compute jobs, or session messages need attention.</span>
								</span>
								<span className="launcher-queue-badge">Clear</span>
							</div>
						) : null}
					</div>
				</section>

				<section className="launcher-section">
					<div className="launcher-section-heading">
						<p className="eyebrow">Projects</p>
						<span>{state.projects.length}</span>
					</div>
					<div className="project-grid">
						{primaryProjects.map((project) => {
							const run = primaryRunForProject(state, project);
							return (
								<button type="button" key={project.id} className="launcher-project-card" onClick={() => onOpenProject(project, run)}>
									<strong>{project.name}</strong>
									<span>{project.description}</span>
									<small>{project.sessionCount} sessions / {project.artifactCount} artifacts / {formatShortDate(project.updatedAt)}</small>
								</button>
							);
						})}
					</div>
				</section>

				<section className="launcher-columns">
					<div className="launcher-section">
						<div className="launcher-section-heading">
							<p className="eyebrow">Recent work</p>
							<span>{recentRuns.length}</span>
						</div>
						<div className="launcher-list">
							{recentRuns.map((run) => {
								const runProject = state.projects.find((project) => project.id === run.projectId)
									?? state.projects.find((project) => project.runSlugs.includes(run.slug))
									?? state.projects[0];
								return (
									<button type="button" key={run.slug} onClick={() => onOpenProject(runProject, run)}>
										<strong>{run.title}</strong>
										<span>{runStatusLabel(run)} / {formatShortDate(run.updatedAt)}</span>
									</button>
								);
							})}
						</div>
					</div>
					<div className="launcher-section">
						<div className="launcher-section-heading">
							<p className="eyebrow">Seed workflows</p>
							<span>{seeds.length}</span>
						</div>
						<div className="launcher-list seed-list">
							{seeds.map((seed) => (
								<div key={seed}>
									<strong>{seed.split(":")[0]}</strong>
									<span>{seed.includes(":") ? seed.slice(seed.indexOf(":") + 1).trim() : seed}</span>
								</div>
							))}
							{!seeds.length ? <div><strong>No seed workflows found</strong><span>Feynman loads packaged open-science fixtures into workspace outputs on serve.</span></div> : null}
						</div>
					</div>
				</section>
			</section>
		</div>
	);
}

function GlobalCommandPalette({
	onClose,
	onSelect,
	open,
	state,
}: {
	onClose: () => void;
	onSelect: (item: CommandPaletteItem) => void;
	open: boolean;
	state: WorkbenchState;
}) {
	const [query, setQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const groups = useMemo(() => commandPaletteGroups(state, query), [state, query]);
	const items = useMemo(() => commandPaletteFlatItems(groups), [groups]);

	useEffect(() => {
		if (!open) return;
		setQuery("");
		setActiveIndex(0);
		window.requestAnimationFrame(() => inputRef.current?.focus());
	}, [open]);

	useEffect(() => {
		setActiveIndex((current) => Math.min(current, Math.max(0, items.length - 1)));
	}, [items.length]);

	if (!open) return null;

	function choose(item: CommandPaletteItem | undefined) {
		if (!item) return;
		onSelect(item);
	}

	function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			setActiveIndex((current) => Math.min(current + 1, items.length - 1));
			return;
		}
		if (event.key === "ArrowUp") {
			event.preventDefault();
			setActiveIndex((current) => Math.max(current - 1, 0));
			return;
		}
		if (event.key === "Home") {
			event.preventDefault();
			setActiveIndex(0);
			return;
		}
		if (event.key === "End") {
			event.preventDefault();
			setActiveIndex(Math.max(0, items.length - 1));
			return;
		}
		if (event.key === "Enter") {
			event.preventDefault();
			choose(items[activeIndex]);
			return;
		}
		if (event.key === "Escape") onClose();
	}

	let rowIndex = 0;
	return (
		<div className="command-palette-backdrop" role="presentation" onMouseDown={onClose}>
			<section
				aria-label="Search projects, artifacts, and sessions"
				aria-modal="true"
				className="command-palette"
				data-testid="global-command-palette"
				role="dialog"
				onMouseDown={(event) => event.stopPropagation()}
			>
				<header className="command-palette-header">
					<Search size={17} aria-hidden />
					<input
						ref={inputRef}
						aria-label="Search projects, artifacts, and sessions"
						placeholder="Search projects, artifacts, sessions…"
						value={query}
						onChange={(event) => {
							setQuery(event.currentTarget.value);
							setActiveIndex(0);
						}}
						onKeyDown={handleKeyDown}
					/>
					<button type="button" aria-label="Close search" onClick={onClose}>
						<X size={16} aria-hidden />
					</button>
				</header>
				<div className="command-palette-list" role="listbox" aria-label="Search results">
					{groups.length ? groups.map((group) => (
						<div className="command-palette-group" key={group.label} role="presentation">
							<div className="command-palette-group-label">{group.label}</div>
							{group.items.map((item) => {
								const index = rowIndex++;
								const selected = index === activeIndex;
								return (
									<button
										type="button"
										key={item.id}
										className={cx("command-palette-row", selected && "selected")}
										role="option"
										aria-selected={selected}
										onMouseEnter={() => setActiveIndex(index)}
										onClick={() => choose(item)}
									>
										<span className="command-palette-icon" aria-hidden>
											{item.kind === "artifact" ? <FileText size={16} /> : item.kind === "session" ? <Hash size={16} /> : item.kind === "new-project" ? <Plus size={16} /> : <Atom size={16} />}
										</span>
										<span className="command-palette-copy">
											<strong>{item.label}</strong>
											<small>{item.sublabel}</small>
										</span>
										<span className="command-palette-meta">
											{item.kind === "artifact" ? item.artifact.extension.toUpperCase() : item.kind === "session" ? "Session" : item.kind === "project" ? "Project" : "Create"}
										</span>
									</button>
								);
							})}
						</div>
					)) : (
						<div className="command-palette-empty">
							<strong>No matches</strong>
							<span>Search across Feynman projects, sessions, and artifacts.</span>
						</div>
					)}
				</div>
				<footer className="command-palette-footer">
					<span>Search</span>
					<kbd>esc</kbd>
				</footer>
			</section>
		</div>
	);
}

function ToolEvents({
	events,
	groups,
	onOpenPermissions,
	onPermissionDecision,
	onRetryApproval,
}: {
	events: WorkbenchToolEvent[];
	groups: WorkbenchResourceGroup[];
	onOpenPermissions: () => void;
	onPermissionDecision: (approval: ConnectorApprovalView, decision: ConnectorApprovalDecision, target: "connector" | "tool") => void;
	onRetryApproval: (activity: ToolActivityView) => void;
}) {
	if (!events.length) return null;
	const activity = toolActivityViews(events, groups, 6);
	const countChips = [
		activity.counts.approval ? `${activity.counts.approval} approval` : "",
		activity.counts.running ? `${activity.counts.running} running` : "",
		activity.counts.error ? `${activity.counts.error} error` : "",
		activity.counts.complete ? `${activity.counts.complete} complete` : "",
	].filter(Boolean);
	return (
		<div className="tool-list" data-testid="tool-activity-list">
			<div className="tool-list-header">
				<span>Research activity</span>
				<div>
					{countChips.length ? countChips.map((chip) => <em key={chip}>{chip}</em>) : <em>{activity.counts.total} events</em>}
				</div>
			</div>
			{activity.visible.map((event) => (
				<ToolActivityCard
					key={event.id}
					event={event}
					onOpenPermissions={onOpenPermissions}
					onPermissionDecision={onPermissionDecision}
					onRetryApproval={onRetryApproval}
				/>
			))}
			{activity.hiddenCount ? <div className="tool-more">{activity.hiddenCount} more tool events</div> : null}
		</div>
	);
}

function ToolActivityCard({
	event,
	onOpenPermissions,
	onPermissionDecision,
	onRetryApproval,
}: {
	event: ToolActivityView;
	onOpenPermissions: () => void;
	onPermissionDecision: (approval: ConnectorApprovalView, decision: ConnectorApprovalDecision, target: "connector" | "tool") => void;
	onRetryApproval: (activity: ToolActivityView) => void;
}) {
	const approval = event.approval;
	return (
		<section className={cx("tool-card", event.tone)} data-testid={`tool-activity-${event.tone}`}>
			<div className="tool-card-header">
				<div className="tool-card-title">
					<ToolActivityIcon tone={event.tone} />
					<div>
						<strong>{event.title}</strong>
						{event.toolName && event.toolName !== event.title ? <span>{event.toolName}</span> : null}
					</div>
				</div>
				<span className="tool-status-pill">{event.statusLabel}</span>
			</div>
			{event.summary ? <p className="tool-card-summary">{event.summary}</p> : null}
			{approval ? (
				<div className="tool-approval-callout" data-testid="chat-connector-approval-card">
					<div>
						<strong>{approval.connectorName}: use {approval.toolName}?</strong>
						<span>{approval.description}</span>
						<code>{approval.scope}</code>
					</div>
					{approval.decision === "ask" ? (
						<div className="tool-approval-actions">
							<button type="button" onClick={() => onPermissionDecision(approval, "allow", "tool")}>Allow tool</button>
							<button type="button" onClick={() => onPermissionDecision(approval, "deny", "tool")}>Block</button>
							<button type="button" onClick={() => onPermissionDecision(approval, "allow", "connector")}>Allow connector</button>
							<button type="button" onClick={onOpenPermissions}>Open Permissions</button>
						</div>
					) : (
						<div className="tool-approval-actions">
							{approval.decision === "allow" ? (
								<button type="button" onClick={() => onRetryApproval(event)}>Retry approved tool</button>
							) : null}
							<button type="button" onClick={onOpenPermissions}>Open Permissions</button>
						</div>
					)}
				</div>
			) : null}
			{event.input || event.output || event.details ? (
				<details className="tool-card-details">
					<summary>Tool payload</summary>
					{event.input ? <pre><strong>Input</strong>{`\n${event.input}`}</pre> : null}
					{event.output ? <pre><strong>Output</strong>{`\n${event.output}`}</pre> : null}
					{event.details ? <pre><strong>Details</strong>{`\n${event.details}`}</pre> : null}
				</details>
			) : null}
		</section>
	);
}

function ToolActivityIcon({ tone }: { tone: ToolActivityTone }) {
	if (tone === "approval") return <Settings size={14} aria-hidden />;
	if (tone === "running" || tone === "queued") return <Play size={14} aria-hidden />;
	if (tone === "error" || tone === "stopped") return <X size={14} aria-hidden />;
	if (tone === "complete") return <Bot size={14} aria-hidden />;
	return <Database size={14} aria-hidden />;
}

function PanelScroll({ children }: { children: ReactNode }) {
	return (
		<ScrollArea.Root className="panel-scroll" type="hover">
			<ScrollArea.Viewport className="panel-scroll-viewport">
				{children}
			</ScrollArea.Viewport>
			<ScrollArea.Scrollbar className="panel-scrollbar" orientation="vertical">
				<ScrollArea.Thumb className="panel-scroll-thumb" />
			</ScrollArea.Scrollbar>
		</ScrollArea.Root>
	);
}

function NotebookPanel({
	code,
	environmentGroups,
	environmentBusy,
	environmentLanguage,
	environmentMode,
	environmentPackages,
	environmentResult,
	executionMode,
	kernels,
	language,
	notebookCells,
	onCode,
	onEnvironmentLanguage,
	onEnvironmentMode,
	onEnvironmentPackages,
	onEnvironmentRun,
	onExecutionMode,
	onLanguage,
	onPurpose,
	onRun,
	onStop,
	purpose,
	result,
	running,
}: {
	code: string;
	environmentGroups: Record<string, WorkbenchNotebookEnvironmentRecord[]>;
	environmentBusy: boolean;
	environmentLanguage: NotebookEnvironmentLanguage;
	environmentMode: NotebookEnvironmentMode;
	environmentPackages: string;
	environmentResult: NotebookEnvironmentActionResult | null;
	executionMode: NotebookExecutionMode;
	kernels: WorkbenchNotebookKernelRecord[];
	language: NotebookLanguage;
	notebookCells: WorkbenchNotebookCell[];
	onCode: (code: string) => void;
	onEnvironmentLanguage: (language: NotebookEnvironmentLanguage) => void;
	onEnvironmentMode: (mode: NotebookEnvironmentMode) => void;
	onEnvironmentPackages: (packages: string) => void;
	onEnvironmentRun: () => void;
	onExecutionMode: (mode: NotebookExecutionMode) => void;
	onLanguage: (language: NotebookLanguage) => void;
	onPurpose: (purpose: NotebookPurpose) => void;
	onRun: () => void;
	onStop: () => void;
	purpose: NotebookPurpose;
	result: NotebookExecutionResult | null;
	running: boolean;
}) {
	const environments = Object.entries(environmentGroups).sort(([left], [right]) => left.localeCompare(right));
	const requestedPackages = normalizeNotebookPackageInput(environmentPackages);
	const environmentButtonLabel = notebookEnvironmentActionLabel(environmentMode, environmentLanguage, requestedPackages);
	return (
		<PanelScroll>
			<div className="panel-body science-panel notebook-panel">
				<Tabs.Root defaultValue="run" className="radix-tabs">
					<Tabs.List className="radix-tab-list" aria-label="Notebook view">
						<Tabs.Trigger value="run">Run</Tabs.Trigger>
						<Tabs.Trigger value="history">History</Tabs.Trigger>
						<Tabs.Trigger value="env">Env</Tabs.Trigger>
					</Tabs.List>
					<Tabs.Content value="run" className="radix-tab-content">
						<div className="control-stack">
							<div className="segmented-control" aria-label="Notebook language">
								{(["python", "r", "bash"] as NotebookLanguage[]).map((item) => (
									<button type="button" key={item} className={cx(language === item && "active")} onClick={() => onLanguage(item)}>
										{item}
									</button>
								))}
							</div>
							<div className="segmented-control" aria-label="Execution mode">
								{(["session", "isolated", "modal"] as NotebookExecutionMode[]).map((item) => (
									<button
										type="button"
										key={item}
										className={cx(executionMode === item && "active")}
										disabled={item === "modal" && language !== "python"}
										onClick={() => onExecutionMode(item)}
									>
										{item}
									</button>
								))}
							</div>
							<div className="segmented-control" aria-label="Notebook purpose">
								{(["exploration", "verification"] as NotebookPurpose[]).map((item) => (
									<button type="button" key={item} className={cx(purpose === item && "active")} onClick={() => onPurpose(item)}>
										{item}
									</button>
								))}
							</div>
						</div>
						<textarea
							className="notebook-code"
							value={code}
							onChange={(event) => onCode(event.target.value)}
							spellCheck={false}
							aria-label="Notebook code"
						/>
						<div className="panel-action-row">
							<div className="panel-action-buttons">
								<button type="button" onClick={onRun} disabled={running || !code.trim()}>
									<Play size={14} aria-hidden />
									<span>{running ? "Running" : "Run cell"}</span>
								</button>
								{running ? (
									<button type="button" className="secondary-action" onClick={onStop}>
										<X size={14} aria-hidden />
										<span>Stop</span>
									</button>
								) : null}
							</div>
							<span>{executionMode === "session" ? "persistent kernel" : executionMode === "modal" ? "cloud job" : "isolated process"}</span>
						</div>
						<NotebookResult result={result} />
					</Tabs.Content>
					<Tabs.Content value="history" className="radix-tab-content">
						<div className="resource-list compact-list">
							{notebookCells.map((cell) => (
								<div className="science-row" key={cell.id}>
									<FileText size={15} aria-hidden />
									<span>
										<strong>{cell.title}</strong>
										<small>{cell.language} / {cell.category} / {formatShortDate(cell.updatedAt)}</small>
									</span>
								</div>
							))}
							{!notebookCells.length ? <div className="panel-empty">No notebook cells are recorded for this frame yet.</div> : null}
						</div>
					</Tabs.Content>
					<Tabs.Content value="env" className="radix-tab-content">
						<div className="environment-manager">
							<header>
								<strong>Managed environment</strong>
								<span>Python venv and R library inside this Feynman workspace.</span>
							</header>
							<div className="control-stack">
								<div className="segmented-control" aria-label="Environment language">
									{notebookEnvironmentLanguages().map((item) => (
										<button type="button" key={item} className={cx(environmentLanguage === item && "active")} onClick={() => onEnvironmentLanguage(item)}>
											{item}
										</button>
									))}
								</div>
								<div className="segmented-control" aria-label="Environment action">
									{(["create", "install"] as NotebookEnvironmentMode[]).map((item) => (
										<button type="button" key={item} className={cx(environmentMode === item && "active")} onClick={() => onEnvironmentMode(item)}>
											{item}
										</button>
									))}
								</div>
								<input
									className="managed-package-input"
									value={environmentPackages}
									onChange={(event) => onEnvironmentPackages(event.target.value)}
									placeholder={environmentLanguage === "python" ? "scanpy pandas numpy" : "Seurat ggplot2"}
									aria-label="Managed environment packages"
								/>
							</div>
							<div className="panel-action-row">
								<button type="button" onClick={onEnvironmentRun} disabled={environmentBusy}>
									<Plus size={14} aria-hidden />
									<span>{environmentBusy ? "Working" : environmentButtonLabel}</span>
								</button>
								<span>{requestedPackages.length ? requestedPackages.join(", ") : "no packages selected"}</span>
							</div>
							{environmentResult ? (
								<div className={cx("environment-result", environmentResult.status)}>
									<header>
										<strong>{environmentResult.environmentName}</strong>
										<span>{environmentResult.status} / {environmentResult.durationMs}ms</span>
									</header>
									<small>{environmentResult.command}</small>
									{environmentResult.stdout ? <pre>{environmentResult.stdout}</pre> : null}
									{environmentResult.stderr ? <pre className="error">{environmentResult.stderr}</pre> : null}
								</div>
							) : null}
						</div>
						<ProvenanceSection title="Session kernels" empty="No active or recorded kernels for this frame.">
							{kernels.map((kernel) => (
								<div className="science-row" key={kernel.id}>
									<Database size={15} aria-hidden />
									<span>
										<strong>{kernel.language} / {kernel.status}</strong>
										<small>{kernel.detail} / {kernel.executionCount} executions</small>
									</span>
								</div>
							))}
						</ProvenanceSection>
						<ProvenanceSection title="Environments" empty="No notebook environments were detected.">
							{environments.flatMap(([envLanguage, records]) => records.map((environment) => (
								<div className="science-row" key={environment.id}>
									<Layers size={15} aria-hidden />
									<span>
										<strong>{environment.name || envLanguage}</strong>
										<small>{environment.status} / {environment.executionModes.join(", ")} / {environment.detail}</small>
									</span>
								</div>
							)))}
						</ProvenanceSection>
					</Tabs.Content>
				</Tabs.Root>
			</div>
		</PanelScroll>
	);
}

function NotebookResult({ result }: { result: NotebookExecutionResult | null }) {
	if (!result) return <div className="panel-empty">Notebook output appears here after a cell runs.</div>;
	return (
		<div className={cx("notebook-result", result.status)}>
			<header>
				<strong>{result.status}</strong>
				<span>{result.language} / {result.executionMode} / {result.durationMs}ms</span>
			</header>
			{result.stdout ? <pre>{result.stdout}</pre> : null}
			{result.stderr || result.error ? <pre className="error">{result.stderr || result.error}</pre> : null}
			{result.outputPaths?.length ? (
				<div className="resource-tags">
					{result.outputPaths.slice(0, 6).map((path) => <span key={path}>{path}</span>)}
				</div>
			) : null}
		</div>
	);
}

function ComputePanel({
	busyJobId,
	busyProviderId,
	jobs,
	onAction,
	onProviderAction,
	providers,
}: {
	busyJobId: string | null;
	busyProviderId: string | null;
	jobs: WorkbenchComputeJobRecord[];
	onAction: (job: WorkbenchComputeJobRecord, action: ComputeJobAction) => void;
	onProviderAction: (provider: WorkbenchComputeProvider, action: ComputeProviderAction) => void;
	providers: WorkbenchComputeProvider[];
}) {
	return (
		<PanelScroll>
			<div className="panel-body science-panel compute-panel">
				<Tabs.Root defaultValue="jobs" className="radix-tabs">
					<Tabs.List className="radix-tab-list" aria-label="Compute view">
						<Tabs.Trigger value="jobs">Jobs</Tabs.Trigger>
						<Tabs.Trigger value="providers">Providers</Tabs.Trigger>
					</Tabs.List>
					<Tabs.Content value="jobs" className="radix-tab-content">
						<div className="resource-list compact-list">
							{jobs.map((job) => {
								const action = computeJobAction(job);
								return (
									<div className="compute-job-row" key={job.id}>
										<div className="science-row">
											<Database size={15} aria-hidden />
											<span>
												<strong>{job.title}</strong>
												<small>{job.providerName} / {job.status} / {job.language} / {formatShortDate(job.startedAt)}</small>
											</span>
										</div>
										<p>{job.detail}</p>
										{job.error ? <pre className="code-snippet">{job.error}</pre> : null}
										<div className="panel-action-row">
											{job.remoteUrl ? <a href={job.remoteUrl}>Open remote</a> : <span>{job.tierType}</span>}
											{action ? (
												<button type="button" onClick={() => onAction(job, action)} disabled={busyJobId === job.id}>
													{busyJobId === job.id ? "Working" : action === "retry" ? "Retry" : "Stop"}
												</button>
											) : null}
										</div>
									</div>
								);
							})}
							{!jobs.length ? <div className="panel-empty">Run a notebook cell to create a compute job record.</div> : null}
						</div>
					</Tabs.Content>
					<Tabs.Content value="providers" className="radix-tab-content">
						<div className="resource-list compact-list">
							{providers.map((provider) => (
								<div className="compute-job-row compute-provider-row" key={provider.id}>
									<div className="science-row">
										<Database size={15} aria-hidden />
										<span>
											<strong>{provider.name}</strong>
											<small>{provider.enabled ? "enabled" : "disabled"} / {provider.status} / {provider.family} / {provider.tierType}</small>
										</span>
									</div>
									<p>{provider.description}</p>
									{provider.detail ? <small className="provider-detail">{provider.detail}</small> : null}
									{provider.capabilities.length ? (
										<div className="resource-tags">
											{provider.capabilities.slice(0, 8).map((capability) => <span key={capability}>{capability}</span>)}
										</div>
									) : null}
									{provider.tools?.length ? (
										<div className="resource-tags">
											{provider.tools.slice(0, 4).map((tool) => <span key={tool.name}>{tool.name}</span>)}
										</div>
									) : null}
									{provider.diagnostics?.length ? (
										<ul className="provider-diagnostics">
											{provider.diagnostics.slice(0, 3).map((item) => <li key={item}>{item}</li>)}
										</ul>
									) : null}
									<div className="panel-action-row">
										<span>{provider.checked ? "Session enabled" : "Session disabled"}</span>
										{provider.actions?.map((action) => (
											<button
												type="button"
												key={action.id}
												onClick={() => onProviderAction(provider, action.id)}
												disabled={action.disabled || busyProviderId === provider.id}
											>
												{busyProviderId === provider.id ? "Working" : action.label}
											</button>
										))}
									</div>
								</div>
							))}
							{!providers.length ? <div className="panel-empty">No compute providers were detected.</div> : null}
						</div>
					</Tabs.Content>
				</Tabs.Root>
			</div>
		</PanelScroll>
	);
}

function FilesPanel({
	actions,
	artifacts,
	artifactTab,
	category,
	categoryCounts,
	editState,
	filePreview,
	filteredUploads,
	hostId,
	hosts,
	onArtifactTab,
	onCategory,
	onEditCancel,
	onEditDraft,
	onEditOpen,
	onEditSave,
	onMoleculeSave,
	onHost,
	onImport,
	onOpenOverlay,
	onPlanAction,
	onPlanStep,
	onQuery,
	onSelect,
	onScope,
	onUploadDownloadUrl,
	onUploadRemove,
	onUploadSelect,
	onVersionDiff,
	onVersionRestore,
	query,
	refinement,
	scope,
	scopeCounts,
	selectedArtifact,
	selectedPlan,
	selectedPath,
	selectedUpload,
	state,
	uploading,
	versionDiffs,
	versionStatuses,
}: {
	actions: ArtifactActionControls;
	artifacts: WorkbenchArtifact[];
	artifactTab: "preview" | "provenance";
	category: FileCategoryFilter;
	categoryCounts: ReturnType<typeof artifactCategoryCounts>;
	editState: ArtifactEditState | null;
	filePreview: FilePreview | null;
	filteredUploads: WorkbenchUpload[];
	hostId: string;
	hosts: FileHostOption[];
	onArtifactTab: (tab: "preview" | "provenance") => void;
	onCategory: (category: FileCategoryFilter) => void;
	onEditCancel: () => void;
	onEditDraft: (draft: string) => void;
	onEditOpen: (artifact: WorkbenchArtifact) => void;
	onEditSave: () => void;
	onMoleculeSave: (artifact: WorkbenchArtifact, content: string) => Promise<void>;
	onHost: (hostId: string) => void;
	onImport: () => void;
	onOpenOverlay: () => void;
	onPlanAction: (plan: WorkbenchGeneratedPlan, action: WorkbenchPlanAction) => void;
	onPlanStep: (plan: WorkbenchGeneratedPlan, stepTitle: string, status: WorkbenchPlanStepStatus) => void;
	onQuery: (query: string) => void;
	onSelect: (path: string) => void;
	onScope: (scope: FileBrowserScope) => void;
	onUploadDownloadUrl: (upload: WorkbenchUpload) => string;
	onUploadRemove: (uploadId: string) => void;
	onUploadSelect: (uploadId: string) => void;
	onVersionDiff: (version: WorkbenchArtifactVersion) => void;
	onVersionRestore: (version: WorkbenchArtifactVersion) => void;
	query: string;
	refinement: ArtifactRefinementControls;
	scope: FileBrowserScope;
	scopeCounts: ReturnType<typeof fileScopeCounts>;
	selectedArtifact: WorkbenchArtifact | null;
	selectedPlan: WorkbenchGeneratedPlan | null;
	selectedPath: string | null;
	selectedUpload: WorkbenchUpload | null;
	state: WorkbenchState | null;
	uploading: boolean;
	versionDiffs: Record<string, VersionDiffState>;
	versionStatuses: Record<string, string>;
}) {
	return (
		<div className="panel-body files-panel">
			<div className="files-toolbar">
				<button type="button" onClick={onImport} disabled={uploading}>
					<Upload size={14} aria-hidden />
					<span>{uploading ? "Importing" : "Import"}</span>
				</button>
				<button type="button" onClick={onOpenOverlay}>
					<FolderOpen size={14} aria-hidden />
					<span>Browse</span>
				</button>
			</div>
			<label className="search-box">
				<Search size={15} aria-hidden />
				<input
					value={query}
					onChange={(event) => onQuery(event.target.value)}
					placeholder="Search artifacts"
					/>
				</label>
				<FileHostStrip hostId={hostId} hosts={hosts} onHost={onHost} />
				<div className="file-scope-tabs" role="tablist" aria-label="File scope">
					{scopeCounts.map((item) => (
						<button
							type="button"
							key={item.scope}
							className={cx(scope === item.scope && "active")}
							onClick={() => onScope(item.scope)}
						>
							<span>{fileScopeLabel(item.scope)}</span>
							<small>{item.count}</small>
						</button>
					))}
				</div>
				<div className="file-category-strip" aria-label="Artifact categories">
					<button type="button" className={cx(category === "all" && "active")} onClick={() => onCategory("all")}>
						All
					</button>
					{categoryCounts.map((item) => (
						<button
							type="button"
							key={item.category}
							className={cx(category === item.category && "active")}
							onClick={() => onCategory(item.category)}
						>
							<span>{item.category}</span>
							<small>{item.count}</small>
						</button>
					))}
				</div>
				<div className="artifact-list">
					{filteredUploads.length ? (
						<div className="upload-section-label">Uploads</div>
					) : null}
					{filteredUploads.map((upload) => (
						<UploadRow
							key={upload.id}
							downloadUrl={onUploadDownloadUrl(upload)}
							selected={selectedUpload?.id === upload.id}
							upload={upload}
							onRemove={onUploadRemove}
							onSelect={onUploadSelect}
						/>
					))}
					{filteredUploads.length ? (
						<div className="upload-section-label">Artifacts</div>
					) : null}
					{artifacts.map((artifact) => (
					<button
						type="button"
						key={artifact.path}
						className={cx("artifact-row", selectedPath === artifact.path && "selected")}
						onClick={() => onSelect(artifact.path)}
					>
							<FileText size={15} aria-hidden />
							<span>
								<strong>{artifact.displayName || artifact.title || artifact.name}</strong>
								<small>{artifact.category} / {artifact.slug} / {formatShortDate(artifact.updatedAt)}</small>
							</span>
						</button>
					))}
					<ArtifactRecoveryList
						actions={actions}
						items={state?.artifactActions ?? []}
					/>
						{!artifacts.length && !filteredUploads.length && !state?.artifactActions.length ? <div className="panel-empty">No files match the selected scope and filters.</div> : null}
				</div>
				{selectedUpload ? (
					<UploadPreview
						downloadUrl={onUploadDownloadUrl(selectedUpload)}
						upload={selectedUpload}
						onRemove={onUploadRemove}
					/>
				) : (
					<ArtifactViewer
						actions={actions}
						artifact={selectedArtifact}
						editState={editState}
						filePreview={filePreview}
						previewTab={artifactTab}
						refinement={refinement}
						selectedPlan={selectedPlan}
						state={state}
						versionDiffs={versionDiffs}
						versionStatuses={versionStatuses}
						onEditCancel={onEditCancel}
						onEditDraft={onEditDraft}
						onEditOpen={onEditOpen}
						onEditSave={onEditSave}
						onMoleculeSave={onMoleculeSave}
						onPlanAction={onPlanAction}
						onPlanStep={onPlanStep}
						onPreviewTab={onArtifactTab}
						onVersionDiff={onVersionDiff}
						onVersionRestore={onVersionRestore}
						/>
				)}
				</div>
	);
}

function GeneratedArtifactsBlock({
	artifacts,
	clientToken,
	onSelect,
}: {
	artifacts: WorkbenchArtifact[];
	clientToken: string | null;
	onSelect: (artifact: WorkbenchArtifact) => void;
}) {
	const generatedArtifacts = artifacts
		.filter((artifact) => !artifact.hidden)
		.sort((left, right) => artifactTileRank(left) - artifactTileRank(right) || (right.updatedAtMs ?? 0) - (left.updatedAtMs ?? 0))
		.slice(0, 8);
	return (
		<div className="generated-artifacts-block">
			<div className="generated-artifacts-heading">
				<span>Generated</span>
				<strong>{artifacts.length}</strong>
			</div>
			<div className="generated-artifacts-grid">
				{generatedArtifacts.map((artifact) => (
					<button type="button" key={artifact.path} className="generated-artifact-tile" onClick={() => onSelect(artifact)}>
						<ArtifactTilePreview artifact={artifact} clientToken={clientToken} />
						<span className="generated-artifact-title">{artifact.displayName || artifact.title || artifact.name}</span>
						<span className="generated-artifact-meta">{artifact.category} / {artifact.extension || "file"}</span>
					</button>
				))}
			</div>
			{artifacts.length > generatedArtifacts.length ? (
				<div className="generated-artifacts-more">{artifacts.length - generatedArtifacts.length} more in Files</div>
			) : null}
		</div>
	);
}

function ArtifactTilePreview({ artifact, clientToken }: { artifact: WorkbenchArtifact; clientToken: string | null }) {
	if (isImageArtifact(artifact)) {
		return (
			<span className="generated-artifact-preview image">
				<img src={artifactTileDownloadUrl(artifact.path, clientToken)} alt="" loading="lazy" />
			</span>
		);
	}
	const kind = artifactPreviewKind(artifact);
	const Icon = kind === "spreadsheet" ? Table2 : kind === "image" ? ImageIcon : kind === "json" ? FileJson : kind === "audio" || kind === "video" ? Play : FileText;
	return (
		<span className="generated-artifact-preview">
			<Icon size={28} aria-hidden />
			<small>{artifact.extension || artifact.category}</small>
		</span>
	);
}

function artifactTileDownloadUrl(path: string, clientToken: string | null): string {
	const params = new URLSearchParams({ path });
	if (clientToken) params.set("token", clientToken);
	return `/api/file/download?${params.toString()}`;
}

function isImageArtifact(artifact: WorkbenchArtifact): boolean {
	const contentType = (artifact.contentType || "").toLowerCase();
	const extension = (artifact.extension || artifact.name.split(".").pop() || "").toLowerCase();
	return contentType.startsWith("image/") || ["apng", "avif", "gif", "jpg", "jpeg", "png", "svg", "webp"].includes(extension);
}

function artifactTileRank(artifact: WorkbenchArtifact): number {
	if (artifact.category === "output") return 0;
	if (artifact.category === "visual" || isImageArtifact(artifact)) return 1;
	if (artifact.category === "data") return 2;
	return 3;
}

function ArtifactRecoveryList({
	actions,
	items,
}: {
	actions: ArtifactActionControls;
	items: WorkbenchArtifactActionItem[];
}) {
	if (!items.length) return null;
	return (
		<div className="artifact-recovery-list" aria-label="Hidden and deleted artifacts">
			<div className="upload-section-label">Hidden / trash</div>
			{items.slice(0, 6).map((item) => {
				const action = artifactRecoveryAction(item);
				const busy = actions.busyKey === `${item.artifactPath}:${action}`;
				return (
					<div className="artifact-recovery-row" key={`${item.status}-${item.artifactPath}`}>
						<div>
							<strong>{item.title}</strong>
							<small>{item.status} / {item.artifactPath}</small>
						</div>
						<button type="button" onClick={() => actions.onRecover(item)} disabled={busy}>
							<RotateCcw size={13} aria-hidden />
							<span>{busy ? "Working" : artifactRecoveryLabel(item)}</span>
						</button>
					</div>
				);
			})}
		</div>
	);
}

function UploadRow({
	downloadUrl,
	onRemove,
	onSelect,
	selected,
	upload,
}: {
	downloadUrl: string;
	onRemove: (uploadId: string) => void;
	onSelect: (uploadId: string) => void;
	selected: boolean;
	upload: WorkbenchUpload;
}) {
	return (
		<div className={cx("artifact-row upload-row", selected && "selected")}>
			<button type="button" onClick={() => onSelect(upload.id)}>
				<Upload size={15} aria-hidden />
				<span>
					<strong>{upload.name}</strong>
					<small>{upload.contentType} / {formatBytes(upload.sizeBytes)} / {formatShortDate(upload.createdAt)}</small>
				</span>
			</button>
			<a href={downloadUrl} aria-label={`Download ${upload.name}`}>
				<Download size={13} aria-hidden />
			</a>
			<button type="button" onClick={() => onRemove(upload.id)} aria-label={`Remove ${upload.name}`}>
				<Trash2 size={13} aria-hidden />
			</button>
		</div>
	);
}

function FileHostStrip({
	hostId,
	hosts,
	onHost,
}: {
	hostId: string;
	hosts: FileHostOption[];
	onHost: (hostId: string) => void;
}) {
	const selectedHost = hosts.find((host) => host.id === hostId) ?? hosts[0];
	return (
		<div className="file-host-group" aria-label="File host selector">
			<div className="file-host-strip" role="tablist" aria-label="File hosts">
				{hosts.map((host) => (
					<button
						type="button"
						key={host.id}
						className={cx(host.id === selectedHost?.id && "active", !host.reachable && "unreachable")}
						onClick={() => onHost(host.id)}
						title={host.errorSummary || host.detail || host.name}
					>
						<span>{host.name}</span>
						<small>{host.kind}</small>
					</button>
				))}
			</div>
			{selectedHost ? (
				<div className="file-host-status">
					<span>{selectedHost.detail}</span>
					{selectedHost.reachable ? <small>reachable</small> : <small>{selectedHost.errorSummary || "needs setup"}</small>}
				</div>
			) : null}
		</div>
	);
}

function UploadPreview({
	downloadUrl,
	onRemove,
	upload,
}: {
	downloadUrl: string;
	onRemove: (uploadId: string) => void;
	upload: WorkbenchUpload;
}) {
	return (
		<section className="file-preview upload-preview" aria-label="Upload preview">
			<div className="file-preview-header">
				<div>
					<strong>{upload.name}</strong>
					<span>{upload.storagePath}</span>
				</div>
				<span className="artifact-kind">upload</span>
			</div>
			<div className="artifact-actions">
				<a href={downloadUrl}>
					<Download size={14} aria-hidden />
					<span>Download</span>
				</a>
				<button type="button" onClick={() => onRemove(upload.id)}>
					<Trash2 size={14} aria-hidden />
					<span>Remove</span>
				</button>
			</div>
			<dl className="artifact-meta-grid">
				<div>
					<dt>Type</dt>
					<dd>{upload.contentType}</dd>
				</div>
				<div>
					<dt>Size</dt>
					<dd>{formatBytes(upload.sizeBytes)}</dd>
				</div>
				<div>
					<dt>Imported</dt>
					<dd>{formatShortDate(upload.createdAt)}</dd>
				</div>
			</dl>
			<pre className="artifact-text-preview">{uploadPreviewText(upload)}</pre>
		</section>
	);
}

function FilesOverlay({
	actions,
	artifacts,
	artifactTab,
	category,
	categoryCounts,
	editState,
	filePreview,
	filteredUploads,
	hostId,
	hosts,
	onArtifactTab,
	onCategory,
	onClose,
	onEditCancel,
	onEditDraft,
	onEditOpen,
	onEditSave,
	onMoleculeSave,
	onHost,
	onImport,
	onPlanAction,
	onPlanStep,
	onQuery,
	onScope,
	onSelect,
	onUploadDownloadUrl,
	onUploadRemove,
	onUploadSelect,
	onVersionDiff,
	onVersionRestore,
	query,
	refinement,
	scope,
	scopeCounts,
	selectedArtifact,
	selectedPlan,
	selectedPath,
	selectedUpload,
	state,
	uploading,
	versionDiffs,
	versionStatuses,
}: {
	actions: ArtifactActionControls;
	artifacts: WorkbenchArtifact[];
	artifactTab: "preview" | "provenance";
	category: FileCategoryFilter;
	categoryCounts: ReturnType<typeof artifactCategoryCounts>;
	editState: ArtifactEditState | null;
	filePreview: FilePreview | null;
	filteredUploads: WorkbenchUpload[];
	hostId: string;
	hosts: FileHostOption[];
	onArtifactTab: (tab: "preview" | "provenance") => void;
	onCategory: (category: FileCategoryFilter) => void;
	onClose: () => void;
	onEditCancel: () => void;
	onEditDraft: (draft: string) => void;
	onEditOpen: (artifact: WorkbenchArtifact) => void;
	onEditSave: () => void;
	onMoleculeSave: (artifact: WorkbenchArtifact, content: string) => Promise<void>;
	onHost: (hostId: string) => void;
	onImport: () => void;
	onPlanAction: (plan: WorkbenchGeneratedPlan, action: WorkbenchPlanAction) => void;
	onPlanStep: (plan: WorkbenchGeneratedPlan, stepTitle: string, status: WorkbenchPlanStepStatus) => void;
	onQuery: (query: string) => void;
	onScope: (scope: FileBrowserScope) => void;
	onSelect: (path: string) => void;
	onUploadDownloadUrl: (upload: WorkbenchUpload) => string;
	onUploadRemove: (uploadId: string) => void;
	onUploadSelect: (uploadId: string) => void;
	onVersionDiff: (version: WorkbenchArtifactVersion) => void;
	onVersionRestore: (version: WorkbenchArtifactVersion) => void;
	query: string;
	refinement: ArtifactRefinementControls;
	scope: FileBrowserScope;
	scopeCounts: ReturnType<typeof fileScopeCounts>;
	selectedArtifact: WorkbenchArtifact | null;
	selectedPlan: WorkbenchGeneratedPlan | null;
	selectedPath: string | null;
	selectedUpload: WorkbenchUpload | null;
	state: WorkbenchState | null;
	uploading: boolean;
	versionDiffs: Record<string, VersionDiffState>;
	versionStatuses: Record<string, string>;
}) {
	return (
		<section className="files-overlay-react" aria-label="Files overlay">
			<header className="files-overlay-react-header">
				<button type="button" onClick={onClose} aria-label="Back to session">
					<ChevronRight size={15} aria-hidden />
					<span>Back</span>
				</button>
				<div>
					<p className="eyebrow">Files</p>
					<h2>Workspace files</h2>
				</div>
				<button type="button" onClick={onClose} aria-label="Close files">
					<X size={16} aria-hidden />
				</button>
			</header>
			<div className="files-overlay-react-toolbar">
				<button type="button" onClick={onImport} disabled={uploading}>
					<Upload size={14} aria-hidden />
					<span>{uploading ? "Importing" : "Import"}</span>
				</button>
				<FileHostStrip hostId={hostId} hosts={hosts} onHost={onHost} />
				<div className="file-scope-tabs" role="tablist" aria-label="Files overlay scope">
					{scopeCounts.map((item) => (
						<button
							type="button"
							key={item.scope}
							className={cx(scope === item.scope && "active")}
							onClick={() => onScope(item.scope)}
						>
							<span>{fileScopeLabel(item.scope)}</span>
							<small>{item.count}</small>
						</button>
					))}
				</div>
				<label className="search-box">
					<Search size={15} aria-hidden />
					<input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search files" />
				</label>
			</div>
			<div className="files-overlay-react-categories">
				<button type="button" className={cx(category === "all" && "active")} onClick={() => onCategory("all")}>All</button>
				{categoryCounts.map((item) => (
					<button
						type="button"
						key={item.category}
						className={cx(category === item.category && "active")}
						onClick={() => onCategory(item.category)}
					>
						<span>{item.category}</span>
						<small>{item.count}</small>
					</button>
				))}
			</div>
			<div className="files-overlay-react-body">
				<div className="files-overlay-react-browser">
					<div className="files-overlay-react-summary">
						<strong>{fileScopeLabel(scope)} files</strong>
						<span>{artifacts.length} artifacts{filteredUploads.length ? ` / ${filteredUploads.length} uploads` : ""}</span>
					</div>
					{filteredUploads.length ? <div className="upload-section-label">Uploads</div> : null}
					{filteredUploads.map((upload) => (
						<UploadRow
							key={upload.id}
							downloadUrl={onUploadDownloadUrl(upload)}
							selected={selectedUpload?.id === upload.id}
							upload={upload}
							onRemove={onUploadRemove}
							onSelect={onUploadSelect}
						/>
					))}
					{filteredUploads.length ? <div className="upload-section-label">Artifacts</div> : null}
					{artifacts.map((artifact) => (
						<button
							type="button"
							key={artifact.path}
							className={cx("artifact-row", selectedPath === artifact.path && "selected")}
							onClick={() => onSelect(artifact.path)}
						>
							<FileText size={15} aria-hidden />
							<span>
								<strong>{artifact.displayName || artifact.title || artifact.name}</strong>
								<small>{artifact.category} / {artifact.path}</small>
							</span>
						</button>
					))}
					<ArtifactRecoveryList
						actions={actions}
						items={state?.artifactActions ?? []}
					/>
					{!artifacts.length && !filteredUploads.length && !state?.artifactActions.length ? <div className="panel-empty">No files match this view.</div> : null}
				</div>
				<div className="files-overlay-react-preview">
					{selectedUpload ? (
						<UploadPreview
							downloadUrl={onUploadDownloadUrl(selectedUpload)}
							upload={selectedUpload}
							onRemove={onUploadRemove}
						/>
					) : (
						<ArtifactViewer
							actions={actions}
							artifact={selectedArtifact}
							editState={editState}
							filePreview={filePreview}
							previewTab={artifactTab}
							refinement={refinement}
							selectedPlan={selectedPlan}
							state={state}
							versionDiffs={versionDiffs}
							versionStatuses={versionStatuses}
							onEditCancel={onEditCancel}
							onEditDraft={onEditDraft}
							onEditOpen={onEditOpen}
							onEditSave={onEditSave}
							onMoleculeSave={onMoleculeSave}
							onPlanAction={onPlanAction}
							onPlanStep={onPlanStep}
							onPreviewTab={onArtifactTab}
							onVersionDiff={onVersionDiff}
							onVersionRestore={onVersionRestore}
						/>
					)}
				</div>
			</div>
		</section>
	);
}

async function copyText(value: string): Promise<void> {
	if (navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(value);
		return;
	}
	const input = document.createElement("input");
	input.value = value;
	document.body.append(input);
	input.select();
	document.execCommand("copy");
	input.remove();
}

function downloadJsonFile(filename: string, payload: unknown): void {
	const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
	const anchor = document.createElement("a");
	anchor.href = URL.createObjectURL(blob);
	anchor.download = filename;
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	window.setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
}

function ArtifactViewer({
	actions,
	artifact,
	editState,
	filePreview,
	onEditCancel,
	onEditDraft,
	onEditOpen,
	onEditSave,
	onMoleculeSave,
	onPlanAction,
	onPlanStep,
	onPreviewTab,
	onVersionDiff,
	onVersionRestore,
	previewTab,
	refinement,
	selectedPlan,
	state,
	versionDiffs,
	versionStatuses,
}: {
	actions: ArtifactActionControls;
	artifact: WorkbenchArtifact | null;
	editState: ArtifactEditState | null;
	filePreview: FilePreview | null;
	onEditCancel: () => void;
	onEditDraft: (draft: string) => void;
	onEditOpen: (artifact: WorkbenchArtifact) => void;
	onEditSave: () => void;
	onMoleculeSave: (artifact: WorkbenchArtifact, content: string) => Promise<void>;
	onPlanAction: (plan: WorkbenchGeneratedPlan, action: WorkbenchPlanAction) => void;
	onPlanStep: (plan: WorkbenchGeneratedPlan, stepTitle: string, status: WorkbenchPlanStepStatus) => void;
	onPreviewTab: (tab: "preview" | "provenance") => void;
	onVersionDiff: (version: WorkbenchArtifactVersion) => void;
	onVersionRestore: (version: WorkbenchArtifactVersion) => void;
	previewTab: "preview" | "provenance";
	refinement: ArtifactRefinementControls;
	selectedPlan: WorkbenchGeneratedPlan | null;
	state: WorkbenchState | null;
	versionDiffs: Record<string, VersionDiffState>;
	versionStatuses: Record<string, string>;
}) {
	if (!artifact) {
		return (
			<div className="file-preview">
				<div className="panel-empty">Select an artifact to inspect its content, versions, execution, and verification evidence.</div>
			</div>
		);
	}
	const kind = artifactPreviewKind(artifact, filePreview);
	const versions = state ? artifactVersionsForPath(state, artifact.path) : [];
	const executions = state ? artifactExecutionsForPath(state, artifact.path) : [];
	const checks = state ? artifactChecksForPath(state, artifact.path) : [];
	const claims = state ? artifactClaimsForPath(state, artifact.path) : [];
	const annotations = state ? artifactAnnotationsForPath(state.artifactAnnotations ?? [], artifact.path) : [];
	const title = artifact.displayName || artifact.title || artifact.name;
	const provenanceCount = versions.length + executions.length + checks.length + claims.length;
	const editDisabledReason = artifactEditDisabledReason(artifact);
	const activeRefinement = refinement.state?.artifactPath === artifact.path ? refinement.state : null;
	const starAction: ArtifactMutationAction = artifact.starred ? "unstar" : "star";
	const starBusy = actions.busyKey === `${artifact.path}:${starAction}`;
	const hideBusy = actions.busyKey === `${artifact.path}:hide`;
	const renameBusy = actions.busyKey === `${artifact.path}:rename`;
	const deleteBusy = actions.busyKey === `${artifact.path}:delete`;
	const cloudBusy = actions.busyKey === `${artifact.path}:export-cloud`;
	return (
		<section className="file-preview artifact-viewer" aria-label="Artifact preview">
			<div className="file-preview-header">
				<div>
					<strong>{title}</strong>
					<span>{artifact.path}</span>
				</div>
				<span className="artifact-kind">{kind}</span>
			</div>
			<div className="artifact-actions">
				<a href={artifactDownloadUrl(artifact.path)}>
					<Download size={14} aria-hidden />
					<span>Download</span>
				</a>
				<button type="button" onClick={() => void copyText(artifact.path)}>
					<Copy size={14} aria-hidden />
					<span>Copy path</span>
				</button>
				<button
					type="button"
					disabled={Boolean(editDisabledReason)}
					title={editDisabledReason || "Edit this text artifact and save a version snapshot"}
					onClick={() => onEditOpen(artifact)}
				>
					<Pencil size={14} aria-hidden />
					<span>Edit</span>
				</button>
			</div>
			<div className="artifact-secondary-actions" aria-label="Artifact actions">
				<button type="button" className={cx(artifact.starred && "active")} onClick={() => actions.onAction(artifact, starAction)} disabled={starBusy}>
					<Star size={13} aria-hidden />
					<span>{starBusy ? "Saving" : artifact.starred ? "Unstar" : "Star"}</span>
				</button>
				<button type="button" onClick={actions.onViewContext}>
					<History size={13} aria-hidden />
					<span>View context</span>
				</button>
				<button type="button" onClick={() => actions.onNotes(artifact)}>
					<StickyNote size={13} aria-hidden />
					<span>Notes</span>
				</button>
				<button type="button" onClick={() => actions.onCopyLink(artifact)}>
					<Link size={13} aria-hidden />
					<span>Copy link</span>
				</button>
				<button type="button" onClick={() => actions.onAction(artifact, "rename")} disabled={renameBusy}>
					<Pencil size={13} aria-hidden />
					<span>{renameBusy ? "Renaming" : "Rename"}</span>
				</button>
				<button type="button" onClick={() => actions.onExportMetadata(artifact)}>
					<FileJson size={13} aria-hidden />
					<span>Metadata</span>
				</button>
				<button
					type="button"
					onClick={() => actions.onCloudExport(artifact)}
					disabled={cloudBusy || !actions.cloudTarget}
					title={actions.cloudTarget ? `Export to ${actions.cloudTarget.name}` : "Configure a cloud export target in Customize"}
				>
					<CloudUpload size={13} aria-hidden />
					<span>{cloudBusy ? "Exporting" : "Cloud export"}</span>
				</button>
				<button type="button" onClick={() => actions.onAction(artifact, "hide")} disabled={hideBusy}>
					<EyeOff size={13} aria-hidden />
					<span>{hideBusy ? "Hiding" : "Hide"}</span>
				</button>
				<button type="button" className="danger" onClick={() => actions.onAction(artifact, "delete")} disabled={deleteBusy}>
					<Trash2 size={13} aria-hidden />
					<span>{deleteBusy ? "Deleting" : "Delete"}</span>
				</button>
				{actions.status ? <span className="artifact-action-status">{actions.status}</span> : null}
			</div>
			<dl className="artifact-meta-grid">
				<div>
					<dt>Size</dt>
					<dd>{formatBytes(artifact.sizeBytes)}</dd>
				</div>
				<div>
					<dt>Updated</dt>
					<dd>{formatShortDate(artifact.updatedAt)}</dd>
				</div>
				<div>
					<dt>Checksum</dt>
					<dd>{shortChecksum(versions[0])}</dd>
				</div>
			</dl>
			<div className="artifact-tabs" role="tablist" aria-label="Artifact detail">
				<button type="button" className={cx(previewTab === "preview" && "active")} onClick={() => onPreviewTab("preview")}>
					<FileText size={14} aria-hidden />
					<span>Preview</span>
					{annotations.length ? <small>{annotations.length}</small> : null}
				</button>
				<button type="button" className={cx(previewTab === "provenance" && "active")} onClick={() => onPreviewTab("provenance")}>
					<History size={14} aria-hidden />
					<span>Provenance</span>
					<small>{provenanceCount}</small>
				</button>
			</div>
			{previewTab === "preview" ? (
				<div className="artifact-preview-stack">
					{editState?.path === artifact.path ? (
						<ArtifactEditor
							editState={editState}
							onCancel={onEditCancel}
							onDraft={onEditDraft}
							onSave={onEditSave}
							onTextSelection={refinement.onTextSelection}
						/>
					) : (
						<ArtifactPreviewContent
							annotations={annotations}
							artifact={artifact}
							filePreview={filePreview}
							kind={kind}
							mediaDraft={refinement.mediaDraft}
							mediaModePath={refinement.mediaModePath}
							onMediaDraft={refinement.onMediaDraft}
							onMediaMode={refinement.onMediaMode}
							onMoleculeSave={onMoleculeSave}
							onPlanAction={onPlanAction}
							onPlanStep={onPlanStep}
							onTextSelection={refinement.onTextSelection}
							plan={selectedPlan}
						/>
					)}
					{activeRefinement ? (
						<ArtifactRefinementPanel
							state={activeRefinement}
							onApply={refinement.onApply}
							onClose={refinement.onClose}
							onDraft={refinement.onDraft}
							onInstruction={refinement.onInstruction}
							onSaveAnnotation={refinement.onSaveAnnotation}
							onSuggest={refinement.onSuggest}
						/>
					) : null}
					<ArtifactAnnotationsPanel
						annotations={annotations}
						busyId={refinement.annotationBusyId}
						onRemove={refinement.onRemoveAnnotation}
						onUse={refinement.onUseAnnotation}
					/>
				</div>
			) : (
				<ArtifactProvenance
					checks={checks}
					claims={claims}
					executions={executions}
					versionDiffs={versionDiffs}
					versionStatuses={versionStatuses}
					versions={versions}
					onVersionDiff={onVersionDiff}
					onVersionRestore={onVersionRestore}
				/>
			)}
		</section>
	);
}

function ArtifactEditor({
	editState,
	onCancel,
	onDraft,
	onSave,
	onTextSelection,
}: {
	editState: ArtifactEditState;
	onCancel: () => void;
	onDraft: (draft: string) => void;
	onSave: () => void;
	onTextSelection: (selection: ArtifactTextSelection) => void;
}) {
	const changed = editState.draft !== editState.original;
	const disabled = editState.loading || editState.saving;
	const captureSelection = (start: number | null, end: number | null) => {
		if (changed || start === null || end === null) return;
		const selection = textSelectionFromOffsets(editState.original, start, end);
		if (selection) onTextSelection(selection);
	};
	return (
		<div className="artifact-editor">
			<header>
				<div>
					<strong>Edit content</strong>
					<span>{editState.path}</span>
				</div>
				<div className="artifact-editor-actions">
					<button type="button" onClick={onCancel} disabled={disabled}>Cancel</button>
					<button type="button" onClick={onSave} disabled={disabled || !changed}>
						<Save size={14} aria-hidden />
						<span>Save</span>
					</button>
				</div>
			</header>
			<textarea
				value={editState.draft}
				onChange={(event) => onDraft(event.target.value)}
				onKeyUp={(event) => captureSelection(event.currentTarget.selectionStart, event.currentTarget.selectionEnd)}
				onSelect={(event) => captureSelection(event.currentTarget.selectionStart, event.currentTarget.selectionEnd)}
				disabled={disabled}
				spellCheck={false}
				aria-label="Edit artifact content"
			/>
			<footer>
				<span>{editState.status}</span>
				<span>{formatBytes(new TextEncoder().encode(editState.draft).length)}</span>
			</footer>
		</div>
	);
}

function ArtifactPreviewContent({
	annotations,
	artifact,
	filePreview,
	kind,
	mediaDraft,
	mediaModePath,
	onMediaDraft,
	onMediaMode,
	onMoleculeSave,
	onPlanAction,
	onPlanStep,
	onTextSelection,
	plan,
}: {
	annotations: WorkbenchArtifactAnnotation[];
	artifact: WorkbenchArtifact;
	filePreview: FilePreview | null;
	kind: ArtifactPreviewKind;
	mediaDraft: MediaAnnotationDraft | null;
	mediaModePath: string | null;
	onMediaDraft: (draft: MediaAnnotationDraft | null) => void;
	onMediaMode: (artifactPath: string | null) => void;
	onMoleculeSave: (artifact: WorkbenchArtifact, content: string) => Promise<void>;
	onPlanAction: (plan: WorkbenchGeneratedPlan, action: WorkbenchPlanAction) => void;
	onPlanStep: (plan: WorkbenchGeneratedPlan, stepTitle: string, status: WorkbenchPlanStepStatus) => void;
	onTextSelection: (selection: ArtifactAnchorSelection) => void;
	plan: WorkbenchGeneratedPlan | null;
}) {
	if (plan) {
		return <WorkbenchPlanArtifactPreview onAction={onPlanAction} onStep={onPlanStep} plan={plan} />;
	}
	if (kind === "image") {
		return (
			<ArtifactMediaPreview
				annotations={annotations}
				artifact={artifact}
				draft={mediaDraft}
				mediaKind="image"
				modePath={mediaModePath}
				onDraft={onMediaDraft}
				onMode={onMediaMode}
				onSelection={onTextSelection}
			>
				<ImageIcon size={18} aria-hidden />
				<img src={artifactDownloadUrl(artifact.path)} alt={artifact.title || artifact.name} />
			</ArtifactMediaPreview>
		);
	}
	if (kind === "pdf") {
		return (
			<PdfArtifactPreview
				annotations={annotations}
				artifact={artifact}
				draft={mediaDraft}
				modePath={mediaModePath}
				onDraft={onMediaDraft}
				onMode={onMediaMode}
				onSelection={onTextSelection}
			/>
		);
	}
	if (kind === "audio") {
		return <AudioArtifactPreview artifact={artifact} />;
	}
	if (kind === "video") {
		return <VideoArtifactPreview artifact={artifact} />;
	}
	if (kind === "spreadsheet") {
		return <SpreadsheetArtifactPreview artifact={artifact} />;
	}
	if (kind === "table" && filePreview?.content) {
		const table = parseDelimitedPreview(filePreview.content, artifact.extension === ".tsv" ? "\t" : ",");
		return (
			<div className="artifact-table-preview">
				<div className="artifact-table-title">
					<Table2 size={15} aria-hidden />
					<span>{table.rows.length} visible rows</span>
					{table.truncated || filePreview.truncated ? <strong>truncated</strong> : null}
				</div>
				<table>
					<thead>
						<tr>{table.headers.map((header, index) => <th key={`${header}-${index}`}>{header || `Column ${index + 1}`}</th>)}</tr>
					</thead>
					<tbody>
						{table.rows.map((row, rowIndex) => (
							<tr key={rowIndex}>
								{table.headers.map((_, cellIndex) => <td key={cellIndex}>{row[cellIndex] ?? ""}</td>)}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		);
	}
	if (kind === "json" && filePreview?.content) {
		return <JsonArtifactPreview content={filePreview.content} extension={artifact.extension} truncated={filePreview.truncated} />;
	}
	if (kind === "notebook" && filePreview?.content) {
		return <NotebookArtifactPreview content={filePreview.content} truncated={filePreview.truncated} />;
	}
	if (kind === "latex" && filePreview?.content) {
		return <LatexArtifactPreview content={filePreview.content} truncated={filePreview.truncated} />;
	}
	if (kind === "tensor") {
		return <TensorSciencePreview artifact={artifact} />;
	}
	if ((kind === "sequence" || kind === "msa" || kind === "genome" || kind === "molecule" || kind === "structure" || kind === "tree") && filePreview?.content) {
		return <ArtifactSciencePreview artifact={artifact} content={filePreview.content} kind={kind} truncated={filePreview.truncated} onMoleculeSave={onMoleculeSave} />;
	}
	if (kind === "html" && filePreview?.content) {
		return (
			<HtmlArtifactPreview
				annotations={annotations}
				artifact={artifact}
				content={filePreview.content}
				onTextSelection={onTextSelection}
				truncated={filePreview.truncated}
			/>
		);
	}
	if (kind === "binary") {
		return <div className="panel-empty">This artifact is not text-previewable. Download it to inspect the original file.</div>;
	}
	const content = filePreview?.content || "Loading preview...";
	const captureSelection = () => {
		if (!filePreview?.content) return;
		const selection = textSelectionFromSelectedText(filePreview.content, window.getSelection()?.toString() ?? "");
		if (selection) onTextSelection(selection);
	};
	return (
		<pre className="artifact-text-preview" tabIndex={0} onKeyUp={captureSelection} onMouseUp={captureSelection}>
			{content}
			{filePreview?.truncated ? "\n\n[Preview truncated]" : ""}
		</pre>
	);
}

const workbenchPlanStatusLabels: Record<WorkbenchGeneratedPlan["status"], string> = {
	approved: "Approved",
	awaiting_approval: "Awaiting approval",
	complete: "Complete",
	rejected: "Rejected",
	running: "Running",
};

const workbenchPlanStepOptions: Array<{ icon: ReactNode; label: string; status: WorkbenchPlanStepStatus }> = [
	{ icon: <RotateCcw size={12} aria-hidden />, label: "Pending", status: "pending" },
	{ icon: <Play size={12} aria-hidden />, label: "Running", status: "running" },
	{ icon: <CheckCircle2 size={12} aria-hidden />, label: "Complete", status: "complete" },
	{ icon: <X size={12} aria-hidden />, label: "Blocked", status: "blocked" },
];

function WorkbenchPlanArtifactPreview({
	onAction,
	onStep,
	plan,
}: {
	onAction: (plan: WorkbenchGeneratedPlan, action: WorkbenchPlanAction) => void;
	onStep: (plan: WorkbenchGeneratedPlan, stepTitle: string, status: WorkbenchPlanStepStatus) => void;
	plan: WorkbenchGeneratedPlan;
}) {
	const completed = plan.steps.filter((step) => step.status === "complete").length;
	const blocked = plan.steps.filter((step) => step.status === "blocked").length;
	const running = plan.steps.filter((step) => step.status === "running").length;
	return (
		<section className="science-preview workbench-plan-preview">
			<header>
				<div>
					<FileText size={16} aria-hidden />
					<strong>{plan.title}</strong>
				</div>
				<span>{workbenchPlanStatusLabels[plan.status]}</span>
			</header>
			<ScienceStatGrid stats={[
				{ label: "Steps", value: plan.steps.length },
				{ label: "Complete", value: completed },
				{ label: "Running", value: running || undefined },
				{ label: "Blocked", value: blocked || undefined },
				{ label: "Confidence", value: plan.feasibility.confidence },
			]} />
			<p className="workbench-plan-summary">{plan.taskSummary}</p>
			<p className="workbench-plan-rationale">{plan.feasibility.rationale}</p>
			<div className="workbench-plan-actions" role="group" aria-label="Plan approval actions">
				{plan.status === "awaiting_approval" ? (
					<>
						<button type="button" onClick={() => onAction(plan, "approve")}>
							<CheckCircle2 size={13} aria-hidden />
							<span>Approve plan</span>
						</button>
						<button type="button" className="danger" onClick={() => onAction(plan, "reject")}>
							<X size={13} aria-hidden />
							<span>Reject plan</span>
						</button>
					</>
				) : (
					<button type="button" onClick={() => onAction(plan, "reopen")}>
						<RotateCcw size={13} aria-hidden />
						<span>Reopen plan</span>
					</button>
				)}
			</div>
			<ol className="workbench-plan-steps">
				{plan.steps.map((step, index) => (
					<li key={step.title} className={`workbench-plan-step is-${step.status}`}>
						<div className="workbench-plan-step-index">{index + 1}</div>
						<div className="workbench-plan-step-body">
							<header>
								<strong>{step.title}</strong>
								<span>{step.status}</span>
							</header>
							<p>{step.description}</p>
							{step.notes ? <p className="workbench-plan-step-note">{step.notes}</p> : null}
							{step.artifactPaths.length ? (
								<div className="science-chip-row workbench-plan-artifacts">
									{step.artifactPaths.slice(0, 5).map((artifactPath) => <span key={artifactPath}>{artifactPath}</span>)}
									{step.artifactPaths.length > 5 ? <span>{step.artifactPaths.length - 5} more</span> : null}
								</div>
							) : null}
							<div className="workbench-plan-step-actions" role="group" aria-label={`Update ${step.title}`}>
								{workbenchPlanStepOptions.map((option) => (
									<button
										type="button"
										key={option.status}
										className={cx(step.status === option.status && "is-active")}
										onClick={() => onStep(plan, step.title, option.status)}
									>
										{option.icon}
										<span>{option.label}</span>
									</button>
								))}
							</div>
						</div>
					</li>
				))}
			</ol>
		</section>
	);
}

function AudioArtifactPreview({ artifact }: { artifact: WorkbenchArtifact }) {
	return (
		<section className="science-preview media-file-preview">
			<header>
				<div>
					<Play size={16} aria-hidden />
					<strong>Audio preview</strong>
				</div>
				<span>{artifact.extension.replace(".", "").toUpperCase()}</span>
			</header>
			<ScienceStatGrid stats={[
				{ label: "Type", value: artifact.contentType },
				{ label: "Size", value: formatBytes(artifact.sizeBytes) },
				{ label: "Updated", value: formatShortDate(artifact.updatedAt) },
			]} />
			<audio controls preload="metadata" src={artifactDownloadUrl(artifact.path)} />
		</section>
	);
}

function VideoArtifactPreview({ artifact }: { artifact: WorkbenchArtifact }) {
	return (
		<section className="science-preview media-file-preview">
			<header>
				<div>
					<Play size={16} aria-hidden />
					<strong>Video preview</strong>
				</div>
				<span>{artifact.extension.replace(".", "").toUpperCase()}</span>
			</header>
			<ScienceStatGrid stats={[
				{ label: "Type", value: artifact.contentType },
				{ label: "Size", value: formatBytes(artifact.sizeBytes) },
				{ label: "Updated", value: formatShortDate(artifact.updatedAt) },
			]} />
			<video controls preload="metadata" src={artifactDownloadUrl(artifact.path)} />
		</section>
	);
}

function SpreadsheetArtifactPreview({ artifact }: { artifact: WorkbenchArtifact }) {
	const [preview, setPreview] = useState<SpreadsheetPreview | null>(null);
	const [status, setStatus] = useState<ViewerStatus>({ state: "loading", message: "Loading spreadsheet artifact" });
	useEffect(() => {
		const controller = new AbortController();
		setPreview(null);
		setStatus({ state: "loading", message: "Loading spreadsheet artifact" });
		fetch(artifactDownloadUrl(artifact.path), { signal: controller.signal })
			.then((response) => {
				if (!response.ok) throw new Error(`download failed (${response.status})`);
				return response.arrayBuffer();
			})
			.then((buffer) => parseSpreadsheetPreview(buffer))
			.then((nextPreview) => {
				setPreview(nextPreview);
				setStatus({
					state: nextPreview.error ? "error" : "ready",
					message: nextPreview.error ?? `${nextPreview.sheetCount} sheet${nextPreview.sheetCount === 1 ? "" : "s"} available`,
				});
			})
			.catch((error) => {
				if (controller.signal.aborted) return;
				setStatus({ state: "error", message: error instanceof Error ? error.message : "Spreadsheet preview failed" });
			});
		return () => controller.abort();
	}, [artifact.path]);
	return (
		<section className="science-preview spreadsheet-preview">
			<header>
				<div>
					<Table2 size={16} aria-hidden />
					<strong>Spreadsheet preview</strong>
				</div>
				<span>{status.message}</span>
			</header>
			<ScienceStatGrid stats={[
				{ label: "Format", value: "XLSX" },
				{ label: "Sheets", value: preview?.sheetCount },
				{ label: "Size", value: formatBytes(artifact.sizeBytes) },
				{ label: "State", value: status.state },
			]} />
			{status.state === "loading" ? <div className="science-empty">Loading workbook...</div> : null}
			{status.state === "error" ? <div className="science-empty">{status.message}</div> : null}
			{preview?.sheets.map((sheet) => (
				<div className="spreadsheet-sheet" key={sheet.name}>
					<header>
						<strong>{sheet.name}</strong>
						<span>{sheet.rowCount} rows / {sheet.columnCount} columns{sheet.truncated ? " / truncated" : ""}</span>
					</header>
					<div className="science-preview-table">
						<table>
							<thead>
								<tr>{sheet.headers.map((header, index) => <th key={`${sheet.name}-header-${index}`}>{header || `Column ${index + 1}`}</th>)}</tr>
							</thead>
							<tbody>
								{sheet.rows.map((row, rowIndex) => (
									<tr key={`${sheet.name}-row-${rowIndex}`}>
										{sheet.headers.map((_, cellIndex) => <td key={cellIndex}>{row[cellIndex] ?? ""}</td>)}
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			))}
			{preview && !preview.sheets.length && !preview.error ? <div className="science-empty">No worksheet rows were detected.</div> : null}
		</section>
	);
}

type HtmlAnnotationFrameMessage =
	| { kind: "html-annot-dismiss"; nonce: string }
	| { kind: "html-annot-ready"; nonce: string }
	| {
		kind: "html-annot-selected";
		nonce: string;
		selector: string;
		descriptor: string;
		elementText: string;
		rect: { x: number; y: number; width: number; height: number; vw: number; vh: number };
	};

type HtmlAnnotationHighlight = {
	id: string;
	label: string;
	selector: string;
	text: string;
};

const htmlAnnotationBridgeScript = String.raw`
(function(nonce) {
	if (window.__feynmanHtmlAnnotationBridge) return;
	window.__feynmanHtmlAnnotationBridge = true;
	var mode = false;
	var hoverBox = null;
	var hoverTarget = null;
	var saved = [];
	function clampText(value, max) {
		var text = String(value || "").trim();
		if (text.length <= max) return text;
		return text.slice(0, max);
	}
	function makeOverlay(className) {
		var node = document.createElement("div");
		node.setAttribute("data-feynman-html-annotation", "1");
		node.className = className;
		node.style.position = "fixed";
		node.style.pointerEvents = "none";
		node.style.zIndex = "2147483640";
		document.documentElement.appendChild(node);
		return node;
	}
	function makeBadge(label) {
		var node = document.createElement("button");
		node.type = "button";
		node.setAttribute("data-feynman-html-annotation", "1");
		node.textContent = label;
		node.style.position = "fixed";
		node.style.zIndex = "2147483641";
		node.style.border = "0";
		node.style.borderRadius = "999px";
		node.style.padding = "2px 6px";
		node.style.font = "700 11px system-ui, sans-serif";
		node.style.color = "#f8fbf2";
		node.style.background = "#244d30";
		node.style.boxShadow = "0 4px 12px rgba(31,43,27,.18)";
		document.documentElement.appendChild(node);
		return node;
	}
	function paintBox(node, rect, color, fill) {
		node.style.left = Math.max(0, rect.left - 2) + "px";
		node.style.top = Math.max(0, rect.top - 2) + "px";
		node.style.width = Math.max(0, rect.width + 4) + "px";
		node.style.height = Math.max(0, rect.height + 4) + "px";
		node.style.border = "2px solid " + color;
		node.style.borderRadius = "6px";
		node.style.background = fill || "transparent";
	}
	function selectorEscape(value) {
		if (window.CSS && CSS.escape) return CSS.escape(value);
		return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
	}
	function selectorFor(element) {
		if (!element || element.nodeType !== 1) return "body";
		if (element.id && document.querySelectorAll("#" + selectorEscape(element.id)).length === 1) return "#" + selectorEscape(element.id);
		var attrNames = ["data-testid", "data-test", "aria-label", "name", "role"];
		for (var i = 0; i < attrNames.length; i++) {
			var name = attrNames[i];
			var value = element.getAttribute(name);
			if (!value) continue;
			var attrSelector = element.tagName.toLowerCase() + "[" + name + "=" + JSON.stringify(value) + "]";
			try {
				if (document.querySelectorAll(attrSelector).length === 1) return attrSelector;
			} catch (error) {}
		}
		var parts = [];
		var current = element;
		while (current && current.nodeType === 1 && current !== document.body && parts.length < 5) {
			var tag = current.tagName.toLowerCase();
			var parent = current.parentElement;
			if (!parent) break;
			var index = Array.prototype.indexOf.call(parent.children, current) + 1;
			parts.unshift(tag + ":nth-child(" + index + ")");
			current = parent;
		}
		return parts.length ? "body > " + parts.join(" > ") : "body";
	}
	function descriptorFor(element, selector) {
		var lines = [];
		var tag = element.tagName ? element.tagName.toLowerCase() : "element";
		lines.push("tag: " + tag);
		var role = element.getAttribute && element.getAttribute("role");
		var label = element.getAttribute && element.getAttribute("aria-label");
		var href = element.getAttribute && element.getAttribute("href");
		var alt = element.getAttribute && element.getAttribute("alt");
		if (role) lines.push("role: " + clampText(role, 160));
		if (label) lines.push("label: " + clampText(label, 240));
		if (href) lines.push("href: " + clampText(href, 400));
		if (alt) lines.push("alt: " + clampText(alt, 240));
		lines.push("selector: " + clampText(selector, 4096));
		return lines.join("\n");
	}
	function clearSaved() {
		saved.forEach(function(item) {
			item.box.remove();
			item.badge.remove();
		});
		saved = [];
	}
	function repositionSaved() {
		saved.forEach(function(item) {
			try {
				var element = document.querySelector(item.selector);
				if (!element) {
					item.box.style.display = "none";
					item.badge.style.display = "none";
					return;
				}
				var rect = element.getBoundingClientRect();
				if (!rect.width && !rect.height) {
					item.box.style.display = "none";
					item.badge.style.display = "none";
					return;
				}
				item.box.style.display = "";
				item.badge.style.display = "";
				paintBox(item.box, rect, "#f2c94c", "rgba(242,201,76,.12)");
				item.badge.style.left = Math.max(4, rect.left + 4) + "px";
				item.badge.style.top = Math.max(4, rect.top + 4) + "px";
			} catch (error) {}
		});
	}
	function setHighlights(items) {
		clearSaved();
		(items || []).forEach(function(item) {
			try {
				var element = document.querySelector(item.selector);
				if (!element) return;
				var box = makeOverlay("feynman-html-annotation-box");
				var badge = makeBadge(item.label);
				badge.title = item.text || "";
				saved.push({ box: box, badge: badge, selector: item.selector });
			} catch (error) {}
		});
		repositionSaved();
	}
	function setMode(next) {
		mode = !!next;
		document.body.style.cursor = mode ? "crosshair" : "";
		if (!mode && hoverBox) hoverBox.style.display = "none";
	}
	window.addEventListener("message", function(event) {
		var data = event.data || {};
		if (data.nonce !== nonce) return;
		if (data.kind === "set-mode") setMode(data.on);
		if (data.kind === "highlight") setHighlights(data.items);
	});
	document.addEventListener("mousemove", function(event) {
		if (!mode) return;
		var element = document.elementFromPoint(event.clientX, event.clientY);
		if (!element || element.closest("[data-feynman-html-annotation]")) return;
		hoverTarget = element;
		if (!hoverBox) hoverBox = makeOverlay("feynman-html-hover-box");
		hoverBox.style.display = "";
		paintBox(hoverBox, element.getBoundingClientRect(), "#244d30", "rgba(36,77,48,.08)");
	});
	document.addEventListener("mouseleave", function() {
		if (hoverBox) hoverBox.style.display = "none";
	});
	document.addEventListener("scroll", repositionSaved, true);
	window.addEventListener("resize", repositionSaved);
	document.addEventListener("click", function(event) {
		if (!mode) {
			window.parent.postMessage({ kind: "html-annot-dismiss", nonce: nonce }, "*");
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		var element = hoverTarget && hoverTarget.isConnected ? hoverTarget : document.elementFromPoint(event.clientX, event.clientY);
		if (!element || element.closest("[data-feynman-html-annotation]")) return;
		if (hoverBox) hoverBox.style.display = "none";
		var selector = selectorFor(element);
		var rect = element.getBoundingClientRect();
		window.parent.postMessage({
			kind: "html-annot-selected",
			nonce: nonce,
			selector: selector,
			descriptor: descriptorFor(element, selector),
			elementText: clampText(element.innerText || "", 2000),
			rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, vw: window.innerWidth || 1, vh: window.innerHeight || 1 }
		}, "*");
	}, true);
	window.parent.postMessage({ kind: "html-annot-ready", nonce: nonce }, "*");
})(__FEYNMAN_HTML_ANNOTATION_NONCE__);
`;

function createHtmlAnnotationNonce(): string {
	if (window.crypto?.randomUUID) return window.crypto.randomUUID();
	return `html-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function injectHtmlAnnotationBridge(content: string, nonce: string): string {
	const script = `<script data-feynman-html-annotation="1">(function(){var __FEYNMAN_HTML_ANNOTATION_NONCE__=${JSON.stringify(nonce)};${htmlAnnotationBridgeScript}})();<\/script>`;
	if (/<head\b[^>]*>/i.test(content)) return content.replace(/<head\b[^>]*>/i, (match) => `${match}${script}`);
	if (/<body\b[^>]*>/i.test(content)) return content.replace(/<body\b[^>]*>/i, (match) => `${match}${script}`);
	return `${script}${content}`;
}

function htmlSelectorFromAnnotation(annotation: WorkbenchArtifactAnnotation): string | null {
	const source = annotation.selectionPrefix || annotation.anchorText || "";
	const match = source.match(/(?:^|\n)selector:\s*([^\n]+)/);
	return match?.[1]?.trim() || null;
}

function htmlSelectionFromFrameMessage(message: Extract<HtmlAnnotationFrameMessage, { kind: "html-annot-selected" }>): ArtifactTextSelection {
	const percent = (value: number, total: number) => Math.round(Math.min(100, Math.max(0, (value / Math.max(1, total)) * 100)) * 1000) / 1000;
	const xPercent = percent(message.rect.x, message.rect.vw);
	const yPercent = percent(message.rect.y, message.rect.vh);
	const widthPercent = Math.max(1.2, percent(message.rect.width, message.rect.vw));
	const heightPercent = Math.max(1.2, percent(message.rect.height, message.rect.vh));
	const selectorLine = `selector: ${message.selector}`;
	const descriptor = [message.descriptor, selectorLine].filter(Boolean).join("\n");
	const selectedText = [
		message.elementText ? `HTML element text: ${message.elementText}` : "HTML element",
		selectorLine,
	].join("\n");
	return {
		anchorKind: "text_selection",
		selectedText,
		selectionPrefix: descriptor.slice(0, 1_000),
		xPercent,
		yPercent,
		widthPercent,
		heightPercent,
		rects: [{ xPercent, yPercent, widthPercent, heightPercent }],
	};
}

function HtmlArtifactPreview({
	annotations,
	artifact,
	content,
	onTextSelection,
	truncated,
}: {
	annotations: WorkbenchArtifactAnnotation[];
	artifact: WorkbenchArtifact;
	content: string;
	onTextSelection: (selection: ArtifactAnchorSelection) => void;
	truncated: boolean;
}) {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const nonceRef = useRef(createHtmlAnnotationNonce());
	const [annotating, setAnnotating] = useState(false);
	const [bridgeReady, setBridgeReady] = useState(false);
	const srcDoc = useMemo(() => injectHtmlAnnotationBridge(content, nonceRef.current), [content]);
	const highlights = useMemo<HtmlAnnotationHighlight[]>(() => {
		return annotations.flatMap((annotation): HtmlAnnotationHighlight[] => {
			const selector = htmlSelectorFromAnnotation(annotation);
			if (!selector) return [];
			return [{
				id: annotation.id,
				label: `#${annotation.labelIndex}`,
				selector,
				text: annotation.body,
			}];
		});
	}, [annotations]);
	const postToFrame = (message: Record<string, unknown>) => {
		iframeRef.current?.contentWindow?.postMessage({ ...message, nonce: nonceRef.current }, "*");
	};
	useEffect(() => {
		setBridgeReady(false);
		setAnnotating(false);
	}, [srcDoc]);
	useEffect(() => {
		const onMessage = (event: MessageEvent<HtmlAnnotationFrameMessage>) => {
			const message = event.data;
			if (!message || message.nonce !== nonceRef.current) return;
			if (message.kind === "html-annot-ready") {
				setBridgeReady(true);
				return;
			}
			if (message.kind === "html-annot-dismiss") return;
			if (message.kind === "html-annot-selected") {
				setAnnotating(false);
				onTextSelection(htmlSelectionFromFrameMessage(message));
			}
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [onTextSelection]);
	useEffect(() => {
		postToFrame({ kind: "set-mode", on: annotating });
	}, [annotating, bridgeReady, srcDoc]);
	useEffect(() => {
		if (!bridgeReady) return;
		postToFrame({ kind: "highlight", items: highlights });
	}, [bridgeReady, highlights]);
	return (
		<section className="html-artifact-preview">
			<header>
				<div>
					<FileText size={16} aria-hidden />
					<strong>HTML report preview</strong>
				</div>
				<div className="html-artifact-actions">
					{truncated ? <span>truncated</span> : null}
					<span>{annotations.length} annotation{annotations.length === 1 ? "" : "s"}</span>
					<button
						type="button"
						className={cx(annotating && "active")}
						disabled={!bridgeReady}
						aria-pressed={annotating}
						onClick={() => setAnnotating((value) => !value)}
						title={bridgeReady ? "Annotate an element inside the HTML preview" : "HTML preview is loading"}
					>
						{annotating ? "Annotating" : "Annotate"}
					</button>
				</div>
			</header>
			<iframe
				className="html-artifact-frame"
				ref={iframeRef}
				referrerPolicy="no-referrer"
				sandbox="allow-scripts"
				srcDoc={srcDoc}
				title="HTML artifact preview"
			/>
		</section>
	);
}

type JsonExpansionMode = "collapsed" | "expanded" | "summary";

const jsonExpansionModes: Array<{ label: string; mode: JsonExpansionMode }> = [
	{ label: "Summary", mode: "summary" },
	{ label: "Expand", mode: "expanded" },
	{ label: "Collapse", mode: "collapsed" },
];

const jsonViewerStyles = {
	...defaultStyles,
	container: `${defaultStyles.container} feynman-json-tree`,
	childFieldsContainer: `${defaultStyles.childFieldsContainer} feynman-json-children`,
	basicChildStyle: `${defaultStyles.basicChildStyle} feynman-json-row`,
	label: `${defaultStyles.label} feynman-json-label`,
	clickableLabel: `${defaultStyles.clickableLabel} feynman-json-clickable-label`,
	stringValue: `${defaultStyles.stringValue} feynman-json-string`,
	numberValue: `${defaultStyles.numberValue} feynman-json-number`,
	booleanValue: `${defaultStyles.booleanValue} feynman-json-boolean`,
	nullValue: `${defaultStyles.nullValue} feynman-json-null`,
	otherValue: `${defaultStyles.otherValue} feynman-json-other`,
	punctuation: `${defaultStyles.punctuation} feynman-json-punctuation`,
	collapseIcon: `${defaultStyles.collapseIcon} feynman-json-toggle`,
	expandIcon: `${defaultStyles.expandIcon} feynman-json-toggle`,
	collapsedContent: `${defaultStyles.collapsedContent} feynman-json-collapsed`,
} satisfies Partial<typeof defaultStyles>;

function JsonArtifactPreview({ content, extension, truncated }: { content: string; extension: string; truncated: boolean }) {
	const [expansionMode, setExpansionMode] = useState<JsonExpansionMode>("summary");
	const preview = useMemo(() => parseJsonPreview(content, extension), [content, extension]);
	const shouldExpandNode = useMemo(() => {
		if (expansionMode === "expanded") return allExpanded;
		if (expansionMode === "collapsed") return collapseAllNested;
		return (level: number, value: unknown) => {
			if (level === 0) return true;
			if (level === 1) {
				const childCount = Array.isArray(value) ? value.length : typeof value === "object" && value !== null ? Object.keys(value).length : 0;
				return childCount <= 12;
			}
			return false;
		};
	}, [expansionMode]);
	const status = preview.error ? "issue" : preview.truncated || truncated ? "truncated" : null;
	return (
		<section className="science-preview json-artifact-preview">
			<header>
				<div>
					<FileJson size={16} aria-hidden />
					<strong>JSON artifact preview</strong>
				</div>
				{status ? <span>{status}</span> : null}
			</header>
			<div className="json-preview-toolbar" role="group" aria-label="JSON expansion mode">
				{jsonExpansionModes.map((item) => (
					<button
						type="button"
						key={item.mode}
						className={item.mode === expansionMode ? "is-active" : ""}
						onClick={() => setExpansionMode(item.mode)}
					>
						{item.label}
					</button>
				))}
			</div>
			<ScienceStatGrid stats={[
				{ label: "Format", value: preview.format.toUpperCase() },
				{ label: "Root", value: preview.rootType },
				{ label: preview.rootType === "object" ? "Keys" : preview.format === "jsonl" ? "Lines" : "Items", value: preview.format === "jsonl" ? preview.lineCount : preview.topLevelCount },
				{ label: "Nodes", value: preview.nodeCount },
				{ label: "Objects", value: preview.objectCount || undefined },
				{ label: "Arrays", value: preview.arrayCount || undefined },
				{ label: "Invalid lines", value: preview.invalidLineCount || undefined },
			]} />
			{preview.error ? <div className="science-empty">{preview.error}</div> : null}
			{preview.topLevelKeys.length ? (
				<div className="science-chip-row json-key-row">
					{preview.topLevelKeys.map((key) => <span key={key}>{key}</span>)}
				</div>
			) : null}
			<div className="json-view-stage" data-json-root={preview.rootType}>
				<JsonView
					key={expansionMode}
					aria-label={`${preview.format.toUpperCase()} artifact tree`}
					clickToExpandNode
					compactTopLevel={preview.rootType === "object"}
					data={preview.data}
					shouldExpandNode={shouldExpandNode}
					style={jsonViewerStyles}
				/>
			</div>
		</section>
	);
}

function NotebookArtifactPreview({ content, truncated }: { content: string; truncated: boolean }) {
	const preview = useMemo(() => parseNotebookPreview(content), [content]);
	return (
		<section className="science-preview notebook-artifact-preview">
			<header>
				<div>
					<BookOpen size={16} aria-hidden />
					<strong>{preview.title || "Notebook preview"}</strong>
				</div>
				{preview.error ? <span>issue</span> : preview.truncated || truncated ? <span>truncated</span> : null}
			</header>
			<ScienceStatGrid stats={[
				{ label: "Kernel", value: preview.kernel },
				{ label: "Language", value: preview.language },
				{ label: "Cells", value: preview.cellCount },
				{ label: "Code", value: preview.codeCellCount },
				{ label: "Markdown", value: preview.markdownCellCount },
				{ label: "Outputs", value: preview.outputCount },
			]} />
			{preview.error ? <div className="science-empty">{preview.error}</div> : null}
			<div className="notebook-cell-list">
				{preview.cells.map((cell) => (
					<article className="notebook-cell-preview" key={cell.index}>
						<header>
							<strong>Cell {cell.index}</strong>
							<span>{cell.type}{cell.executionCount !== undefined ? ` / exec ${cell.executionCount}` : ""}{cell.outputCount ? ` / ${cell.outputCount} outputs` : ""}</span>
						</header>
						{cell.sourcePreview ? <pre>{cell.sourcePreview}</pre> : <div className="science-empty">Empty cell</div>}
						{cell.outputPreview ? <pre className="notebook-output-preview">{cell.outputPreview}</pre> : null}
					</article>
				))}
			</div>
		</section>
	);
}

function LatexArtifactPreview({ content, truncated }: { content: string; truncated: boolean }) {
	const preview = useMemo(() => parseLatexPreview(content), [content]);
	return (
		<section className="science-preview latex-artifact-preview">
			<header>
				<div>
					<FileText size={16} aria-hidden />
					<strong>LaTeX preview</strong>
				</div>
				{preview.truncated || truncated ? <span>truncated</span> : null}
			</header>
			<ScienceStatGrid stats={[
				{ label: "Sections", value: preview.sectionCount },
				{ label: "Equations", value: preview.equationCount },
				{ label: "Citations", value: preview.citations.length },
				{ label: "Labels", value: preview.labels.length },
				{ label: "Bibliography", value: preview.bibliographyCount },
				{ label: "Commands", value: preview.commandCount },
			]} />
			{preview.sections.length ? (
				<div className="science-chip-row">
					{preview.sections.map((section) => <span key={section}>{section}</span>)}
				</div>
			) : null}
			{preview.citations.length || preview.labels.length ? (
				<div className="latex-reference-grid">
					<div>
						<strong>Citations</strong>
						{preview.citations.length ? preview.citations.map((citation) => <span key={citation}>{citation}</span>) : <em>None detected</em>}
					</div>
					<div>
						<strong>Labels</strong>
						{preview.labels.length ? preview.labels.map((label) => <span key={label}>{label}</span>) : <em>None detected</em>}
					</div>
				</div>
			) : null}
			<pre className="artifact-text-preview latex-source-preview">
				{preview.preview}
				{preview.truncated || truncated ? "\n\n[Preview truncated]" : ""}
			</pre>
		</section>
	);
}

function ArtifactSciencePreview({
	artifact,
	content,
	kind,
	onMoleculeSave,
	truncated,
}: {
	artifact: WorkbenchArtifact;
	content: string;
	kind: Extract<ArtifactPreviewKind, "genome" | "molecule" | "msa" | "sequence" | "structure" | "tree">;
	onMoleculeSave: (artifact: WorkbenchArtifact, content: string) => Promise<void>;
	truncated: boolean;
}) {
	if (kind === "sequence") return <SequenceSciencePreview content={content} truncated={truncated} />;
	if (kind === "msa") return <MsaSciencePreview content={content} extension={artifact.extension} truncated={truncated} />;
	if (kind === "genome") return <GenomeSciencePreview content={content} extension={artifact.extension} truncated={truncated} />;
	if (kind === "molecule") return <MoleculeSciencePreview artifact={artifact} content={content} extension={artifact.extension} truncated={truncated} onSave={onMoleculeSave} />;
	if (kind === "tree") return <TreeSciencePreview content={content} extension={artifact.extension} truncated={truncated} />;
	return <StructureSciencePreview content={content} extension={artifact.extension} truncated={truncated} />;
}

function ScienceStatGrid({ stats }: { stats: Array<{ label: string; value: string | number | undefined }> }) {
	return (
		<div className="science-preview-stats">
			{stats.filter((stat) => stat.value !== undefined && stat.value !== "").map((stat) => (
				<div key={stat.label}>
					<dt>{stat.label}</dt>
					<dd>{stat.value}</dd>
				</div>
			))}
		</div>
	);
}

function SequenceSciencePreview({ content, truncated }: { content: string; truncated: boolean }) {
	const preview = parseSequencePreview(content);
	return (
		<section className="science-preview sequence-preview">
			<header>
				<div>
					<Atom size={16} aria-hidden />
					<strong>Sequence preview</strong>
				</div>
				{preview.truncated || truncated ? <span>truncated</span> : null}
			</header>
			<ScienceStatGrid stats={[
				{ label: "Records", value: preview.recordCount },
				{ label: "Residues", value: preview.totalLength },
			]} />
			<div className="sequence-records">
				{preview.records.map((record) => (
					<article key={record.id} className="sequence-record">
						<div>
							<strong>{record.id}</strong>
							<span>{record.description || "FASTA record"}</span>
						</div>
						<ScienceStatGrid stats={[
							{ label: "Length", value: record.length },
							{ label: "GC", value: record.gcPercent === undefined ? undefined : `${record.gcPercent}%` },
						]} />
						<code>{record.preview}{record.length > record.preview.length ? "..." : ""}</code>
						<div className="science-chip-row">
							{record.residueCounts.map((item) => <span key={item.residue}>{item.residue} {item.count}</span>)}
						</div>
					</article>
				))}
			</div>
		</section>
	);
}

type NightingaleMsaElement = HTMLElement & {
	data?: Array<{ name: string; sequence: string }>;
	updateComplete?: Promise<unknown>;
};

const msaColorSchemes = [
	{ label: "Clustal 2", value: "clustal2" },
	{ label: "Clustal", value: "clustal" },
	{ label: "Nucleotide", value: "nucleotide" },
	{ label: "Hydro", value: "hydro" },
	{ label: "Taylor", value: "taylor" },
	{ label: "Conservation", value: "conservation" },
];

function MsaSciencePreview({ content, extension, truncated }: { content: string; extension: string; truncated: boolean }) {
	const preview = useMemo(() => parseMsaPreview(content, extension), [content, extension]);
	const [colorScheme, setColorScheme] = useState("clustal2");
	const [viewerReady, setViewerReady] = useState(false);
	const [viewerError, setViewerError] = useState<string | null>(null);
	const msaRef = useRef<NightingaleMsaElement | null>(null);
	const viewerWidth = Math.min(2600, Math.max(720, preview.alignmentLength * 14 + 190));
	const viewerHeight = Math.min(620, Math.max(220, preview.records.length * 22 + 56));

	useEffect(() => {
		let cancelled = false;
		void import("@nightingale-elements/nightingale-msa")
			.then(() => {
				if (!cancelled) setViewerReady(true);
			})
			.catch((error: unknown) => {
				if (!cancelled) setViewerError(error instanceof Error ? error.message : "viewer failed to load");
			});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		const element = msaRef.current;
		if (!element || !viewerReady || !preview.records.length) return;
		element.setAttribute("width", String(viewerWidth));
		element.setAttribute("height", String(viewerHeight));
		element.setAttribute("color-scheme", colorScheme);
		element.setAttribute("label-width", "0");
		element.setAttribute("tile-height", "18");
		element.setAttribute("conservation-sample-size", "40");
		if (colorScheme === "conservation") {
			element.setAttribute("overlay-conservation", "true");
		} else {
			element.removeAttribute("overlay-conservation");
		}
		const alignmentRows = preview.records.map((record) => ({ name: record.id, sequence: record.sequence }));
		element.data = alignmentRows;
		let cancelled = false;
		const frame = window.requestAnimationFrame(() => {
			if (msaRef.current === element) element.data = alignmentRows;
		});
		void element.updateComplete?.then(() => {
			if (!cancelled && msaRef.current === element) element.data = alignmentRows;
		});
		const timeout = window.setTimeout(() => {
			if (!cancelled && msaRef.current === element) element.data = alignmentRows;
		}, 150);
		return () => {
			cancelled = true;
			window.cancelAnimationFrame(frame);
			window.clearTimeout(timeout);
		};
	}, [colorScheme, preview.records, viewerHeight, viewerReady, viewerWidth]);

	if (!preview.records.length) return <div className="panel-empty">No alignment records were detected in this artifact.</div>;

	return (
		<section className="science-preview msa-preview" data-testid="msa-preview">
			<header>
				<div>
					<Layers size={16} aria-hidden />
					<strong>MSA alignment preview</strong>
				</div>
				{preview.truncated || truncated ? <span>truncated</span> : null}
			</header>
			<ScienceStatGrid stats={[
				{ label: "Sequences", value: preview.sequenceCount },
				{ label: "Columns", value: preview.alignmentLength },
				{ label: "Gaps", value: `${preview.gapPercent}%` },
				{ label: "Conserved", value: preview.conservedColumnCount },
				{ label: "Variable", value: preview.variableColumnCount },
				{ label: "Format", value: preview.format },
			]} />
			<div className="msa-toolbar">
				<label>
					<span>Color</span>
					<select value={colorScheme} onChange={(event) => setColorScheme(event.currentTarget.value)}>
						{msaColorSchemes.map((scheme) => <option key={scheme.value} value={scheme.value}>{scheme.label}</option>)}
					</select>
				</label>
				<code>{preview.consensusPreview}{preview.alignmentLength > preview.consensusPreview.length ? "..." : ""}</code>
			</div>
			<div className="science-render-stage msa-render-stage">
				{viewerError ? <div className="science-render-empty">Alignment viewer failed to load. Parsed rows are shown below.</div> : null}
				<div className="msa-viewer-grid" style={{ width: viewerWidth + 180, minHeight: viewerHeight }}>
					<div className="msa-label-gutter" style={{ minHeight: viewerHeight }}>
						{preview.records.map((record) => <span key={record.id}>{record.id}</span>)}
					</div>
					{createElement("nightingale-msa", {
						ref: msaRef as RefObject<HTMLElement>,
						className: "msa-web-component",
						"aria-label": "Multiple sequence alignment",
						"color-scheme": colorScheme,
						"conservation-sample-size": 40,
						height: viewerHeight,
						"label-width": 0,
						...(colorScheme === "conservation" ? { "overlay-conservation": true } : {}),
						"tile-height": 18,
						width: viewerWidth,
					})}
				</div>
				{!viewerReady ? <div className="science-render-empty">Loading alignment viewer...</div> : null}
			</div>
			<div className="sequence-records msa-records">
				{preview.records.slice(0, 8).map((record) => (
					<article key={record.id} className="sequence-record msa-record">
						<div>
							<strong>{record.id}</strong>
							<span>{record.description || "Alignment row"}</span>
						</div>
						<ScienceStatGrid stats={[
							{ label: "Length", value: record.length },
							{ label: "Gaps", value: `${record.gapPercent}%` },
						]} />
						<code>{record.preview}{record.length > record.preview.length ? "..." : ""}</code>
					</article>
				))}
			</div>
		</section>
	);
}

function GenomeSciencePreview({ content, extension, truncated }: { content: string; extension: string; truncated: boolean }) {
	const preview = parseGenomePreview(content, extension);
	const track = inferGenomeBrowserTrack(preview);
	return (
		<section className="science-preview genome-preview">
			<header>
				<div>
					<Database size={16} aria-hidden />
					<strong>Genome preview</strong>
				</div>
				{preview.truncated || truncated ? <span>truncated</span> : null}
			</header>
			<ScienceStatGrid stats={[
				{ label: "Format", value: preview.format.toUpperCase() },
				{ label: "Records", value: preview.recordCount },
				{ label: "Contigs", value: preview.contigs.length || undefined },
				{ label: "Feature types", value: preview.featureTypes.length || undefined },
			]} />
			<div className="science-chip-row">
				{preview.contigs.map((contig) => <span key={contig}>{contig}</span>)}
				{preview.featureTypes.map((type) => <span key={type}>{type}</span>)}
			</div>
			{track ? <IgvGenomePreview content={content} track={track} truncated={preview.truncated || truncated} /> : null}
			<ScienceRows rows={preview.rows} />
		</section>
	);
}

function MoleculeSciencePreview({
	artifact,
	content,
	extension,
	onSave,
	truncated,
}: {
	artifact: WorkbenchArtifact;
	content: string;
	extension: string;
	onSave: (artifact: WorkbenchArtifact, content: string) => Promise<void>;
	truncated: boolean;
}) {
	const preview = parseMoleculePreview(content, extension);
	return (
		<section className="science-preview molecule-preview">
			<header>
				<div>
					<Atom size={16} aria-hidden />
					<strong>Molecule preview</strong>
				</div>
				{preview.truncated || truncated ? <span>truncated</span> : null}
			</header>
			<ScienceStatGrid stats={[
				{ label: "Format", value: preview.format.toUpperCase() },
				{ label: "Molecules", value: preview.moleculeCount },
				{ label: "Atoms", value: preview.atomCount },
				{ label: "Bonds", value: preview.bondCount },
			]} />
			<RdkitMoleculePreview content={content} extension={extension} />
			{preview.format === "mol" || preview.format === "sdf" ? <ThreeDmolPreview content={content} extension={extension} kind="molecule" /> : null}
			<KetcherMoleculeEditor content={content} extension={extension} onSave={(result) => onSave(artifact, result.content)} />
			<ScienceRows rows={preview.molecules} />
		</section>
	);
}

function StructureSciencePreview({ content, extension, truncated }: { content: string; extension: string; truncated: boolean }) {
	const preview = parseStructurePreview(content, extension);
	return (
		<section className="science-preview structure-preview">
			<header>
				<div>
					<Layers size={16} aria-hidden />
					<strong>Structure preview</strong>
				</div>
				{truncated ? <span>truncated</span> : null}
			</header>
			<ScienceStatGrid stats={[
				{ label: "Format", value: preview.format.toUpperCase() },
				{ label: "Atoms", value: preview.atomCount },
				{ label: "Residues", value: preview.residueCount },
				{ label: "Chains", value: preview.chainCount },
				{ label: "Models", value: preview.modelCount },
			]} />
			<ThreeDmolPreview content={content} extension={extension} kind="structure" />
			<div className="science-chip-row">
				{preview.chains.map((chain) => <span key={chain}>chain {chain}</span>)}
				{preview.elements.map((item) => <span key={item.element}>{item.element} {item.count}</span>)}
			</div>
		</section>
	);
}

function TreeSciencePreview({ content, extension, truncated }: { content: string; extension: string; truncated: boolean }) {
	const preview = parseTreePreview(content, extension);
	return (
		<section className="science-preview tree-preview">
			<header>
				<div>
					<GitCompare size={16} aria-hidden />
					<strong>Phylogenetic tree preview</strong>
				</div>
				{preview.truncated || truncated ? <span>truncated</span> : null}
			</header>
			<ScienceStatGrid stats={[
				{ label: "Format", value: preview.format.toUpperCase() },
				{ label: "Leaves", value: preview.leafCount },
				{ label: "Branches", value: preview.branchCount },
				{ label: "Depth", value: preview.maxDepth },
				{ label: "Length", value: preview.totalBranchLength },
			]} />
			<TidyTreePreview preview={preview} />
			<div className="science-chip-row">
				{preview.leafExamples.map((leaf) => <span key={leaf}>{leaf}</span>)}
				{preview.supportLabels.map((label) => <span key={`support-${label}`}>support {label}</span>)}
			</div>
		</section>
	);
}

function formatTensorStat(value: number | undefined): string | undefined {
	return value === undefined ? undefined : formatTensorValue(value);
}

function tensorShapeLabel(shape: number[]): string {
	return shape.length ? shape.join(" x ") : "scalar";
}

function TensorSciencePreview({ artifact }: { artifact: WorkbenchArtifact }) {
	const [preview, setPreview] = useState<TensorArchivePreview | null>(null);
	const [status, setStatus] = useState<ViewerStatus>({ state: "loading", message: "Loading tensor artifact" });

	useEffect(() => {
		const controller = new AbortController();
		setPreview(null);
		setStatus({ state: "loading", message: "Loading NumPy tensor artifact" });
		fetch(artifactDownloadUrl(artifact.path), { signal: controller.signal })
			.then(async (response) => {
				if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}`);
				return response.arrayBuffer();
			})
			.then((buffer) => parseTensorArchivePreview(buffer, artifact.extension, artifact.name))
			.then((nextPreview) => {
				setPreview(nextPreview);
				setStatus({
					state: "ready",
					message: `${nextPreview.format.toUpperCase()} tensor preview | ${nextPreview.arrays.length} array${nextPreview.arrays.length === 1 ? "" : "s"}`,
				});
			})
			.catch((error: unknown) => {
				if (controller.signal.aborted) return;
				setStatus({ state: "error", message: error instanceof Error ? error.message : "Tensor preview failed." });
			});
		return () => controller.abort();
	}, [artifact.extension, artifact.name, artifact.path]);

	return (
		<section className="science-preview tensor-preview">
			<header>
				<div>
					<Table2 size={16} aria-hidden />
					<strong>Tensor preview</strong>
				</div>
				<span>{status.state}</span>
			</header>
			<ScienceStatGrid stats={[
				{ label: "Format", value: preview?.format.toUpperCase() ?? artifact.extension.replace(".", "").toUpperCase() },
				{ label: "Arrays", value: preview?.arrays.length },
				{ label: "Size", value: formatBytes(artifact.sizeBytes) },
			]} />
			<p className="tensor-preview-status">{status.message}</p>
			{status.state === "error" ? <div className="science-empty">{status.message}</div> : null}
			{status.state === "loading" ? <div className="science-empty">{status.message}</div> : null}
			{preview?.arraysTruncated ? <div className="science-empty">Archive contains more arrays; preview is capped to the first eight `.npy` members.</div> : null}
			<div className="tensor-array-list">
				{preview?.arrays.map((array) => <TensorArrayCard key={array.name} array={array} />)}
			</div>
		</section>
	);
}

function TensorArrayCard({ array }: { array: TensorArrayPreview }) {
	return (
		<article className="tensor-array-card">
			<div className="tensor-array-heading">
				<strong>{array.name}</strong>
				<span>{tensorShapeLabel(array.shape)}</span>
			</div>
			<ScienceStatGrid stats={[
				{ label: "Dtype", value: array.dtype },
				{ label: "Values", value: array.valueCount },
				{ label: "Order", value: array.fortranOrder ? "Fortran" : "C" },
				{ label: "Min", value: formatTensorStat(array.min) },
				{ label: "Max", value: formatTensorStat(array.max) },
				{ label: "Mean", value: formatTensorStat(array.mean) },
				{ label: "NaN", value: array.nanCount || undefined },
				{ label: "+/- Inf", value: array.positiveInfinityCount || array.negativeInfinityCount ? `${array.positiveInfinityCount}/${array.negativeInfinityCount}` : undefined },
			]} />
			<div className="science-chip-row">
				{array.sampleValues.map((value, index) => <span key={`${array.name}-sample-${index}`}>{value}</span>)}
				{array.statsSampled ? <span>stats sampled</span> : null}
			</div>
			{array.vector ? <TensorVectorPlot array={array} /> : null}
			{array.matrix ? <TensorMatrixPreviewGrid matrix={array.matrix} /> : null}
		</article>
	);
}

function TensorVectorPlot({ array }: { array: TensorArrayPreview }) {
	const points = array.vector?.points ?? [];
	if (points.length < 2) return null;
	const width = 640;
	const height = 130;
	const padding = 18;
	const polyline = points
		.map((point) => `${padding + point.x * (width - padding * 2)},${padding + point.y * (height - padding * 2)}`)
		.join(" ");
	return (
		<div className="tensor-vector-plot" aria-label={`${array.name} vector preview`}>
			<svg viewBox={`0 0 ${width} ${height}`} role="img">
				<line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} />
				<line x1={padding} y1={padding} x2={padding} y2={height - padding} />
				<polyline points={polyline} />
				{points.slice(0, 1).map((point) => (
					<circle key="first" cx={padding + point.x * (width - padding * 2)} cy={padding + point.y * (height - padding * 2)} r={3} />
				))}
				{points.slice(-1).map((point) => (
					<circle key="last" cx={padding + point.x * (width - padding * 2)} cy={padding + point.y * (height - padding * 2)} r={3} />
				))}
			</svg>
			<div>
				<span>{formatTensorStat(array.min) ?? "n/a"}</span>
				<span>{formatTensorStat(array.max) ?? "n/a"}</span>
			</div>
		</div>
	);
}

function TensorMatrixPreviewGrid({ matrix }: { matrix: NonNullable<TensorArrayPreview["matrix"]> }) {
	return (
		<div
			className="tensor-heatmap"
			style={{ gridTemplateColumns: `42px repeat(${matrix.columns.length}, minmax(22px, 1fr))` }}
		>
			<span className="tensor-axis-label">{matrix.planeLabel ?? ""}</span>
			{matrix.columns.map((column) => <span key={`col-${column}`} className="tensor-axis-label">{column}</span>)}
			{matrix.rows.map((row) => (
				<div className="tensor-heatmap-row" key={`row-${row.label}`} style={{ display: "contents" }}>
					<span className="tensor-axis-label">{row.label}</span>
					{row.cells.map((cell, index) => <TensorMatrixCell key={`${row.label}-${index}`} cell={cell} />)}
				</div>
			))}
			{matrix.truncatedRows || matrix.truncatedColumns ? (
				<span className="tensor-axis-label tensor-truncation">
					{matrix.truncatedRows ? "more rows" : ""}{matrix.truncatedRows && matrix.truncatedColumns ? " / " : ""}{matrix.truncatedColumns ? "more cols" : ""}
				</span>
			) : null}
		</div>
	);
}

function TensorMatrixCell({ cell }: { cell: TensorValueCell }) {
	const alpha = 0.08 + cell.intensity * 0.78;
	return (
		<span
			className="tensor-heatmap-cell"
			style={{
				backgroundColor: `rgba(34, 86, 50, ${alpha})`,
				color: cell.intensity > 0.58 ? "#ffffff" : "#263421",
			}}
			title={cell.display}
		>
			{cell.display}
		</span>
	);
}

function ScienceRows({ rows }: { rows: Array<Record<string, string | number | undefined>> }) {
	if (!rows.length) return <div className="science-empty">No records found in preview text.</div>;
	const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(0, 8);
	return (
		<div className="science-preview-table">
			<table>
				<thead>
					<tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
				</thead>
				<tbody>
					{rows.map((row, rowIndex) => (
						<tr key={rowIndex}>
							{columns.map((column) => <td key={column}>{row[column] ?? ""}</td>)}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function ArtifactMediaPreview({
	annotations,
	artifact,
	children,
	draft,
	mediaKind,
	modePath,
	onDraft,
	onMode,
	onSelection,
}: {
	annotations: WorkbenchArtifactAnnotation[];
	artifact: WorkbenchArtifact;
	children: ReactNode;
	draft: MediaAnnotationDraft | null;
	mediaKind: "image" | "pdf";
	modePath: string | null;
	onDraft: (draft: MediaAnnotationDraft | null) => void;
	onMode: (artifactPath: string | null) => void;
	onSelection: (selection: ArtifactAnchorSelection) => void;
}) {
	const active = modePath === artifact.path;
	const saved = annotations.filter((annotation) =>
		(annotation.anchorKind === "point" || annotation.anchorKind === "region") &&
		typeof annotation.xPercent === "number" &&
		typeof annotation.yPercent === "number" &&
		(mediaKind !== "pdf" || !annotation.pageNumber || annotation.pageNumber === 1)
	);
	const currentDraft = draft?.artifactPath === artifact.path && draft.mediaKind === mediaKind ? draft : null;
	const draftSelection = currentDraft && typeof currentDraft.endX === "number" && typeof currentDraft.endY === "number"
		? mediaSelectionFromPoints({
			endX: currentDraft.endX,
			endY: currentDraft.endY,
			mediaKind: currentDraft.mediaKind,
			pageNumber: currentDraft.pageNumber,
			startX: currentDraft.startX,
			startY: currentDraft.startY,
		})
		: null;
	const pointForEvent = (event: MouseEvent<HTMLDivElement>) => {
		const rect = event.currentTarget.getBoundingClientRect();
		if (!rect.width || !rect.height) return null;
		return {
			x: ((event.clientX - rect.left) / rect.width) * 100,
			y: ((event.clientY - rect.top) / rect.height) * 100,
		};
	};
	const begin = (event: MouseEvent<HTMLDivElement>) => {
		if (!active) return;
		const point = pointForEvent(event);
		if (!point) return;
		event.preventDefault();
		event.stopPropagation();
		onDraft({
			artifactPath: artifact.path,
			mediaKind,
			pageNumber: mediaKind === "pdf" ? 1 : undefined,
			startX: point.x,
			startY: point.y,
			endX: point.x,
			endY: point.y,
		});
	};
	const move = (event: MouseEvent<HTMLDivElement>) => {
		if (!active || !currentDraft) return;
		const point = pointForEvent(event);
		if (!point) return;
		onDraft({ ...currentDraft, endX: point.x, endY: point.y });
	};
	const finish = (event: MouseEvent<HTMLDivElement>) => {
		if (!active || !currentDraft) return;
		const point = pointForEvent(event);
		if (!point) return;
		event.preventDefault();
		event.stopPropagation();
		const selection = mediaSelectionFromPoints({ ...currentDraft, endX: point.x, endY: point.y });
		onDraft(null);
		onMode(null);
		if (selection) onSelection(selection);
	};
	return (
		<div className={cx("artifact-media-preview", active && "annotating")}>
			<header className="media-annotation-toolbar">
				<div>
					<strong>{artifact.name}</strong>
					<span>{mediaKind === "pdf" ? "PDF" : "Image"} / {saved.length} annotation{saved.length === 1 ? "" : "s"}</span>
				</div>
				<button
					type="button"
					className={cx(active && "active")}
					aria-pressed={active}
					onClick={() => {
						onDraft(null);
						onMode(active ? null : artifact.path);
					}}
				>
					Annotate
				</button>
			</header>
			<div className={cx("media-annotation-stage", mediaKind === "pdf" && "pdf-stage")}>
				{children}
				<div
					className={cx("media-annotation-overlay", active && "active")}
					data-media-kind={mediaKind}
					onMouseDown={begin}
					onMouseMove={move}
					onMouseUp={finish}
				>
					{saved.map((annotation) => <MediaAnnotationMarker annotation={annotation} key={annotation.id} />)}
					{draftSelection ? <MediaAnnotationDraftMarker selection={draftSelection} /> : null}
				</div>
			</div>
		</div>
	);
}

function MediaAnnotationMarker({ annotation }: { annotation: WorkbenchArtifactAnnotation }) {
	if (typeof annotation.xPercent !== "number" || typeof annotation.yPercent !== "number") return null;
	const title = [
		`#${annotation.labelIndex}`,
		annotation.anchorKind || "region",
		annotation.pageNumber ? `page ${annotation.pageNumber}` : "",
		annotation.body,
	].filter(Boolean).join(" / ");
	if (annotation.anchorKind === "region") {
		return (
			<div
				className="media-annotation-region"
				style={{
					left: `${annotation.xPercent}%`,
					top: `${annotation.yPercent}%`,
					width: `${Math.max(1.2, annotation.widthPercent ?? 3)}%`,
					height: `${Math.max(1.2, annotation.heightPercent ?? 3)}%`,
				}}
				title={title}
			>
				<span>#{annotation.labelIndex}</span>
			</div>
		);
	}
	return (
		<span
			className="media-annotation-point"
			style={{ left: `${annotation.xPercent}%`, top: `${annotation.yPercent}%` }}
			title={title}
		>
			#{annotation.labelIndex}
		</span>
	);
}

function MediaAnnotationDraftMarker({ selection }: { selection: ArtifactAnchorSelection }) {
	if (selection.anchorKind === "text_selection") return null;
	if (selection.anchorKind === "region") {
		return (
			<div
				className="media-annotation-region draft"
				style={{
					left: `${selection.xPercent}%`,
					top: `${selection.yPercent}%`,
					width: `${Math.max(1.2, selection.widthPercent ?? 3)}%`,
					height: `${Math.max(1.2, selection.heightPercent ?? 3)}%`,
				}}
			>
				<span>draft</span>
			</div>
		);
	}
	return (
		<span className="media-annotation-point draft" style={{ left: `${selection.xPercent}%`, top: `${selection.yPercent}%` }}>
			draft
		</span>
	);
}

function ArtifactRefinementPanel({
	onApply,
	onClose,
	onDraft,
	onInstruction,
	onSaveAnnotation,
	onSuggest,
	state,
}: {
	onApply: () => void;
	onClose: () => void;
	onDraft: (draft: string) => void;
	onInstruction: (instruction: string) => void;
	onSaveAnnotation: () => void;
	onSuggest: (mode: ArtifactRefinementMode) => void;
	state: ArtifactRefinementState;
}) {
	const busy = state.phase === "loading" || state.phase === "applying";
	const canRefineText = canSuggestArtifactRefinement(state.selection);
	const canApply = canRefineText && state.phase === "suggestion" && state.suggestionMode === "edit" && Boolean(state.suggestionDraft.trim());
	const anchorOnlyStatus = state.selection.anchorKind === "text_selection"
		? "PDF text anchors are saved as artifact annotations. Use the saved annotation in chat for a Pi-backed revision turn."
		: "Region anchors are saved as artifact annotations. Use the saved annotation in chat for a Pi-backed revision turn.";
	return (
		<section className="artifact-refinement-panel" aria-label="Artifact refinement">
			<header>
				<div>
					<p className="eyebrow">Selection</p>
					<strong>{state.selection.selectedText.slice(0, 80)}{state.selection.selectedText.length > 80 ? "..." : ""}</strong>
				</div>
				<button type="button" onClick={onClose} aria-label="Close refinement">
					<X size={14} aria-hidden />
				</button>
			</header>
			<blockquote>{state.selection.selectedText}</blockquote>
			<textarea
				value={state.instruction}
				onChange={(event) => onInstruction(event.target.value)}
				placeholder="Ask a question or describe the edit"
				disabled={busy}
				rows={3}
				aria-label="Artifact refinement instruction"
			/>
			<div className="artifact-refinement-actions">
				<button type="button" onClick={onSaveAnnotation} disabled={busy || !state.instruction.trim()}>Save note</button>
				<button type="button" onClick={() => onSuggest("ask")} disabled={busy || !state.instruction.trim() || !canRefineText}>Ask</button>
				<button type="button" onClick={() => onSuggest("edit")} disabled={busy || !state.instruction.trim() || !canRefineText}>Draft edit</button>
			</div>
			{canRefineText ? null : <div className="refinement-status">{anchorOnlyStatus}</div>}
			<div className={cx("refinement-status", state.phase)}>{state.status}</div>
			{state.phase === "suggestion" ? (
				<div className="artifact-refinement-suggestion">
					<header>
						<strong>{state.suggestionMode === "edit" ? "Suggested edit" : "Answer"}</strong>
						<span>{state.source ?? "model"}</span>
					</header>
					{state.suggestionMode === "edit" ? (
						<>
							<div className="refinement-diff" aria-label="Refinement diff">
								{wordDiffParts(state.selection.selectedText, state.suggestionDraft).map((part, index) => (
									<span key={`${part.type}-${index}`} className={part.type}>{part.text}</span>
								))}
							</div>
							<textarea
								value={state.suggestionDraft}
								onChange={(event) => onDraft(event.target.value)}
								rows={4}
								aria-label="Suggested replacement text"
							/>
							<button type="button" className="artifact-refinement-apply" onClick={onApply} disabled={!canApply}>
								Apply edit
							</button>
						</>
					) : (
						<p>{state.suggestion}</p>
					)}
				</div>
			) : null}
		</section>
	);
}

function ArtifactAnnotationsPanel({
	annotations,
	busyId,
	onRemove,
	onUse,
}: {
	annotations: WorkbenchArtifactAnnotation[];
	busyId: string | null;
	onRemove: (annotationId: string) => void;
	onUse: (annotation: WorkbenchArtifactAnnotation) => void;
}) {
	return (
		<section className="artifact-annotations" aria-label="Artifact annotations">
			<header>
				<strong>Annotations</strong>
				<span>{annotations.length}</span>
			</header>
			{annotations.length ? annotations.slice(0, 5).map((annotation) => (
				<article className="annotation-row" key={annotation.id}>
					<div>
						<strong>{annotation.kind === "revision" ? `Revision ${annotation.labelIndex}` : `Note ${annotation.labelIndex}`}</strong>
						<span>{annotationAnchorSummary(annotation)} / {formatShortDate(annotation.updatedAt)}</span>
					</div>
					<p>{annotation.body}</p>
					{annotation.anchorText ? <blockquote>{annotation.anchorText}</blockquote> : null}
					<div className="annotation-actions-row">
						<button type="button" onClick={() => onUse(annotation)}>
							<Send size={13} aria-hidden />
							<span>Use in chat</span>
						</button>
						<button type="button" onClick={() => onRemove(annotation.id)} disabled={busyId === annotation.id}>
							<Trash2 size={13} aria-hidden />
							<span>{busyId === annotation.id ? "Removing" : "Remove"}</span>
						</button>
					</div>
				</article>
			)) : (
				<div className="panel-empty">No annotations on this artifact yet.</div>
			)}
		</section>
	);
}

function ArtifactProvenance({
	checks,
	claims,
	executions,
	onVersionDiff,
	onVersionRestore,
	versionDiffs,
	versionStatuses,
	versions,
}: {
	checks: ReturnType<typeof artifactChecksForPath>;
	claims: ReturnType<typeof artifactClaimsForPath>;
	executions: ReturnType<typeof artifactExecutionsForPath>;
	onVersionDiff: (version: WorkbenchArtifactVersion) => void;
	onVersionRestore: (version: WorkbenchArtifactVersion) => void;
	versionDiffs: Record<string, VersionDiffState>;
	versionStatuses: Record<string, string>;
	versions: ReturnType<typeof artifactVersionsForPath>;
}) {
	return (
		<div className="artifact-provenance">
			<ProvenanceSection title="Versions" empty="No versions recorded yet.">
				{versions.slice(0, 5).map((version) => (
					<div className="provenance-row" key={version.id}>
						<div>
							<strong>{version.label || `Version ${version.versionNumber}`}</strong>
							<span>{version.agentName || version.source} / {formatBytes(version.sizeBytes)} / {shortChecksum(version)}</span>
						</div>
						<small>{formatShortDate(version.createdAt)}</small>
						<div className="version-actions">
							<button type="button" onClick={() => onVersionDiff(version)}>
								<GitCompare size={13} aria-hidden />
								<span>Diff</span>
							</button>
							<button type="button" onClick={() => onVersionRestore(version)}>
								<RotateCcw size={13} aria-hidden />
								<span>Restore</span>
							</button>
							{versionStatuses[versionActionKey(version)] ? <span>{versionStatuses[versionActionKey(version)]}</span> : null}
						</div>
						<ArtifactVersionDiffView state={versionDiffs[versionActionKey(version)]} />
					</div>
				))}
			</ProvenanceSection>
			<ProvenanceSection title="Execution" empty="No producing execution record was found.">
				{executions.slice(0, 4).map((record) => (
					<div className="provenance-row" key={record.id}>
						<div>
							<strong>{record.title}</strong>
							<span>{record.kind} / {record.status} / {record.origin}</span>
						</div>
						<small>{formatShortDate(record.createdAt)}</small>
						{record.code ? <pre className="code-snippet">{record.code}</pre> : null}
					</div>
				))}
			</ProvenanceSection>
			<ProvenanceSection title="Claims" empty="No extracted claim cites this artifact yet.">
				{claims.slice(0, 5).map((claim) => (
					<div className={cx("provenance-row", claim.status)} key={claim.id}>
						<div>
							<strong>{claim.claim}</strong>
							<span>{claim.sourceTitle} / {claim.source}</span>
						</div>
						<small>{claim.status}</small>
					</div>
				))}
			</ProvenanceSection>
			<ProvenanceSection title="Verification" empty="No verification check cites this artifact yet.">
				{checks.slice(0, 4).map((check) => (
					<div className={cx("provenance-row", check.status)} key={check.id}>
						<div>
							<strong>{check.title}</strong>
							<span>{check.claim || check.detail}</span>
						</div>
						<small>{check.status}</small>
					</div>
				))}
			</ProvenanceSection>
		</div>
	);
}

function ArtifactVersionDiffView({ state }: { state?: VersionDiffState }) {
	if (!state) return null;
	if (state.loading) return <div className="diff-empty">Loading diff...</div>;
	if (state.error) return <div className="diff-empty error">{state.error}</div>;
	if (!state.diff) return null;
	if (!state.diff.isText) return <div className="diff-empty">Binary snapshot diff is recorded, but inline text diff is not available.</div>;
	const visibleLines = state.diff.lines.slice(0, 18);
	return (
		<div className="version-diff">
			<header>
				<span>+{state.diff.addedLines}</span>
				<span>-{state.diff.removedLines}</span>
				{state.diff.truncated ? <strong>truncated</strong> : null}
			</header>
			<pre>
				{visibleLines.map((line, index) => {
					const prefix = line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " ";
					return `${prefix} ${line.text}`;
				}).join("\n")}
				{state.diff.lines.length > visibleLines.length ? "\n[diff truncated in panel]" : ""}
			</pre>
		</div>
	);
}

function ProvenanceSection({
	children,
	empty,
	title,
}: {
	children: ReactNode;
	empty: string;
	title: string;
}) {
	const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
	return (
		<section className="provenance-section">
			<h3>{title}</h3>
			{hasChildren ? children : <div className="panel-empty">{empty}</div>}
		</section>
	);
}

function MemoryPanel({
	artifact,
	memories,
	notes,
	onRemoveMemory,
	onRemoveNote,
	onSaveMemory,
	onSaveNote,
	project,
	resources,
	run,
}: {
	artifact: WorkbenchArtifact | null;
	memories: WorkbenchMemoryRecord[];
	notes: WorkbenchNoteRecord[];
	onRemoveMemory: (id: string) => void;
	onRemoveNote: (id: string) => void;
	onSaveMemory: (record: Partial<WorkbenchMemoryRecord>) => void;
	onSaveNote: (record: Partial<WorkbenchNoteRecord>) => void;
	project?: WorkbenchProject;
	resources: WorkbenchResourceGroup[];
	run?: WorkbenchRun;
}) {
	const [scope, setScope] = useState<MemoryScopeFilter>(() => defaultMemoryScope(project, run, artifact));
	const [categoryId, setCategoryId] = useState("");
	const [memoryDraft, setMemoryDraft] = useState("");
	const [noteDraft, setNoteDraft] = useState("");
	const categoryResources = useMemo(() => {
		return resources
			.find((group) => group.id === "memory")
			?.resources.filter((resource) => resource.settingsCollection === "memoryCategories") ?? [];
	}, [resources]);
	const visibleMemories = useMemo(() => memoriesForScope(memories, scope, project, run, artifact), [artifact, memories, project, run, scope]);
	const targetNotes = useMemo(() => notesForTarget(notes, run, artifact), [artifact, notes, run]);
	const effectiveScope = scope === "all" ? "profile" : scope === "artifact" && !artifact ? "session" : scope === "session" && !run ? "project" : scope === "project" && !project ? "profile" : scope;
	const targetLabel = artifact ? artifact.name : run ? run.title : project?.name ?? "Workspace";
	const selectedCategory = categoryResources.find((resource) => resource.settingsRecordId === categoryId);

	function categoryName(id: string | undefined): string | undefined {
		return categoryResources.find((resource) => resource.settingsRecordId === id)?.name;
	}

	function saveMemory() {
		const body = memoryDraft.trim();
		if (!body) return;
		onSaveMemory({
			body,
			scope: effectiveScope,
			origin: "user",
			evidence: "stated",
			...(project ? { projectId: project.id } : {}),
			...(run && (effectiveScope === "session" || effectiveScope === "artifact") ? { sessionId: run.slug } : {}),
			...(artifact && effectiveScope === "artifact" ? { artifactPath: artifact.path } : {}),
			...(effectiveScope === "category" && selectedCategory?.settingsRecordId ? { categoryId: selectedCategory.settingsRecordId } : {}),
		});
		setMemoryDraft("");
	}

	function saveNote() {
		const content = noteDraft.trim();
		if (!content || !run) return;
		onSaveNote({
			content,
			...(project ? { projectId: project.id } : {}),
			targetType: artifact ? "artifact" : "session",
			targetFrameId: run.slug,
			...(artifact ? { targetArtifactPath: artifact.path } : {}),
		});
		setNoteDraft("");
	}

	return (
		<PanelScroll>
			<div className="memory-panel">
				<div className="memory-summary-grid">
					<div>
						<span>Memories</span>
						<strong>{memories.length}</strong>
					</div>
					<div>
						<span>Notes</span>
						<strong>{notes.length}</strong>
					</div>
					<div>
						<span>Categories</span>
						<strong>{categoryResources.length}</strong>
					</div>
				</div>

				<section className="memory-card" aria-label="Save memory">
					<header>
						<div>
							<strong>Save memory</strong>
							<span>{memoryScopeLabel(effectiveScope)} · {targetLabel}</span>
						</div>
					</header>
					<div className="memory-controls">
						<select value={scope} onChange={(event) => setScope(event.target.value as MemoryScopeFilter)} aria-label="Memory scope">
							<option value="profile">About you</option>
							<option value="project" disabled={!project}>Project</option>
							<option value="session" disabled={!run}>Session</option>
							<option value="artifact" disabled={!artifact}>Artifact</option>
							<option value="category" disabled={!categoryResources.length}>Category</option>
							<option value="all">All</option>
						</select>
						{scope === "category" ? (
							<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} aria-label="Memory category">
								<option value="">Choose category</option>
								{categoryResources.map((resource) => (
									<option key={resource.id} value={resource.settingsRecordId}>{resource.name}</option>
								))}
							</select>
						) : null}
					</div>
					<textarea
						value={memoryDraft}
						onChange={(event) => setMemoryDraft(event.target.value)}
						placeholder="Save source-backed research context, identifiers, methods, datasets, or reproducibility notes."
						rows={4}
					/>
					<button type="button" className="primary-action" onClick={saveMemory} disabled={!memoryDraft.trim() || (scope === "category" && !categoryId)}>
						<Save size={15} aria-hidden />
						<span>Save memory</span>
					</button>
				</section>

				<section className="memory-card" aria-label="Target notes">
					<header>
						<div>
							<strong>{artifact ? "Artifact notes" : "Session notes"}</strong>
							<span>{targetLabel}</span>
						</div>
						<span className="pill">{targetNotes.length}</span>
					</header>
					<textarea
						value={noteDraft}
						onChange={(event) => setNoteDraft(event.target.value)}
						placeholder={run ? "Add a note linked to the current research target." : "Open a session before saving a note."}
						rows={3}
						disabled={!run}
					/>
					<button type="button" className="secondary-action" onClick={saveNote} disabled={!noteDraft.trim() || !run}>
						<StickyNote size={15} aria-hidden />
						<span>Add note</span>
					</button>
				</section>

				<ProvenanceSection title="Saved memories" empty="No saved memory rows match this scope yet.">
					{visibleMemories.map((memory) => (
						<div key={memory.id} className="memory-row">
							<div>
								<p>{memory.body}</p>
								<div className="memory-row-meta">
									<span>{memoryScopeLabel(memory.scope)}</span>
									{categoryName(memory.categoryId) ? <span>{categoryName(memory.categoryId)}</span> : null}
									<span>{memory.evidence}</span>
									<span>{formatShortDate(memory.updatedAt)}</span>
								</div>
							</div>
							<button type="button" onClick={() => onRemoveMemory(memory.id)} aria-label="Delete memory">
								<Trash2 size={14} aria-hidden />
							</button>
						</div>
					))}
				</ProvenanceSection>

				<ProvenanceSection title="Target notes" empty="No notes are linked to this target yet.">
					{targetNotes.map((note) => (
						<div key={note.id} className="memory-row note-row">
							<div>
								<p>{note.content}</p>
								<div className="memory-row-meta">
									<span>{note.targetType}</span>
									<span>{formatShortDate(note.updatedAt)}</span>
								</div>
							</div>
							<button type="button" onClick={() => onRemoveNote(note.id)} aria-label="Delete note">
								<Trash2 size={14} aria-hidden />
							</button>
						</div>
					))}
				</ProvenanceSection>
			</div>
		</PanelScroll>
	);
}

function CustomizePanel({
	groups,
	onAction,
	onCloudStorage,
}: {
	groups: WorkbenchResourceGroup[];
	onAction: (action: ResourceAction) => void;
	onCloudStorage: () => void;
}) {
	const [query, setQuery] = useState("");
	const [statusFilter, setStatusFilter] = useState<ResourceDirectoryStatusFilter>("all");
	const [groupFilter, setGroupFilter] = useState<ResourceDirectoryGroupFilter>("all");
	const counts = useMemo(() => resourceDirectoryCounts(groups), [groups]);
	const groupOptions = useMemo(() => groups.filter((group) => group.resources.length > 0), [groups]);
	const visibleGroups = useMemo(() => filterResourceGroups(groups, {
		groupId: groupFilter,
		query,
		status: statusFilter,
	}), [groups, groupFilter, query, statusFilter]);
	const statusOptions: Array<{ id: ResourceDirectoryStatusFilter; label: string; count: number }> = [
		{ id: "all", label: "All", count: counts.resources },
		{ id: "configured", label: "Configured", count: counts.configured },
		{ id: "available", label: "Available", count: counts.available },
		{ id: "disabled", label: "Disabled", count: counts.disabled },
		{ id: "read-only", label: "Read-only", count: counts.readOnly },
	];
	return (
		<div className="panel-body customize-panel">
			<div className="resource-directory-header">
				<div>
					<h3>Capabilities</h3>
					<p>{counts.resources} resources across {counts.groups} groups</p>
				</div>
				<label className="resource-search">
					<Search size={15} aria-hidden />
					<input
						type="search"
						value={query}
						placeholder="Search capabilities"
						onChange={(event) => setQuery(event.currentTarget.value)}
					/>
				</label>
			</div>
			<div className="resource-filter-row" aria-label="Capability status filter">
				{statusOptions.filter((option) => option.id === "all" || option.count > 0).map((option) => (
					<button
						type="button"
						key={option.id}
						className={cx(statusFilter === option.id && "active")}
						onClick={() => setStatusFilter(option.id)}
					>
						{option.label}
						<span>{option.count}</span>
					</button>
				))}
			</div>
			<div className="resource-filter-row" aria-label="Capability group filter">
				<button
					type="button"
					className={cx(groupFilter === "all" && "active")}
					onClick={() => setGroupFilter("all")}
				>
					All groups
					<span>{counts.groups}</span>
				</button>
				{groupOptions.map((group) => (
					<button
						type="button"
						key={group.id}
						className={cx(groupFilter === group.id && "active")}
						onClick={() => setGroupFilter(group.id)}
					>
						{group.title}
						<span>{group.resources.length}</span>
					</button>
				))}
			</div>
			{visibleGroups.map((group) => (
				<section key={group.group.id} className="resource-group">
					<div className="resource-title">
						{group.group.id === "compute" ? <Database size={15} aria-hidden /> : <Layers size={15} aria-hidden />}
						<div>
							<h3>{group.group.title}</h3>
							<p>{group.group.description}</p>
						</div>
						<span>{group.resources.length} / {group.totalCount}</span>
					</div>
					<div className="resource-list">
						{group.resources.map((resource) => (
							<ResourceCard key={resource.id} resource={resource} onAction={onAction} onCloudStorage={onCloudStorage} />
						))}
					</div>
				</section>
			))}
			{!visibleGroups.length ? <div className="panel-empty">No matching capabilities were found.</div> : null}
		</div>
	);
}

function ResourceCard({
	resource,
	onAction,
	onCloudStorage,
}: {
	resource: WorkbenchResource;
	onAction: (action: ResourceAction) => void;
	onCloudStorage: () => void;
}) {
	const actions = resourceActions(resource);
	return (
		<article className="resource-card">
			<div className="resource-card-head">
				<strong>{resource.name}</strong>
				<span className={cx("resource-status", resource.status)}>{resource.status}</span>
			</div>
			<p>{resource.description}</p>
			<div className="resource-card-meta">
				{resource.command ? <code>{resource.command}</code> : null}
				{resource.path ? <code>{resource.path}</code> : null}
				{resource.detail ? <code>{resource.detail}</code> : null}
			</div>
			{resource.diagnostics?.length ? (
				<ul className="resource-diagnostics">
					{resource.diagnostics.slice(0, 4).map((item) => <li key={item}>{item}</li>)}
					{resource.diagnostics.length > 4 ? <li>{resource.diagnostics.length - 4} more diagnostics</li> : null}
				</ul>
			) : null}
			{resource.tools?.length ? (
				<div className="resource-tools">
					{resource.tools.slice(0, 8).map((tool) => (
						<span key={tool.name} title={tool.description}>{tool.name}</span>
					))}
					{resource.tools.length > 8 ? <span>{resource.tools.length - 8} more tools</span> : null}
				</div>
			) : null}
			<div className="resource-tags">
				{resource.tags.slice(0, 8).map((tag) => <span key={tag}>{tag}</span>)}
				{resource.tags.length > 8 ? <span>{resource.tags.length - 8} more</span> : null}
			</div>
			{actions.length ? (
				<div className="resource-actions">
					{resource.id === "cloud-storage" ? (
						<button type="button" onClick={onCloudStorage}>Open storage</button>
					) : null}
					{actions.map((action) => (
						<button type="button" key={`${action.kind}-${action.label}`} onClick={() => onAction(action)}>
							{action.label}
						</button>
					))}
				</div>
			) : resource.id === "cloud-storage" ? (
				<div className="resource-actions">
					<button type="button" onClick={onCloudStorage}>Open storage</button>
				</div>
			) : null}
			<footer>{resource.source}</footer>
		</article>
	);
}

createRoot(document.getElementById("root")!).render(<App />);
