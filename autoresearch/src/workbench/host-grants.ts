import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

import type { WorkbenchHostGrant } from "./types.js";

const LOCAL_USER_ID = "local-workbench";

const GRANTED_PATHS: Array<{ relPath: string; mountName: string; mode: "ro" | "rw"; source: string }> = [
	{ relPath: "outputs", mountName: "outputs", mode: "rw", source: "Workbench artifacts" },
	{ relPath: "papers", mountName: "papers", mode: "rw", source: "Workbench artifacts" },
	{ relPath: "notes", mountName: "notes", mode: "rw", source: "Workbench artifacts" },
	{ relPath: "CHANGELOG.md", mountName: "lab-notebook", mode: "ro", source: "Workspace lab notebook" },
];

function stableUuid(namespace: string, value: string): string {
	const bytes = createHash("sha256").update(`${namespace}:${value}`).digest().subarray(0, 16);
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function timestampForPath(path: string, fallbackPath: string): { iso: string; ms: number } {
	const candidate = existsSync(path) ? path : fallbackPath;
	if (!existsSync(candidate)) return { iso: new Date(0).toISOString(), ms: 0 };
	const stat = statSync(candidate);
	const ms = stat.birthtimeMs || stat.ctimeMs || stat.mtimeMs || 0;
	const safeMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
	return { iso: new Date(safeMs).toISOString(), ms: safeMs };
}

export function buildWorkbenchHostGrants(workingDir: string): WorkbenchHostGrant[] {
	const workspace = resolve(workingDir);
	return GRANTED_PATHS.map((grant) => {
		const hostPath = resolve(workspace, grant.relPath);
		const created = timestampForPath(hostPath, workspace);
		return {
			id: stableUuid("feynman-host-grant", `${LOCAL_USER_ID}:${hostPath}`),
			userId: LOCAL_USER_ID,
			hostPath,
			mountName: grant.mountName,
			mode: grant.mode,
			createdAt: created.iso,
			createdAtMs: created.ms,
			source: grant.source,
			exists: existsSync(hostPath),
		};
	}).sort((a, b) => a.hostPath.localeCompare(b.hostPath));
}
