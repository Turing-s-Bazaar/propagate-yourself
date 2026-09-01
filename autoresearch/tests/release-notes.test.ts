import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { extractReleaseNotes, normalizeReleaseVersion } from "../scripts/lib/release-notes.mjs";

test("normalizeReleaseVersion accepts bare and v-prefixed versions", () => {
	assert.equal(normalizeReleaseVersion("0.2.34"), "v0.2.34");
	assert.equal(normalizeReleaseVersion("v0.2.34"), "v0.2.34");
});

test("extractReleaseNotes returns only the requested release section", () => {
	const source = [
		"# Releases",
		"",
		"## v0.2.35 - 2026-04-19",
		"",
		"- Future change.",
		"",
		"## v0.2.34 - 2026-04-18",
		"",
		"- Fixed deepresearch.",
		"- Added release notes.",
		"",
		"## v0.2.33 - 2026-04-18",
		"",
		"- Previous change.",
	].join("\n");

	assert.equal(
		extractReleaseNotes(source, "0.2.34"),
		["## v0.2.34 - 2026-04-18", "", "- Fixed deepresearch.", "- Added release notes."].join("\n"),
	);
});

test("extractReleaseNotes returns empty string for missing versions", () => {
	assert.equal(extractReleaseNotes("## v0.2.33\n\n- Existing.", "0.2.34"), "");
});

test("release-note extraction fails closed when the version section is missing", () => {
	const result = spawnSync(
		process.execPath,
		["scripts/extract-release-notes.mjs", "99.99.99"],
		{ cwd: process.cwd(), encoding: "utf8" },
	);
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /RELEASES\.md has no section for v99\.99\.99/);
});
