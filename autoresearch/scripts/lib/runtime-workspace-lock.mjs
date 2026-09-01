import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { basename, dirname, resolve } from "node:path";

export const RUNTIME_WORKSPACE_RESTORE_MAX_CLEANUPS = 16;
export const RUNTIME_WORKSPACE_SETUP_LOCK_STALE_MS = 300000;

const heldRuntimeWorkspaceSetupLocks = new Map();

function escapeRegExp(source) {
	return source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function computeSourceSha256(source) {
	return createHash("sha256").update(source).digest("hex");
}

function compareCodeUnits(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}

function sleepSync(ms) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function currentProcessStartedAt() {
	return Date.now() - process.uptime() * 1000;
}

function directoryIdentity(path) {
	const stat = statSync(path, { bigint: true });
	return {
		dev: stat.dev.toString(),
		ino: stat.ino.toString(),
	};
}

function directoryIdentityMatches(path, expected) {
	try {
		const actual = directoryIdentity(path);
		return actual.dev === expected.dev && actual.ino === expected.ino;
	} catch {
		return false;
	}
}

function setupLockOwnerMatches(owner, held) {
	return (
		owner?.version === 1 &&
		owner.pid === process.pid &&
		owner.token === held.token &&
		owner.ownerId === held.ownerId &&
		owner.hostname === held.hostname &&
		owner.createdAt === held.createdAt &&
		Number.isFinite(owner.processStartedAt) &&
		Math.abs(owner.processStartedAt - held.processStartedAt) < 3_000
	);
}

function writeSetupLockOwner(lockDir, owner, expectedIdentity) {
	const temporaryPath = resolve(
		lockDir,
		`.owner-${process.pid}-${randomUUID()}.tmp`,
	);
	try {
		if (!directoryIdentityMatches(lockDir, expectedIdentity)) return false;
		writeFileSync(temporaryPath, setupLockOwnerSource(owner), {
			encoding: "utf8",
			flag: "wx",
		});
		if (!directoryIdentityMatches(lockDir, expectedIdentity)) return false;
		renameSync(temporaryPath, resolve(lockDir, "owner.json"));
		return directoryIdentityMatches(lockDir, expectedIdentity);
	} finally {
		try {
			rmSync(temporaryPath, { force: true });
		} catch {}
	}
}

function setupLockOwnerSource(owner) {
	return `${JSON.stringify(owner)}\n`;
}

function readProcessStartedAt(pid) {
	if (pid === process.pid) return currentProcessStartedAt();
	try {
		const result =
			process.platform === "win32"
				? spawnSync(
						"powershell.exe",
						[
							"-NoLogo",
							"-NoProfile",
							"-NonInteractive",
							"-Command",
							`([DateTimeOffset](Get-Process -Id ${pid} -ErrorAction Stop).StartTime).ToUnixTimeMilliseconds()`,
						],
						{ encoding: "utf8", timeout: 2_000, windowsHide: true },
					)
				: spawnSync(
						"ps",
						["-o", "lstart=", "-p", String(pid)],
						{ encoding: "utf8", timeout: 2_000 },
					);
		if (result.status !== 0) return undefined;
		if (process.platform === "win32") {
			const startedAt = Number.parseInt(result.stdout.trim(), 10);
			return Number.isFinite(startedAt) ? startedAt : undefined;
		}
		const startedAt = Date.parse(result.stdout.trim());
		return Number.isFinite(startedAt) ? startedAt : undefined;
	} catch {
		return undefined;
	}
}

function runtimeWorkspaceLockOwnerIsAlive(
	owner,
	readOwnerProcessStartedAt = readProcessStartedAt,
) {
	if (
		owner?.version !== 1 ||
		owner.hostname !== hostname() ||
		!Number.isSafeInteger(owner.pid) ||
		owner.pid <= 0 ||
		!Number.isFinite(owner.processStartedAt)
	) {
		return undefined;
	}
	try {
		process.kill(owner.pid, 0);
	} catch (error) {
		if (error?.code !== "EPERM") return false;
	}
	const liveProcessStartedAt = readOwnerProcessStartedAt(owner.pid);
	return (
		liveProcessStartedAt === undefined
			? undefined
			: Math.abs(liveProcessStartedAt - owner.processStartedAt) < 3_000
	);
}

export function acquireRuntimeWorkspaceSetupLock(
	lockDir,
	{
		staleMs = RUNTIME_WORKSPACE_SETUP_LOCK_STALE_MS,
		readOwnerProcessStartedAt = readProcessStartedAt,
	} = {},
) {
	mkdirSync(dirname(lockDir), { recursive: true });
	cleanupRuntimeWorkspaceSetupLockTombstones(lockDir, { staleMs });
	const startedAt = Date.now();
	const token = randomUUID();
	const ownerId = randomUUID();
	const processStartedAt = currentProcessStartedAt();
	const ownerHostname = hostname();
	const ownerPath = resolve(lockDir, "owner.json");
	while (true) {
		try {
			mkdirSync(lockDir);
			const identity = directoryIdentity(lockDir);
			const createdAt = Date.now();
			const owner = {
				version: 1,
				pid: process.pid,
				token,
				ownerId,
				hostname: ownerHostname,
				createdAt,
				heartbeatAt: createdAt,
				processStartedAt,
			};
			if (!writeSetupLockOwner(lockDir, owner, identity)) {
				throw new Error("Feynman setup lock changed while it was acquired");
			}
			heldRuntimeWorkspaceSetupLocks.set(token, {
				token,
				lockDir: resolve(lockDir),
				identity,
				ownerId,
				hostname: ownerHostname,
				createdAt,
				ownerSha256: computeSourceSha256(setupLockOwnerSource(owner)),
				processStartedAt,
			});
			return token;
		} catch (error) {
			if (error?.code !== "EEXIST") throw error;
			try {
				const initialStat = statSync(lockDir);
				const initialIdentity = directoryIdentity(lockDir);
				let owner;
				try {
					owner = JSON.parse(readFileSync(ownerPath, "utf8"));
				} catch {
					owner = undefined;
				}
				const ownerAlive = runtimeWorkspaceLockOwnerIsAlive(
					owner,
					readOwnerProcessStartedAt,
				);
				const heartbeatAt = Number.isFinite(owner?.heartbeatAt)
					? owner.heartbeatAt
					: Number.isFinite(owner?.createdAt)
						? owner.createdAt
						: initialStat.mtimeMs;
				if (
					ownerAlive !== true &&
					Date.now() - heartbeatAt > staleMs &&
					directoryIdentityMatches(lockDir, initialIdentity)
				) {
					const staleLockPath =
						`${lockDir}.stale-${process.pid}-${Date.now()}-${randomUUID()}`;
					renameSync(lockDir, staleLockPath);
					if (!directoryIdentityMatches(staleLockPath, initialIdentity)) {
						if (!existsSync(lockDir)) {
							renameSync(staleLockPath, lockDir);
						}
					} else {
						rmSync(staleLockPath, { recursive: true, force: true });
					}
					continue;
				}
			} catch {}
			if (Date.now() - startedAt > staleMs) {
				throw new Error(
					"Timed out waiting for another Feynman process to finish package setup.",
				);
			}
			sleepSync(100);
		}
	}
}

export function cleanupRuntimeWorkspaceSetupLockTombstones(
	lockDir,
	{
		now = Date.now(),
		staleMs = RUNTIME_WORKSPACE_SETUP_LOCK_STALE_MS,
		maxCleanups = RUNTIME_WORKSPACE_RESTORE_MAX_CLEANUPS,
		maxCandidates = 64,
	} = {},
) {
	const parentDir = dirname(lockDir);
	if (
		!existsSync(parentDir) ||
		maxCleanups <= 0 ||
		maxCandidates <= 0
	) {
		return 0;
	}
	const pattern = new RegExp(
		`^${escapeRegExp(basename(lockDir))}\\.(?:stale|released)-\\d+-(\\d+)-[0-9a-f-]+$`,
	);
	let inspected = 0;
	let removed = 0;
	for (const entry of readdirSync(parentDir, { withFileTypes: true })
		.sort((left, right) => compareCodeUnits(left.name, right.name))) {
		if (inspected >= maxCandidates || removed >= maxCleanups) break;
		const match = entry.name.match(pattern);
		if (!match) continue;
		inspected += 1;
		const createdAt = Number.parseInt(match[1], 10);
		if (
			!entry.isDirectory() ||
			!Number.isSafeInteger(createdAt) ||
			createdAt > now ||
			now - createdAt < staleMs
		) {
			continue;
		}
		const path = resolve(parentDir, entry.name);
		try {
			if (lstatSync(path).isSymbolicLink()) continue;
			rmSync(path, { recursive: true, force: true });
			removed += 1;
		} catch {}
	}
	return removed;
}

export function heartbeatRuntimeWorkspaceSetupLock(lockDir, token) {
	const held = heldRuntimeWorkspaceSetupLocks.get(token);
	if (
		!held ||
		held.lockDir !== resolve(lockDir) ||
		!directoryIdentityMatches(lockDir, held.identity)
	) {
		return false;
	}
	try {
		const ownerSource = readFileSync(resolve(lockDir, "owner.json"), "utf8");
		const owner = JSON.parse(ownerSource);
		if (
			computeSourceSha256(ownerSource) !== held.ownerSha256 ||
			!setupLockOwnerMatches(owner, held)
		) {
			return false;
		}
		const nextOwner = { ...owner, heartbeatAt: Date.now() };
		const updated = writeSetupLockOwner(
			lockDir,
			nextOwner,
			held.identity,
		);
		if (updated) {
			held.ownerSha256 = computeSourceSha256(setupLockOwnerSource(nextOwner));
		}
		return updated;
	} catch {
		return false;
	}
}

export function releaseRuntimeWorkspaceSetupLock(lockDir, token) {
	const held = heldRuntimeWorkspaceSetupLocks.get(token);
	if (
		!held ||
		held.lockDir !== resolve(lockDir) ||
		!directoryIdentityMatches(lockDir, held.identity)
	) {
		return;
	}
	try {
		const ownerSource = readFileSync(resolve(lockDir, "owner.json"), "utf8");
		const owner = JSON.parse(ownerSource);
		if (
			computeSourceSha256(ownerSource) !== held.ownerSha256 ||
			!setupLockOwnerMatches(owner, held)
		) {
			return;
		}
		const releasedPath =
			`${lockDir}.released-${process.pid}-${Date.now()}-${randomUUID()}`;
		renameSync(lockDir, releasedPath);
		if (!directoryIdentityMatches(releasedPath, held.identity)) {
			if (!existsSync(lockDir)) renameSync(releasedPath, lockDir);
			return;
		}
		rmSync(releasedPath, { recursive: true, force: true });
		heldRuntimeWorkspaceSetupLocks.delete(token);
	} catch {}
}
