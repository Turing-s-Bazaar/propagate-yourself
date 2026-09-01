import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildWorkbenchState } from "../src/workbench/scan.js";
import { WORKBENCH_CREDENTIAL_PROVIDERS } from "../src/workbench/credential-catalog.js";
import { workbenchDataPath } from "../src/workbench/data-root.js";

const SECRET_ENV_VARS = Array.from(new Set([
	...WORKBENCH_CREDENTIAL_PROVIDERS.map((provider) => provider.envVar),
	"ANTHROPIC_OAUTH_TOKEN",
	"MODAL_TOKEN_ID",
]));

function makeWorkspace(): { authPath: string; root: string } {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-secret-ledgers-"));
	const authPath = join(root, "auth.json");
	mkdirSync(join(root, "outputs"), { recursive: true });
	writeFileSync(authPath, JSON.stringify({
		anthropic: { type: "api_key", key: "anthropic-auth-secret" },
	}, null, 2) + "\n", "utf8");
	writeFileSync(workbenchDataPath(root, "settings.json"), JSON.stringify({
		schema: "feynman.workbenchSettings.v1",
		credentialRefs: [{
			id: "lab-nvidia",
			name: "Lab NVIDIA",
			provider: "nvidia",
			envVar: "NVIDIA_API_KEY",
			description: "Hosted biology endpoint key.",
			createdAt: "2026-07-01T00:00:00.000Z",
			updatedAt: "2026-07-01T00:00:00.000Z",
		}, {
			id: "missing-s3",
			name: "Missing S3",
			provider: "s3",
			envVar: "LAB_S3_TOKEN",
			createdAt: "2026-07-01T00:00:00.000Z",
			updatedAt: "2026-07-01T00:00:00.000Z",
		}],
		updatedAt: "2026-07-01T00:00:00.000Z",
	}, null, 2) + "\n", "utf8");
	return { authPath, root };
}

function clearSecretEnv(): Record<string, string | undefined> {
	const previous: Record<string, string | undefined> = {};
	for (const envVar of SECRET_ENV_VARS) {
		previous[envVar] = process.env[envVar];
		delete process.env[envVar];
	}
	return previous;
}

function restoreSecretEnv(previous: Record<string, string | undefined>): void {
	for (const envVar of SECRET_ENV_VARS) {
		if (previous[envVar] === undefined) {
			delete process.env[envVar];
		} else {
			process.env[envVar] = previous[envVar];
		}
	}
}

test("workbench state exposes Claude-style redacted user secret and Anthropic key ledgers", () => {
	const { authPath, root } = makeWorkspace();
	const previous = clearSecretEnv();
	try {
		process.env.ANTHROPIC_API_KEY = "anthropic-env-secret";
		process.env.OPENAI_API_KEY = "openai-env-secret";
		process.env.NVIDIA_API_KEY = "nvidia-settings-secret";

		const state = buildWorkbenchState({ workingDir: root, authPath, version: "0.0.0-test" });
		const authAnthropic = state.userSecrets.find((secret) =>
			secret.provider === "anthropic" && secret.source === "auth-storage"
		);
		assert.equal(authAnthropic?.credentialType, "api-key");
		assert.equal(authAnthropic?.encryptedValue, "feynman-auth-storage-ref:auth:anthropic");
		assert.equal(authAnthropic?.status, "configured");

		const envAnthropic = state.userSecrets.find((secret) =>
			secret.provider === "anthropic" && secret.source === "environment"
		);
		assert.equal(envAnthropic?.envVar, "ANTHROPIC_API_KEY");
		assert.equal(envAnthropic?.credentialType, "env-api-key");

		const openAiEnv = state.userSecrets.find((secret) =>
			secret.provider === "openai" && secret.source === "environment"
		);
		assert.equal(openAiEnv?.envVar, "OPENAI_API_KEY");
		assert.equal(openAiEnv?.encryptedValue, "feynman-environment-ref:env:openai:OPENAI_API_KEY");

		const nvidiaSetting = state.userSecrets.find((secret) => secret.settingsRecordId === "lab-nvidia");
		assert.equal(nvidiaSetting?.provider, "nvidia");
		assert.equal(nvidiaSetting?.credentialType, "env-reference");
		assert.equal(nvidiaSetting?.status, "configured");
		assert.equal(state.userSecrets.some((secret) => secret.provider === "nvidia" && secret.source === "environment"), false);

		const missingS3 = state.userSecrets.find((secret) => secret.settingsRecordId === "missing-s3");
		assert.equal(missingS3?.credentialType, "env-reference-missing");
		assert.equal(missingS3?.status, "missing");

		assert.equal(state.anthropicApiKeys.length, 2);
		assert.equal(state.anthropicApiKeys.some((key) => key.source === "auth-storage"), true);
		assert.equal(state.anthropicApiKeys.some((key) => key.envVar === "ANTHROPIC_API_KEY"), true);
		assert.equal(state.resources.find((group) => group.id === "credentials")?.resources.some((resource) => resource.id === "credential-groq"), true);

		const serialized = JSON.stringify({
			anthropicApiKeys: state.anthropicApiKeys,
			userSecrets: state.userSecrets,
		});
		assert.equal(serialized.includes("anthropic-auth-secret"), false);
		assert.equal(serialized.includes("anthropic-env-secret"), false);
		assert.equal(serialized.includes("openai-env-secret"), false);
		assert.equal(serialized.includes("nvidia-settings-secret"), false);
	} finally {
		restoreSecretEnv(previous);
		rmSync(root, { recursive: true, force: true });
	}
});
