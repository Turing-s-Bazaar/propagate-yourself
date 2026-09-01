import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { startWorkbenchServer } from "../src/workbench/server.js";
import {
	artifactChecksForPath,
	artifactExecutionsForPath,
	artifactVersionsForPath,
} from "../workbench-web/src/artifacts.js";
import {
	artifactCanEditContent,
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
} from "../workbench-web/src/artifact-actions.js";
import {
	artifactCategoryCounts,
	artifactsForFileScope,
	defaultArtifactPathForRun,
	fileScopeCounts,
	filterArtifactsForBrowser,
	primaryArtifactPathForRun,
} from "../workbench-web/src/files.js";
import {
	isTerminalChatStreamEvent,
	parseStreamChunk,
	patchLastAssistant,
	upsertAssistantTool,
} from "../workbench-web/src/stream.js";
import { resourceActions, specialistLabel } from "../workbench-web/src/resources.js";
import {
	connectorApprovalForEvent,
	connectorApprovalGrantId,
	connectorApprovalRetryPrompt,
	connectorApprovalScopeFromText,
	parseConnectorApprovalScope,
	toolActivityView,
	toolActivityViews,
} from "../workbench-web/src/tool-activity.js";
import {
	defaultWorkbenchRoute,
	parseWorkbenchRoute,
	resolveWorkbenchRoute,
	routeBaseForPath,
	workbenchHomePath,
	workbenchProjectPath,
	workbenchRoutesEqual,
} from "../workbench-web/src/routes.js";
import { parseTensorArchivePreview } from "../workbench-web/src/tensor-preview.js";
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
} from "../workbench-web/src/notebook.js";
import {
	attachmentDownloadUrl,
	filterUploadsForBrowser,
	uploadPreviewText,
} from "../workbench-web/src/uploads.js";
import {
	activeComposerTrigger,
	applyComposerSuggestion,
	beginComposerTrigger,
	composerSuggestions,
} from "../workbench-web/src/composer.js";
import {
	buildClaudeScienceReferenceResources,
	readClaudeScienceInstall,
} from "../src/workbench/claude-science.js";
import type {
	WorkbenchArtifact,
	WorkbenchArtifactVersion,
	WorkbenchChatSession,
	WorkbenchComputeJobRecord,
	WorkbenchNotebookCell,
	WorkbenchNotebookEnvironmentRecord,
	WorkbenchNotebookKernelRecord,
	WorkbenchProject,
	WorkbenchResource,
	WorkbenchResourceGroup,
	WorkbenchRun,
	WorkbenchState,
	WorkbenchToolEvent,
} from "../workbench-web/src/types.js";

function makeAppRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-react-shell-"));
	mkdirSync(join(root, "dist", "workbench-web", "assets"), { recursive: true });
	writeFileSync(join(root, "dist", "workbench-web", "index.html"), [
		"<!doctype html>",
		"<html>",
		"<head><title>Feynman Science</title></head>",
		"<body><div id=\"root\"></div><script type=\"module\" src=\"/app-shell/assets/app.js\"></script></body>",
		"</html>",
	].join(""));
	writeFileSync(join(root, "dist", "workbench-web", "assets", "app.js"), "console.log('react-shell');\n");
	writeFileSync(join(root, "dist", "workbench-web", "assets", "worker.mjs"), "export const worker = true;\n");
	return root;
}

