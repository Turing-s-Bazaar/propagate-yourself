export declare function assertPiAiForwardFixCopies(
	readSource: (relativePath: string, copy: string) => string,
	surface: string,
	targets?: readonly string[],
): void;
export declare function assertPiAiForwardFixPackageTree(
	packageRoot: string,
	readText: (path: string, label: string) => string,
	options?: Readonly<{ prunedNative?: boolean }>,
): void;
export declare function assertPiAiForwardFixArchive(
	readEntry: (relativePath: string) => string,
): void;
export declare function resolvePiAiForwardFixVerificationTargets(
	options?: Readonly<{ prunedNative?: boolean }>,
): readonly string[];
export declare function verifyRuntimeForwardFixBehavior(
	packageRoot: string,
	options?: Readonly<{ prunedNative?: boolean }>,
): Promise<void>;
