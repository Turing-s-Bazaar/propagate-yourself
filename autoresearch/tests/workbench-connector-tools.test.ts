import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { testableWorkbenchConnectors } from "../extensions/research-tools/workbench-connectors.js";
import { upsertWorkbenchOAuthToken } from "../src/workbench/oauth-store.js";
import { readWorkbenchSettings, upsertWorkbenchSettingsRecord } from "../src/workbench/settings-store.js";

type RecordedMcpRequest = {
	body: Record<string, unknown>;
	headers: IncomingHttpHeaders;
	method: string;
};

function makeWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-connectors-"));
	return root;
}

function resultText(result: unknown): string {
	const record = result as { content?: Array<{ text?: string }> };
	return record.content?.[0]?.text ?? "";
}

async function readRequestBody(request: NodeJS.ReadableStream): Promise<string> {
	let body = "";
	for await (const chunk of request) {
		body += String(chunk);
	}
	return body;
}

async function startMcpServer() {
	const requests: RecordedMcpRequest[] = [];
	const server = createServer(async (request, response) => {
		if (request.method === "DELETE") {
			requests.push({ method: "DELETE", headers: request.headers, body: {} });
			response.statusCode = 204;
			response.end();
			return;
		}
		const body = JSON.parse(await readRequestBody(request)) as Record<string, unknown>;
		requests.push({ method: request.method ?? "POST", headers: request.headers, body });
		const id = body.id;
		const method = body.method;
		response.setHeader("content-type", "application/json");
		response.setHeader("mcp-session-id", "session-1");
		if (method === "notifications/initialized") {
			response.statusCode = 202;
			response.end();
			return;
		}
		if (method === "initialize") {
			response.end(JSON.stringify({
				jsonrpc: "2.0",
				id,
				result: {
					protocolVersion: "2025-06-18",
					capabilities: { tools: {} },
					serverInfo: { name: "test-lab-mcp", version: "0.0.0" },
				},
			}));
			return;
		}
		if (method === "tools/list") {
			response.end(JSON.stringify({
				jsonrpc: "2.0",
				id,
				result: {
					tools: [{
						name: "search_pubmed",
						description: "Search PubMed abstracts.",
						inputSchema: {
							type: "object",
							properties: { query: { type: "string" } },
							required: ["query"],
						},
					}, {
						name: "dangerous_write",
						description: "Write back to a lab system.",
						inputSchema: {
							type: "object",
							properties: { value: { type: "string" } },
						},
					}],
				},
			}));
			return;
		}
		if (method === "tools/call") {
			const params = body.params as { arguments?: { query?: string }; name?: string };
			response.end(JSON.stringify({
				jsonrpc: "2.0",
				id,
				result: {
					content: [{ type: "text", text: `result for ${params.arguments?.query ?? ""}` }],
					isError: false,
				},
			}));
			return;
		}
		response.statusCode = 400;
		response.end(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "Unknown method" } }));
	});
	await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
	const address = server.address();
	assert.ok(address && typeof address === "object");
	return {
		requests,
		url: `http://127.0.0.1:${address.port}/mcp`,
		close: () => new Promise<void>((resolvePromise, reject) => {
			server.close((error) => error ? reject(error) : resolvePromise());
		}),
	};
}

function writeSseMessage(response: ServerResponse, message: unknown): void {
	response.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
}

