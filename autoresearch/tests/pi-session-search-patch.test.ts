import test from "node:test";
import assert from "node:assert/strict";

import { patchPiSessionSearchSource } from "../scripts/lib/pi-session-search-patch.mjs";

const SOURCE = `
export async function indexAllSessions() {
\tconst sessionsDir = path.join(os.homedir(), ".pi", "agent", "sessions");
\tconst files = findSessionFiles(sessionsDir);
\treturn files.length;
}
`;

test("patchPiSessionSearchSource makes the indexer use Feynman's session dir", () => {
	const patched = patchPiSessionSearchSource("extensions/indexer.ts", SOURCE);

	assert.match(patched, /process\.env\.FEYNMAN_SESSION_DIR/);
	assert.match(patched, /process\.env\.PI_SESSION_DIR/);
	assert.match(patched, /path\.join\(os\.homedir\(\), "\.pi", "agent", "sessions"\)/);
	assert.doesNotMatch(patched, /const sessionsDir = path\.join\(os\.homedir\(\), "\.pi", "agent", "sessions"\);/);
});

test("patchPiSessionSearchSource is idempotent and path-scoped", () => {
	const patched = patchPiSessionSearchSource("extensions/indexer.ts", SOURCE);

	assert.equal(patchPiSessionSearchSource("extensions/indexer.ts", patched), patched);
	assert.equal(patchPiSessionSearchSource("extensions/other.ts", SOURCE), SOURCE);
});
