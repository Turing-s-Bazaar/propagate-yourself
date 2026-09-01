import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

// Windows cannot spawn `npm`/`npm.cmd` without a shell (EINVAL since the
// CVE-2024-27980 hardening), and shell spawns with an args array trip
// DEP0190. Preferring the npm-cli.js entry point next to the running Node
// executable avoids both: it is a plain Node script spawn on every platform.
export function resolveAdjacentNpmCommand(nodeExecutablePath = process.execPath, platform = process.platform) {
	const executableDir = dirname(nodeExecutablePath);
	if (platform === "win32") {
		const npmCliPath = resolve(executableDir, "node_modules", "npm", "bin", "npm-cli.js");
		if (existsSync(npmCliPath)) {
			return { command: nodeExecutablePath, args: [npmCliPath] };
		}
		const npmCmdPath = resolve(executableDir, "npm.cmd");
		return existsSync(npmCmdPath) ? { command: npmCmdPath, args: [], shell: true } : undefined;
	}

	const candidate = resolve(executableDir, "npm");
	return existsSync(candidate) ? { command: candidate, args: [] } : undefined;
}