async function startSseMcpServer() {
	const requests: RecordedMcpRequest[] = [];
	const streams = new Set<ServerResponse>();
	const server = createServer(async (request, response) => {
		if (request.method === "GET" && request.url?.startsWith("/sse")) {
			requests.push({ method: "GET", headers: request.headers, body: {} });
			response.writeHead(200, {
				"Cache-Control": "no-cache, no-transform",
				Connection: "keep-alive",
				"Content-Type": "text/event-stream",
			});
			streams.add(response);
			response.write("event: endpoint\ndata: /messages?sessionId=sse-1\n\n");
			request.on("close", () => {
				streams.delete(response);
			});
			return;
		}
		if (request.method === "POST" && request.url?.startsWith("/messages")) {
			const body = JSON.parse(await readRequestBody(request)) as Record<string, unknown>;
			requests.push({ method: "POST", headers: request.headers, body });
			const stream = streams.values().next().value as ServerResponse | undefined;
			if (!stream) {
				response.statusCode = 500;
				response.end("SSE connection not established");
				return;
			}
			const id = body.id;
			const method = body.method;
			if (method === "initialize") {
				writeSseMessage(stream, {
					jsonrpc: "2.0",
					id,
					result: {
						protocolVersion: "2025-06-18",
						capabilities: { tools: {} },
						serverInfo: { name: "test-sse-lab-mcp", version: "0.0.0" },
					},
				});
			} else if (method === "tools/list") {
				writeSseMessage(stream, {
					jsonrpc: "2.0",
					id,
					result: {
						tools: [{
							name: "search_pubmed",
							description: "Search PubMed abstracts over SSE.",
							inputSchema: {
								type: "object",
								properties: { query: { type: "string" } },
								required: ["query"],
							},
						}, {
							name: "dangerous_write",
							description: "Write back to a lab system.",
							inputSchema: {
								type: "object",
								properties: { value: { type: "string" } },
							},
						}],
					},
				});
			} else if (method === "tools/call") {
				const params = body.params as { arguments?: { query?: string }; name?: string };
				writeSseMessage(stream, {
					jsonrpc: "2.0",
					id,
					result: {
						content: [{ type: "text", text: `sse result for ${params.arguments?.query ?? ""}` }],
						isError: false,
					},
				});
			}
			response.statusCode = 202;
			response.end("Accepted");
			return;
		}
		response.statusCode = 404;
		response.end("Not found");
	});
	await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
	const address = server.address();
	assert.ok(address && typeof address === "object");
	return {
		requests,
		url: `http://127.0.0.1:${address.port}/sse`,
		close: () => new Promise<void>((resolvePromise, reject) => {
			for (const stream of streams) stream.end();
			server.close((error) => error ? reject(error) : resolvePromise());
		}),
	};
}

function writeLocalMcpServer(root: string): string {
	const scriptPath = join(root, "local-mcp-server.mjs");
	writeFileSync(scriptPath, [
		"import { createInterface } from 'node:readline';",
		"const lines = createInterface({ input: process.stdin });",
		"function send(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n'); }",
		"for await (const line of lines) {",
		"  if (!line.trim()) continue;",
		"  const request = JSON.parse(line);",
		"  if (!request.id) continue;",
		"  if (request.method === 'initialize') {",
		"    send(request.id, { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'local-lab', version: '0.0.0' } });",
		"  } else if (request.method === 'tools/list') {",
		"    send(request.id, { tools: [{ name: 'local_search', description: `Search ${process.env.LAB_PREFIX ?? 'missing'}`, inputSchema: { type: 'object', properties: { query: { type: 'string' } } } }] });",
		"  } else if (request.method === 'tools/call') {",
		"    send(request.id, { content: [{ type: 'text', text: `local ${process.env.LAB_PREFIX ?? 'missing'} ${request.params?.arguments?.query ?? ''}` }], isError: false });",
		"  } else {",
		"    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Unknown method' } }) + '\\n');",
		"  }",
		"}",
	].join("\n"), "utf8");
	return scriptPath;
}

test("feynman connector tools discover and call allowed Streamable HTTP MCP tools", async () => {
	const root = makeWorkspace();
	const mcp = await startMcpServer();
	try {
		upsertWorkbenchSettingsRecord(root, {
			collection: "customConnectors",
			record: {
				id: "lab-mcp",
				name: "Lab MCP",
				transport: "streamable_http",
				url: mcp.url,
			},
		});
		upsertWorkbenchSettingsRecord(root, {
			collection: "permissionGrants",
			record: {
				id: "pubmed-search",
				name: "PubMed search",
				scope: "connector:lab-mcp:search_pubmed",
				decision: "allow",
			},
		});
		const listed = await testableWorkbenchConnectors.listConnectorTools(root, "lab-mcp");
		const listText = JSON.stringify(listed, null, 2);
		assert.match(listText, /search_pubmed/);
		assert.match(listText, /"grantDecision": "allow"/);

		const called = await testableWorkbenchConnectors.callConnectorTool(root, "lab-mcp", "search_pubmed", { query: "BRCA1" });
		assert.equal(resultText(called.result), "result for BRCA1");
		assert.ok(mcp.requests.some((request) => request.body.method === "tools/list"));
		assert.ok(mcp.requests.some((request) => request.body.method === "tools/call"));
		assert.ok(mcp.requests.some((request) => request.body.method === "tools/list" && request.headers["mcp-session-id"] === "session-1"));
	} finally {
		await mcp.close();
		rmSync(root, { recursive: true, force: true });
	}
});

