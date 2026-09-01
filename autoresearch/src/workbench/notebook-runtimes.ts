import { existsSync } from "node:fs";
import { delimiter } from "node:path";
import { dirname, join } from "node:path";

import { workbenchDataPath } from "./data-root.js";

export type WorkbenchRuntimeCommand = {
	command: string;
	detail: string;
	source: "configured" | "managed" | "path";
};

function configured(value: string | undefined): string | undefined {
	return value?.trim() || undefined;
}

function siblingRscript(rCommand: string | undefined): string | undefined {
	if (!rCommand || !/\/R$/.test(rCommand)) return undefined;
	const candidate = join(dirname(rCommand), "Rscript");
	return existsSync(candidate) ? candidate : undefined;
}

export function managedNotebookEnvironmentRoot(workingDir: string): string {
	return workbenchDataPath(workingDir, "environments");
}

export function managedPythonEnvironmentDir(workingDir: string): string {
	return join(managedNotebookEnvironmentRoot(workingDir), "python-venv");
}

export function managedPythonExecutable(workingDir: string): string {
	return join(managedPythonEnvironmentDir(workingDir), "bin", "python");
}

export function managedRLibraryDir(workingDir: string): string {
	return join(managedNotebookEnvironmentRoot(workingDir), "r-library");
}

function existingManagedPython(workingDir: string | undefined): string | undefined {
	if (!workingDir) return undefined;
	const candidate = managedPythonExecutable(workingDir);
	return existsSync(candidate) ? candidate : undefined;
}

export function resolvePythonRuntimeCommand(workingDir?: string): WorkbenchRuntimeCommand {
	const python = configured(process.env.PYTHON);
	if (python) return { command: python, detail: "PYTHON", source: "configured" };
	const managed = existingManagedPython(workingDir);
	if (managed) return { command: managed, detail: "Feynman app data managed Python venv", source: "managed" };
	return { command: "python3", detail: "python3 on PATH", source: "path" };
}

export function resolveRRuntimeCommand(): WorkbenchRuntimeCommand {
	const r = configured(process.env.FEYNMAN_R) ?? configured(process.env.R);
	if (r) return { command: r, detail: process.env.FEYNMAN_R?.trim() ? "FEYNMAN_R" : "R", source: "configured" };
	return { command: "R", detail: "R on PATH", source: "path" };
}

export function resolveRscriptRuntimeCommand(): WorkbenchRuntimeCommand {
	const configuredRscript = configured(process.env.FEYNMAN_RSCRIPT) ?? configured(process.env.RSCRIPT) ?? siblingRscript(configured(process.env.FEYNMAN_R) ?? configured(process.env.R));
	if (configuredRscript) {
		const source = process.env.FEYNMAN_RSCRIPT?.trim() ? "FEYNMAN_RSCRIPT" : process.env.RSCRIPT?.trim() ? "RSCRIPT" : "R sibling";
		return { command: configuredRscript, detail: source, source: "configured" };
	}
	return { command: "Rscript", detail: "Rscript on PATH", source: "path" };
}

export function notebookRuntimeProcessEnv(workingDir?: string): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		FEYNMAN_WORKBENCH: "1",
		NO_COLOR: "1",
	};
	if (!workingDir) return env;
	const pythonDir = managedPythonEnvironmentDir(workingDir);
	const pythonBin = join(pythonDir, "bin");
	if (existsSync(managedPythonExecutable(workingDir))) {
		env.VIRTUAL_ENV = pythonDir;
		env.PATH = [pythonBin, process.env.PATH].filter(Boolean).join(delimiter);
	}
	const rLibrary = managedRLibraryDir(workingDir);
	if (existsSync(rLibrary)) {
		env.R_LIBS_USER = [rLibrary, process.env.R_LIBS_USER].filter(Boolean).join(delimiter);
	}
	return env;
}
