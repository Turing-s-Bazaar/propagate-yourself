import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { computeRuntimeTreeHash } from "../scripts/lib/runtime-workspace-integrity.mjs";
import {
	cleanupStaleRuntimeWorkspaceRestoreArtifacts,
	getRuntimeWorkspaceCompletionPath,
	reconcileRuntimeWorkspaceRestoreArtifacts,
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

test("backup recovery uses locale-independent code-unit ordering for timestamp ties", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-runtime-ordering-"));
	const workspaceDir = join(root, "npm");
	try {
		for (const [token, value] of [
			["Z", "ascii\n"],
			["ä", "unicode\n"],
		] as const) {
			writeCompletedWorkspace(
				join(root, `runtime-workspace.backup-123-30000-${token}`),
				{ value },
			);
		}
		reconcileRuntimeWorkspaceRestoreArtifacts(workspaceDir);
		assert.equal(
			readFileSync(join(workspaceDir, "value.txt"), "utf8"),
			"unicode\n",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("journal recovery publishes a completed first-install stage after its rename boundary", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-runtime-journal-stage-"));
	const workspaceDir = join(root, "npm");
	const pid = 456;
	const createdAt = 20_000;
	const token = "publish";
	const stageDir = join(
		root,
		`runtime-workspace.restore-${pid}-${createdAt}-${token}`,
	);
	try {
		writeRestoreJournal(stageDir, {
			pid,
			createdAt,
			token,
			phase: "publishing",
		});
		writeCompletedWorkspace(join(stageDir, "npm"), {
			value: "staged live\n",
		});

		reconcileRuntimeWorkspaceRestoreArtifacts(workspaceDir);
		assert.equal(
			readFileSync(join(workspaceDir, "value.txt"), "utf8"),
			"staged live\n",
		);
		assert.equal(existsSync(join(stageDir, "npm")), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("stale restore cleanup is owned, age-gated, and removal-bounded", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-runtime-cleanup-"));
	try {
		const now = Date.now();
		const staleNames = [
			`runtime-workspace.restore-123-${now - 10_000}-aaa`,
			`runtime-workspace.backup-456-${now - 10_000}`,
		];
		for (const name of staleNames) {
			const path = join(root, name);
			if (name.startsWith("runtime-workspace.restore-")) {
				writeRestoreJournal(path, {
					pid: 123,
					createdAt: now - 10_000,
					token: "aaa",
					phase: "created",
				});
			} else {
				mkdirSync(path);
				writeFileSync(
					getRuntimeWorkspaceCompletionPath(path),
					'{"owned":true}\n',
				);
			}
		}
		const recentName = `runtime-workspace.restore-789-${now}-bbb`;
		writeRestoreJournal(join(root, recentName), {
			pid: 789,
			createdAt: now,
			token: "bbb",
			phase: "created",
		});
		const unrelatedName = `runtime-workspace.restore-user-${now - 10_000}`;
		mkdirSync(join(root, unrelatedName));

		assert.equal(
			cleanupStaleRuntimeWorkspaceRestoreArtifacts(root, {
				now,
				staleMs: 1_000,
				maxCleanups: 1,
				includeBackups: true,
			}),
			1,
		);
		assert.equal(
			staleNames.filter((name) => existsSync(join(root, name))).length,
			1,
		);
		assert.equal(existsSync(join(root, recentName)), true);
		assert.equal(existsSync(join(root, unrelatedName)), true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a healthy runtime cleans owned crash stages and superseded backups", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-runtime-reconcile-"));
	const workspaceDir = join(root, "npm");
	try {
		writeCompletedWorkspace(workspaceDir, { value: "healthy\n" });
		const createdAt = Date.now() - 1;
		const token = "cleanup";
		const stageDir = join(
			root,
			`runtime-workspace.restore-123-${createdAt}-${token}`,
		);
		const { backupName } = writeRestoreJournal(stageDir, {
			pid: 123,
			createdAt,
			token,
			phase: "published",
		});
		const backupDir = join(
			root,
			backupName,
		);
		writeCompletedWorkspace(backupDir, { value: "superseded\n" });

		assert.equal(
			reconcileRuntimeWorkspaceRestoreArtifacts(workspaceDir, {
				workspaceIsHealthy: true,
			}),
			2,
		);
		assert.equal(existsSync(stageDir), false);
		assert.equal(existsSync(backupDir), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