test("feynman connector tools send stored OAuth bearer tokens to remote MCP servers", async () => {
	const root = makeWorkspace();
	const mcp = await startMcpServer();
	try {
		upsertWorkbenchSettingsRecord(root, {
			collection: "customConnectors",
			record: {
				id: "oauth-lab",
				name: "OAuth Lab",
				transport: "streamable_http",
				url: mcp.url,
				oauthServerUrl: "https://auth.example.edu/oauth",
				clientId: "oauth-client",
				skipApprovals: true,
			},
		});
		upsertWorkbenchOAuthToken(root, {
			connectorId: "oauth-lab",
			accessToken: "stored-oauth-token",
			tokenType: "Bearer",
		});
		await testableWorkbenchConnectors.listConnectorTools(root, "oauth-lab");
		assert.equal(mcp.requests[0]?.headers.authorization, "Bearer stored-oauth-token");
		assert.equal(mcp.requests.some((request) => request.headers.authorization === "Bearer stored-oauth-token"), true);
	} finally {
		await mcp.close();
		rmSync(root, { recursive: true, force: true });
	}
});

test("feynman connector tools discover and call allowed SSE MCP tools", async () => {
	const root = makeWorkspace();
	const mcp = await startSseMcpServer();
	try {
		upsertWorkbenchSettingsRecord(root, {
			collection: "customConnectors",
			record: {
				id: "sse-lab-mcp",
				name: "SSE Lab MCP",
				transport: "sse",
				url: mcp.url,
			},
		});
		upsertWorkbenchSettingsRecord(root, {
			collection: "permissionGrants",
			record: {
				id: "sse-pubmed-search",
				name: "SSE PubMed search",
				scope: "connector:sse-lab-mcp:search_pubmed",
				decision: "allow",
			},
		});
		const listed = await testableWorkbenchConnectors.listConnectorTools(root, "sse-lab-mcp");
		const listText = JSON.stringify(listed, null, 2);
		assert.match(listText, /search_pubmed/);
		assert.match(listText, /"transport": "sse"/);
		assert.match(listText, /"grantDecision": "allow"/);

		const called = await testableWorkbenchConnectors.callConnectorTool(root, "sse-lab-mcp", "search_pubmed", { query: "BRCA1" });
		assert.equal(resultText(called.result), "sse result for BRCA1");
		assert.ok(mcp.requests.some((request) => request.method === "GET" && request.headers.accept === "text/event-stream"));
		assert.ok(mcp.requests.some((request) => request.body.method === "tools/list"));
		assert.ok(mcp.requests.some((request) => request.body.method === "tools/call"));
	} finally {
		await mcp.close();
		rmSync(root, { recursive: true, force: true });
	}
});

