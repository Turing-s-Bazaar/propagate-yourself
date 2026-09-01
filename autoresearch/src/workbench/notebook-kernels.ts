import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";

import {
	notebookRuntimeProcessEnv,
	resolvePythonRuntimeCommand,
	resolveRRuntimeCommand,
} from "./notebook-runtimes.js";

export type SessionNotebookLanguage = "bash" | "python" | "r";

export type KernelProcessResult = {
	stdout: string;
	stderr: string;
	exitCode?: number;
	signal?: string;
	timedOut: boolean;
	truncated: boolean;
};

type NotebookKernelSession = {
	id: string;
	cwd: string;
	language: SessionNotebookLanguage;
	sessionId: string;
	isUsable: () => boolean;
	run: (code: string, timeoutMs: number, maxOutputChars: number) => Promise<KernelProcessResult>;
	stop: () => Promise<void>;
};

export type ActiveNotebookKernelSession = {
	id: string;
	cwd: string;
	language: SessionNotebookLanguage;
	sessionId: string;
	usable: boolean;
};

type KernelRequest = {
	id: string;
	resolve: (result: KernelProcessResult) => void;
	timeout: NodeJS.Timeout;
};

type MarkerKernelRequest = KernelRequest & {
	marker: string;
	stderr: string;
	truncated: boolean;
};

function normalizeId(value: string): string {
	const normalized = value
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
	return normalized || "workbench";
}

function boundedAppend(current: string, chunk: string, limit: number): { value: string; truncated: boolean } {
	if (!chunk) return { value: current, truncated: false };
	const next = current + chunk;
	if (next.length <= limit) return { value: next, truncated: false };
	return { value: next.slice(0, limit), truncated: true };
}

function maxOpenProtocolBuffer(): number {
	return 256_000;
}

function truncateResult(result: KernelProcessResult, maxOutputChars: number): KernelProcessResult {
	let truncated = result.truncated;
	const stdout = boundedAppend("", result.stdout, maxOutputChars);
	const stderr = boundedAppend("", result.stderr, maxOutputChars);
	truncated ||= stdout.truncated || stderr.truncated;
	return {
		...result,
		stdout: stdout.value,
		stderr: stderr.value,
		truncated,
	};
}

