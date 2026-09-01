import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import test from "node:test";

import {
	computeFileSha256,
	writeFileSha256,
} from "../scripts/lib/runtime-workspace-integrity.mjs";
import {
	buildSourceRuntimeArchive,
	installRuntimeWorkspaceFromPackageLock,
	RUNTIME_WORKSPACE_PACKAGE_INSTALL_TIMEOUT_MS,
} from "../scripts/lib/runtime-workspace-install.mjs";

test("source checkout builds the exact authenticated runtime archive", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-runtime-source-"));
	const feynmanDir = join(root, ".feynman");
	const archivePath = join(feynmanDir, "runtime-workspace.tgz");
	const digestPath = join(feynmanDir, "runtime-workspace.sha256");
	const inheritedTarget = process.env.FEYNMAN_RUNTIME_WORKSPACE_TARGET;
	const inheritedLowerGlobal = process.env.npm_config_global;
	const inheritedUpperGlobal = process.env.NPM_CONFIG_GLOBAL;
	const inheritedLowerLocation = process.env.npm_config_location;
	const inheritedUpperLocation = process.env.NPM_CONFIG_LOCATION;
	try {
		mkdirSync(join(root, ".git"));
		mkdirSync(feynmanDir);
		writeFileSync(join(feynmanDir, "runtime-package-lock.json"), "{}\n");
		process.env.FEYNMAN_RUNTIME_WORKSPACE_TARGET = "/tmp/untrusted-target";
		process.env.npm_config_global = "true";
		process.env.NPM_CONFIG_GLOBAL = "true";
		process.env.npm_config_location = "global";
		process.env.NPM_CONFIG_LOCATION = "global";

		let heartbeats = 0;
		let invocations = 0;
		assert.equal(
			buildSourceRuntimeArchive(root, {
				heartbeat: () => {
					heartbeats += 1;
				},
				spawn(command, args, options) {
					invocations += 1;
					assert.equal(command, process.execPath);
					assert.deepEqual(args, [
						join(root, "scripts", "prepare-runtime-workspace.mjs"),
						"--rebuild",
					]);
					assert.equal(options.cwd, root);
					assert.deepEqual(options.stdio, ["ignore", "pipe", "pipe"]);
					assert.equal(
						options.timeout,
						RUNTIME_WORKSPACE_PACKAGE_INSTALL_TIMEOUT_MS,
					);
					assert.equal(
						options.env.FEYNMAN_RUNTIME_WORKSPACE_TARGET,
						undefined,
					);
					assert.equal(options.env.npm_config_global, "false");
					assert.equal(options.env.NPM_CONFIG_GLOBAL, "false");
					assert.equal(options.env.npm_config_location, "project");
					assert.equal(options.env.NPM_CONFIG_LOCATION, "project");
					assert.ok(
						(options.env.PATH ?? "").split(delimiter).includes(
							dirname(process.execPath),
						),
					);
					writeFileSync(archivePath, "authenticated archive");
					writeFileSha256(archivePath, digestPath);
					return {
						status: 0,
						stdout: Buffer.alloc(0),
						stderr: Buffer.alloc(0),
					};
				},
			}),
			true,
		);
		assert.equal(heartbeats, 2);
		assert.equal(invocations, 1);

		assert.equal(
			buildSourceRuntimeArchive(root, {
				spawn() {
					throw new Error("complete archive must not be rebuilt");
				},
			}),
			false,
		);
	} finally {
		if (inheritedTarget === undefined) {
			delete process.env.FEYNMAN_RUNTIME_WORKSPACE_TARGET;
		} else {
			process.env.FEYNMAN_RUNTIME_WORKSPACE_TARGET = inheritedTarget;
		}
		for (const [name, value] of [
			["npm_config_global", inheritedLowerGlobal],
			["NPM_CONFIG_GLOBAL", inheritedUpperGlobal],
			["npm_config_location", inheritedLowerLocation],
			["NPM_CONFIG_LOCATION", inheritedUpperLocation],
		] as const) {
			if (value === undefined) {
				delete process.env[name];
			} else {
				process.env[name] = value;
			}
		}
		rmSync(root, { recursive: true, force: true });
	}
});

