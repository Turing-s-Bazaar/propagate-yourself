import test from "node:test";
import assert from "node:assert/strict";

import { patchPiExtensionLoaderSource } from "../scripts/lib/pi-extension-loader-patch.mjs";

test("patchPiExtensionLoaderSource rewrites Windows extension imports to file URLs", () => {
	const input = [
		'import * as path from "node:path";',
		'import { fileURLToPath } from "node:url";',
		"async function loadExtensionModule(extensionPath) {",
		"    const jiti = createJiti(import.meta.url);",
		'    const module = await jiti.import(extensionPath, { default: true });',
		"    return module;",
		"}",
		"",
	].join("\n");

	const patched = patchPiExtensionLoaderSource(input);

	assert.match(patched, /pathToFileURL/);
	assert.match(patched, /process\.platform === "win32"/);
	assert.match(patched, /path\.isAbsolute\(extensionPath\)/);
	assert.match(patched, /jiti\.import\(extensionSpecifier, \{ default: true \}\)/);
});

test("patchPiExtensionLoaderSource is idempotent", () => {
	const input = [
		'import * as path from "node:path";',
		'import { fileURLToPath } from "node:url";',
		"async function loadExtensionModule(extensionPath) {",
		"    const jiti = createJiti(import.meta.url);",
		'    const module = await jiti.import(extensionPath, { default: true });',
		"    return module;",
		"}",
		"",
	].join("\n");

	const once = patchPiExtensionLoaderSource(input);
	const twice = patchPiExtensionLoaderSource(once);

	assert.equal(twice, once);
});

test("patchPiExtensionLoaderSource aliases both Pi runtime namespaces to the bundled runtime", () => {
	const input = [
		'import { fileURLToPath, pathToFileURL } from "node:url";',
		"const VIRTUAL_MODULES = {",
		'    "@mariozechner/pi-agent-core": _bundledPiAgentCore,',
		'    "@mariozechner/pi-tui": _bundledPiTui,',
		'    "@mariozechner/pi-ai": _bundledPiAi,',
		'    "@mariozechner/pi-ai/oauth": _bundledPiAiOauth,',
		'    "@mariozechner/pi-coding-agent": _bundledPiCodingAgent,',
		"};",
		"function getAliases() {",
		"    _aliases = {",
		'        "@mariozechner/pi-coding-agent": packageIndex,',
		'        "@mariozechner/pi-agent-core": resolveWorkspaceOrImport("agent/dist/index.js", "@mariozechner/pi-agent-core"),',
		'        "@mariozechner/pi-tui": resolveWorkspaceOrImport("tui/dist/index.js", "@mariozechner/pi-tui"),',
		'        "@mariozechner/pi-ai": resolveWorkspaceOrImport("ai/dist/index.js", "@mariozechner/pi-ai"),',
		'        "@mariozechner/pi-ai/oauth": resolveWorkspaceOrImport("ai/dist/oauth.js", "@mariozechner/pi-ai/oauth"),',
		"    };",
		"}",
		"async function loadExtensionModule(extensionPath) {",
		"    const jiti = createJiti(import.meta.url);",
		'    const module = await jiti.import(extensionPath, { default: true });',
		"    return module;",
		"}",
		"",
	].join("\n");

	const patched = patchPiExtensionLoaderSource(input);

	assert.match(patched, /"@earendil-works\/pi-agent-core": _bundledPiAgentCore/);
	assert.match(patched, /"@earendil-works\/pi-tui": _bundledPiTui/);
	assert.match(patched, /"@earendil-works\/pi-ai": _bundledPiAi/);
	assert.match(patched, /"@earendil-works\/pi-ai\/oauth": _bundledPiAiOauth/);
	assert.match(patched, /"@earendil-works\/pi-coding-agent": _bundledPiCodingAgent/);
	assert.match(patched, /"@earendil-works\/pi-coding-agent": packageIndex/);
	assert.match(patched, /"@earendil-works\/pi-tui": resolveWorkspaceOrImport\("tui\/dist\/index\.js", "@mariozechner\/pi-tui"\)/);
});

test("patchPiExtensionLoaderSource preserves legacy aliases for current namespace loaders", () => {
	const input = [
		'import { fileURLToPath, pathToFileURL } from "node:url";',
		"const VIRTUAL_MODULES = {",
		'    "@earendil-works/pi-agent-core": _bundledPiAgentCore,',
		'    "@earendil-works/pi-tui": _bundledPiTui,',
		'    "@earendil-works/pi-ai": _bundledPiAi,',
		'    "@earendil-works/pi-ai/oauth": _bundledPiAiOauth,',
		'    "@earendil-works/pi-coding-agent": _bundledPiCodingAgent,',
		"};",
		"function getAliases() {",
		"    _aliases = {",
		'        "@earendil-works/pi-coding-agent": packageIndex,',
		'        "@earendil-works/pi-agent-core": resolveWorkspaceOrImport("agent/dist/index.js", "@earendil-works/pi-agent-core"),',
		'        "@earendil-works/pi-tui": resolveWorkspaceOrImport("tui/dist/index.js", "@earendil-works/pi-tui"),',
		'        "@earendil-works/pi-ai": resolveWorkspaceOrImport("ai/dist/index.js", "@earendil-works/pi-ai"),',
		'        "@earendil-works/pi-ai/oauth": resolveWorkspaceOrImport("ai/dist/oauth.js", "@earendil-works/pi-ai/oauth"),',
		"    };",
		"}",
		"",
	].join("\n");

	const patched = patchPiExtensionLoaderSource(input);

	assert.match(patched, /"@mariozechner\/pi-agent-core": _bundledPiAgentCore/);
	assert.match(patched, /"@mariozechner\/pi-tui": _bundledPiTui/);
	assert.match(patched, /"@mariozechner\/pi-ai": _bundledPiAi/);
	assert.match(patched, /"@mariozechner\/pi-ai\/oauth": _bundledPiAiOauth/);
	assert.match(patched, /"@mariozechner\/pi-coding-agent": _bundledPiCodingAgent/);
	assert.match(patched, /"@mariozechner\/pi-coding-agent": packageIndex/);
	assert.match(patched, /"@mariozechner\/pi-tui": resolveWorkspaceOrImport\("tui\/dist\/index\.js", "@earendil-works\/pi-tui"\)/);
});
