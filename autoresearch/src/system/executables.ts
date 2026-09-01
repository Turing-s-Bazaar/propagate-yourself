import { execFile, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, delimiter } from "node:path";

const isWindows = process.platform === "win32";
const programFiles = process.env.PROGRAMFILES ?? "C:\\Program Files";
const localAppData = process.env.LOCALAPPDATA ?? "";

export const PANDOC_FALLBACK_PATHS = isWindows
	? [`${programFiles}\\Pandoc\\pandoc.exe`]
	: ["/opt/homebrew/bin/pandoc", "/usr/local/bin/pandoc"];

export const BREW_FALLBACK_PATHS = isWindows
	? []
	: ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"];

export const BROWSER_FALLBACK_PATHS = isWindows
	? [
			`${programFiles}\\Google\\Chrome\\Application\\chrome.exe`,
			`${programFiles} (x86)\\Google\\Chrome\\Application\\chrome.exe`,
			`${localAppData}\\Google\\Chrome\\Application\\chrome.exe`,
			`${programFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
			`${programFiles}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
		]
	: [
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Chromium.app/Contents/MacOS/Chromium",
			"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
			"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
		];

export const MERMAID_FALLBACK_PATHS = isWindows
	? []
	: ["/opt/homebrew/bin/mmdc", "/usr/local/bin/mmdc"];

function findInFallbackPaths(fallbackPaths: string[]): string | undefined {
	for (const candidate of fallbackPaths) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

function parseExecutablePath(stdout: string): string | undefined {
	const resolved = stdout.trim().split(/\r?\n/)[0];
	return resolved || undefined;
}

function executableCommand(name: string): { command: string; args: string[] } {
	return isWindows ? { command: "cmd", args: ["/c", `where ${name}`] } : { command: "sh", args: ["-c", `command -v ${name}`] };
}

export function resolveExecutable(name: string, fallbackPaths: string[] = []): string | undefined {
	const fallback = findInFallbackPaths(fallbackPaths);
	if (fallback) {
		return fallback;
	}

	const command = executableCommand(name);
	const env = {
		...process.env,
		PATH: process.env.PATH ?? "",
	};
	const result = spawnSync(command.command, command.args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
		env,
	});

	if (result.status === 0) {
		const resolved = parseExecutablePath(result.stdout);
		if (resolved) {
			return resolved;
		}
	}

	return undefined;
}

export async function resolveExecutableAsync(name: string, fallbackPaths: string[] = []): Promise<string | undefined> {
	const fallback = findInFallbackPaths(fallbackPaths);
	if (fallback) {
		return fallback;
	}

	const command = executableCommand(name);
	const env = {
		...process.env,
		PATH: process.env.PATH ?? "",
	};

	return new Promise((resolvePromise) => {
		execFile(command.command, command.args, { encoding: "utf8", env }, (_error, stdout) => {
			resolvePromise(parseExecutablePath(stdout ?? ""));
		});
	});
}

export type ResolvedExecutables = {
	pandoc: string | undefined;
	mermaid: string | undefined;
	browser: string | undefined;
};

export async function resolveAllExecutables(): Promise<ResolvedExecutables> {
	const [pandoc, mermaid, browser] = await Promise.all([
		resolveExecutableAsync("pandoc", PANDOC_FALLBACK_PATHS),
		resolveExecutableAsync("mmdc", MERMAID_FALLBACK_PATHS),
		resolveExecutableAsync("google-chrome", BROWSER_FALLBACK_PATHS),
	]);
	return { pandoc, mermaid, browser };
}

export function getPathWithCurrentNode(pathValue = process.env.PATH ?? ""): string {
	const nodeDir = dirname(process.execPath);
	const parts = pathValue.split(delimiter).filter(Boolean);
	return parts.includes(nodeDir) ? pathValue : `${nodeDir}${delimiter}${pathValue}`;
}
