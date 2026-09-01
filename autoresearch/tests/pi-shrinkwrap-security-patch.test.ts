import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	patchPiBraceExpansionTree,
	patchPiCodingAgentShrinkwrapSource,
	patchPiPackageLockSource,
} from "../scripts/lib/pi-shrinkwrap-security-patch.mjs";

test("Pi shrinkwrap security patch upgrades only vulnerable brace-expansion entries", () => {
	for (const version of ["5.0.6", "5.0.7", "5.0.8"]) {
		const source = JSON.stringify({
			packages: {
				"node_modules/brace-expansion": {
					version,
					resolved: `https://registry.npmjs.org/brace-expansion/-/brace-expansion-${version}.tgz`,
				},
			},
		});
		const patched = JSON.parse(patchPiCodingAgentShrinkwrapSource(source));
		assert.deepEqual(patched.packages["node_modules/brace-expansion"], {
			version: "5.0.9",
			resolved: "https://registry.npmjs.org/brace-expansion/-/brace-expansion-5.0.9.tgz",
			integrity: "sha512-ScQ4IuvIEF1TMlP7Zt+vjJ//9zlPb2SDcxWxM3bk8s6t6GGdJ7KO1dCcTidOPJKePW30LE/2cT7wCyPho9/Wxg==",
			license: "MIT",
			dependencies: { "balanced-match": "^4.0.2" },
			engines: { node: "20 || >=22" },
		});
	}
	const alreadySafe = `${JSON.stringify({
		packages: {
			"node_modules/brace-expansion": {
				version: "5.0.9",
			},
		},
	}, null, 2)}\n`;
	assert.equal(patchPiCodingAgentShrinkwrapSource(alreadySafe), alreadySafe);
	for (const version of ["5.0.10", "6.0.0"]) {
		const futureSafe = `${JSON.stringify({
			packages: {
				"node_modules/brace-expansion": {
					version,
				},
			},
		}, null, 2)}\n`;
		assert.equal(patchPiCodingAgentShrinkwrapSource(futureSafe), futureSafe);
	}
	assert.throws(
		() => patchPiCodingAgentShrinkwrapSource(JSON.stringify({
			packages: { "node_modules/brace-expansion": { version: "4.0.0" } },
		})),
		/Unsupported Pi brace-expansion shrinkwrap entry/,
	);
});

test("Pi shrinkwrap security patch upgrades the owning package lock", () => {
	const source = JSON.stringify({
		packages: {
			"node_modules/@earendil-works/pi-coding-agent/node_modules/brace-expansion": {
				version: "5.0.8",
				resolved: "https://registry.npmjs.org/brace-expansion/-/brace-expansion-5.0.8.tgz",
			},
		},
	});
	const patched = JSON.parse(patchPiPackageLockSource(source));
	assert.equal(
		patched.packages["node_modules/@earendil-works/pi-coding-agent/node_modules/brace-expansion"].version,
		"5.0.9",
	);
	assert.equal(patchPiPackageLockSource(patchPiPackageLockSource(source)), patchPiPackageLockSource(source));
	const futureSafe = `${JSON.stringify({
		packages: {
			"node_modules/@earendil-works/pi-coding-agent/node_modules/brace-expansion": {
				version: "5.0.10",
			},
		},
	}, null, 2)}\n`;
	assert.equal(patchPiPackageLockSource(futureSafe), futureSafe);
});

test("Pi shrinkwrap security patch replaces the nested package tree and is idempotent", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-pi-security-"));
	const nodeModules = join(root, "node_modules");
	const safePackage = join(nodeModules, "brace-expansion");
	const piRoot = join(nodeModules, "@earendil-works", "pi-coding-agent");
	const nestedPackage = join(piRoot, "node_modules", "brace-expansion");
	mkdirSync(safePackage, { recursive: true });
	mkdirSync(nestedPackage, { recursive: true });
	writeFileSync(join(safePackage, "package.json"), JSON.stringify({ name: "brace-expansion", version: "5.0.9" }));
	writeFileSync(join(safePackage, "index.js"), "export const safe = true;\n");
	writeFileSync(join(nestedPackage, "package.json"), JSON.stringify({ name: "brace-expansion", version: "5.0.8" }));
	writeFileSync(join(piRoot, "npm-shrinkwrap.json"), JSON.stringify({
		packages: { "node_modules/brace-expansion": { version: "5.0.8" } },
	}));
	writeFileSync(join(root, "package-lock.json"), JSON.stringify({
		packages: {
			"node_modules/@earendil-works/pi-coding-agent/node_modules/brace-expansion": {
				version: "5.0.8",
			},
		},
	}));

	assert.equal(patchPiBraceExpansionTree(nodeModules), true);
	assert.equal(JSON.parse(readFileSync(join(nestedPackage, "package.json"), "utf8")).version, "5.0.9");
	assert.equal(JSON.parse(readFileSync(join(piRoot, "npm-shrinkwrap.json"), "utf8")).packages["node_modules/brace-expansion"].version, "5.0.9");
	assert.equal(
		JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"))
			.packages["node_modules/@earendil-works/pi-coding-agent/node_modules/brace-expansion"].version,
		"5.0.9",
	);
	assert.equal(patchPiBraceExpansionTree(nodeModules), false);
});

