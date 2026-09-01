import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
	assertPiDocparserInvisibleTextPatchSource,
	assertPiDocparserInvisibleTextVersion,
	patchPiDocparserInvisibleTextSource,
} from "../scripts/lib/pi-docparser-invisible-text-patch.mjs";
import { verifyInstalledDocparser } from "../scripts/verify-installed-docparser.mjs";
import { patchPiRuntimeNodeModules } from "../src/pi/runtime-patches.js";

const workerPath = resolve(
	process.cwd(),
	".feynman",
	"npm",
	"node_modules",
	"pi-docparser",
	"extensions",
	"docparser",
	"native-worker.mjs",
);

test("pi-docparser hidden GPO stamp patch is exact and idempotent", () => {
	assert.doesNotThrow(() => assertPiDocparserInvisibleTextVersion("4.0.0", "test"));
	assert.throws(
		() => assertPiDocparserInvisibleTextVersion("4.0.1", "test"),
		/expected 4\.0\.0/,
	);
	const source = readFileSync(workerPath, "utf8");
	const patched = patchPiDocparserInvisibleTextSource(
		"extensions/docparser/native-worker.mjs",
		source,
	);
	assertPiDocparserInvisibleTextPatchSource(patched, "test worker");
	assert.match(patched, /screenshots = await parser\.screenshot/);
	assert.doesNotMatch(
		patched,
		/replace\(\/\\n\{3,\}\/g/,
		"hidden-stamp cleanup must not collapse unrelated artifact whitespace",
	);
	assert.equal(
		patchPiDocparserInvisibleTextSource(
			"extensions/docparser/native-worker.mjs",
			patched,
		),
		patched,
	);
});

test("installed document tools suppress hidden GPO bill stamps", async () => {
	const result = await verifyInstalledDocparser({ packageRoot: process.cwd() });
	assert.equal(result?.hiddenGpoStamps, "suppressed");
	assert.equal(result?.hits, 1);
});

test("runtime patching leaves recognized legacy pi-docparser installs available for migration", () => {
	const appRoot = mkdtempSync(resolve(tmpdir(), "feynman-legacy-docparser-patch-"));
	const packageRoot = resolve(
		appRoot,
		".feynman",
		"npm",
		"node_modules",
		"pi-docparser",
	);
	try {
		mkdirSync(packageRoot, { recursive: true });
		writeFileSync(
			resolve(packageRoot, "package.json"),
			JSON.stringify({ name: "pi-docparser", version: "3.0.1" }),
		);
		assert.equal(patchPiRuntimeNodeModules(appRoot), false);
		assert.equal(
			JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")).version,
			"3.0.1",
		);
	} finally {
		rmSync(appRoot, { recursive: true, force: true });
	}
});
