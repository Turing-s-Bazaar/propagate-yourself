import type { WorkbenchCredentialRef } from "./settings-store.js";
import { readWorkbenchSettings } from "./settings-store.js";
import type { WorkbenchCloudExportTarget } from "./types.js";

const CLOUD_EXPORT_PROVIDERS = new Map<string, WorkbenchCloudExportTarget["provider"]>([
	["aws", "s3"],
	["r2", "s3"],
	["s3", "s3"],
	["gcloud", "gcs"],
	["gcp", "gcs"],
	["gcs", "gcs"],
	["google-cloud-storage", "gcs"],
	["azure", "azure"],
	["azure-blob", "azure"],
	["filesystem", "local"],
	["file", "local"],
	["local", "local"],
]);

function providerForCredential(credential: WorkbenchCredentialRef): WorkbenchCloudExportTarget["provider"] | undefined {
	const normalized = credential.provider.trim().toLowerCase();
	return CLOUD_EXPORT_PROVIDERS.get(normalized);
}

function targetDetail(provider: WorkbenchCloudExportTarget["provider"], rawTarget: string | undefined): string {
	if (!rawTarget) return "Environment value missing";
	const target = rawTarget.trim();
	if (provider === "s3") {
		const match = target.match(/^s3:\/\/([^/]+)(?:\/(.*))?$/i);
		return match ? `s3://${match[1]}${match[2] ? "/..." : ""}` : "S3 target configured";
	}
	if (provider === "gcs") {
		const match = target.match(/^gs:\/\/([^/]+)(?:\/(.*))?$/i);
		return match ? `gs://${match[1]}${match[2] ? "/..." : ""}` : "Google Cloud Storage target configured";
	}
	if (provider === "azure") return "Azure Blob target configured";
	return "Local filesystem export target configured";
}

export function listWorkbenchCloudExportTargets(workingDir: string): WorkbenchCloudExportTarget[] {
	return readWorkbenchSettings(workingDir).credentialRefs.flatMap((credential) => {
		const provider = providerForCredential(credential);
		if (!provider) return [];
		const rawTarget = process.env[credential.envVar]?.trim();
		return [{
			id: credential.id,
			name: credential.name,
			provider,
			envVar: credential.envVar,
			status: rawTarget ? "configured" : "missing",
			detail: targetDetail(provider, rawTarget),
			...(credential.description ? { description: credential.description } : {}),
		} satisfies WorkbenchCloudExportTarget];
	});
}
