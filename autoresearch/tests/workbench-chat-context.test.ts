import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildWorkbenchRpcPrompt } from "../src/workbench/chat-runtime.js";
import { executeNotebookCell } from "../src/workbench/notebook-execution.js";
import { upsertWorkbenchSettingsRecord } from "../src/workbench/settings-store.js";

function makeWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-chat-context-"));
	mkdirSync(join(root, "outputs"), { recursive: true });
	writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n");
	return root;
}

function promptFixture(workingDir: string, message: string, specialist = "None") {
	return {
		workingDir,
		message,
		session: {
			id: "session-1",
			projectId: "workspace",
			title: "Workspace",
			createdAt: "2026-07-01T00:00:00.000Z",
			updatedAt: "2026-07-01T00:00:00.000Z",
			status: "complete" as const,
			config: {
				delegation: false,
				autoReview: false,
				memory: false,
				specialist,
				compute: "local" as const,
			},
			piSession: {
				id: "feynman-workbench-session-1",
				status: "active" as const,
				messageCount: 0,
				userMessages: 0,
				assistantMessages: 0,
				toolResults: 0,
				toolCalls: 0,
				bashExecutions: 0,
				customMessages: 0,
				branchCount: 0,
				timeline: [],
				tools: [],
			},
			attachments: [],
			messages: [],
		},
	};
}

