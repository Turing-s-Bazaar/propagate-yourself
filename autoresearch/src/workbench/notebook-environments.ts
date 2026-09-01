import { spawnSync } from "node:child_process";

import {
	listNotebookKernelSessions,
	type ActiveNotebookKernelSession,
} from "./notebook-kernels.js";
import {
	resolvePythonRuntimeCommand,
	resolveRRuntimeCommand,
	resolveRscriptRuntimeCommand,
	notebookRuntimeProcessEnv,
	type WorkbenchRuntimeCommand,
} from "./notebook-runtimes.js";
import {
	managedEnvironmentExists,
	managedEnvironmentPackages,
	readNotebookEnvironmentActions,
	type ManagedNotebookEnvironmentLanguage,
	type WorkbenchNotebookEnvironmentActionRecord,
} from "./notebook-managed-environments.js";
import type {
	WorkbenchNotebookEnvironmentRecord,
	WorkbenchNotebookEnvironmentStatus,
	WorkbenchNotebookKernelRecord,
	WorkbenchNotebookRuntimeSource,
} from "./types.js";
import type { WorkbenchNotebookExecutionRecord } from "./notebook-execution.js";

type RuntimeProbe = {
	executable?: string;
	version?: string;
	error?: string;
};

type RuntimeSpec = {
	id: string;
	name: string;
	language: string;
	executionModes: string[];
	managedLanguage?: ManagedNotebookEnvironmentLanguage;
	packageManager?: string;
	command: WorkbenchRuntimeCommand;
	probe: () => RuntimeProbe;
};

function millis(value: string): number {
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function bounded(value: string | undefined, limit = 260): string | undefined {
	if (!value?.trim()) return undefined;
	const trimmed = value.trim();
	return trimmed.length > limit ? `${trimmed.slice(0, limit).trimEnd()}...` : trimmed;
}

function commandProbe(
	command: string,
	args: string[],
	parse: (stdout: string) => RuntimeProbe,
	workingDir?: string,
): RuntimeProbe {
	const result = spawnSync(command, args, {
		encoding: "utf8",
		...(workingDir ? { env: notebookRuntimeProcessEnv(workingDir) } : {}),
		timeout: 3000,
	});
	const stdout = typeof result.stdout === "string" ? result.stdout : "";
	const stderr = typeof result.stderr === "string" ? result.stderr : "";
	if (result.error) {
		return { executable: command, error: result.error.message };
	}
	if (typeof result.status === "number" && result.status !== 0) {
		return { executable: command, error: bounded(stderr || stdout || `exit ${result.status}`) };
	}
	return parse(stdout);
}

function probePython(command: string, workingDir: string): RuntimeProbe {
	return commandProbe(
		command,
		["-c", "import json,sys; print(json.dumps({'executable': sys.executable, 'version': sys.version.split()[0]}))"],
		(stdout) => {
			try {
				const parsed = JSON.parse(stdout.trim()) as { executable?: unknown; version?: unknown };
				return {
					...(typeof parsed.executable === "string" ? { executable: parsed.executable } : { executable: command }),
					...(typeof parsed.version === "string" ? { version: parsed.version } : {}),
				};
			} catch {
				return { executable: command, version: bounded(stdout) };
			}
		},
		workingDir,
	);
}

function probeR(command: string, workingDir: string): RuntimeProbe {
	return commandProbe(
		command,
		["--slave", "-e", "cat(R.version.string)"],
		(stdout) => ({
			executable: command,
			...(stdout.trim() ? { version: stdout.trim() } : {}),
		}),
		workingDir,
	);
}

function probeRscript(command: string, workingDir: string): RuntimeProbe {
	return commandProbe(
		command,
		["-e", "cat(R.version.string)"],
		(stdout) => ({
			executable: command,
			...(stdout.trim() ? { version: stdout.trim() } : {}),
		}),
		workingDir,
	);
}

function probeBash(): RuntimeProbe {
	return commandProbe(
		"bash",
		["--version"],
		(stdout) => ({
			executable: "bash",
			...(stdout.trim() ? { version: stdout.split("\n")[0]?.trim() } : {}),
		}),
	);
}

function runtimeSpecs(workingDir: string): RuntimeSpec[] {
	const python = resolvePythonRuntimeCommand(workingDir);
	const r = resolveRRuntimeCommand();
	const rscript = resolveRscriptRuntimeCommand();
	return [
		{
			id: "python",
			name: "Python",
			language: "python",
			executionModes: ["session", "isolated", "modal"],
			managedLanguage: "python",
			packageManager: "pip",
			command: python,
			probe: () => probePython(python.command, workingDir),
		},
		{
			id: "r-session",
			name: "R session",
			language: "r",
			executionModes: ["session"],
			managedLanguage: "r",
			packageManager: "install.packages",
			command: r,
			probe: () => probeR(r.command, workingDir),
		},
		{
			id: "rscript",
			name: "Rscript process",
			language: "r",
			executionModes: ["isolated"],
			managedLanguage: "r",
			packageManager: "install.packages",
			command: rscript,
			probe: () => probeRscript(rscript.command, workingDir),
		},
		{
			id: "bash",
			name: "Bash",
			language: "bash",
			executionModes: ["session", "isolated"],
			command: { command: "bash", detail: "bash on PATH", source: "path" },
			probe: probeBash,
		},
	];
}

function environmentIdForRecord(record: WorkbenchNotebookExecutionRecord): string {
	if (record.language === "r" && record.executionMode === "session") return "r-session";
	if (record.language === "r") return "rscript";
	if (record.language === "bash") return "bash";
	return "python";
}

function runtimeStatus(source: WorkbenchRuntimeCommand["source"], probe: RuntimeProbe): WorkbenchNotebookEnvironmentStatus {
	if (probe.error) return "error";
	return source === "configured" || source === "managed" ? "configured" : "available";
}

function latestRecord(records: WorkbenchNotebookExecutionRecord[]): WorkbenchNotebookExecutionRecord | undefined {
	return records
		.slice()
		.sort((a, b) => millis(b.updatedAt) - millis(a.updatedAt) || b.id.localeCompare(a.id))[0];
}

function uniqueSorted(values: Array<string | undefined>): string[] {
	return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))]
		.sort((a, b) => a.localeCompare(b));
}

