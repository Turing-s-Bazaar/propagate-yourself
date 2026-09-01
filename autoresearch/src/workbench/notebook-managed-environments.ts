import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { migratedWorkbenchDataPath } from "./data-root.js";
import { dropNotebookKernelsForLanguage } from "./notebook-kernels.js";
import {
	managedPythonEnvironmentDir,
	managedPythonExecutable,
	managedRLibraryDir,
	notebookRuntimeProcessEnv,
	resolveRscriptRuntimeCommand,
} from "./notebook-runtimes.js";
import type { WorkbenchExecutionStatus } from "./types.js";

export type ManagedNotebookEnvironmentLanguage = "python" | "r";
export type ManagedNotebookEnvironmentMode = "create" | "install";

export type WorkbenchNotebookEnvironmentActionRecord = {
	schema: "feynman.notebookEnvironmentAction.v1";
	id: string;
	mode: ManagedNotebookEnvironmentMode;
	language: ManagedNotebookEnvironmentLanguage;
	environmentId: string;
	environmentName: string;
	packages: string[];
	status: WorkbenchExecutionStatus;
	command: string;
	cwd: string;
	stdout: string;
	stderr: string;
	durationMs: number;
	createdAt: string;
	updatedAt: string;
};

type ManageNotebookEnvironmentInput = {
	language?: string;
	mode?: string;
	packages?: unknown;
};

const ACTION_SCHEMA = "feynman.notebookEnvironmentAction.v1";
const MAX_PACKAGE_COUNT = 48;
const MAX_OUTPUT_CHARS = 32_000;
const DEFAULT_TIMEOUT_MS = 600_000;

function bounded(value: string, limit = MAX_OUTPUT_CHARS): string {
	return value.length > limit ? value.slice(0, limit) : value;
}

function actionLogPath(workingDir: string): string {
	return migratedWorkbenchDataPath(workingDir, "environment-actions.jsonl");
}

function normalizeLanguage(value: string | undefined): ManagedNotebookEnvironmentLanguage {
	const normalized = (value ?? "python").trim().toLowerCase();
	return normalized === "r" || normalized === "rscript" ? "r" : "python";
}

function normalizeMode(value: string | undefined): ManagedNotebookEnvironmentMode {
	const normalized = (value ?? "create").trim().toLowerCase();
	return normalized === "install" ? "install" : "create";
}

function packageParts(value: unknown): string[] {
	if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
	if (typeof value === "string") return value.split(/[\s,]+/g);
	return [];
}

function normalizePackages(value: unknown, language: ManagedNotebookEnvironmentLanguage): string[] {
	const packages = [...new Set(packageParts(value).map((item) => item.trim()).filter(Boolean))].slice(0, MAX_PACKAGE_COUNT);
	const pattern = language === "r"
		? /^[A-Za-z][A-Za-z0-9.]*$/
		: /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\[[A-Za-z0-9_,.-]+\])?(?:[<>=!~]=?[A-Za-z0-9.*+!_:-]+)?$/;
	const invalid = packages.find((item) => !pattern.test(item));
	if (invalid) throw new Error(`Unsupported ${language} package spec: ${invalid}`);
	return packages;
}

function environmentId(language: ManagedNotebookEnvironmentLanguage): string {
	return language === "r" ? "feynman-r-library" : "feynman-python-venv";
}

function environmentName(language: ManagedNotebookEnvironmentLanguage): string {
	return language === "r" ? "Feynman R library" : "Feynman Python venv";
}

function commandResultStatus(result: ReturnType<typeof spawnSync>): WorkbenchExecutionStatus {
	if (result.error) return "error";
	if (typeof result.status === "number" && result.status !== 0) return "error";
	if (result.signal) return "stopped";
	return "complete";
}

function pythonSeedCommand(): string {
	const configured = process.env.PYTHON?.trim();
	if (configured) return configured;
	return "python3";
}

