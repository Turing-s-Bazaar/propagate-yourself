import type {
	WorkbenchArtifact,
	WorkbenchProject,
	WorkbenchResource,
	WorkbenchRun,
	WorkbenchState,
} from "./types.js";

export type ComposerTriggerKind = "artifact" | "command" | "session";

export type ComposerTrigger = {
	end: number;
	kind: ComposerTriggerKind;
	marker: "@" | "#" | "/";
	query: string;
	start: number;
};

export type ComposerSuggestion = {
	detail: string;
	id: string;
	insertText: string;
	kind: ComposerTriggerKind;
	label: string;
};

const markerKind = new Map<string, ComposerTriggerKind>([
	["@", "artifact"],
	["#", "session"],
	["/", "command"],
]);

function normalize(value: string): string {
	return value.trim().toLowerCase();
}

function queryScore(query: string, parts: Array<string | undefined>): number {
	const normalized = normalize(query);
	if (!normalized) return 100;
	let score = Number.POSITIVE_INFINITY;
	for (const part of parts) {
		const value = part?.toLowerCase().trim();
		if (!value) continue;
		if (value === normalized) score = Math.min(score, 0);
		else if (value.startsWith(normalized)) score = Math.min(score, 1);
		else if (value.split(/[^a-z0-9:_-]+/).some((word) => word.startsWith(normalized))) score = Math.min(score, 2);
		else if (value.includes(normalized)) score = Math.min(score, 3);
	}
	return score;
}

function artifactSuggestion(artifact: WorkbenchArtifact): ComposerSuggestion {
	return {
		id: `artifact:${artifact.path}`,
		kind: "artifact",
		label: artifact.displayName || artifact.title || artifact.name,
		detail: `${artifact.category} / ${artifact.path}`,
		insertText: `@${artifact.path}`,
	};
}

function commandSuggestion(resource: WorkbenchResource): ComposerSuggestion | null {
	if (!resource.command) return null;
	return {
		id: `command:${resource.id}:${resource.command}`,
		kind: "command",
		label: resource.name,
		detail: resource.description || resource.command,
		insertText: resource.command,
	};
}

function sessionSuggestion(run: WorkbenchRun): ComposerSuggestion {
	return {
		id: `session:${run.slug}`,
		kind: "session",
		label: run.title,
		detail: `${runStatusLabel(run)} / ${run.slug}`,
		insertText: `#${run.slug}`,
	};
}

function runStatusLabel(run: WorkbenchRun): string {
	if (run.hasVerification) return "Verified";
	if (run.hasProvenance) return "Provenance";
	if (run.hasPlan) return "Plan";
	return run.status;
}

function uniqueSuggestions(suggestions: ComposerSuggestion[]): ComposerSuggestion[] {
	const seen = new Set<string>();
	const unique: ComposerSuggestion[] = [];
	for (const suggestion of suggestions) {
		const key = `${suggestion.kind}:${suggestion.insertText}`;
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(suggestion);
	}
	return unique;
}

function artifactsForComposer(state: WorkbenchState, project?: WorkbenchProject, run?: WorkbenchRun): WorkbenchArtifact[] {
	const projectSlugs = new Set(project?.runSlugs ?? []);
	const scored = state.artifacts.map((artifact) => {
		let score = 0;
		if (run && artifact.slug === run.slug) score += 100;
		if (projectSlugs.has(artifact.slug)) score += 50;
		return { artifact, score };
	});
	return scored
		.sort((left, right) => right.score - left.score || right.artifact.updatedAtMs - left.artifact.updatedAtMs)
		.map((item) => item.artifact);
}

function commandsForComposer(state: WorkbenchState): WorkbenchResource[] {
	return state.resources
		.flatMap((group) => group.resources)
		.filter((resource) => Boolean(resource.command))
		.sort((left, right) => {
			const leftSkill = left.command?.startsWith("/skill:") ? 0 : 1;
			const rightSkill = right.command?.startsWith("/skill:") ? 0 : 1;
			return leftSkill - rightSkill || left.name.localeCompare(right.name);
		});
}

