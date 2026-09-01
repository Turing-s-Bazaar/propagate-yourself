import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
	assertPiAiForwardFixSource,
	PI_AI_FORWARD_FIX_MARKERS,
	patchPiAiForwardFixSource,
} from "../scripts/lib/pi-ai-forward-fixes-patch.mjs";
import {
	assertPiAiForwardFixArchive,
	assertPiAiForwardFixPackageTree,
} from "../scripts/lib/pi-ai-forward-fixes-verifier.mjs";
import { patchPiRuntimeNodeModules } from "../src/pi/runtime-patches.js";

const appRoot = process.cwd();
patchPiRuntimeNodeModules(appRoot);

const piAiRoot = resolve(appRoot, "node_modules", "@earendil-works", "pi-ai");
const nestedPiAiRoot = resolve(
	appRoot,
	"node_modules",
	"@earendil-works",
	"pi-coding-agent",
	"node_modules",
	"@earendil-works",
	"pi-ai",
);
const BEDROCK_RELATIVE_PATH = "dist/api/bedrock-converse-stream.js";
const BEDROCK_TOOL_RESULT_IMAGES = ["Zmlyc3Q=", "c2Vjb25k"] as const;
const BEDROCK_EMPTY_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

type BedrockPayload = {
	messages: Array<{
		role: string;
		content: Array<{
			image?: { format?: string; source?: { bytes?: Uint8Array } };
			toolResult?: {
				toolUseId: string;
				content: Array<{ text?: string; image?: unknown }>;
				status: string;
			};
		}>;
	}>;
};

function readPiAiSource(root: string, relativePath: string): string {
	return readFileSync(resolve(root, ...relativePath.split("/")), "utf8");
}

function bedrockToolResultModel(id: string) {
	return {
		id,
		name: id,
		api: "bedrock-converse-stream",
		provider: "amazon-bedrock",
		baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_000_000,
		maxTokens: 128_000,
	};
}

function bedrockToolResultContext(
	modelId: string,
	errorToolResult: "none" | "current" | "consecutive" = "none",
) {
	return {
		messages: [
			{ role: "user", content: "Inspect two charts", timestamp: 1 },
			{
				role: "assistant",
				content: [
					{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "/tmp/chart-1.png" } },
					{ type: "toolCall", id: "tool-2", name: "read", arguments: { path: "/tmp/chart-2.png" } },
				],
				api: "bedrock-converse-stream",
				provider: "amazon-bedrock",
				model: modelId,
				usage: BEDROCK_EMPTY_USAGE,
				stopReason: "toolUse",
				timestamp: 2,
			},
			{
				role: "toolResult",
				toolCallId: "tool-1",
				toolName: "read",
				content: [
					{ type: "text", text: "rendered chart" },
					{ type: "image", data: BEDROCK_TOOL_RESULT_IMAGES[0], mimeType: "image/png" },
				],
				isError: errorToolResult === "current",
				timestamp: 3,
			},
			{
				role: "toolResult",
				toolCallId: "tool-2",
				toolName: "read",
				content: [{ type: "image", data: BEDROCK_TOOL_RESULT_IMAGES[1], mimeType: "image/png" }],
				isError: errorToolResult === "consecutive",
				timestamp: 4,
			},
		],
	};
}

async function captureBedrockToolResultPayload(
	root: string,
	modelId: string,
	label: string,
	errorToolResult: "none" | "current" | "consecutive" = "none",
): Promise<BedrockPayload> {
	const bedrock = await import(
		`${pathToFileURL(resolve(root, ...BEDROCK_RELATIVE_PATH.split("/"))).href}?tool-result-images=${Date.now()}-${label}`
	);
	let payload: BedrockPayload | undefined;
	const captureMessage = `captured ${label} Bedrock tool-result payload`;
	const result = await bedrock.stream(
		bedrockToolResultModel(modelId),
		bedrockToolResultContext(modelId, errorToolResult),
		{
			cacheRetention: "none",
			env: { AWS_BEDROCK_SKIP_AUTH: "1" },
			onPayload: (request: BedrockPayload) => {
				payload = request;
				throw new Error(captureMessage);
			},
		},
	).result();
	assert.ok(result.errorMessage?.includes(captureMessage));
	assert.ok(payload, `${label} Bedrock tool-result payload was not captured`);
	return payload;
}

