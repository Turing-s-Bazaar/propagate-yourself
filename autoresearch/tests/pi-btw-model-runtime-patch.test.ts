import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test, { type TestContext } from "node:test";

import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import {
	ModelRegistry,
	ModelRuntime,
} from "@earendil-works/pi-coding-agent";

import {
	assertPiBtwModelRuntimePatchedSource,
	PI_BTW_MODEL_RUNTIME_PATCH_MARKER,
	PI_BTW_MODEL_RUNTIME_REQUIRED_VERSION,
	patchPiBtwModelRuntimePackageRoot,
	patchPiBtwModelRuntimeSource,
} from "../scripts/lib/pi-btw-model-runtime-patch.mjs";

const appRoot = process.cwd();
const fixturePath = resolve(
	appRoot,
	"tests",
	"fixtures",
	"pi-btw-0.4.1",
	"btw.ts.fixture",
);

const testUsage = {
	input: 1,
	output: 1,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 2,
	cost: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		total: 0,
	},
};

type LoadedBtwModule = {
	default: (pi: unknown) => void;
	createFeynmanBtwModelRuntime(
		ctx: unknown,
		model: unknown,
	): Promise<ModelRuntime | undefined>;
};

type BtwCommand = {
	handler(args: string, ctx: unknown): Promise<void>;
};

async function loadPatchedBtwModule(
	t: TestContext,
	prefix: string,
): Promise<LoadedBtwModule> {
	const tempRoot = mkdtempSync(resolve(appRoot, ".feynman", prefix));
	t.after(() => {
		if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true });
	});
	const modulePath = resolve(tempRoot, "btw.ts");
	writeFileSync(
		modulePath,
		patchPiBtwModelRuntimeSource(
			"extensions/btw.ts",
			readFileSync(fixturePath, "utf8"),
		),
		"utf8",
	);
	return import(
		`${pathToFileURL(modulePath).href}?test=${Date.now()}-${Math.random()}`
	) as Promise<LoadedBtwModule>;
}

async function createProviderRuntime(responses: string[]) {
	const runtimeKeys: Array<string | undefined> = [];
	const runtime = await ModelRuntime.create({
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("test-provider", {
		name: "Test provider",
		baseUrl: "https://provider.invalid/v1",
		api: "openai-completions",
		models: [
			{
				id: "test-model",
				name: "Test model",
				reasoning: false,
				input: ["text"],
				cost: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
				},
				contextWindow: 16_384,
				maxTokens: 2_048,
			},
		],
		streamSimple(model, _context, options) {
			runtimeKeys.push(options?.apiKey);
			const answer = responses.shift();
			assert.ok(answer, "Unexpected BTW provider request");
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() => {
				stream.push({
					type: "done",
					reason: "stop",
					message: {
						role: "assistant",
						content: [{ type: "text", text: answer }],
						api: model.api,
						provider: model.provider,
						model: model.id,
						usage: testUsage,
						stopReason: "stop",
						timestamp: Date.now(),
					},
				});
			});
			return stream;
		},
	});
	await runtime.refresh({ allowNetwork: false });
	await runtime.setRuntimeApiKey("test-provider", "temporary-test-key");
	const model = runtime.getModel("test-provider", "test-model");
	assert.ok(model);
	return {
		runtime,
		registry: new ModelRegistry(runtime),
		model,
		runtimeKeys,
	};
}

function createCommandHarness(
	registerBtw: LoadedBtwModule["default"],
	registry: ModelRegistry,
	model: NonNullable<ReturnType<ModelRuntime["getModel"]>>,
) {
	const commands = new Map<string, BtwCommand>();
	const handlers = new Map<
		string,
		Array<(event: unknown, ctx: unknown) => Promise<void>>
	>();
	const appended: Array<{ type: string; data: unknown }> = [];
	const sent: Array<{ message: unknown; options?: unknown }> = [];
	registerBtw({
		getThinkingLevel: () => "off",
		registerCommand: (name: string, command: BtwCommand) => {
			commands.set(name, command);
		},
		on: (
			name: string,
			handler: (event: unknown, ctx: unknown) => Promise<void>,
		) => {
			const current = handlers.get(name) ?? [];
			current.push(handler);
			handlers.set(name, current);
		},
		appendEntry: (type: string, data: unknown) => {
			appended.push({ type, data });
		},
		sendMessage: (message: unknown, options?: unknown) => {
			sent.push({ message, options });
		},
		sendUserMessage: (message: unknown, options?: unknown) => {
			sent.push({ message, options });
		},
		registerMessageRenderer: () => {},
		registerShortcut: () => {},
	});
	const ctx = {
		modelRegistry: registry,
		model,
		hasUI: false,
		isIdle: () => true,
		getSystemPrompt: () => "BTW runtime test system prompt",
		sessionManager: {
			getBranch: () => [],
			getEntries: () => [],
		},
		ui: {
			notify: () => {},
			setWidget: () => {},
		},
	};
	return {
		appended,
		sent,
		async start() {
			for (const handler of handlers.get("session_start") ?? []) {
				await handler({}, ctx);
			}
		},
		async shutdown() {
			for (const handler of handlers.get("session_shutdown") ?? []) {
				await handler({}, ctx);
			}
		},
		async command(name: string, args: string) {
			const command = commands.get(name);
			assert.ok(command, `Missing /${name} command`);
			await command.handler(args, ctx);
		},
	};
}

