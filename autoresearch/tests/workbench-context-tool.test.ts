import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { registerWorkbenchContextTool } from "../extensions/research-tools/workbench-context.js";
import { workbenchDataPath } from "../src/workbench/data-root.js";

type RegisteredTool = {
	execute: (toolCallId: string, params: { includeDiagnostics?: boolean }) => Promise<{
		content: Array<{ text: string; type: string }>;
		details: unknown;
	}>;
	name: string;
};

test("feynman_workbench_context returns sanitized configured resources", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-context-tool-"));
	const previousCwd = process.cwd();
	const previousKey = process.env.LAB_CONTEXT_KEY;
	const previousNvidiaKey = process.env.NVIDIA_API_KEY;
	process.env.LAB_CONTEXT_KEY = "secret-value";
	process.env.NVIDIA_API_KEY = "nvidia-secret-value";
	try {
		writeFileSync(workbenchDataPath(root, "settings.json"), JSON.stringify({
			schema: "feynman.workbenchSettings.v1",
			customConnectors: [{
				id: "lab-mcp",
				name: "Lab MCP",
				transport: "streamable_http",
				url: "https://mcp.example.edu/mcp",
				headersHelper: "headers-command",
				assignedSpecialists: ["Researcher"],
				excludedTools: ["dangerous_write"],
			}],
			credentialRefs: [{
				id: "lab-key",
				name: "Lab key",
				provider: "lab",
				envVar: "LAB_CONTEXT_KEY",
			}],
			permissionGrants: [{
				id: "deny-danger",
				name: "Dangerous write",
				scope: "connector:lab-mcp:write",
				decision: "deny",
			}],
			allowedDomains: [{ id: "data", domain: "data.example.edu" }],
			computeHosts: [],
			memoryCategories: [],
			updatedAt: "2026-07-01T00:00:00.000Z",
		}, null, 2));

		let tool: RegisteredTool | undefined;
		registerWorkbenchContextTool({
			registerTool(definition: RegisteredTool) {
				tool = definition;
			},
		} as never);
		process.chdir(root);

		const result = await tool!.execute("tool-call", { includeDiagnostics: true });
		const text = result.content[0]?.text ?? "";

		assert.equal(tool?.name, "feynman_workbench_context");
		assert.match(text, /Lab MCP/);
		assert.match(text, /Researcher/);
		assert.match(text, /dangerous_write/);
		assert.match(text, /LAB_CONTEXT_KEY/);
		assert.match(text, /"status": "present"/);
		assert.match(text, /connector:lab-mcp:write/);
		assert.match(text, /data\.example\.edu/);
		assert.match(text, /NVIDIA BioNeMo NIM/);
		assert.match(text, /feynman_model_endpoint_call/);
		assert.match(text, /NVIDIA_API_KEY/);
		assert.doesNotMatch(text, /secret-value/);
		assert.doesNotMatch(text, /nvidia-secret-value/);
	} finally {
		process.chdir(previousCwd);
		if (previousKey === undefined) {
			delete process.env.LAB_CONTEXT_KEY;
		} else {
			process.env.LAB_CONTEXT_KEY = previousKey;
		}
		if (previousNvidiaKey === undefined) {
			delete process.env.NVIDIA_API_KEY;
		} else {
			process.env.NVIDIA_API_KEY = previousNvidiaKey;
		}
		rmSync(root, { recursive: true, force: true });
	}
});
