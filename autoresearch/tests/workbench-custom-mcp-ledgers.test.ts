import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildWorkbenchState } from "../src/workbench/scan.js";
import { startWorkbenchServer } from "../src/workbench/server.js";
import { upsertWorkbenchSettingsRecord } from "../src/workbench/settings-store.js";

function makeWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-custom-mcp-ledgers-"));
	mkdirSync(join(root, "outputs"), { recursive: true });
	mkdirSync(join(root, "papers"), { recursive: true });
	mkdirSync(join(root, "notes"), { recursive: true });
	writeFileSync(join(root, "outputs", "custom-mcp-ledgers.md"), "# Custom MCP ledgers\n");
	return root;
}

function seedConnectors(root: string): void {
	upsertWorkbenchSettingsRecord(root, {
		collection: "customConnectors",
		record: {
			id: "lab-mcp",
			name: "Lab MCP",
			description: "Lab-local data and analysis tools.",
			transport: "streamable_http",
			url: "https://mcp.example.edu/mcp",
			oauthServerUrl: "https://auth.example.edu",
			clientId: "lab-client",
			scopes: "datasets.read literature.search",
			headersHelper: "lab-auth headers",
			assignedSpecialists: "Researcher\nVerifier",
			excludedTools: "dangerous_write,admin_delete",
		},
	});
	upsertWorkbenchSettingsRecord(root, {
		collection: "customConnectors",
		record: {
			id: "local-mcp",
			name: "Local MCP",
			transport: "local",
			command: "node ./server.js",
		},
	});
}

test("buildWorkbenchState exposes Claude-style custom MCP server and assignment rows", () => {
	const root = makeWorkspace();
	try {
		seedConnectors(root);
		const state = buildWorkbenchState({ workingDir: root, version: "0.0.0-test" });
		assert.equal(state.customMcpServers.length, 2);

		const lab = state.customMcpServers.find((server) => server.settingsRecordId === "lab-mcp");
		assert.match(lab?.id ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		assert.equal(lab?.userId, "local-workbench");
		assert.equal(lab?.name, "Lab MCP");
		assert.equal(lab?.description, "Lab-local data and analysis tools.");
		assert.equal(lab?.url, "https://mcp.example.edu/mcp");
		assert.equal(lab?.transport, "streamable_http");
		assert.equal(lab?.oauthServerUrl, "https://auth.example.edu");
		assert.equal(lab?.clientId, "lab-client");
		assert.equal(lab?.scopes, "datasets.read literature.search");
		assert.equal(lab?.headersHelper, "lab-auth headers");
		assert.equal(lab?.source, "custom");
		assert.equal(lab?.resourceIdentifier, "https://mcp.example.edu/mcp");
		assert.ok((lab?.createdAtMs ?? 0) > 0);
		assert.ok((lab?.updatedAtMs ?? 0) > 0);

		const labAssignments = state.mcpAgentAssignments.filter((assignment) => assignment.settingsRecordId === "lab-mcp");
		assert.deepEqual(labAssignments.map((assignment) => assignment.agentName).sort(), ["Researcher", "Verifier"]);
		for (const assignment of labAssignments) {
			assert.match(assignment.id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
			assert.equal(assignment.mcpServerId, lab?.id);
			assert.equal(assignment.userId, "local-workbench");
			assert.deepEqual(assignment.excludedTools, ["dangerous_write", "admin_delete"]);
			assert.equal(assignment.createdAt, lab?.createdAt);
			assert.equal(assignment.createdAtMs, lab?.createdAtMs);
		}

		const local = state.customMcpServers.find((server) => server.settingsRecordId === "local-mcp");
		assert.equal(local?.transport, "local");
		assert.equal(local?.url, "");
		assert.equal(local?.resourceIdentifier, "node ./server.js");
		const localAssignments = state.mcpAgentAssignments.filter((assignment) => assignment.settingsRecordId === "local-mcp");
		assert.deepEqual(localAssignments.map((assignment) => assignment.agentName), ["feynman"]);
		assert.deepEqual(localAssignments[0]?.excludedTools, []);
		assert.equal(localAssignments[0]?.mcpServerId, local?.id);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench server returns custom MCP ledgers through state", async () => {
	const root = makeWorkspace();
	seedConnectors(root);
	const handle = await startWorkbenchServer({
		workingDir: root,
		version: "0.0.0-test",
		host: "127.0.0.1",
		port: 0,
		token: "test-token",
	});
	try {
		const response = await fetch(`${handle.url}api/state`, {
			headers: { cookie: "feynman_workbench=test-token" },
		});
		assert.equal(response.status, 200);
		const payload = await response.json() as {
			customMcpServers: Array<{ id: string; name: string; transport: string }>;
			mcpAgentAssignments: Array<{ mcpServerId: string; agentName: string; excludedTools: string[] }>;
		};
		const lab = payload.customMcpServers.find((server) => server.name === "Lab MCP");
		assert.equal(lab?.transport, "streamable_http");
		assert.deepEqual(
			payload.mcpAgentAssignments
				.filter((assignment) => assignment.mcpServerId === lab?.id)
				.map((assignment) => [assignment.agentName, assignment.excludedTools] as const)
				.sort((a, b) => a[0].localeCompare(b[0])),
			[
				["Researcher", ["dangerous_write", "admin_delete"]],
				["Verifier", ["dangerous_write", "admin_delete"]],
			],
		);
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});
