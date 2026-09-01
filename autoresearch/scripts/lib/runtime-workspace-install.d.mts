export declare const RUNTIME_WORKSPACE_PACKAGE_INSTALL_TIMEOUT_MS: number;

export declare function buildSourceRuntimeArchive(
	appRoot: string,
	options?: {
		force?: boolean;
		heartbeat?: () => void;
		spawn?: (
			command: string,
			args: string[],
			options: {
				cwd: string;
				stdio: ["ignore", "pipe", "pipe"];
				timeout: number;
				env: NodeJS.ProcessEnv;
			},
		) => {
			status?: number | null;
			stdout?: Buffer | string | null;
			stderr?: Buffer | string | null;
		};
	},
): boolean;
export declare function installRuntimeWorkspaceFromPackageLock(
	workspaceDir: string,
	options?: {
		expectedPackageLockSha256?: string;
		heartbeat?: () => void;
		invocation?: {
			command: string;
			args: string[];
			shell?: boolean;
		};
		spawn?: (
			command: string,
			args: string[],
			options: {
				cwd: string;
				shell?: boolean;
				stdio: ["ignore", "pipe", "pipe"];
				timeout: number;
				env: NodeJS.ProcessEnv;
			},
		) => {
			status?: number | null;
			stdout?: Buffer | string | null;
			stderr?: Buffer | string | null;
		};
	},
): boolean;
export declare function patchStagedRuntimeWorkspace(
	appRoot: string,
	workspaceDir: string,
	options?: {
		heartbeat?: () => void;
	},
): boolean;
