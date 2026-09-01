import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("Windows installer extracts into staging before replacing installed bundle", () => {
	const installer = readFileSync(resolve(appRoot, "scripts", "install", "install.ps1"), "utf8");

	assert.match(installer, /function Mount-ShortStagingDrive/);
	assert.match(installer, /& subst\.exe \$drive \$TargetPath/);
	assert.match(
		installer,
		/\$stagingPhysicalRoot = New-SameVolumeStagingRoot -InstallRoot \$installRoot/,
	);
	assert.match(installer, /\$shortStagingRoot = Mount-ShortStagingDrive -TargetPath \$stagingPhysicalRoot/);
	assert.match(installer, /\$extractRoot = Join-Path \$shortStagingRoot "extract"/);
	assert.match(installer, /\$env:TEMP = \$shortTempRoot/);
	assert.match(installer, /\$env:TMP = \$shortTempRoot/);
	assert.match(installer, /\$extractedBundleDir = Join-Path \$extractRoot \$bundleName/);
	assert.match(installer, /\$extractedBundlePhysicalDir = Join-Path \$physicalExtractRoot \$bundleName/);
	assert.match(installer, /Add-Type -AssemblyName System\.IO\.Compression\.FileSystem/);
	assert.match(
		installer,
		/\[System\.IO\.Compression\.ZipFile\]::ExtractToDirectory\(\$archivePath, \$extractRoot\)/,
	);
	assert.match(installer, /Downloaded archive did not contain the expected \$bundleName directory/);
	assert.match(installer, /Get-FileHash -LiteralPath \$archivePath -Algorithm SHA256/);
	assert.match(installer, /SHA-256 mismatch/);
	assert.match(installer, /SHA256SUMS contains multiple checksum entries/);
	assert.equal((installer.match(/Invoke-WebRequest/g) ?? []).length, 3);
	assert.equal((installer.match(/-UseBasicParsing/g) ?? []).length, 3);
	assert.match(installer, /\$backupBundleDir = Join-Path \$stagingPhysicalRoot "previous-bundle"/);
	assert.match(installer, /\$backupBinDir = Join-Path \$stagingPhysicalRoot "previous-bin"/);
	assert.match(installer, /FEYNMAN_INSTALL_TEST_FAIL_AFTER_BUNDLE_BACKUP/);
	assert.match(installer, /Move-Item -LiteralPath \$installBinDir -Destination \$backupBinDir/);
	assert.match(installer, /Move-Item -LiteralPath \$stagedBinPhysicalDir -Destination \$installBinDir/);
	assert.match(installer, /FEYNMAN_INSTALL_TEST_FAIL_AFTER_BUNDLE_SWAP/);
	assert.match(installer, /Move-Item -LiteralPath \$extractedBundlePhysicalDir -Destination \$bundleDir/);
	assert.match(installer, /\$candidatePs1 = Join-Path \$extractedBundleDir "feynman\.ps1"/);
	assert.match(
		installer,
		/& \$powerShellExecutable -NoProfile -ExecutionPolicy Bypass -File \$candidatePs1 --version/,
	);
	assert.doesNotMatch(installer, /@\(& \$candidate --version 2>&1\)/);
	assert.match(installer, /"ARM64" \{ return "x64" \}/);
	assert.match(installer, /"Arm64" \{ return "x64" \}/);
	assert.doesNotMatch(installer, /\$shimPs1Candidate/);
	assert.doesNotMatch(installer, /Join-Path \$stagedBinDir "feynman\.ps1"/);
	assert.match(installer, /Install only the CMD shim on PATH/);
	assert.doesNotMatch(installer, /\$resolvedCommand\.Source -ne \$shimPath/);
	assert.doesNotMatch(installer, /Move-Item -LiteralPath \$shimCandidate -Destination \$shimPath/);
	assert.doesNotMatch(installer, /Expand-Archive/);
	assert.match(installer, /Dismount-ShortStagingDrive -DriveRoot \$shortStagingRoot/);
	assert.match(installer, /Restore-ProcessEnvironmentVariable -Name "TEMP"/);
	assert.match(installer, /Restore-ProcessEnvironmentVariable -Name "TMP"/);
	assert.match(installer, /Installer cleanup also failed/);
});

test("website Windows installer stays synced with the packaged installer", () => {
	const installer = readFileSync(resolve(appRoot, "scripts", "install", "install.ps1"), "utf8");
	const websiteInstaller = readFileSync(resolve(appRoot, "website", "public", "install.ps1"), "utf8");

	assert.equal(websiteInstaller, installer);
});

test("Windows installer verifier defines every strict-mode install path", () => {
	const verifier = readFileSync(resolve(appRoot, "scripts", "verify-windows-installer.ps1"), "utf8");

	assert.match(verifier, /Set-StrictMode -Version 2\.0/);
	assert.match(verifier, /\$installBinDir = Join-Path \$installRoot "bin"/);
	assert.match(verifier, /\$env:PATH = "\$installBinDir;\$env:PATH"/);
	assert.match(verifier, /-ExecutionPolicy Restricted/);
	assert.match(verifier, /PATH bin must not contain a policy-blocked feynman\.ps1 shim/);
	assert.match(verifier, /\$servedArchive = Join-Path \$testRoot \$archiveName/);
	assert.match(verifier, /\$env:TEMP = \$longTempRoot/);
	assert.match(verifier, /\$env:TMP = \$longTempRoot/);
	assert.match(verifier, /Mount-OccupiedTestDrive -TargetPath \$testRoot/);
	assert.match(verifier, /Assert-NoInstallerStagingLeaks/);
	assert.match(verifier, /short-drive Windows MAX_PATH safety budget/);
	assert.match(verifier, /getRecursionDetectionPlugin\.browser\.js/);
	assert.doesNotMatch(verifier, /\$reportedAwsEntryName\.Length -ne \d+/);
	assert.match(verifier, /\$maximumExtractedPathLength = 259/);
	assert.match(verifier, /\$maximumArchiveEntryLength =/);
	assert.match(verifier, /\$longFixtureExtractedPathLength -ne \$maximumExtractedPathLength/);
	assert.match(verifier, /Successful compact replacement did not install the reported AWS fixture entry/);
	assert.match(verifier, /Successful compact replacement did not install the MAX_PATH boundary fixture entry/);
	assert.match(verifier, /Exact-candidate replacement retained the old bundle/);
	assert.match(verifier, /\$fixtureRoot = Join-Path \$testRoot "compact-fixture"/);
	assert.match(verifier, /const body = readFileSync\(source\);/);
	assert.match(verifier, /response\.end\(request\.method === "HEAD" \? undefined : body\);/);
	assert.match(verifier, /createReadStream\(source\)\.pipe\(response\);/);
	assert.match(
		verifier,
		/\[System\.IO\.Compression\.ZipFile\]::CreateFromDirectory\(\$fixtureRoot, \$fixtureArchive\)/,
	);
	assert.match(verifier, /Copy-Item -LiteralPath \$fixtureArchive -Destination \$servedArchive -Force/);
	assert.doesNotMatch(verifier, /for \(\$pass = 1; \$pass -le 2;/);
});
