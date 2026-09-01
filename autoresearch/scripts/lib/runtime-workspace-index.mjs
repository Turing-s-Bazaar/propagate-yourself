import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	readFileSync,
	readdirSync,
	readlinkSync,
} from "node:fs";
import { relative, resolve } from "node:path";

const EXCLUDED_LABELS = new Set([
	".runtime-manifest.json",
	".runtime-workspace.complete.json",
]);

function normalizeLabel(rootPath, path) {
	const label = relative(rootPath, path).replaceAll("\\", "/");
	if (
		!label ||
		label.startsWith("/") ||
		/^[a-zA-Z]:\//.test(label) ||
		label === ".." ||
		label.startsWith("../") ||
		label.includes("/../")
	) {
		throw new Error(`Invalid runtime workspace index path: ${label}`);
	}
	return label;
}

function compareLabels(left, right) {
	return left.label < right.label ? -1 : left.label > right.label ? 1 : 0;
}

function fileSha256(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function collectEntries(rootPath, currentPath, entries, includeHashes) {
	for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
		const path = resolve(currentPath, entry.name);
		const label = normalizeLabel(rootPath, path);
		if (EXCLUDED_LABELS.has(label)) continue;
		if (entry.isDirectory()) {
			collectEntries(rootPath, path, entries, includeHashes);
			continue;
		}
		if (entry.isSymbolicLink()) {
			entries.push({
				label,
				type: "symlink",
				value: readlinkSync(path).replaceAll("\\", "/"),
			});
			continue;
		}
		if (!entry.isFile() && !lstatSync(path).isFile()) {
			throw new Error(`Unsupported runtime workspace index entry: ${path}`);
		}
		const stat = lstatSync(path);
		if ((stat.mode & 0o7000) !== 0) {
			throw new Error(
				`Unsupported special runtime workspace mode: ${path}`,
			);
		}
		entries.push({
			label,
			mode: stat.mode & 0o111 ? "x" : "-",
			size: stat.size,
			type: "file",
			...(includeHashes ? { value: fileSha256(path) } : {}),
		});
	}
}

function hashEntries(entries) {
	const hash = createHash("sha256");
	for (const entry of entries) {
		hash.update(entry.label);
		hash.update("\0");
		hash.update(entry.type);
		hash.update("\0");
		hash.update(entry.mode ?? "");
		hash.update("\0");
		hash.update(entry.value);
		hash.update("\0");
	}
	return hash.digest("hex");
}

function hashShapeEntries(entries) {
	const hash = createHash("sha256");
	for (const entry of entries) {
		hash.update(entry.label);
		hash.update("\0");
		hash.update(entry.type);
		hash.update("\0");
		hash.update(entry.mode ?? "");
		hash.update("\0");
		hash.update(String(entry.size ?? ""));
		hash.update("\0");
		if (entry.type === "symlink") {
			hash.update(entry.value);
			hash.update("\0");
		}
	}
	return hash.digest("hex");
}

export function createRuntimeWorkspaceIntegrityIndex(workspaceDir) {
	if (!existsSync(workspaceDir)) {
		throw new Error(`Runtime workspace does not exist: ${workspaceDir}`);
	}
	const entries = [];
	// Completion is written only after the authenticated archive or exact
	// package-lock install has been fully verified. Compute its byte identity
	// serially on that rare setup path; steady launches use only the portable
	// structural index below and never create worker threads.
	collectEntries(workspaceDir, workspaceDir, entries, true);
	entries.sort(compareLabels);
	return {
		runtimeTreeHash: hashEntries(entries),
		integrityShapeHash: hashShapeEntries(entries),
	};
}

export function runtimeWorkspaceIntegrityIndexMatches(
	workspaceDir,
	expectedShapeHash,
	expectedTreeHash,
) {
	if (
		typeof expectedShapeHash !== "string" ||
		!/^[a-f0-9]{64}$/.test(expectedShapeHash) ||
		typeof expectedTreeHash !== "string" ||
		!/^[a-f0-9]{64}$/.test(expectedTreeHash)
	) {
		return false;
	}
	try {
		const actualEntries = [];
		collectEntries(workspaceDir, workspaceDir, actualEntries, true);
		actualEntries.sort(compareLabels);
		// Completion is a security boundary, not merely a shape cache. Bind it
		// to both the portable path/type/mode/size index and the actual bytes so
		// a substituted marker and package lock cannot bless same-size payload
		// changes.
		return (
			hashShapeEntries(actualEntries) === expectedShapeHash &&
			hashEntries(actualEntries) === expectedTreeHash
		);
	} catch {
		return false;
	}
}
