import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import test from "node:test";

import {
	verifyLiteparseManifestContract,
	verifyLiteparseRootManifestContract,
	verifyLiteparseRootLockContract,
	verifyLiteparseRuntimeLockContract,
} from "../scripts/lib/liteparse-release-contract.mjs";

const require = createRequire(import.meta.url);
const LITEPARSE_GIT_HEAD = "b75603d44027cc70c44a9d9f9f20458c93fd37a7";
const LITEPARSE_VERSION = "2.14.0";
const LITEPARSE_INTEGRITY =
	"sha512-lIFBbTRs87Bpp45Lm986hUDEPndm85pT9l/BM1dtWhQs0zTLEkpHLrgbOxGG2rjBqDgJM5fdChT8LWUd4ZThWA==";
const NATIVE_INTEGRITIES: Record<string, string> = {
	"@llamaindex/liteparse-darwin-arm64":
		"sha512-waYoHguqomVv43KEEqNf6nWSrpfMnNC8LXRtgN+a7F/WwICfNzrgA5Z8ayj2jhvvpYv7tsJ25M1vl8bb0i5UlA==",
	"@llamaindex/liteparse-darwin-x64":
		"sha512-akTk/e6eEHgeP14f+8QiqueiEjiHTutX03XxRizXNn2aoTtQCEfElN4/p0rwTSFq35E76N7/z3ZVP5l1h4G4pw==",
	"@llamaindex/liteparse-linux-arm64-gnu":
		"sha512-svIeleEBGQTAgeWaTySUgzba3rsEUGNaDN11B6wGvDjAyI59R/JkhM1+a7TP3T19v8+Ik+F/nzTz/AB6xJxQIA==",
	"@llamaindex/liteparse-linux-x64-gnu":
		"sha512-UQTedZ9FJJ59pk4fFxBF6rPOoPssRf9580kCT1IkDowUavcAUMygfn3gtxfMtEOCTHsGpPHXLGmd5ICZOzmRbg==",
	"@llamaindex/liteparse-linux-x64-musl":
		"sha512-3Od2QCu68nDzvTE9rSNvMmAq1VkMwY94I/38ZwQqONdqGnBYCTKpBaMR2guxcky8Pn4sKVnILHwUgqb8jnLvTw==",
	"@llamaindex/liteparse-win32-arm64-msvc":
		"sha512-TRQh4pPdL2B34ihxYdDsxFgruk+u3opc+Spq6VMr/gwo+ASmEhVTxgnz/2RDEIlleXNYnxMCPI1LVyKiZgGn0w==",
	"@llamaindex/liteparse-win32-x64-msvc":
		"sha512-bv7T2/l9S4x2Cf66MlFK647yHyNVfeNmeJt+8YHcuG1KbBLwCO47brQdbetqw3+UJKCr4usEc8rt8+Kl1LvnVA==",
};
const FAKE_NATIVE_PACKAGE = "@llamaindex/liteparse-freebsd-x64";
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function nativeLiteParsePackage() {
	if (process.platform === "darwin" && process.arch === "arm64") {
		return "@llamaindex/liteparse-darwin-arm64";
	}
	if (process.platform === "darwin" && process.arch === "x64") {
		return "@llamaindex/liteparse-darwin-x64";
	}
	if (process.platform === "linux" && process.arch === "arm64") {
		return "@llamaindex/liteparse-linux-arm64-gnu";
	}
	if (process.platform === "linux" && process.arch === "x64") {
		const report = process.report?.getReport() as {
			header?: { glibcVersionRuntime?: string };
		};
		return report?.header?.glibcVersionRuntime
			? "@llamaindex/liteparse-linux-x64-gnu"
			: "@llamaindex/liteparse-linux-x64-musl";
	}
	if (process.platform === "win32" && process.arch === "arm64") {
		return "@llamaindex/liteparse-win32-arm64-msvc";
	}
	if (process.platform === "win32" && process.arch === "x64") {
		return "@llamaindex/liteparse-win32-x64-msvc";
	}
	throw new Error(`Unsupported LiteParse test platform: ${process.platform}-${process.arch}`);
}

function createTwoPagePdf() {
	const pageTexts = ["LiteParse 2.14 page one", "LiteParse 2.14 page two"];
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		"",
		"",
	];
	for (let index = 0; index < pageTexts.length; index += 1) {
		const content = `BT\n/F1 18 Tf\n0 g\n36 320 Td\n(${pageTexts[index]}) Tj\nET\n`;
		objects[5 + index] = `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}endstream`;
	}
	let source = "%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n";
	const offsets = [0];
	for (let index = 0; index < objects.length; index += 1) {
		offsets.push(Buffer.byteLength(source, "latin1"));
		source += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
	}
	const xrefOffset = Buffer.byteLength(source, "latin1");
	source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets.slice(1)) {
		source += `${String(offset).padStart(10, "0")} 00000 n \n`;
	}
	source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
	return Buffer.from(source, "latin1");
}

