import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
	assertPiAgentCorePatchSource,
	patchPiAgentCoreSource,
} from "../scripts/lib/pi-agent-core-patch.mjs";
import { patchPiRuntimeNodeModules } from "../src/pi/runtime-patches.js";

const TOOL_SOURCE = `
async function prepareToolCall(currentContext, assistantMessage, toolCall, config, signal) {
    const tool = currentContext.tools?.find((t) => t.name === toolCall.name);
    if (!tool) {
        return {
            kind: "immediate",
            result: createErrorToolResult(\`Tool \${toolCall.name} not found\`),
            isError: true,
        };
    }
    try {
        const preparedToolCall = prepareToolCallArguments(tool, toolCall);
        const validatedArgs = validateToolArguments(tool, preparedToolCall);
        if (config.beforeToolCall) {
            const beforeResult = await config.beforeToolCall({
                assistantMessage,
                toolCall,
                args: validatedArgs,
                context: currentContext,
            }, signal);
        }
        return {
            kind: "prepared",
            toolCall,
            tool,
            args: validatedArgs,
        };
    }
    catch (error) {
        return {
            kind: "immediate",
            result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
            isError: true,
        };
    }
}
`;
const STREAM_SOURCE = `
async function streamAssistantResponse(context, config, signal, emit, streamFunction) {
    const llmContext = { systemPrompt: "", messages: [], tools: [] };
    const resolvedApiKey = config.apiKey;
    const response = await streamFunction(config.model, llmContext, {
        ...config,
        apiKey: resolvedApiKey,
        signal,
    });
    let partialMessage = null;
    let addedPartial = false;
    for await (const event of response) {
        if (event.type === "start") {
            partialMessage = event.partial;
            context.messages.push(partialMessage);
            addedPartial = true;
        }
    }
    const finalMessage = await response.result();
    if (addedPartial) {
        context.messages[context.messages.length - 1] = finalMessage;
    }
    return finalMessage;
}
`;
const SOURCE = `${STREAM_SOURCE}\n${TOOL_SOURCE}`;

test("patchPiAgentCoreSource maps google search aliases to web_search", () => {
	const patched = patchPiAgentCoreSource(SOURCE);

	assert.match(patched, /function normalizeFeynmanToolAlias/);
	assert.match(patched, /\["google:search", "web_search"\]/);
	assert.match(patched, /\["search_web", "web_search"\]/);
	assert.match(patched, /\["fetch", "fetch_content"\]/);
	assert.match(patched, /\["read_url_content", "fetch_content"\]/);
	assert.match(patched, /function normalizeFeynmanFetchToolArguments/);
	assert.match(patched, /normalized\.urls = normalized\.url/);
	assert.match(patched, /const effectiveToolCall = normalizeFeynmanToolAlias\(toolCall, currentContext\.tools\)/);
	assert.match(patched, /t\.name === effectiveToolCall\.name/);
	assert.match(patched, /prepareToolCallArguments\(tool, effectiveToolCall\)/);
	assert.match(patched, /toolCall: preparedToolCall/);
	assert.doesNotThrow(() => assertPiAgentCorePatchSource(patched));
});

test("patchPiAgentCoreSource is idempotent", () => {
	const once = patchPiAgentCoreSource(SOURCE);
	const twice = patchPiAgentCoreSource(once);
	assert.equal(twice, once);

	const legacyCandidate = once.replace(
		`            try {
                // Provider iterators can ignore abort and leave return() pending behind
                // the same silent network read. Cleanup is best-effort; the watchdog
                // must still settle the Pi turn immediately.
                Promise.resolve(iterator.return?.()).catch(() => {});
            }
            catch {
                // Some provider iterators do not implement cooperative return.
            }`,
		`            try {
                await iterator.return?.();
            }
            catch {
                // Some provider iterators do not implement cooperative return.
            }`,
	);
	assert.notEqual(legacyCandidate, once);
	assert.equal(patchPiAgentCoreSource(legacyCandidate), once);
});

