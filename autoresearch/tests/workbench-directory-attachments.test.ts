import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildWorkbenchState } from "../src/workbench/scan.js";
import { startWorkbenchServer } from "../src/workbench/server.js";
import { readWorkbenchSettings, upsertWorkbenchSettingsRecord } from "../src/workbench/settings-store.js";

function makeWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-directory-attachments-"));
	mkdirSync(join(root, "outputs"), { recursive: true });
	mkdirSync(join(root, "papers"), { recursive: true });
	mkdirSync(join(root, "notes"), { recursive: true });
	writeFileSync(join(root, "outputs", "directory-attachments.md"), "# Directory attachments\n");
	return root;
}

function seedCustomConnector(root: string): void {
	upsertWorkbenchSettingsRecord(root, {
		collection: "customConnectors",
		record: {
			id: "lab-mcp",
			name: "Lab MCP",
			description: "Lab-local data and analysis tools.",
			transport: "streamable_http",
			url: "https://mcp.example.edu/mcp",
			assignedSpecialists: "Researcher\nVerifier",
			excludedTools: "dangerous_write,admin_delete",
			createdAt: "2026-07-03T20:10:00.000Z",
			updatedAt: "2026-07-03T20:20:00.000Z",
		},
	});
}

test("buildWorkbenchState exposes Feynman-owned directory attachment rows", () => {
	const root = makeWorkspace();
	const previousClaudeScienceReference = process.env.FEYNMAN_DEBUG_CLAUDE_SCIENCE_REFERENCE;
	try {
		delete process.env.FEYNMAN_DEBUG_CLAUDE_SCIENCE_REFERENCE;
		seedCustomConnector(root);
		const labCreatedAt = readWorkbenchSettings(root).customConnectors.find((connector) => connector.id === "lab-mcp")?.createdAt;
		const state = buildWorkbenchState({ workingDir: root, version: "0.0.0-test" });
		assert.equal(state.directoryAttachments.some((attachment) => attachment.source.includes("Claude Science")), false);
		assert.ok(state.directoryAttachments.length >= 30);

		const pubmed = state.directoryAttachments.find((attachment) =>
			attachment.connectorName === "PubMed" && attachment.agentName === "feynman"
		);
		assert.equal(pubmed?.userId, "local-workbench");
		assert.match(pubmed?.serverUuid ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		assert.equal(pubmed?.connectorKind, "directory");
		assert.equal(pubmed?.status, "configured");
		assert.deepEqual(pubmed?.excludedTools, []);
		assert.equal(pubmed?.toolNames.includes("feynman_science_database_search"), true);

		const bioTools = state.directoryAttachments.find((attachment) => attachment.connectorId === "feynman-bio-tools");
		assert.equal(bioTools?.agentName, "feynman");
		assert.equal(bioTools?.connectorKind, "featured");
		assert.equal(bioTools?.source, "Feynman built-in science tools");
		assert.equal(state.directoryAttachments.some((attachment) => attachment.connectorId === "bundled:bio" || attachment.serverUuid === "bundled:bio"), false);
		assert.equal(state.directoryAttachments.some((attachment) => attachment.connectorName.includes("Claude Science")), false);
		for (const [connectorId, connectorName] of [
			["science-connector-biomart", "BioMart"],
			["science-connector-pubmed", "PubMed"],
			["science-connector-clinical-trials", "Clinical Trials"],
			["science-connector-chembl", "ChEMBL"],
			["science-connector-biorxiv", "bioRxiv"],
			["science-connector-variants", "Variants"],
			["science-connector-clinical-genomics", "Clinical Genomics"],
			["science-connector-expression", "Expression"],
			["science-connector-regulation", "Regulation"],
			["science-connector-protein-annotation", "Protein Annotation"],
			["science-connector-rna", "RNA"],
			["science-connector-structures-interactions", "Structures & Interactions"],
			["science-connector-omics-archives", "Omics Archives"],
			["science-connector-genes-ontologies", "Genes & Ontologies"],
			["science-connector-drug-regulatory", "Drug Regulatory"],
			["science-connector-cellguide", "CellGuide"],
			["science-connector-cancer-models", "Cancer Models"],
			["science-connector-human-genetics", "Human Genetics"],
			["science-connector-literature-graph", "Literature Graph"],
		] as const) {
			const attachment = state.directoryAttachments.find((row) => row.connectorId === connectorId);
			assert.equal(attachment?.connectorName, connectorName, `expected split attachment for ${connectorId}`);
			assert.equal(attachment?.status, "configured", `expected configured split attachment for ${connectorId}`);
			assert.equal(attachment?.toolNames.includes("feynman_science_database_search"), true, `expected Feynman database tool on ${connectorId}`);
		}

		const labRows = state.directoryAttachments.filter((attachment) => attachment.connectorName === "Lab MCP");
		assert.deepEqual(labRows.map((row) => row.agentName).sort(), ["Researcher", "Verifier"]);
		for (const row of labRows) {
			assert.equal(row.connectorKind, "custom");
			assert.equal(row.settingsCollection, "customConnectors");
			assert.equal(row.settingsRecordId, "lab-mcp");
			assert.deepEqual(row.excludedTools, ["dangerous_write", "admin_delete"]);
			assert.deepEqual(row.toolNames, []);
			assert.equal(row.createdAt, labCreatedAt);
			assert.equal(row.createdAtMs, Date.parse(labCreatedAt ?? ""));
		}
		assert.equal(new Set(labRows.map((row) => row.serverUuid)).size, 1);
	} finally {
		if (previousClaudeScienceReference === undefined) delete process.env.FEYNMAN_DEBUG_CLAUDE_SCIENCE_REFERENCE;
		else process.env.FEYNMAN_DEBUG_CLAUDE_SCIENCE_REFERENCE = previousClaudeScienceReference;
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench server returns directory attachments through state", async () => {
	const root = makeWorkspace();
	seedCustomConnector(root);
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
			directoryAttachments: Array<{ connectorName: string; agentName: string; excludedTools: string[] }>;
		};
		assert.equal(payload.directoryAttachments.some((attachment) => attachment.connectorName === "PubMed"), true);
		assert.deepEqual(
			payload.directoryAttachments
				.filter((attachment) => attachment.connectorName === "Lab MCP")
				.map((attachment) => [attachment.agentName, attachment.excludedTools] as const)
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
