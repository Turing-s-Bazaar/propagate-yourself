import { spawn } from "node:child_process";
import { dirname, relative, resolve, sep } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

import { migratedWorkbenchDataPath, workbenchDataPath } from "./data-root.js";

const MODAL_RESULT_MARKER = "__FEYNMAN_MODAL_RESULT__";

export type WorkbenchModalProcessResult = {
	stdout: string;
	stderr: string;
	exitCode?: number;
	signal?: string;
	canceled?: boolean;
	timedOut: boolean;
	truncated: boolean;
	command: string;
	scriptPath: string;
	outputPaths: string[];
};

type ModalNotebookInput = {
	code: string;
	jobId: string;
	maxOutputChars: number;
	signal?: AbortSignal;
	timeoutMs: number;
	workingDir: string;
};

type ModalArtifactTransfer = {
	path?: unknown;
	contentBase64?: unknown;
	size?: unknown;
	skipped?: unknown;
};

type ParsedModalResult = {
	stdout: string;
	stderr: string;
	exitCode?: number;
	cliLog: string;
	artifacts: ModalArtifactTransfer[];
	artifactError?: string;
};

const TRACKED_ARTIFACT_ROOTS = new Set(["outputs", "papers", "notes"]);

function toPosixPath(path: string): string {
	return path.split(sep).join("/");
}

function normalizeId(value: string): string {
	const normalized = value
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
	return normalized || "modal-job";
}

function boundedAppend(current: string, chunk: string, limit: number): { value: string; truncated: boolean } {
	if (!chunk) return { value: current, truncated: false };
	const next = current + chunk;
	if (next.length <= limit) return { value: next, truncated: false };
	return { value: next.slice(0, limit), truncated: true };
}

function killChildProcess(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
	if (process.platform !== "win32" && child.pid) {
		try {
			process.kill(-child.pid, signal);
			return;
		} catch {
			// Fall through to direct child termination.
		}
	}
	child.kill(signal);
}

export function managedModalCliPath(workingDir: string): string {
	return workbenchDataPath(workingDir, "modal-venv", process.platform === "win32" ? "Scripts/modal.exe" : "bin/modal");
}

export function resolveModalCliCommand(workingDir: string): string {
	const override = process.env.FEYNMAN_MODAL_CLI?.trim();
	if (override) return override;
	const managed = managedModalCliPath(workingDir);
	if (existsSync(managed)) return managed;
	return "modal";
}

function modalJobsDir(workingDir: string): string {
	return migratedWorkbenchDataPath(workingDir, "modal-jobs");
}

function modalScriptPath(workingDir: string, jobId: string): string {
	return resolve(modalJobsDir(workingDir), `${normalizeId(jobId)}.py`);
}

function boundedModalTimeoutSeconds(timeoutMs: number): number {
	return Math.max(1, Math.min(86_400, Math.ceil(timeoutMs / 1000)));
}