test("stream watchdog is default-disabled and fails closed on invalid policy", () => {
	const appRoot = process.cwd();
	patchPiRuntimeNodeModules(appRoot);
	const agentCorePath = resolve(
		appRoot,
		"node_modules",
		"@earendil-works",
		"pi-agent-core",
		"dist",
		"agent-loop.js",
	);
	const source = readFileSync(agentCorePath, "utf8");
	assert.doesNotThrow(() => assertPiAgentCorePatchSource(source, "installed AgentCore"));
	assert.match(source, /FEYNMAN_PI_STREAM_EVENT_IDLE_TIMEOUT_MS/);
	assert.match(source, /\?\? 0;/);
	assert.match(source, /Number\.isInteger\(parsed\)/);
	assert.match(source, /FEYNMAN_MAX_STREAM_EVENT_IDLE_TIMEOUT_MS/);
	assert.doesNotMatch(source, /isFeynmanLocalStreamModel/);
	assert.doesNotMatch(source, /sourceMappingURL/);
});

test("explicit stream watchdog aborts the provider, settles result, and is retryable", async (t) => {
	const appRoot = process.cwd();
	patchPiRuntimeNodeModules(appRoot);
	const originalTimeout = process.env.FEYNMAN_PI_STREAM_EVENT_IDLE_TIMEOUT_MS;
	process.env.FEYNMAN_PI_STREAM_EVENT_IDLE_TIMEOUT_MS = "20";
	t.after(() => {
		if (originalTimeout === undefined) {
			delete process.env.FEYNMAN_PI_STREAM_EVENT_IDLE_TIMEOUT_MS;
		} else {
			process.env.FEYNMAN_PI_STREAM_EVENT_IDLE_TIMEOUT_MS = originalTimeout;
		}
	});

	const [{ agentLoop }, piAi] = await Promise.all([
		import("@earendil-works/pi-agent-core"),
		import("@earendil-works/pi-ai"),
	]);
	const { createAssistantMessageEventStream, isRetryableAssistantError } = piAi;
	const model = {
		id: "remote-test",
		name: "remote-test",
		api: "openai-completions" as const,
		provider: "remote-test",
		baseUrl: "https://provider.example/v1",
		reasoning: false,
		input: ["text" as const],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 100,
	};
	let providerStream: ReturnType<typeof createAssistantMessageEventStream> | undefined;
	let providerAbortCount = 0;
	const streamFn = (_model: unknown, _context: unknown, options: { signal?: AbortSignal }) => {
		providerStream = createAssistantMessageEventStream();
		options.signal?.addEventListener("abort", () => providerAbortCount++, { once: true });
		return providerStream;
	};
	const context = { systemPrompt: "", messages: [], tools: [] };
	const stream = agentLoop(
		[{ role: "user", content: "hello", timestamp: Date.now() }],
		context,
		{
			model,
			convertToLlm: (messages: unknown[]) => messages,
		} as never,
		undefined,
		streamFn as never,
	);
	const events: unknown[] = [];
	for await (const event of stream) events.push(event);
	const messages = await stream.result();
	const final = messages.at(-1);
	assert.equal(final?.role, "assistant");
	assert.equal(final?.role === "assistant" ? final.stopReason : undefined, "error");
	assert.match(
		final?.role === "assistant" ? final.errorMessage ?? "" : "",
		/Provider stream event timeout after 20ms without a Pi event/,
	);
	assert.equal(final?.role === "assistant" && isRetryableAssistantError(final), true);
	assert.equal(await providerStream?.result(), final);
	assert.equal(providerAbortCount, 1);
	assert.equal(events.filter((event: any) => event.type === "message_end").length, 2);
	t.diagnostic("silent provider stream settled through the 20ms test override");
});