function assertHoistedBedrockOpenAiToolResultPayload(
	payload: BedrockPayload,
	label: string,
	expectedStatuses: readonly ["success" | "error", "success" | "error"] = ["success", "success"],
): void {
	const message = payload.messages.at(-1);
	assert.ok(message);
	assert.equal(message.role, "user");
	assert.equal(message.content.length, 4, `${label} must retain two tool results and two sibling images`);
	assert.deepEqual(message.content[0].toolResult, {
		toolUseId: "tool-1",
		content: [{ text: "rendered chart" }],
		status: expectedStatuses[0],
	});
	assert.deepEqual(message.content[1].toolResult, {
		toolUseId: "tool-2",
		content: [{ text: "<empty>" }],
		status: expectedStatuses[1],
	});
	assert.deepEqual(
		message.content.slice(2).map((block) => ({
			format: block.image?.format,
			data: Buffer.from(block.image?.source?.bytes ?? []).toString("base64"),
		})),
		BEDROCK_TOOL_RESULT_IMAGES.map((data) => ({ format: "png", data })),
		`${label} must preserve sibling image order and bytes`,
	);
}

function assertNestedBedrockAnthropicToolResultPayload(payload: BedrockPayload, label: string): void {
	const message = payload.messages.at(-1);
	assert.ok(message);
	assert.equal(message.role, "user");
	assert.equal(message.content.length, 2, `${label} Anthropic control must not gain sibling images`);
	assert.deepEqual(
		message.content[0].toolResult?.content.map((block) => Object.keys(block)[0]),
		["text", "image"],
	);
	assert.deepEqual(
		message.content[1].toolResult?.content.map((block) => Object.keys(block)[0]),
		["image"],
	);
}

function unpatchedBedrockSourceFixture(): string {
	return [
		"            const client = new BedrockRuntimeClient(config);",
		"            if (response.$metadata.httpStatusCode !== undefined) {",
		"function convertToolResultContent(content) {",
		"    const result = [];",
		"    for (const c of content) {",
		'        if (c.type === "image") {',
		"            result.push({ image: createImageBlock(c.mimeType, c.data) });",
		"        }",
		"        else {",
		"            const textBlock = createNonBlankTextBlock(c.text);",
		"            if (textBlock)",
		"                result.push(textBlock);",
		"        }",
		"    }",
		"    if (result.length === 0)",
		"        result.push({ text: EMPTY_TEXT_PLACEHOLDER });",
		"    return result;",
		"}",
		"function convertMessages(context, model, cacheRetention, env) {",
		"    const result = [];",
		"    const transformedMessages = transformMessages(context.messages, model, normalizeToolCallId);",
		"    for (let i = 0; i < transformedMessages.length; i++) {",
		"        const m = transformedMessages[i];",
		"        switch (m.role) {",
		'            case "toolResult": {',
		"                // Collect all consecutive toolResult messages into a single user message",
		"                // Bedrock requires all tool results to be in one message",
		"                const toolResults = [];",
		"                // Add current tool result with all content blocks combined",
		"                toolResults.push({",
		"                    toolResult: {",
		"                        toolUseId: m.toolCallId,",
		"                        content: convertToolResultContent(m.content),",
		"                        status: m.isError ? ToolResultStatus.ERROR : ToolResultStatus.SUCCESS,",
		"                    },",
		"                });",
		"                // Look ahead for consecutive toolResult messages",
		"                let j = i + 1;",
		'                while (j < transformedMessages.length && transformedMessages[j].role === "toolResult") {',
		"                    const nextMsg = transformedMessages[j];",
		"                    toolResults.push({",
		"                        toolResult: {",
		"                            toolUseId: nextMsg.toolCallId,",
		"                            content: convertToolResultContent(nextMsg.content),",
		"                            status: nextMsg.isError ? ToolResultStatus.ERROR : ToolResultStatus.SUCCESS,",
		"                        },",
		"                    });",
		"                    j++;",
		"                }",
		"                // Skip the messages we've already processed",
		"                i = j - 1;",
		"                result.push({",
		"                    role: ConversationRole.USER,",
		"                    content: toolResults,",
		"                });",
		"                break;",
		"            }",
		"        }",
		"    }",
		"    return result;",
		"}",
		'    client.middlewareStack.add(middleware, { step: "build", name: "pi-ai-custom-headers", priority: "low" });',
		"}",
		"export const streamSimple",
		"    const base = buildBaseOptions(model, context, options, undefined);",
	].join("\n");
}