function runsForComposer(state: WorkbenchState, project?: WorkbenchProject, activeRun?: WorkbenchRun): WorkbenchRun[] {
	const projectSlugs = new Set(project?.runSlugs ?? []);
	return state.runs
		.filter((run) => projectSlugs.size === 0 || projectSlugs.has(run.slug) || run.projectId === project?.id)
		.sort((left, right) => {
			if (left.slug === activeRun?.slug) return -1;
			if (right.slug === activeRun?.slug) return 1;
			return right.updatedAtMs - left.updatedAtMs;
		});
}

export function activeComposerTrigger(value: string, cursor = value.length): ComposerTrigger | null {
	const boundedCursor = Math.max(0, Math.min(cursor, value.length));
	const beforeCursor = value.slice(0, boundedCursor);
	const match = /(^|[\s([{])([@#/])([^\s@#/]*)$/.exec(beforeCursor);
	if (!match) return null;
	const marker = match[2] as "@" | "#" | "/";
	const kind = markerKind.get(marker);
	if (!kind) return null;
	return {
		end: boundedCursor,
		kind,
		marker,
		query: match[3] ?? "",
		start: match.index + (match[1]?.length ?? 0),
	};
}

export function composerSuggestions(
	state: WorkbenchState,
	project: WorkbenchProject | undefined,
	run: WorkbenchRun | undefined,
	trigger: ComposerTrigger,
	limit = 7,
): ComposerSuggestion[] {
	let suggestions: ComposerSuggestion[];
	if (trigger.kind === "artifact") {
		suggestions = artifactsForComposer(state, project, run)
			.map((artifact) => ({
				artifact,
				score: queryScore(trigger.query, [
					artifact.displayName,
					artifact.title,
					artifact.name,
					artifact.path,
					artifact.category,
					artifact.slug,
				]),
			}))
			.filter((item) => Number.isFinite(item.score))
			.sort((left, right) => left.score - right.score)
			.map((item) => item.artifact)
			.map(artifactSuggestion);
	} else if (trigger.kind === "session") {
		suggestions = runsForComposer(state, project, run)
			.map((item) => ({
				item,
				score: queryScore(trigger.query, [item.title, item.slug, item.taskSummary, item.status]),
			}))
			.filter((item) => Number.isFinite(item.score))
			.sort((left, right) => left.score - right.score)
			.map((item) => item.item)
			.map(sessionSuggestion);
	} else {
		suggestions = commandsForComposer(state)
			.map((resource) => {
				const primaryScore = queryScore(trigger.query, [resource.name, resource.command]);
				const secondaryScore = queryScore(trigger.query, [resource.description, resource.source]);
				return {
					resource,
					score: Number.isFinite(primaryScore) ? primaryScore : secondaryScore + 10,
				};
			})
			.filter((item) => Number.isFinite(item.score))
			.sort((left, right) => left.score - right.score)
			.map((item) => item.resource)
			.map(commandSuggestion)
			.filter((suggestion): suggestion is ComposerSuggestion => Boolean(suggestion));
	}
	return uniqueSuggestions(suggestions).slice(0, limit);
}

export function applyComposerSuggestion(
	value: string,
	trigger: ComposerTrigger,
	suggestion: ComposerSuggestion,
): { cursor: number; value: string } {
	const prefix = value.slice(0, trigger.start);
	const suffix = value.slice(trigger.end);
	const needsSpace = suffix.length > 0 && !/^\s/.test(suffix);
	const insertion = suggestion.insertText.endsWith(" ") ? suggestion.insertText : `${suggestion.insertText} `;
	const nextValue = `${prefix}${insertion}${needsSpace ? " " : ""}${suffix}`;
	return {
		value: nextValue,
		cursor: prefix.length + insertion.length,
	};
}

export function beginComposerTrigger(
	value: string,
	cursor: number,
	marker: ComposerTrigger["marker"],
): { cursor: number; value: string } {
	const boundedCursor = Math.max(0, Math.min(cursor, value.length));
	const prefix = value.slice(0, boundedCursor);
	const suffix = value.slice(boundedCursor);
	const separator = prefix.length === 0 || /\s$/.test(prefix) ? "" : " ";
	const nextValue = `${prefix}${separator}${marker}${suffix}`;
	return {
		value: nextValue,
		cursor: prefix.length + separator.length + 1,
	};
}