function sessionFixture(): WorkbenchChatSession {
	return {
		id: "scaling-laws",
		projectId: "workspace",
		title: "Scaling laws",
		createdAt: "2026-07-02T00:00:00.000Z",
		updatedAt: "2026-07-02T00:00:00.000Z",
		status: "running",
		config: {
			delegation: false,
			autoReview: false,
			memory: false,
			specialist: "None",
			compute: "local",
			model: "",
		},
		piSession: {
			id: "feynman-workbench-scaling-laws",
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
		messages: [
			{
				id: "user-1",
				role: "user",
				content: "stream",
				createdAt: "2026-07-02T00:00:00.000Z",
				status: "complete",
				toolEvents: [],
			},
			{
				id: "assistant-1",
				role: "assistant",
				content: "Starting",
				createdAt: "2026-07-02T00:00:01.000Z",
				status: "running",
				toolEvents: [],
			},
		],
	};
}

function artifactFixture(path: string, slug: string, category: WorkbenchArtifact["category"], updatedAtMs: number): WorkbenchArtifact {
	const name = path.split("/").at(-1) ?? path;
	return {
		path,
		name,
		title: name,
		category,
		extension: name.includes(".") ? `.${name.split(".").at(-1)}` : "",
		contentType: "text/plain",
		sizeBytes: 100 + updatedAtMs,
		updatedAt: `2026-07-02T00:00:0${updatedAtMs}.000Z`,
		updatedAtMs,
		slug,
		previewable: true,
	};
}

function projectFixture(overrides: Partial<WorkbenchProject> & Pick<WorkbenchProject, "id" | "kind" | "runSlugs">): WorkbenchProject {
	const { id, kind, runSlugs, ...rest } = overrides;
	const updatedAt = rest.updatedAt ?? "2026-07-02T00:00:00.000Z", updatedAtMs = rest.updatedAtMs ?? 1;
	return {
		id,
		name: rest.name ?? id,
		description: rest.description ?? "",
		kind,
		userId: "local-workbench",
		uploadsFrameId: `uploads-${id}`,
		memoryEnabled: false,
		runSlugs,
		artifactPaths: [],
		sessionCount: runSlugs.length,
		artifactCount: 0,
		createdAt: rest.createdAt ?? updatedAt,
		createdAtMs: rest.createdAtMs ?? updatedAtMs,
		updatedAt,
		updatedAtMs,
		...rest,
	};
}

test("workbench server serves the authenticated React app shell on default and app-shell routes", async () => {
	const appRoot = makeAppRoot();
	const workingDir = mkdtempSync(join(tmpdir(), "feynman-react-shell-workspace-"));
	const handle = await startWorkbenchServer({
		appRoot,
		workingDir,
		token: "secret",
		port: 0,
	});
	try {
		const unauthorized = await fetch(`${handle.url}projects/active-plans/frames/open-science-workbench`);
		assert.equal(unauthorized.status, 401);

		const shell = await fetch(`${handle.url}projects/active-plans/frames/open-science-workbench?token=secret`);
		assert.equal(shell.status, 200);
		assert.equal(shell.headers.get("content-type"), "text/html; charset=utf-8");
		assert.match(await shell.text(), /\/app-shell\/assets\/app\.js/);

		const launcher = await fetch(`${handle.url}?token=secret`);
		assert.equal(launcher.status, 200);
		assert.match(await launcher.text(), /\/app-shell\/assets\/app\.js/);

		const appShellAlias = await fetch(`${handle.url}app-shell/projects/active-plans/frames/open-science-workbench?token=secret`);
		assert.equal(appShellAlias.status, 200);
		assert.match(await appShellAlias.text(), /\/app-shell\/assets\/app\.js/);

		const asset = await fetch(`${handle.url}app-shell/assets/app.js?token=secret`);
		assert.equal(asset.status, 200);
		assert.equal(asset.headers.get("content-type"), "text/javascript; charset=utf-8");
		assert.match(await asset.text(), /react-shell/);

		const moduleAsset = await fetch(`${handle.url}app-shell/assets/worker.mjs?token=secret`);
		assert.equal(moduleAsset.status, 200);
		assert.equal(moduleAsset.headers.get("content-type"), "text/javascript; charset=utf-8");
		assert.match(await moduleAsset.text(), /worker = true/);
	} finally {
		await handle.close();
		rmSync(appRoot, { recursive: true, force: true });
		rmSync(workingDir, { recursive: true, force: true });
	}
});

test("React shell route helpers support product routes and the app-shell alias", () => {
	assert.equal(routeBaseForPath("/projects/workspace/frames/run-a"), "");
	assert.equal(routeBaseForPath("/app-shell/projects/workspace/frames/run-a"), "/app-shell");
	assert.deepEqual(parseWorkbenchRoute("/projects/workspace/frames/run-a"), {
		projectId: "workspace",
		runSlug: "run-a",
	});
	assert.deepEqual(parseWorkbenchRoute("/app-shell/projects/active%20plans/frames/open%20science"), {
		projectId: "active plans",
		runSlug: "open science",
	});
	assert.equal(parseWorkbenchRoute("/projects"), null);
	assert.equal(workbenchProjectPath("workspace", "run-a", "/projects/workspace/frames/old"), "/projects/workspace/frames/run-a");
	assert.equal(workbenchProjectPath("workspace", "run-a", "/app-shell/projects/workspace/frames/old"), "/app-shell/projects/workspace/frames/run-a");
	assert.equal(
		workbenchProjectPath("workspace", "run-a", "/projects/workspace/frames/old", { artifactPath: "outputs/notes.md" }),
		"/projects/workspace/frames/run-a?artifact=outputs%2Fnotes.md",
	);
	assert.equal(workbenchHomePath("/projects/workspace/frames/old"), "/");
	assert.equal(workbenchHomePath("/app-shell/projects/workspace/frames/old"), "/app-shell/");
});

test("React shell route helpers canonicalize stale project frame links", () => {
	const routeState = {
			projects: [
				projectFixture({
					id: "active-plans",
					name: "Active Plans",
					kind: "plans",
					runSlugs: ["open-science"],
					artifactCount: 1,
					primaryRunSlug: "open-science",
				}),
				projectFixture({
					id: "workspace",
					name: "Workspace",
					kind: "workspace",
					runSlugs: ["scaling-laws"],
					artifactCount: 1,
					primaryRunSlug: "scaling-laws",
				}),
			],
		runs: [
			{
				slug: "open-science",
				title: "Open Science",
				taskSummary: "",
				status: "planned",
				source: "chat",
				projectId: "active-plans",
				updatedAt: "2026-07-02T00:00:00.000Z",
				updatedAtMs: 1,
				artifactCount: 1,
				notebookCellCount: 0,
				categories: [],
				lastArtifactNames: [],
				hasPlan: false,
				hasProvenance: false,
				hasVerification: false,
			},
			{
				slug: "scaling-laws",
				title: "Scaling Laws",
				taskSummary: "",
				status: "artifact",
				source: "artifact",
				projectId: "workspace",
				updatedAt: "2026-07-02T00:00:00.000Z",
				updatedAtMs: 1,
				artifactCount: 1,
				notebookCellCount: 0,
				categories: [],
				lastArtifactNames: [],
				hasPlan: false,
				hasProvenance: false,
				hasVerification: false,
			},
		],
	} satisfies Pick<WorkbenchState, "projects" | "runs">;

	assert.deepEqual(defaultWorkbenchRoute(routeState), { projectId: "active-plans", runSlug: "open-science" });
	assert.deepEqual(resolveWorkbenchRoute(routeState, { projectId: "workspace", runSlug: "scaling-laws" }), {
		projectId: "workspace",
		runSlug: "scaling-laws",
	});
	assert.deepEqual(resolveWorkbenchRoute(routeState, { projectId: "workspace", runSlug: "missing-run" }), {
		projectId: "workspace",
		runSlug: "scaling-laws",
	});
	assert.deepEqual(resolveWorkbenchRoute(routeState, { projectId: "missing-project", runSlug: "scaling-laws" }), {
		projectId: "active-plans",
		runSlug: "open-science",
	});
	assert.equal(workbenchRoutesEqual({ projectId: "workspace", runSlug: "a" }, { projectId: "workspace", runSlug: "a" }), true);
	assert.equal(workbenchRoutesEqual({ projectId: "workspace", runSlug: "a" }, { projectId: "workspace", runSlug: "b" }), false);
});

test("React shell stream helpers parse SSE frames and merge assistant tool events", () => {
	const events: Array<{ type: string; content?: string; state?: { runs: Array<{ artifactCount: number }> } }> = [];
	const remainder = parseStreamChunk([
		"event: delta",
		"data: {\"type\":\"delta\",\"content\":\"live reply\"}",
		"",
		"event: tool",
		"data: {\"type\":\"tool\",\"toolEvent\":{\"id\":\"tool-1\",\"label\":\"Run python\",\"status\":\"running\"}}",
		"",
		"event: done",
		"data: {\"type\":\"done\",\"session\":{\"id\":\"scaling-laws\",\"projectId\":\"workspace\",\"title\":\"Scaling laws\",\"createdAt\":\"2026-07-02T00:00:00.000Z\",\"updatedAt\":\"2026-07-02T00:00:00.000Z\",\"status\":\"complete\",\"config\":{\"delegation\":false,\"autoReview\":false,\"memory\":false,\"specialist\":\"None\",\"compute\":\"local\",\"model\":\"\"},\"piSession\":{\"id\":\"feynman-workbench-scaling-laws\",\"status\":\"pending\",\"messageCount\":0,\"userMessages\":0,\"assistantMessages\":0,\"toolResults\":0,\"toolCalls\":0,\"bashExecutions\":0,\"customMessages\":0,\"branchCount\":0,\"timeline\":[],\"tools\":[]},\"attachments\":[],\"messages\":[]},\"state\":{\"runs\":[{\"artifactCount\":1}],\"projects\":[],\"artifacts\":[]}}",
		"",
		"event: tool",
	].join("\n"), (event) => events.push(event));

	assert.equal(events.length, 3);
	assert.equal(events[0]?.type, "delta");
	assert.equal(events[0]?.content, "live reply");
	assert.equal(events[2]?.type, "done");
	assert.equal(events[2]?.state?.runs[0]?.artifactCount, 1);
	assert.equal(remainder, "event: tool");
	assert.equal(isTerminalChatStreamEvent(events[0] as Parameters<typeof isTerminalChatStreamEvent>[0]), false);
	assert.equal(isTerminalChatStreamEvent(events[2] as Parameters<typeof isTerminalChatStreamEvent>[0]), true);
	assert.equal(isTerminalChatStreamEvent({ type: "error", message: "Internal server error." }), true);

	let session = patchLastAssistant(sessionFixture(), { content: "live reply", status: "running" });
	session = upsertAssistantTool(session, { id: "tool-1", label: "Run python", status: "running" });
	session = upsertAssistantTool(session, { id: "tool-1", label: "Run python", status: "complete", output: "ok" });

	const assistant = session.messages.at(-1);
	assert.equal(assistant?.content, "live reply");
	assert.equal(assistant?.toolEvents.length, 1);
	assert.equal(assistant?.toolEvents[0]?.status, "complete");
	assert.equal(assistant?.toolEvents[0]?.output, "ok");
});

test("React shell tool activity helpers classify connector approvals", () => {
	const approvalText = "Connector tool search_pubmed is waiting for approval. A pending ask grant was added in Workbench Settings > Permissions with scope connector:lab-mcp:search_pubmed; approve it, block it, or enable skip approvals on Local Lab MCP.";
	const pending = {
		id: "tool-approval",
		label: "Call Local Lab MCP",
		status: "error",
		toolName: "feynman_connector_call",
		input: "{\"query\":\"BRCA1\"}",
		output: approvalText,
		isError: true,
	} satisfies WorkbenchToolEvent;
	const groups = [
		{
			id: "connectors",
			title: "Connectors",
			description: "Feynman-owned connectors",
			resources: [{
				id: "custom-connector-lab-mcp",
				name: "Local Lab MCP",
				description: "Local MCP server for lab literature tools.",
				status: "configured",
				source: "Custom MCP connector",
				settingsCollection: "customConnectors",
				settingsRecordId: "lab-mcp",
				tags: ["mcp"],
			}],
		},
		{
			id: "permissions",
			title: "Permissions",
			description: "Tool grants",
			resources: [{
				id: "permission-grant-lab-mcp-search-pubmed",
				name: "Local Lab MCP search_pubmed",
				description: "Pending approval requested by feynman_connector_call.",
				status: "available",
				source: "Workbench grant",
				detail: "connector:lab-mcp:search_pubmed | ask",
				settingsCollection: "permissionGrants",
				settingsRecordId: "connector-lab-mcp-search_pubmed",
				tags: ["grant", "ask"],
			}],
		},
	] satisfies WorkbenchResourceGroup[];

	assert.equal(connectorApprovalScopeFromText(approvalText), "connector:lab-mcp:search_pubmed");
	assert.deepEqual(parseConnectorApprovalScope("connector:lab-mcp:search_pubmed"), {
		connectorId: "lab-mcp",
		toolName: "search_pubmed",
	});
	assert.equal(connectorApprovalGrantId("Lab MCP", "search/pubmed"), "connector-lab-mcp-search-pubmed");

	const approval = connectorApprovalForEvent(pending, groups);
	assert.equal(approval?.connectorName, "Local Lab MCP");
	assert.equal(approval?.decision, "ask");
	assert.equal(approval?.exactRecord.scope, "connector:lab-mcp:search_pubmed");
	assert.equal(approval?.wildcardRecord.scope, "connector:lab-mcp:*");

	const view = toolActivityView(pending, groups);
	assert.equal(view.tone, "approval");
	assert.equal(view.statusLabel, "Needs approval");
	assert.equal(view.approval?.toolName, "search_pubmed");
	assert.equal(view.summary, "{\"query\":\"BRCA1\"}");
	assert.match(view.output ?? "", /waiting for approval/);

	const complete = {
		id: "tool-complete",
		label: "Search PubMed",
		status: "complete",
		toolName: "feynman_science_database_search",
		output: "PMID 12345: BRCA1 repair evidence",
	} satisfies WorkbenchToolEvent;
	const activity = toolActivityViews([pending, complete], groups);
	assert.equal(activity.counts.total, 2);
	assert.equal(activity.counts.approval, 1);
	assert.equal(activity.counts.complete, 1);
	assert.equal(activity.hiddenCount, 0);

	const approvedGroups = groups.map((group) => group.id === "permissions"
		? {
			...group,
			resources: group.resources.map((resource) => ({
				...resource,
				status: "configured" as const,
				detail: "connector:lab-mcp:search_pubmed | allow",
				tags: ["grant", "allow"],
			})),
		}
		: group
	);
	const approvedView = toolActivityView(pending, approvedGroups);
	assert.equal(approvedView.tone, "complete");
	assert.equal(approvedView.statusLabel, "Approved");
	assert.match(connectorApprovalRetryPrompt(approvedView.approval!, approvedView.input), /Continue the blocked connector call/);
	assert.match(connectorApprovalRetryPrompt(approvedView.approval!, approvedView.input), /Connector: Local Lab MCP/);
	assert.match(connectorApprovalRetryPrompt(approvedView.approval!, approvedView.input), /Tool: search_pubmed/);
	assert.match(connectorApprovalRetryPrompt(approvedView.approval!, approvedView.input), /Grant: connector:lab-mcp:search_pubmed/);
	assert.match(connectorApprovalRetryPrompt(approvedView.approval!, approvedView.input), /Original arguments: \{"query":"BRCA1"\}/);
});

test("React shell tensor helpers parse NumPy array and archive artifacts", async () => {
	const plddt = await parseTensorArchivePreview(
		readFileSync("fixtures/open-science-seeds/example_enzyme_engineering/plddt.npy"),
		".npy",
		"plddt.npy",
	);
	assert.equal(plddt.format, "npy");
	assert.equal(plddt.arrays.length, 1);
	const plddtArray = plddt.arrays[0]!;
	assert.equal(plddtArray.name, "plddt.npy");
	assert.equal(plddtArray.dtype, "f4");
	assert.deepEqual(plddtArray.shape, [326]);
	assert.equal(plddtArray.valueCount, 326);
	assert.ok(plddtArray.min !== undefined && plddtArray.max !== undefined);
	assert.equal(plddtArray.vector?.points.length, 96);

	const archive = await parseTensorArchivePreview(
		readFileSync("fixtures/open-science-seeds/example_enzyme_engineering/is621_esmfold.npz"),
		".npz",
		"is621_esmfold.npz",
	);
	assert.equal(archive.format, "npz");
	assert.equal(archive.arraysTruncated, false);
	assert.equal(archive.arrays.length, 4);
	assert.deepEqual(new Set(archive.arrays.map((array) => array.name)), new Set(["design_mask.npy", "log_p.npy", "mask.npy", "S.npy"]));
	const logProbs = archive.arrays.find((array) => array.name === "log_p.npy");
	assert.deepEqual(logProbs?.shape, [1, 326, 21]);
	assert.equal(logProbs?.matrix?.planeLabel, "slice 0");
	const sequenceIndices = archive.arrays.find((array) => array.name === "S.npy");
	assert.equal(sequenceIndices?.dtype, "i8");
	assert.equal(sequenceIndices?.valueCount, 326);
});

test("React shell artifact action helpers mirror artifact edit and version API contracts", () => {
	const editable = artifactFixture("outputs/notes.md", "run-a", "output", 1);
	const image = {
		...editable,
		path: "outputs/figure.png",
		name: "figure.png",
		title: "figure.png",
		extension: ".png",
		contentType: "image/png",
	};
	const version = {
		id: "version-1",
		artifactPath: "outputs/notes.md",
		versionNumber: 1,
		label: "v1",
		source: "workspace",
		contentType: "text/markdown",
		sizeBytes: 12,
		createdAt: "2026-07-02T00:00:00.000Z",
		createdAtMs: 1,
		messages: [],
		inputPaths: [],
		outputPaths: ["outputs/notes.md"],
		isIntermediate: false,
		isCheckpoint: false,
		annotations: [],
	} satisfies WorkbenchArtifactVersion;

	assert.equal(artifactCanEditContent(editable), true);
	assert.equal(artifactEditDisabledReason(image), "This artifact type is viewed as media.");
	assert.equal(artifactEditReadPath("outputs/notes.md"), "/api/artifact/edit?path=outputs%2Fnotes.md");
	assert.deepEqual(artifactVersionActionBody(version), { artifactPath: "outputs/notes.md", versionId: "version-1" });
	assert.equal(versionActionKey(version), "outputs/notes.md::version-1");
	assert.deepEqual(artifactMutationBody("outputs/notes.md", "rename", " Revised notes "), {
		artifactPath: "outputs/notes.md",
		action: "rename",
		displayName: "Revised notes",
	});
	assert.deepEqual(artifactMutationBody("outputs/notes.md", "star"), {
		artifactPath: "outputs/notes.md",
		action: "star",
	});

	const hiddenItem = {
		artifactPath: "outputs/hidden.md",
		title: "Hidden",
		status: "hidden",
		starred: false,
		hidden: true,
		deleted: false,
		updatedAt: "2026-07-02T00:00:00.000Z",
		updatedAtMs: 1,
	} as const;
	const deletedItem = {
		...hiddenItem,
		artifactPath: "outputs/deleted.md",
		title: "Deleted",
		status: "deleted",
		deleted: true,
	} as const;
	assert.equal(artifactRecoveryAction(hiddenItem), "unhide");
	assert.equal(artifactRecoveryLabel(hiddenItem), "Unhide");
	assert.equal(artifactRecoveryAction(deletedItem), "restore");
	assert.equal(artifactRecoveryLabel(deletedItem), "Restore");

	const targets = [
		{ id: "missing", name: "Missing S3", provider: "s3", envVar: "S3_TARGET", status: "missing", detail: "Environment value missing" },
		{ id: "configured", name: "Local export", provider: "local", envVar: "LOCAL_TARGET", status: "configured", detail: "Local filesystem export target configured" },
	] as const;
	const configured = configuredCloudExportTarget([...targets]);
	assert.equal(configured?.id, "configured");
	assert.deepEqual(configured ? cloudExportBody("outputs/notes.md", configured) : null, {
		artifactPath: "outputs/notes.md",
		credentialId: "configured",
	});
	assert.equal(
		artifactReferenceUrl(editable, "workspace", "http://127.0.0.1:6244", "/projects/workspace/frames/run-a"),
		"http://127.0.0.1:6244/projects/workspace/frames/run-a?artifact=outputs%2Fnotes.md",
	);
	assert.equal(artifactMetadataFilename(editable), "notes.md.metadata.json");
	const metadata = artifactMetadataPayload(editable, {
		artifactAnnotations: [],
		artifactVersions: [version],
		checks: [],
		execution: [],
		runs: [{ slug: "run-a", title: "Run A", status: "artifact", taskSummary: "Inspect notes" }],
	} as unknown as WorkbenchState, { content: "hello", truncated: false }, "http://example.test/artifact") as {
		artifact: { path: string };
		link: string;
		preview: { contentLength?: number };
		versions: Array<{ id: string }>;
	};
	assert.equal(metadata.artifact.path, "outputs/notes.md");
	assert.equal(metadata.link, "http://example.test/artifact");
	assert.equal(metadata.preview.contentLength, 5);
	assert.equal(metadata.versions[0]?.id, "version-1");
});

test("React shell artifact helpers gather versions, execution, and verification by path", () => {
	const state = {
		artifactVersions: [
			{
				id: "v1",
				artifactPath: "outputs/result.md",
				versionNumber: 1,
				label: "Version 1",
				source: "workspace",
				contentType: "text/markdown",
				sizeBytes: 12,
				checksum: "1234567890abcdef",
				createdAt: "2026-07-02T00:00:00.000Z",
				createdAtMs: 1,
				messages: [],
				inputPaths: [],
				outputPaths: ["outputs/result.md"],
				isIntermediate: false,
				isCheckpoint: false,
				annotations: [],
			},
			{
				id: "v2",
				artifactPath: "outputs/result.md",
				versionNumber: 2,
				label: "Version 2",
				source: "pi",
				contentType: "text/markdown",
				sizeBytes: 16,
				checksum: "abcdef1234567890",
				createdAt: "2026-07-02T00:01:00.000Z",
				createdAtMs: 2,
				messages: [],
				inputPaths: ["papers/source.pdf"],
				outputPaths: ["outputs/result.md"],
				isIntermediate: false,
				isCheckpoint: true,
				annotations: [],
			},
		],
		execution: [
			{
				id: "exec-1",
				title: "Synthesize result",
				kind: "python",
				status: "complete",
				origin: "pi",
				createdAt: "2026-07-02T00:00:00.000Z",
				createdAtMs: 1,
				detail: "wrote result",
				inputPaths: ["papers/source.pdf"],
				outputPaths: ["outputs/result.md"],
			},
			{
				id: "exec-2",
				title: "Read result",
				kind: "verification",
				status: "complete",
				origin: "workspace",
				createdAt: "2026-07-02T00:02:00.000Z",
				createdAtMs: 2,
				detail: "checked result",
				inputPaths: ["outputs/result.md"],
				outputPaths: [],
			},
		],
		checks: [
			{
				id: "check-1",
				title: "Citation check",
				status: "pass",
				claim: "All claims cite source rows.",
				detail: "verified",
				evidencePaths: ["outputs/result.md"],
				createdAt: "2026-07-02T00:03:00.000Z",
				createdAtMs: 3,
			},
		],
	} as unknown as WorkbenchState;

	assert.deepEqual(artifactVersionsForPath(state, "outputs/result.md").map((version) => version.id), ["v2", "v1"]);
	assert.deepEqual(artifactExecutionsForPath(state, "outputs/result.md").map((record) => record.id), ["exec-2", "exec-1"]);
	assert.deepEqual(artifactChecksForPath(state, "outputs/result.md").map((check) => check.id), ["check-1"]);
});

test("React shell file browser helpers scope, count, and filter artifacts", () => {
	const run = {
		slug: "run-a",
		title: "Run A",
		taskSummary: "",
		status: "planned",
		source: "chat",
		projectId: "project-a",
		updatedAt: "2026-07-02T00:00:00.000Z",
		updatedAtMs: 1,
		artifactCount: 2,
		artifactPaths: ["outputs/current-plan.md", "outputs/chat-output.md"],
		notebookCellCount: 0,
		categories: [],
		lastArtifactNames: [],
		hasPlan: false,
		hasProvenance: false,
		hasVerification: false,
	} satisfies WorkbenchRun;
	const project = projectFixture({
		id: "project-a",
		name: "Project A",
		kind: "custom",
		runSlugs: ["run-a", "run-b"],
		artifactPaths: ["outputs/current-plan.md", "outputs/project-table.csv", "outputs/chat-output.md"],
		artifactCount: 3,
		primaryRunSlug: "run-a",
	});
	const state = {
		artifacts: [
			artifactFixture("outputs/current-plan.md", "run-a", "plan", 1),
			artifactFixture("outputs/project-table.csv", "run-b", "data", 3),
			artifactFixture("papers/workspace-note.md", "run-c", "paper", 2),
			artifactFixture("outputs/chat-output.md", "chat-output", "output", 4),
		],
	} as unknown as WorkbenchState;

	assert.deepEqual(artifactsForFileScope(state, project, run, "run").map((artifact) => artifact.path), [
		"outputs/chat-output.md",
		"outputs/current-plan.md",
	]);
	assert.deepEqual(artifactsForFileScope(state, project, run, "project").map((artifact) => artifact.path), [
		"outputs/chat-output.md",
		"outputs/project-table.csv",
		"outputs/current-plan.md",
	]);
	assert.deepEqual(fileScopeCounts(state, project, run).map((item) => [item.scope, item.count]), [
		["run", 2],
		["project", 3],
		["workspace", 4],
	]);
	assert.deepEqual(artifactCategoryCounts(artifactsForFileScope(state, project, run, "project")), [
		{ category: "plan", count: 1 },
		{ category: "data", count: 1 },
		{ category: "output", count: 1 },
	]);
	assert.deepEqual(
		filterArtifactsForBrowser(artifactsForFileScope(state, project, run, "workspace"), "table", "data").map((artifact) => artifact.path),
		["outputs/project-table.csv"],
	);
});

test("React shell file helpers choose the run artifact for the right panel default", () => {
	const fallbackArtifact = artifactFixture("outputs/fallback.md", "run-a", "output", 1);
	const primaryArtifact = artifactFixture("outputs/primary.md", "run-a", "output", 2);
	const missingArtifact = artifactFixture("outputs/missing.md", "run-a", "output", 3);
	const primaryRun = {
		slug: "run-a",
		title: "Run A",
		taskSummary: "",
		status: "chat",
		source: "chat",
		projectId: "project-a",
		updatedAt: "2026-07-02T00:00:00.000Z",
		updatedAtMs: 1,
		artifactCount: 2,
		artifactPaths: ["outputs/fallback.md", "outputs/primary.md"],
		primaryArtifact,
		notebookCellCount: 0,
		categories: [],
		lastArtifactNames: [],
		hasPlan: false,
		hasProvenance: false,
		hasVerification: false,
	} satisfies WorkbenchRun;
	const stalePrimaryRun = {
		...primaryRun,
		primaryArtifact: missingArtifact,
	} satisfies WorkbenchRun;
	const state = {
		artifacts: [fallbackArtifact, primaryArtifact],
	} as unknown as WorkbenchState;

	assert.equal(primaryArtifactPathForRun(primaryRun), "outputs/primary.md");
	assert.equal(defaultArtifactPathForRun(state, primaryRun), "outputs/primary.md");
	assert.equal(defaultArtifactPathForRun(state, stalePrimaryRun), "outputs/fallback.md");
	assert.equal(defaultArtifactPathForRun(state, undefined), null);
});

test("React shell upload helpers mirror attachment download and filtering contracts", () => {
	const uploads = [
		{
			id: "upload-1",
			name: "cells.csv",
			contentType: "text/csv",
			sizeBytes: 42,
			createdAt: "2026-07-02T00:00:00.000Z",
			storagePath: ".feynman/workbench/uploads/scaling-laws/upload-1-cells.csv",
			previewText: "gene,count\nTP53,42",
		},
		{
			id: "upload-2",
			name: "figure.png",
			contentType: "image/png",
			sizeBytes: 100,
			createdAt: "2026-07-02T00:00:01.000Z",
			storagePath: ".feynman/workbench/uploads/scaling-laws/upload-2-figure.png",
			truncated: true,
		},
	] satisfies WorkbenchChatSession["attachments"];

	assert.equal(
		attachmentDownloadUrl({
			sessionId: "scaling-laws",
			projectId: "workspace",
			title: "Scaling Laws",
			attachmentId: "upload-1",
		}),
		"/api/chat/attachment/download?sessionId=scaling-laws&projectId=workspace&title=Scaling+Laws&attachmentId=upload-1",
	);
	assert.deepEqual(filterUploadsForBrowser(uploads, "TP53").map((upload) => upload.id), ["upload-1"]);
	assert.deepEqual(filterUploadsForBrowser(uploads, "image/png").map((upload) => upload.id), ["upload-2"]);
	assert.match(uploadPreviewText(uploads[0]!), /TP53,42/);
	assert.match(uploadPreviewText(uploads[1]!), /No text preview/);
});

test("React shell composer helpers expose artifact session and command mentions", () => {
	const runA = {
		slug: "enzyme-run",
		title: "Enzyme engineering",
		taskSummary: "Protein engineering workflow",
		status: "verified",
		source: "artifact",
		updatedAt: "2026-07-03T00:00:00.000Z",
		updatedAtMs: 20,
		artifactCount: 2,
		notebookCellCount: 0,
		categories: [],
		lastArtifactNames: [],
		hasPlan: true,
		hasProvenance: true,
		hasVerification: false,
		projectId: "open-science",
	} satisfies WorkbenchRun;
	const runB = {
		...runA,
		slug: "crispr-run",
		title: "CRISPR design",
		taskSummary: "Guide design workflow",
		updatedAtMs: 10,
		hasPlan: false,
		hasProvenance: false,
	} satisfies WorkbenchRun;
	const project = projectFixture({
		id: "open-science",
		name: "Open Science",
		description: "Seed workflows",
		kind: "seeds",
		runSlugs: ["enzyme-run", "crispr-run"],
		artifactPaths: [
			"outputs/open-science-seeds/example_enzyme_engineering/plddt.npy",
			"outputs/open-science-seeds/example_crispr_screen/final_kinome_library.csv",
		],
		primaryRunSlug: "enzyme-run",
		sessionCount: 2,
		artifactCount: 3,
		createdAt: "2026-07-03T00:00:00.000Z",
		createdAtMs: 20,
		updatedAt: "2026-07-03T00:00:00.000Z",
		updatedAtMs: 20,
	});
	const plddtArtifact = {
		path: "outputs/open-science-seeds/example_enzyme_engineering/plddt.npy",
		name: "plddt.npy",
		title: "pLDDT tensor",
		category: "data",
		extension: ".npy",
		contentType: "application/x-npy",
		sizeBytes: 1400,
		updatedAt: "2026-07-03T00:00:00.000Z",
		updatedAtMs: 20,
		slug: "enzyme-run",
		previewable: false,
	} satisfies WorkbenchArtifact;
	const crisprArtifact = {
		...plddtArtifact,
		path: "outputs/open-science-seeds/example_crispr_screen/final_kinome_library.csv",
		name: "final_kinome_library.csv",
		title: "Final kinome library",
		extension: ".csv",
		contentType: "text/csv",
		slug: "crispr-run",
		previewable: true,
		updatedAtMs: 10,
	} satisfies WorkbenchArtifact;
	const resources = [
		{
			id: "skills",
			title: "Skills",
			description: "Feynman skills",
			resources: [{
				id: "skill-literature-review",
				name: "Literature review",
				description: "Review papers with provenance.",
				status: "configured",
				source: "Feynman skill",
				command: "/skill:literature-review",
				tags: ["skill"],
			}],
		},
	] satisfies WorkbenchResourceGroup[];
	const state = {
		artifacts: [crisprArtifact, plddtArtifact],
		projects: [project],
		resources,
		runs: [runB, runA],
	} as unknown as WorkbenchState;

	const artifactTrigger = activeComposerTrigger("Compare @pld", "Compare @pld".length);
	assert.equal(artifactTrigger?.kind, "artifact");
	assert.equal(artifactTrigger?.query, "pld");
	const artifactItems = composerSuggestions(state, project, runA, artifactTrigger!);
	assert.equal(artifactItems[0]?.insertText, `@${plddtArtifact.path}`);
	assert.equal(artifactItems[0]?.label, "pLDDT tensor");
	assert.deepEqual(applyComposerSuggestion("Compare @pld", artifactTrigger!, artifactItems[0]!), {
		value: `Compare @${plddtArtifact.path} `,
		cursor: `Compare @${plddtArtifact.path} `.length,
	});

	const sessionTrigger = activeComposerTrigger("Open #cris", "Open #cris".length);
	assert.equal(sessionTrigger?.kind, "session");
	assert.equal(composerSuggestions(state, project, runA, sessionTrigger!)[0]?.insertText, "#crispr-run");

	const commandTrigger = activeComposerTrigger("/lit", "/lit".length);
	assert.equal(commandTrigger?.kind, "command");
	assert.equal(composerSuggestions(state, project, runA, commandTrigger!)[0]?.insertText, "/skill:literature-review");

	assert.deepEqual(beginComposerTrigger("Review this", "Review this".length, "@"), {
		value: "Review this @",
		cursor: "Review this @".length,
	});
});

test("React shell resource helpers expose actionable Customize controls", () => {
	const connectorRecord = {
		id: "local-lab-mcp",
		name: "Local Lab MCP",
		transport: "local",
		command: "python tools/run_lab_server.py",
	};
	const specialist = {
		id: "specialist-researcher",
		name: "researcher",
		description: "Research specialist",
		status: "configured",
		source: "Feynman specialist",
		command: "/run researcher <task>",
		tags: ["agent"],
	} satisfies WorkbenchResource;
	const packageResource = {
		id: "package-biomart",
		name: "BioMart",
		description: "Science connector package",
		status: "available",
		source: "Pi package",
		packageAction: "enable",
		packageSources: ["@feynman/biomart"],
		tags: ["connector"],
	} satisfies WorkbenchResource;
	const storedRecord = {
		id: "grant-ask",
		name: "Pending grant",
		description: "Connector grant",
		status: "available",
		source: "Settings",
		settingsCollection: "permissionGrants",
		settingsRecordId: "grant-ask",
		tags: ["permission"],
	} satisfies WorkbenchResource;
	const localConnector = {
		id: "local-lab-mcp",
		name: "Local Lab MCP",
		description: "Local research connector",
		status: "available",
		source: "Custom MCP connector",
		settingsCollection: "customConnectors",
		settingsRecord: connectorRecord,
		tags: ["mcp"],
	} satisfies WorkbenchResource;

	assert.equal(specialistLabel("literature_reviewer"), "Literature Reviewer");
	assert.deepEqual(resourceActions(specialist).map((action) => action.kind), ["specialist", "command"]);
	assert.deepEqual(resourceActions(packageResource), [{
		kind: "package",
		label: "Enable",
		action: "enable",
		sources: ["@feynman/biomart"],
	}]);
	assert.deepEqual(resourceActions(storedRecord), [{
		kind: "remove",
		label: "Remove",
		collection: "permissionGrants",
		id: "grant-ask",
	}]);
	assert.deepEqual(resourceActions(localConnector), [{
		kind: "settings",
		label: "Connect local",
		collection: "customConnectors",
		record: connectorRecord,
	}]);
});

test("React shell notebook helpers scope cells, kernels, environments, and compute jobs", () => {
	const run = {
		slug: "run-a",
		title: "Run A",
		taskSummary: "",
		status: "planned",
		source: "chat",
		updatedAt: "2026-07-02T00:00:00.000Z",
		updatedAtMs: 1,
		artifactCount: 0,
		notebookCellCount: 0,
		categories: [],
		lastArtifactNames: [],
		hasPlan: false,
		hasProvenance: false,
		hasVerification: false,
	} satisfies WorkbenchRun;
	const cells = [
		{ id: "cell-old", runSlug: "run-a", title: "Old", path: "outputs/old.py", language: "python", category: "output", updatedAt: "2026-07-02T00:00:01.000Z", updatedAtMs: 1, previewable: true },
		{ id: "cell-new", runSlug: "run-a", title: "New", path: "outputs/new.py", language: "python", category: "output", updatedAt: "2026-07-02T00:00:02.000Z", updatedAtMs: 2, previewable: true },
		{ id: "cell-other", runSlug: "run-b", title: "Other", path: "outputs/other.py", language: "python", category: "output", updatedAt: "2026-07-02T00:00:03.000Z", updatedAtMs: 3, previewable: true },
	] satisfies WorkbenchNotebookCell[];
	const jobs = [
		{
			id: "compute-old",
			title: "Old job",
			providerId: "local-process",
			providerName: "Local process",
			family: "Feynman",
			status: "complete",
			tierType: "local",
			intent: "exploration",
			sessionId: "run-a",
			projectId: "workspace",
			runSlug: "run-a",
			language: "python",
			environment: "local",
			command: "python -",
			cwd: "/tmp",
			executionId: "notebook:old",
			detail: "complete",
			inputPaths: [],
			outputPaths: [],
			startedAt: "2026-07-02T00:00:01.000Z",
			startedAtMs: 1,
			endedAt: "2026-07-02T00:00:01.000Z",
			endedAtMs: 1,
			durationMs: 10,
		},
		{
			id: "compute-new",
			title: "New job",
			providerId: "local-kernel",
			providerName: "Session kernel",
			family: "Feynman",
			status: "running",
			tierType: "session",
			intent: "verification",
			sessionId: "run-a",
			projectId: "workspace",
			runSlug: "run-a",
			language: "python",
			environment: "session",
			command: "python session kernel",
			cwd: "/tmp",
			executionId: "notebook:new",
			detail: "running",
			inputPaths: [],
			outputPaths: [],
			startedAt: "2026-07-02T00:00:02.000Z",
			startedAtMs: 2,
			endedAt: "2026-07-02T00:00:02.000Z",
			endedAtMs: 2,
			durationMs: 20,
		},
	] satisfies WorkbenchComputeJobRecord[];
	const kernels = [
		{ id: "kernel-old", sessionId: "run-a", projectId: "workspace", runSlug: "run-a", language: "python", status: "complete", active: false, cwd: "/tmp", source: "recorded", detail: "old", executionCount: 1, latestExecutionAt: "2026-07-02T00:00:01.000Z", latestExecutionAtMs: 1 },
		{ id: "kernel-new", sessionId: "run-a", projectId: "workspace", runSlug: "run-a", language: "python", status: "running", active: true, cwd: "/tmp", source: "recorded", detail: "new", executionCount: 2, latestExecutionAt: "2026-07-02T00:00:02.000Z", latestExecutionAtMs: 2 },
	] satisfies WorkbenchNotebookKernelRecord[];
	const environments = [
		{ id: "python-env", name: "Python", language: "python", executionModes: ["session"], status: "available", source: "system", managed: false, command: "python", commandDetail: "python", detail: "ok", diagnostics: [], managedPackages: [], actionCount: 0, environmentFiles: [], sessionCount: 1, executionCount: 2 },
		{ id: "r-env", name: "R", language: "r", executionModes: ["isolated"], status: "available", source: "system", managed: false, command: "Rscript", commandDetail: "Rscript", detail: "ok", diagnostics: [], managedPackages: [], actionCount: 0, environmentFiles: [], sessionCount: 0, executionCount: 0 },
	] satisfies WorkbenchNotebookEnvironmentRecord[];

	assert.match(defaultNotebookCode("python"), /print/);
	assert.deepEqual(notebookCellsForRun(cells, run).map((cell) => cell.id), ["cell-new", "cell-old"]);
	assert.deepEqual(computeJobsForRun(jobs, run).map((job) => job.id), ["compute-new", "compute-old"]);
	assert.deepEqual(kernelsForRun(kernels, run).map((kernel) => kernel.id), ["kernel-new", "kernel-old"]);
	assert.deepEqual(Object.keys(environmentsByLanguage(environments)).sort(), ["python", "r"]);
	assert.deepEqual(notebookEnvironmentLanguages(), ["python", "r"]);
	assert.deepEqual(normalizeNotebookPackageInput(" scanpy, pandas\nscanpy  numpy>=2 "), ["scanpy", "pandas", "numpy>=2"]);
	assert.equal(notebookEnvironmentActionLabel("create", "python", []), "Create Python env");
	assert.equal(notebookEnvironmentActionLabel("create", "r", []), "Create R library");
	assert.equal(notebookEnvironmentActionLabel("install", "python", ["scanpy", "pandas"]), "Install 2 packages");
	assert.equal(computeJobAction(jobs[0]!), "retry");
	assert.equal(computeJobAction(jobs[1]!), "cancel");
});

test("Claude Science local extractor is reference-only when present", () => {
	const install = readClaudeScienceInstall();
	if (!install) return;
	assert.ok(install.runtimePath.includes(".claude-science/runtime"));
	assert.ok(install.totalToolCount >= install.servedToolCount);
	assert.ok(install.domains.length >= 1);
	assert.ok(install.skillCount >= 1);
	const resources = buildClaudeScienceReferenceResources(install);
	assert.equal(resources[0]?.name, "Claude Science reference install");
	assert.equal(resources[0]?.status, "read-only");
	assert.equal(resources[0]?.settingsCollection, undefined);
	assert.equal(resources[0]?.settingsRecord, undefined);
});