function createPythonEnvironment(workingDir: string): { command: string; stdout: string; stderr: string; status: WorkbenchExecutionStatus } {
	const envDir = managedPythonEnvironmentDir(workingDir);
	if (existsSync(managedPythonExecutable(workingDir))) {
		return {
			command: `${managedPythonExecutable(workingDir)} --version`,
			stdout: "Managed Python venv already exists.",
			stderr: "",
			status: "complete",
		};
	}
	mkdirSync(resolve(envDir, ".."), { recursive: true });
	const seed = pythonSeedCommand();
	const result = spawnSync(seed, ["-m", "venv", envDir], {
		cwd: workingDir,
		encoding: "utf8",
		env: notebookRuntimeProcessEnv(workingDir),
		timeout: DEFAULT_TIMEOUT_MS,
	});
	return {
		command: `${seed} -m venv ${envDir}`,
		stdout: bounded(typeof result.stdout === "string" ? result.stdout : ""),
		stderr: bounded(result.error?.message || (typeof result.stderr === "string" ? result.stderr : "")),
		status: commandResultStatus(result),
	};
}

function installPythonPackages(workingDir: string, packages: string[]): { command: string; stdout: string; stderr: string; status: WorkbenchExecutionStatus } {
	const python = managedPythonExecutable(workingDir);
	if (!existsSync(python)) {
		const created = createPythonEnvironment(workingDir);
		if (created.status !== "complete" || !packages.length) return created;
	}
	if (!packages.length) {
		return {
			command: `${python} -m pip install`,
			stdout: "No Python packages requested.",
			stderr: "",
			status: "complete",
		};
	}
	const result = spawnSync(python, ["-m", "pip", "install", ...packages], {
		cwd: workingDir,
		encoding: "utf8",
		env: notebookRuntimeProcessEnv(workingDir),
		timeout: DEFAULT_TIMEOUT_MS,
	});
	return {
		command: `${python} -m pip install ${packages.join(" ")}`,
		stdout: bounded(typeof result.stdout === "string" ? result.stdout : ""),
		stderr: bounded(result.error?.message || (typeof result.stderr === "string" ? result.stderr : "")),
		status: commandResultStatus(result),
	};
}

function rStringVector(values: string[]): string {
	return `c(${values.map((value) => JSON.stringify(value)).join(", ")})`;
}

function ensureRLibrary(workingDir: string): { command: string; stdout: string; stderr: string; status: WorkbenchExecutionStatus } {
	const library = managedRLibraryDir(workingDir);
	mkdirSync(library, { recursive: true });
	return {
		command: `dir.create(${library})`,
		stdout: "Managed R library is ready.",
		stderr: "",
		status: "complete",
	};
}

function installRPackages(workingDir: string, packages: string[]): { command: string; stdout: string; stderr: string; status: WorkbenchExecutionStatus } {
	const ready = ensureRLibrary(workingDir);
	if (ready.status !== "complete" || !packages.length) return ready;
	const library = managedRLibraryDir(workingDir);
	const repo = process.env.FEYNMAN_R_CRAN_REPO?.trim() || "https://cloud.r-project.org";
	const code = [
		`dir.create(${JSON.stringify(library)}, recursive = TRUE, showWarnings = FALSE)`,
		`.libPaths(c(${JSON.stringify(library)}, .libPaths()))`,
		`install.packages(${rStringVector(packages)}, lib = ${JSON.stringify(library)}, repos = ${JSON.stringify(repo)})`,
	].join("; ");
	const rscript = resolveRscriptRuntimeCommand().command;
	const result = spawnSync(rscript, ["-e", code], {
		cwd: workingDir,
		encoding: "utf8",
		env: notebookRuntimeProcessEnv(workingDir),
		timeout: DEFAULT_TIMEOUT_MS,
	});
	return {
		command: `${rscript} -e install.packages(${packages.join(",")})`,
		stdout: bounded(typeof result.stdout === "string" ? result.stdout : ""),
		stderr: bounded(result.error?.message || (typeof result.stderr === "string" ? result.stderr : "")),
		status: commandResultStatus(result),
	};
}

function appendActionRecord(workingDir: string, record: WorkbenchNotebookEnvironmentActionRecord): void {
	const path = actionLogPath(workingDir);
	mkdirSync(resolve(path, ".."), { recursive: true });
	appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
}