test("pi-btw 0.4.1 patch ports ModelRuntime into both child-session paths", () => {
	const source = readFileSync(fixturePath, "utf8");
	const patched = patchPiBtwModelRuntimeSource("extensions/btw.ts", source);

	assert.equal(PI_BTW_MODEL_RUNTIME_REQUIRED_VERSION, "0.4.1");
	assert.match(patched, new RegExp(PI_BTW_MODEL_RUNTIME_PATCH_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	assert.equal(
		patched.split("...(modelRuntime ? { modelRuntime } : {}),").length - 1,
		2,
	);
	assert.doesNotMatch(
		patched,
		/modelRegistry: ctx\.modelRegistry as AgentSession\["modelRegistry"\]/,
	);
	assert.doesNotThrow(() =>
		assertPiBtwModelRuntimePatchedSource(patched, "fixture"),
	);
	assert.equal(
		patchPiBtwModelRuntimeSource("extensions/btw.ts", patched),
		patched,
	);
	assert.throws(
		() =>
			assertPiBtwModelRuntimePatchedSource(
				patched.replace(
					"modelRuntime.refresh({ allowNetwork: false })",
					"Promise.resolve()",
				),
				"mutated fixture",
			),
		/Incomplete pi-btw ModelRuntime patch/,
	);
});

test("pi-btw package patch rejects marker-preserving runtime drift", (t) => {
	const packageRoot = mkdtempSync(resolve(appRoot, ".feynman", "btw-package-test-"));
	t.after(() => {
		if (existsSync(packageRoot)) rmSync(packageRoot, { recursive: true });
	});
	const extensionPath = resolve(packageRoot, "extensions", "btw.ts");
	mkdirSync(resolve(packageRoot, "extensions"), { recursive: true });
	writeFileSync(
		resolve(packageRoot, "package.json"),
		JSON.stringify({
			name: "pi-btw",
			version: PI_BTW_MODEL_RUNTIME_REQUIRED_VERSION,
		}) + "\n",
		"utf8",
	);
	writeFileSync(extensionPath, readFileSync(fixturePath));
	assert.equal(patchPiBtwModelRuntimePackageRoot(packageRoot), true);
	assert.equal(patchPiBtwModelRuntimePackageRoot(packageRoot), false);
	writeFileSync(
		extensionPath,
		readFileSync(extensionPath, "utf8").replace(
			"if (nativeProvider) {",
			"if (false && nativeProvider) {",
		),
		"utf8",
	);
	assert.throws(
		() => patchPiBtwModelRuntimePackageRoot(packageRoot),
		/Unsupported pi-btw 0\.4\.1 extensions\/btw\.ts/,
	);
});

test("patched pi-btw copies custom provider registration and runtime credentials offline", async (t) => {
	const { createFeynmanBtwModelRuntime } = await loadPatchedBtwModule(
		t,
		"btw-model-runtime-test-",
	);
	const providerConfig = {
		name: "Test provider",
		baseUrl: "https://provider.invalid/v1",
		api: "openai-completions",
		models: [
			{
				id: "test-model",
				name: "Test model",
				reasoning: false,
				input: ["text"],
				cost: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
				},
				contextWindow: 16_384,
				maxTokens: 2_048,
			},
		],
	};
	const model = {
		provider: "test-provider",
		id: "test-model",
		api: "openai-completions",
	};
	const calls: string[] = [];
	const runtime = await createFeynmanBtwModelRuntime(
		{
			modelRegistry: {
				getRegisteredNativeProvider: () => undefined,
				getRegisteredProviderConfig: (provider: string) => {
					calls.push(`config:${provider}`);
					return providerConfig;
				},
				getProviderAuthStatus: (provider: string) => {
					calls.push(`auth-status:${provider}`);
					return { configured: true, source: "runtime" };
				},
				getApiKeyAndHeaders: async () => {
					calls.push("credentials");
					return { ok: true, apiKey: "temporary-test-key" };
				},
			},
		},
		model,
	);
	assert.ok(runtime, "Expected a child ModelRuntime");

	assert.deepEqual(
		runtime.getRegisteredProviderConfig("test-provider"),
		providerConfig,
	);
	assert.equal(
		runtime.getProviderAuthStatus("test-provider").source,
		"runtime",
	);
	assert.deepEqual(calls, [
		"config:test-provider",
		"auth-status:test-provider",
		"credentials",
	]);

	for (const invalidAuth of [
		{ ok: false as const, error: "runtime key disappeared" },
		{ ok: true as const, apiKey: "   " },
	]) {
		await assert.rejects(
			() =>
				createFeynmanBtwModelRuntime(
					{
						modelRegistry: {
							getRegisteredNativeProvider: () => undefined,
							getRegisteredProviderConfig: () => ({
								...providerConfig,
								apiKey: "static-fallback-key",
							}),
							getProviderAuthStatus: () => ({
								configured: true,
								source: "runtime",
							}),
							getApiKeyAndHeaders: async () => invalidAuth,
						},
					},
					model,
				),
			/Unable to copy the temporary runtime API key for test-provider\/test-model/,
		);
	}
});

test("/btw and /btw:summarize use the copied temporary runtime key", async (t) => {
	const module = await loadPatchedBtwModule(t, "btw-command-runtime-test-");
	const provider = await createProviderRuntime([
		"side answer",
		"summary answer",
	]);
	const harness = createCommandHarness(
		module.default,
		provider.registry,
		provider.model,
	);

	await harness.start();
	await harness.command("btw", "side question");
	await harness.command("btw:summarize", "inject this");
	await harness.shutdown();

	assert.deepEqual(provider.runtimeKeys, [
		"temporary-test-key",
		"temporary-test-key",
	]);
	assert.deepEqual(
		harness.appended.map((entry) => entry.type),
		["btw-thread-entry", "btw-thread-reset"],
	);
	assert.deepEqual(harness.sent, [
		{
			message:
				"Here is a summary of a side conversation I had. inject this\n\nsummary answer",
			options: undefined,
		},
	]);
});

test("/btw and /btw:summarize fail closed when the runtime key disappears", async (t) => {
	const module = await loadPatchedBtwModule(t, "btw-command-auth-error-test-");
	const provider = await createProviderRuntime([
		"side answer",
		"summary answer",
	]);
	const originalGetAuth =
		provider.registry.getApiKeyAndHeaders.bind(provider.registry);
	type AuthResult = Awaited<
		ReturnType<ModelRegistry["getApiKeyAndHeaders"]>
	>;
	let authResults: AuthResult[] = [];
	provider.registry.getApiKeyAndHeaders = async (model) =>
		authResults.shift() ?? originalGetAuth(model);
	const goodAuth: AuthResult = {
		ok: true,
		apiKey: "temporary-test-key",
	};
	const missingAuth: AuthResult = {
		ok: false,
		error: "runtime key disappeared",
	};
	const harness = createCommandHarness(
		module.default,
		provider.registry,
		provider.model,
	);

	await harness.start();
	authResults = [goodAuth, missingAuth];
	await assert.rejects(
		() => harness.command("btw", "must not use fallback credentials"),
		/Unable to copy the temporary runtime API key for test-provider\/test-model: runtime key disappeared/,
	);
	assert.deepEqual(provider.runtimeKeys, []);
	assert.equal(harness.appended.length, 0);

	authResults = [goodAuth, goodAuth];
	await harness.command("btw", "side question");
	assert.deepEqual(provider.runtimeKeys, ["temporary-test-key"]);

	authResults = [goodAuth, missingAuth];
	await harness.command("btw:summarize", "first attempt");
	assert.deepEqual(provider.runtimeKeys, ["temporary-test-key"]);
	assert.deepEqual(
		harness.appended.map((entry) => entry.type),
		["btw-thread-entry"],
	);
	assert.deepEqual(harness.sent, []);

	authResults = [goodAuth, goodAuth];
	await harness.command("btw:summarize", "retry");
	await harness.shutdown();
	assert.deepEqual(provider.runtimeKeys, [
		"temporary-test-key",
		"temporary-test-key",
	]);
	assert.deepEqual(
		harness.appended.map((entry) => entry.type),
		["btw-thread-entry", "btw-thread-reset"],
	);
	assert.deepEqual(harness.sent, [
		{
			message:
				"Here is a summary of a side conversation I had. retry\n\nsummary answer",
			options: undefined,
		},
	]);
});
