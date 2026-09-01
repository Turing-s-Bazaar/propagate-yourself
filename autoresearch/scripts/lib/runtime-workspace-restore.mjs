import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	constants as fsConstants,
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";

import {
	captureRuntimeArchiveSnapshot,
	computeFileSha256,
	computeRuntimeTreeHash,
	mergeRuntimePackageSpecs,
	packagedWorkspaceExtractionSucceeded,
	parseExactRuntimePackageSpec,
	runtimeArchiveExtractionMatches,
	runtimeManifestPackagesMatch,
	runtimeWorkspacePackageGraphMatches,
	verifyFileSha256,
} from "./runtime-workspace-integrity.mjs";
import {
	createRuntimeWorkspaceIntegrityIndex,
	runtimeWorkspaceIntegrityIndexMatches,
} from "./runtime-workspace-index.mjs";
import {
	RUNTIME_WORKSPACE_RESTORE_MAX_CLEANUPS,
} from "./runtime-workspace-lock.mjs";

export {
	acquireRuntimeWorkspaceSetupLock,
	cleanupRuntimeWorkspaceSetupLockTombstones,
	heartbeatRuntimeWorkspaceSetupLock,
	releaseRuntimeWorkspaceSetupLock,
	RUNTIME_WORKSPACE_RESTORE_MAX_CLEANUPS,
	RUNTIME_WORKSPACE_SETUP_LOCK_STALE_MS,
} from "./runtime-workspace-lock.mjs";

export const RUNTIME_WORKSPACE_COMPLETION_VERSION = 2;
export const RUNTIME_WORKSPACE_RESTORE_STALE_MS = 24 * 60 * 60 * 1000;
export const RUNTIME_WORKSPACE_RESTORE_JOURNAL_VERSION = 1;

const RUNTIME_WORKSPACE_RESTORE_OWNER = ".feynman-runtime-restore-owner.json";
const RUNTIME_WORKSPACE_RESTORE_JOURNAL = ".feynman-runtime-restore-journal.json";
function computeSourceSha256(source) {
	return createHash("sha256").update(source).digest("hex");
}

export function getRuntimeWorkspaceCompletionPath(workspaceDir) {
	return resolve(workspaceDir, ".runtime-workspace.complete.json");
}

function readExpectedDigest(digestPath) {
	try {
		const digest = readFileSync(digestPath, "utf8").trim().split(/\s+/, 1)[0];
		return /^[a-f0-9]{64}$/.test(digest) ? digest : undefined;
	} catch {
		return undefined;
	}
}

function fileMatchesSha256(path, expectedSha256) {
	try {
		return computeFileSha256(path) === expectedSha256;
	} catch {
		return false;
	}
}

export function runtimeWorkspaceCompletionMatches(
	workspaceDir,
	{ archivePath, digestPath },
) {
	const completion = readLocalRuntimeWorkspaceCompletion(workspaceDir);
	if (!completion) return false;
	const { marker, manifest } = completion;
	try {
		if (
			marker.source === "package-manager" ||
			marker.source === "native-bundle"
		) {
			return true;
		}
		if (marker.source !== "archive") return false;
		const expectedDigest = readExpectedDigest(digestPath);
			return (
				expectedDigest !== undefined &&
				verifyFileSha256(archivePath, digestPath) &&
				marker.archiveSha256 === expectedDigest &&
				typeof marker.archiveTreeHash === "string" &&
				marker.archiveTreeHash === manifest.runtimeTreeHash
		);
	} catch {
		return false;
	}
}

