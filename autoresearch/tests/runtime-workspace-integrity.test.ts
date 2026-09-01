import assert from "node:assert/strict";
import { appendFileSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
	captureRuntimeArchiveSnapshot,
	computeRuntimeArchiveTreeHash,
	computeRuntimeInputHash,
	computeRuntimeTreeHash,
	mergeRuntimePackageSpecs,
	packagedWorkspaceExtractionSucceeded,
	readArchiveEntry,
	RUNTIME_INPUT_FILES,
	runtimeArchiveMatches,
	runtimeManifestPackagesMatch,
	runtimeWorkspacePackageGraphMatches,
	workspacePackagesMatch,
	writeFileSha256,
} from "../scripts/lib/runtime-workspace-integrity.mjs";
import { createDeterministicTarGz } from "../scripts/lib/deterministic-archive.mjs";

test("packaged runtime restoration requires a complete extracted tree", () => {
	assert.equal(packagedWorkspaceExtractionSucceeded(
		{ status: 0, signal: null },
		{ extractionMatches: true, platform: "darwin" },
	), true);
	assert.equal(packagedWorkspaceExtractionSucceeded(
		{ status: 1, signal: null },
		{ extractionMatches: true, platform: "darwin" },
	), false);
	assert.equal(packagedWorkspaceExtractionSucceeded(
		{ status: 1, signal: null },
		{ extractionMatches: true, platform: "linux" },
	), false);
	assert.equal(packagedWorkspaceExtractionSucceeded(
		{ status: 1, signal: null, stderr: "arbitrary tar error" },
		{ extractionMatches: true, platform: "win32" },
	), true);
	assert.equal(packagedWorkspaceExtractionSucceeded(
		{ status: 1, signal: null, stderr: "npm .bin link failure" },
		{ extractionMatches: false, platform: "win32" },
	), false);
	assert.equal(packagedWorkspaceExtractionSucceeded(
		{ status: 0, signal: null },
		{ extractionMatches: false, platform: "darwin" },
	), false);
	for (const result of [
		{ status: null, signal: null },
		{ status: 0, signal: "SIGTERM" },
		{ status: 0, signal: null, error: new Error("spawn failed") },
	]) {
		assert.equal(packagedWorkspaceExtractionSucceeded(
			result,
			{ extractionMatches: true, platform: "win32" },
		), false);
	}
});

test("runtime workspace integrity checks installed versions and the exact archive digest", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-runtime-integrity-"));
	const feynmanDir = join(root, ".feynman");
	const workspace = join(feynmanDir, "npm");
	const nodeModules = join(workspace, "node_modules");
	const packageRoot = join(nodeModules, "@scope", "runtime");
	const manifestPath = join(workspace, ".runtime-manifest.json");
	const lockPath = join(feynmanDir, "runtime-package-lock.json");
	const archivePath = join(feynmanDir, "runtime-workspace.tgz");
	const digestPath = join(feynmanDir, "runtime-workspace.sha256");
	const inputPath = join(root, "runtime-input.txt");
	const inputFiles = ["runtime-input.txt"];
	const specs = ["@scope/runtime@1.2.3"];

	mkdirSync(packageRoot, { recursive: true });
	writeFileSync(join(packageRoot, "package.json"), JSON.stringify({
		name: "@scope/runtime",
		version: "1.2.3",
	}));
	const lockSource = JSON.stringify({
		lockfileVersion: 3,
		packages: {
			"": { dependencies: { "@scope/runtime": "1.2.3" } },
			"node_modules/@scope/runtime": { version: "1.2.3" },
		},
	}) + "\n";
	writeFileSync(join(workspace, "package-lock.json"), lockSource);
	writeFileSync(lockPath, lockSource);
	writeFileSync(inputPath, "runtime input\n");
	const runtimeInputHash = computeRuntimeInputHash(root, inputFiles);
	writeFileSync(manifestPath, JSON.stringify({
		packageSpecs: specs,
		runtimeInputHash,
		runtimeTreeHash: computeRuntimeTreeHash(workspace),
		workspaceTreeHash: computeRuntimeTreeHash(workspace),
	}) + "\n");

	const packed = spawnSync("tar", ["-czf", archivePath, "-C", feynmanDir, "npm"], {
		env: { ...process.env, COPYFILE_DISABLE: "1" },
	});
	assert.equal(packed.status, 0);
	writeFileSha256(archivePath, digestPath);

	assert.equal(workspacePackagesMatch(nodeModules, specs), true);
	assert.equal(runtimeArchiveMatches({
		archivePath,
		digestPath,
		lockPath,
		manifestPath,
		packageSpecs: specs,
		runtimeInputHash,
	}), true);

	appendFileSync(inputPath, "changed\n");
	assert.equal(runtimeArchiveMatches({
		archivePath,
		digestPath,
		lockPath,
		manifestPath,
		packageSpecs: specs,
		runtimeInputHash: computeRuntimeInputHash(root, inputFiles),
	}), false);

	appendFileSync(archivePath, "tampered");
	assert.equal(runtimeArchiveMatches({
		archivePath,
		digestPath,
		lockPath,
		manifestPath,
		packageSpecs: specs,
		runtimeInputHash,
	}), false);
	assert.equal(workspacePackagesMatch(nodeModules, ["@scope/runtime@9.9.9"]), false);
});

