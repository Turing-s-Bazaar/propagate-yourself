import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

import * as rootUndici from "undici";

type UndiciProxyApi = Pick<typeof rootUndici, "EnvHttpProxyAgent" | "fetch">;

const requireFromPi = createRequire(
	resolve(process.cwd(), "node_modules", "@earendil-works", "pi-coding-agent", "package.json"),
);
const piUndici = requireFromPi("undici") as UndiciProxyApi;

function listen(server: Server): Promise<void> {
	return new Promise((resolveListen, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolveListen();
		});
	});
}

function close(server: Server): Promise<void> {
	return new Promise((resolveClose, reject) => {
		server.close((error) => error ? reject(error) : resolveClose());
	});
}

async function assertPlainHttpProxyForwarding(undici: UndiciProxyApi): Promise<void> {
	const requests: Array<{ method?: string; url?: string }> = [];
	const tunnels: Array<{ method?: string; url?: string }> = [];
	const proxy = createServer((request, response) => {
		requests.push({ method: request.method, url: request.url });
		response.writeHead(200, { "content-type": "text/plain" });
		response.end("proxied");
	});
	proxy.on("connect", (request, socket) => {
		tunnels.push({ method: request.method, url: request.url });
		socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
	});
	await listen(proxy);

	const address = proxy.address();
	assert.ok(address && typeof address === "object");
	const proxyUrl = `http://127.0.0.1:${address.port}`;
	const dispatcher = new undici.EnvHttpProxyAgent({
		httpProxy: proxyUrl,
		httpsProxy: proxyUrl,
		noProxy: "",
	});

	try {
		const response = await undici.fetch("http://example.test/mcp", { dispatcher });
		assert.equal(await response.text(), "proxied");
		assert.deepEqual(requests, [{ method: "GET", url: "http://example.test/mcp" }]);
		assert.deepEqual(tunnels, []);
	} finally {
		await dispatcher.close();
		await close(proxy);
	}
}

test("Feynman's Undici forwards plain HTTP requests through an HTTP proxy", async () => {
	await assertPlainHttpProxyForwarding(rootUndici);
});

test("bundled Pi's Undici forwards plain HTTP requests through an HTTP proxy", async () => {
	await assertPlainHttpProxyForwarding(piUndici);
});