function normalizeStoredAction(value: unknown): WorkbenchNotebookEnvironmentActionRecord | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = value as Partial<WorkbenchNotebookEnvironmentActionRecord>;
	if (record.schema !== ACTION_SCHEMA || typeof record.id !== "string") return undefined;
	if (record.language !== "python" && record.language !== "r") return undefined;
	if (record.mode !== "create" && record.mode !== "install") return undefined;
	return {
		schema: ACTION_SCHEMA,
		id: record.id,
		mode: record.mode,
		language: record.language,
		environmentId: typeof record.environmentId === "string" ? record.environmentId : environmentId(record.language),
		environmentName: typeof record.environmentName === "string" ? record.environmentName : environmentName(record.language),
		packages: Array.isArray(record.packages) ? record.packages.filter((item): item is string => typeof item === "string") : [],
		status: record.status === "error" || record.status === "stopped" || record.status === "running" ? record.status : "complete",
		command: typeof record.command === "string" ? record.command : "",
		cwd: typeof record.cwd === "string" ? record.cwd : "",
		stdout: typeof record.stdout === "string" ? record.stdout : "",
		stderr: typeof record.stderr === "string" ? record.stderr : "",
		durationMs: typeof record.durationMs === "number" ? record.durationMs : 0,
		createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date(0).toISOString(),
		updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : typeof record.createdAt === "string" ? record.createdAt : new Date(0).toISOString(),
	};
}

export function readNotebookEnvironmentActions(workingDir: string): WorkbenchNotebookEnvironmentActionRecord[] {
	const path = actionLogPath(workingDir);
	if (!existsSync(path)) return [];
	try {
		return readFileSync(path, "utf8")
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.flatMap((line) => {
				try {
					const record = normalizeStoredAction(JSON.parse(line));
					return record ? [record] : [];
				} catch {
					return [];
				}
			})
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	} catch {
		return [];
	}
}

export async function manageNotebookEnvironment(
	workingDir: string,
	input: ManageNotebookEnvironmentInput,
): Promise<WorkbenchNotebookEnvironmentActionRecord> {
	const language = normalizeLanguage(input.language);
	const mode = normalizeMode(input.mode);
	const packages = normalizePackages(input.packages, language);
	const startedAtMs = Date.now();
	const createdAt = new Date(startedAtMs).toISOString();
	const result = language === "python"
		? mode === "create"
			? createPythonEnvironment(workingDir)
			: installPythonPackages(workingDir, packages)
		: mode === "create"
			? ensureRLibrary(workingDir)
			: installRPackages(workingDir, packages);
	let finalResult = result;
	if (language === "python" && mode === "create" && result.status === "complete" && packages.length) {
		finalResult = installPythonPackages(workingDir, packages);
	}
	if (language === "r" && mode === "create" && result.status === "complete" && packages.length) {
		finalResult = installRPackages(workingDir, packages);
	}
	if (finalResult.status === "complete") {
		await dropNotebookKernelsForLanguage(workingDir, language);
	}
	const finishedAtMs = Date.now();
	const record: WorkbenchNotebookEnvironmentActionRecord = {
		schema: ACTION_SCHEMA,
		id: randomUUID(),
		mode,
		language,
		environmentId: environmentId(language),
		environmentName: environmentName(language),
		packages,
		status: finalResult.status,
		command: finalResult.command,
		cwd: workingDir,
		stdout: finalResult.stdout,
		stderr: finalResult.stderr,
		durationMs: finishedAtMs - startedAtMs,
		createdAt,
		updatedAt: new Date(finishedAtMs).toISOString(),
	};
	appendActionRecord(workingDir, record);
	return record;
}

export function managedEnvironmentPackages(actions: WorkbenchNotebookEnvironmentActionRecord[], language: ManagedNotebookEnvironmentLanguage): string[] {
	return [...new Set(actions
		.filter((action) => action.language === language && action.status === "complete")
		.flatMap((action) => action.packages))]
		.sort((a, b) => a.localeCompare(b));
}

export function managedEnvironmentExists(workingDir: string, language: ManagedNotebookEnvironmentLanguage): boolean {
	return language === "python" ? existsSync(managedPythonExecutable(workingDir)) : existsSync(managedRLibraryDir(workingDir));
}
