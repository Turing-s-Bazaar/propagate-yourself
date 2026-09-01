import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { WORKBENCH_CREDENTIAL_PROVIDERS } from "../src/workbench/credential-catalog.js";
import { workbenchDataPath } from "../src/workbench/data-root.js";
import { buildWorkbenchState } from "../src/workbench/scan.js";
import { startWorkbenchServer } from "../src/workbench/server.js";

const SETUP_ENV_VARS = Array.from(new Set([
	...WORKBENCH_CREDENTIAL_PROVIDERS.map((provider) => provider.envVar),
	"ANTHROPIC_OAUTH_TOKEN",
	"NCBI_EMAIL",
	"ENTREZ_EMAIL",
	"CROSSREF_MAILTO",
	"LAB_S3_TOKEN",
]));

function makeWorkspace(): { authPath: string; root: string } {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-setup-decisions-"));
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

function clearSetupEnv(): Record<string, string | undefined> {
	const previous: Record<string, string | undefined> = {};
	for (const envVar of SETUP_ENV_VARS) {
		previous[envVar] = process.env[envVar];
		delete process.env[envVar];
	}
	return previous;
}

function restoreSetupEnv(previous: Record<string, string | undefined>): void {
	for (const envVar of SETUP_ENV_VARS) {
		if (previous[envVar] === undefined) {
			delete process.env[envVar];
		} else {
			process.env[envVar] = previous[envVar];
		}
	}
}

test("workbench state exposes contact email and credential ask decision rows", () => {
	const { authPath, root } = makeWorkspace();
	const previous = clearSetupEnv();
	try {
		process.env.NCBI_EMAIL = "research@example.edu";
		process.env.ENTREZ_EMAIL = "research@example.edu";
		process.env.NVIDIA_API_KEY = "nvidia-secret";
		process.env.OPENAI_API_KEY = "openai-secret";

		const state = buildWorkbenchState({ workingDir: root, authPath, version: "0.0.0-test" });
		assert.equal(state.contactEmailDecisions.length, 1);
		const contact = state.contactEmailDecisions[0];
		assert.match(contact?.id ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		assert.equal(contact?.userId, "local-workbench");
		assert.equal(contact?.decision, "accepted");
		assert.equal(contact?.email, "research@example.edu");
		assert.equal(contact?.noticeVersion, "feynman-contact-email-v1");
		assert.match(contact?.noticeText ?? "", /Feynman Bio Tools/);
		assert.equal(contact?.source, "environment");
		assert.equal(contact?.envVar, "NCBI_EMAIL");

		const decisions = new Map(state.credentialAskDecisions.map((decision) => [decision.provider, decision]));
		assert.equal(decisions.get("anthropic")?.decision, "accepted");
		assert.equal(decisions.get("anthropic")?.source, "auth-storage");
		assert.equal(decisions.get("nvidia")?.decision, "accepted");
		assert.equal(decisions.get("nvidia")?.source, "settings");
		assert.equal(decisions.get("openai")?.decision, "accepted");
		assert.equal(decisions.get("openai")?.source, "environment");
		assert.equal(decisions.get("s3")?.decision, "pending");
		assert.equal(decisions.get("s3")?.source, "settings");
		assert.equal(decisions.get("s3")?.credentialRecordIds.length, 1);

		const serialized = JSON.stringify({
			contactEmailDecisions: state.contactEmailDecisions,
			credentialAskDecisions: state.credentialAskDecisions,
			userSecrets: state.userSecrets,
		});
		assert.equal(serialized.includes("nvidia-secret"), false);
		assert.equal(serialized.includes("openai-secret"), false);
		assert.equal(serialized.includes("anthropic-auth-secret"), false);
	} finally {
		restoreSetupEnv(previous);
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench server returns setup decision ledgers through state", async () => {
	const { authPath, root } = makeWorkspace();
	const previous = clearSetupEnv();
	process.env.NCBI_EMAIL = "api-contact@example.edu";
	process.env.NVIDIA_API_KEY = "nvidia-secret";
	const handle = await startWorkbenchServer({
		workingDir: root,
		authPath,
		version: "0.0.0-test",
		host: "127.0.0.1",
		port: 0,
		token: "test-token",
	});
	try {
		const response = await fetch(`${handle.url}api/state`, {
			headers: { cookie: "feynman_workbench=test-token" },
		});
		assert.equal(response.status, 200);
		const payload = await response.json() as {
			contactEmailDecisions: Array<{ decision: string; email?: string; envVar: string }>;
			credentialAskDecisions: Array<{ provider: string; decision: string; source: string }>;
		};
		assert.equal(payload.contactEmailDecisions.length, 1);
		assert.equal(payload.contactEmailDecisions[0]?.email, "api-contact@example.edu");
		assert.equal(payload.contactEmailDecisions[0]?.envVar, "NCBI_EMAIL");
		assert.equal(payload.credentialAskDecisions.some((decision) =>
			decision.provider === "nvidia" && decision.decision === "accepted" && decision.source === "settings"
		), true);
		assert.equal(payload.credentialAskDecisions.some((decision) =>
			decision.provider === "s3" && decision.decision === "pending"
		), true);
	} finally {
		await handle.close();
		restoreSetupEnv(previous);
		rmSync(root, { recursive: true, force: true });
	}
});
