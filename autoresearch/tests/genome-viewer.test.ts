import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("bundled IGV loads legacy URL mappings from the supported IGV origin", () => {
	const packageRoot = join(process.cwd(), "node_modules", "igv");
	const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
		version?: string;
	};
	assert.equal(packageJson.version, "3.8.5");

	const bundle = readFileSync(join(packageRoot, "dist", "igv.esm.js"), "utf8");
	assert.match(bundle, /https:\/\/igv\.org\/data\/url_mappings\.tsv/);
	assert.doesNotMatch(
		bundle,
		/https:\/\/raw\.githubusercontent\.com\/igvteam\/igv-data\/refs\/heads\/main\/data\/url_mappings\.tsv/,
	);
});
