import { createHash } from "node:crypto";

import { listWorkbenchCloudExportTargets } from "./cloud-export-targets.js";
import { readWorkbenchSettings } from "./settings-store.js";
import type { WorkbenchCloudCredential } from "./types.js";

const LOCAL_USER_ID = "local-workbench";

function stableUuid(namespace: string, value: string): string {
	const bytes = createHash("sha256").update(`${namespace}:${value}`).digest().subarray(0, 16);
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function timestampMs(value: string): number {
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function bucketFromTarget(provider: WorkbenchCloudCredential["provider"], rawTarget: string | undefined): string | undefined {
	if (!rawTarget) return undefined;
	if (provider === "s3") return rawTarget.match(/^s3:\/\/([^/]+)/i)?.[1];
	if (provider === "gcs") return rawTarget.match(/^gs:\/\/([^/]+)/i)?.[1];
	if (provider === "local") return rawTarget.replace(/^file:\/\//, "").replace(/\/+$/, "");
	return rawTarget.match(/blob\.core\.windows\.net\/([^/?#]+)/i)?.[1];
}

function credentialType(provider: WorkbenchCloudCredential["provider"], configured: boolean): string {
	if (!configured) return "env-reference-missing";
	if (provider === "local") return "filesystem-target";
	if (provider === "s3") return "s3-uri";
	if (provider === "gcs") return "gcs-uri";
	if (provider === "azure") return "azure-blob-uri";
	return "env-reference";
}

export function buildWorkbenchCloudCredentials(workingDir: string): WorkbenchCloudCredential[] {
	const settings = readWorkbenchSettings(workingDir);
	const targetById = new Map(listWorkbenchCloudExportTargets(workingDir).map((target) => [target.id, target]));
	return settings.credentialRefs.flatMap((credential) => {
		const target = targetById.get(credential.id);
		if (!target) return [];
		const rawTarget = process.env[credential.envVar]?.trim();
		const createdAtMs = timestampMs(credential.createdAt);
		const updatedAtMs = timestampMs(credential.updatedAt);
		return [{
			id: stableUuid("feynman-cloud-credential", `${LOCAL_USER_ID}:${credential.id}`),
			userId: LOCAL_USER_ID,
			provider: target.provider,
			name: credential.name,
			credentialType: credentialType(target.provider, target.status === "configured"),
			encryptedCredentials: `feynman-env-ref:${credential.envVar}`,
			defaultBucket: bucketFromTarget(target.provider, rawTarget),
			createdAt: credential.createdAt,
			createdAtMs,
			updatedAt: credential.updatedAt,
			updatedAtMs,
			status: target.status,
			envVar: credential.envVar,
			settingsRecordId: credential.id,
		}];
	}).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
