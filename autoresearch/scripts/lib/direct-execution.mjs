import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function isDirectExecution(
	entryPath,
	modulePath = fileURLToPath(import.meta.url),
) {
	if (!entryPath) return false;
	try {
		return realpathSync(entryPath) === realpathSync(modulePath);
	} catch {
		return resolve(entryPath) === resolve(modulePath);
	}
}
