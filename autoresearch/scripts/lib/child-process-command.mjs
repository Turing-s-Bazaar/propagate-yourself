import { existsSync } from "node:fs";

// Adapted from cross-spawn's MIT-licensed Windows escaping algorithm. cmd.exe
// expands metacharacters (including %VAR%) even inside quotes, so every token
// must be escaped before the final /s /c command string is assembled.
const WINDOWS_CMD_META_CHARACTERS = /([()\][%!^"`<>&|;, *?])/g;

function escapeWindowsCmdCommand(command) {
	return `${command}`.replace(WINDOWS_CMD_META_CHARACTERS, "^$1");
}

function escapeWindowsCmdArgument(argument) {
	let escaped = `${argument}`;
	escaped = escaped.replace(/(?=(\\+?)?)\1"/g, "$1$1\\\"");
	escaped = escaped.replace(/(?=(\\+?)?)\1$/, "$1$1");
	escaped = `"${escaped}"`;
	return escaped.replace(WINDOWS_CMD_META_CHARACTERS, "^$1");
}

export function resolveChildProcessExecutable(
	command,
	options = {},
) {
	const platform = options.platform ?? process.platform;
	const fileExists = options.fileExists ?? existsSync;
	if (platform !== "win32" || /\.[^\\/]+$/.test(command)) {
		return command;
	}

	// npm creates an extensionless POSIX shell shim alongside Windows launchers.
	// Node cannot execute that shell shim directly on Windows, so prefer PATHEXT
	// candidates even when the extensionless path itself exists.
	for (const extension of [".cmd", ".bat", ".exe"]) {
		const candidate = `${command}${extension}`;
		if (fileExists(candidate)) {
			return candidate;
		}
	}
	return command;
}

export function resolveChildProcessCommand(
	command,
	args,
	options = {},
) {
	const platform = options.platform ?? process.platform;
	const executable = resolveChildProcessExecutable(command, options);
	if (platform !== "win32" || !/\.(?:cmd|bat)$/i.test(executable)) {
		return { command: executable, args, shell: false, windowsVerbatimArguments: false };
	}

	const comSpec = options.comSpec ?? process.env.ComSpec ?? "cmd.exe";
	const commandLine = [
		escapeWindowsCmdCommand(executable),
		...args.map(escapeWindowsCmdArgument),
	].join(" ");
	return {
		command: comSpec,
		args: ["/d", "/s", "/v:off", "/c", `"${commandLine}"`],
		shell: false,
		windowsVerbatimArguments: true,
	};
}