test("stream watchdog does not wait for a non-cooperative iterator return", async (t) => {
	const originalTimeout = process.env.FEYNMAN_PI_STREAM_EVENT_IDLE_TIMEOUT_MS;
	process.env.FEYNMAN_PI_STREAM_EVENT_IDLE_TIMEOUT_MS = "20";
	t.after(() => {
		if (originalTimeout === undefined) {
			delete process.env.FEYNMAN_PI_STREAM_EVENT_IDLE_TIMEOUT_MS;
		} else {
			process.env.FEYNMAN_PI_STREAM_EVENT_IDLE_TIMEOUT_MS = originalTimeout;
		}
	});

	const { agentLoop } = await import("@earendil-works/pi-agent-core");
	const never = new Promise<never>(() => {});
	let settleProviderResult: ((message: unknown) => void) | undefined;
	const providerResult = new Promise<unknown>((resolveResult) => {
		settleProviderResult = resolveResult;
	});
	let returnCalled = false;
	const providerStream = {
		end(message: unknown) {
			settleProviderResult?.(message);
		},
		result() {
			return providerResult;
		},
		[Symbol.asyncIterator]() {
			return {
				next: () => never,
				return: () => {
					returnCalled = true;
					return never;
				},
			};
		},
	};
	const model = {
		id: "non-cooperative-stream",
		name: "non-cooperative-stream",
		api: "openai-completions" as const,
		provider: "remote-test",
		baseUrl: "https://provider.example/v1",
		reasoning: false,
		input: ["text" as const],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 100,
	};
	const stream = agentLoop(
		[{ role: "user", content: "hello", timestamp: Date.now() }],
		{ systemPrompt: "", messages: [], tools: [] },
		{ model, convertToLlm: (messages: unknown[]) => messages } as never,
		undefined,
		(() => providerStream) as never,
	);
	const completion = (async () => {
		for await (const _event of stream) {
			// Drain the real agent loop.
		}
		return stream.result();
	})();
	const outcome = await Promise.race([
		completion.then(() => "settled"),
		new Promise<string>((resolveTimeout) =>
			setTimeout(() => resolveTimeout("timed-out"), 250)
		),
	]);

	assert.equal(outcome, "settled");
	assert.equal(returnCalled, true);
});

test("user abort settles immediately even when the stream watchdog is disabled", async () => {
	const originalTimeout = process.env.FEYNMAN_PI_STREAM_EVENT_IDLE_TIMEOUT_MS;
	delete process.env.FEYNMAN_PI_STREAM_EVENT_IDLE_TIMEOUT_MS;
	const [{ agentLoop }, { createAssistantMessageEventStream }] = await Promise.all([
		import("@earendil-works/pi-agent-core"),
		import("@earendil-works/pi-ai"),
	]);
	const model = {
		id: "local-prefill",
		name: "local-prefill",
		api: "openai-completions" as const,
		provider: "custom-local",
		baseUrl: "http://192.168.1.50:11434/v1",
		reasoning: false,
		input: ["text" as const],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 100,
	};
	const controller = new AbortController();
	let markProviderStarted: (() => void) | undefined;
	const providerStarted = new Promise<void>((resolveStarted) => {
		markProviderStarted = resolveStarted;
	});
	let providerSignal: AbortSignal | undefined;
	const streamFn = (_model: unknown, _context: unknown, options: { signal?: AbortSignal }) => {
		providerSignal = options.signal;
		markProviderStarted?.();
		return createAssistantMessageEventStream();
	};
	const stream = agentLoop(
		[{ role: "user", content: "hello", timestamp: Date.now() }],
		{ systemPrompt: "", messages: [], tools: [] },
		{
			model,
			convertToLlm: (messages: unknown[]) => messages,
			streamIdleTimeoutMs: 0,
		} as never,
		controller.signal,
		streamFn as never,
	);
	const eventsPromise = (async () => {
		const events: unknown[] = [];
		for await (const event of stream) events.push(event);
		return events;
	})();
	await providerStarted;
	controller.abort();
	const [events, messages] = await Promise.all([eventsPromise, stream.result()]);
	if (originalTimeout !== undefined) {
		process.env.FEYNMAN_PI_STREAM_EVENT_IDLE_TIMEOUT_MS = originalTimeout;
	}
	const final = messages.at(-1);
	assert.equal(final?.role === "assistant" ? final.stopReason : undefined, "aborted");
	assert.equal(final?.role === "assistant" ? final.errorMessage : "unexpected", undefined);
	assert.equal(providerSignal?.aborted, true);
	assert.equal(events.filter((event: any) => event.type === "message_end").length, 2);
});
