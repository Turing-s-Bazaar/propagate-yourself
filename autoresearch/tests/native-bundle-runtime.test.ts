import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { createDeterministicTarGz } from "../scripts/lib/deterministic-archive.mjs";
import {
	computeFileSha256,
	computeRuntimeArchiveTreeHash,
	computeRuntimeTreeHash,
	writeFileSha256,
} from "../scripts/lib/runtime-workspace-integrity.mjs";
import {
	getRuntimeWorkspaceCompletionPath,
	runtimeWorkspaceCompletionMatches,
	writeRuntimeWorkspaceCompletion,
} from "../scripts/lib/runtime-workspace-restore.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const { finalizeNativeRuntimeWorkspace } = await import(
	pathToFileURL(
		join(repositoryRoot, "scripts", "build-native-bundle.mjs"),
	).href
) as {
	finalizeNativeRuntimeWorkspace(appDir: string): void;
};

async function createNativeRuntimeFixture({ launchable = false } = {}) {
	const root = mkdtempSync(join(tmpdir(), "feynman-native-runtime-"));
	const appDir = join(root, "app");
	const feynmanDir = join(appDir, ".feynman");
	const sourceWorkspaceDir = join(root, "source", "npm");
	const workspaceDir = join(feynmanDir, "npm");
	const runtimePackageDir = join(
		sourceWorkspaceDir,
		"node_modules",
		"runtime-package",
	);
	const archivePath = join(feynmanDir, "runtime-workspace.tgz");
	const digestPath = join(feynmanDir, "runtime-workspace.sha256");
	const packageSpecs = ["runtime-package@1.0.0"];
	const runtimeReport = process.report?.getReport?.() as
		| { header?: { glibcVersionRuntime?: string } }
		| undefined;
	const libc =
		process.platform === "linux"
			? runtimeReport?.header?.glibcVersionRuntime
				? "glibc"
				: "musl"
			: undefined;

	mkdirSync(runtimePackageDir, { recursive: true });
	writeFileSync(
		join(sourceWorkspaceDir, "package.json"),
		`${JSON.stringify({
			name: "feynman-runtime",
			private: true,
			dependencies: { "runtime-package": "1.0.0" },
		}, null, 2)}\n`,
	);
	writeFileSync(join(sourceWorkspaceDir, ".npmrc"), "audit=false\n");
	writeFileSync(
		join(sourceWorkspaceDir, "package-lock.json"),
		`${JSON.stringify({
			name: "feynman-runtime",
			lockfileVersion: 3,
			packages: {
				"": {
					dependencies: { "runtime-package": "1.0.0" },
				},
				"node_modules/runtime-package": {
					version: "1.0.0",
				},
			},
		}, null, 2)}\n`,
	);
	writeFileSync(
		join(runtimePackageDir, "package.json"),
		'{"name":"runtime-package","version":"1.0.0"}\n',
	);
	writeFileSync(
		join(runtimePackageDir, "index.js"),
		"export const ready = true;\n",
	);
	writeFileSync(
		join(sourceWorkspaceDir, ".runtime-manifest.json"),
		`${JSON.stringify({
			packageSpecs,
			nodeAbi: process.versions.modules,
			platform: process.platform,
			arch: process.arch,
			libc,
			pruneVersion: 8,
			runtimeTreeHash: computeRuntimeTreeHash(sourceWorkspaceDir),
		}, null, 2)}\n`,
	);

	mkdirSync(feynmanDir, { recursive: true });
	await createDeterministicTarGz(sourceWorkspaceDir, archivePath);
	writeFileSha256(archivePath, digestPath);
	cpSync(sourceWorkspaceDir, workspaceDir, { recursive: true });
	writeRuntimeWorkspaceCompletion(workspaceDir, {
		source: "archive",
		archiveSha256: computeFileSha256(archivePath),
		archiveTreeHash: computeRuntimeArchiveTreeHash(archivePath),
		runtimeTreeHash: computeRuntimeTreeHash(workspaceDir),
	});

	if (launchable) {
		mkdirSync(join(appDir, "bin"), { recursive: true });
		mkdirSync(join(appDir, "dist"), { recursive: true });
		cpSync(
			join(repositoryRoot, "bin", "feynman.js"),
			join(appDir, "bin", "feynman.js"),
		);
		cpSync(join(repositoryRoot, "scripts"), join(appDir, "scripts"), {
			recursive: true,
		});
		cpSync(join(repositoryRoot, "logo.mjs"), join(appDir, "logo.mjs"));
		cpSync(
			join(repositoryRoot, "node_modules", "semver"),
			join(appDir, "node_modules", "semver"),
			{ recursive: true },
		);
		writeFileSync(
			join(appDir, "package.json"),
			'{"name":"native-runtime-fixture","version":"1.0.0","type":"module"}\n',
		);
		writeFileSync(
			join(feynmanDir, "settings.json"),
			`${JSON.stringify({ packages: ["npm:runtime-package@1.0.0"] }, null, 2)}\n`,
		);
		writeFileSync(
			join(appDir, "dist", "index.js"),
			'console.log("native fixture launched");\n',
		);
	}

	return {
		root,
		appDir,
		workspaceDir,
		archivePath,
		digestPath,
		completionPath: getRuntimeWorkspaceCompletionPath(workspaceDir),
	};
}

