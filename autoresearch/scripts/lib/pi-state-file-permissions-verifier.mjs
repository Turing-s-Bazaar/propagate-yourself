import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function resolvePiPackageRoot(nodeModulesRoot) {
	for (const scope of ["@earendil-works", "@mariozechner"]) {
		const packageRoot = resolve(nodeModulesRoot, scope, "pi-coding-agent");
		if (existsSync(resolve(packageRoot, "dist", "core", "auth-storage.js"))) {
			return packageRoot;
		}
	}
	throw new Error(`Installed Pi package is missing under ${nodeModulesRoot}`);
}

function runWindowsCommand(command, args) {
	return execFileSync(
		command,
		args,
		{ encoding: "utf8", windowsHide: true },
	).trim();
}

function applyManagedWindowsAcl(path) {
	const identity = runWindowsCommand("whoami.exe", []);
	runWindowsCommand("icacls.exe", [
		path,
		"/inheritance:r",
		"/grant:r",
		`${identity}:(F)`,
	]);
}

function readWindowsAcl(path) {
	return runWindowsCommand("icacls.exe", [path]);
}

function prepareManagedFile(path, source, mode) {
	writeFileSync(path, source, "utf8");
	if (process.platform === "win32") {
		applyManagedWindowsAcl(path);
		return readWindowsAcl(path);
	}
	chmodSync(path, mode);
	return mode;
}

function assertManagedFileState(path, expected, label) {
	if (process.platform === "win32") {
		assert.equal(readWindowsAcl(path), expected, `${label} changed its managed ACL`);
		return;
	}
	assert.equal(statSync(path).mode & 0o777, expected, `${label} changed its managed mode`);
}

async function verifyPiPackageStateFilePermissions(piPackageRoot, label) {
	const root = mkdtempSync(join(tmpdir(), "feynman-installed-pi-state-"));
	const authPath = join(root, "auth.json");
	const modelsPath = join(root, "models-store.json");
	try {
		const authModule = await import(
			`${pathToFileURL(resolve(piPackageRoot, "dist", "core", "auth-storage.js")).href}?state-permissions=${Date.now()}`
		);
		const modelsModule = await import(
			`${pathToFileURL(resolve(piPackageRoot, "dist", "core", "models-store.js")).href}?state-permissions=${Date.now()}`
		);
		if (process.platform !== "win32") {
			const freshPath = join(root, "fresh-auth.json");
			authModule.AuthStorage.create(freshPath);
			assert.equal(
				statSync(freshPath).mode & 0o777,
				0o600,
				`${label} did not create auth state with mode 0600`,
			);
		}

		const authState = prepareManagedFile(
			authPath,
			JSON.stringify({ anthropic: { type: "api_key", key: "old" } }),
			0o660,
		);
		const auth = authModule.AuthStorage.create(authPath);
		await auth.modify("anthropic", async () => ({
			type: "api_key",
			key: "new",
		}));
		assertManagedFileState(authPath, authState, `${label} auth.json`);

		const modelsState = prepareManagedFile(modelsPath, "{}", 0o640);
		const models = new modelsModule.FileModelsStore(modelsPath);
		await models.write("test", { models: [], checkedAt: Date.now() });
		assertManagedFileState(modelsPath, modelsState, `${label} models-store.json`);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

export async function verifyInstalledPiStateFilePermissions(packageRoot) {
	await verifyPiPackageStateFilePermissions(
		resolvePiPackageRoot(resolve(packageRoot, "node_modules")),
		"installed Pi",
	);

	const runtimeArchivePath = resolve(
		packageRoot,
		".feynman",
		"runtime-workspace.tgz",
	);
	if (!existsSync(runtimeArchivePath)) {
		let embeddedRuntimePiRoot;
		try {
			embeddedRuntimePiRoot = resolvePiPackageRoot(
				resolve(packageRoot, ".feynman", "npm", "node_modules"),
			);
		} catch (error) {
			throw new Error(
				`Installed Feynman is missing both its runtime archive and extracted Pi runtime: ${error.message}`,
				{ cause: error },
			);
		}
		await verifyPiPackageStateFilePermissions(
			embeddedRuntimePiRoot,
			"embedded runtime Pi",
		);
		return process.platform === "win32"
			? "managed-acls-preserved"
			: "fresh-0600-managed-modes-preserved";
	}

	const runtimeArchiveRoot = resolve(packageRoot, ".feynman");
	const extractionRoot = mkdtempSync(
		join(runtimeArchiveRoot, ".state-verification-"),
	);
	try {
		const extraction = spawnSync(
			"tar",
			["-xzf", "runtime-workspace.tgz", "-C", basename(extractionRoot)],
			{
				// Keep both paths relative on Windows. GNU tar treats absolute
				// drive-letter paths as remote host specifications, and the OS temp
				// directory may be on a different drive from the installed package.
				cwd: runtimeArchiveRoot,
				encoding: "utf8",
				stdio: ["ignore", "ignore", "pipe"],
				timeout: 300_000,
			},
		);
		if (extraction.error || extraction.signal || extraction.status !== 0) {
			throw new Error(
				`Could not extract restored Pi runtime for state-file verification: ${extraction.error?.message || extraction.stderr || `status ${extraction.status} signal ${extraction.signal}`}`,
				{ cause: extraction.error },
			);
		}
		let restoredPiRoot;
		try {
			restoredPiRoot = resolvePiPackageRoot(
				resolve(extractionRoot, "npm", "node_modules"),
			);
		} catch (error) {
			throw new Error(
				`Could not restore Pi runtime for state-file verification: ${extraction.error?.message ?? extraction.stderr ?? error.message}`,
				{ cause: error },
			);
		}
		await verifyPiPackageStateFilePermissions(
			restoredPiRoot,
			"restored runtime Pi",
		);
	} finally {
		rmSync(extractionRoot, { recursive: true, force: true });
	}

	return process.platform === "win32"
		? "managed-acls-preserved"
		: "fresh-0600-managed-modes-preserved";
}
