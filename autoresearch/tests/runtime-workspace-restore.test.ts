import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	appendFileSync,
	cpSync,
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { createDeterministicTarGz } from "../scripts/lib/deterministic-archive.mjs";
import {
	computeRuntimeTreeHash,
	runtimeArchiveExtractionMatches,
	writeFileSha256,
} from "../scripts/lib/runtime-workspace-integrity.mjs";
import {
	cleanupStaleRuntimeWorkspaceRestoreArtifacts,
	getRuntimeWorkspaceCompletionPath,
	prepareRuntimeWorkspaceFallback,
	readRuntimeWorkspaceInstallSeed,
	reconcileRuntimeWorkspaceRestoreArtifacts,
	replaceRuntimeWorkspaceTransactionally,
	restoreRuntimeWorkspaceFromArchive,
	restoreRuntimeWorkspaceFromArchiveWithSeed,
	runtimeWorkspaceCompletionMatches,
	writeRuntimeWorkspaceCompletion,
} from "../scripts/lib/runtime-workspace-restore.mjs";

function currentLibc() {
	const report = process.report?.getReport?.() as
		| { header?: { glibcVersionRuntime?: unknown } }
		| undefined;
	return process.platform === "linux"
		? (report?.header?.glibcVersionRuntime
			? "glibc"
			: "musl")
		: undefined;
}

function writeCompletedWorkspace(
	workspaceDir: string,
	{ value = "complete\n" }: { value?: string } = {},
) {
	mkdirSync(workspaceDir, { recursive: true });
	writeFileSync(join(workspaceDir, "value.txt"), value);
	writeFileSync(
		join(workspaceDir, "package.json"),
		'{"name":"runtime-fixture","private":true,"dependencies":{}}\n',
	);
	writeFileSync(
		join(workspaceDir, "package-lock.json"),
		'{"name":"runtime-fixture","lockfileVersion":3,"packages":{"":{"dependencies":{}}}}\n',
	);
	writeFileSync(
		join(workspaceDir, ".runtime-manifest.json"),
		`${JSON.stringify({
			packageSpecs: [],
			nodeAbi: process.versions.modules,
			platform: process.platform,
			arch: process.arch,
			...(currentLibc() ? { libc: currentLibc() } : {}),
			pruneVersion: 8,
		})}\n`,
	);
	writeRuntimeWorkspaceCompletion(workspaceDir, {
		source: "package-manager",
		runtimeTreeHash: computeRuntimeTreeHash(workspaceDir),
	});
}

function writeRestoreJournal(
	stageDir: string,
	{
		pid,
		createdAt,
		token,
		workspaceName = "npm",
		phase = "live-backed-up",
	}: {
		pid: number;
		createdAt: number;
		token: string;
		workspaceName?: string;
		phase?: string;
	},
) {
	const stageName = `runtime-workspace.restore-${pid}-${createdAt}-${token}`;
	const backupName = `runtime-workspace.backup-${pid}-${createdAt}-${token}`;
	assert.equal(stageDir.endsWith(stageName), true);
	mkdirSync(stageDir, { recursive: true });
	writeFileSync(
		join(stageDir, ".feynman-runtime-restore-owner.json"),
		`${JSON.stringify({ pid, createdAt, token })}\n`,
	);
	writeFileSync(
		join(stageDir, ".feynman-runtime-restore-journal.json"),
		`${JSON.stringify({
			version: 1,
			pid,
			createdAt,
			token,
			workspaceName,
			stageName,
			backupName,
			phase,
		})}\n`,
	);
	return { backupName };
}

