import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, relative, resolve, sep } from "node:path";

import {
	captureArtifactSnapshotBaseline,
	recordArtifactSnapshotsForChanges,
	type WorkbenchArtifactSnapshotRecord,
} from "./artifact-snapshots.js";
import {
	ensureWorkbenchChatSession,
	type WorkbenchChatOptions,
	type WorkbenchPromptExecutor,
} from "./chat.js";
import { runFeynmanWorkbenchPrompt } from "./chat-runtime.js";
import { isWorkbenchPreviewExtension } from "./file-types.js";

export type WorkbenchEditableArtifact = {
	artifactPath: string;
	content: string;
	sizeBytes: number;
	checksum: string;
};

export type WorkbenchArtifactEditResult = {
	artifactPath: string;
	sizeBytes: number;
	checksum: string;
	changed: boolean;
	snapshotRecords: WorkbenchArtifactSnapshotRecord[];
};

export type WorkbenchArtifactRefinementMode = "ask" | "edit";

export type WorkbenchArtifactRefinementSuggestion = {
	artifactPath: string;
	mode: WorkbenchArtifactRefinementMode;
	selectedText: string;
	instruction: string;
	suggestion: string;
	source: "fallback" | "model";
};

export type WorkbenchArtifactApplyEditResult = WorkbenchArtifactEditResult & {
	selectedText: string;
	replacementText: string;
	startOffset: number;
	endOffset: number;
};

const EDITABLE_ROOTS = ["outputs", "papers", "notes"];

export const MAX_ARTIFACT_EDIT_BYTES = 2 * 1024 * 1024;

function toPosixPath(path: string): string {
	return path.split(sep).join("/");
}

function sha256(buffer: Buffer | string): string {
	return createHash("sha256").update(buffer).digest("hex");
}

function normalizeEditableArtifactPath(workingDir: string, requestedPath: string): { absPath: string; relPath: string } {
	const workspace = resolve(workingDir);
	const cleaned = toPosixPath(requestedPath).replace(/^\/+/, "");
	const absPath = resolve(workspace, cleaned);
	const relPath = toPosixPath(relative(workspace, absPath));
	if (!relPath) throw new Error("Cannot edit the workspace root.");
	if (relPath.startsWith("../") || relPath === ".." || relPath.split("/").includes("..")) {
		throw new Error("Cannot edit files outside the workspace.");
	}
	if (!EDITABLE_ROOTS.some((root) => relPath === root || relPath.startsWith(`${root}/`))) {
		throw new Error("Artifact edits are limited to outputs, papers, and notes.");
	}
	if (!isWorkbenchPreviewExtension(extname(relPath).toLowerCase())) {
		throw new Error("This artifact type is not editable as text.");
	}
	return { absPath, relPath };
}

function assertReadableEditableFile(absPath: string, relPath: string): void {
	if (!existsSync(absPath)) throw new Error(`Artifact not found: ${relPath}`);
	const stats = statSync(absPath);
	if (!stats.isFile()) throw new Error(`Artifact is not a file: ${relPath}`);
	if (stats.size > MAX_ARTIFACT_EDIT_BYTES) {
		throw new Error("Artifact is too large to edit inline.");
	}
}

function assertEditableContent(content: string): Buffer {
	const buffer = Buffer.from(content, "utf8");
	if (buffer.length > MAX_ARTIFACT_EDIT_BYTES) {
		throw new Error("Edited content is too large to save inline.");
	}
	if (buffer.includes(0)) {
		throw new Error("Edited content must be text.");
	}
	return buffer;
}

function boundedText(value: string, max = 20_000): string {
	return value.length > max ? `${value.slice(0, max)}\n[truncated]` : value;
}

function extractJsonSuggestion(value: string): string | undefined {
	const trimmed = value.trim();
	const candidates = [
		trimmed,
		trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, ""),
		trimmed.match(/\{[\s\S]*\}/)?.[0] ?? "",
	].filter(Boolean);
	for (const candidate of candidates) {
		try {
			const parsed = JSON.parse(candidate) as unknown;
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				const suggestion = (parsed as Record<string, unknown>).suggestion;
				if (typeof suggestion === "string") return suggestion.trim();
			}
		} catch {
			// Try the next candidate.
		}
	}
	return undefined;
}

