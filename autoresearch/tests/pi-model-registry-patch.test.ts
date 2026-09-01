import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { patchPiModelRegistrySource } from "../scripts/lib/pi-model-registry-patch.mjs";

const SOURCE = [
	"function formatValidationPath(error) {",
	"    return error.instancePath;",
	"}",
	"class ModelRegistry {",
	"    async getApiKeyAndHeaders(model) {",
	"        try {",
	"            const apiKey = undefined;",
	"            let headers = undefined;",
	"            return {",
	"                ok: true,",
	"                apiKey,",
	"                headers: headers && Object.keys(headers).length > 0 ? headers : undefined,",
	"            };",
	"        }",
	"        catch (error) {",
	"            return { ok: false, error: String(error) };",
	"        }",
	"    }",
	"}",
	"",
].join("\n");

const MODEL_RUNTIME_SOURCE = [
	"function mergeHeaders(base, override) {",
	"    return { ...base, ...override };",
	"}",
	"class ModelRuntime {",
	"    async prepareRequest(model, options) {",
	"        const resolution = await this.getAuth(model);",
	"        const { transformHeaders, ...providerOptions } = options ?? {};",
	"        let headers = mergeHeaders(resolution.auth.headers, providerOptions.headers);",
	"        if (transformHeaders)",
	"            headers = await transformHeaders(headers ?? {});",
	"        return { providerOptions, headers };",
	"    }",
	"}",
	"",
].join("\n");

const CURRENT_MODEL_REGISTRY_SOURCE = [
	'export { clearApiKeyCache } from "./provider-composer.js";',
	"export class ModelRegistry {",
	"    async getApiKeyAndHeaders(model) {",
	"        try {",
	"            const resolution = await this.runtime.getAuth(model);",
	"            if (!resolution) {",
	"                const compatibility = this.runtime.getCompatibilityRequestConfig(model);",
	"                const headers = compatibility.headers",
	"                    ? Object.fromEntries(Object.entries(compatibility.headers).filter((entry) => entry[1] !== null))",
	"                    : undefined;",
	"                return { ok: true, headers };",
	"            }",
	"            const headers = resolution.auth.headers",
	"                ? Object.fromEntries(Object.entries(resolution.auth.headers).filter((entry) => entry[1] !== null))",
	"                : undefined;",
	"            return { ok: true, apiKey: resolution.auth.apiKey, headers, env: resolution.env };",
	"        }",
	"        catch (error) {",
	"            return { ok: false, error: String(error) };",
	"        }",
	"    }",
	"}",
	"",
].join("\n");

test("patchPiModelRegistrySource guards request headers against non-Latin-1 values", () => {
	const patched = patchPiModelRegistrySource(SOURCE);

	assert.match(patched, /function assertHeaderSafeRequestConfig\(/);
	assert.match(patched, /assertHeaderSafeRequestConfig\(model\.provider, apiKey, headers\);/);

	const twice = patchPiModelRegistrySource(patched);
	assert.equal(twice, patched);
});

test("patchPiModelRegistrySource guards final ModelRuntime request authentication", () => {
	const patched = patchPiModelRegistrySource(MODEL_RUNTIME_SOURCE);

	assert.match(patched, /function assertHeaderSafeRequestConfig\(/);
	assert.match(
		patched,
		/assertHeaderSafeRequestConfig\(model\.provider, providerOptions\.apiKey \?\? resolution\.auth\.apiKey, headers\);/,
	);
	assert.equal(patchPiModelRegistrySource(patched), patched);
});

test("patchPiModelRegistrySource guards the Pi 0.82 compatibility facade", () => {
	const patched = patchPiModelRegistrySource(CURRENT_MODEL_REGISTRY_SOURCE);

	assert.match(patched, /function assertHeaderSafeRequestConfig\(/);
	assert.match(patched, /assertHeaderSafeRequestConfig\(model\.provider, undefined, headers\);/);
	assert.match(
		patched,
		/assertHeaderSafeRequestConfig\(model\.provider, resolution\.auth\.apiKey, headers\);/,
	);
	assert.equal(patchPiModelRegistrySource(patched), patched);
});

test("patchPiModelRegistrySource fails closed on an unknown ModelRuntime layout", () => {
	assert.throws(
		() => patchPiModelRegistrySource("class ModelRuntime { async prepareRequest() {} }\n"),
		/Unsupported Pi ModelRuntime layout/,
	);
});

test("patchPiModelRegistrySource fails closed on an unknown ModelRegistry layout", () => {
	assert.throws(
		() => patchPiModelRegistrySource("export class ModelRegistry { async getApiKeyAndHeaders() {} }\n"),
		/Unsupported Pi ModelRegistry layout/,
	);
});

test("embedded Pi ModelRuntime carries the final request header guard", () => {
	const source = readFileSync(
		join(process.cwd(), "node_modules", "@earendil-works", "pi-coding-agent", "dist", "core", "model-runtime.js"),
		"utf8",
	);
	assert.match(source, /function assertHeaderSafeRequestConfig\(/);
	assert.match(
		source,
		/assertHeaderSafeRequestConfig\(model\.provider, providerOptions\.apiKey \?\? resolution\.auth\.apiKey, headers\);/,
	);
});

test("embedded Pi ModelRegistry compatibility facade carries both request guards", () => {
	const source = readFileSync(
		join(process.cwd(), "node_modules", "@earendil-works", "pi-coding-agent", "dist", "core", "model-registry.js"),
		"utf8",
	);
	assert.match(source, /function assertHeaderSafeRequestConfig\(/);
	assert.match(
		source,
		/assertHeaderSafeRequestConfig\(model\.provider, undefined, compatibility\.headers\);/,
	);
	assert.match(
		source,
		/assertHeaderSafeRequestConfig\(model\.provider, resolution\.auth\.apiKey, resolution\.auth\.headers\);/,
	);
});

test("injected Latin-1 guard names the offending provider and header", async () => {
	const patched = patchPiModelRegistrySource(SOURCE);
	const helper = patched.slice(0, patched.indexOf("function formatValidationPath"));
	const moduleUrl = `data:text/javascript;base64,${Buffer.from(`${helper}\nexport { assertHeaderSafeRequestConfig };`).toString("base64")}`;
	const { assertHeaderSafeRequestConfig } = await import(moduleUrl);

	assert.doesNotThrow(() => assertHeaderSafeRequestConfig("openai", "sk-abc", { "X-Note": "ascii only" }));

	assert.throws(
		() => assertHeaderSafeRequestConfig("deepseek-custom", "sk-abc", { "X-Custom-Note": "deepseek模型" }),
		(error: unknown) =>
			error instanceof Error &&
			error.message.includes('Header "X-Custom-Note"') &&
			error.message.includes('provider "deepseek-custom"') &&
			error.message.includes("models.json"),
	);

	assert.throws(
		() => assertHeaderSafeRequestConfig("deepseek-custom", "sk-密钥", undefined),
		(error: unknown) => error instanceof Error && error.message.includes('API key for provider "deepseek-custom"'),
	);
});