function runtimeSourceFromRecord(record: WorkbenchNotebookExecutionRecord): WorkbenchNotebookRuntimeSource {
	const executable = record.environmentSnapshot?.runtime?.executable;
	if (executable && executable === resolvePythonRuntimeCommand(record.cwd).command) return resolvePythonRuntimeCommand(record.cwd).source;
	if (executable && executable === resolveRRuntimeCommand().command) return resolveRRuntimeCommand().source;
	if (executable && executable === resolveRscriptRuntimeCommand().command) return resolveRscriptRuntimeCommand().source;
	return "recorded";
}

function latestAction(actions: WorkbenchNotebookEnvironmentActionRecord[], language: ManagedNotebookEnvironmentLanguage | undefined): WorkbenchNotebookEnvironmentActionRecord | undefined {
	if (!language) return undefined;
	return actions
		.filter((action) => action.language === language)
		.slice()
		.sort((a, b) => millis(b.updatedAt) - millis(a.updatedAt) || b.id.localeCompare(a.id))[0];
}

export function buildNotebookEnvironmentRecords(
	workingDir: string,
	records: WorkbenchNotebookExecutionRecord[],
): WorkbenchNotebookEnvironmentRecord[] {
	const actions = readNotebookEnvironmentActions(workingDir);
	return runtimeSpecs(workingDir).map((spec) => {
		const matchedRecords = records.filter((record) => environmentIdForRecord(record) === spec.id);
		const latest = latestRecord(matchedRecords);
		const probe = spec.probe();
		const matchedActions = spec.managedLanguage ? actions.filter((action) => action.language === spec.managedLanguage) : [];
		const latestManagedAction = latestAction(actions, spec.managedLanguage);
		const latestActionAtMs = latestManagedAction ? millis(latestManagedAction.updatedAt) : undefined;
		const managedPackages = spec.managedLanguage ? managedEnvironmentPackages(actions, spec.managedLanguage) : [];
		const managed = spec.managedLanguage ? managedEnvironmentExists(workingDir, spec.managedLanguage) : false;
		const environmentFiles = uniqueSorted(matchedRecords.flatMap((record) =>
			record.environmentSnapshot?.environmentFiles?.map((file) => file.path) ?? []
		));
		const sessions = new Set(matchedRecords.map((record) => record.sessionId));
		const latestAtMs = latest ? millis(latest.updatedAt) : undefined;
		const diagnostics = [
			`Resolver source: ${spec.command.source}; ${spec.command.detail}.`,
			probe.error ? `Probe error: ${probe.error}.` : `Probe: ${probe.version || "command responded"}.`,
			matchedRecords.length
				? `Recorded executions: ${matchedRecords.length} across ${sessions.size} ${sessions.size === 1 ? "session" : "sessions"}.`
				: "Recorded executions: none yet.",
			workingDir ? `Workspace: ${workingDir}.` : undefined,
		].filter((value): value is string => Boolean(value));
		return {
			id: spec.id,
			name: spec.name,
			language: spec.language,
			executionModes: spec.executionModes,
			status: runtimeStatus(spec.command.source, probe),
			source: spec.command.source,
			command: spec.command.command,
			commandDetail: spec.command.detail,
			...(probe.executable ? { executable: probe.executable } : {}),
			...(probe.version ? { version: probe.version } : {}),
			detail: [
				spec.executionModes.join(", "),
				probe.version || probe.error || spec.command.detail,
				managedPackages.length ? `${managedPackages.length} managed ${managedPackages.length === 1 ? "package" : "packages"}` : undefined,
			].filter(Boolean).join(" / "),
			diagnostics,
			managed,
			...(spec.packageManager ? { packageManager: spec.packageManager } : {}),
			managedPackages,
			actionCount: matchedActions.length,
			...(latestManagedAction ? { latestActionStatus: latestManagedAction.status, latestActionAt: latestManagedAction.updatedAt } : {}),
			...(latestActionAtMs !== undefined ? { latestActionAtMs } : {}),
			environmentFiles,
			sessionCount: sessions.size,
			executionCount: matchedRecords.length,
			...(latest ? { latestExecutionAt: latest.updatedAt } : {}),
			...(latestAtMs !== undefined ? { latestExecutionAtMs: latestAtMs } : {}),
		};
	});
}