function loadNativeLiteParse() {
	const packageName = nativeLiteParsePackage();
	const manifest = require(`${packageName}/package.json`) as { version?: string };
	assert.equal(manifest.version, LITEPARSE_VERSION, `${packageName} is not ${LITEPARSE_VERSION}`);
	const nativeModule = require(packageName);
	const LiteParse = nativeModule.LiteParse ?? nativeModule.default?.LiteParse;
	assert.equal(typeof LiteParse, "function", `${packageName} has no LiteParse`);
	return LiteParse;
}

test("LiteParse 2.14 release identity and all native locks are exact", () => {
	const manifest = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
		optionalDependencies?: Record<string, string>;
	};
	const lock = JSON.parse(readFileSync(resolve("package-lock.json"), "utf8")) as {
		packages?: Record<
			string,
			{
				integrity?: string;
				optional?: boolean;
				optionalDependencies?: Record<string, string>;
				resolved?: string;
				version?: string;
			}
		>;
	};
	for (const [packageName, integrity] of Object.entries(NATIVE_INTEGRITIES)) {
		assert.equal(manifest.optionalDependencies?.[packageName], LITEPARSE_VERSION);
		assert.equal(
			lock.packages?.[""]?.optionalDependencies?.[packageName],
			LITEPARSE_VERSION,
		);
		assert.deepEqual(
			{
				version: lock.packages?.[`node_modules/${packageName}`]?.version,
				resolved: lock.packages?.[`node_modules/${packageName}`]?.resolved,
				integrity: lock.packages?.[`node_modules/${packageName}`]?.integrity,
				optional: lock.packages?.[`node_modules/${packageName}`]?.optional,
			},
			{
				version: LITEPARSE_VERSION,
				resolved: `https://registry.npmjs.org/${packageName}/-/${packageName.slice("@llamaindex/".length)}-${LITEPARSE_VERSION}.tgz`,
				integrity,
				optional: true,
			},
		);
	}

	const artifactVerifier = readFileSync(resolve("scripts/verify-package-artifact.mjs"), "utf8");
	const releaseContract = readFileSync(
		resolve("scripts/lib/liteparse-release-contract.mjs"),
		"utf8",
	);
	const installedVerifier = readFileSync(
		resolve("scripts/verify-installed-docparser.mjs"),
		"utf8",
	);
	assert.match(artifactVerifier, /from "\.\/lib\/liteparse-release-contract\.mjs"/);
	assert.match(releaseContract, new RegExp(LITEPARSE_GIT_HEAD));
	assert.match(releaseContract, new RegExp(LITEPARSE_INTEGRITY.replaceAll("+", "\\+")));
	assert.match(installedVerifier, /EXPECTED_PI_DOCPARSER_VERSION = "4\.0\.0"/);
	assert.match(installedVerifier, /EXPECTED_LITEPARSE_VERSION = "2\.14\.0"/);
	for (const packageName of Object.keys(NATIVE_INTEGRITIES)) {
		assert.match(installedVerifier, new RegExp(packageName.replace("/", "\\/")));
	}

	const fail = (message: string): never => {
		throw new Error(message);
	};
	assert.doesNotThrow(() => verifyLiteparseRootManifestContract(manifest, fail));
	assert.doesNotThrow(() => verifyLiteparseRootLockContract(lock, fail));
	const runtimeLock = JSON.parse(
		readFileSync(resolve(".feynman/runtime-package-lock.json"), "utf8"),
	);
	assert.doesNotThrow(() => verifyLiteparseRuntimeLockContract(runtimeLock, fail));
	assert.doesNotThrow(() =>
		verifyLiteparseManifestContract(
			runtimeLock.packages["node_modules/@llamaindex/liteparse"],
			fail,
			"runtime",
		),
	);
	const mutatedRuntimeLock = structuredClone(runtimeLock);
	Object.assign(
		mutatedRuntimeLock.packages["node_modules/@llamaindex/liteparse-win32-x64-msvc"],
		{
			version: "9.9.9",
			resolved: "https://packages.example.invalid/foreign.tgz",
			integrity: "sha512-foreign",
		},
	);
	assert.throws(
		() => verifyLiteparseRuntimeLockContract(mutatedRuntimeLock, fail),
		/liteparse-win32-x64-msvc@2\.14\.0/,
	);
});

