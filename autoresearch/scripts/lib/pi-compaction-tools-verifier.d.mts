export declare function resolvePiCompactionToolsPackageTargets(
	options?: Readonly<{ prunedNative?: boolean }>,
): readonly string[];
export declare function isPiCompactionToolsNativePackageRoot(packageRoot: string): boolean;
export declare function assertPiCompactionToolsPrunedDependencyTree(packageRoot: string): void;
export declare function assertPiCompactionToolsPackageTree(
	packageRoot: string,
	readText: (path: string, label: string) => string,
	options?: Readonly<{ prunedNative?: boolean }>,
): void;
export declare function verifyPiCompactionToolsBehavior(packageRoot: string): Promise<void>;