test("runtime manifest verification checks bundled packages beyond configured extensions", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-runtime-manifest-"));
	const writePackage = (name: string, version: string) => {
		const packagePath = join(root, ...name.split("/"));
		mkdirSync(packagePath, { recursive: true });
		writeFileSync(
			join(packagePath, "package.json"),
			`${JSON.stringify({ name, version })}\n`,
			"utf8",
		);
	};
	writePackage("pi-subagents", "0.37.2");
	writePackage("@earendil-works/pi-coding-agent", "0.79.1");

	const manifestSpecs = [
		"pi-subagents@0.37.2",
		"@earendil-works/pi-coding-agent@0.84.2",
	];
	assert.equal(
		runtimeManifestPackagesMatch(root, manifestSpecs, ["pi-subagents@0.37.2"]),
		false,
	);

	writePackage("@earendil-works/pi-coding-agent", "0.84.2");
	assert.equal(
		runtimeManifestPackagesMatch(root, manifestSpecs, ["pi-subagents@0.37.2"]),
		true,
	);
	assert.equal(
		runtimeManifestPackagesMatch(root, manifestSpecs, ["missing-package@1.0.0"]),
		false,
	);
});

test("runtime package graph requires compatible transitive packages", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-runtime-package-graph-"));
	try {
		const requiredPath = join(root, "node_modules", "required-package");
		const currentOptionalPath = join(root, "node_modules", "current-optional");
		mkdirSync(requiredPath, { recursive: true });
		mkdirSync(currentOptionalPath, { recursive: true });
		writeFileSync(
			join(requiredPath, "package.json"),
			'{"name":"required-package","version":"1.2.3"}\n',
		);
		writeFileSync(
			join(currentOptionalPath, "package.json"),
			'{"name":"current-optional","version":"2.0.0"}\n',
		);
		writeFileSync(
			join(root, "package-lock.json"),
			`${JSON.stringify({
				lockfileVersion: 3,
				packages: {
					"": {},
					"node_modules/required-package": { version: "1.2.3" },
					"node_modules/current-optional": {
						version: "2.0.0",
						optional: true,
						os: ["test-platform"],
					},
					"node_modules/other-platform": {
						version: "3.0.0",
						optional: true,
						os: ["other-platform"],
					},
				},
			}, null, 2)}\n`,
		);

		const options = {
			platform: "test-platform",
			arch: "test-arch",
			libc: "test-libc",
		};
		assert.equal(runtimeWorkspacePackageGraphMatches(root, options), true);
		rmSync(requiredPath, { recursive: true });
		assert.equal(runtimeWorkspacePackageGraphMatches(root, options), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("runtime package graph rejects a missing current-platform optional package", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-runtime-platform-graph-"));
	const workspace = join(root, "workspace");
	try {
		const requiredPath = join(workspace, "node_modules", "required-package");
		const buildOptionalPath = join(
			workspace,
			"node_modules",
			"build-native",
		);
		mkdirSync(requiredPath, { recursive: true });
		mkdirSync(buildOptionalPath, { recursive: true });
		writeFileSync(
			join(requiredPath, "package.json"),
			'{"name":"required-package","version":"1.0.0"}\n',
		);
		writeFileSync(
			join(buildOptionalPath, "package.json"),
			'{"name":"build-native","version":"2.0.0"}\n',
		);
		writeFileSync(
			join(workspace, "package-lock.json"),
			`${JSON.stringify({
				lockfileVersion: 3,
				packages: {
					"": {},
					"node_modules/required-package": { version: "1.0.0" },
					"node_modules/build-native": {
						version: "2.0.0",
						optional: true,
						os: ["build-os"],
						cpu: ["build-arch"],
					},
						"node_modules/consumer-native": {
							version: "3.0.0",
							integrity: "sha512-consumer-native",
							optional: true,
						os: ["consumer-os"],
						cpu: ["consumer-arch"],
					},
				},
			}, null, 2)}\n`,
		);

		assert.equal(
			runtimeWorkspacePackageGraphMatches(workspace, {
				platform: "build-os",
				arch: "build-arch",
			}),
			true,
		);
		assert.equal(
			runtimeWorkspacePackageGraphMatches(workspace, {
				platform: "consumer-os",
				arch: "consumer-arch",
			}),
			false,
		);
		const consumerNativePath = join(
			workspace,
			"node_modules",
			"consumer-native",
		);
		mkdirSync(consumerNativePath, { recursive: true });
		writeFileSync(
			join(consumerNativePath, "package.json"),
			'{"name":"consumer-native","version":"3.0.0"}\n',
		);
		writeFileSync(join(consumerNativePath, "binding.node"), "native bytes\n");
		assert.equal(
			runtimeWorkspacePackageGraphMatches(
				workspace,
				{ platform: "consumer-os", arch: "consumer-arch" },
			),
			true,
		);
		rmSync(consumerNativePath, { recursive: true });
		assert.equal(
			runtimeWorkspacePackageGraphMatches(
				workspace,
				{ platform: "consumer-os", arch: "consumer-arch" },
			),
			false,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("runtime reinstall preserves archived exact packages and adds new configured packages", () => {
	assert.deepEqual(
		mergeRuntimePackageSpecs(
			[
				"pi-docparser@4.0.0",
				"@earendil-works/pi-coding-agent@0.84.2",
				"undici@8.10.0",
			],
			["pi-docparser@4.0.0", "pi-web-access@0.25.0"],
		),
		[
			"pi-docparser@4.0.0",
			"@earendil-works/pi-coding-agent@0.84.2",
			"undici@8.10.0",
			"pi-web-access@0.25.0",
		],
	);
	assert.deepEqual(mergeRuntimePackageSpecs(undefined, ["pi-docparser@4.0.0"]), [
		"pi-docparser@4.0.0",
	]);
});

test("runtime archive integrity rejects a lock that differs from the committed graph", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-runtime-lock-integrity-"));
	const feynmanDir = join(root, ".feynman");
	const workspace = join(feynmanDir, "npm");
	const packageRoot = join(workspace, "node_modules", "runtime");
	const manifestPath = join(workspace, ".runtime-manifest.json");
	const lockPath = join(feynmanDir, "runtime-package-lock.json");
	const archivePath = join(feynmanDir, "runtime-workspace.tgz");
	const digestPath = join(feynmanDir, "runtime-workspace.sha256");
	const inputPath = join(root, "runtime-input.txt");
	const specs = ["runtime@1.0.0"];

	mkdirSync(packageRoot, { recursive: true });
	writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ version: "1.0.0" }));
	writeFileSync(join(workspace, "package-lock.json"), '{"lockfileVersion":3}\n');
	writeFileSync(lockPath, '{"lockfileVersion":3,"packages":{}}\n');
	writeFileSync(inputPath, "runtime input\n");
	const runtimeInputHash = computeRuntimeInputHash(root, ["runtime-input.txt"]);
	writeFileSync(manifestPath, JSON.stringify({
		packageSpecs: specs,
		runtimeInputHash,
		runtimeTreeHash: computeRuntimeTreeHash(workspace),
		workspaceTreeHash: computeRuntimeTreeHash(workspace),
	}) + "\n");
	assert.equal(spawnSync("tar", ["-czf", archivePath, "-C", feynmanDir, "npm"], {
		env: { ...process.env, COPYFILE_DISABLE: "1" },
	}).status, 0);
	writeFileSha256(archivePath, digestPath);

	assert.equal(runtimeArchiveMatches({
		archivePath,
		digestPath,
		lockPath,
		manifestPath,
		packageSpecs: specs,
		runtimeInputHash,
	}), false);
});

test("runtime archive tree hashes normalize tar hardlinks to file contents", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-runtime-hardlink-integrity-"));
	const workspace = join(root, "npm");
	const original = join(workspace, "original.txt");
	const hardlink = join(workspace, "hardlink.txt");
	const archivePath = join(root, "runtime-workspace.tgz");

	mkdirSync(workspace, { recursive: true });
	writeFileSync(original, "shared bytes\n");
	linkSync(original, hardlink);
	await createDeterministicTarGz(workspace, archivePath);

	assert.equal(
		computeRuntimeArchiveTreeHash(archivePath),
		computeRuntimeTreeHash(workspace),
	);
});

test("runtime archive entries are read without an external tar executable", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-runtime-entry-"));
	const workspace = join(root, "npm");
	const archivePath = join(root, "runtime-workspace.tgz");

	mkdirSync(workspace, { recursive: true });
	writeFileSync(join(workspace, "package-lock.json"), '{"lockfileVersion":3}\n');
	await createDeterministicTarGz(workspace, archivePath);

	const originalPath = process.env.PATH;
	process.env.PATH = "";
	try {
		assert.equal(
			readArchiveEntry(archivePath, "npm/package-lock.json"),
			'{"lockfileVersion":3}\n',
		);
	} finally {
		process.env.PATH = originalPath;
	}
});