test("source archive rebuild requires both archive and digest outputs", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-runtime-source-output-"));
	const feynmanDir = join(root, ".feynman");
	const archivePath = join(feynmanDir, "runtime-workspace.tgz");
	const digestPath = join(feynmanDir, "runtime-workspace.sha256");
	try {
		mkdirSync(join(root, ".git"));
		mkdirSync(feynmanDir);
		writeFileSync(join(feynmanDir, "runtime-package-lock.json"), "{}\n");
		assert.equal(
			buildSourceRuntimeArchive(root, {
				spawn() {
					writeFileSync(archivePath, "archive without digest");
					return {
						status: 0,
						stdout: Buffer.alloc(0),
						stderr: Buffer.alloc(0),
					};
				},
			}),
			false,
		);

		assert.equal(
			buildSourceRuntimeArchive(root, {
				spawn() {
					writeFileSha256(archivePath, digestPath);
					return {
						status: 0,
						stdout: Buffer.alloc(0),
						stderr: Buffer.alloc(0),
					};
				},
			}),
			true,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("source checkout rebuilds a mismatched archive and digest pair", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-runtime-source-mismatch-"));
	const feynmanDir = join(root, ".feynman");
	const archivePath = join(feynmanDir, "runtime-workspace.tgz");
	const digestPath = join(feynmanDir, "runtime-workspace.sha256");
	try {
		writeFileSync(join(root, ".git"), "gitdir: ../worktrees/feynman\n");
		mkdirSync(feynmanDir);
		writeFileSync(join(feynmanDir, "runtime-package-lock.json"), "{}\n");
		writeFileSync(archivePath, "corrupt archive");
		writeFileSync(digestPath, `${"0".repeat(64)}  runtime-workspace.tgz\n`);
		assert.equal(
			buildSourceRuntimeArchive(root, {
				spawn() {
					writeFileSync(archivePath, "rebuilt archive");
					writeFileSha256(archivePath, digestPath);
					return {
						status: 0,
						stdout: Buffer.alloc(0),
						stderr: Buffer.alloc(0),
					};
				},
			}),
			true,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("installed package cannot rebuild missing or damaged runtime archives", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-runtime-installed-"));
	const feynmanDir = join(root, ".feynman");
	try {
		mkdirSync(feynmanDir);
		writeFileSync(join(feynmanDir, "runtime-package-lock.json"), "{}\n");
		for (const state of ["missing", "archive-only", "mismatch"]) {
			rmSync(join(feynmanDir, "runtime-workspace.tgz"), { force: true });
			rmSync(join(feynmanDir, "runtime-workspace.sha256"), { force: true });
			if (state !== "missing") {
				writeFileSync(join(feynmanDir, "runtime-workspace.tgz"), state);
			}
			if (state === "mismatch") {
				writeFileSync(
					join(feynmanDir, "runtime-workspace.sha256"),
					`${"0".repeat(64)}  runtime-workspace.tgz\n`,
				);
			}
			assert.equal(
				buildSourceRuntimeArchive(root, {
					force: true,
					spawn() {
						throw new Error("installed package must fail closed");
					},
				}),
				false,
				state,
			);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("package-manager fallback uses npm ci and rejects lock mutation", () => {
	assert.equal(RUNTIME_WORKSPACE_PACKAGE_INSTALL_TIMEOUT_MS, 15 * 60_000);
	const root = mkdtempSync(join(tmpdir(), "feynman-runtime-exact-lock-"));
	const lockPath = join(root, "package-lock.json");
	const lockSource =
		'{"name":"runtime","lockfileVersion":3,"packages":{"":{"dependencies":{}}}}\n';
	try {
		writeFileSync(lockPath, lockSource);
		const expectedPackageLockSha256 = computeFileSha256(lockPath);
		let heartbeats = 0;
		assert.equal(
			installRuntimeWorkspaceFromPackageLock(root, {
				expectedPackageLockSha256,
				heartbeat: () => {
					heartbeats += 1;
				},
				invocation: { command: "npm", args: [] },
				spawn(command, args, options) {
					assert.equal(command, "npm");
					assert.equal(args[0], "ci");
					assert.ok(args.includes("--no-dry-run"));
					assert.equal(options.cwd, root);
					assert.equal(options.env.npm_config_global, "false");
					assert.equal(options.env.NPM_CONFIG_GLOBAL, "false");
					assert.equal(options.env.npm_config_location, "project");
					assert.equal(options.env.NPM_CONFIG_LOCATION, "project");
					assert.equal(options.env.npm_config_dry_run, "false");
					assert.equal(options.env.NPM_CONFIG_DRY_RUN, "false");
					assert.equal(
						options.timeout,
						RUNTIME_WORKSPACE_PACKAGE_INSTALL_TIMEOUT_MS,
					);
					mkdirSync(join(root, "node_modules"));
					return {
						status: 0,
						signal: null,
						stdout: Buffer.alloc(0),
						stderr: Buffer.alloc(0),
					};
				},
			}),
			true,
		);
		assert.equal(heartbeats, 2);

		writeFileSync(lockPath, lockSource);
		assert.equal(
			installRuntimeWorkspaceFromPackageLock(root, {
				expectedPackageLockSha256,
				invocation: { command: "npm", args: [] },
				spawn() {
					writeFileSync(lockPath, `${lockSource} `);
					return {
						status: 0,
						signal: null,
						stdout: Buffer.alloc(0),
						stderr: Buffer.alloc(0),
					};
				},
			}),
			false,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("package-manager fallback rejects dry-run success without node_modules", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-runtime-dry-run-"));
	const lockPath = join(root, "package-lock.json");
	const lockSource =
		'{"name":"runtime","lockfileVersion":3,"packages":{"":{"dependencies":{"pi-subagents":"0.40.0"}}}}\n';
	const inheritedLowerDryRun = process.env.npm_config_dry_run;
	const inheritedUpperDryRun = process.env.NPM_CONFIG_DRY_RUN;
	try {
		writeFileSync(lockPath, lockSource);
		process.env.npm_config_dry_run = "true";
		process.env.NPM_CONFIG_DRY_RUN = "true";
		assert.equal(
			installRuntimeWorkspaceFromPackageLock(root, {
				expectedPackageLockSha256: computeFileSha256(lockPath),
				invocation: { command: "npm", args: [] },
				spawn(_command, _args, options) {
					assert.equal(options.env.npm_config_dry_run, "false");
					assert.equal(options.env.NPM_CONFIG_DRY_RUN, "false");
					return {
						status: 0,
						signal: null,
						stdout: Buffer.alloc(0),
						stderr: Buffer.alloc(0),
					};
				},
			}),
			false,
		);
	} finally {
		if (inheritedLowerDryRun === undefined) {
			delete process.env.npm_config_dry_run;
		} else {
			process.env.npm_config_dry_run = inheritedLowerDryRun;
		}
		if (inheritedUpperDryRun === undefined) {
			delete process.env.NPM_CONFIG_DRY_RUN;
		} else {
			process.env.NPM_CONFIG_DRY_RUN = inheritedUpperDryRun;
		}
		rmSync(root, { recursive: true, force: true });
	}
});
