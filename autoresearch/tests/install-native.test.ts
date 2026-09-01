import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	appendFileSync,
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const appRoot = process.cwd();

function sha256(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

test("native installer verifies checksums and preserves a working install on failure", {
	skip: process.platform === "win32",
}, () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-native-installer-"));
	const releaseRoot = join(root, "release");
	const installRoot = join(root, "install");
	const binRoot = join(root, "bin");
	const home = join(root, "home");
	const version = "9.8.7";
	const platform = process.platform === "darwin" ? "darwin" : "linux";
	const architecture = process.arch === "arm64" ? "arm64" : "x64";
	const bundleName = `feynman-${version}-${platform}-${architecture}`;
	const bundleRoot = join(root, bundleName);
	const archiveName = `${bundleName}.tar.gz`;
	const archivePath = join(releaseRoot, archiveName);
	const installedBundle = join(installRoot, bundleName);

	mkdirSync(bundleRoot, { recursive: true });
	mkdirSync(releaseRoot, { recursive: true });
	mkdirSync(home, { recursive: true });
	const launcher = join(bundleRoot, "feynman");
	writeFileSync(launcher, `#!/bin/sh
case "\${1:-}" in
  --version) printf '%s\\n' "${version}" ;;
  --help) printf '%s\\n' "Feynman test help" ;;
  *) printf '%s\\n' "Feynman test" ;;
esac
`);
	chmodSync(launcher, 0o755);
	assert.equal(spawnSync("tar", ["-czf", archivePath, "-C", root, bundleName]).status, 0);
	writeFileSync(join(releaseRoot, "SHA256SUMS"), `${sha256(archivePath)}  ${archiveName}\n`);

	const env = {
		...process.env,
		HOME: home,
		FEYNMAN_INSTALL_APP_DIR: installRoot,
		FEYNMAN_INSTALL_BIN_DIR: binRoot,
		FEYNMAN_INSTALL_BASE_URL: pathToFileURL(releaseRoot).href.replace(/\/$/, ""),
		FEYNMAN_INSTALL_SKIP_PATH_UPDATE: "1",
	};
	const install = () => spawnSync(
		"sh",
		[join(appRoot, "scripts", "install", "install.sh"), version],
		{ cwd: appRoot, env, encoding: "utf8" },
	);

	const first = install();
	assert.equal(first.status, 0, first.stderr);
	assert.equal(existsSync(join(binRoot, "feynman")), true);
	assert.equal(existsSync(installedBundle), true);

	const replacementSentinel = join(installedBundle, "replace-me.sentinel");
	writeFileSync(replacementSentinel, "remove me\n");
	const obsoleteBundle = join(installRoot, "feynman-1.0.0-old");
	mkdirSync(obsoleteBundle, { recursive: true });
	const replacement = install();
	assert.equal(replacement.status, 0, replacement.stderr);
		assert.equal(existsSync(replacementSentinel), false);
		assert.equal(existsSync(obsoleteBundle), false);

		const duplicateSentinel = join(installedBundle, "duplicate-checksum-must-preserve.sentinel");
		writeFileSync(duplicateSentinel, "keep me\n");
		const validChecksum = sha256(archivePath);
		for (const checksumLines of [
			`${validChecksum}  ${archiveName}\n${"0".repeat(64)}  ${archiveName}\n`,
			`${"0".repeat(64)}  ${archiveName}\n${validChecksum}  ${archiveName}\n`,
		]) {
			writeFileSync(join(releaseRoot, "SHA256SUMS"), checksumLines);
			const duplicateRejected = install();
			assert.notEqual(duplicateRejected.status, 0);
			assert.match(duplicateRejected.stderr, /multiple checksum entries/);
			assert.equal(existsSync(duplicateSentinel), true);
		}

		const preservedSentinel = join(installedBundle, "preserve-me.sentinel");
		writeFileSync(preservedSentinel, "keep me\n");
		writeFileSync(join(releaseRoot, "SHA256SUMS"), `${validChecksum}  ${archiveName}\n`);
		appendFileSync(archivePath, "corrupt");
	const rejected = install();
	assert.notEqual(rejected.status, 0);
	assert.match(rejected.stderr, /SHA-256 mismatch/);
	assert.equal(existsSync(preservedSentinel), true);
});
