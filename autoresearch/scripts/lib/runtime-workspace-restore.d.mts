import type { RuntimeArchiveSnapshot } from "./runtime-workspace-integrity.mjs";

export interface RuntimeWorkspaceInstallSeed {
	packageSpecs: string[];
	packageJsonSource: string;
	packageLockSource: string;
	packageLockSha256: string;
	npmConfigSource?: string;
}

export declare const RUNTIME_WORKSPACE_COMPLETION_VERSION: 2;
export declare const RUNTIME_WORKSPACE_RESTORE_STALE_MS: number;
export declare const RUNTIME_WORKSPACE_RESTORE_JOURNAL_VERSION: 1;
export declare function getRuntimeWorkspaceCompletionPath(workspaceDir: string): string;
export declare function runtimeWorkspaceCompletionMatches(
	workspaceDir: string,
	options: {
		archivePath: string;
		digestPath: string;
	},
): boolean;
export declare function writeRuntimeWorkspaceCompletion(
	workspaceDir: string,
	options: {
		source: "archive" | "package-manager" | "native-bundle";
		archiveSha256?: string;
		archiveTreeHash?: string;
		runtimeTreeHash: string;
		expectedPackageLockSha256?: string;
	},
): void;
export declare function runtimeWorkspaceMatches(
	workspaceDir: string,
	configuredPackageSpecs: string[],
	options?: {
		archivePath?: string;
		digestPath?: string;
		filterPackageSpecs?: (packageSpecs: string[]) => string[];
		pruneVersion?: number;
		requireCompletion?: boolean;
		requireCurrentPlatformPackageGraph?: boolean;
		requirePlatformIdentity?: boolean;
	},
): boolean;
export declare function readRuntimeWorkspaceInstallSeed(
	archivePath: string,
	configuredPackageSpecs?: string[],
): RuntimeWorkspaceInstallSeed;
export declare function prepareRuntimeWorkspaceFallback(
	workspaceDir: string,
	seed: RuntimeWorkspaceInstallSeed,
): void;
export {
	acquireRuntimeWorkspaceSetupLock,
	cleanupRuntimeWorkspaceSetupLockTombstones,
	heartbeatRuntimeWorkspaceSetupLock,
	releaseRuntimeWorkspaceSetupLock,
	RUNTIME_WORKSPACE_RESTORE_MAX_CLEANUPS,
	RUNTIME_WORKSPACE_SETUP_LOCK_STALE_MS,
} from "./runtime-workspace-lock.mjs";
export declare function cleanupStaleRuntimeWorkspaceRestoreArtifacts(
	feynmanDir: string,
	options?: {
		now?: number;
		staleMs?: number;
		maxCleanups?: number;
		maxCandidates?: number;
		includeBackups?: boolean;
		healthyWorkspaceDir?: string;
	},
): number;
export declare function reconcileRuntimeWorkspaceRestoreArtifacts(
	workspaceDir: string,
	options?: { workspaceIsHealthy?: boolean },
): number;
export declare function replaceRuntimeWorkspaceTransactionally(
	workspaceDir: string,
	prepareStagedWorkspace: (
		stagedWorkspaceDir: string,
		stageDir: string,
	) => boolean,
): boolean;
export declare function restoreRuntimeWorkspaceFromArchive(options: {
	archivePath: string;
	digestPath: string;
	workspaceDir: string;
	onAuthenticatedArchive?: (
		snapshotPath: string,
		snapshot: RuntimeArchiveSnapshot,
	) => void;
	heartbeat?: () => void;
	platform?: string;
	spawn?: (
		command: string,
		args: string[],
		options: {
			cwd: string;
			stdio: ["ignore", "ignore", "pipe"];
			timeout: number;
		},
	) => {
		error?: unknown;
		signal?: string | null;
		status?: number | null;
		stderr?: Buffer | string | null;
	};
	validateWorkspace?: (stagedWorkspaceDir: string) => boolean;
}): boolean;
export declare function restoreRuntimeWorkspaceFromArchiveWithSeed(options: {
	archivePath: string;
	digestPath: string;
	workspaceDir: string;
	configuredPackageSpecs?: string[];
	heartbeat?: () => void;
	platform?: string;
	spawn?: (
		command: string,
		args: string[],
		options: {
			cwd: string;
			stdio: ["ignore", "ignore", "pipe"];
			timeout: number;
		},
	) => {
		error?: unknown;
		signal?: string | null;
		status?: number | null;
		stderr?: Buffer | string | null;
	};
	validateWorkspace?: (stagedWorkspaceDir: string) => boolean;
}): {
	restored: boolean;
	installSeed?: RuntimeWorkspaceInstallSeed;
};
