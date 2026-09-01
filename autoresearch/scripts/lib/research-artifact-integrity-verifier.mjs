import { assertPiDocparserInvisibleTextPatchSource } from "./pi-docparser-invisible-text-patch.mjs";
import {
	assertPiEditLineEndingsPatchSource,
	PI_EDIT_LINE_ENDINGS_RUNTIME_TARGETS,
} from "./pi-edit-line-endings-patch.mjs";

export function verifyResearchArtifactIntegrityRuntime(readArchivedText) {
	for (const relativePath of PI_EDIT_LINE_ENDINGS_RUNTIME_TARGETS) {
		assertPiEditLineEndingsPatchSource(
			relativePath,
			readArchivedText(
				`npm/node_modules/@earendil-works/pi-coding-agent/${relativePath}`,
			),
			`runtime Pi ${relativePath}`,
		);
	}
	assertPiDocparserInvisibleTextPatchSource(
		readArchivedText("npm/node_modules/pi-docparser/extensions/docparser/native-worker.mjs"),
		"runtime pi-docparser native worker",
	);
}