function readLocalRuntimeWorkspaceCompletion(workspaceDir) {
	try {
		const manifestPath = resolve(workspaceDir, ".runtime-manifest.json");
		const packageLockPath = resolve(workspaceDir, "package-lock.json");
		const marker = JSON.parse(
			readFileSync(getRuntimeWorkspaceCompletionPath(workspaceDir), "utf8"),
		);
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		if (
			marker.version !== RUNTIME_WORKSPACE_COMPLETION_VERSION ||
			marker.complete !== true ||
			typeof marker.runtimeTreeHash !== "string" ||
			!/^[a-f0-9]{64}$/.test(marker.runtimeTreeHash) ||
			typeof marker.manifestSha256 !== "string" ||
			marker.manifestSha256 !== computeFileSha256(manifestPath) ||
			typeof marker.packageLockSha256 !== "string" ||
			marker.packageLockSha256 !== computeFileSha256(packageLockPath) ||
				typeof manifest.platform !== "string" ||
			manifest.platform.length === 0 ||
			typeof manifest.arch !== "string" ||
			manifest.arch.length === 0 ||
			(manifest.platform === "linux" &&
				manifest.libc !== "glibc" &&
				manifest.libc !== "musl") ||
			!runtimeWorkspaceIntegrityIndexMatches(
				workspaceDir,
				marker.integrityShapeHash,
				marker.runtimeTreeHash,
			) ||
			!runtimeWorkspacePackageGraphMatches(workspaceDir, {
				platform: manifest.platform,
				arch: manifest.arch,
				libc: manifest.libc,
			})
		) {
			return undefined;
		}
		return { marker, manifest };
	} catch {
		return undefined;
	}
}

export function writeRuntimeWorkspaceCompletion(
	workspaceDir,
	{
		source,
		archiveSha256,
		archiveTreeHash,
		runtimeTreeHash,
		expectedPackageLockSha256,
	},
) {
	if (
		typeof runtimeTreeHash !== "string" ||
		!/^[a-f0-9]{64}$/.test(runtimeTreeHash)
	) {
		throw new Error("Runtime workspace completion requires a verified tree hash");
	}
	const integrityIndex = createRuntimeWorkspaceIntegrityIndex(workspaceDir);
	if (integrityIndex.runtimeTreeHash !== runtimeTreeHash) {
		throw new Error(
			`Runtime workspace changed before completion: ${runtimeTreeHash} -> ${integrityIndex.runtimeTreeHash}`,
		);
	}
	const packageLockSha256 = computeFileSha256(
		resolve(workspaceDir, "package-lock.json"),
	);
	if (
		expectedPackageLockSha256 !== undefined &&
		expectedPackageLockSha256 !== packageLockSha256
	) {
		throw new Error(
			"Runtime workspace package lock changed before completion",
		);
	}
	writeFileSync(
		getRuntimeWorkspaceCompletionPath(workspaceDir),
		JSON.stringify(
			{
				version: RUNTIME_WORKSPACE_COMPLETION_VERSION,
				complete: true,
				source,
				...(archiveSha256 ? { archiveSha256 } : {}),
				...(archiveTreeHash ? { archiveTreeHash } : {}),
				manifestSha256: computeFileSha256(
					resolve(workspaceDir, ".runtime-manifest.json"),
				),
				packageLockSha256,
				runtimeTreeHash,
				integrityShapeHash: integrityIndex.integrityShapeHash,
			},
			null,
			2,
		) + "\n",
		"utf8",
	);
}

export function runtimeWorkspaceMatches(
	workspaceDir,
	configuredPackageSpecs,
	{
		archivePath,
		digestPath,
		filterPackageSpecs = (packageSpecs) => packageSpecs,
		pruneVersion,
		requireCompletion = true,
		requireCurrentPlatformPackageGraph = false,
		requirePlatformIdentity = true,
	} = {},
) {
	const manifestPath = resolve(workspaceDir, ".runtime-manifest.json");
	if (
		!existsSync(manifestPath) ||
		(requireCompletion &&
			!runtimeWorkspaceCompletionMatches(workspaceDir, {
				archivePath,
				digestPath,
			}))
	) {
		return false;
	}
	try {
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		if (!Array.isArray(manifest.packageSpecs)) return false;
		const manifestPackageSpecs = filterPackageSpecs(manifest.packageSpecs);
		if (
			!runtimeManifestPackagesMatch(
				resolve(workspaceDir, "node_modules"),
				manifestPackageSpecs,
				configuredPackageSpecs,
			)
		) {
			return false;
		}
		if (
			requireCurrentPlatformPackageGraph &&
			!runtimeWorkspacePackageGraphMatches(workspaceDir)
		) {
			return false;
		}
		return (
			!requirePlatformIdentity ||
			(manifest.nodeAbi === process.versions.modules &&
				manifest.platform === process.platform &&
				manifest.arch === process.arch &&
				manifest.pruneVersion === pruneVersion)
		);
	} catch {
		return false;
	}
}

