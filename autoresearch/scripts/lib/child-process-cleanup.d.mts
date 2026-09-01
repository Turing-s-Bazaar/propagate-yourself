import type { ChildProcess } from "node:child_process";

export interface ChildProcessCloseResult {
	code: number | null;
	signal: NodeJS.Signals | null;
}

export interface TerminateChildProcessTreeOptions {
	platform?: NodeJS.Platform;
	graceMs?: number;
	forceMs?: number;
	taskkillMs?: number;
	taskkillForceMs?: number;
	closePromise?: Promise<ChildProcessCloseResult>;
	spawnProcess?: typeof import("node:child_process").spawn;
}

export declare function observeChildProcessClose(
	child: ChildProcess,
): Promise<ChildProcessCloseResult>;

export declare function terminateChildProcessTree(
	child: ChildProcess,
	options?: TerminateChildProcessTreeOptions,
): Promise<void>;
