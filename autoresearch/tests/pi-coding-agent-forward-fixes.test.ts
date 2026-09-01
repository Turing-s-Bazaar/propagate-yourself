import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
	assertPiCodingAgentForwardFixSource,
	PI_CODING_AGENT_FORWARD_FIX_TARGETS,
	patchPiCodingAgentForwardFixSource,
} from "../scripts/lib/pi-runtime-correctness-patch.mjs";
import { patchPiRuntimeNodeModules } from "../src/pi/runtime-patches.js";

const appRoot = process.cwd();
patchPiRuntimeNodeModules(appRoot);
const codingAgentRoot = resolve(
	appRoot,
	"node_modules",
	"@earendil-works",
	"pi-coding-agent",
);
const tinyJpeg2x1 =
	"/9j/4AAQSkZJRgABAgAAAQABAAD/wAARCAABAAIDAREAAhEBAxEB/9sAQwADAgIDAgIDAwMDBAMDBAUIBQUEBAUKBwcGCAwKDAwLCgsLDQ4SEA0OEQ4LCxAWEBETFBUVFQwPFxgWFBgSFBUU/9sAQwEDBAQFBAUJBQUJFA0LDRQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD4H8Q/8h/Uv+vmX/0M1/o1wJ/ySWU/9g1D/wBNRMOM/wDkp8z/AOv9b/05I//Z";

function app1Segment(payload: Uint8Array): Buffer {
	const segment = Buffer.alloc(payload.length + 4);
	segment[0] = 0xff;
	segment[1] = 0xe1;
	segment.writeUInt16BE(payload.length + 2, 2);
	segment.set(payload, 4);
	return segment;
}

function jpegWithXmp(orientation?: number): Buffer {
	const jpeg = Buffer.from(tinyJpeg2x1, "base64");
	const xmp = app1Segment(
		Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:x="adobe:ns:meta/"/>'),
	);
	const segments = [jpeg.subarray(0, 2), xmp];
	if (orientation !== undefined) {
		assert.equal(orientation, 6);
		segments.push(
			app1Segment(
				Buffer.concat([
					Buffer.from("Exif\0\0"),
					Buffer.from("49492a0008000000010012010300010000000600000000000000", "hex"),
				]),
			),
		);
	}
	segments.push(jpeg.subarray(2));
	return Buffer.concat(segments);
}

