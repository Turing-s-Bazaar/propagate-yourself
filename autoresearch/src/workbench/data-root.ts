import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { ensureFeynmanActiveOrg, getFeynmanActiveOrgDir, getFeynmanHome } from "../config/paths.js";

const WORKBENCH_DATA_SCHEMA = "feynman.workbenchDataRoot.v1";
const WORKBENCH_INDEX_SCHEMA = "feynman.workbenchWorkspaceIndex.v1";

function nowIso(): string {
	return new Date().toISOString();
}

function toPosixPath(path: string): string {
	return path.split(sep).join("/");
}

function canonicalWorkspacePath(workingDir: string): string {
	const resolved = resolve(workingDir);
	try {
		return realpathSync.native(resolved);
	} catch {
		return resolved;
	}
}

function workspaceIdFromPath(workingDir: string): string {
	const workspace = canonicalWorkspacePath(workingDir);
	const name = workspace.split(/[\\/]/).filter(Boolean).at(-1) ?? "workspace";
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48) || "workspace";
	const hash = createHash("sha256").update(workspace).digest("hex").slice(0, 12);
	return `${slug}-${hash}`;
}

export function getWorkbenchDataHome(): string {
	const override = process.env.FEYNMAN_WORKBENCH_HOME?.trim();
	return override ? resolve(override) : resolve(getFeynmanActiveOrgDir(), "workbench");
}

export function getLegacyWorkbenchDataHome(home = getFeynmanHome()): string {
	return resolve(home, "workbench");
}

export function getWorkbenchWorkspaceId(workingDir: string): string {
	return workspaceIdFromPath(workingDir);
}

export function getWorkbenchDataRoot(workingDir: string): string {
	return resolve(getWorkbenchDataHome(), "workspaces", getWorkbenchWorkspaceId(workingDir));
}

export function getLegacyHomeWorkbenchDataRoot(workingDir: string): string {
	return resolve(getLegacyWorkbenchDataHome(), "workspaces", getWorkbenchWorkspaceId(workingDir));
}

export function getLegacyWorkbenchDataRoot(workingDir: string): string {
	return resolve(workingDir, ".feynman", "workbench");
}

export function legacyWorkbenchDataPath(workingDir: string, ...segments: string[]): string {
	return resolve(getLegacyWorkbenchDataRoot(workingDir), ...segments);
}

function writeWorkspaceManifest(workingDir: string, root: string): void {
	const activeOrg = ensureFeynmanActiveOrg();
	const path = join(root, "workspace.json");
	const createdAt = (() => {
		if (!existsSync(path)) return nowIso();
		try {
			const parsed = JSON.parse(readFileSync(path, "utf8")) as { createdAt?: unknown };
			return typeof parsed.createdAt === "string" ? parsed.createdAt : nowIso();
		} catch {
			return nowIso();
		}
	})();
	writeFileSync(path, `${JSON.stringify({
		schema: WORKBENCH_DATA_SCHEMA,
		orgUuid: activeOrg.org_uuid,
		workspaceId: getWorkbenchWorkspaceId(workingDir),
		workingDir: canonicalWorkspacePath(workingDir),
		dataRoot: root,
		workbenchDataHome: getWorkbenchDataHome(),
		legacyHomeWorkbenchDataRoot: getLegacyHomeWorkbenchDataRoot(workingDir),
		legacyWorkbenchDataRoot: getLegacyWorkbenchDataRoot(workingDir),
		createdAt,
		updatedAt: nowIso(),
	}, null, 2)}\n`, "utf8");
}

