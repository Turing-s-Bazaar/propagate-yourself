import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

function handleStdinError(error: unknown): void {
	if (!error || typeof error !== "object") return;
	const code = "code" in error ? error.code : undefined;
	const syscall = "syscall" in error ? error.syscall : undefined;
	if ((code === "EIO" || code === "EBADF") && syscall === "read") {
		return;
	}
	throw error;
}

async function run(): Promise<void> {
	const [piMainPath, ...args] = process.argv.slice(2);
	if (!piMainPath) {
		throw new Error("Missing Pi main module path.");
	}
	const piCliPath = join(dirname(piMainPath), "cli.js");
	if (!process.env.FEYNMAN_PI_CLI_PATH && existsSync(piCliPath)) {
		process.env.FEYNMAN_PI_CLI_PATH = piCliPath;
	}

	process.title = "feynman";
	process.env.PI_CODING_AGENT = "true";
	process.emitWarning = (() => undefined) as typeof process.emitWarning;
	process.stdin?.on?.("error", handleStdinError);
	setGlobalDispatcher(new EnvHttpProxyAgent());

	const module = (await import(pathToFileURL(piMainPath).href)) as {
		main?: (args: string[]) => Promise<void>;
	};
	if (typeof module.main !== "function") {
		throw new Error(`Pi main module does not export main(): ${piMainPath}`);
	}

	await module.main(args);
}

try {
	await run();
	process.exit(process.exitCode ?? 0);
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