test("Bedrock forward patch applies the exact Pi 0.84.2 layout once", () => {
	const bedrock = patchPiAiForwardFixSource(
		BEDROCK_RELATIVE_PATH,
		unpatchedBedrockSourceFixture(),
	);
	assert.match(bedrock, new RegExp(PI_AI_FORWARD_FIX_MARKERS.bedrock));
	assert.match(bedrock, new RegExp(PI_AI_FORWARD_FIX_MARKERS.bedrockToolResultImages));
	assert.match(bedrock, /step: "deserialize", name: "pi-ai-response-headers"/);
	assert.match(bedrock, /!observedRawResponse/);
	assert.match(bedrock, /content: \[\.\.\.toolResults, \.\.\.toolImages\]/);
	assert.equal(patchPiAiForwardFixSource(BEDROCK_RELATIVE_PATH, bedrock), bedrock);
});

test("Bedrock tool-result assertions fail closed across source, patch, package, and archive surfaces", () => {
	const patched = readPiAiSource(piAiRoot, BEDROCK_RELATIVE_PATH);
	const nestedArchivePrefix =
		"npm/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/";
	const rootArchivePrefix = "npm/node_modules/@earendil-works/pi-ai/";
	const readSyntheticArchiveEntry = (
		entryPath: string,
		mutatedCopy?: "root" | "nested",
		mutatedSource?: string,
	): string => {
		const [copy, root, prefix] = entryPath.startsWith(nestedArchivePrefix)
			? ["nested" as const, nestedPiAiRoot, nestedArchivePrefix]
			: ["root" as const, piAiRoot, rootArchivePrefix];
		assert.ok(entryPath.startsWith(prefix), `unexpected synthetic archive entry: ${entryPath}`);
		const relativePath = entryPath.slice(prefix.length);
		if (copy === mutatedCopy && relativePath === BEDROCK_RELATIVE_PATH) {
			assert.ok(mutatedSource);
			return mutatedSource;
		}
		return readPiAiSource(root, relativePath);
	};

	assert.doesNotThrow(() =>
		assertPiAiForwardFixPackageTree(appRoot, (path) => readFileSync(path, "utf8")),
	);
	assert.doesNotThrow(() => assertPiAiForwardFixArchive(readSyntheticArchiveEntry));

	for (const [name, original, mutation] of [
		[
			"OpenAI model predicate",
			'    return model.id.startsWith("openai.") || model.id.includes(".openai.");',
			"    return false;",
		],
		[
			"nested image filter",
			`            if (!hoistImages)
                result.push({ image: createImageBlock(c.mimeType, c.data) });`,
			`            if (false && !hoistImages)
                result.push({ image: createImageBlock(c.mimeType, c.data) });`,
		],
		[
			"empty placeholder",
			`    if (result.length === 0)
        result.push({ text: EMPTY_TEXT_PLACEHOLDER });`,
			`    if (false && result.length === 0)
        result.push({ text: EMPTY_TEXT_PLACEHOLDER });`,
		],
		[
			"image extraction",
			'        .filter((c) => c.type === "image")',
			'        .filter((c) => c.type === "text")',
		],
		[
			"current result hoist",
			`                if (hoistImages)
                    toolImages.push(...convertToolResultImages(m.content));`,
			`                if (false && hoistImages)
                    toolImages.push(...convertToolResultImages(m.content));`,
		],
		[
			"consecutive result hoist",
			`                    if (hoistImages)
                        toolImages.push(...convertToolResultImages(nextMsg.content));`,
			`                    if (false && hoistImages)
                        toolImages.push(...convertToolResultImages(nextMsg.content));`,
		],
		[
			"sibling image publication",
			"                    content: [...toolResults, ...toolImages],",
			"                    content: toolResults,",
		],
		[
			"sibling image clearing",
			`                i = j - 1;
                result.push({`,
			`                i = j - 1;
                toolImages.length = 0;
                result.push({`,
		],
		[
			"current error status",
			"                        status: m.isError ? ToolResultStatus.ERROR : ToolResultStatus.SUCCESS,",
			"                        status: ToolResultStatus.SUCCESS,",
		],
		[
			"consecutive error status",
			"                            status: nextMsg.isError ? ToolResultStatus.ERROR : ToolResultStatus.SUCCESS,",
			"                            status: ToolResultStatus.SUCCESS,",
		],
	] as const) {
		const mutated = patched.replace(original, mutation);
		assert.notEqual(mutated, patched, name);
		assert.throws(
			() => assertPiAiForwardFixSource(BEDROCK_RELATIVE_PATH, mutated),
			/Incomplete Pi AI forward patch/,
			`${name} source assertion`,
		);
		assert.throws(
			() => patchPiAiForwardFixSource(BEDROCK_RELATIVE_PATH, mutated),
			/Incomplete Pi AI forward patch/,
			`${name} patch path`,
		);

		for (const copy of ["root", "nested"] as const) {
			const targetPath = resolve(
				appRoot,
				"node_modules",
				"@earendil-works",
				...(copy === "nested"
					? ["pi-coding-agent", "node_modules", "@earendil-works", "pi-ai"]
					: ["pi-ai"]),
				...BEDROCK_RELATIVE_PATH.split("/"),
			);
			assert.throws(
				() =>
					assertPiAiForwardFixPackageTree(
						appRoot,
						(path) => path === targetPath ? mutated : readFileSync(path, "utf8"),
					),
				new RegExp(`bundled ${copy} Pi AI`),
				`${name} bundled ${copy}`,
			);
			assert.throws(
				() =>
					assertPiAiForwardFixArchive(
						(entryPath) => readSyntheticArchiveEntry(entryPath, copy, mutated),
					),
				new RegExp(`runtime archive ${copy} Pi AI`),
				`${name} runtime archive ${copy}`,
			);
		}
	}
});

