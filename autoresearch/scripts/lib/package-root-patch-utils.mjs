import {
	existsSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

export function uniqueExistingPackageRoots(roots) {
	return new Set(
		roots
			.filter((root) => existsSync(root))
			.map((root) => {
				try {
					return realpathSync(root);
				} catch {
					return root;
				}
			}),
	);
}

export function preflightPackageRootPatch({
	packageRoot,
	packageName,
	requiredVersion,
	targets,
	patchSource,
}) {
	if (!existsSync(packageRoot)) return undefined;
	const manifestPath = resolve(packageRoot, "package.json");
	if (!existsSync(manifestPath)) {
		throw new Error(`${packageName} package manifest is missing: ${manifestPath}`);
	}
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	if (manifest.name !== packageName || manifest.version !== requiredVersion) {
		throw new Error(
			`Unsupported ${packageName} package ${packageRoot}: expected ${packageName}@${requiredVersion}, found ${manifest.name ?? "missing"}@${manifest.version ?? "missing"}`,
		);
	}
	const entries = [];
	for (const relativePath of targets) {
		const path = resolve(packageRoot, ...relativePath.split("/"));
		if (!existsSync(path)) {
			throw new Error(`${packageName} patch target is missing: ${path}`);
		}
		const source = readFileSync(path, "utf8");
		entries.push({
			packageRoot,
			relativePath,
			path,
			source,
			patched: patchSource(relativePath, source),
		});
	}
	return { packageName, packageRoot, entries };
}

export function applyPackageRootPatchPlans(plans) {
	const entries = plans
		.filter(Boolean)
		.flatMap((plan) => plan.entries)
		.filter((entry) => entry.patched !== entry.source);
	for (const entry of entries) {
		const current = readFileSync(entry.path, "utf8");
		if (current !== entry.source) {
			throw new Error(
				`Package patch source changed after preflight: ${entry.path}`,
			);
		}
	}
	for (const entry of entries) {
		writeFileSync(entry.path, entry.patched, "utf8");
	}
	return entries.length > 0;
}
