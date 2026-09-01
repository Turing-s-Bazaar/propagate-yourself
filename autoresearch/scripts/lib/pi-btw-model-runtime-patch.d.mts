export declare const PI_BTW_MODEL_RUNTIME_REQUIRED_VERSION: "0.4.1";
export declare const PI_BTW_MODEL_RUNTIME_PATCH_TARGETS: readonly [
	"extensions/btw.ts",
];
export declare const PI_BTW_MODEL_RUNTIME_PATCH_MARKER: string;
export declare function assertPiBtwModelRuntimePatchedSource(
	source: string,
	surface?: string,
): void;
export declare function patchPiBtwModelRuntimeSource(
	relativePath: string,
	source: string,
): string;
export declare function patchPiBtwModelRuntimePackageRoot(
	packageRoot: string,
): boolean;
