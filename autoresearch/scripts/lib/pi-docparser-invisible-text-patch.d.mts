export declare const PI_DOCPARSER_INVISIBLE_TEXT_REQUIRED_VERSION: "4.0.0";
export declare const PI_DOCPARSER_INVISIBLE_TEXT_PATCH_TARGETS: readonly string[];
export declare const PI_DOCPARSER_INVISIBLE_TEXT_PATCH_MARKER: string;
export declare function assertPiDocparserInvisibleTextVersion(
	version: string | undefined,
	surface: string,
): void;
export declare function assertPiDocparserInvisibleTextPatchSource(
	source: string,
	surface?: string,
): void;
export declare function patchPiDocparserInvisibleTextSource(
	relativePath: string,
	source: string,
): string;
