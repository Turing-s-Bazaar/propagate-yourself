import assert from "node:assert/strict";
import test from "node:test";

import {
	resolveChildProcessCommand,
	resolveChildProcessExecutable,
} from "../scripts/lib/child-process-command.mjs";

test("Windows extensionless npm launchers prefer the CMD shim over the existing Git Bash shim", () => {
	const command = "C:\\consumer\\node_modules\\.bin\\feynman";
	const fileExists = (path: string) => path === command || path === `${command}.cmd`;
	const resolved = resolveChildProcessExecutable(command, {
		platform: "win32",
		fileExists,
	});
	assert.equal(resolved, `${command}.cmd`);
	assert.equal(
		resolveChildProcessCommand(command, ["--mode", "rpc"], {
			platform: "win32",
			comSpec: "C:\\Windows\\System32\\cmd.exe",
			fileExists,
		}).command,
		"C:\\Windows\\System32\\cmd.exe",
	);
});

test("Windows extensionless launchers fall back through CMD, BAT, and EXE", () => {
	const command = "C:\\feynman\\bin\\feynman";
	for (const extension of [".cmd", ".bat", ".exe"]) {
		assert.equal(
			resolveChildProcessExecutable(command, {
				platform: "win32",
				fileExists: (path) => path === `${command}${extension}`,
			}),
			`${command}${extension}`,
		);
	}
	assert.equal(
		resolveChildProcessExecutable(command, {
			platform: "win32",
			fileExists: (path) => path === command,
		}),
		command,
	);
});

test("Windows launcher resolution prefers the first executable candidate", () => {
	const command = "C:\\feynman\\bin\\feynman";
	assert.equal(
		resolveChildProcessExecutable(command, {
			platform: "win32",
			fileExists: (path) => [".cmd", ".bat", ".exe"].some((extension) => path === `${command}${extension}`),
		}),
		`${command}.cmd`,
	);
});

test("Windows command shims use explicit ComSpec without shell args", () => {
	assert.deepEqual(
		resolveChildProcessCommand(
			"C:\\Program Files\\Feynman Test\\feynman.cmd",
			["--mode", "rpc"],
			{ platform: "win32", comSpec: "C:\\Windows\\System32\\cmd.exe" },
		),
		{
			command: "C:\\Windows\\System32\\cmd.exe",
			args: [
				"/d",
				"/s",
				"/v:off",
				"/c",
				'"C:\\Program^ Files\\Feynman^ Test\\feynman.cmd ^"--mode^" ^"rpc^""',
			],
			shell: false,
			windowsVerbatimArguments: true,
		},
	);
});

test("explicit Windows executables remain direct child processes", () => {
	assert.deepEqual(
		resolveChildProcessCommand("C:\\feynman\\bin\\feynman.exe", ["--mode", "rpc"], {
			platform: "win32",
			fileExists: () => false,
		}),
		{
			command: "C:\\feynman\\bin\\feynman.exe",
			args: ["--mode", "rpc"],
			shell: false,
			windowsVerbatimArguments: false,
		},
	);
});

test("plain executables remain direct child processes", () => {
	assert.deepEqual(
		resolveChildProcessCommand("/tmp/Feynman Test/feynman", ["--mode", "rpc"], {
			platform: "darwin",
		}),
		{
			command: "/tmp/Feynman Test/feynman",
			args: ["--mode", "rpc"],
			shell: false,
			windowsVerbatimArguments: false,
		},
	);
});

test("Windows command shims escape percent expansion and shell metacharacters", () => {
	const invocation = resolveChildProcessCommand(
		"C:\\Users\\100%REAL%\\Feynman & Test\\feynman.cmd",
		['quoted"value', "percent%PATH%", "caret^bang!amp&pipe|"],
		{ platform: "win32", comSpec: "C:\\Windows\\System32\\cmd.exe" },
	);
	assert.equal(invocation.shell, false);
	assert.equal(invocation.windowsVerbatimArguments, true);
	assert.equal(
		invocation.args.at(-1),
		'"C:\\Users\\100^%REAL^%\\Feynman^ ^&^ Test\\feynman.cmd ^"quoted\\^"value^" ^"percent^%PATH^%^" ^"caret^^bang^!amp^&pipe^|^""',
	);
});
