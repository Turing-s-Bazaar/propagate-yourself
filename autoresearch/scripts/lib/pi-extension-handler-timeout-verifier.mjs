import {
	assertPiExtensionHandlerTimeoutPatchSource,
	PI_EXTENSION_HANDLER_TIMEOUT_TARGET,
} from "./pi-extension-handler-timeout-patch.mjs";

export function assertPiExtensionHandlerTimeoutPackageTree(readSource) {
	assertPiExtensionHandlerTimeoutPatchSource(
		readSource(PI_EXTENSION_HANDLER_TIMEOUT_TARGET),
		"bundled Pi extension runner",
	);
}

export function assertPiExtensionHandlerTimeoutArchive(readEntry) {
	assertPiExtensionHandlerTimeoutPatchSource(
		readEntry(
			`npm/node_modules/@earendil-works/pi-coding-agent/${PI_EXTENSION_HANDLER_TIMEOUT_TARGET}`,
		),
		"runtime Pi extension runner",
	);
}
