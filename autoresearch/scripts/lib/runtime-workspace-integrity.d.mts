export declare const RUNTIME_INPUT_FILES: readonly string[];

export declare function parseExactRuntimePackageSpec(spec: string): {
	name: string;
	version: string;
};

export declare function workspacePackagesMatch(
	nodeModulesPath: string,
	packageSpecs: string[],
): boolean;
export declare function runtimeManifestPackagesMatch(
	nodeModulesPath: string,
	manifestPackageSpecs: string[],
	configuredPackageSpecs?: string[],
): boolean;
export declare function runtimeWorkspacePackageGraphMatches(
	workspacePath: string,
	options?: {
		platform?: string;
		arch?: string;
		libc?: string;
	},
): boolean;
export declare function mergeRuntimePackageSpecs(
	manifestPackageSpecs: unknown,
	configuredPackageSpecs: unknown,
): string[];

export declare function computeFileSha256(path: string): string;
export declare function computeRuntimeInputHash(
	rootPath: string,
	inputFiles?: readonly string[],
): string;
export declare function computeRuntimeTreeHash(rootPath: string): string;
export interface RuntimeArchiveTree {
	entries: readonly Readonly<{
		label: string;
		type: "file" | "symlink";
		mode?: "x" | "-";
		value: string;
	}>[];
	runtimeTreeHash: string;
}
export declare function captureRuntimeArchiveTree(
	archivePath: string,
): RuntimeArchiveTree;
export declare function computeRuntimeArchiveTreeHash(archivePath: string): string;
export declare function writeFileSha256(path: string, digestPath: string): string;
export declare function verifyFileSha256(path: string, digestPath: string): boolean;
export declare function packagedWorkspaceExtractionSucceeded(
	result: {
		error?: unknown;
		signal?: string | null;
		status?: number | null;
		stderr?: Buffer | string | null;
	},
	options: {
		extractionMatches: boolean;
		platform?: string;
	},
): boolean;
export declare function runtimeArchiveExtractionMatches(
	archivePath: string,
	workspacePath: string,
	options?: {
		allowMissingWindowsSymlinks?: boolean;
		compareExecutableModes?: boolean;
		expectedArchiveTree?: RuntimeArchiveTree;
	},
): boolean;
export declare function filesMatch(leftPath: string, rightPath: string): boolean;
export declare function readArchiveEntry(
	archivePath: string,
	entryPath: string,
): string | undefined;
export interface RuntimeArchiveSnapshot {
	readonly sha256: string;
	readonly archiveTree: RuntimeArchiveTree;
	readEntry(entryPath: string): string | undefined;
}
export declare function captureRuntimeArchiveSnapshot(
	archivePath: string,
	expectedSha256?: string,
): RuntimeArchiveSnapshot;

export declare function runtimeArchiveMatches(options: {
	archivePath: string;
	digestPath: string;
	lockPath: string;
	manifestPath: string;
	packageSpecs: string[];
	runtimeInputHash: string;
}): boolean;