test("feynman connector tools discover and call allowed local stdio MCP tools", async () => {
	const root = makeWorkspace();
	try {
		const scriptPath = writeLocalMcpServer(root);
		upsertWorkbenchSettingsRecord(root, {
			collection: "customConnectors",
			record: {
				id: "local-lab",
				name: "Local Lab",
				transport: "local",
				command: `${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)}`,
				env: "LAB_PREFIX=stdio",
			},
		});
		upsertWorkbenchSettingsRecord(root, {
			collection: "permissionGrants",
			record: {
				id: "local-search",
				name: "Local search",
				scope: "connector:local-lab:local_search",
				decision: "allow",
			},
		});
		const listed = await testableWorkbenchConnectors.listConnectorTools(root, "local-lab");
		const listText = JSON.stringify(listed, null, 2);
		assert.match(listText, /local_search/);
		assert.match(listText, /Search stdio/);
		assert.match(listText, /"transport": "local"/);

		const called = await testableWorkbenchConnectors.callConnectorTool(root, "local-lab", "local_search", { query: "BRCA1" });
		assert.equal(resultText(called.result), "local stdio BRCA1");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("connector calls create pending ask grants before execution", async () => {
	const root = makeWorkspace();
	try {
		upsertWorkbenchSettingsRecord(root, {
			collection: "customConnectors",
			record: {
				id: "lab-mcp",
				name: "Lab MCP",
				transport: "streamable_http",
				url: "http://127.0.0.1:9/mcp",
			},
		});
		await assert.rejects(
			() => testableWorkbenchConnectors.callConnectorTool(root, "lab-mcp", "search_pubmed", { query: "BRCA1" }),
			/waiting for approval/,
		);
		assert.deepEqual(readWorkbenchSettings(root).permissionGrants.map((grant) => ({
			id: grant.id,
			scope: grant.scope,
			decision: grant.decision,
		})), [{
			id: "connector-lab-mcp-search_pubmed",
			scope: "connector:lab-mcp:search_pubmed",
			decision: "ask",
		}]);
		upsertWorkbenchSettingsRecord(root, {
			collection: "customConnectors",
			record: {
				id: "local-lab",
				name: "Local Lab",
				transport: "local",
				command: "missing-local-mcp-command",
			},
		});
		await assert.rejects(
			() => testableWorkbenchConnectors.callConnectorTool(root, "local-lab", "local_search", { query: "BRCA1" }),
			/waiting for approval/,
		);
		assert.equal(readWorkbenchSettings(root).permissionGrants.some((grant) =>
			grant.scope === "connector:local-lab:local_search" && grant.decision === "ask"
		), true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("connector skip approvals permits calls without per-tool grants", async () => {
	const root = makeWorkspace();
	const mcp = await startMcpServer();
	try {
		upsertWorkbenchSettingsRecord(root, {
			collection: "customConnectors",
			record: {
				id: "lab-mcp",
				name: "Lab MCP",
				transport: "streamable_http",
				url: mcp.url,
				skipApprovals: true,
			},
		});
		const listed = await testableWorkbenchConnectors.listConnectorTools(root, "lab-mcp");
		assert.match(JSON.stringify(listed, null, 2), /"grantDecision": "allow"/);

		const called = await testableWorkbenchConnectors.callConnectorTool(root, "lab-mcp", "search_pubmed", { query: "TP53" });
		assert.equal(resultText(called.result), "result for TP53");
		assert.equal(readWorkbenchSettings(root).permissionGrants.length, 0);
	} finally {
		await mcp.close();
		rmSync(root, { recursive: true, force: true });
	}
});

test("connector assignments and excluded tools constrain discovery and calls", async () => {
	const root = makeWorkspace();
	const mcp = await startMcpServer();
	try {
		upsertWorkbenchSettingsRecord(root, {
			collection: "customConnectors",
			record: {
				id: "lab-mcp",
				name: "Lab MCP",
				transport: "streamable_http",
				url: mcp.url,
				assignedSpecialists: "Researcher\nVerifier",
				excludedTools: "dangerous_write",
				skipApprovals: true,
			},
		});
		const listedForResearcher = await testableWorkbenchConnectors.listConnectorTools(root, "lab-mcp", { specialist: "Researcher" });
		const researcherText = JSON.stringify(listedForResearcher, null, 2);
		const researcherDetails = listedForResearcher as { connectors: Array<{ excludedTools?: string[]; tools: Array<{ toolName?: string }> }> };
		assert.match(researcherText, /search_pubmed/);
		assert.match(researcherText, /"assignedSpecialists": \[/);
		assert.match(researcherText, /"excludedTools": \[/);
		assert.deepEqual(researcherDetails.connectors[0]?.excludedTools, ["dangerous_write"]);
		assert.deepEqual(researcherDetails.connectors[0]?.tools.map((tool) => tool.toolName), ["search_pubmed"]);

		const listedForWriter = await testableWorkbenchConnectors.listConnectorTools(root, "lab-mcp", { specialist: "Writer" });
		const writerDetails = listedForWriter as { connectors: Array<{ status: string; tools: unknown[] }> };
		assert.equal(writerDetails.connectors[0]?.status, "not_assigned");
		assert.deepEqual(writerDetails.connectors[0]?.tools, []);

		await assert.rejects(
			() => testableWorkbenchConnectors.callConnectorTool(root, "lab-mcp", "search_pubmed", { query: "BRCA1" }, { specialist: "Writer" }),
			/not available to specialist Writer/,
		);
		await assert.rejects(
			() => testableWorkbenchConnectors.callConnectorTool(root, "lab-mcp", "dangerous_write", { value: "x" }, { specialist: "Researcher" }),
			/excluded for connector Lab MCP/,
		);
		assert.equal(mcp.requests.some((request) =>
			request.body.method === "tools/call" &&
				(request.body.params as { name?: string } | undefined)?.name === "dangerous_write"
		), false);
	} finally {
		await mcp.close();
		rmSync(root, { recursive: true, force: true });
	}
});

test("headers helper output and local connector env parsing are bounded", () => {
	assert.deepEqual(
		testableWorkbenchConnectors.parseHeadersHelperOutput('{"Authorization":"Bearer token","X-Lab":"one"}'),
		{ Authorization: "Bearer token", "X-Lab": "one" },
	);
	assert.deepEqual(
		testableWorkbenchConnectors.parseHeadersHelperOutput('{"headers":{"X-Lab":"two"}}'),
		{ "X-Lab": "two" },
	);
	assert.deepEqual(
		testableWorkbenchConnectors.parseConnectorEnv("LAB_PREFIX=stdio\n# ignored\nEMPTY="),
		{ LAB_PREFIX: "stdio", EMPTY: "" },
	);
	assert.throws(
		() => testableWorkbenchConnectors.parseConnectorEnv("BAD-NAME=value"),
		/Invalid connector environment variable name/,
	);
});