function modalScriptSource(code: string, jobId: string, timeoutMs: number): string {
	const timeoutSeconds = boundedModalTimeoutSeconds(timeoutMs);
	return [
		"import base64",
		"import contextlib",
		"import io",
		"import json",
		"import os",
		"from pathlib import Path",
		"import shutil",
		"import traceback",
		"import modal",
		"",
		`USER_CODE = ${JSON.stringify(code)}`,
		`RESULT_MARKER = ${JSON.stringify(MODAL_RESULT_MARKER)}`,
		'ARTIFACT_ROOT = "/tmp/feynman-modal-artifacts"',
		"TRACKED_ARTIFACT_ROOTS = {'outputs', 'papers', 'notes'}",
		"MAX_ARTIFACT_FILES = 16",
		"MAX_ARTIFACT_BYTES = 65536",
		"MAX_ARTIFACT_TOTAL_BYTES = 262144",
		`app = modal.App(${JSON.stringify(`feynman-notebook-${normalizeId(jobId)}`)})`,
		'image = modal.Image.debian_slim(python_version="3.11")',
		"",
		"def collect_artifacts():",
		"    root = Path(ARTIFACT_ROOT)",
		"    if not root.exists():",
		"        return []",
		"    artifacts = []",
		"    total_bytes = 0",
		"    for path in sorted(root.rglob('*')):",
		"        if len(artifacts) >= MAX_ARTIFACT_FILES:",
		"            break",
		"        if not path.is_file():",
		"            continue",
		"        try:",
		"            rel_path = path.relative_to(root).as_posix()",
		"        except ValueError:",
		"            continue",
		"        parts = rel_path.split('/')",
		"        if not parts or parts[0] not in TRACKED_ARTIFACT_ROOTS or any(part in ('', '.', '..') for part in parts):",
		"            continue",
		"        size = path.stat().st_size",
		"        if size > MAX_ARTIFACT_BYTES or total_bytes + size > MAX_ARTIFACT_TOTAL_BYTES:",
		"            artifacts.append({'path': rel_path, 'size': size, 'skipped': 'too_large'})",
		"            continue",
		"        data = path.read_bytes()",
		"        total_bytes += len(data)",
		"        artifacts.append({",
		"            'path': rel_path,",
		"            'size': len(data),",
		"            'contentBase64': base64.b64encode(data).decode('ascii'),",
		"        })",
		"    return artifacts",
		"",
		`@app.function(image=image, timeout=${timeoutSeconds})`,
		"def run_cell():",
		"    stdout = io.StringIO()",
		"    stderr = io.StringIO()",
		"    namespace = {}",
		"    exit_code = 0",
		"    artifacts = []",
		"    artifact_error = ''",
		"    shutil.rmtree(ARTIFACT_ROOT, ignore_errors=True)",
		"    Path(ARTIFACT_ROOT).mkdir(parents=True, exist_ok=True)",
		"    os.environ['FEYNMAN_MODAL_ARTIFACT_DIR'] = ARTIFACT_ROOT",
		"    with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):",
		"        try:",
		'            exec(compile(USER_CODE, "<feynman-modal-notebook>", "exec"), namespace, namespace)',
		"        except SystemExit as exc:",
		"            code = exc.code if isinstance(exc.code, int) else 1",
		"            exit_code = code",
		"        except BaseException:",
		"            traceback.print_exc()",
		"            exit_code = 1",
		"    try:",
		"        artifacts = collect_artifacts()",
		"    except BaseException:",
		"        artifact_error = traceback.format_exc()",
		"    return {",
		'        "stdout": stdout.getvalue(),',
		'        "stderr": stderr.getvalue(),',
		'        "exitCode": exit_code,',
		'        "artifacts": artifacts,',
		'        "artifactError": artifact_error,',
		"    }",
		"",
		"@app.local_entrypoint()",
		"def main():",
		"    result = run_cell.remote()",
		"    print(RESULT_MARKER + json.dumps(result, sort_keys=True))",
		'    exit_code = int(result.get("exitCode") or 0)',
		"    if exit_code:",
		"        raise SystemExit(exit_code)",
		"",
	].join("\n");
}

function parseModalResult(stdout: string): ParsedModalResult | undefined {
	const lines = stdout.split(/\r?\n/);
	const markerLine = lines.find((line) => line.startsWith(MODAL_RESULT_MARKER));
	if (!markerLine) return undefined;
	try {
		const parsed = JSON.parse(markerLine.slice(MODAL_RESULT_MARKER.length)) as {
			artifactError?: unknown;
			artifacts?: unknown;
			exitCode?: unknown;
			stderr?: unknown;
			stdout?: unknown;
		};
		return {
			stdout: typeof parsed.stdout === "string" ? parsed.stdout : "",
			stderr: typeof parsed.stderr === "string" ? parsed.stderr : "",
			...(typeof parsed.exitCode === "number" ? { exitCode: parsed.exitCode } : {}),
			cliLog: lines.filter((line) => line !== markerLine).join("\n").trim(),
			artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts : [],
			...(typeof parsed.artifactError === "string" && parsed.artifactError.trim() ? { artifactError: parsed.artifactError } : {}),
		};
	} catch {
		return undefined;
	}
}

function normalizeArtifactPath(workingDir: string, path: string): string | undefined {
	const workspace = resolve(workingDir);
	const absPath = resolve(workspace, path);
	const rel = toPosixPath(relative(workspace, absPath));
	if (!rel || rel === ".." || rel.startsWith("../") || rel.split("/").includes("..")) return undefined;
	const root = rel.split("/")[0] ?? "";
	return TRACKED_ARTIFACT_ROOTS.has(root) ? rel : undefined;
}

