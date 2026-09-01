import { createHash } from "node:crypto";

import type { WorkbenchContactEmailDecision, WorkbenchCredentialAskDecision, WorkbenchUserSecret } from "./types.js";

const LOCAL_USER_ID = "local-workbench";
const FIXED_ENV_CREATED_AT = "1970-01-01T00:00:00.000Z";
const CONTACT_EMAIL_ENV_VARS = ["NCBI_EMAIL", "ENTREZ_EMAIL", "CROSSREF_MAILTO"] as const;
const CONTACT_NOTICE_VERSION = "feynman-contact-email-v1";
const CONTACT_NOTICE_TEXT = "Allow Feynman Bio Tools to send this contact email to public scientific APIs that request a contact address.";

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

function normalizeEmail(value: string | undefined): string | undefined {
	const email = value?.trim();
	if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return undefined;
	return email;
}

export function buildWorkbenchContactEmailDecisions(): WorkbenchContactEmailDecision[] {
	const seen = new Set<string>();
	const rows: WorkbenchContactEmailDecision[] = [];
	for (const envVar of CONTACT_EMAIL_ENV_VARS) {
		const email = normalizeEmail(process.env[envVar]);
		if (!email) continue;
		const key = email.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		const createdAtMs = timestampMs(FIXED_ENV_CREATED_AT);
		rows.push({
			id: stableUuid("feynman-contact-email-decision", `${LOCAL_USER_ID}:${key}`),
			userId: LOCAL_USER_ID,
			decision: "accepted",
			email,
			noticeVersion: CONTACT_NOTICE_VERSION,
			noticeText: CONTACT_NOTICE_TEXT,
			createdAt: FIXED_ENV_CREATED_AT,
			createdAtMs,
			source: "environment",
			envVar,
		});
	}
	return rows.sort((a, b) => (a.email ?? "").localeCompare(b.email ?? "") || a.envVar.localeCompare(b.envVar));
}

function credentialDecisionForSecrets(provider: string, secrets: WorkbenchUserSecret[]): WorkbenchCredentialAskDecision {
	const configured = secrets.filter((secret) => secret.status === "configured");
	const sourcePriority = ["settings", "auth-storage", "environment"];
	const sorted = [...secrets].sort((a, b) =>
		sourcePriority.indexOf(a.source) - sourcePriority.indexOf(b.source)
		|| a.createdAtMs - b.createdAtMs
		|| a.id.localeCompare(b.id)
	);
	const representative = sorted[0]!;
	const createdAt = representative.createdAt;
	return {
		id: stableUuid("feynman-credential-ask-decision", `${LOCAL_USER_ID}:${provider}`),
		userId: LOCAL_USER_ID,
		provider,
		decision: configured.length ? "accepted" : "pending",
		createdAt,
		createdAtMs: timestampMs(createdAt),
		source: configured[0]?.source ?? representative.source,
		credentialRecordIds: sorted.map((secret) => secret.id),
	};
}

export function buildWorkbenchCredentialAskDecisions(userSecrets: WorkbenchUserSecret[]): WorkbenchCredentialAskDecision[] {
	const byProvider = new Map<string, WorkbenchUserSecret[]>();
	for (const secret of userSecrets) {
		const provider = secret.provider.trim().toLowerCase();
		if (!provider) continue;
		const existing = byProvider.get(provider) ?? [];
		existing.push(secret);
		byProvider.set(provider, existing);
	}
	return Array.from(byProvider.entries())
		.map(([provider, secrets]) => credentialDecisionForSecrets(provider, secrets))
		.sort((a, b) => a.provider.localeCompare(b.provider));
}
