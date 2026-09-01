export const FEYNMAN_LITEPARSE_GIT_HEAD =
	"b75603d44027cc70c44a9d9f9f20458c93fd37a7";
export const FEYNMAN_LITEPARSE_VERSION = "2.14.0";
export const FEYNMAN_LITEPARSE_INTEGRITY =
	"sha512-lIFBbTRs87Bpp45Lm986hUDEPndm85pT9l/BM1dtWhQs0zTLEkpHLrgbOxGG2rjBqDgJM5fdChT8LWUd4ZThWA==";
export const FEYNMAN_LITEPARSE_NATIVE_INTEGRITIES = Object.freeze({
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
});
export const FEYNMAN_LITEPARSE_NATIVE_PACKAGES = Object.freeze(
	Object.keys(FEYNMAN_LITEPARSE_NATIVE_INTEGRITIES),
);
export const FEYNMAN_LITEPARSE_NATIVE_PLATFORMS = Object.freeze({
	"@llamaindex/liteparse-darwin-arm64": { cpu: ["arm64"], os: ["darwin"] },
	"@llamaindex/liteparse-darwin-x64": { cpu: ["x64"], os: ["darwin"] },
	"@llamaindex/liteparse-linux-arm64-gnu": {
		cpu: ["arm64"],
		os: ["linux"],
		libc: ["glibc"],
	},
	"@llamaindex/liteparse-linux-x64-gnu": {
		cpu: ["x64"],
		os: ["linux"],
		libc: ["glibc"],
	},
	"@llamaindex/liteparse-linux-x64-musl": {
		cpu: ["x64"],
		os: ["linux"],
		libc: ["musl"],
	},
	"@llamaindex/liteparse-win32-arm64-msvc": { cpu: ["arm64"], os: ["win32"] },
	"@llamaindex/liteparse-win32-x64-msvc": { cpu: ["x64"], os: ["win32"] },
});

const LITEPARSE_NATIVE_PACKAGE_PREFIX = "@llamaindex/liteparse-";
const LOCK_PACKAGE_PREFIX = "node_modules/";
const EXPECTED_NATIVE_PACKAGES = FEYNMAN_LITEPARSE_NATIVE_PACKAGES.toSorted();
const EXPECTED_LITEPARSE_URL =
	`https://registry.npmjs.org/@llamaindex/liteparse/-/liteparse-${FEYNMAN_LITEPARSE_VERSION}.tgz`;

function lockPackageNames(packagePath) {
	const normalizedPath = packagePath.startsWith(LOCK_PACKAGE_PREFIX)
		? packagePath.slice(LOCK_PACKAGE_PREFIX.length)
		: packagePath;
	return normalizedPath === "" ? [] : normalizedPath.split(`/${LOCK_PACKAGE_PREFIX}`);
}

function verifyLiteparseNativeOptionalDependencies(manifest, fail, label) {
	const nativePackages = Object.keys(manifest?.optionalDependencies ?? {})
		.filter((packageName) => packageName.startsWith(LITEPARSE_NATIVE_PACKAGE_PREFIX))
		.sort();
	if (JSON.stringify(nativePackages) !== JSON.stringify(EXPECTED_NATIVE_PACKAGES)) {
		fail(`${label} LiteParse does not declare exactly the reviewed seven native packages`);
	}
	for (const packageName of FEYNMAN_LITEPARSE_NATIVE_PACKAGES) {
		if (manifest?.optionalDependencies?.[packageName] !== FEYNMAN_LITEPARSE_VERSION) {
			fail(`${label} LiteParse optional package ${packageName} is not ${FEYNMAN_LITEPARSE_VERSION}`);
		}
	}
}

function verifyLiteparseNativeLockEntries(lock, fail, label) {
	const nativePackages = Object.keys(lock.packages ?? {})
		.flatMap(lockPackageNames)
		.filter((packageName) => packageName.startsWith(LITEPARSE_NATIVE_PACKAGE_PREFIX))
		.sort();
	if (JSON.stringify(nativePackages) !== JSON.stringify(EXPECTED_NATIVE_PACKAGES)) {
		fail(`${label} does not lock exactly the reviewed seven native LiteParse packages`);
	}
	for (const packageName of FEYNMAN_LITEPARSE_NATIVE_PACKAGES) {
		const entry = lock.packages?.[`node_modules/${packageName}`];
		const platform = FEYNMAN_LITEPARSE_NATIVE_PLATFORMS[packageName];
		if (
			entry?.version !== FEYNMAN_LITEPARSE_VERSION ||
			entry?.resolved !==
				`https://registry.npmjs.org/${packageName}/-/${packageName.slice("@llamaindex/".length)}-${FEYNMAN_LITEPARSE_VERSION}.tgz` ||
			entry?.integrity !== FEYNMAN_LITEPARSE_NATIVE_INTEGRITIES[packageName] ||
			entry?.optional !== true ||
			JSON.stringify(entry.cpu) !== JSON.stringify(platform.cpu) ||
			JSON.stringify(entry.os) !== JSON.stringify(platform.os) ||
			JSON.stringify(entry.libc) !== JSON.stringify(platform.libc)
		) {
			fail(`${label} does not resolve exact ${packageName}@${FEYNMAN_LITEPARSE_VERSION}`);
		}
	}
}

function verifyLiteparseLockEntry(lock, fail, label) {
	const entry = lock.packages?.["node_modules/@llamaindex/liteparse"];
	if (
		entry?.version !== FEYNMAN_LITEPARSE_VERSION ||
		entry?.resolved !== EXPECTED_LITEPARSE_URL ||
		entry?.integrity !== FEYNMAN_LITEPARSE_INTEGRITY
	) {
		fail(`${label} does not resolve exact LiteParse ${FEYNMAN_LITEPARSE_VERSION}`);
	}
	verifyLiteparseManifestContract(entry, fail, label);
}

export function verifyLiteparseManifestContract(manifest, fail, label) {
	if (manifest.version !== FEYNMAN_LITEPARSE_VERSION) {
		fail(`${label} LiteParse is not ${FEYNMAN_LITEPARSE_VERSION}`);
	}
	verifyLiteparseNativeOptionalDependencies(manifest, fail, label);
}

export function verifyLiteparseRootManifestContract(rootManifest, fail) {
	verifyLiteparseNativeOptionalDependencies(rootManifest, fail, "package.json");
}

export function verifyLiteparseRootLockContract(rootLock, fail) {
	verifyLiteparseNativeOptionalDependencies(
		rootLock.packages?.[""],
		fail,
		"package-lock.json",
	);
	verifyLiteparseNativeLockEntries(rootLock, fail, "package-lock.json");
}

export function verifyLiteparseRuntimeLockContract(runtimeLock, fail) {
	verifyLiteparseLockEntry(runtimeLock, fail, "committed runtime lock");
	verifyLiteparseNativeLockEntries(runtimeLock, fail, "committed runtime lock");
}
