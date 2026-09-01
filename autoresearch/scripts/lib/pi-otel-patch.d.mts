import type { PackageRootPatchPlan } from "./package-root-patch-utils.mjs";

export declare const PI_OTEL_REQUIRED_VERSION: "0.1.0";
export declare const PI_OTEL_PATCH_TARGETS: string[];
export declare function assertPiOtelPatchedSources(
	sources: ReadonlyMap<string, string>,
	surface?: string,
): void;
export declare function patchPiOtelSource(relativePath: string, source: string): string;
export declare function preflightPiOtelPackageRoot(
	packageRoot: string,
): PackageRootPatchPlan | undefined;
export declare function patchPiOtelPackageRoot(packageRoot: string): boolean;
export declare function verifyInstalledPiOtel(
	installedPackageRoot: string,
): Promise<"passed">;
