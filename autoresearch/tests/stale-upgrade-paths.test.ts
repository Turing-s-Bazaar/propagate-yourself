import assert from "node:assert/strict";
import test from "node:test";
import { normalizeStaleFixturePath } from "../scripts/stale-upgrade-paths.mjs";

test("stale upgrade fixture paths use one separator across Windows package scopes", () => {
	const allowedRoot = normalizeStaleFixturePath(
		"@earendil-works\\pi-coding-agent\\node_modules\\brace-expansion",
	);
	const changedPath = normalizeStaleFixturePath(
		"@earendil-works/pi-coding-agent\\node_modules\\brace-expansion\\index.js",
	);

	assert.equal(
		allowedRoot,
		"@earendil-works/pi-coding-agent/node_modules/brace-expansion",
	);
	assert.equal(
		changedPath,
		"@earendil-works/pi-coding-agent/node_modules/brace-expansion/index.js",
	);
	assert.equal(changedPath.startsWith(`${allowedRoot}/`), true);
});
