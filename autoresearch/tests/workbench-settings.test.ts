import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildWorkbenchState } from "../src/workbench/scan.js";
import { startWorkbenchServer } from "../src/workbench/server.js";
import {
	readWorkbenchSettings,
	removeWorkbenchSettingsRecord,
	upsertWorkbenchSettingsRecord,
} from "../src/workbench/settings-store.js";

function makeSettingsWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-settings-"));
	mkdirSync(join(root, "outputs", ".plans"), { recursive: true });
	mkdirSync(join(root, "outputs", ".drafts"), { recursive: true });
	mkdirSync(join(root, "papers"), { recursive: true });
	mkdirSync(join(root, "notes"), { recursive: true });
	mkdirSync(join(root, ".feynman", "agents"), { recursive: true });
	writeFileSync(join(root, "CHANGELOG.md"), [
		"# Changelog",
		"",
		"### 2026-07-01 10:30 PDT - settings",
		"",
		"- Verified: settings resources are mutable.",
		"- Next: inspect the workbench UI.",
		"",
	].join("\n"));
	return root;
}

test("buildWorkbenchState exposes mutable science settings resources", () => {
	const root = makeSettingsWorkspace();
	const previousClaudeScienceReference = process.env.FEYNMAN_DEBUG_CLAUDE_SCIENCE_REFERENCE;
	try {
		delete process.env.FEYNMAN_DEBUG_CLAUDE_SCIENCE_REFERENCE;
		upsertWorkbenchSettingsRecord(root, {
			collection: "customConnectors",
			record: {
				id: "lab-mcp",
				name: "Lab MCP",
				description: "Lab-local data and analysis tools.",
				transport: "streamable_http",
				url: "https://mcp.example.edu/mcp",
				headersHelper: "lab-auth headers",
				oauthServerUrl: "https://auth.example.edu",
				clientId: "lab-client",
				scopes: "datasets.read literature.search",
				skipApprovals: true,
				assignedSpecialists: "Researcher\nVerifier",
				excludedTools: "dangerous_write,admin_delete",
			},
		});
		upsertWorkbenchSettingsRecord(root, {
			collection: "computeHosts",
			record: {
				id: "biowulf",
				name: "Biowulf",
				host: "biowulf.nih.gov",
				scheduler: "slurm",
				guidance: "Use sbatch for long jobs.",
			},
		});
		upsertWorkbenchSettingsRecord(root, {
			collection: "allowedDomains",
			record: { id: "nih-data", domain: "data.example.edu" },
		});
		upsertWorkbenchSettingsRecord(root, {
			collection: "credentialRefs",
			record: { id: "lab-nim", name: "Lab NIM API", provider: "nvidia", envVar: "LAB_NIM_API_KEY" },
		});
		upsertWorkbenchSettingsRecord(root, {
			collection: "permissionGrants",
			record: { id: "pubmed-search", name: "PubMed search", scope: "connector:pubmed:search", decision: "allow" },
		});
		upsertWorkbenchSettingsRecord(root, {
			collection: "memoryCategories",
			record: {
				id: "experiment-results",
				name: "Experiment results",
				guidance: "Save verified experiment findings.",
				autoRecall: true,
			},
		});

		const state = buildWorkbenchState({ workingDir: root, version: "0.0.0-test" });
		const connectors = state.resources.find((group) => group.id === "connectors")?.resources ?? [];
		const compute = state.resources.find((group) => group.id === "compute")?.resources ?? [];
		const network = state.resources.find((group) => group.id === "network")?.resources ?? [];
			const credentials = state.resources.find((group) => group.id === "credentials")?.resources ?? [];
			const permissions = state.resources.find((group) => group.id === "permissions")?.resources ?? [];
			const memory = state.resources.find((group) => group.id === "memory")?.resources ?? [];
			const general = state.resources.find((group) => group.id === "general")?.resources ?? [];

			assert.equal(connectors[0]?.name, "Feynman Bio Tools");
			assert.equal(connectors[0]?.source, "Feynman built-in science tools");
			assert.equal(general.some((resource) => resource.name.includes("Claude Science")), false);
			const biomart = connectors.find((resource) => resource.name === "BioMart");
			assert.equal(biomart?.section, "Featured");
			assert.equal(biomart?.connectorKind, "featured");
			assert.equal(biomart?.status, "configured");
			assert.equal(biomart?.source, "Built-in science database tool");
			assert.equal(biomart?.tools?.some((tool) => tool.name === "feynman_science_database_search"), true);
			assert.equal(biomart?.tools?.some((tool) => tool.name === "list_marts"), true);
			const zinc = connectors.find((resource) => resource.name === "ZINC");
			assert.equal(zinc?.section, "Featured");
			assert.equal(zinc?.connectorKind, "featured");
			assert.equal(zinc?.status, "configured");
			assert.equal(zinc?.source, "Built-in science database tool");
			assert.equal(zinc?.tools?.some((tool) => tool.name === "feynman_science_database_search"), true);
		const pubmed = connectors.find((resource) => resource.name === "PubMed" && resource.section === "Directory");
		assert.equal(Boolean(pubmed), true);
		assert.equal(pubmed?.status, "configured");
		assert.equal(pubmed?.source, "Built-in science database tool");
		assert.equal(pubmed?.tools?.some((tool) => tool.name === "feynman_science_database_search"), true);
			for (const name of ["Antibody Registry", "arXiv", "bioRxiv", "BindingDB", "CADD", "cBioPortal", "CIViC", "ClinGen", "ClinVar", "COSMIC", "Crossref", "DataCite", "dbSNP", "DepMap", "Ensembl", "ENCODE", "eQTL Catalogue", "Europe PMC", "GEO", "gnomAD", "GTEx", "GWAS Catalog", "Human Protein Atlas", "InterPro", "KEGG", "medRxiv", "MetaboLights", "NCBI Variation Services", "OLS", "OpenAlex", "Open Targets", "openFDA", "PRIDE", "PubChem", "QuickGO", "RCSB PDB", "Reactome", "Rfam", "Rhea", "STRING", "UCSC Genome Browser", "UniBind", "UniProt"]) {
			const resource = connectors.find((item) => item.name === name && item.section === "Directory");
			assert.equal(resource?.status, "configured");
			assert.equal(resource?.source, "Built-in science database tool");
			assert.equal(resource?.tools?.some((tool) => tool.name === "feynman_science_database_search"), true);
		}
			for (const name of ["Cancer Models", "CellGuide", "Chemistry", "Clinical Genomics", "Drug Regulatory", "Expression", "Genes & Ontologies", "Genomes", "Human Genetics", "Literature Graph", "Omics Archives", "Protein Annotation", "Regulation", "RNA", "Structures & Interactions", "Variants"]) {
			const resource = connectors.find((item) => item.name === name && item.section === "Featured");
			assert.equal(resource?.status, "configured");
			assert.equal(resource?.source, "Built-in science database tool");
			assert.equal(resource?.tools?.some((tool) => tool.name === "feynman_science_database_search"), true);
		}
			const humanGenetics = connectors.find((item) => item.name === "Human Genetics" && item.section === "Featured");
			assert.equal(humanGenetics?.tools?.[0]?.description, "Built-in read-only Human Genetics search source: gwascatalog.");
			const literatureGraph = connectors.find((item) => item.name === "Literature Graph" && item.section === "Featured");
			assert.equal(literatureGraph?.tools?.[0]?.description, "Built-in read-only Literature Graph search source: openalex.");
			assert.equal(biomart?.tools?.[0]?.description, "Built-in read-only BioMart search source: biomart.");
			const ketcher = connectors.find((item) => item.name === "Ketcher Chemistry" && item.section === "Featured");
			assert.equal(ketcher?.status, "configured");
			assert.equal(ketcher?.source, "Built-in science workbench tool");
			assert.equal(ketcher?.tools?.some((tool) => tool.name === "feynman_open_chemistry_sketcher"), true);
		assert.equal(connectors.some((resource) => resource.name === "Google Drive" && resource.section === "Organization"), true);

		const labConnector = connectors.find((resource) => resource.name === "Lab MCP");
		assert.equal(labConnector?.settingsCollection, "customConnectors");
		assert.equal(labConnector?.connectorKind, "custom");
		assert.equal(labConnector?.section, "Custom");
		assert.equal(labConnector?.tags?.includes("skip approvals"), true);
		assert.equal(labConnector?.tags?.includes("assigned specialists"), true);
		assert.equal(labConnector?.tags?.includes("excluded tools"), true);
		assert.equal(labConnector?.diagnostics?.some((item) => item.includes("skip approvals is enabled")), true);
		assert.equal(labConnector?.diagnostics?.some((item) => item.includes("available to Researcher, Verifier")), true);
		assert.equal(labConnector?.diagnostics?.some((item) => item.includes("dangerous_write, admin_delete")), true);
		assert.deepEqual(readWorkbenchSettings(root).customConnectors[0] && {
			oauthServerUrl: readWorkbenchSettings(root).customConnectors[0].oauthServerUrl,
			clientId: readWorkbenchSettings(root).customConnectors[0].clientId,
			scopes: readWorkbenchSettings(root).customConnectors[0].scopes,
			skipApprovals: readWorkbenchSettings(root).customConnectors[0].skipApprovals,
			assignedSpecialists: readWorkbenchSettings(root).customConnectors[0].assignedSpecialists,
			excludedTools: readWorkbenchSettings(root).customConnectors[0].excludedTools,
		}, {
			oauthServerUrl: "https://auth.example.edu",
			clientId: "lab-client",
			scopes: "datasets.read literature.search",
			skipApprovals: true,
			assignedSpecialists: ["Researcher", "Verifier"],
			excludedTools: ["dangerous_write", "admin_delete"],
		});
		assert.equal(compute.find((resource) => resource.name === "Biowulf")?.settingsCollection, "computeHosts");
		assert.equal(network.find((resource) => resource.name === "data.example.edu")?.settingsCollection, "allowedDomains");
		assert.equal(credentials.find((resource) => resource.name === "Lab NIM API")?.settingsCollection, "credentialRefs");
		assert.equal(permissions.find((resource) => resource.name === "PubMed search")?.settingsCollection, "permissionGrants");
		assert.equal(memory.find((resource) => resource.name === "Experiment results")?.settingsCollection, "memoryCategories");
		const memoryCategory = state.memoryCategories.find((category) => category.settingsRecordId === "experiment-results");
		assert.match(memoryCategory?.id ?? "", /^[0-9a-f-]{36}$/);
		assert.equal(memoryCategory?.userId, "local-workbench");
		assert.equal(memoryCategory?.name, "Experiment results");
		assert.equal(memoryCategory?.nameLower, "experiment results");
		assert.equal(memoryCategory?.guidance, "Save verified experiment findings.");
		assert.equal(memoryCategory?.autoRecall, true);
		assert.ok((memoryCategory?.createdAtMs ?? 0) > 0);

		removeWorkbenchSettingsRecord(root, "allowedDomains", "nih-data");
		assert.equal(readWorkbenchSettings(root).allowedDomains.length, 0);
		assert.equal(
			buildWorkbenchState({ workingDir: root, version: "0.0.0-test" })
				.resources.find((group) => group.id === "network")
				?.resources.some((resource) => resource.name === "data.example.edu"),
			false,
		);
	} finally {
		if (previousClaudeScienceReference === undefined) delete process.env.FEYNMAN_DEBUG_CLAUDE_SCIENCE_REFERENCE;
		else process.env.FEYNMAN_DEBUG_CLAUDE_SCIENCE_REFERENCE = previousClaudeScienceReference;
		rmSync(root, { recursive: true, force: true });
	}
});