async function createRuntimeFixture({
	withBinSymlink = false,
	withRuntimeSymlink = false,
	unsafeSymlinkTarget,
}: {
	withBinSymlink?: boolean;
	withRuntimeSymlink?: boolean;
	unsafeSymlinkTarget?: string;
} = {}) {
	const root = mkdtempSync(join(tmpdir(), "feynman-runtime-restore-"));
	const feynmanDir = join(root, ".feynman");
	const sourceWorkspaceDir = join(root, "source", "npm");
	const runtimePackageDir = join(
		sourceWorkspaceDir,
		"node_modules",
		"runtime-package",
	);
	const transitivePackageDir = join(
		sourceWorkspaceDir,
		"node_modules",
		"transitive-package",
	);
	const archivePath = join(feynmanDir, "runtime-workspace.tgz");
	const digestPath = join(feynmanDir, "runtime-workspace.sha256");
	const packageSpecs = ["runtime-package@1.0.0"];

	mkdirSync(runtimePackageDir, { recursive: true });
	mkdirSync(transitivePackageDir, { recursive: true });
	writeFileSync(
		join(sourceWorkspaceDir, "package.json"),
		`${JSON.stringify({
			name: "feynman-runtime",
			private: true,
			dependencies: { "runtime-package": "1.0.0" },
		}, null, 2)}\n`,
	);
	writeFileSync(join(sourceWorkspaceDir, ".npmrc"), "audit=false\n");
	writeFileSync(
		join(runtimePackageDir, "package.json"),
		'{"name":"runtime-package","version":"1.0.0"}\n',
	);
	writeFileSync(join(runtimePackageDir, "cli.js"), "export const ready = true;\n");
	if (process.platform !== "win32") {
		chmodSync(join(runtimePackageDir, "cli.js"), 0o755);
	}
	writeFileSync(
		join(transitivePackageDir, "package.json"),
		'{"name":"transitive-package","version":"2.0.0"}\n',
	);
	writeFileSync(join(transitivePackageDir, "index.js"), "export default 42;\n");
	if (withBinSymlink) {
		const binDir = join(sourceWorkspaceDir, "node_modules", ".bin");
		mkdirSync(binDir, { recursive: true });
		symlinkSync("../runtime-package/cli.js", join(binDir, "runtime-package"));
	}
	if (withRuntimeSymlink) {
		symlinkSync(
			"runtime-package/cli.js",
			join(sourceWorkspaceDir, "node_modules", "runtime-link"),
		);
	}
	if (unsafeSymlinkTarget) {
		symlinkSync(
			unsafeSymlinkTarget,
			join(sourceWorkspaceDir, "node_modules", "unsafe-link"),
		);
	}

	writeFileSync(
		join(sourceWorkspaceDir, "package-lock.json"),
		`${JSON.stringify({
			name: "feynman-runtime",
			lockfileVersion: 3,
			packages: {
				"": {
					dependencies: { "runtime-package": "1.0.0" },
				},
				"node_modules/runtime-package": {
					version: "1.0.0",
				},
				"node_modules/transitive-package": {
					version: "2.0.0",
				},
			},
		}, null, 2)}\n`,
	);
	writeFileSync(
		join(sourceWorkspaceDir, ".runtime-manifest.json"),
			`${JSON.stringify({
				packageSpecs,
				nodeAbi: process.versions.modules,
				platform: process.platform,
				arch: process.arch,
				...(currentLibc() ? { libc: currentLibc() } : {}),
				pruneVersion: 8,
				runtimeTreeHash: computeRuntimeTreeHash(sourceWorkspaceDir),
			}, null, 2)}\n`,
	);
	mkdirSync(feynmanDir, { recursive: true });
	await createDeterministicTarGz(sourceWorkspaceDir, archivePath);
	writeFileSha256(archivePath, digestPath);

	return {
		root,
		feynmanDir,
		sourceWorkspaceDir,
		archivePath,
		digestPath,
		workspaceDir: join(feynmanDir, "npm"),
	};
}

function copyArchiveTreeWithout(
	sourceWorkspaceDir: string,
	options: { cwd?: string },
	args: readonly string[],
	relativePaths: string[],
) {
	const destination = resolve(
		options.cwd ?? process.cwd(),
		args[args.indexOf("-C") + 1],
		"npm",
	);
	cpSync(sourceWorkspaceDir, destination, { recursive: true });
	for (const relativePath of relativePaths) {
		rmSync(join(destination, ...relativePath.split("/")), {
			recursive: true,
			force: true,
		});
	}
	return destination;
}

