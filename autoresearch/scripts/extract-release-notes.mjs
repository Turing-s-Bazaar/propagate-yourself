import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { extractReleaseNotes, normalizeReleaseVersion } from "./lib/release-notes.mjs";

const [version, outputPath] = process.argv.slice(2);
const normalizedVersion = normalizeReleaseVersion(version);

if (!normalizedVersion) {
	console.error("Usage: node scripts/extract-release-notes.mjs <version> [output-path]");
	process.exit(1);
}

const releasesPath = resolve(process.cwd(), "RELEASES.md");
const source = readFileSync(releasesPath, "utf8");
const notes = extractReleaseNotes(source, normalizedVersion);
if (!notes) {
	console.error(`RELEASES.md has no section for ${normalizedVersion}`);
	process.exit(1);
}

if (outputPath) {
	writeFileSync(outputPath, `${notes.trim()}\n`, "utf8");
} else {
	process.stdout.write(`${notes.trim()}\n`);
}