function parseInstallSeed({
	manifestSource,
	packageJsonSource,
	packageLockSource,
	npmConfigSource,
	configuredPackageSpecs = [],
}) {
	const manifest = JSON.parse(manifestSource);
	const packageJson = JSON.parse(packageJsonSource);
	const packageLock = JSON.parse(packageLockSource);
	if (!Array.isArray(manifest.packageSpecs)) {
		throw new Error("Bundled runtime manifest is missing package specs");
	}
	if (
		typeof packageJson.dependencies !== "object" ||
		packageJson.dependencies === null ||
		Array.isArray(packageJson.dependencies)
	) {
		throw new Error("Bundled runtime package manifest is missing dependencies");
	}
	if (
		typeof packageLock.packages !== "object" ||
		packageLock.packages === null ||
		Array.isArray(packageLock.packages) ||
		typeof packageLock.packages[""]?.dependencies !== "object" ||
		packageLock.packages[""]?.dependencies === null
	) {
		throw new Error("Bundled runtime package lock is missing dependencies");
	}
	const packageSpecs = mergeRuntimePackageSpecs(
		manifest.packageSpecs,
		configuredPackageSpecs,
	);
	for (const spec of packageSpecs) {
		const { name, version } = parseExactRuntimePackageSpec(spec);
		if (
			packageJson.dependencies[name] !== version ||
			packageLock.packages[""].dependencies[name] !== version
		) {
			throw new Error(`Bundled runtime package manifest does not pin ${spec}`);
		}
	}
	return {
		packageSpecs,
		packageJsonSource,
		packageLockSource,
		packageLockSha256: computeSourceSha256(packageLockSource),
		npmConfigSource,
	};
}

export function readRuntimeWorkspaceInstallSeed(
	archivePath,
	configuredPackageSpecs = [],
) {
	const archiveSnapshot = captureRuntimeArchiveSnapshot(archivePath);
	return readRuntimeWorkspaceInstallSeedFromReader(
		archiveSnapshot.readEntry,
		configuredPackageSpecs,
	);
}

function readRuntimeWorkspaceInstallSeedFromReader(
	readEntry,
	configuredPackageSpecs = [],
) {
	const manifestSource = readEntry("npm/.runtime-manifest.json");
	const packageJsonSource = readEntry("npm/package.json");
	const packageLockSource = readEntry("npm/package-lock.json");
	const npmConfigSource = readEntry("npm/.npmrc");
	if (
		manifestSource === undefined ||
		packageJsonSource === undefined ||
		packageLockSource === undefined
	) {
		throw new Error("Bundled runtime archive is missing package restore metadata");
	}
	return parseInstallSeed({
		manifestSource,
		packageJsonSource,
		packageLockSource,
		npmConfigSource,
		configuredPackageSpecs,
	});
}

export function prepareRuntimeWorkspaceFallback(workspaceDir, seed) {
	if (
		typeof seed?.packageLockSha256 !== "string" ||
		computeSourceSha256(seed.packageLockSource) !== seed.packageLockSha256
	) {
		throw new Error("Runtime workspace fallback seed package lock is invalid");
	}
	rmSync(workspaceDir, { recursive: true, force: true });
	mkdirSync(workspaceDir, { recursive: true });
	writeFileSync(resolve(workspaceDir, "package.json"), seed.packageJsonSource, "utf8");
	writeFileSync(
		resolve(workspaceDir, "package-lock.json"),
		seed.packageLockSource,
		"utf8",
	);
	if (
		computeFileSha256(resolve(workspaceDir, "package-lock.json")) !==
		seed.packageLockSha256
	) {
		throw new Error("Runtime workspace fallback package lock was not preserved");
	}
	if (typeof seed.npmConfigSource === "string") {
		writeFileSync(resolve(workspaceDir, ".npmrc"), seed.npmConfigSource, "utf8");
	}
}