function cleanupModelSuggestion(value: string): string {
	const parsed = extractJsonSuggestion(value);
	if (parsed !== undefined) return parsed;
	return value
		.trim()
		.replace(/^```(?:markdown|md|text)?\s*/i, "")
		.replace(/\s*```$/i, "")
		.trim();
}

function fallbackSuggestion(input: {
	instruction: string;
	mode: WorkbenchArtifactRefinementMode;
	selectedText: string;
}): string {
	if (input.mode === "ask") {
		return [
			"This selection is anchored in the current artifact.",
			`Question: ${input.instruction}`,
			`Selection: ${input.selectedText}`,
		].join("\n");
	}
	return input.selectedText;
}

function refinementPrompt(input: {
	artifactPath: string;
	content: string;
	currentIteration?: string;
	instruction: string;
	mode: WorkbenchArtifactRefinementMode;
	selectedText: string;
}): string {
	if (input.mode === "ask") {
		return [
			"Answer a question about a selected passage in a Feynman research artifact.",
			"Return only JSON with this shape: {\"suggestion\":\"answer text\"}.",
			"Do not rewrite the artifact in ask mode.",
			"",
			`Artifact path: ${input.artifactPath}`,
			"Selected passage:",
			input.selectedText,
			"",
			"Question:",
			input.instruction,
			"",
			"Artifact content for context:",
			boundedText(input.content),
		].join("\n");
	}
	return [
		"Suggest an edit for a selected passage in a Feynman research artifact.",
		"Return only JSON with this shape: {\"suggestion\":\"replacement text\"}.",
		"The suggestion must replace only the selected passage, not the whole artifact.",
		"Preserve the selected passage's voice, citations, and markdown structure unless the instruction asks to change them.",
		"",
		`Artifact path: ${input.artifactPath}`,
		"Selected passage:",
		input.selectedText,
		"",
		input.currentIteration ? "Current edited iteration:" : "",
		input.currentIteration ?? "",
		input.currentIteration ? "" : "",
		"Requested edit:",
		input.instruction,
		"",
		"Artifact content for context:",
		boundedText(input.content),
	].filter((line) => line !== "").join("\n");
}

function selectedOffsets(content: string, input: {
	endOffset?: number;
	selectedText: string;
	startOffset?: number;
}): { endOffset: number; startOffset: number } {
	if (
		typeof input.startOffset === "number" &&
		Number.isInteger(input.startOffset) &&
		typeof input.endOffset === "number" &&
		Number.isInteger(input.endOffset) &&
		input.startOffset >= 0 &&
		input.endOffset >= input.startOffset &&
		input.endOffset <= content.length &&
		content.slice(input.startOffset, input.endOffset) === input.selectedText
	) {
		return { startOffset: input.startOffset, endOffset: input.endOffset };
	}
	const first = content.indexOf(input.selectedText);
	if (first === -1) {
		throw new Error("Selected text was not found in the current artifact.");
	}
	if (content.indexOf(input.selectedText, first + input.selectedText.length) !== -1) {
		throw new Error("Selected text appears more than once. Select the passage again before applying.");
	}
	return {
		startOffset: first,
		endOffset: first + input.selectedText.length,
	};
}

export function readWorkbenchEditableArtifact(workingDir: string, artifactPath: string): WorkbenchEditableArtifact {
	const { absPath, relPath } = normalizeEditableArtifactPath(workingDir, artifactPath);
	assertReadableEditableFile(absPath, relPath);
	const buffer = readFileSync(absPath);
	return {
		artifactPath: relPath,
		content: buffer.toString("utf8"),
		sizeBytes: buffer.length,
		checksum: sha256(buffer),
	};
}