test("coding-agent forward fixes are complete, fail-closed, and idempotent", () => {
	for (const relativePath of PI_CODING_AGENT_FORWARD_FIX_TARGETS) {
		const source = readFileSync(
			resolve(codingAgentRoot, ...relativePath.split("/")),
			"utf8",
		);
		assert.doesNotThrow(() =>
			assertPiCodingAgentForwardFixSource(relativePath, source, relativePath)
		);
		assert.equal(patchPiCodingAgentForwardFixSource(relativePath, source), source);
		assert.doesNotMatch(source, /sourceMappingURL/);
	}

	const toolExecution = readFileSync(
		resolve(
			codingAgentRoot,
			"dist",
			"modes",
			"interactive",
			"components",
			"tool-execution.js",
		),
		"utf8",
	);
	assert.throws(
		() =>
			assertPiCodingAgentForwardFixSource(
				"dist/modes/interactive/components/tool-execution.js",
				toolExecution.replace(
					"for (const line of contentLines)\n                    lines.push(line);",
					"lines.push(...contentLines);",
				),
			),
		/(missing for \(const line of contentLines\)|retained lines\.push\(\.\.\.contentLines\))/,
	);
	const exifOrientation = readFileSync(
		resolve(codingAgentRoot, "dist", "utils", "exif-orientation.js"),
		"utf8",
	);
	assert.match(exifOrientation, /EXIF after XMP #8616/);
	assert.doesNotMatch(exifOrientation, /if \(!hasExifHeader\(bytes, segmentStart\)\)/);
});

test("large tool render appends content, spacer, and image lines without spreading", async () => {
	const modulePath = resolve(
		codingAgentRoot,
		"dist",
		"modes",
		"interactive",
		"components",
		"tool-execution.js",
	);
	const { ToolExecutionComponent } = await import(
		`${pathToFileURL(modulePath).href}?large-render=${Date.now()}`
	);
	const component = Object.create(ToolExecutionComponent.prototype) as {
		hideComponent: boolean;
		imageComponents: unknown[];
		imageSpacers: unknown[];
		selfRenderContainer: { render: () => string[] };
		hasRendererDefinition: () => boolean;
		getRenderShell: () => string;
		render: (width: number) => string[];
	};
	const contentLines = Array.from({ length: 200_000 }, (_, index) => `line-${index}`);
	const spacerLines = Array(150_000).fill("spacer");
	const imageLines = Array(150_000).fill("image");
	component.hideComponent = false;
	component.imageComponents = [{ render: () => imageLines }];
	component.imageSpacers = [{ render: () => spacerLines }];
	component.selfRenderContainer = { render: () => contentLines };
	component.hasRendererDefinition = () => true;
	component.getRenderShell = () => "self";

	const rendered = component.render(80);
	assert.equal(
		rendered.length,
		contentLines.length + spacerLines.length + imageLines.length + 1,
	);
	assert.equal(rendered[0], "");
	assert.equal(rendered[contentLines.length], contentLines.at(-1));
	assert.equal(rendered[contentLines.length + 1], "spacer");
	assert.equal(rendered[contentLines.length + spacerLines.length + 1], "image");
	assert.equal(rendered.at(-1), "image");
});

test("fd and rg release lookup uses GitHub's public redirect without API quota", async (t) => {
	const modulePath = resolve(codingAgentRoot, "dist", "utils", "tools-manager.js");
	const originalFetch = globalThis.fetch;
	t.after(() => {
		globalThis.fetch = originalFetch;
	});
	const requests: Array<{ url: string; redirect?: RequestRedirect }> = [];
	globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		requests.push({ url: String(input), redirect: init?.redirect });
		return new Response(null, {
			status: 302,
			headers: { location: "/sharkdp/fd/releases/tag/v10.3.0" },
		});
	}) as typeof fetch;

	const toolsManager = (await import(
		`${pathToFileURL(modulePath).href}?release-redirect=${Date.now()}`
	)) as unknown as { getLatestVersion(repo: string): Promise<string> };
	assert.equal(await toolsManager.getLatestVersion("sharkdp/fd"), "10.3.0");
	assert.deepEqual(requests, [
		{ url: "https://github.com/sharkdp/fd/releases/latest", redirect: "manual" },
	]);

	globalThis.fetch = (async () =>
		new Response(null, {
			status: 302,
			headers: { location: "https://attacker.example/sharkdp/fd/releases/tag/v99" },
		})) as typeof fetch;
	await assert.rejects(
		toolsManager.getLatestVersion("sharkdp/fd"),
		/Unexpected GitHub release redirect/,
	);

	globalThis.fetch = (async () =>
		new Response(null, {
			status: 302,
			headers: { location: "https://github.com/sharkdp/fd/releases/tag/v10.4.2%2Fevil" },
		})) as typeof fetch;
	await assert.rejects(
		toolsManager.getLatestVersion("sharkdp/fd"),
		/Invalid GitHub release version/,
	);
});

test("image conversion and provider resize honor EXIF orientation after XMP", async () => {
	const [{ convertToPng }, { resizeImage }, { applyExifOrientation }] = await Promise.all([
		import(
			`${pathToFileURL(resolve(codingAgentRoot, "dist", "utils", "image-convert.js")).href}?exif=${Date.now()}`
		),
		import(
			`${pathToFileURL(resolve(codingAgentRoot, "dist", "utils", "image-resize.js")).href}?exif=${Date.now()}`
		),
		import(
			`${pathToFileURL(resolve(codingAgentRoot, "dist", "utils", "exif-orientation.js")).href}?exif=${Date.now()}`
		),
	]);
	const oriented = jpegWithXmp(6);
	const converted = await convertToPng(oriented.toString("base64"), "image/jpeg");
	assert.ok(converted);
	const png = Buffer.from(converted.data, "base64");
	assert.equal(png.readUInt32BE(16), 1);
	assert.equal(png.readUInt32BE(20), 2);

	const resized = await resizeImage(oriented, "image/jpeg");
	assert.ok(resized);
	assert.equal(resized.originalWidth, 1);
	assert.equal(resized.originalHeight, 2);

	const xmpOnly = await convertToPng(jpegWithXmp().toString("base64"), "image/jpeg");
	assert.ok(xmpOnly);
	const xmpOnlyPng = Buffer.from(xmpOnly.data, "base64");
	assert.equal(xmpOnlyPng.readUInt32BE(16), 2);
	assert.equal(xmpOnlyPng.readUInt32BE(20), 1);

	const image = {};
	const malformedApp1 = Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0, 20, 0x58]);
	assert.equal(
		applyExifOrientation(
			{
				fliph: () => {
					throw new Error("malformed APP1 must not rotate");
				},
				flipv: () => {
					throw new Error("malformed APP1 must not rotate");
				},
			},
			image,
			malformedApp1,
		),
		image,
	);
});
