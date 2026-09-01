export const FEYNMAN_PI_TELEMETRY_PACKAGE: "@earendil-works/pi-telemetry";
export const FEYNMAN_PI_TELEMETRY_VERSION: "0.84.2";
export const FEYNMAN_PI_TELEMETRY_RESOLVED: "https://registry.npmjs.org/@earendil-works/pi-telemetry/-/pi-telemetry-0.84.2.tgz";
export const FEYNMAN_PI_TELEMETRY_INTEGRITY: "sha512-wg5caea7uIv1BHRBm2Y116RvFG4oSAiP5qk9tA2463PDGIr4K8M1Ceyyg5DOpF/shUUl0gk826yQJAeAcHYB9g==";

export interface PiTelemetryLockEntry {
	dependencies?: Record<string, string>;
	integrity?: string;
	name?: string;
	resolved?: string;
	version?: string;
}

export interface PiTelemetryRuntimeLock {
	packages?: Record<string, PiTelemetryLockEntry>;
}

export type PiTelemetryContractFailure = (message: string) => never;
export type ReadArchivedJson = (entryPath: string) => unknown;

export function resolvePiTelemetryRuntimeVersion(
	lockedVersion: string | undefined,
	hasRootPackageLock: boolean,
): "0.84.2";

export function verifyPiTelemetryRuntimeLockContract(
	runtimeLock: PiTelemetryRuntimeLock,
	expectedVersion: string,
	fail: PiTelemetryContractFailure,
): void;

export function verifyPiTelemetryArchiveContract(
	readArchivedJson: ReadArchivedJson,
	expectedVersion: string,
	fail: PiTelemetryContractFailure,
): void;