function killChildProcess(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
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

export function languageSupportsSessionKernel(language: string): language is SessionNotebookLanguage {
	return language === "bash" || language === "python" || language === "r";
}

const PYTHON_KERNEL_SCRIPT = `
import contextlib
import io
import json
import sys
import traceback

namespace = {"__name__": "__main__"}

def emit(payload):
    sys.stdout.write(json.dumps(payload) + "\\n")
    sys.stdout.flush()

for line in sys.stdin:
    try:
        request = json.loads(line)
    except Exception as exc:
        emit({"id": None, "stdout": "", "stderr": str(exc), "exitCode": 1})
        continue
    request_id = request.get("id")
    code = request.get("code", "")
    stdout = io.StringIO()
    stderr = io.StringIO()
    exit_code = 0
    try:
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            exec(compile(code, "<feynman-notebook-cell>", "exec"), namespace, namespace)
    except SystemExit as exc:
        exit_code = exc.code if isinstance(exc.code, int) else 1
    except Exception:
        exit_code = 1
        traceback.print_exc(file=stderr)
    emit({
        "id": request_id,
        "stdout": stdout.getvalue(),
        "stderr": stderr.getvalue(),
        "exitCode": exit_code,
    })
`;

class PersistentPythonKernel implements NotebookKernelSession {
	readonly id: string;
	readonly language = "python" as const;
	private child?: ChildProcessWithoutNullStreams;
	private exitError?: Error;
	private pending = new Map<string, KernelRequest>();
	private runQueue: Promise<unknown> = Promise.resolve();
	private stdoutBuffer = "";

	constructor(
		readonly cwd: string,
		readonly sessionId: string,
	) {
		this.id = `session:${normalizeId(sessionId)}:python`;
	}

	isUsable(): boolean {
		return Boolean(this.child && !this.exitError && this.child.exitCode === null);
	}

	run(code: string, timeoutMs: number, maxOutputChars: number): Promise<KernelProcessResult> {
		const run = () => this.runOnce(code, timeoutMs, maxOutputChars);
		const queued = this.runQueue.then(run, run);
		this.runQueue = queued.catch(() => undefined);
		return queued;
	}

	async stop(): Promise<void> {
		const child = this.child;
		if (!child) return;
		killChildProcess(child, "SIGTERM");
		await new Promise<void>((resolveStop) => {
			const timer = setTimeout(() => {
				killChildProcess(child, "SIGKILL");
				resolveStop();
			}, 1000);
			child.once("exit", () => {
				clearTimeout(timer);
				resolveStop();
			});
		});
		this.child = undefined;
	}

	private ensureStarted(): ChildProcessWithoutNullStreams {
		if (this.isUsable() && this.child) return this.child;
		this.exitError = undefined;
		const child = spawn(resolvePythonRuntimeCommand(this.cwd).command, ["-u", "-c", PYTHON_KERNEL_SCRIPT], {
			cwd: this.cwd,
			detached: process.platform !== "win32",
			env: notebookRuntimeProcessEnv(this.cwd),
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.child = child;
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => this.handleStdout(String(chunk), maxOpenProtocolBuffer()));
		child.stderr.on("data", (chunk) => {
			const error = new Error(`Python notebook kernel stderr: ${String(chunk).trim()}`);
			for (const request of this.pending.values()) {
				clearTimeout(request.timeout);
				request.resolve({
					stdout: "",
					stderr: error.message,
					timedOut: false,
					truncated: false,
				});
			}
			this.pending.clear();
		});
		child.once("exit", (code, signal) => {
			if (this.child !== child) return;
			this.exitError = new Error(`Python notebook kernel exited (code=${code} signal=${signal}).`);
			this.resolvePendingAfterExit(signal ?? undefined);
		});
		child.once("error", (error) => {
			if (this.child !== child) return;
			this.exitError = error;
			this.resolvePendingAfterExit(undefined);
		});
		return child;
	}

	private runOnce(code: string, timeoutMs: number, maxOutputChars: number): Promise<KernelProcessResult> {
		const child = this.ensureStarted();
		if (this.exitError) {
			return Promise.resolve({
				stdout: "",
				stderr: this.exitError.message,
				timedOut: false,
				truncated: false,
			});
		}
		const id = randomUUID();
		return new Promise<KernelProcessResult>((resolveRun) => {
			const timeout = setTimeout(() => {
				this.pending.delete(id);
				void this.stop();
				resolveRun({
					stdout: "",
					stderr: "Python notebook session kernel timed out.",
					signal: "SIGTERM",
					timedOut: true,
					truncated: false,
				});
			}, timeoutMs);
			this.pending.set(id, { id, resolve: resolveRun, timeout });
			child.stdin.write(`${JSON.stringify({ id, code, maxOutputChars })}\n`, (error) => {
				if (!error) return;
				const request = this.pending.get(id);
				if (!request) return;
				this.pending.delete(id);
				clearTimeout(request.timeout);
				request.resolve({
					stdout: "",
					stderr: error.message,
					timedOut: false,
					truncated: false,
				});
			});
		}).then((result) => truncateResult(result, maxOutputChars));
	}

	private handleStdout(chunk: string, maxBuffer: number): void {
		this.stdoutBuffer += chunk;
		if (this.stdoutBuffer.length > maxBuffer) {
			this.stdoutBuffer = this.stdoutBuffer.slice(-maxBuffer);
		}
		let newline = this.stdoutBuffer.indexOf("\n");
		while (newline !== -1) {
			const line = this.stdoutBuffer.slice(0, newline);
			this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
			this.handleProtocolLine(line);
			newline = this.stdoutBuffer.indexOf("\n");
		}
	}

	private handleProtocolLine(line: string): void {
		if (!line.trim()) return;
		let payload: Record<string, unknown>;
		try {
			payload = JSON.parse(line) as Record<string, unknown>;
		} catch {
			return;
		}
		const id = typeof payload.id === "string" ? payload.id : undefined;
		if (!id) return;
		const request = this.pending.get(id);
		if (!request) return;
		this.pending.delete(id);
		clearTimeout(request.timeout);
		const exitCode = typeof payload.exitCode === "number" ? payload.exitCode : undefined;
		request.resolve({
			stdout: typeof payload.stdout === "string" ? payload.stdout : "",
			stderr: typeof payload.stderr === "string" ? payload.stderr : "",
			...(exitCode !== undefined ? { exitCode } : {}),
			timedOut: false,
			truncated: false,
		});
	}

	private resolvePendingAfterExit(signal: string | undefined): void {
		for (const request of this.pending.values()) {
			clearTimeout(request.timeout);
			request.resolve({
				stdout: "",
				stderr: this.exitError?.message ?? "Python notebook kernel exited.",
				...(signal ? { signal } : {}),
				timedOut: false,
				truncated: false,
			});
		}
		this.pending.clear();
	}
}

class PersistentBashKernel implements NotebookKernelSession {
	readonly id: string;
	readonly language = "bash" as const;
	private child?: ChildProcessWithoutNullStreams;
	private current?: MarkerKernelRequest;
	private exitError?: Error;
	private runQueue: Promise<unknown> = Promise.resolve();
	private stdoutBuffer = "";

	constructor(
		readonly cwd: string,
		readonly sessionId: string,
	) {
		this.id = `session:${normalizeId(sessionId)}:bash`;
	}

	isUsable(): boolean {
		return Boolean(this.child && !this.exitError && this.child.exitCode === null);
	}

	run(code: string, timeoutMs: number, maxOutputChars: number): Promise<KernelProcessResult> {
		const run = () => this.runOnce(code, timeoutMs, maxOutputChars);
		const queued = this.runQueue.then(run, run);
		this.runQueue = queued.catch(() => undefined);
		return queued;
	}

	async stop(): Promise<void> {
		const child = this.child;
		if (!child) return;
		killChildProcess(child, "SIGTERM");
		await new Promise<void>((resolveStop) => {
			const timer = setTimeout(() => {
				killChildProcess(child, "SIGKILL");
				resolveStop();
			}, 1000);
			child.once("exit", () => {
				clearTimeout(timer);
				resolveStop();
			});
		});
		this.child = undefined;
	}

	private ensureStarted(): ChildProcessWithoutNullStreams {
		if (this.isUsable() && this.child) return this.child;
		this.exitError = undefined;
		this.stdoutBuffer = "";
		const child = spawn("bash", ["--noprofile", "--norc"], {
			cwd: this.cwd,
			detached: process.platform !== "win32",
			env: notebookRuntimeProcessEnv(this.cwd),
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.child = child;
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => this.handleStdout(String(chunk)));
		child.stderr.on("data", (chunk) => {
			const request = this.current;
			if (!request) return;
			const bounded = boundedAppend(request.stderr, String(chunk), maxOpenProtocolBuffer());
			request.stderr = bounded.value;
			request.truncated ||= bounded.truncated;
		});
		child.once("exit", (code, signal) => {
			if (this.child !== child) return;
			this.exitError = new Error(`Bash notebook kernel exited (code=${code} signal=${signal}).`);
			this.resolveCurrentAfterExit(signal ?? undefined);
		});
		child.once("error", (error) => {
			if (this.child !== child) return;
			this.exitError = error;
			this.resolveCurrentAfterExit(undefined);
		});
		return child;
	}

	private runOnce(code: string, timeoutMs: number, maxOutputChars: number): Promise<KernelProcessResult> {
		const child = this.ensureStarted();
		if (this.exitError) {
			return Promise.resolve({
				stdout: "",
				stderr: this.exitError.message,
				timedOut: false,
				truncated: false,
			});
		}
		const id = randomUUID();
		const marker = `__FEYNMAN_NOTEBOOK_${id.replace(/-/g, "")}_DONE__`;
		return new Promise<KernelProcessResult>((resolveRun) => {
			const timeout = setTimeout(() => {
				this.current = undefined;
				void this.stop();
				resolveRun({
					stdout: this.stdoutBuffer,
					stderr: "Bash notebook session kernel timed out.",
					signal: "SIGTERM",
					timedOut: true,
					truncated: false,
				});
			}, timeoutMs);
			this.current = {
				id,
				marker,
				resolve: resolveRun,
				stderr: "",
				timeout,
				truncated: false,
			};
			child.stdin.write(`${code}\n__feynman_status=$?\nprintf '\\n${marker}:%s\\n' "$__feynman_status"\n`, (error) => {
				if (!error) return;
				const request = this.current;
				if (!request || request.id !== id) return;
				this.current = undefined;
				clearTimeout(request.timeout);
				request.resolve({
					stdout: "",
					stderr: error.message,
					timedOut: false,
					truncated: false,
				});
			});
		}).then((result) => truncateResult(result, maxOutputChars));
	}

	private handleStdout(chunk: string): void {
		this.stdoutBuffer += chunk;
		const request = this.current;
		if (!request) return;
		const markerStart = this.stdoutBuffer.indexOf(`${request.marker}:`);
		if (markerStart === -1) return;
		const exitStart = markerStart + request.marker.length + 1;
		const newlineAfter = this.stdoutBuffer.indexOf("\n", exitStart);
		if (newlineAfter === -1) return;
		const stdout = this.stdoutBuffer.slice(0, markerStart).replace(/\n$/, "");
		const exitText = this.stdoutBuffer.slice(exitStart, newlineAfter).trim();
		const exitCode = Number.parseInt(exitText, 10);
		this.stdoutBuffer = this.stdoutBuffer.slice(newlineAfter + 1);
		this.current = undefined;
		clearTimeout(request.timeout);
		request.resolve({
			stdout,
			stderr: request.stderr,
			...(Number.isFinite(exitCode) ? { exitCode } : {}),
			timedOut: false,
			truncated: request.truncated,
		});
	}

	private resolveCurrentAfterExit(signal: string | undefined): void {
		const request = this.current;
		if (!request) return;
		this.current = undefined;
		clearTimeout(request.timeout);
		request.resolve({
			stdout: this.stdoutBuffer,
			stderr: request.stderr || this.exitError?.message || "Bash notebook kernel exited.",
			...(signal ? { signal } : {}),
			timedOut: false,
			truncated: request.truncated,
		});
	}
}

function rStringLiteral(value: string): string {
	return `"${value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "\\r")
		.replace(/\t/g, "\\t")}"`;
}

class PersistentRKernel implements NotebookKernelSession {
	readonly id: string;
	readonly language = "r" as const;
	private child?: ChildProcessWithoutNullStreams;
	private current?: MarkerKernelRequest;
	private exitError?: Error;
	private runQueue: Promise<unknown> = Promise.resolve();
	private stdoutBuffer = "";

	constructor(
		readonly cwd: string,
		readonly sessionId: string,
	) {
		this.id = `session:${normalizeId(sessionId)}:r`;
	}

	isUsable(): boolean {
		return Boolean(this.child && !this.exitError && this.child.exitCode === null);
	}

	run(code: string, timeoutMs: number, maxOutputChars: number): Promise<KernelProcessResult> {
		const run = () => this.runOnce(code, timeoutMs, maxOutputChars);
		const queued = this.runQueue.then(run, run);
		this.runQueue = queued.catch(() => undefined);
		return queued;
	}

	async stop(): Promise<void> {
		const child = this.child;
		if (!child) return;
		killChildProcess(child, "SIGTERM");
		await new Promise<void>((resolveStop) => {
			const timer = setTimeout(() => {
				killChildProcess(child, "SIGKILL");
				resolveStop();
			}, 1000);
			child.once("exit", () => {
				clearTimeout(timer);
				resolveStop();
			});
		});
		this.child = undefined;
	}

	private ensureStarted(): ChildProcessWithoutNullStreams {
		if (this.isUsable() && this.child) return this.child;
		this.exitError = undefined;
		this.stdoutBuffer = "";
		const child = spawn(resolveRRuntimeCommand().command, ["--vanilla", "--slave"], {
			cwd: this.cwd,
			detached: process.platform !== "win32",
			env: notebookRuntimeProcessEnv(this.cwd),
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.child = child;
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => this.handleStdout(String(chunk)));
		child.stderr.on("data", (chunk) => {
			const request = this.current;
			if (!request) return;
			const bounded = boundedAppend(request.stderr, String(chunk), maxOpenProtocolBuffer());
			request.stderr = bounded.value;
			request.truncated ||= bounded.truncated;
		});
		child.once("exit", (code, signal) => {
			if (this.child !== child) return;
			this.exitError = new Error(`R notebook kernel exited (code=${code} signal=${signal}).`);
			this.resolveCurrentAfterExit(signal ?? undefined);
		});
		child.once("error", (error) => {
			if (this.child !== child) return;
			this.exitError = error;
			this.resolveCurrentAfterExit(undefined);
		});
		return child;
	}

	private runOnce(code: string, timeoutMs: number, maxOutputChars: number): Promise<KernelProcessResult> {
		const child = this.ensureStarted();
		if (this.exitError) {
			return Promise.resolve({
				stdout: "",
				stderr: this.exitError.message,
				timedOut: false,
				truncated: false,
			});
		}
		const id = randomUUID();
		const marker = `__FEYNMAN_NOTEBOOK_${id.replace(/-/g, "")}_DONE__`;
		const wrappedCode = [
			".feynman_status <- 0",
			`tryCatch({ eval(parse(text = ${rStringLiteral(code)}), envir = .GlobalEnv) }, error = function(e) { .feynman_status <<- 1; message(conditionMessage(e)) })`,
			`cat("\\n${marker}:", .feynman_status, "\\n", sep = "")`,
		].join("\n");
		return new Promise<KernelProcessResult>((resolveRun) => {
			const timeout = setTimeout(() => {
				this.current = undefined;
				void this.stop();
				resolveRun({
					stdout: this.stdoutBuffer,
					stderr: "R notebook session kernel timed out.",
					signal: "SIGTERM",
					timedOut: true,
					truncated: false,
				});
			}, timeoutMs);
			this.current = {
				id,
				marker,
				resolve: resolveRun,
				stderr: "",
				timeout,
				truncated: false,
			};
			child.stdin.write(`${wrappedCode}\n`, (error) => {
				if (!error) return;
				const request = this.current;
				if (!request || request.id !== id) return;
				this.current = undefined;
				clearTimeout(request.timeout);
				request.resolve({
					stdout: "",
					stderr: error.message,
					timedOut: false,
					truncated: false,
				});
			});
		}).then((result) => truncateResult(result, maxOutputChars));
	}

	private handleStdout(chunk: string): void {
		this.stdoutBuffer += chunk;
		const request = this.current;
		if (!request) return;
		const markerStart = this.stdoutBuffer.indexOf(`${request.marker}:`);
		if (markerStart === -1) return;
		const exitStart = markerStart + request.marker.length + 1;
		const newlineAfter = this.stdoutBuffer.indexOf("\n", exitStart);
		if (newlineAfter === -1) return;
		const stdout = this.stdoutBuffer.slice(0, markerStart).replace(/\n$/, "");
		const exitText = this.stdoutBuffer.slice(exitStart, newlineAfter).trim();
		const exitCode = Number.parseInt(exitText, 10);
		this.stdoutBuffer = this.stdoutBuffer.slice(newlineAfter + 1);
		this.current = undefined;
		clearTimeout(request.timeout);
		request.resolve({
			stdout,
			stderr: request.stderr,
			...(Number.isFinite(exitCode) ? { exitCode } : {}),
			timedOut: false,
			truncated: request.truncated,
		});
	}

	private resolveCurrentAfterExit(signal: string | undefined): void {
		const request = this.current;
		if (!request) return;
		this.current = undefined;
		clearTimeout(request.timeout);
		request.resolve({
			stdout: this.stdoutBuffer,
			stderr: request.stderr || this.exitError?.message || "R notebook kernel exited.",
			...(signal ? { signal } : {}),
			timedOut: false,
			truncated: request.truncated,
		});
	}
}

const notebookKernelSessions = new Map<string, NotebookKernelSession>();

function notebookKernelKey(workingDir: string, sessionId: string, language: SessionNotebookLanguage): string {
	return [workingDir, normalizeId(sessionId), language].join("\0");
}

export function getNotebookKernel(workingDir: string, sessionId: string, language: SessionNotebookLanguage): NotebookKernelSession {
	const key = notebookKernelKey(workingDir, sessionId, language);
	const existing = notebookKernelSessions.get(key);
	if (existing?.isUsable()) return existing;
	const kernel = language === "python"
		? new PersistentPythonKernel(workingDir, sessionId)
		: language === "r"
			? new PersistentRKernel(workingDir, sessionId)
			: new PersistentBashKernel(workingDir, sessionId);
	notebookKernelSessions.set(key, kernel);
	return kernel;
}

export function dropNotebookKernel(workingDir: string, sessionId: string, language: SessionNotebookLanguage): void {
	notebookKernelSessions.delete(notebookKernelKey(workingDir, sessionId, language));
}

export async function dropNotebookKernelsForLanguage(workingDir: string, language: SessionNotebookLanguage): Promise<void> {
	const kernels = [...notebookKernelSessions.values()].filter((kernel) => kernel.cwd === workingDir && kernel.language === language);
	for (const kernel of kernels) {
		notebookKernelSessions.delete(notebookKernelKey(kernel.cwd, kernel.sessionId, kernel.language));
	}
	await Promise.all(kernels.map((kernel) => kernel.stop()));
}

export function listNotebookKernelSessions(workingDir?: string): ActiveNotebookKernelSession[] {
	return [...notebookKernelSessions.values()]
		.filter((kernel) => !workingDir || kernel.cwd === workingDir)
		.map((kernel) => ({
			id: kernel.id,
			cwd: kernel.cwd,
			language: kernel.language,
			sessionId: kernel.sessionId,
			usable: kernel.isUsable(),
		}))
		.sort((a, b) => a.id.localeCompare(b.id));
}

export async function closeNotebookKernelSessions(): Promise<void> {
	const kernels = [...notebookKernelSessions.values()];
	notebookKernelSessions.clear();
	await Promise.all(kernels.map((kernel) => kernel.stop()));
}
