import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
	assertPiDocparserInvisibleTextVersion,
	PI_DOCPARSER_INVISIBLE_TEXT_PATCH_TARGETS,
	PI_DOCPARSER_INVISIBLE_TEXT_REQUIRED_VERSION,
	patchPiDocparserInvisibleTextSource,
} from "./pi-docparser-invisible-text-patch.mjs";

function resolveExistingRoot(root) {
	if (!existsSync(root)) return null;
	try {
		return realpathSync(root);
	} catch {
		return root;
	}
}

export function patchPiDocparserRuntimeRoots({ bundledRoot, roots }) {
	const resolvedBundledRoot = resolveExistingRoot(bundledRoot);
	let changed = false;
	for (const packageRoot of new Set(roots.map(resolveExistingRoot).filter(Boolean))) {
		const version = JSON.parse(
			readFileSync(resolve(packageRoot, "package.json"), "utf8"),
		).version;
		if (
			version !== PI_DOCPARSER_INVISIBLE_TEXT_REQUIRED_VERSION &&
			packageRoot !== resolvedBundledRoot
		) continue;
		assertPiDocparserInvisibleTextVersion(version, packageRoot);
		for (const relativePath of PI_DOCPARSER_INVISIBLE_TEXT_PATCH_TARGETS) {
			const entryPath = resolve(packageRoot, ...relativePath.split("/"));
			if (!existsSync(entryPath)) {
				throw new Error(`pi-docparser invisible-text patch target is missing: ${entryPath}`);
			}
			const source = readFileSync(entryPath, "utf8");
			const patched = patchPiDocparserInvisibleTextSource(relativePath, source);
			if (patched === source) continue;
			writeFileSync(entryPath, patched, "utf8");
			changed = true;
		}
	}
	return changed;
}
