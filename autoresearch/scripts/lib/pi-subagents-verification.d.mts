export declare function assertPiSubagentUsageLimitFallbackSource(
	readSource: (relativePath: string) => string,
	label: string,
): void;
export declare function assertPiSubagentCorrectnessSources(
	readSource: (relativePath: string) => string,
	label: string,
): void;
export declare function assertPiSubagentPatchedSources(
	readSource: (relativePath: string) => string,
	label?: string,
): void;
export declare function verifyPiSubagentUsageLimitFallbackBehavior(packageRoot: string): Promise<void>;
