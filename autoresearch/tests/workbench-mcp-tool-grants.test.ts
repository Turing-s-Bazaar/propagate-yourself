import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildWorkbenchState } from "../src/workbench/scan.js";
import { startWorkbenchServer } from "../src/workbench/server.js";
import { upsertWorkbenchSettingsRecord } from "../src/workbench/settings-store.js";

function makeWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-mcp-tool-grants-"));
	mkdirSync(join(root, "outputs"), { recursive: true });
	mkdirSync(join(root, "papers"), { recursive: true });
	mkdirSync(join(root, "notes"), { recursive: true });
	writeFileSync(join(root, "outputs", "mcp-tool-grants.md"), "# MCP tool grants\n");
	return root;
}

function seedGrants(root: string): void {
	upsertWorkbenchSettingsRecord(root, {
		collection: "permissionGrants",
		record: {
			id: "lab-search-allow",
			name: "Lab search",
			scope: "connector:lab-mcp:search_pubmed",
			decision: "allow",
			description: "Allow PubMed search through Lab MCP.",
		},
	});
	upsertWorkbenchSettingsRecord(root, {
		collection: "permissionGrants",
		record: {
			id: "bio-tools-ask",
			name: "Feynman Bio Tools",
			scope: "builtin:feynman_science_database_search",
			decision: "ask",
		},
	});
	upsertWorkbenchSettingsRecord(root, {
		collection: "permissionGrants",
		record: {
			id: "variants-deny",
			name: "Variants",
			scope: "connector:variants:dbsnp_records",
			decision: "deny",
			description: "Deny legacy dbSNP write-shaped variants access.",
		},
	});
}

test("buildWorkbenchState exposes Claude-style MCP tool grant rows", () => {
	const root = makeWorkspace();
	try {
		seedGrants(root);
		const state = buildWorkbenchState({ workingDir: root, version: "0.0.0-test" });
		assert.equal(state.mcpToolGrants.length, 3);
		assert.equal(state.mcpToolGrants.some((grant) => grant.serverId === "bundled:bio"), false);
		assert.equal(state.mcpToolGrants.some((grant) => grant.name.includes("Claude Science")), false);

		const connectorGrant = state.mcpToolGrants.find((grant) => grant.settingsRecordId === "lab-search-allow");
		assert.match(connectorGrant?.id ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		assert.equal(connectorGrant?.userId, "local-workbench");
		assert.equal(connectorGrant?.serverId, "lab-mcp");
		assert.equal(connectorGrant?.toolName, "search_pubmed");
		assert.equal(connectorGrant?.decision, "allow");
		assert.equal(connectorGrant?.scope, "connector:lab-mcp:search_pubmed");
		assert.match(connectorGrant?.description ?? "", /Allow PubMed search/);
		assert.ok((connectorGrant?.createdAtMs ?? 0) > 0);

		const builtinGrant = state.mcpToolGrants.find((grant) => grant.settingsRecordId === "bio-tools-ask");
		assert.equal(builtinGrant?.serverId, "builtin");
		assert.equal(builtinGrant?.toolName, "feynman_science_database_search");
		assert.equal(builtinGrant?.decision, "ask");

		const variantsGrant = state.mcpToolGrants.find((grant) => grant.settingsRecordId === "variants-deny");
		assert.equal(variantsGrant?.serverId, "variants");
		assert.equal(variantsGrant?.toolName, "dbsnp_records");
		assert.equal(variantsGrant?.decision, "deny");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench server returns MCP tool grants through state", async () => {
	const root = makeWorkspace();
	seedGrants(root);
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
			mcpToolGrants: Array<{ serverId: string; toolName: string; decision: string }>;
		};
		assert.deepEqual(
			payload.mcpToolGrants.map((grant) => `${grant.serverId}:${grant.toolName}:${grant.decision}`).sort(),
			[
				"builtin:feynman_science_database_search:ask",
				"lab-mcp:search_pubmed:allow",
				"variants:dbsnp_records:deny",
			],
		);
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});