test("runtime archive restore publishes a verified staged tree atomically", async () => {
	const fixture = await createRuntimeFixture();
	try {
		mkdirSync(fixture.workspaceDir, { recursive: true });
		writeFileSync(join(fixture.workspaceDir, "old.txt"), "old workspace\n");

		assert.equal(
			restoreRuntimeWorkspaceFromArchive({
				archivePath: fixture.archivePath,
				digestPath: fixture.digestPath,
				workspaceDir: fixture.workspaceDir,
			}),
			true,
		);
		assert.equal(existsSync(join(fixture.workspaceDir, "old.txt")), false);
		assert.equal(
			readFileSync(
				join(
					fixture.workspaceDir,
					"node_modules",
					"transitive-package",
					"index.js",
				),
				"utf8",
			),
			"export default 42;\n",
		);
		assert.equal(
			runtimeWorkspaceCompletionMatches(fixture.workspaceDir, {
				archivePath: fixture.archivePath,
				digestPath: fixture.digestPath,
			}),
			true,
		);
		assert.equal(
			computeRuntimeTreeHash(fixture.workspaceDir),
			computeRuntimeTreeHash(fixture.sourceWorkspaceDir),
		);
		assert.deepEqual(
			readdirSync(fixture.feynmanDir).filter((name) =>
				name.startsWith("runtime-workspace.restore-") ||
				name.startsWith("runtime-workspace.backup-")
			),
			[],
		);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("runtime completion and extraction bind portable executable bits", {
	skip: process.platform === "win32",
}, async () => {
	const fixture = await createRuntimeFixture();
	try {
		assert.equal(
			restoreRuntimeWorkspaceFromArchive({
				archivePath: fixture.archivePath,
				digestPath: fixture.digestPath,
				workspaceDir: fixture.workspaceDir,
			}),
			true,
		);
		const cliPath = join(
			fixture.workspaceDir,
			"node_modules",
			"runtime-package",
			"cli.js",
		);
		chmodSync(cliPath, 0o644);
		assert.equal(
			runtimeArchiveExtractionMatches(
				fixture.archivePath,
				fixture.workspaceDir,
			),
			false,
		);
		assert.equal(
			runtimeWorkspaceCompletionMatches(fixture.workspaceDir, {
				archivePath: fixture.archivePath,
				digestPath: fixture.digestPath,
			}),
			false,
		);
		assert.equal(
			runtimeArchiveExtractionMatches(
				fixture.archivePath,
				fixture.workspaceDir,
				{ compareExecutableModes: false },
			),
			true,
		);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("archive completion rejects a changed offline recovery seed", async () => {
	const fixture = await createRuntimeFixture();
	try {
		assert.equal(
			restoreRuntimeWorkspaceFromArchive({
				archivePath: fixture.archivePath,
				digestPath: fixture.digestPath,
				workspaceDir: fixture.workspaceDir,
			}),
			true,
		);
		appendFileSync(fixture.archivePath, "changed");
		assert.equal(
			runtimeWorkspaceCompletionMatches(fixture.workspaceDir, {
				archivePath: fixture.archivePath,
				digestPath: fixture.digestPath,
			}),
			false,
		);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("runtime archive restore rejects a missing transitive file and preserves the live tree", async () => {
	const fixture = await createRuntimeFixture();
	try {
		mkdirSync(fixture.workspaceDir, { recursive: true });
		writeFileSync(join(fixture.workspaceDir, "old.txt"), "preserve me\n");

		const restored = restoreRuntimeWorkspaceFromArchive({
			archivePath: fixture.archivePath,
			digestPath: fixture.digestPath,
			workspaceDir: fixture.workspaceDir,
			spawn(_command, args, options) {
				copyArchiveTreeWithout(
					fixture.sourceWorkspaceDir,
					options,
					args,
					["node_modules/transitive-package/index.js"],
				);
				return { status: 0, signal: null, stderr: Buffer.alloc(0) };
			},
		});

		assert.equal(restored, false);
		assert.equal(
			readFileSync(join(fixture.workspaceDir, "old.txt"), "utf8"),
			"preserve me\n",
		);
		assert.equal(
			existsSync(getRuntimeWorkspaceCompletionPath(fixture.workspaceDir)),
			false,
		);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("runtime archive restore rejects path substitution and preserves the live tree", async () => {
	const fixture = await createRuntimeFixture();
	try {
		mkdirSync(fixture.workspaceDir, { recursive: true });
		writeFileSync(join(fixture.workspaceDir, "old.txt"), "preserve me\n");

		const replacementWorkspaceDir = join(fixture.root, "replacement", "npm");
		const replacementArchivePath = join(
			fixture.feynmanDir,
			"runtime-workspace.replacement.tgz",
		);
		cpSync(fixture.sourceWorkspaceDir, replacementWorkspaceDir, {
			recursive: true,
		});
		writeFileSync(
			join(
				replacementWorkspaceDir,
				"node_modules",
				"transitive-package",
				"index.js",
			),
			"export default 'substituted';\n",
		);
		await createDeterministicTarGz(
			replacementWorkspaceDir,
			replacementArchivePath,
		);

		const originalArchivePath = `${fixture.archivePath}.original`;
		const restored = restoreRuntimeWorkspaceFromArchive({
			archivePath: fixture.archivePath,
			digestPath: fixture.digestPath,
			workspaceDir: fixture.workspaceDir,
			spawn(command, args, options) {
				renameSync(fixture.archivePath, originalArchivePath);
				renameSync(replacementArchivePath, fixture.archivePath);
				return spawnSync(command, args, options);
			},
		});

		assert.equal(restored, false);
		assert.equal(
			readFileSync(join(fixture.workspaceDir, "old.txt"), "utf8"),
			"preserve me\n",
		);
		assert.equal(
			existsSync(getRuntimeWorkspaceCompletionPath(fixture.workspaceDir)),
			false,
		);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("runtime archive restore rejects authenticated snapshot substitution and preserves the live tree", async () => {
	const fixture = await createRuntimeFixture();
	try {
		mkdirSync(fixture.workspaceDir, { recursive: true });
		writeFileSync(join(fixture.workspaceDir, "old.txt"), "preserve me\n");

		const replacementWorkspaceDir = join(fixture.root, "replacement", "npm");
		const replacementArchivePath = join(
			fixture.feynmanDir,
			"runtime-workspace.replacement.tgz",
		);
		cpSync(fixture.sourceWorkspaceDir, replacementWorkspaceDir, {
			recursive: true,
		});
		writeFileSync(
			join(
				replacementWorkspaceDir,
				"node_modules",
				"transitive-package",
				"index.js",
			),
			"export default 'substituted';\n",
		);
		await createDeterministicTarGz(
			replacementWorkspaceDir,
			replacementArchivePath,
		);

		let targetedSnapshotPath: string | undefined;
		const restored = restoreRuntimeWorkspaceFromArchive({
			archivePath: fixture.archivePath,
			digestPath: fixture.digestPath,
			workspaceDir: fixture.workspaceDir,
			spawn(command, args, options) {
				const archiveArgumentIndex = args.indexOf("-xzf") + 1;
				assert.notEqual(archiveArgumentIndex, 0);
				const snapshotPath = resolve(
					options.cwd,
					args[archiveArgumentIndex],
				);
				targetedSnapshotPath = snapshotPath;
				assert.equal(
					snapshotPath.endsWith("runtime-workspace.authenticated.tgz"),
					true,
				);
				assert.notEqual(snapshotPath, fixture.archivePath);
				rmSync(snapshotPath);
				cpSync(replacementArchivePath, snapshotPath);
				return spawnSync(command, args, options);
			},
		});

		assert.equal(restored, false);
		assert.notEqual(targetedSnapshotPath, undefined);
		assert.equal(
			readFileSync(join(fixture.workspaceDir, "old.txt"), "utf8"),
			"preserve me\n",
		);
		assert.equal(
			existsSync(getRuntimeWorkspaceCompletionPath(fixture.workspaceDir)),
			false,
		);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("archive fallback seed never rereads an attacker-substituted canonical archive", async () => {
	const fixture = await createRuntimeFixture();
	try {
		mkdirSync(fixture.workspaceDir, { recursive: true });
		writeFileSync(join(fixture.workspaceDir, "old.txt"), "preserve me\n");

		const replacementWorkspaceDir = join(fixture.root, "replacement", "npm");
		const replacementArchivePath = join(
			fixture.feynmanDir,
			"runtime-workspace.replacement.tgz",
		);
		cpSync(fixture.sourceWorkspaceDir, replacementWorkspaceDir, {
			recursive: true,
		});
		const replacementLock = JSON.parse(
			readFileSync(join(replacementWorkspaceDir, "package-lock.json"), "utf8"),
		);
		replacementLock.packages["node_modules/runtime-package"].resolved =
			"https://attacker.invalid/runtime-package.tgz";
		replacementLock.packages["node_modules/runtime-package"].integrity =
			"sha512-attacker";
		writeFileSync(
			join(replacementWorkspaceDir, "package-lock.json"),
			`${JSON.stringify(replacementLock, null, 2)}\n`,
		);
		await createDeterministicTarGz(
			replacementWorkspaceDir,
			replacementArchivePath,
		);

		const result = restoreRuntimeWorkspaceFromArchiveWithSeed({
			archivePath: fixture.archivePath,
			digestPath: fixture.digestPath,
			workspaceDir: fixture.workspaceDir,
			spawn() {
				rmSync(fixture.archivePath);
				cpSync(replacementArchivePath, fixture.archivePath);
				return {
					status: 2,
					signal: null,
					stderr: Buffer.from("tar: injected extraction failure\n"),
				};
			},
		});

		assert.equal(result.restored, false);
		assert.equal(
			readFileSync(join(fixture.workspaceDir, "old.txt"), "utf8"),
			"preserve me\n",
		);
		assert.equal(
			result.installSeed?.packageLockSource.includes("attacker.invalid"),
			false,
		);
		assert.equal(
			result.installSeed?.packageLockSource.includes("sha512-attacker"),
			false,
		);
		assert.equal(
			result.installSeed?.packageLockSource,
			readFileSync(join(fixture.sourceWorkspaceDir, "package-lock.json"), "utf8"),
		);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("runtime archive restore binds extraction to the authenticated snapshot entries", async () => {
	const fixture = await createRuntimeFixture();
	try {
		mkdirSync(fixture.workspaceDir, { recursive: true });
		writeFileSync(join(fixture.workspaceDir, "old.txt"), "preserve me\n");

		const replacementWorkspaceDir = join(fixture.root, "replacement", "npm");
		const replacementArchivePath = join(
			fixture.feynmanDir,
			"runtime-workspace.replacement.tgz",
		);
		cpSync(fixture.sourceWorkspaceDir, replacementWorkspaceDir, {
			recursive: true,
		});
		writeFileSync(
			join(
				replacementWorkspaceDir,
				"node_modules",
				"transitive-package",
				"index.js",
			),
			"export default 'substituted';\n",
		);
		const replacementManifestPath = join(
			replacementWorkspaceDir,
			".runtime-manifest.json",
		);
		const replacementManifest = JSON.parse(
			readFileSync(replacementManifestPath, "utf8"),
		);
		replacementManifest.runtimeTreeHash = computeRuntimeTreeHash(
			replacementWorkspaceDir,
		);
		writeFileSync(
			replacementManifestPath,
			`${JSON.stringify(replacementManifest, null, 2)}\n`,
		);
		await createDeterministicTarGz(
			replacementWorkspaceDir,
			replacementArchivePath,
		);

		let authenticatedSnapshotPath = "";
		let originalSnapshotPath = "";
		const restored = restoreRuntimeWorkspaceFromArchive({
			archivePath: fixture.archivePath,
			digestPath: fixture.digestPath,
			workspaceDir: fixture.workspaceDir,
			onAuthenticatedArchive(snapshotPath) {
				authenticatedSnapshotPath = snapshotPath;
				originalSnapshotPath = `${snapshotPath}.original`;
			},
			spawn(command, args, options) {
				renameSync(authenticatedSnapshotPath, originalSnapshotPath);
				renameSync(replacementArchivePath, authenticatedSnapshotPath);
				return spawnSync(command, args, options);
			},
			validateWorkspace() {
				renameSync(authenticatedSnapshotPath, replacementArchivePath);
				renameSync(originalSnapshotPath, authenticatedSnapshotPath);
				return true;
			},
		});

		assert.equal(restored, false);
		assert.equal(
			readFileSync(join(fixture.workspaceDir, "old.txt"), "utf8"),
			"preserve me\n",
		);
		assert.equal(
			existsSync(getRuntimeWorkspaceCompletionPath(fixture.workspaceDir)),
			false,
		);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("runtime extraction rejects an extra entry paired with a missing archive entry", async () => {
	const fixture = await createRuntimeFixture();
	try {
		const candidateDir = join(fixture.root, "candidate");
		cpSync(fixture.sourceWorkspaceDir, candidateDir, { recursive: true });
		rmSync(join(candidateDir, "node_modules", "transitive-package", "index.js"));
		writeFileSync(join(candidateDir, "unexpected.js"), "unexpected\n");

		assert.equal(
			runtimeArchiveExtractionMatches(fixture.archivePath, candidateDir),
			false,
		);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("an interrupted runtime residue without a completion marker is never accepted", async () => {
	const fixture = await createRuntimeFixture();
	try {
		cpSync(fixture.sourceWorkspaceDir, fixture.workspaceDir, { recursive: true });
		rmSync(
			join(
				fixture.workspaceDir,
				"node_modules",
				"transitive-package",
				"index.js",
			),
		);

		assert.equal(
			runtimeWorkspaceCompletionMatches(fixture.workspaceDir, {
				archivePath: fixture.archivePath,
				digestPath: fixture.digestPath,
			}),
			false,
		);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("a completion marker rejects a deleted payload while its package remains", async () => {
	const fixture = await createRuntimeFixture();
	try {
		cpSync(fixture.sourceWorkspaceDir, fixture.workspaceDir, { recursive: true });
		writeRuntimeWorkspaceCompletion(fixture.workspaceDir, {
			source: "package-manager",
			runtimeTreeHash: computeRuntimeTreeHash(fixture.workspaceDir),
		});
		assert.equal(
			runtimeWorkspaceCompletionMatches(fixture.workspaceDir, {
				archivePath: fixture.archivePath,
				digestPath: fixture.digestPath,
			}),
			true,
		);

		rmSync(
			join(
				fixture.workspaceDir,
				"node_modules",
				"transitive-package",
				"index.js",
			),
		);
		assert.equal(
			existsSync(
				join(
					fixture.workspaceDir,
					"node_modules",
					"transitive-package",
					"package.json",
				),
			),
			true,
		);
		assert.equal(
			runtimeWorkspaceCompletionMatches(fixture.workspaceDir, {
				archivePath: fixture.archivePath,
				digestPath: fixture.digestPath,
			}),
			false,
		);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("completion binds a substituted marker and lock to the live payload", async () => {
	const fixture = await createRuntimeFixture();
	const substituteDir = join(fixture.root, "substitute");
	try {
		cpSync(fixture.sourceWorkspaceDir, fixture.workspaceDir, { recursive: true });
		writeRuntimeWorkspaceCompletion(fixture.workspaceDir, {
			source: "package-manager",
			runtimeTreeHash: computeRuntimeTreeHash(fixture.workspaceDir),
		});
		cpSync(fixture.sourceWorkspaceDir, substituteDir, { recursive: true });
		writeFileSync(
			join(
				substituteDir,
				"node_modules",
				"transitive-package",
				"index.js",
			),
			"export default 99;\n",
		);
		const substituteLock = JSON.parse(
			readFileSync(join(substituteDir, "package-lock.json"), "utf8"),
		);
		substituteLock.packages["node_modules/substitute-optional"] = {
			version: "1.0.0",
			optional: true,
			os: ["never-this-platform"],
		};
		writeFileSync(
			join(substituteDir, "package-lock.json"),
			`${JSON.stringify(substituteLock, null, 2)}\n`,
		);
		writeRuntimeWorkspaceCompletion(substituteDir, {
			source: "package-manager",
			runtimeTreeHash: computeRuntimeTreeHash(substituteDir),
		});

		cpSync(
			join(substituteDir, "package-lock.json"),
			join(fixture.workspaceDir, "package-lock.json"),
		);
		cpSync(
			getRuntimeWorkspaceCompletionPath(substituteDir),
			getRuntimeWorkspaceCompletionPath(fixture.workspaceDir),
		);
		assert.equal(
			runtimeWorkspaceCompletionMatches(fixture.workspaceDir, {
				archivePath: fixture.archivePath,
				digestPath: fixture.digestPath,
			}),
			false,
		);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("completion detects a payload size change without rehashing every file", async () => {
	const fixture = await createRuntimeFixture();
	try {
		cpSync(fixture.sourceWorkspaceDir, fixture.workspaceDir, { recursive: true });
		writeRuntimeWorkspaceCompletion(fixture.workspaceDir, {
			source: "package-manager",
			runtimeTreeHash: computeRuntimeTreeHash(fixture.workspaceDir),
		});
		const payloadPath = join(
			fixture.workspaceDir,
			"node_modules",
			"transitive-package",
			"index.js",
		);
		writeFileSync(payloadPath, `${readFileSync(payloadPath, "utf8")}changed\n`);

		assert.equal(
			runtimeWorkspaceCompletionMatches(fixture.workspaceDir, {
				archivePath: fixture.archivePath,
				digestPath: fixture.digestPath,
			}),
			false,
		);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("Windows nonzero extraction status cannot bless incomplete bytes", async () => {
	const fixture = await createRuntimeFixture();
	try {
		const restored = restoreRuntimeWorkspaceFromArchive({
			archivePath: fixture.archivePath,
			digestPath: fixture.digestPath,
			workspaceDir: fixture.workspaceDir,
			platform: "win32",
			spawn(_command, args, options) {
				copyArchiveTreeWithout(
					fixture.sourceWorkspaceDir,
					options,
					args,
					["node_modules/transitive-package/index.js"],
				);
				return {
					status: 127,
					signal: null,
					stderr: Buffer.from("tar: fatal extraction failure\n"),
				};
			},
		});

		assert.equal(restored, false);
		assert.equal(existsSync(fixture.workspaceDir), false);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("Windows restore allows only absent allowlisted links after exact byte extraction", async () => {
	const fixture = await createRuntimeFixture({ withBinSymlink: true });
	try {
		const restored = restoreRuntimeWorkspaceFromArchive({
			archivePath: fixture.archivePath,
			digestPath: fixture.digestPath,
			workspaceDir: fixture.workspaceDir,
			platform: "win32",
			spawn(_command, args, options) {
				copyArchiveTreeWithout(
					fixture.sourceWorkspaceDir,
					options,
					args,
					["node_modules/.bin/runtime-package"],
				);
				return {
					status: 2,
					signal: null,
					stderr: Buffer.from("tar: link creation unavailable\n"),
				};
			},
		});

		assert.equal(restored, true);
		assert.equal(
			existsSync(
				join(
					fixture.workspaceDir,
					"node_modules",
					"runtime-package",
					"cli.js",
				),
			),
			true,
		);
		assert.equal(
			existsSync(
				join(
					fixture.workspaceDir,
					"node_modules",
					".bin",
					"runtime-package",
				),
			),
			false,
		);
		assert.equal(
			runtimeWorkspaceCompletionMatches(fixture.workspaceDir, {
				archivePath: fixture.archivePath,
				digestPath: fixture.digestPath,
			}),
			true,
		);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("missing non-allowlisted runtime links still fail complete-tree verification", {
	skip: process.platform === "win32",
}, async () => {
	const fixture = await createRuntimeFixture({ withRuntimeSymlink: true });
	try {
		const candidateDir = join(fixture.root, "candidate-links");
		cpSync(fixture.sourceWorkspaceDir, candidateDir, { recursive: true });
		rmSync(join(candidateDir, "node_modules", "runtime-link"));

		assert.equal(
			runtimeArchiveExtractionMatches(
				fixture.archivePath,
				candidateDir,
				{ allowMissingWindowsSymlinks: true },
			),
			false,
		);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("unsafe archive link targets are rejected before the extractor runs", {
	skip: process.platform === "win32",
}, async () => {
	const fixture = await createRuntimeFixture({
		unsafeSymlinkTarget: "/tmp/outside-runtime",
	});
	try {
		let spawned = false;
		assert.throws(
			() =>
				restoreRuntimeWorkspaceFromArchive({
					archivePath: fixture.archivePath,
					digestPath: fixture.digestPath,
					workspaceDir: fixture.workspaceDir,
					spawn() {
						spawned = true;
						return { status: 0, signal: null };
					},
				}),
			/symlink target is outside npm/,
		);
		assert.equal(spawned, false);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("package-manager fallback starts from a clean archive-derived seed", async () => {
	const fixture = await createRuntimeFixture();
	try {
		mkdirSync(join(fixture.workspaceDir, "node_modules", "partial"), {
			recursive: true,
		});
		writeFileSync(join(fixture.workspaceDir, "partial.txt"), "stale\n");
		writeFileSync(
			getRuntimeWorkspaceCompletionPath(fixture.workspaceDir),
			'{"stale":true}\n',
		);

		assert.throws(
			() =>
				readRuntimeWorkspaceInstallSeed(fixture.archivePath, [
					"extra-package@3.0.0",
				]),
			/does not pin extra-package@3\.0\.0/,
		);
		const seed = readRuntimeWorkspaceInstallSeed(fixture.archivePath);
		assert.match(seed.packageLockSha256, /^[a-f0-9]{64}$/);
		assert.throws(
			() =>
				prepareRuntimeWorkspaceFallback(join(fixture.root, "tampered-seed"), {
					...seed,
					packageLockSource: `${seed.packageLockSource}\n`,
				}),
			/fallback seed package lock is invalid/,
		);
		prepareRuntimeWorkspaceFallback(fixture.workspaceDir, seed);

		assert.deepEqual(seed.packageSpecs, ["runtime-package@1.0.0"]);
		assert.equal(existsSync(join(fixture.workspaceDir, "partial.txt")), false);
		assert.equal(existsSync(join(fixture.workspaceDir, "node_modules")), false);
		assert.equal(
			readFileSync(join(fixture.workspaceDir, "package-lock.json"), "utf8"),
			seed.packageLockSource,
		);
		assert.equal(
			existsSync(getRuntimeWorkspaceCompletionPath(fixture.workspaceDir)),
			false,
		);
		assert.equal(
			JSON.parse(
				readFileSync(join(fixture.workspaceDir, "package.json"), "utf8"),
			).dependencies["runtime-package"],
			"1.0.0",
		);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("transactional package fallback preserves or recovers the previous workspace on failure", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-runtime-transaction-"));
	const feynmanDir = join(root, ".feynman");
	const workspaceDir = join(feynmanDir, "npm");
	try {
		mkdirSync(workspaceDir, { recursive: true });
		writeFileSync(join(workspaceDir, "preserved.txt"), "previous runtime\n");
		assert.equal(
			replaceRuntimeWorkspaceTransactionally(
				workspaceDir,
				(stagedWorkspaceDir) => {
					mkdirSync(stagedWorkspaceDir, { recursive: true });
					writeFileSync(join(stagedWorkspaceDir, "partial.txt"), "partial\n");
					return false;
				},
			),
			false,
		);
		assert.equal(
			readFileSync(join(workspaceDir, "preserved.txt"), "utf8"),
			"previous runtime\n",
		);
		assert.equal(existsSync(join(workspaceDir, "partial.txt")), false);

		assert.throws(
			() =>
				replaceRuntimeWorkspaceTransactionally(
					workspaceDir,
					(stagedWorkspaceDir) => {
						mkdirSync(stagedWorkspaceDir, { recursive: true });
						writeFileSync(
							getRuntimeWorkspaceCompletionPath(stagedWorkspaceDir),
							'{"complete":true}\n',
						);
						return true;
					},
				),
			/did not produce a valid completed workspace/,
		);
		assert.equal(
			readFileSync(join(workspaceDir, "preserved.txt"), "utf8"),
			"previous runtime\n",
		);

		writeCompletedWorkspace(workspaceDir);
		const backupDir = join(
			feynmanDir,
			`runtime-workspace.backup-123-${Date.now() - 10_000}`,
		);
		renameSync(workspaceDir, backupDir);
		assert.equal(
			replaceRuntimeWorkspaceTransactionally(workspaceDir, () => false),
			false,
		);
		assert.equal(
			readFileSync(join(workspaceDir, "preserved.txt"), "utf8"),
			"previous runtime\n",
		);
		assert.equal(existsSync(backupDir), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("crash recovery skips an invalid newer backup for an older complete workspace", async () => {
	const fixture = await createRuntimeFixture();
	try {
		const validBackupDir = join(
			fixture.feynmanDir,
			"runtime-workspace.backup-123-1000",
		);
		cpSync(fixture.sourceWorkspaceDir, validBackupDir, { recursive: true });
		writeRuntimeWorkspaceCompletion(validBackupDir, {
			source: "package-manager",
			runtimeTreeHash: computeRuntimeTreeHash(validBackupDir),
		});
		const invalidBackupDir = join(
			fixture.feynmanDir,
			"runtime-workspace.backup-123-2000",
		);
		cpSync(fixture.sourceWorkspaceDir, invalidBackupDir, { recursive: true });
		rmSync(
			join(
				invalidBackupDir,
				"node_modules",
				"transitive-package",
				"index.js",
			),
		);
		writeFileSync(
			getRuntimeWorkspaceCompletionPath(invalidBackupDir),
			'{"version":1,"complete":true}\n',
		);

		assert.equal(
			replaceRuntimeWorkspaceTransactionally(
				fixture.workspaceDir,
				() => false,
			),
			false,
		);
		assert.equal(
			readFileSync(
				join(
					fixture.workspaceDir,
					"node_modules",
					"transitive-package",
					"index.js",
				),
				"utf8",
			),
			"export default 42;\n",
		);
		assert.equal(existsSync(validBackupDir), false);
		assert.equal(existsSync(invalidBackupDir), true);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("journal recovery deterministically rolls back a moved live workspace", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-runtime-journal-backup-"));
	const workspaceDir = join(root, "npm");
	const pid = 123;
	const createdAt = 10_000;
	const token = "rollback";
	const stageDir = join(
		root,
		`runtime-workspace.restore-${pid}-${createdAt}-${token}`,
	);
	try {
		const { backupName } = writeRestoreJournal(stageDir, {
			pid,
			createdAt,
			token,
			phase: "live-backed-up",
		});
		writeCompletedWorkspace(join(root, backupName), {
			value: "previous live\n",
		});

		reconcileRuntimeWorkspaceRestoreArtifacts(workspaceDir);
		assert.equal(
			readFileSync(join(workspaceDir, "value.txt"), "utf8"),
			"previous live\n",
		);
		assert.equal(existsSync(join(root, backupName)), false);
		assert.equal(existsSync(stageDir), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