test("LiteParse contracts reject missing or extra native package sets", () => {
	const manifest = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
	const lock = JSON.parse(readFileSync(resolve("package-lock.json"), "utf8"));
	const runtimeLock = JSON.parse(
		readFileSync(resolve(".feynman/runtime-package-lock.json"), "utf8"),
	);
	const fail = (message: string): never => {
		throw new Error(message);
	};
	const expectedSetFailure = /exactly the reviewed seven native/;
	const nativePackages = Object.keys(NATIVE_INTEGRITIES);
	const nativePackage = nativePackages[0];

	const rootManifestWithExtra = structuredClone(manifest);
	rootManifestWithExtra.optionalDependencies[FAKE_NATIVE_PACKAGE] = LITEPARSE_VERSION;
	assert.throws(
		() => verifyLiteparseRootManifestContract(rootManifestWithExtra, fail),
		expectedSetFailure,
	);
	const rootManifestMissingNative = structuredClone(manifest);
	delete rootManifestMissingNative.optionalDependencies[nativePackage];
	assert.throws(
		() => verifyLiteparseRootManifestContract(rootManifestMissingNative, fail),
		expectedSetFailure,
	);
	for (const packageName of nativePackages) {
		const rootManifestWithVersionDrift = structuredClone(manifest);
		rootManifestWithVersionDrift.optionalDependencies[packageName] = "9.9.9";
		assert.throws(
			() => verifyLiteparseRootManifestContract(rootManifestWithVersionDrift, fail),
			new RegExp(`${packageName}.*${LITEPARSE_VERSION}`),
			`package.json accepted version drift for ${packageName}`,
		);
	}

	const rootLockWithExtra = structuredClone(lock);
	rootLockWithExtra.packages[""].optionalDependencies[FAKE_NATIVE_PACKAGE] =
		LITEPARSE_VERSION;
	rootLockWithExtra.packages[`node_modules/${FAKE_NATIVE_PACKAGE}`] = {
		version: LITEPARSE_VERSION,
		optional: true,
	};
	assert.throws(
		() => verifyLiteparseRootLockContract(rootLockWithExtra, fail),
		expectedSetFailure,
	);
	const rootLockWithOrphanExtra = structuredClone(lock);
	rootLockWithOrphanExtra.packages[`node_modules/${FAKE_NATIVE_PACKAGE}`] = {
		version: LITEPARSE_VERSION,
		optional: true,
	};
	assert.throws(
		() => verifyLiteparseRootLockContract(rootLockWithOrphanExtra, fail),
		expectedSetFailure,
	);
	const rootLockWithNestedExtra = structuredClone(lock);
	rootLockWithNestedExtra.packages[
		`node_modules/pi-docparser/node_modules/${FAKE_NATIVE_PACKAGE}`
	] = {
		version: LITEPARSE_VERSION,
		optional: true,
	};
	assert.throws(
		() => verifyLiteparseRootLockContract(rootLockWithNestedExtra, fail),
		expectedSetFailure,
	);
	const rootLockWithNestedExtraParent = structuredClone(lock);
	rootLockWithNestedExtraParent.packages[
		`node_modules/${FAKE_NATIVE_PACKAGE}/node_modules/commander`
	] = {
		version: "12.1.0",
	};
	assert.throws(
		() => verifyLiteparseRootLockContract(rootLockWithNestedExtraParent, fail),
		expectedSetFailure,
	);
	const rootLockMissingNative = structuredClone(lock);
	delete rootLockMissingNative.packages[""].optionalDependencies[nativePackage];
	delete rootLockMissingNative.packages[`node_modules/${nativePackage}`];
	assert.throws(
		() => verifyLiteparseRootLockContract(rootLockMissingNative, fail),
		expectedSetFailure,
	);
	for (const packageName of nativePackages) {
		const rootLockWithRequestedVersionDrift = structuredClone(lock);
		rootLockWithRequestedVersionDrift.packages[""].optionalDependencies[
			packageName
		] = "9.9.9";
		assert.throws(
			() => verifyLiteparseRootLockContract(rootLockWithRequestedVersionDrift, fail),
			new RegExp(`${packageName}.*${LITEPARSE_VERSION}`),
			`package-lock.json accepted requested version drift for ${packageName}`,
		);
	}

	const nativeEntryDrift = {
		version: "9.9.9",
		resolved: "https://packages.example.invalid/native.tgz",
		integrity: "sha512-foreign",
		optional: false,
		cpu: ["foreign"],
		os: ["foreign"],
	};
	for (const packageName of nativePackages) {
		for (const [field, replacement] of Object.entries(nativeEntryDrift)) {
			const rootLockWithNativeIdentityDrift = structuredClone(lock);
			rootLockWithNativeIdentityDrift.packages[
				`node_modules/${packageName}`
			][field] = replacement;
			assert.throws(
				() =>
					verifyLiteparseRootLockContract(
						rootLockWithNativeIdentityDrift,
						fail,
					),
				new RegExp(`${packageName}.*${LITEPARSE_VERSION}`),
				`package-lock.json accepted ${field} drift for ${packageName}`,
			);
		}
		const rootLockWithNativeLibcDrift = structuredClone(lock);
		const nativeEntry =
			rootLockWithNativeLibcDrift.packages[`node_modules/${packageName}`];
		nativeEntry.libc = nativeEntry.libc ? ["foreign"] : ["glibc"];
		assert.throws(
			() => verifyLiteparseRootLockContract(rootLockWithNativeLibcDrift, fail),
			new RegExp(`${packageName}.*${LITEPARSE_VERSION}`),
			`package-lock.json accepted libc drift for ${packageName}`,
		);
	}

	const genericManifestWithExtra = structuredClone(
		runtimeLock.packages["node_modules/@llamaindex/liteparse"],
	);
	genericManifestWithExtra.optionalDependencies[FAKE_NATIVE_PACKAGE] =
		LITEPARSE_VERSION;
	assert.throws(
		() => verifyLiteparseManifestContract(genericManifestWithExtra, fail, "runtime"),
		expectedSetFailure,
	);
	const genericManifestMissingNative = structuredClone(
		runtimeLock.packages["node_modules/@llamaindex/liteparse"],
	);
	delete genericManifestMissingNative.optionalDependencies[nativePackage];
	assert.throws(
		() => verifyLiteparseManifestContract(genericManifestMissingNative, fail, "runtime"),
		expectedSetFailure,
	);

	const runtimeLockWithOrphanExtra = structuredClone(runtimeLock);
	runtimeLockWithOrphanExtra.packages[`node_modules/${FAKE_NATIVE_PACKAGE}`] = {
		version: LITEPARSE_VERSION,
		optional: true,
	};
	assert.throws(
		() => verifyLiteparseRuntimeLockContract(runtimeLockWithOrphanExtra, fail),
		expectedSetFailure,
	);
});

