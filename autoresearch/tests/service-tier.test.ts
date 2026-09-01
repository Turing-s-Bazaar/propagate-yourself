import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	getConfiguredServiceTier,
	normalizeServiceTier,
	resolveProviderServiceTier,
	setConfiguredServiceTier,
} from "../src/model/service-tier.js";

test("normalizeServiceTier accepts supported values only", () => {
	assert.equal(normalizeServiceTier("priority"), "priority");
	assert.equal(normalizeServiceTier("standard_only"), "standard_only");
	assert.equal(normalizeServiceTier("FAST"), undefined);
	assert.equal(normalizeServiceTier(undefined), undefined);
});

test("setConfiguredServiceTier persists and clears settings.json values", () => {
	const dir = mkdtempSync(join(tmpdir(), "feynman-service-tier-"));
	const settingsPath = join(dir, "settings.json");

	setConfiguredServiceTier(settingsPath, "priority");
	assert.equal(getConfiguredServiceTier(settingsPath), "priority");

	const persisted = JSON.parse(readFileSync(settingsPath, "utf8")) as { serviceTier?: string };
	assert.equal(persisted.serviceTier, "priority");

	setConfiguredServiceTier(settingsPath, undefined);
	assert.equal(getConfiguredServiceTier(settingsPath), undefined);
});

test("resolveProviderServiceTier filters unsupported provider+tier pairs", () => {
	assert.equal(resolveProviderServiceTier("openai", "priority"), "priority");
	assert.equal(resolveProviderServiceTier("openai-codex", "flex"), "flex");
	assert.equal(resolveProviderServiceTier("anthropic", "standard_only"), "standard_only");
	assert.equal(resolveProviderServiceTier("anthropic", "priority"), undefined);
	assert.equal(resolveProviderServiceTier("google", "priority"), undefined);
});
