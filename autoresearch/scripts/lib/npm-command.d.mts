export type PackageManagerCommand = {
	command: string;
	args: string[];
	shell?: boolean;
};

export declare function resolveAdjacentNpmCommand(
	nodeExecutablePath?: string,
	platform?: NodeJS.Platform,
): PackageManagerCommand | undefined;