test("0.3.44 release notes explain the LiteParse document-research upgrade", () => {
	for (const path of [
		resolve("RELEASES.md"),
		resolve("website/src/content/docs/reference/releases.md"),
	]) {
		const releases = readFileSync(path, "utf8");
		const currentRelease =
			releases.match(/## v0\.3\.44[\s\S]*?(?=\n## v0\.3\.43)/)?.[0] ?? "";
		assert.match(currentRelease, /LiteParse runtime to `2\.14\.0`/);
		assert.match(currentRelease, /OCR rasterization.*bounded worker-sized rounds/i);
		assert.match(currentRelease, /quadratic work/i);
	}
});

test("LiteParse 2.14 parses both pages and renders PNG screenshots", async () => {
	const LiteParse = loadNativeLiteParse();
	const pdf = createTwoPagePdf();
	const parser = new LiteParse({
		ocrEnabled: false,
		extractScreenshots: true,
		dpi: 72,
		outputFormat: "json",
		quiet: true,
	});
	const result = await parser.parse(pdf);
	assert.equal(result.totalPages, 2);
	assert.equal(result.pages.length, 2);
	assert.match(result.pages[0].text, /LiteParse 2\.14 page one/);
	assert.match(result.pages[1].text, /LiteParse 2\.14 page two/);
	assert.equal(result.screenshots.length, 2);

	const screenshots = await parser.screenshot(pdf, [1, 2]);
	assert.equal(screenshots.length, 2);
	for (const [index, screenshot] of screenshots.entries()) {
		assert.equal(screenshot.pageNum, index + 1);
		assert.ok(screenshot.imageBuffer.byteLength > PNG_SIGNATURE.byteLength);
		assert.deepEqual(
			Buffer.from(screenshot.imageBuffer).subarray(0, PNG_SIGNATURE.byteLength),
			PNG_SIGNATURE,
		);
	}
});

test("LiteParse 2.14 bounds bbox dedup work on a 20k-item ribbon page", { timeout: 20_000 }, () => {
	const LiteParse = loadNativeLiteParse();
	const parser = new LiteParse({
		ocrEnabled: false,
		outputFormat: "json",
		quiet: true,
	});
	const itemCount = 20_000;
	const startedAt = performance.now();
	const result = parser.parsePages([
		{
			pageNumber: 1,
			pageWidth: 400,
			pageHeight: itemCount * 8 + 20,
			textItems: Array.from({ length: itemCount }, (_, index) => ({
				text: `cell-${index % 101}`,
				x: 10 + (index % 8) * 40,
				y: 10 + index * 8,
				width: 30,
				height: 6,
				fontName: "Helvetica",
				fontSize: 5,
				fontHeight: 5,
				fontWeight: 400,
				words: [],
			})),
		},
	]);
	const elapsedMs = performance.now() - startedAt;
	assert.equal(result.pages.length, 1);
	assert.equal(result.pages[0].textItems.length, itemCount);
	assert.ok(elapsedMs < 15_000, `20k-item bbox stress took ${elapsedMs.toFixed(1)}ms`);
});