function activeKernelMap(workingDir: string): Map<string, ActiveNotebookKernelSession> {
	return new Map(
		listNotebookKernelSessions(workingDir)
			.filter((kernel) => kernel.usable)
			.map((kernel) => [kernel.id, kernel]),
	);
}

export function buildNotebookKernelRecords(
	workingDir: string,
	records: WorkbenchNotebookExecutionRecord[],
): WorkbenchNotebookKernelRecord[] {
	const active = activeKernelMap(workingDir);
	const byKernel = new Map<string, WorkbenchNotebookExecutionRecord[]>();
	for (const record of records) {
		if (record.executionMode !== "session" || !record.kernelId) continue;
		const group = byKernel.get(record.kernelId) ?? [];
		group.push(record);
		byKernel.set(record.kernelId, group);
	}

	return [...byKernel.entries()].map(([kernelId, group]) => {
		const latest = latestRecord(group) ?? group[0];
		const latestAtMs = millis(latest.updatedAt);
		const runtime = latest.environmentSnapshot?.runtime;
		const isActive = active.has(kernelId);
		return {
			id: kernelId,
			sessionId: latest.sessionId,
			projectId: latest.projectId,
			...(latest.runSlug ? { runSlug: latest.runSlug } : {}),
			language: latest.language,
			status: latest.status,
			active: isActive,
			cwd: latest.cwd,
			...(runtime?.executable ? { executable: runtime.executable } : {}),
			...(runtime?.version ? { version: runtime.version } : {}),
			source: runtimeSourceFromRecord(latest),
			detail: [
				`${group.length} ${group.length === 1 ? "cell" : "cells"}`,
				isActive ? "live process" : "recorded history",
				runtime?.version,
			].filter(Boolean).join(" / "),
			executionCount: group.length,
			latestExecutionId: `notebook:${latest.id}`,
			latestExecutionAt: latest.updatedAt,
			latestExecutionAtMs: latestAtMs,
		};
	}).sort((a, b) => b.latestExecutionAtMs - a.latestExecutionAtMs || a.id.localeCompare(b.id));
}
