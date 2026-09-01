import type { ChildProcess, spawn } from "node:child_process";

import type {
	ChildProcessCloseResult,
	TerminateChildProcessTreeOptions,
} from "./lib/child-process-cleanup.mjs";

export interface VerifyRpcSurfaceOptions {
	binaryPath?: string;
	spawnProcess?: typeof spawn;
	terminateProcessTree?: (
		child: ChildProcess,
		options: TerminateChildProcessTreeOptions & {
			closePromise: Promise<ChildProcessCloseResult>;
		},
	) => Promise<void>;
	timeoutMs?: number;
}

export declare function verifyRpcSurface(
	options?: VerifyRpcSurfaceOptions,
): Promise<void>;

export declare function verifyInstalledSchemas(): Promise<void>;

export declare function isDirectExecution(
	entryPath?: string,
	modulePath?: string,
): boolean;

export declare function isNativeBundlePackageRoot(
	installedPackageRoot: string,
): boolean;

export declare function resolvePiEditLineEndingsVerificationTargets(
	installedPackageRoot: string,
	copyIndex: number,
): readonly string[];

export declare function verifyPiEditLineEndings(
	installedPackageRoot?: string,
): Promise<"passed">;
