import assert from "node:assert/strict";
import { test } from "node:test";

import { verifyPdfPageLimits } from "../scripts/lib/pi-web-access-pdf-verifier.mjs";

test("installed pi-web-access bounds Datalab, Gemini, and local PDF extraction", async () => {
	assert.deepEqual(await verifyPdfPageLimits(process.cwd()), {
		configured: 1,
		datalab: 1,
		gemini: 1,
		local: "1/2",
	});
});
