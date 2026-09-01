import assert from "node:assert/strict";
import { test } from "node:test";

import { verifyGitHubCloneSafety } from "../scripts/lib/pi-web-access-runtime-verifier.mjs";

test("installed pi-web-access confines GitHub clone identities and cleanup", () => {
	const result = verifyGitHubCloneSafety(process.cwd());
	assert.equal(result.malformedIdentity, "rejected");
	assert.equal(result.cleanup, "confined");
	assert.ok(["confined", "skipped-unsupported"].includes(result.symlinkCleanup));
});
