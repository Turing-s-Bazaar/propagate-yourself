export interface ChildProcessCommandOptions {
	platform?: NodeJS.Platform;
	comSpec?: string;
	fileExists?: (path: string) => boolean;
}

export interface ChildProcessCommand {
	command: string;
	args: string[];
	shell: false;
	windowsVerbatimArguments: boolean;
}

export declare function resolveChildProcessExecutable(
	command: string,
	options?: ChildProcessCommandOptions,
): string;

export declare function resolveChildProcessCommand(
	command: string,
	args: string[],
	options?: ChildProcessCommandOptions,
): ChildProcessCommand;