test("Pi shrinkwrap security patch accepts a safe nested tree when npm hoists the fallback", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-pi-security-hoisted-"));
	const nodeModules = join(root, "node_modules", "@companion-ai", "feynman", "node_modules");
	const piRoot = join(nodeModules, "@earendil-works", "pi-coding-agent");
	const nestedPackage = join(piRoot, "node_modules", "brace-expansion");
	mkdirSync(nestedPackage, { recursive: true });
	writeFileSync(join(nestedPackage, "package.json"), JSON.stringify({ name: "brace-expansion", version: "5.0.9" }));
	writeFileSync(join(piRoot, "npm-shrinkwrap.json"), JSON.stringify({
		packages: { "node_modules/brace-expansion": { version: "5.0.9" } },
	}));

	assert.equal(patchPiBraceExpansionTree(nodeModules), false);
});

test("Pi shrinkwrap security patch leaves newer agent-managed trees intact", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-pi-security-future-"));
	const nodeModules = join(root, "node_modules");
	const piRoot = join(nodeModules, "@earendil-works", "pi-coding-agent");
	const nestedPackage = join(piRoot, "node_modules", "brace-expansion");
	mkdirSync(nestedPackage, { recursive: true });
	writeFileSync(join(nestedPackage, "package.json"), JSON.stringify({ name: "brace-expansion", version: "5.0.10" }));
	writeFileSync(join(nestedPackage, "index.js"), "export const future = true;\n");
	writeFileSync(join(piRoot, "npm-shrinkwrap.json"), JSON.stringify({
		packages: { "node_modules/brace-expansion": { version: "5.0.10" } },
	}));
	writeFileSync(join(root, "package-lock.json"), JSON.stringify({
		packages: {
			"node_modules/@earendil-works/pi-coding-agent/node_modules/brace-expansion": {
				version: "5.0.10",
			},
		},
	}));

	assert.equal(patchPiBraceExpansionTree(nodeModules), false);
	assert.equal(JSON.parse(readFileSync(join(nestedPackage, "package.json"), "utf8")).version, "5.0.10");
	assert.equal(
		JSON.parse(readFileSync(join(piRoot, "npm-shrinkwrap.json"), "utf8"))
			.packages["node_modules/brace-expansion"].version,
		"5.0.10",
	);
});

test("embedded Pi dependency tree uses patched brace-expansion", () => {
	const piRoot = join(
		process.cwd(),
		"node_modules",
		"@earendil-works",
		"pi-coding-agent",
	);
	const nestedPackage = join(
		piRoot,
		"node_modules",
		"brace-expansion",
		"package.json",
	);
	assert.equal(JSON.parse(readFileSync(nestedPackage, "utf8")).version, "5.0.9");
	const shrinkwrap = JSON.parse(readFileSync(join(piRoot, "npm-shrinkwrap.json"), "utf8"));
	assert.equal(
		shrinkwrap.packages["node_modules/brace-expansion"].version,
		"5.0.9",
	);
});

test("package artifact verification resolves a hoisted root brace-expansion dependency", () => {
	const verifierSource = readFileSync(
		join(process.cwd(), "scripts", "verify-package-artifact.mjs"),
		"utf8",
	);
	assert.match(
		verifierSource,
		/packageRequire\.resolve\("brace-expansion\/package\.json"\)/,
	);
	assert.doesNotMatch(
		verifierSource,
		/resolve\(packageRoot, "node_modules", "brace-expansion", "package\.json"\)/,
	);
});