test("Bedrock preserves sibling image order and Anthropic nesting", async () => {
	for (const [copy, root] of [
		["root", piAiRoot],
		["nested", nestedPiAiRoot],
	] as const) {
		for (const modelId of [
			"openai.gpt-5.6-sol",
			"us.openai.gpt-5.6-sol",
			"global.openai.gpt-5.6-sol",
		]) {
			const payload = await captureBedrockToolResultPayload(root, modelId, `${copy}-${modelId}`);
			assertHoistedBedrockOpenAiToolResultPayload(payload, `${copy} ${modelId}`);
		}
		const anthropicModelId = "us.anthropic.claude-sonnet-4-5-20250929-v1:0";
		const anthropicPayload = await captureBedrockToolResultPayload(root, anthropicModelId, `${copy}-anthropic`);
		assertNestedBedrockAnthropicToolResultPayload(anthropicPayload, `${copy} ${anthropicModelId}`);
	}
});

test("Bedrock preserves current and consecutive OpenAI tool-result error status", async () => {
	const modelId = "us.openai.gpt-5.6-sol";
	for (const [copy, root] of [
		["root", piAiRoot],
		["nested", nestedPiAiRoot],
	] as const) {
		for (const [errorToolResult, expectedStatuses] of [
			["current", ["error", "success"]],
			["consecutive", ["success", "error"]],
		] as const) {
			const payload = await captureBedrockToolResultPayload(
				root,
				modelId,
				`${copy}-${errorToolResult}-error`,
				errorToolResult,
			);
			assertHoistedBedrockOpenAiToolResultPayload(
				payload,
				`${copy} ${errorToolResult} error`,
				expectedStatuses,
			);
		}
	}
});
