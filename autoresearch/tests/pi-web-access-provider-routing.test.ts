import assert from "node:assert/strict";
import { test } from "node:test";

import { verifyModelAwareSearchRouting } from "../scripts/lib/pi-web-access-runtime-verifier.mjs";

test("installed pi-web-access routes Codex and non-Codex auto search by active model", () => {
	assert.deepEqual(verifyModelAwareSearchRouting(process.cwd()), {
		curator: {
			codex: "openai",
			nonCodex: "exa",
			openaiFallback: "openai",
		},
		search: {
			codex: "openai",
			nonCodex: "exa",
		},
	});
});
