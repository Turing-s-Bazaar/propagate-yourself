import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import type { WorkbenchCustomSkill, WorkbenchMarketplaceSource, WorkbenchSkillLicenseAssent } from "./types.js";

const LOCAL_USER_ID = "local-workbench";
const LOCAL_ORG_ID = "local-workspace";
const LOCAL_PROJECT_ID = "workspace";
const NOTICE_VERSION = "feynman-owned-skill-pack-v1";
const NOTICE_TEXT = "Feynman-owned local project skill loaded from this workspace under the package license.";

function stableUuid(namespace: string, value: string): string {
	const bytes = createHash("sha256").update(`${namespace}:${value}`).digest().subarray(0, 16);
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function timestampFromMs(ms: number): { iso: string; ms: number } {
	const safeMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
	return { iso: new Date(safeMs).toISOString(), ms: safeMs };
}

function readPackageLicense(workingDir: string): string {
	const packagePath = resolve(workingDir, "package.json");
	if (!existsSync(packagePath)) return "workspace";
	try {
		const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as { license?: unknown };
		return typeof parsed.license === "string" && parsed.license.trim() ? parsed.license.trim().slice(0, 100) : "workspace";
	} catch {
		return "workspace";
	}
}

function readPackageCreatedAt(workingDir: string): number {
	const packagePath = resolve(workingDir, "package.json");
	if (!existsSync(packagePath)) return 0;
	const stat = statSync(packagePath);
	return stat.birthtimeMs || stat.ctimeMs || stat.mtimeMs;
}

function skillPackHash(customSkills: WorkbenchCustomSkill[]): string {
	const hash = createHash("sha1");
	for (const skill of [...customSkills].sort((a, b) => a.path.localeCompare(b.path))) {
		hash.update(skill.path);
		hash.update("\0");
		hash.update(skill.name);
		hash.update("\0");
		hash.update(skill.updatedAtMs.toString());
		hash.update("\0");
		hash.update(createHash("sha256").update(skill.content).digest("hex"));
		hash.update("\0");
	}
	return hash.digest("hex");
}

function skillPackTimestamps(workingDir: string, customSkills: WorkbenchCustomSkill[]): {
	createdAt: string;
	createdAtMs: number;
	lastImportedAt: string;
	lastImportedAtMs: number;
} {
	const createdCandidates = customSkills.map((skill) => skill.createdAtMs).filter((value) => value > 0);
	const importedCandidates = customSkills.map((skill) => skill.updatedAtMs).filter((value) => value > 0);
	const packageMs = readPackageCreatedAt(workingDir);
	if (packageMs > 0) {
		createdCandidates.push(packageMs);
		importedCandidates.push(packageMs);
	}
	const created = timestampFromMs(createdCandidates.length ? Math.min(...createdCandidates) : 0);
	const imported = timestampFromMs(importedCandidates.length ? Math.max(...importedCandidates) : 0);
	return {
		createdAt: created.iso,
		createdAtMs: created.ms,
		lastImportedAt: imported.iso,
		lastImportedAtMs: imported.ms,
	};
}

function marketplaceSource(workingDir: string, customSkills: WorkbenchCustomSkill[]): WorkbenchMarketplaceSource[] {
	if (customSkills.length === 0) return [];
	const slug = "feynman-science-skill-pack";
	const timestamps = skillPackTimestamps(workingDir, customSkills);
	const offeredSkills = Array.from(new Set(customSkills.map((skill) => skill.name))).sort();
	return [{
		id: stableUuid("feynman-marketplace-source", `${LOCAL_USER_ID}:${slug}`),
		userId: LOCAL_USER_ID,
		slug,
		kind: "local",
		marketplaceName: "Feynman Science Skill Pack",
		pinnedSha: skillPackHash(customSkills),
		license: readPackageLicense(workingDir),
		offeredSkills,
		offeredSkillsJson: JSON.stringify(offeredSkills),
		...timestamps,
	}];
}

function skillLicenseAssent(skill: WorkbenchCustomSkill, license: string): WorkbenchSkillLicenseAssent {
	const resourceKey = `skill:${skill.path}`;
	return {
		id: stableUuid("feynman-skill-license-assent", `${LOCAL_USER_ID}:${resourceKey}`),
		userId: LOCAL_USER_ID,
		orgId: LOCAL_ORG_ID,
		resourceKey,
		skillName: skill.name,
		decision: "accepted",
		noticeVersion: NOTICE_VERSION,
		noticeText: `${NOTICE_TEXT} License: ${license}.`,
		createdAt: skill.createdAt,
		createdAtMs: skill.createdAtMs,
		projectId: LOCAL_PROJECT_ID,
		source: "project-skill-pack",
	};
}

export function buildWorkbenchMarketplaceLedgers(workingDir: string, customSkills: WorkbenchCustomSkill[]): {
	marketplaceSources: WorkbenchMarketplaceSource[];
	skillLicenseAssents: WorkbenchSkillLicenseAssent[];
} {
	const license = readPackageLicense(workingDir);
	return {
		marketplaceSources: marketplaceSource(workingDir, customSkills),
		skillLicenseAssents: customSkills
			.map((skill) => skillLicenseAssent(skill, license))
			.sort((a, b) => a.skillName.localeCompare(b.skillName) || a.resourceKey.localeCompare(b.resourceKey)),
	};
}
