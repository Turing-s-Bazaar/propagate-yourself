export declare function uniqueExistingPackageRoots(
	roots: readonly string[],
): Set<string>;

export interface PackageRootPatchEntry {
	packageRoot: string;
	relativePath: string;
	path: string;
	source: string;
	patched: string;
}

export interface PackageRootPatchPlan {
	packageName: string;
	packageRoot: string;
	entries: PackageRootPatchEntry[];
}

export declare function preflightPackageRootPatch(options: {
	packageRoot: string;
	packageName: string;
	requiredVersion: string;
	targets: readonly string[];
	patchSource: (relativePath: string, source: string) => string;
}): PackageRootPatchPlan | undefined;

export declare function applyPackageRootPatchPlans(
	plans: readonly (PackageRootPatchPlan | undefined)[],
): boolean;