test("authenticated archive snapshots never reread a replaced path", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-runtime-snapshot-"));
	const trusted = join(root, "trusted", "npm");
	const replacement = join(root, "replacement", "npm");
	const archivePath = join(root, "runtime-workspace.tgz");
	const replacementPath = join(root, "replacement.tgz");
	mkdirSync(trusted, { recursive: true });
	mkdirSync(replacement, { recursive: true });
	writeFileSync(join(trusted, "package-lock.json"), '{"trusted":true}\n');
	writeFileSync(join(replacement, "package-lock.json"), '{"trusted":false}\n');
	await createDeterministicTarGz(trusted, archivePath);
	await createDeterministicTarGz(replacement, replacementPath);
	const expectedSha256 = writeFileSha256(archivePath, join(root, "runtime-workspace.sha256"));
	const snapshot = captureRuntimeArchiveSnapshot(archivePath, expectedSha256);
	writeFileSync(archivePath, readFileSync(replacementPath));
	assert.equal(snapshot.readEntry("npm/package-lock.json"), '{"trusted":true}\n');
	assert.throws(
		() => captureRuntimeArchiveSnapshot(archivePath, expectedSha256),
		/SHA-256 integrity/,
	);
	rmSync(root, { recursive: true, force: true });
});

test("runtime input hashes are independent of the checkout root", () => {
	const left = mkdtempSync(join(tmpdir(), "feynman-runtime-input-left-"));
	const right = mkdtempSync(join(tmpdir(), "feynman-runtime-input-right-"));
	const inputFiles = ["scripts/prepare-runtime-workspace.mjs", ".feynman/settings.json"];
	for (const root of [left, right]) {
		mkdirSync(join(root, "scripts"), { recursive: true });
		mkdirSync(join(root, ".feynman"), { recursive: true });
		writeFileSync(join(root, "scripts", "prepare-runtime-workspace.mjs"), "same source\n");
		writeFileSync(join(root, ".feynman", "settings.json"), '{"same":true}\n');
	}

	assert.equal(
		computeRuntimeInputHash(left, inputFiles),
		computeRuntimeInputHash(right, inputFiles),
	);
});

test("runtime manifests preserve separate workspace and archive tree hashes", () => {
	const source = readFileSync(
		join(process.cwd(), "scripts", "prepare-runtime-workspace.mjs"),
		"utf8",
	);
	assert.match(source, /workspaceTreeHash/);
	assert.match(source, /computeRuntimeArchiveTreeHash\(workspaceArchivePath\)/);
	assert.match(source, /writeManifest\(packageSpecs, archiveTreeHash\)/);
});

test("runtime input hashes use only files shipped in installed packages", () => {
	assert.equal(RUNTIME_INPUT_FILES.includes("package-lock.json"), false);
	assert.equal(RUNTIME_INPUT_FILES.includes(".feynman/runtime-package-lock.json"), true);
	assert.equal(RUNTIME_INPUT_FILES.includes("package.json"), true);
});