function writeWorkbenchIndex(workingDir: string, root: string): void {
	const activeOrg = ensureFeynmanActiveOrg();
	const path = resolve(getWorkbenchDataHome(), "workspaces.json");
	const workspaceId = getWorkbenchWorkspaceId(workingDir);
	const canonical = canonicalWorkspacePath(workingDir);
	type WorkspaceIndex = {
		schema: typeof WORKBENCH_INDEX_SCHEMA;
		orgUuid: string;
		updatedAt: string;
		workspaces: Array<{
			workspaceId: string;
			workingDir: string;
			dataRoot: string;
			legacyWorkbenchDataRoot: string;
			createdAt: string;
			updatedAt: string;
		}>;
	};
	const now = nowIso();
	const existing: WorkspaceIndex = (() => {
		if (!existsSync(path)) {
			return {
				schema: WORKBENCH_INDEX_SCHEMA,
				orgUuid: activeOrg.org_uuid,
				updatedAt: now,
				workspaces: [],
			};
		}
		try {
			const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<WorkspaceIndex>;
			return {
				schema: WORKBENCH_INDEX_SCHEMA,
				orgUuid: activeOrg.org_uuid,
				updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : now,
				workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces.filter((workspace) => (
					workspace
					&& typeof workspace.workspaceId === "string"
					&& typeof workspace.workingDir === "string"
					&& typeof workspace.dataRoot === "string"
				)).map((workspace) => ({
					workspaceId: workspace.workspaceId,
					workingDir: workspace.workingDir,
					dataRoot: workspace.dataRoot,
					legacyWorkbenchDataRoot: typeof workspace.legacyWorkbenchDataRoot === "string" ? workspace.legacyWorkbenchDataRoot : "",
					createdAt: typeof workspace.createdAt === "string" ? workspace.createdAt : now,
					updatedAt: typeof workspace.updatedAt === "string" ? workspace.updatedAt : now,
				})) : [],
			};
		} catch {
			return {
				schema: WORKBENCH_INDEX_SCHEMA,
				orgUuid: activeOrg.org_uuid,
				updatedAt: now,
				workspaces: [],
			};
		}
	})();
	const previous = existing.workspaces.find((workspace) => workspace.workspaceId === workspaceId);
	const nextWorkspace = {
		workspaceId,
		workingDir: canonical,
		dataRoot: root,
		legacyWorkbenchDataRoot: getLegacyWorkbenchDataRoot(workingDir),
		createdAt: previous?.createdAt ?? now,
		updatedAt: now,
	};
	const workspaces = [
		...existing.workspaces.filter((workspace) => workspace.workspaceId !== workspaceId),
		nextWorkspace,
	].sort((left, right) => left.workspaceId.localeCompare(right.workspaceId));
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({
		schema: WORKBENCH_INDEX_SCHEMA,
		orgUuid: activeOrg.org_uuid,
		updatedAt: now,
		workspaces,
	}, null, 2)}\n`, "utf8");
}

export function ensureWorkbenchDataRoot(workingDir: string): string {
	const root = getWorkbenchDataRoot(workingDir);
	copyLegacyPathIfNeeded(workingDir, root, getLegacyHomeWorkbenchDataRoot(workingDir));
	mkdirSync(root, { recursive: true });
	writeWorkspaceManifest(workingDir, root);
	writeWorkbenchIndex(workingDir, root);
	return root;
}

export function workbenchDataPath(workingDir: string, ...segments: string[]): string {
	return resolve(ensureWorkbenchDataRoot(workingDir), ...segments);
}

function copyLegacyPathIfNeeded(workingDir: string, target: string, source: string): void {
	if (existsSync(target) || !existsSync(source)) return;
	const sourceStat = statSync(source);
	if (!sourceStat.isFile() && !sourceStat.isDirectory()) return;
	mkdirSync(dirname(target), { recursive: true });
	cpSync(source, target, { recursive: sourceStat.isDirectory(), errorOnExist: false, force: false });
}

export function migratedWorkbenchDataPath(workingDir: string, ...segments: string[]): string {
	const target = workbenchDataPath(workingDir, ...segments);
	copyLegacyPathIfNeeded(workingDir, target, resolve(getLegacyHomeWorkbenchDataRoot(workingDir), ...segments));
	copyLegacyPathIfNeeded(workingDir, target, legacyWorkbenchDataPath(workingDir, ...segments));
	return target;
}

export function isInsideDirectory(root: string, candidate: string): boolean {
	const base = resolve(root);
	const absolutePath = resolve(candidate);
	const rel = toPosixPath(relative(base, absolutePath));
	return Boolean(rel) && rel !== ".." && !rel.startsWith("../") && !rel.split("/").includes("..");
}

export function resolveWorkbenchStoredPath(workingDir: string, storedPath: string): string {
	const path = storedPath.trim();
	if (isAbsolute(path)) return resolve(path);
	return resolve(workingDir, path);
}
