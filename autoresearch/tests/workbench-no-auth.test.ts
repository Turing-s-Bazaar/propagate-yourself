import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { startWorkbenchServer } from "../src/workbench/server.js";

function makeWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-no-auth-"));
	mkdirSync(join(root, "outputs"), { recursive: true });
	writeFileSync(join(root, "outputs", "result.md"), "# Result\n\nEvidence.\n");
	return root;
}

function makeReactAppRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-app-"));
	mkdirSync(join(root, "dist", "workbench-web", "assets"), { recursive: true });
	writeFileSync(join(root, "dist", "workbench-web", "index.html"), [
		"<!doctype html>",
		"<html>",
		"<head><title>Feynman Science</title></head>",
		"<body><div id=\"root\"></div><script type=\"module\" src=\"/app-shell/assets/app.js\"></script></body>",
		"</html>",
	].join(""));
	writeFileSync(join(root, "dist", "workbench-web", "assets", "app.js"), "console.log('react-shell');\n");
	return root;
}

function rawHttpRequest(port: number, request: string): Promise<string> {
	return new Promise((resolve, reject) => {
		let response = "";
		const socket = connect({ host: "127.0.0.1", port }, () => socket.end(request));
		socket.setEncoding("utf8");
		socket.on("data", (chunk) => {
			response += chunk;
		});
		socket.on("end", () => resolve(response));
		socket.on("error", reject);
	});
}

test("workbench server can run without local launch auth", async () => {
	const root = makeWorkspace();
	const appRoot = makeReactAppRoot();
	const handle = await startWorkbenchServer({
		appRoot,
		workingDir: root,
		version: "0.0.0-test",
		host: "127.0.0.1",
		port: 0,
		requireAuth: false,
	});
	try {
		assert.equal(handle.openUrl, handle.url);
		assert.equal(handle.token, "");

		const shell = await fetch(handle.url);
		assert.equal(shell.status, 200);
		assert.match(await shell.text(), /\/app-shell\/assets\/app\.js/);

		const state = await fetch(`${handle.url}api/state`);
		assert.equal(state.status, 200);
		const payload = await state.json() as { summary: { artifactCount: number } };
		assert.equal(payload.summary.artifactCount, 1);

		const projectRoute = await fetch(`${handle.url}projects/workspace/frames/result`);
		assert.equal(projectRoute.status, 200);
		assert.match(await projectRoute.text(), /\/app-shell\/assets\/app\.js/);
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
		rmSync(appRoot, { recursive: true, force: true });
	}
});

test("workbench server keeps internal request failures out of HTTP responses and diagnostics", async () => {
	const root = makeWorkspace();
	const originalConsoleError = console.error;
	const diagnostics: string[] = [];
	console.error = (...values: unknown[]) => diagnostics.push(values.map(String).join(" "));
	const privateSentinel = "private-sentinel-research-path.md";
	const handle = await startWorkbenchServer({
		workingDir: root,
		version: "0.0.0-test",
		host: "127.0.0.1",
		port: 0,
		requireAuth: false,
	});
	try {
		const response = await fetch(`${handle.url}api/file?path=outputs/${privateSentinel}`);
		const body = await response.text();

		assert.equal(response.status, 500);
		assert.equal(body, "Internal server error.");
		assert.doesNotMatch(body, /private-sentinel|Artifact not found|outputs\//);
		assert.equal(diagnostics.length, 1);
		assert.match(diagnostics[0] ?? "", /^Feynman workbench request failed \(Error; error_message_hash=[a-f0-9]{16}\)\.$/);
		assert.doesNotMatch(diagnostics[0] ?? "", /private-sentinel|Artifact not found|outputs\//);

		const streamResponse = await fetch(`${handle.url}api/chat/message/stream`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				projectId: "workspace",
				title: "Missing session",
				message: "test",
			}),
		});
		assert.equal(streamResponse.status, 500);
		assert.equal(await streamResponse.text(), "Internal server error.");
		assert.doesNotMatch(streamResponse.headers.get("content-type") ?? "", /text\/event-stream/);
		assert.equal(diagnostics.length, 2);

		for (const invalidBody of [
			{ sessionId: "scaling-laws", projectId: "workspace", title: "Blank message", message: " " },
			{ sessionId: "../escape", projectId: "workspace", title: "Invalid session", message: "test" },
		]) {
			const invalidResponse = await fetch(`${handle.url}api/chat/message/stream`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(invalidBody),
			});
			assert.equal(invalidResponse.status, 500);
			assert.equal(await invalidResponse.text(), "Internal server error.");
			assert.doesNotMatch(invalidResponse.headers.get("content-type") ?? "", /text\/event-stream/);
		}
		assert.equal(diagnostics.length, 4);
	} finally {
		console.error = originalConsoleError;
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});

test("invalid request targets return a generic error without terminating the workbench server", async () => {
	const root = makeWorkspace();
	const originalConsoleError = console.error;
	const diagnostics: string[] = [];
	console.error = (...values: unknown[]) => diagnostics.push(values.map(String).join(" "));
	const handle = await startWorkbenchServer({
		workingDir: root,
		version: "0.0.0-test",
		host: "127.0.0.1",
		port: 0,
		requireAuth: false,
	});
	try {
		const port = Number(new URL(handle.url).port);
		const response = await rawHttpRequest(port, `GET //[ HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
		assert.match(response, /^HTTP\/1\.1 500 /);
		assert.match(response, /Internal server error\./);
		assert.equal(diagnostics.length, 1);

		const healthy = await fetch(`${handle.url}api/health`);
		assert.equal(healthy.status, 200);
		assert.deepEqual(await healthy.json(), { ok: true });
	} finally {
		console.error = originalConsoleError;
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});

test("post-header stream failures emit a terminal generic SSE error", async () => {
	const root = makeWorkspace();
	const originalConsoleError = console.error;
	const diagnostics: string[] = [];
	console.error = (...values: unknown[]) => diagnostics.push(values.map(String).join(" "));
	const handle = await startWorkbenchServer({
		workingDir: root,
		version: "0.0.0-test",
		host: "127.0.0.1",
		port: 0,
		requireAuth: false,
		promptExecutor: async (request) => {
			(request.session.messages[0] as unknown as { content: bigint }).content = 1n;
			return { content: "streamed before storage failed" };
		},
	});
	try {
		const response = await fetch(`${handle.url}api/chat/message/stream`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				sessionId: "storage-failure",
				projectId: "workspace",
				title: "Storage failure",
				message: "test",
			}),
		});
		assert.equal(response.status, 200);
		assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
		const body = await response.text();
		assert.match(body, /event: error\ndata: {"type":"error","message":"Internal server error\."}\n\n$/);
		assert.doesNotMatch(body, /BigInt|serialize|TypeError/);
		assert.equal(diagnostics.length, 1);

		const healthy = await fetch(`${handle.url}api/health`);
		assert.equal(healthy.status, 200);
	} finally {
		console.error = originalConsoleError;
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});

test("malformed cookies stay unauthorized without crashing the workbench server", async () => {
	const root = makeWorkspace();
	const handle = await startWorkbenchServer({
		workingDir: root,
		version: "0.0.0-test",
		host: "127.0.0.1",
		port: 0,
		token: "cookie-test-token",
	});
	try {
		const unauthorized = await fetch(`${handle.url}api/state`, {
			headers: { cookie: "feynman_workbench=%" },
		});
		assert.equal(unauthorized.status, 401);
		const healthy = await fetch(`${handle.url}api/health`);
		assert.equal(healthy.status, 200);
		assert.deepEqual(await healthy.json(), { ok: true });
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});