function ownedRuntimeWorkspaceRestoreTimestamp(name) {
	const match = name.match(
		/^runtime-workspace\.(?:restore|backup)-\d+-(\d+)(?:-|$)/,
	);
	return match ? Number.parseInt(match[1], 10) : undefined;
}

function compareCodeUnits(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}

function sortedRuntimeRestoreEntries(feynmanDir) {
	return readdirSync(feynmanDir, { withFileTypes: true })
		.filter((entry) =>
			entry.name.startsWith("runtime-workspace.restore-") ||
			entry.name.startsWith("runtime-workspace.backup-")
		)
		.sort((left, right) => compareCodeUnits(left.name, right.name));
}

function compareRuntimeRestoreEntriesNewestFirst(left, right) {
	const leftCreatedAt =
		ownedRuntimeWorkspaceRestoreTimestamp(left.name) ?? 0;
	const rightCreatedAt =
		ownedRuntimeWorkspaceRestoreTimestamp(right.name) ?? 0;
	return (
		rightCreatedAt - leftCreatedAt ||
		compareCodeUnits(right.name, left.name)
	);
}

function getRuntimeWorkspaceRestoreJournalPath(stageDir) {
	return resolve(stageDir, RUNTIME_WORKSPACE_RESTORE_JOURNAL);
}

function writeRuntimeWorkspaceRestoreJournal(stageDir, journal) {
	const journalPath = getRuntimeWorkspaceRestoreJournalPath(stageDir);
	const temporaryPath = resolve(
		stageDir,
		`.restore-journal-${process.pid}-${randomUUID()}.tmp`,
	);
	try {
		writeFileSync(temporaryPath, `${JSON.stringify(journal)}\n`, {
			encoding: "utf8",
			flag: "wx",
		});
		renameSync(temporaryPath, journalPath);
	} finally {
		try {
			rmSync(temporaryPath, { force: true });
		} catch {}
	}
}

function readRuntimeWorkspaceRestoreJournal(stageDir) {
	try {
		const owner = JSON.parse(
			readFileSync(resolve(stageDir, RUNTIME_WORKSPACE_RESTORE_OWNER), "utf8"),
		);
		const journal = JSON.parse(
			readFileSync(getRuntimeWorkspaceRestoreJournalPath(stageDir), "utf8"),
		);
		if (
			journal?.version !== RUNTIME_WORKSPACE_RESTORE_JOURNAL_VERSION ||
			!Number.isSafeInteger(journal.pid) ||
			!Number.isSafeInteger(journal.createdAt) ||
			typeof journal.token !== "string" ||
			journal.token.length === 0 ||
			journal.stageName !== basename(stageDir) ||
			journal.stageName !==
				`runtime-workspace.restore-${journal.pid}-${journal.createdAt}-${journal.token}` ||
			journal.backupName !==
				`runtime-workspace.backup-${journal.pid}-${journal.createdAt}-${journal.token}` ||
			typeof journal.workspaceName !== "string" ||
			journal.workspaceName.length === 0 ||
			journal.workspaceName.includes("/") ||
			journal.workspaceName.includes("\\") ||
			![
				"created",
				"prepared",
				"moving-live",
				"live-backed-up",
				"publishing",
				"published",
			].includes(journal.phase) ||
			owner?.pid !== journal.pid ||
			owner?.createdAt !== journal.createdAt ||
			owner?.token !== journal.token
		) {
			return undefined;
		}
		return journal;
	} catch {
		return undefined;
	}
}