test("buildWorkbenchState reflects science provider credential sources", () => {
	const root = makeSettingsWorkspace();
	const previousModalId = process.env.MODAL_TOKEN_ID;
	const previousModalSecret = process.env.MODAL_TOKEN_SECRET;
	const previousNvidiaKey = process.env.NVIDIA_API_KEY;
	try {
		process.env.MODAL_TOKEN_ID = "modal-test-id";
		process.env.MODAL_TOKEN_SECRET = "modal-test-secret";
		process.env.NVIDIA_API_KEY = "nvidia-test-key";

		const state = buildWorkbenchState({ workingDir: root, version: "0.0.0-test" });
		const compute = state.resources.find((group) => group.id === "compute")?.resources ?? [];
		const credentials = state.resources.find((group) => group.id === "credentials")?.resources ?? [];
		const modalProvider = state.compute.find((provider) => provider.id === "modal");
		const bionemoProvider = state.compute.find((provider) => provider.id === "nvidia-bionemo");
		assert.equal(modalProvider?.status, "configured");
		assert.equal(modalProvider?.enabled, true);
		assert.equal(bionemoProvider?.status, "configured");
		assert.equal(bionemoProvider?.enabled, true);
		assert.equal(bionemoProvider?.tools?.some((tool) => tool.name === "feynman_model_endpoint_call"), true);

		const modalCompute = compute.find((resource) => resource.id === "compute-modal");
		assert.equal(modalCompute?.status, "configured");
		assert.equal(modalCompute?.detail, "MODAL_TOKEN_ID / MODAL_TOKEN_SECRET");
		assert.equal(modalCompute?.diagnostics?.some((item) => item.includes("Modal token environment variables are present")), true);

		const bionemoCompute = compute.find((resource) => resource.id === "compute-nvidia-bionemo");
		assert.equal(bionemoCompute?.status, "configured");
		assert.equal(bionemoCompute?.diagnostics?.some((item) => item.includes("NVIDIA_API_KEY is present")), true);
		assert.equal(bionemoCompute?.diagnostics?.some((item) => item.includes("feynman_model_endpoint_call")), true);
		assert.equal(bionemoCompute?.diagnostics?.some((item) => item.includes("outputs/model-endpoints")), true);
		assert.equal(bionemoCompute?.tools?.some((tool) => tool.name === "feynman_model_endpoint_call"), true);

		const modalCredential = credentials.find((resource) => resource.id === "credential-modal");
		assert.equal(modalCredential?.status, "configured");
		assert.equal(modalCredential?.detail, "MODAL_TOKEN_ID / MODAL_TOKEN_SECRET");
		assert.equal(modalCredential?.diagnostics?.some((item) => item.includes("MODAL_TOKEN_ID and MODAL_TOKEN_SECRET are present")), true);

		const nvidiaCredential = credentials.find((resource) => resource.id === "credential-nvidia");
		assert.equal(nvidiaCredential?.status, "configured");
		assert.equal(nvidiaCredential?.detail, "NVIDIA_API_KEY");
	} finally {
		if (previousModalId === undefined) delete process.env.MODAL_TOKEN_ID;
		else process.env.MODAL_TOKEN_ID = previousModalId;
		if (previousModalSecret === undefined) delete process.env.MODAL_TOKEN_SECRET;
		else process.env.MODAL_TOKEN_SECRET = previousModalSecret;
		if (previousNvidiaKey === undefined) delete process.env.NVIDIA_API_KEY;
		else process.env.NVIDIA_API_KEY = previousNvidiaKey;
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench server mutates science settings resources through the authenticated API", async () => {
	const root = makeSettingsWorkspace();
	const handle = await startWorkbenchServer({
		workingDir: root,
		version: "0.0.0-test",
		host: "127.0.0.1",
		port: 0,
		token: "test-token",
	});
	try {
		const headers = {
			"content-type": "application/json",
			cookie: "feynman_workbench=test-token",
		};
		const created = await fetch(`${handle.url}api/resources/settings`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				collection: "allowedDomains",
				record: { id: "lab-data", domain: "DATA.EXAMPLE.EDU" },
			}),
		});
		assert.equal(created.status, 200);
		const createdPayload = await created.json() as {
			settings: { allowedDomains: Array<{ id: string; domain: string }> };
			state: { resources: Array<{ id: string; resources: Array<{ name: string; settingsCollection?: string }> }> };
		};
		assert.equal(createdPayload.settings.allowedDomains[0]?.domain, "data.example.edu");
		assert.equal(
			createdPayload.state.resources.find((group) => group.id === "network")
				?.resources.find((resource) => resource.name === "data.example.edu")
				?.settingsCollection,
			"allowedDomains",
		);
		const category = await fetch(`${handle.url}api/resources/settings`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				collection: "memoryCategories",
				record: {
					id: "protocol-notes",
					name: "Protocol Notes",
					guidance: "Recall protocol-specific caveats for active experiments.",
					autoRecall: false,
				},
			}),
		});
		assert.equal(category.status, 200);
		const categoryPayload = await category.json() as {
			settings: { memoryCategories: Array<{ id: string; autoRecall: boolean }> };
			state: { memoryCategories: Array<{ settingsRecordId: string; nameLower: string; autoRecall: boolean }> };
		};
		assert.equal(categoryPayload.settings.memoryCategories[0]?.autoRecall, false);
		assert.equal(categoryPayload.state.memoryCategories.find((record) => record.settingsRecordId === "protocol-notes")?.nameLower, "protocol notes");
		assert.equal(categoryPayload.state.memoryCategories.find((record) => record.settingsRecordId === "protocol-notes")?.autoRecall, false);

		const removed = await fetch(`${handle.url}api/resources/settings`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				action: "remove",
				collection: "allowedDomains",
				id: createdPayload.settings.allowedDomains[0]?.id,
			}),
		});
		assert.equal(removed.status, 200);
		const removedPayload = await removed.json() as { settings: { allowedDomains: unknown[] } };
		assert.equal(removedPayload.settings.allowedDomains.length, 0);
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench server mutates compute provider control state", async () => {
	const root = makeSettingsWorkspace();
	upsertWorkbenchSettingsRecord(root, {
		collection: "computeHosts",
		record: {
			id: "cluster",
			name: "Cluster",
			host: "cluster.example.edu",
			user: "researcher",
			scheduler: "slurm",
		},
	});
	const handle = await startWorkbenchServer({
		workingDir: root,
		version: "0.0.0-test",
		host: "127.0.0.1",
		port: 0,
		token: "test-token",
	});
	try {
		const headers = {
			"content-type": "application/json",
			cookie: "feynman_workbench=test-token",
		};
		const disabled = await fetch(`${handle.url}api/compute/provider/action`, {
			method: "POST",
			headers,
			body: JSON.stringify({ providerId: "nvidia-bionemo", action: "disable" }),
		});
		assert.equal(disabled.status, 200);
		const disabledPayload = await disabled.json() as { state: { compute: Array<{ id: string; enabled: boolean }> } };
		assert.equal(disabledPayload.state.compute.find((provider) => provider.id === "nvidia-bionemo")?.enabled, false);
		assert.equal(readWorkbenchSettings(root).computeProviderPreferences.find((preference) => preference.id === "nvidia-bionemo")?.enabled, false);

		const removed = await fetch(`${handle.url}api/compute/provider/action`, {
			method: "POST",
			headers,
			body: JSON.stringify({ providerId: "ssh:cluster", action: "remove" }),
		});
		assert.equal(removed.status, 200);
		const removedPayload = await removed.json() as { state: { compute: Array<{ id: string }> } };
		assert.equal(readWorkbenchSettings(root).computeHosts.length, 0);
		assert.equal(removedPayload.state.compute.some((provider) => provider.id === "ssh:cluster"), false);
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});
