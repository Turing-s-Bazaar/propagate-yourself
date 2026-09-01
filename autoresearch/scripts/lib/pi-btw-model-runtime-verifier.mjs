import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { assertPiBtwModelRuntimePatchedSource } from "./pi-btw-model-runtime-patch.mjs";

export function verifyPiBtwModelRuntime(packageDirectory) {
	const sourcePath = resolve(
		packageDirectory,
		".feynman",
		"npm",
		"node_modules",
		"pi-btw",
		"extensions",
		"btw.ts",
	);
	assert.ok(existsSync(sourcePath), "Installed pi-btw extension is missing");
	assertPiBtwModelRuntimePatchedSource(
		readFileSync(sourcePath, "utf8"),
		"installed pi-btw",
	);
	return "passed";
}