function listRuntimeWorkspaceRestoreStages(feynmanDir, maxCandidates = 64) {
	if (!existsSync(feynmanDir) || maxCandidates <= 0) return [];
	return sortedRuntimeRestoreEntries(feynmanDir)
		.filter((entry) =>
			entry.isDirectory() &&
			entry.name.startsWith("runtime-workspace.restore-") &&
			Number.isSafeInteger(
				ownedRuntimeWorkspaceRestoreTimestamp(entry.name),
			)
		)
		.sort(compareRuntimeRestoreEntriesNewestFirst)
		.slice(0, maxCandidates)
		.map((entry) => resolve(feynmanDir, entry.name))
		.filter((path) => {
			try {
				return !lstatSync(path).isSymbolicLink();
			} catch {
				return false;
			}
		});
}

export function cleanupStaleRuntimeWorkspaceRestoreArtifacts(
	feynmanDir,
	{
		now = Date.now(),
		staleMs = RUNTIME_WORKSPACE_RESTORE_STALE_MS,
		maxCleanups = RUNTIME_WORKSPACE_RESTORE_MAX_CLEANUPS,
		maxCandidates = 64,
		includeBackups = false,
		healthyWorkspaceDir,
	} = {},
) {
	if (
		!existsSync(feynmanDir) ||
		maxCleanups <= 0 ||
		maxCandidates <= 0
	) {
		return 0;
	}
	const healthyLiveWorkspace =
		typeof healthyWorkspaceDir === "string" &&
		Boolean(readLocalRuntimeWorkspaceCompletion(healthyWorkspaceDir));
	let removed = 0;
	let inspected = 0;
	for (const entry of sortedRuntimeRestoreEntries(feynmanDir)) {
		if (removed >= maxCleanups || inspected >= maxCandidates) break;
		inspected += 1;
		if (
			(!includeBackups || !healthyLiveWorkspace) &&
			entry.name.startsWith("runtime-workspace.backup-")
		) {
			continue;
		}
		const createdAt = ownedRuntimeWorkspaceRestoreTimestamp(entry.name);
		if (!entry.isDirectory() || !Number.isSafeInteger(createdAt)) {
			continue;
		}
		const path = resolve(feynmanDir, entry.name);
		try {
			if (entry.name.startsWith("runtime-workspace.restore-")) {
				const journal = readRuntimeWorkspaceRestoreJournal(path);
				if (!journal) continue;
				if (
					!healthyLiveWorkspace &&
					readLocalRuntimeWorkspaceCompletion(resolve(path, "npm"))
				) {
					continue;
				}
			} else {
				const referencedByJournal = listRuntimeWorkspaceRestoreStages(
					feynmanDir,
					maxCandidates,
				).some((stageDir) => {
					const journal = readRuntimeWorkspaceRestoreJournal(stageDir);
					return journal?.backupName === entry.name;
				});
				if (
					!referencedByJournal &&
					!existsSync(getRuntimeWorkspaceCompletionPath(path))
				) {
					continue;
				}
			}
			if (
				lstatSync(path).isSymbolicLink() ||
				now - createdAt < staleMs
			) {
				continue;
			}
			rmSync(path, { recursive: true, force: true });
			removed += 1;
		} catch {}
	}
	return removed;
}

function listRuntimeWorkspaceBackups(feynmanDir, maxCandidates = 64) {
	if (!existsSync(feynmanDir) || maxCandidates <= 0) return [];
	return sortedRuntimeRestoreEntries(feynmanDir)
		.filter((entry) =>
			entry.isDirectory() &&
			entry.name.startsWith("runtime-workspace.backup-") &&
			Number.isSafeInteger(
				ownedRuntimeWorkspaceRestoreTimestamp(entry.name),
			)
		)
		.sort(compareRuntimeRestoreEntriesNewestFirst)
		.slice(0, maxCandidates)
		.map((entry) => resolve(feynmanDir, entry.name))
		.filter((path) => {
			try {
				return !lstatSync(path).isSymbolicLink();
			} catch {
				return false;
			}
		});
}

function sortRuntimeWorkspaceRecoveryPathsNewestFirst(paths) {
	return paths.sort((left, right) => {
		const leftCreatedAt =
			ownedRuntimeWorkspaceRestoreTimestamp(basename(left)) ?? 0;
		const rightCreatedAt =
			ownedRuntimeWorkspaceRestoreTimestamp(basename(right)) ?? 0;
		return (
			rightCreatedAt - leftCreatedAt ||
			compareCodeUnits(right, left)
		);
	});
}

