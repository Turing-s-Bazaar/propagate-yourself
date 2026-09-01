import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	observeChildProcessClose,
	terminateChildProcessTree,
} from "../scripts/lib/child-process-cleanup.mjs";
import {
	isDirectExecution,
	verifyRpcSurface,
} from "../scripts/verify-installed-runtime.mjs";

function createFakeChild() {
	const child = new EventEmitter() as any;
	const stdin = new EventEmitter() as any;
	stdin.destroyed = false;
	stdin.closed = false;
	stdin.write = () => true;
	stdin.end = () => {};
	stdin.destroy = () => {
		stdin.destroyed = true;
	};
	const stdout = new EventEmitter() as any;
	stdout.destroyed = false;
	stdout.closed = false;
	stdout.setEncoding = () => {};
	const stderr = new EventEmitter() as any;
	stderr.destroyed = false;
	stderr.closed = false;
	stderr.setEncoding = () => {};

	child.pid = 999_997;
	child.exitCode = null;
	child.signalCode = null;
	child.stdin = stdin;
	child.stdout = stdout;
	child.stderr = stderr;
	child.kill = () => true;
	return child;
}

test("installed verifier direct-execution detection follows symlinked temp paths", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-verifier-entry-"));
	const verifierPath = join(process.cwd(), "scripts", "verify-installed-runtime.mjs");
	const symlinkPath = join(root, "verify-installed-runtime.mjs");
	try {
		symlinkSync(verifierPath, symlinkPath);
		assert.equal(isDirectExecution(symlinkPath, verifierPath), true);
		assert.equal(isDirectExecution(join(root, "missing.mjs"), verifierPath), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

function closeFakeChild(
	child: any,
	code: number | null = 1,
	signal: NodeJS.Signals | null = null,
) {
	child.exitCode = code;
	child.signalCode = signal;
	for (const stream of [child.stdin, child.stdout, child.stderr]) {
		stream.closed = true;
		stream.destroyed = true;
	}
	child.emit("close", code, signal);
}

test("observeChildProcessClose waits for close after exit", async () => {
	const child = createFakeChild();
	const closePromise = observeChildProcessClose(child);
	let closed = false;
	void closePromise.then(() => {
		closed = true;
	});

	child.exitCode = 0;
	child.emit("exit", 0, null);
	await new Promise((resolvePromise) => setImmediate(resolvePromise));
	assert.equal(closed, false);

	closeFakeChild(child, 0);
	assert.deepEqual(await closePromise, { code: 0, signal: null });
});

test("terminateChildProcessTree does not confuse process exit with stdio close", async () => {
	const child = new EventEmitter() as any;
	child.pid = 999_999;
	child.exitCode = 0;
	child.signalCode = null;
	child.stdin = { destroy() {} };
	child.stdout = { closed: false, destroyed: false };
	child.stderr = { closed: false, destroyed: false };
	child.kill = () => false;

	const startedAt = Date.now();
	await assert.rejects(
		terminateChildProcessTree(child, {
			platform: "darwin",
			graceMs: 25,
			forceMs: 25,
		}),
		/Timed out terminating POSIX child process tree/,
	);
	assert.ok(Date.now() - startedAt >= 40, "cleanup returned before waiting for close");
});

test("terminateChildProcessTree bounds an unresponsive Windows taskkill process", async () => {
	const child = new EventEmitter() as any;
	child.pid = 999_998;
	child.exitCode = null;
	child.signalCode = null;
	child.stdin = { destroy() {} };
	child.stdout = { closed: false, destroyed: false };
	child.stderr = { closed: false, destroyed: false };
	child.kill = () => false;
	const spawnProcess = (() => {
		const killer = new EventEmitter() as any;
		killer.kill = () => true;
		return killer;
	}) as typeof spawn;

	const startedAt = Date.now();
	await assert.rejects(
			terminateChildProcessTree(child, {
				platform: "win32",
				graceMs: 20,
				forceMs: 20,
				taskkillMs: 20,
				taskkillForceMs: 20,
				spawnProcess,
			}),
		/Timed out terminating Windows child process tree/,
	);
	assert.ok(Date.now() - startedAt < 250, "unresponsive taskkill was not bounded");
});

test("terminateChildProcessTree uses graceful then forced Windows tree termination", async () => {
	const child = createFakeChild();
	const taskkillArguments: string[][] = [];
	const spawnProcess = ((_command: string, args: string[]) => {
		taskkillArguments.push(args);
		const killer = new EventEmitter() as any;
		killer.kill = () => true;
		setImmediate(() => {
			killer.emit("close", 0, null);
			if (args.includes("/f")) {
				closeFakeChild(child, null, "SIGTERM");
			}
		});
		return killer;
	}) as typeof spawn;

	await terminateChildProcessTree(child, {
		platform: "win32",
		graceMs: 10,
		forceMs: 50,
		taskkillMs: 50,
		taskkillForceMs: 50,
		spawnProcess,
	});
	assert.deepEqual(taskkillArguments, [
		["/pid", `${child.pid}`, "/t"],
		["/pid", `${child.pid}`, "/t", "/f"],
	]);
});

test("terminateChildProcessTree rejects nonzero Windows taskkill exits even when the child closes", async () => {
	const child = createFakeChild();
	let taskkillCalls = 0;
	const spawnProcess = (() => {
		taskkillCalls += 1;
		const killer = new EventEmitter() as any;
		killer.kill = () => true;
		setImmediate(() => {
			killer.emit("close", 1, null);
			if (taskkillCalls === 1) {
				closeFakeChild(child, 0);
			}
		});
		return killer;
	}) as typeof spawn;

	await assert.rejects(
		terminateChildProcessTree(child, {
			platform: "win32",
			graceMs: 25,
			forceMs: 25,
			taskkillMs: 50,
			taskkillForceMs: 50,
			spawnProcess,
		}),
		(error: unknown) => {
			assert.ok(error instanceof AggregateError);
			assert.match(error.message, /Timed out terminating Windows child process tree/);
			assert.match(error.errors.map(String).join("\n"), /taskkill(?: \/f)? failed.*code=1/);
			return true;
		},
	);
	assert.equal(taskkillCalls, 2);
});

test("verifyRpcSurface tears down stdin, spawn, nonzero-exit, and timeout failures", async (context) => {
	const scenarios = [
		{
			name: "stdin error",
			trigger(child: any, error: Error) {
				child.stdin.emit("error", error);
			},
			expected: /fixture stdin failed/,
		},
		{
			name: "child error",
			trigger(child: any, error: Error) {
				child.emit("error", error);
			},
			expected: /fixture child failed/,
		},
		{
			name: "nonzero exit",
			trigger(child: any) {
				child.exitCode = 7;
				child.emit("exit", 7, null);
			},
			expected: /Installed RPC verification failed: code=7/,
		},
		{
			name: "timeout",
			trigger() {},
			expected: /Installed RPC verification timed out/,
		},
	];

	for (const scenario of scenarios) {
		await context.test(scenario.name, async () => {
			const child = createFakeChild();
			const primaryError = new Error(`fixture ${scenario.name.replace("error", "").trim()} failed`);
			let cleanupCalls = 0;
			const spawnProcess = (() => {
				if (scenario.name !== "timeout") {
					setImmediate(() => scenario.trigger(child, primaryError));
				}
				return child;
			}) as typeof spawn;
			const terminateProcessTree = async (
				target: any,
				options: { closePromise: Promise<unknown> },
			) => {
				cleanupCalls += 1;
				closeFakeChild(target);
				await options.closePromise;
			};

			await assert.rejects(
				verifyRpcSurface({
					binaryPath: "/fixture/feynman",
					spawnProcess,
					terminateProcessTree,
					timeoutMs: 15,
				}),
				scenario.expected,
			);
			assert.equal(cleanupCalls, 1);
		});
	}
});

test("verifyRpcSurface preserves the primary error when tree cleanup fails", async () => {
	const child = createFakeChild();
	const primaryError = new Error("primary RPC failure");
	const cleanupError = new Error("tree cleanup failure");
	const spawnProcess = (() => {
		setImmediate(() => child.emit("error", primaryError));
		return child;
	}) as typeof spawn;

	await assert.rejects(
		verifyRpcSurface({
			binaryPath: "/fixture/feynman",
			spawnProcess,
			terminateProcessTree: async () => {
				throw cleanupError;
			},
			timeoutMs: 100,
		}),
		(error: unknown) => {
			assert.ok(error instanceof AggregateError);
			assert.equal(error.cause, primaryError);
			assert.deepEqual(error.errors, [primaryError, cleanupError]);
			assert.match(error.message, /primary RPC failure; installed RPC cleanup also failed/);
			return true;
		},
	);
});

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
	}
	assert.fail("Timed out waiting for child-process fixture state");
}

function processExists(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

test("terminateChildProcessTree reaps a detached child and its descendant", async (context) => {
	if (process.platform === "win32") {
		context.skip("POSIX process-group regression; Windows uses taskkill /t");
		return;
	}
	const root = mkdtempSync(join(tmpdir(), "feynman-child-tree-"));
	const receiptPath = join(root, "pids.json");
	const source = [
		'import { spawn } from "node:child_process";',
		'import { writeFileSync } from "node:fs";',
		"const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
		`writeFileSync(${JSON.stringify(receiptPath)}, JSON.stringify({ parent: process.pid, descendant: descendant.pid }));`,
		"setInterval(() => {}, 1000);",
	].join("\n");
	const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
		detached: true,
		stdio: ["pipe", "ignore", "ignore"],
	});

	try {
		await waitFor(() => existsSync(receiptPath));
		const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as {
			parent: number;
			descendant: number;
		};
		assert.equal(processExists(receipt.parent), true);
		assert.equal(processExists(receipt.descendant), true);

		await terminateChildProcessTree(child, { graceMs: 2_000 });
		await waitFor(
			() => !processExists(receipt.parent) && !processExists(receipt.descendant),
		);
	} finally {
		await terminateChildProcessTree(child, { graceMs: 500 });
		rmSync(root, { recursive: true, force: true });
	}
});
