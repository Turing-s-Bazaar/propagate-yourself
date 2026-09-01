import { statSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

function fail(message) {
	throw new Error(`[feynman package budget] ${message}`);
}

function parseJsonSuffix(source) {
	for (let index = source.length - 1; index >= 0; index -= 1) {
		if (source[index] !== "[" && source[index] !== "{") continue;
		try {
			return JSON.parse(source.slice(index).trim());
		} catch {
			continue;
		}
	}
	fail("pack output does not end with valid JSON");
}

const appRoot = resolve(import.meta.dirname, "..");
const packOutputPath = resolve(process.argv[2] ?? "");
const tarballPath = process.argv[3] ? resolve(process.argv[3]) : undefined;
if (!process.argv[2]) {
	fail("usage: node scripts/verify-package-budget.mjs <pack-json> [tarball]");
}

const packageManifest = JSON.parse(readFileSync(resolve(appRoot, "package.json"), "utf8"));
const budget = packageManifest.feynmanReleaseBudget;
if (
	!Number.isSafeInteger(budget?.maxTarballBytes) ||
	!Number.isSafeInteger(budget?.maxUnpackedBytes) ||
	!Number.isSafeInteger(budget?.maxFileCount)
) {
	fail("package.json must declare integer feynmanReleaseBudget limits");
}

const parsed = parseJsonSuffix(readFileSync(packOutputPath, "utf8"));
const entries = Array.isArray(parsed) ? parsed : [parsed];
if (entries.length !== 1 || typeof entries[0] !== "object" || entries[0] === null) {
	fail(`expected exactly one packed artifact, found ${entries.length}`);
}
const packed = entries[0];
for (const field of ["size", "unpackedSize"]) {
	if (!Number.isSafeInteger(packed[field]) || packed[field] <= 0) {
		fail(`pack metadata has no positive integer ${field}`);
	}
}
const fileCount =
	Number.isSafeInteger(packed.entryCount) && packed.entryCount > 0
		? packed.entryCount
		: Number.isSafeInteger(packed.totalFiles) && packed.totalFiles > 0
			? packed.totalFiles
			: Array.isArray(packed.files) && packed.files.length > 0
				? packed.files.length
				: undefined;
if (!Number.isSafeInteger(fileCount)) {
	fail("pack metadata has no positive integer entryCount or totalFiles");
}
if (packed.size > budget.maxTarballBytes) {
	fail(`tarball size ${packed.size} exceeds ${budget.maxTarballBytes} bytes`);
}
if (packed.unpackedSize > budget.maxUnpackedBytes) {
	fail(`unpacked size ${packed.unpackedSize} exceeds ${budget.maxUnpackedBytes} bytes`);
}
if (fileCount > budget.maxFileCount) {
	fail(`file count ${fileCount} exceeds ${budget.maxFileCount}`);
}

if (tarballPath) {
	const actualSize = statSync(tarballPath).size;
	if (actualSize !== packed.size) {
		fail(`tarball size differs from pack metadata: expected ${packed.size}, found ${actualSize}`);
	}
	if (basename(tarballPath) !== packed.filename) {
		fail(`tarball filename differs from pack metadata: expected ${packed.filename}, found ${basename(tarballPath)}`);
	}
}

console.log(JSON.stringify({
	ok: true,
	filename: packed.filename,
	size: packed.size,
	unpackedSize: packed.unpackedSize,
	fileCount,
	budget,
}));