function recoverRuntimeWorkspaceTransactionJournal(workspaceDir) {
	if (existsSync(workspaceDir)) return;
	const feynmanDir = dirname(workspaceDir);
	const stages = sortRuntimeWorkspaceRecoveryPathsNewestFirst(
		listRuntimeWorkspaceRestoreStages(feynmanDir),
	);
	for (const stageDir of stages) {
		const journal = readRuntimeWorkspaceRestoreJournal(stageDir);
		if (!journal || journal.workspaceName !== basename(workspaceDir)) continue;
		const backupDir = resolve(feynmanDir, journal.backupName);
		if (
			existsSync(backupDir) &&
			readLocalRuntimeWorkspaceCompletion(backupDir)
		) {
			renameSync(backupDir, workspaceDir);
			return;
		}
		const stagedWorkspaceDir = resolve(stageDir, "npm");
		if (
			existsSync(stagedWorkspaceDir) &&
			readLocalRuntimeWorkspaceCompletion(stagedWorkspaceDir)
		) {
			renameSync(stagedWorkspaceDir, workspaceDir);
			return;
		}
	}
}

function recoverRuntimeWorkspaceBackup(workspaceDir) {
	if (existsSync(workspaceDir)) return;
	const backups = listRuntimeWorkspaceBackups(dirname(workspaceDir)).filter(
		(backupDir) => readLocalRuntimeWorkspaceCompletion(backupDir),
	);
	if (backups.length === 0) return;
	sortRuntimeWorkspaceRecoveryPathsNewestFirst(backups);
	// Recover only a complete, integrity-checked, package-graph-valid backup.
	// Leave invalid and older candidates untouched until a verified live
	// workspace makes them safe to clean.
	renameSync(backups[0], workspaceDir);
}

export function reconcileRuntimeWorkspaceRestoreArtifacts(
	workspaceDir,
	{ workspaceIsHealthy = false } = {},
) {
	recoverRuntimeWorkspaceTransactionJournal(workspaceDir);
	recoverRuntimeWorkspaceBackup(workspaceDir);
	const healthyWorkspaceDir =
		workspaceIsHealthy && readLocalRuntimeWorkspaceCompletion(workspaceDir)
			? workspaceDir
			: undefined;
	return cleanupStaleRuntimeWorkspaceRestoreArtifacts(dirname(workspaceDir), {
		staleMs: healthyWorkspaceDir ? 0 : RUNTIME_WORKSPACE_RESTORE_STALE_MS,
		includeBackups: Boolean(healthyWorkspaceDir),
		healthyWorkspaceDir,
	});
}

