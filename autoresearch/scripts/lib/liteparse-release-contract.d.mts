export declare const FEYNMAN_LITEPARSE_GIT_HEAD: string;
export declare const FEYNMAN_LITEPARSE_VERSION: string;
export declare const FEYNMAN_LITEPARSE_INTEGRITY: string;
export declare const FEYNMAN_LITEPARSE_NATIVE_INTEGRITIES: Readonly<Record<string, string>>;
export declare const FEYNMAN_LITEPARSE_NATIVE_PACKAGES: readonly string[];
export declare const FEYNMAN_LITEPARSE_NATIVE_PLATFORMS: Readonly<
	Record<string, { cpu: readonly string[]; os: readonly string[]; libc?: readonly string[] }>
>;
export declare function verifyLiteparseManifestContract(
	manifest: Record<string, unknown>,
	fail: (message: string) => never,
	label: string,
): void;
export declare function verifyLiteparseRootManifestContract(
	rootManifest: Record<string, unknown>,
	fail: (message: string) => never,
): void;
export declare function verifyLiteparseRootLockContract(
	rootLock: Record<string, unknown>,
	fail: (message: string) => never,
): void;
export declare function verifyLiteparseRuntimeLockContract(
	runtimeLock: Record<string, unknown>,
	fail: (message: string) => never,
): void;
