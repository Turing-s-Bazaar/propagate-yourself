import { assertPiBtwModelRuntimePatchedSource } from "./pi-btw-model-runtime-patch.mjs";
import {
	assertPiOtelPatchedSources,
	PI_OTEL_PATCH_TARGETS,
} from "./pi-otel-patch.mjs";

export function assertResearchRuntimeIntakeArchive(readArchivedText) {
	assertPiBtwModelRuntimePatchedSource(
		readArchivedText("npm/node_modules/pi-btw/extensions/btw.ts"),
		"runtime pi-btw",
	);
	assertPiOtelPatchedSources(
		new Map(
			PI_OTEL_PATCH_TARGETS.map((relativePath) => [
				relativePath,
				readArchivedText(`npm/node_modules/pi-otel/${relativePath}`),
			]),
		),
		"runtime pi-otel",
	);
}