export async function suggestWorkbenchArtifactRefinement(
	options: WorkbenchChatOptions,
	input: {
		artifactPath: string;
		currentIteration?: string;
		endOffset?: number;
		instruction: string;
		mode: WorkbenchArtifactRefinementMode;
		projectId: string;
		selectedText: string;
		sessionId: string;
		startOffset?: number;
		title: string;
	},
): Promise<WorkbenchArtifactRefinementSuggestion> {
	const artifact = readWorkbenchEditableArtifact(options.workingDir, input.artifactPath);
	const instruction = input.instruction.trim();
	const selectedText = input.selectedText.trim();
	if (!instruction) throw new Error("Missing refinement instruction.");
	if (!selectedText) throw new Error("Missing selected text.");
	if (input.mode !== "ask" && input.mode !== "edit") throw new Error("Refinement mode must be ask or edit.");
	selectedOffsets(artifact.content, {
		selectedText,
		startOffset: input.startOffset,
		endOffset: input.endOffset,
	});
	const session = ensureWorkbenchChatSession(options, {
		id: input.sessionId,
		projectId: input.projectId,
		title: input.title,
	});
	const executor: WorkbenchPromptExecutor = options.executor ?? runFeynmanWorkbenchPrompt;
	try {
		const result = await executor({
			...options,
			session,
			message: refinementPrompt({
				artifactPath: artifact.artifactPath,
				content: artifact.content,
				currentIteration: input.currentIteration,
				instruction,
				mode: input.mode,
				selectedText,
			}),
		});
		const suggestion = cleanupModelSuggestion(result.content);
		if (!suggestion) throw new Error("Model returned an empty suggestion.");
		return {
			artifactPath: artifact.artifactPath,
			mode: input.mode,
			selectedText,
			instruction,
			suggestion,
			source: "model",
		};
	} catch (error) {
		if (!options.executor) throw error;
		return {
			artifactPath: artifact.artifactPath,
			mode: input.mode,
			selectedText,
			instruction,
			suggestion: fallbackSuggestion({ instruction, mode: input.mode, selectedText }),
			source: "fallback",
		};
	}
}

export function applyWorkbenchArtifactRefinement(
	workingDir: string,
	input: {
		artifactPath: string;
		endOffset?: number;
		replacementText: string;
		selectedText: string;
		startOffset?: number;
	},
): WorkbenchArtifactApplyEditResult {
	const artifact = readWorkbenchEditableArtifact(workingDir, input.artifactPath);
	const selectedText = input.selectedText.trim();
	if (!selectedText) throw new Error("Missing selected text.");
	const replacementText = input.replacementText;
	const offsets = selectedOffsets(artifact.content, {
		selectedText,
		startOffset: input.startOffset,
		endOffset: input.endOffset,
	});
	const nextContent = artifact.content.slice(0, offsets.startOffset) + replacementText + artifact.content.slice(offsets.endOffset);
	const edit = updateWorkbenchArtifactContent(workingDir, {
		artifactPath: artifact.artifactPath,
		content: nextContent,
	});
	return {
		...edit,
		selectedText,
		replacementText,
		startOffset: offsets.startOffset,
		endOffset: offsets.endOffset,
	};
}

export function updateWorkbenchArtifactContent(
	workingDir: string,
	input: { artifactPath: string; content: string },
): WorkbenchArtifactEditResult {
	const { absPath, relPath } = normalizeEditableArtifactPath(workingDir, input.artifactPath);
	assertReadableEditableFile(absPath, relPath);
	const nextBuffer = assertEditableContent(input.content);
	const previousBuffer = readFileSync(absPath);
	if (previousBuffer.equals(nextBuffer)) {
		return {
			artifactPath: relPath,
			sizeBytes: nextBuffer.length,
			checksum: sha256(nextBuffer),
			changed: false,
			snapshotRecords: [],
		};
	}
	const baseline = captureArtifactSnapshotBaseline(workingDir, [relPath]);
	mkdirSync(dirname(absPath), { recursive: true });
	writeFileSync(absPath, nextBuffer);
	const createdAtMs = Date.now();
	const snapshotRecords = recordArtifactSnapshotsForChanges(workingDir, baseline, {
		source: "workspace",
		sessionId: "workbench-edit",
		producerExecutionId: `artifact-edit:${createdAtMs}`,
		producerSourceId: "artifact-editor",
		createdAtMs,
		paths: [relPath],
	});
	return {
		artifactPath: relPath,
		sizeBytes: nextBuffer.length,
		checksum: sha256(nextBuffer),
		changed: true,
		snapshotRecords,
	};
}