export function replaceRuntimeWorkspaceTransactionally(
	workspaceDir,
	prepareStagedWorkspace,
) {
	const feynmanDir = dirname(workspaceDir);
	mkdirSync(feynmanDir, { recursive: true });
	recoverRuntimeWorkspaceTransactionJournal(workspaceDir);
	recoverRuntimeWorkspaceBackup(workspaceDir);
	cleanupStaleRuntimeWorkspaceRestoreArtifacts(feynmanDir, {
		healthyWorkspaceDir: readLocalRuntimeWorkspaceCompletion(workspaceDir)
			? workspaceDir
			: undefined,
	});

	const operationCreatedAt = Date.now();
	const operationToken = randomUUID();
	const operationId = `${process.pid}-${operationCreatedAt}-${operationToken}`;
	const stageDir = resolve(
		feynmanDir,
		`runtime-workspace.restore-${operationId}`,
	);
	mkdirSync(stageDir);
	const stagedWorkspaceDir = resolve(stageDir, "npm");
	const backupDir = resolve(feynmanDir, `runtime-workspace.backup-${operationId}`);
	writeFileSync(
		resolve(stageDir, RUNTIME_WORKSPACE_RESTORE_OWNER),
		`${JSON.stringify({
			pid: process.pid,
			createdAt: operationCreatedAt,
			token: operationToken,
		})}\n`,
		"utf8",
	);
	let journal = {
		version: RUNTIME_WORKSPACE_RESTORE_JOURNAL_VERSION,
		pid: process.pid,
		createdAt: operationCreatedAt,
		token: operationToken,
		workspaceName: basename(workspaceDir),
		stageName: basename(stageDir),
		backupName: basename(backupDir),
		phase: "created",
	};
	const setJournalPhase = (phase) => {
		journal = { ...journal, phase };
		writeRuntimeWorkspaceRestoreJournal(stageDir, journal);
	};
	writeRuntimeWorkspaceRestoreJournal(stageDir, journal);

	let published = false;
	let existingWorkspaceMoved = false;
	let stagedWorkspaceMoved = false;
	try {
		if (!prepareStagedWorkspace(stagedWorkspaceDir, stageDir)) return false;
		if (!readLocalRuntimeWorkspaceCompletion(stagedWorkspaceDir)) {
			throw new Error(
				"Transactional runtime workspace preparation did not produce a valid completed workspace.",
			);
		}
		setJournalPhase("prepared");
		if (existsSync(workspaceDir)) {
			setJournalPhase("moving-live");
			renameSync(workspaceDir, backupDir);
			existingWorkspaceMoved = true;
			setJournalPhase("live-backed-up");
		}
		setJournalPhase("publishing");
		renameSync(stagedWorkspaceDir, workspaceDir);
		stagedWorkspaceMoved = true;
		if (!readLocalRuntimeWorkspaceCompletion(workspaceDir)) {
			throw new Error(
				"Transactional runtime workspace publication failed completion validation.",
			);
		}
		published = true;
		try {
			setJournalPhase("published");
		} catch {}
		return true;
	} finally {
		let rollbackError;
		if (!published && stagedWorkspaceMoved) {
			try {
				rmSync(workspaceDir, { recursive: true, force: true });
			} catch (error) {
				rollbackError = error;
			}
		}
		if (!published && existingWorkspaceMoved && existsSync(backupDir)) {
			try {
				renameSync(backupDir, workspaceDir);
			} catch (error) {
				rollbackError ??= error;
			}
		}
		if (published) {
			if (readLocalRuntimeWorkspaceCompletion(workspaceDir)) {
				try {
					rmSync(backupDir, { recursive: true, force: true });
				} catch {}
				try {
					cleanupStaleRuntimeWorkspaceRestoreArtifacts(feynmanDir, {
						includeBackups: true,
						healthyWorkspaceDir: workspaceDir,
					});
				} catch {}
			}
		}
		try {
			rmSync(stageDir, { recursive: true, force: true });
		} catch {}
		if (rollbackError) throw rollbackError;
	}
}