test("workbench chat prompt includes recent notebook cells from the active session", async () => {
	const root = makeWorkspace();
	try {
		await executeNotebookCell({
			workingDir: root,
			timeoutMs: 10_000,
		}, {
			sessionId: "session-1",
			projectId: "workspace",
			title: "Scratch analysis",
			language: "bash",
			executionMode: "isolated",
			purpose: "exploration",
			code: "printf 'analysis result: 42\\n'",
		});
		await executeNotebookCell({
			workingDir: root,
			timeoutMs: 10_000,
		}, {
			sessionId: "other-session",
			projectId: "workspace",
			title: "Other analysis",
			language: "bash",
			executionMode: "isolated",
			purpose: "exploration",
			code: "printf 'should stay out\\n'",
		});

		const prompt = buildWorkbenchRpcPrompt(promptFixture(root, "what did the notebook find?"));

		assert.match(prompt, /Recent notebook cells from this session:/);
		assert.match(prompt, /Scratch analysis/);
		assert.match(prompt, /analysis result: 42/);
		assert.doesNotMatch(prompt, /should stay out/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench chat prompt includes configured science runtime resources", () => {
	const root = makeWorkspace();
	const previousKey = process.env.LAB_NIM_API_KEY;
	process.env.LAB_NIM_API_KEY = "configured-test-value";
	try {
		upsertWorkbenchSettingsRecord(root, {
			collection: "customConnectors",
			record: {
				id: "lab-mcp",
				name: "Lab MCP",
				description: "Lab-local data and analysis tools.",
				transport: "streamable_http",
				url: "https://mcp.example.edu/mcp",
				headersHelper: "lab-auth headers",
				scopes: "datasets.read",
				assignedSpecialists: ["Researcher"],
				excludedTools: ["dangerous_write"],
				skipApprovals: true,
			},
		});
		upsertWorkbenchSettingsRecord(root, {
			collection: "credentialRefs",
			record: { id: "lab-nim", name: "Lab NIM API", provider: "nvidia", envVar: "LAB_NIM_API_KEY" },
		});
		upsertWorkbenchSettingsRecord(root, {
			collection: "permissionGrants",
			record: { id: "lab-read", name: "Lab read", scope: "connector:lab-mcp:read", decision: "allow" },
		});
		upsertWorkbenchSettingsRecord(root, {
			collection: "allowedDomains",
			record: { id: "lab-data", domain: "data.example.edu" },
		});
		upsertWorkbenchSettingsRecord(root, {
			collection: "computeHosts",
			record: { id: "hpc", name: "HPC", host: "hpc.example.edu", scheduler: "slurm" },
		});
		upsertWorkbenchSettingsRecord(root, {
			collection: "memoryCategories",
			record: { id: "assays", name: "Assays", guidance: "Recall verified assay results.", autoRecall: true },
		});

		const prompt = buildWorkbenchRpcPrompt(promptFixture(root, "use the lab connector", "Researcher"));

		assert.match(prompt, /Configured science runtime resources:/);
		assert.match(prompt, /Pass specialist "Researcher" to feynman_connector_tools and feynman_connector_call/);
		assert.match(prompt, /Lab MCP \| streamable_http \| https:\/\/mcp\.example\.edu\/mcp \| auth oauth-and-headers-helper \| scopes datasets\.read \| assigned specialists Researcher \| excluded tools dangerous_write \| skip approvals/);
		assert.match(prompt, /Lab NIM API \| nvidia \| LAB_NIM_API_KEY present/);
		assert.match(prompt, /Lab read \| connector:lab-mcp:read \| allow/);
		assert.match(prompt, /data\.example\.edu/);
		assert.match(prompt, /HPC \| hpc\.example\.edu \| slurm/);
		assert.match(prompt, /NVIDIA BioNeMo NIM \| nvidia-bionemo \| models esmfold, alphafold2 \| tool feynman_model_endpoint_call/);
		assert.match(prompt, /Assays \| auto-recall \| Recall verified assay results\./);
		assert.doesNotMatch(prompt, /configured-test-value/);
	} finally {
		if (previousKey === undefined) {
			delete process.env.LAB_NIM_API_KEY;
		} else {
			process.env.LAB_NIM_API_KEY = previousKey;
		}
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench chat prompt includes built-in science database search without custom setup", () => {
	const root = makeWorkspace();
	try {
		const prompt = buildWorkbenchRpcPrompt(promptFixture(root, "find CRISPR trial and literature evidence"));

		assert.match(prompt, /Configured science runtime resources:/);
		assert.match(prompt, /feynman_science_database_search/);
		assert.match(prompt, /PubMed search\/metadata\/ID conversion\/related articles\/citation lookup\/copyright\/PMC full-text routing, Europe PMC metadata\/open-access full-text sections, OpenAlex, Crossref, arXiv, bioRxiv, medRxiv, DataCite, ClinicalTrials\.gov, ChEMBL, PubChem, ChEBI, BindingDB, ZINC, BioMart, STRING, IntAct, Complex Portal, KEGG, Rhea, Rfam, UniProt, AlphaFold DB/);
		assert.match(prompt, /PubMed related-link IDs, citation-match PMIDs, PubMed copyright\/license fields/);
		assert.match(prompt, /ZINC IDs, ZINC task ids, SMILES, supplier catalog codes/);
		assert.match(prompt, /Europe PMC full-text statuses, section inventories, figure\/table\/reference counts, OpenAlex W\/A\/S IDs/);
		assert.match(prompt, /Ensembl, MyGene\.info, CellGuide, Antibody Registry, ClinVar/);
		assert.match(prompt, /cBioPortal, CIViC, Open Targets, GWAS Catalog, openFDA, Human Protein Atlas, eQTL Catalogue, OLS, ENCODE, GEO, ArrayExpress\/BioStudies, MetaboLights, MGnify, UCSC Genome Browser, UniBind, gnomAD, GTEx, InterPro, PRIDE, JASPAR, QuickGO, and Reactome/);
		assert.match(prompt, /ChEBI accessions\/InChIKeys\/SMILES\/ontology fields/);
		assert.match(prompt, /BioMart mart names/);
		assert.match(prompt, /IntAct interaction accessions\/MI scores\/PubMed IDs/);
		assert.match(prompt, /Complex Portal CPX accessions\/participants\/stoichiometry/);
		assert.match(prompt, /AlphaFold entry\/model IDs and PDB\/CIF\/PAE links/);
		assert.match(prompt, /EMDB EMD accessions\/resolution\/map metadata/);
		assert.match(prompt, /GWAS Catalog association IDs/);
		assert.match(prompt, /openFDA set\/safety-report\/recall IDs/);
		assert.match(prompt, /Human Protein Atlas Ensembl\/UniProt\/tissue fields/);
		assert.match(prompt, /eQTL Catalogue study\/dataset\/variant\/gene\/p-value\/beta fields/);
		assert.match(prompt, /ArrayExpress accessions, MetaboLights MTBLS accessions\/study statuses\/assay technologies\/file names, MGnify study accessions/);
		assert.match(prompt, /CellGuide CL IDs, cell type names, marker symbols\/scores\/specificity/);
		assert.match(prompt, /Antibody Registry AB\/RRID accessions, vendor names, catalog numbers/);
		assert.match(prompt, /UCSC genome db names, track names, chromosome coordinates, itemsReturned\/maxItemsLimit/);
		assert.match(prompt, /UniBind TF ids, JASPAR matrix ids, prediction model names/);
		assert.match(prompt, /feynman_model_endpoint_call/);
		assert.match(prompt, /outputs\/model-endpoints/);
		assert.match(prompt, /Custom connectors:\n  - none configured/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench chat prompt includes active preview artifact context", () => {
	const root = makeWorkspace();
	try {
		writeFileSync(join(root, "outputs", "visible-note.md"), "# Visible result\n\nThe active preview says alpha equals 0.42.\n");
		writeFileSync(join(root, "outputs", "other-note.md"), "# Other result\n\nSecondary context stays bounded.\n");

		const prompt = buildWorkbenchRpcPrompt({
			...promptFixture(root, "use the visible artifact"),
			viewportContext: {
				activePath: "outputs/visible-note.md",
				openPaths: ["outputs/visible-note.md", "outputs/other-note.md", "../secret.txt"],
				previewTab: "content",
				rightTab: "files",
			},
		});

		assert.match(prompt, /Active preview context:/);
		assert.match(prompt, /Right pane: files/);
		assert.match(prompt, /Preview tab: content/);
		assert.match(prompt, /Active artifact: outputs\/visible-note\.md/);
		assert.match(prompt, /Open artifact tabs: outputs\/visible-note\.md, outputs\/other-note\.md/);
		assert.match(prompt, /The active preview says alpha equals 0\.42/);
		assert.doesNotMatch(prompt, /secret\.txt/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("notebook executions persist sanitized workbench environment snapshots", async () => {
	const root = makeWorkspace();
	try {
		writeFileSync(join(root, "package.json"), JSON.stringify({ name: "lab", dependencies: { lodash: "1.0.0" } }));
		writeFileSync(join(root, "package-lock.json"), JSON.stringify({ name: "lab", lockfileVersion: 3 }));
		writeFileSync(join(root, "pyproject.toml"), "[project]\nname = \"lab\"\n");
		writeFileSync(join(root, "uv.lock"), "version = 1\n");
		upsertWorkbenchSettingsRecord(root, {
			collection: "allowedDomains",
			record: { id: "lab-data", domain: "data.example.edu" },
		});
		const executed = await executeNotebookCell({
			workingDir: root,
			timeoutMs: 10_000,
		}, {
			sessionId: "session-1",
			projectId: "workspace",
			title: "Snapshot cell",
			language: "bash",
			executionMode: "isolated",
			purpose: "verification",
			code: "printf 'snapshot ok\\n'",
		});

		assert.equal(executed.environmentSnapshot?.schema, "feynman.workbenchEnvironmentSnapshot.v1");
		assert.equal(executed.environmentSnapshot?.language, "bash");
		assert.match(executed.environmentSnapshot?.runtime?.version ?? "", /bash/i);
		assert.deepEqual(executed.environmentSnapshot?.environmentFiles?.map((file) => file.path), [
			"package.json",
			"package-lock.json",
			"pyproject.toml",
			"uv.lock",
		]);
		assert.equal(executed.environmentSnapshot?.environmentFiles?.every((file) => /^[a-f0-9]{64}$/.test(file.checksum)), true);
		assert.deepEqual(executed.environmentSnapshot?.resources.allowedDomains, ["data.example.edu"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