function writeOfflineGuard(guardPath: string, attemptLogPath: string) {
	writeFileSync(
		guardPath,
		`
import childProcess from "node:child_process";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const attemptLogPath = ${JSON.stringify(attemptLogPath)};
const blockedCommands = /(?:^|[\\\\/\\s])(npm(?:\\.cmd)?|npm-cli\\.js|pnpm(?:\\.cmd)?|yarn(?:\\.cmd)?|bun(?:\\.exe)?|corepack(?:\\.cmd)?|curl(?:\\.exe)?|wget(?:\\.exe)?)(?:$|[\\s])/i;
const record = (kind, detail) => {
	appendFileSync(attemptLogPath, \`\${kind}: \${detail}\\n\`);
	throw new Error(\`offline guard blocked \${kind}: \${detail}\`);
};
const wrapCommand = (original) => function(command, args = [], ...rest) {
	const detail = [String(command), ...(Array.isArray(args) ? args.map(String) : [String(args)])].join(" ");
	if (blockedCommands.test(detail)) record("command", detail);
	return original.call(this, command, args, ...rest);
};
for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
	childProcess[name] = wrapCommand(childProcess[name]);
}
for (const module of [http, https]) {
	module.request = (...args) => record("network", String(args[0]));
	module.get = (...args) => record("network", String(args[0]));
}
net.connect = (...args) => record("network", String(args[0]));
net.createConnection = (...args) => record("network", String(args[0]));
tls.connect = (...args) => record("network", String(args[0]));
globalThis.fetch = (...args) => record("fetch", String(args[0]));
syncBuiltinESMExports();
`,
		"utf8",
	);
}

test("native bundle retains authenticated offline repair across two launches", async (context) => {
	const fixture = await createNativeRuntimeFixture({ launchable: true });
	context.after(() => rmSync(fixture.root, { recursive: true, force: true }));

	assert.equal(
		runtimeWorkspaceCompletionMatches(fixture.workspaceDir, {
			archivePath: fixture.archivePath,
			digestPath: fixture.digestPath,
		}),
		true,
	);
	finalizeNativeRuntimeWorkspace(fixture.appDir);

	assert.equal(existsSync(fixture.archivePath), true);
	assert.equal(existsSync(fixture.digestPath), true);
	const completion = JSON.parse(readFileSync(fixture.completionPath, "utf8"));
	assert.equal(completion.source, "archive");
	assert.equal("archiveSha256" in completion, true);
	assert.equal("archiveTreeHash" in completion, true);
	assert.equal(
		runtimeWorkspaceCompletionMatches(fixture.workspaceDir, {
			archivePath: fixture.archivePath,
			digestPath: fixture.digestPath,
		}),
		true,
	);

	const completionSource = readFileSync(fixture.completionPath, "utf8");
	const isolatedHome = join(fixture.root, "home");
	const guardPath = join(fixture.root, "offline-guard.mjs");
	const attemptLogPath = join(fixture.root, "offline-attempts.log");
	mkdirSync(isolatedHome, { recursive: true });
	writeOfflineGuard(guardPath, attemptLogPath);

	for (let launch = 1; launch <= 2; launch += 1) {
		if (launch === 2) {
			rmSync(
				join(
					fixture.workspaceDir,
					"node_modules",
					"runtime-package",
					"index.js",
				),
			);
		}
		const result = spawnSync(
			process.execPath,
			[join(fixture.appDir, "bin", "feynman.js")],
			{
				cwd: fixture.appDir,
				encoding: "utf8",
				env: {
					...process.env,
					FEYNMAN_HOME: isolatedHome,
					FEYNMAN_SKIP_PANDOC_INSTALL: "1",
					HOME: isolatedHome,
					NODE_OPTIONS: `--import=${pathToFileURL(guardPath).href}`,
				},
			},
		);
		assert.equal(
			result.status,
			0,
			`launch ${launch} failed:\n${result.stderr}\n${result.stdout}`,
		);
		assert.match(result.stdout, /native fixture launched/);
		assert.equal(existsSync(attemptLogPath), false);
		assert.equal(readFileSync(fixture.completionPath, "utf8"), completionSource);
		assert.equal(existsSync(fixture.archivePath), true);
		assert.equal(existsSync(fixture.digestPath), true);
	}
});

test("native bundle finalization refuses to bless package-manager state", async (context) => {
	const fixture = await createNativeRuntimeFixture();
	context.after(() => rmSync(fixture.root, { recursive: true, force: true }));

	writeRuntimeWorkspaceCompletion(fixture.workspaceDir, {
		source: "package-manager",
		runtimeTreeHash: computeRuntimeTreeHash(fixture.workspaceDir),
	});
	assert.throws(
		() => finalizeNativeRuntimeWorkspace(fixture.appDir),
		/will not bless package-manager completion state/,
	);
	assert.equal(existsSync(fixture.archivePath), true);
	assert.equal(existsSync(fixture.digestPath), true);
	assert.equal(
		JSON.parse(readFileSync(fixture.completionPath, "utf8")).source,
		"package-manager",
	);
});

test("native bundle finalization refuses a changed runtime tree", async (context) => {
	const fixture = await createNativeRuntimeFixture();
	context.after(() => rmSync(fixture.root, { recursive: true, force: true }));

	writeFileSync(
		join(
			fixture.workspaceDir,
			"node_modules",
			"runtime-package",
			"index.js",
		),
		"export const ready = nope;\n",
	);
	assert.throws(
		() => finalizeNativeRuntimeWorkspace(fixture.appDir),
		/requires a valid archive-backed completion|detected changes after archive verification/,
	);
	assert.equal(existsSync(fixture.archivePath), true);
	assert.equal(existsSync(fixture.digestPath), true);
	assert.equal(
		JSON.parse(readFileSync(fixture.completionPath, "utf8")).source,
		"archive",
	);
});