export function restoreRuntimeWorkspaceFromArchive({
	archivePath,
	digestPath,
	workspaceDir,
	onAuthenticatedArchive = () => {},
	heartbeat = () => {},
	platform = process.platform,
	spawn = spawnSync,
	validateWorkspace = () => true,
}) {
	if (!existsSync(archivePath)) return false;
	const expectedArchiveSha256 = readExpectedDigest(digestPath);
	if (
		expectedArchiveSha256 === undefined ||
		!verifyFileSha256(archivePath, digestPath)
	) {
		throw new Error("Bundled runtime archive failed its SHA-256 integrity check");
	}

	const feynmanDir = dirname(workspaceDir);
	return replaceRuntimeWorkspaceTransactionally(
		workspaceDir,
		(stagedWorkspaceDir, stageDir) => {
			const snapshotPath = resolve(
				stageDir,
				"runtime-workspace.authenticated.tgz",
			);
			copyFileSync(archivePath, snapshotPath, fsConstants.COPYFILE_EXCL);
			if (!fileMatchesSha256(snapshotPath, expectedArchiveSha256)) {
				throw new Error(
					"Bundled runtime archive changed while it was being authenticated",
				);
			}
			const archiveSnapshot = captureRuntimeArchiveSnapshot(
				snapshotPath,
				expectedArchiveSha256,
			);
			onAuthenticatedArchive(snapshotPath, archiveSnapshot);
			if (!fileMatchesSha256(snapshotPath, expectedArchiveSha256)) {
				return false;
			}

			// Parse, extract, and verify one operation-owned immutable snapshot.
			// Reopening the package path at each phase would allow a concurrent
			// replacement to mix authenticated metadata with different payloads.
			heartbeat();
			const archiveTree = archiveSnapshot.archiveTree;
			const archiveTreeHash = archiveTree.runtimeTreeHash;
			heartbeat();
			const archivedManifestSource = archiveSnapshot.readEntry(
				"npm/.runtime-manifest.json",
			);
			const archivedPackageLockSource = archiveSnapshot.readEntry(
				"npm/package-lock.json",
			);
			if (
				archivedManifestSource === undefined ||
				archivedPackageLockSource === undefined
			) {
				return false;
			}
			const archivedManifest = JSON.parse(archivedManifestSource);
			if (archivedManifest.runtimeTreeHash !== archiveTreeHash) return false;

			heartbeat();
			const result = spawn(
				"tar",
				[
					"-xzf",
					relative(feynmanDir, snapshotPath),
					"-C",
					relative(feynmanDir, stageDir),
				],
				{
					cwd: feynmanDir,
					stdio: ["ignore", "ignore", "pipe"],
					timeout: 300000,
				},
			);
			heartbeat();
			if (!fileMatchesSha256(snapshotPath, expectedArchiveSha256)) {
				return false;
			}
			const extractionMatches = runtimeArchiveExtractionMatches(
				snapshotPath,
				stagedWorkspaceDir,
				{
					allowMissingWindowsSymlinks: platform === "win32",
					compareExecutableModes: platform !== "win32",
					// Bind extraction to entries captured from the authenticated bytes.
					// Re-reading the path here would let a concurrent replacement make
					// extraction and verification consume a different archive.
					expectedArchiveTree: archiveTree,
				},
			);
			if (!fileMatchesSha256(snapshotPath, expectedArchiveSha256)) {
				return false;
			}
			if (
				!packagedWorkspaceExtractionSucceeded(result, {
					extractionMatches,
					platform,
				})
			) {
				if (result.stderr?.length) process.stderr.write(result.stderr);
				return false;
			}
			if (!validateWorkspace(stagedWorkspaceDir)) return false;

			if (
				readFileSync(
					resolve(stagedWorkspaceDir, ".runtime-manifest.json"),
					"utf8",
				) !== archivedManifestSource
			) {
				return false;
			}
			if (
				readExpectedDigest(digestPath) !== expectedArchiveSha256 ||
				!fileMatchesSha256(archivePath, expectedArchiveSha256)
			) {
				return false;
			}

			// Write the marker into staging last. The following same-filesystem
			// rename publishes the verified tree and its completion state together.
			writeRuntimeWorkspaceCompletion(stagedWorkspaceDir, {
				source: "archive",
				archiveSha256: expectedArchiveSha256,
				archiveTreeHash,
				// Store the actual published representation separately. On Windows
				// this may omit only the verifier's allowlisted npm/Pi links.
				runtimeTreeHash: computeRuntimeTreeHash(stagedWorkspaceDir),
				expectedPackageLockSha256: computeSourceSha256(
					archivedPackageLockSource,
				),
			});
			return true;
		},
	);
}

export function restoreRuntimeWorkspaceFromArchiveWithSeed({
	configuredPackageSpecs = [],
	...options
}) {
	if (!existsSync(options.archivePath)) {
		return { restored: false, installSeed: undefined };
	}
	let installSeed;
	const restored = restoreRuntimeWorkspaceFromArchive({
		...options,
		onAuthenticatedArchive(_snapshotPath, archiveSnapshot) {
			installSeed = readRuntimeWorkspaceInstallSeedFromReader(
				archiveSnapshot.readEntry,
				configuredPackageSpecs,
			);
		},
	});
	return {
		restored,
		installSeed: restored ? undefined : installSeed,
	};
}
