import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { findEnvKeys } from "@earendil-works/pi-ai/compat";

import { MODEL_API_KEY_PROVIDERS } from "../model/api-key-providers.js";
import { WORKBENCH_CREDENTIAL_PROVIDERS } from "./credential-catalog.js";
import { readWorkbenchSettings, type WorkbenchCredentialRef } from "./settings-store.js";
import type { WorkbenchAnthropicApiKey, WorkbenchUserSecret } from "./types.js";

const LOCAL_USER_ID = "local-workbench";
const FIXED_ENV_CREATED_AT = "1970-01-01T00:00:00.000Z";

type AuthCredentialShape = {
	type?: unknown;
	key?: unknown;
};

type SecretSource = WorkbenchUserSecret["source"];

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

function normalizeProvider(value: string): string {
	return value.trim().toLowerCase();
}

function encryptedRef(source: SecretSource, key: string): string {
	return `feynman-${source}-ref:${key}`;
}

function envPresent(envVar: string): boolean {
	return Boolean(process.env[envVar]?.trim());
}

function providerEnvKeys(provider: string, fallbackEnvVar?: string): string[] {
	const found = findEnvKeys(provider) ?? [];
	const all = fallbackEnvVar ? [fallbackEnvVar, ...found] : found;
	return Array.from(new Set(all.filter((envVar) => envPresent(envVar))));
}

function readAuthCredentials(authPath: string | undefined): Array<{ provider: string; credential: AuthCredentialShape }> {
	if (!authPath || !existsSync(authPath)) return [];
	try {
		const parsed = JSON.parse(readFileSync(authPath, "utf8")) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
		return Object.entries(parsed as Record<string, unknown>).flatMap(([provider, credential]) => {
			if (!credential || typeof credential !== "object" || Array.isArray(credential)) return [];
			const shaped = credential as AuthCredentialShape;
			return shaped.type === "api_key" || shaped.type === "oauth" ? [{ provider, credential: shaped }] : [];
		});
	} catch {
		return [];
	}
}

function credentialTypeForAuth(credential: AuthCredentialShape): string {
	return credential.type === "oauth" ? "oauth-token" : "api-key";
}

function secretRow(input: {
	createdAt: string;
	credentialType: string;
	description?: string;
	envVar?: string;
	key: string;
	name: string;
	provider: string;
	settingsRecordId?: string;
	source: SecretSource;
	status: WorkbenchUserSecret["status"];
	updatedAt: string;
}): WorkbenchUserSecret {
	const createdAtMs = timestampMs(input.createdAt);
	const updatedAtMs = timestampMs(input.updatedAt);
	return {
		id: stableUuid("feynman-user-secret", `${LOCAL_USER_ID}:${input.source}:${input.key}`),
		userId: LOCAL_USER_ID,
		name: input.name,
		provider: normalizeProvider(input.provider),
		encryptedValue: encryptedRef(input.source, input.key),
		credentialType: input.credentialType,
		...(input.description ? { description: input.description } : {}),
		createdAt: input.createdAt,
		createdAtMs,
		updatedAt: input.updatedAt,
		updatedAtMs,
		source: input.source,
		status: input.status,
		...(input.envVar ? { envVar: input.envVar } : {}),
		...(input.settingsRecordId ? { settingsRecordId: input.settingsRecordId } : {}),
	};
}

function settingSecretRow(credential: WorkbenchCredentialRef): WorkbenchUserSecret {
	const status = envPresent(credential.envVar) ? "configured" : "missing";
	return secretRow({
		createdAt: credential.createdAt,
		credentialType: status === "configured" ? "env-reference" : "env-reference-missing",
		description: credential.description,
		envVar: credential.envVar,
		key: `settings:${credential.id}:${credential.envVar}`,
		name: credential.name,
		provider: credential.provider,
		settingsRecordId: credential.id,
		source: "settings",
		status,
		updatedAt: credential.updatedAt,
	});
}

function authSecretRows(authPath: string | undefined): WorkbenchUserSecret[] {
	return readAuthCredentials(authPath).map(({ provider, credential }) => secretRow({
		createdAt: FIXED_ENV_CREATED_AT,
		credentialType: credentialTypeForAuth(credential),
		key: `auth:${provider}`,
		name: `${provider} credential`,
		provider,
		source: "auth-storage",
		status: "configured",
		updatedAt: FIXED_ENV_CREATED_AT,
	}));
}

function envSecretRows(settingEnvVars: Set<string>): WorkbenchUserSecret[] {
	return WORKBENCH_CREDENTIAL_PROVIDERS.flatMap((provider) => {
		const matchingApiProvider = MODEL_API_KEY_PROVIDERS.find((item) => item.id === provider.id);
		const envKeys = matchingApiProvider
			? providerEnvKeys(matchingApiProvider.id, matchingApiProvider.envVar)
			: envPresent(provider.envVar) ? [provider.envVar] : [];
		return envKeys
			.filter((envVar) => !settingEnvVars.has(envVar))
			.map((envVar) => secretRow({
				createdAt: FIXED_ENV_CREATED_AT,
				credentialType: envVar.endsWith("_OAUTH_TOKEN") ? "oauth-token-env" : "env-api-key",
				envVar,
				key: `env:${provider.id}:${envVar}`,
				name: provider.name,
				provider: provider.id,
				source: "environment",
				status: "configured",
				updatedAt: FIXED_ENV_CREATED_AT,
			}));
	});
}

function anthropicKeyRows(userSecrets: WorkbenchUserSecret[]): WorkbenchAnthropicApiKey[] {
	return userSecrets
		.filter((secret) => secret.provider === "anthropic" && secret.status === "configured")
		.map((secret) => ({
			id: stableUuid("feynman-anthropic-api-key", secret.id),
			userId: LOCAL_USER_ID,
			encryptedApiKey: secret.encryptedValue.replace(/^feynman-/, "feynman-anthropic-"),
			createdAt: secret.createdAt,
			createdAtMs: secret.createdAtMs,
			updatedAt: secret.updatedAt,
			updatedAtMs: secret.updatedAtMs,
			source: secret.source,
			status: "configured" as const,
			...(secret.envVar ? { envVar: secret.envVar } : {}),
			...(secret.settingsRecordId ? { settingsRecordId: secret.settingsRecordId } : {}),
		}));
}

export function buildWorkbenchSecretLedgers({
	authPath,
	workingDir,
}: {
	authPath?: string;
	workingDir: string;
}): {
	userSecrets: WorkbenchUserSecret[];
	anthropicApiKeys: WorkbenchAnthropicApiKey[];
} {
	const settings = readWorkbenchSettings(workingDir);
	const settingEnvVars = new Set(settings.credentialRefs.map((credential) => credential.envVar));
	const userSecrets = [
		...settings.credentialRefs.map(settingSecretRow),
		...authSecretRows(authPath),
		...envSecretRows(settingEnvVars),
	].sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
	return {
		userSecrets,
		anthropicApiKeys: anthropicKeyRows(userSecrets),
	};
}
