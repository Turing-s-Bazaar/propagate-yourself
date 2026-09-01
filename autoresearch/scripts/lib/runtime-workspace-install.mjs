import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, dirname, resolve } from "node:path";

import { resolveAdjacentNpmCommand } from "./npm-command.mjs";
import {
	computeFileSha256,
	verifyFileSha256,
} from "./runtime-workspace-integrity.mjs";

const FILTERED_INSTALL_OUTPUT_PATTERNS = [
	/npm warn deprecated node-domexception@1\.0\.0/i,
	/npm notice/i,
	/^(added|removed|changed) \d+ packages?( in .+)?$/i,
	/^\d+ packages are looking for funding$/i,
	/^run `npm fund` for details$/i,
];

export const RUNTIME_WORKSPACE_PACKAGE_INSTALL_TIMEOUT_MS = 15 * 60_000;

function getPathWithCurrentNode(pathValue = process.env.PATH ?? "") {
	const nodeDir = dirname(process.execPath);
	const parts = pathValue.split(delimiter).filter(Boolean);
	return parts.includes(nodeDir) ? pathValue : `${nodeDir}${delimiter}${pathValue}`;
}

function resolveNpmInvocation() {
	const adjacent = resolveAdjacentNpmCommand();
	if (adjacent) return adjacent;
	for (const directory of (process.env.PATH ?? "").split(delimiter)) {
		for (const name of process.platform === "win32"
			? ["npm.cmd", "npm.exe"]
			: ["npm"]) {
			const command = resolve(directory, name);
			if (!existsSync(command)) continue;
			return {
				command,
				args: [],
				...(process.platform === "win32" && command.endsWith(".cmd")
					? { shell: true }
					: {}),
			};
		}
	}
	return undefined;
}

function writeChildOutput(result) {
	for (const stream of [result.stdout, result.stderr]) {
		if (!stream?.length) continue;
		for (const line of stream.toString().split(/\r?\n/)) {
			if (!line.trim()) continue;
			if (
				FILTERED_INSTALL_OUTPUT_PATTERNS.some((pattern) =>
					pattern.test(line.trim())
				)
			) {
				continue;
			}
			process.stderr.write(`${line}\n`);
		}
	}
}

export function buildSourceRuntimeArchive(
	appRoot,
	{
		force = false,
		heartbeat = () => {},
		spawn = spawnSync,
	} = {},
) {
	const feynmanDir = resolve(appRoot, ".feynman");
	const archivePath = resolve(feynmanDir, "runtime-workspace.tgz");
	const digestPath = resolve(feynmanDir, "runtime-workspace.sha256");
	if (
		!existsSync(resolve(appRoot, ".git")) ||
		!existsSync(resolve(feynmanDir, "runtime-package-lock.json"))
	) {
		return false;
	}
	if (
		!force &&
		existsSync(archivePath) &&
		existsSync(digestPath) &&
		verifyFileSha256(archivePath, digestPath)
	) {
		return false;
	}

	const env = {
		...process.env,
		PATH: getPathWithCurrentNode(),
		npm_config_global: "false",
		NPM_CONFIG_GLOBAL: "false",
		npm_config_location: "project",
		NPM_CONFIG_LOCATION: "project",
	};
	delete env.FEYNMAN_RUNTIME_WORKSPACE_TARGET;
	heartbeat();
	const result = spawn(
		process.execPath,
		[resolve(appRoot, "scripts", "prepare-runtime-workspace.mjs"), "--rebuild"],
		{
			cwd: appRoot,
			stdio: ["ignore", "pipe", "pipe"],
			timeout: RUNTIME_WORKSPACE_PACKAGE_INSTALL_TIMEOUT_MS,
			env,
		},
	);
	heartbeat();
	for (const stream of [result.stdout, result.stderr]) {
		if (stream?.length) process.stderr.write(stream);
	}
	if (result.status !== 0) {
		process.stderr.write(
			"[feynman] failed to build the tracked source runtime archive.\n",
		);
		return false;
	}
	return (
		existsSync(archivePath) &&
		existsSync(digestPath) &&
		verifyFileSha256(archivePath, digestPath)
	);
}

export function installRuntimeWorkspaceFromPackageLock(
	workspaceDir,
	{
		expectedPackageLockSha256,
		heartbeat = () => {},
		invocation = resolveNpmInvocation(),
		spawn = spawnSync,
	} = {},
) {
	const packageLockPath = resolve(workspaceDir, "package-lock.json");
	if (!existsSync(packageLockPath)) return false;
	const packageLockSha256 = computeFileSha256(packageLockPath);
	if (
		expectedPackageLockSha256 !== undefined &&
		expectedPackageLockSha256 !== packageLockSha256
	) {
		process.stderr.write(
			"[feynman] bundled package lock changed before exact restoration.\n",
		);
		return false;
	}
	if (!invocation) {
		process.stderr.write(
			"[feynman] npm is required to restore the exact bundled package lock.\n",
		);
		return false;
	}
	heartbeat();
	const result = spawn(
		invocation.command,
		[
			...invocation.args,
			"ci",
			"--global=false",
			"--location=project",
			"--prefer-offline",
			"--no-audit",
			"--no-fund",
			"--no-dry-run",
			"--legacy-peer-deps",
			"--loglevel",
			"error",
		],
		{
			cwd: workspaceDir,
			shell: invocation.shell,
			stdio: ["ignore", "pipe", "pipe"],
			timeout: RUNTIME_WORKSPACE_PACKAGE_INSTALL_TIMEOUT_MS,
			env: {
				...process.env,
				PATH: getPathWithCurrentNode(),
				npm_config_global: "false",
				NPM_CONFIG_GLOBAL: "false",
				npm_config_location: "project",
				NPM_CONFIG_LOCATION: "project",
				npm_config_dry_run: "false",
				NPM_CONFIG_DRY_RUN: "false",
				npm_config_userconfig: resolve(workspaceDir, ".npmrc"),
				NPM_CONFIG_USERCONFIG: resolve(workspaceDir, ".npmrc"),
			},
		},
	);
	heartbeat();
	writeChildOutput(result);
	if (result.status !== 0) {
		process.stderr.write(
			"[feynman] npm failed while restoring the bundled package lock.\n",
		);
		return false;
	}
	if (computeFileSha256(packageLockPath) !== packageLockSha256) {
		process.stderr.write(
			"[feynman] npm changed the bundled package lock during exact restoration.\n",
		);
		return false;
	}
	if (!existsSync(resolve(workspaceDir, "node_modules"))) {
		process.stderr.write(
			"[feynman] npm did not install the bundled package lock.\n",
		);
		return false;
	}
	return true;
}

export function patchStagedRuntimeWorkspace(
	appRoot,
	workspaceDir,
	{ heartbeat = () => {} } = {},
) {
	heartbeat();
	const result = spawnSync(
		process.execPath,
		[resolve(appRoot, "scripts", "prepare-runtime-workspace.mjs"), "--patch-existing"],
		{
			cwd: appRoot,
			stdio: ["ignore", "pipe", "pipe"],
			timeout: 300000,
			env: {
				...process.env,
				FEYNMAN_RUNTIME_WORKSPACE_TARGET: workspaceDir,
				PATH: getPathWithCurrentNode(),
			},
		},
	);
	heartbeat();
	for (const stream of [result.stdout, result.stderr]) {
		if (stream?.length) process.stderr.write(stream);
	}
	if (result.status !== 0) {
		process.stderr.write(
			"[feynman] failed to apply mandatory runtime patches before publication.\n",
		);
		return false;
	}
	return true;
}