function writeModalArtifacts(workingDir: string, artifacts: ModalArtifactTransfer[]): { outputPaths: string[]; warnings: string[] } {
	const outputPaths = new Set<string>();
	const warnings: string[] = [];
	for (const artifact of artifacts) {
		const rawPath = typeof artifact.path === "string" ? artifact.path : "";
		const relPath = rawPath ? normalizeArtifactPath(workingDir, rawPath) : undefined;
		if (!relPath) {
			if (rawPath) warnings.push(`Skipped Modal artifact outside tracked roots: ${rawPath}`);
			continue;
		}
		if (typeof artifact.skipped === "string" && artifact.skipped) {
			warnings.push(`Skipped Modal artifact ${relPath}: ${artifact.skipped}`);
			continue;
		}
		if (typeof artifact.contentBase64 !== "string") {
			warnings.push(`Skipped Modal artifact ${relPath}: missing content`);
			continue;
		}
		try {
			const content = Buffer.from(artifact.contentBase64, "base64");
			if (typeof artifact.size === "number" && Number.isFinite(artifact.size) && content.length !== artifact.size) {
				warnings.push(`Modal artifact ${relPath} size mismatch: expected ${artifact.size}, wrote ${content.length}`);
			}
			const absPath = resolve(workingDir, relPath);
			mkdirSync(dirname(absPath), { recursive: true });
			writeFileSync(absPath, content);
			outputPaths.add(relPath);
		} catch (error) {
			warnings.push(`Failed to write Modal artifact ${relPath}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return { outputPaths: [...outputPaths].sort((a, b) => a.localeCompare(b)), warnings };
}

export function writeModalNotebookScript(input: ModalNotebookInput): string {
	const workingDir = resolve(input.workingDir);
	mkdirSync(modalJobsDir(workingDir), { recursive: true });
	const absPath = modalScriptPath(workingDir, input.jobId);
	writeFileSync(absPath, modalScriptSource(input.code, input.jobId, input.timeoutMs), "utf8");
	return absPath;
}

export function runModalNotebookCell(input: ModalNotebookInput): Promise<WorkbenchModalProcessResult> {
	const workingDir = resolve(input.workingDir);
	const relativeScriptPath = writeModalNotebookScript({ ...input, workingDir });
	const command = resolveModalCliCommand(workingDir);
	const commandLabel = `${command} run ${relativeScriptPath}`;
	return new Promise((resolveProcess) => {
		let stdout = "";
		let stderr = "";
		let truncated = false;
		let settled = false;
		let timedOut = false;
		let canceled = input.signal?.aborted ?? false;
		let killTimer: NodeJS.Timeout | undefined;
		const child = spawn(command, ["run", relativeScriptPath], {
			cwd: workingDir,
			detached: process.platform !== "win32",
			env: {
				...process.env,
				FEYNMAN_WORKBENCH: "1",
				NO_COLOR: "1",
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
		const timer = setTimeout(() => {
			timedOut = true;
			killChildProcess(child, "SIGTERM");
		}, input.timeoutMs);
		const abortHandler = () => {
			if (settled) return;
			canceled = true;
			killChildProcess(child, "SIGTERM");
			killTimer = setTimeout(() => killChildProcess(child, "SIGKILL"), 1000);
		};
		if (input.signal) {
			if (input.signal.aborted) abortHandler();
			else input.signal.addEventListener("abort", abortHandler, { once: true });
		}
		const cleanup = () => {
			clearTimeout(timer);
			if (killTimer) clearTimeout(killTimer);
			input.signal?.removeEventListener("abort", abortHandler);
		};
		child.stdout.on("data", (chunk: Buffer) => {
			const bounded = boundedAppend(stdout, chunk.toString("utf8"), input.maxOutputChars);
			stdout = bounded.value;
			truncated ||= bounded.truncated;
		});
		child.stderr.on("data", (chunk: Buffer) => {
			const bounded = boundedAppend(stderr, chunk.toString("utf8"), input.maxOutputChars);
			stderr = bounded.value;
			truncated ||= bounded.truncated;
		});
		child.on("error", (error) => {
			if (settled) return;
			settled = true;
			cleanup();
			resolveProcess({
				stdout,
				stderr: stderr || `${command} is not available. Install the Modal CLI with pip install modal, then run modal setup if needed.`,
				exitCode: 127,
				canceled,
				timedOut,
				truncated,
				command: commandLabel,
				scriptPath: relativeScriptPath,
				outputPaths: [],
			});
		});
		child.on("close", (exitCode, signal) => {
			if (settled) return;
			settled = true;
			cleanup();
			const parsed = parseModalResult(stdout);
			const cliLog = parsed?.cliLog;
			const artifactWrites = parsed ? writeModalArtifacts(workingDir, parsed.artifacts) : { outputPaths: [], warnings: [] };
			resolveProcess({
				stdout: parsed ? parsed.stdout : stdout,
				stderr: [
					parsed?.stderr ?? "",
					parsed?.artifactError ? `Modal artifact capture error:\n${parsed.artifactError}` : "",
					artifactWrites.warnings.length ? `Modal artifact warnings:\n${artifactWrites.warnings.join("\n")}` : "",
					cliLog ? `Modal CLI log:\n${cliLog}` : "",
					canceled ? "Notebook execution canceled." : "",
					parsed ? stderr.trim() : stderr,
				].filter(Boolean).join("\n\n"),
				...(typeof (parsed?.exitCode ?? exitCode) === "number" ? { exitCode: parsed?.exitCode ?? exitCode ?? undefined } : {}),
				...(signal || canceled ? { signal: signal ?? "SIGTERM" } : {}),
				canceled,
				timedOut,
				truncated,
				command: commandLabel,
				scriptPath: relativeScriptPath,
				outputPaths: artifactWrites.outputPaths,
			});
		});
	});
}
