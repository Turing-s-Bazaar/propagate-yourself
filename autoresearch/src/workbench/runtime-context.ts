import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { arch, platform } from "node:os";
import { relative, resolve, sep } from "node:path";

import { readWorkbenchSettings, type WorkbenchSettings } from "./settings-store.js";
import {
	notebookRuntimeProcessEnv,
	resolvePythonRuntimeCommand,
	resolveRRuntimeCommand,
	resolveRscriptRuntimeCommand,
} from "./notebook-runtimes.js";
import type { WorkbenchSessionConfig } from "./chat.js";

export type WorkbenchRuntimeCredentialStatus = "missing" | "present";

export type WorkbenchRuntimeConnector = {
	assignedSpecialists?: string[];
	id: string;
	name: string;
	description?: string;
	excludedTools?: string[];
	transport: string;
	target: string;
	auth: "headers-helper" | "none" | "oauth" | "oauth-and-headers-helper";
	scopes?: string;
	skipApprovals?: boolean;
};

export type WorkbenchRuntimeCredential = {
	id: string;
	name: string;
	provider: string;
	envVar: string;
	status: WorkbenchRuntimeCredentialStatus;
	description?: string;
};

export type WorkbenchRuntimePermissionGrant = {
	id: string;
	name: string;
	scope: string;
	decision: "allow" | "ask" | "deny";
	description?: string;
};

export type WorkbenchRuntimeComputeHost = {
	id: string;
	name: string;
	target: string;
	scheduler?: string;
	scratchRoot?: string;
	guidance?: string;
};

export type WorkbenchRuntimeMemoryCategory = {
	id: string;
	name: string;
	guidance: string;
	autoRecall: boolean;
};

export type WorkbenchRuntimeModelEndpoint = {
	id: string;
	name: string;
	provider: string;
	models: string[];
	defaultEndpoint: string;
	credentialEnvVar?: string;
	status: WorkbenchRuntimeCredentialStatus | "disabled";
	tool: string;
	description: string;
};

export type WorkbenchRuntimeResources = {
	customConnectors: WorkbenchRuntimeConnector[];
	credentialRefs: WorkbenchRuntimeCredential[];
	permissionGrants: WorkbenchRuntimePermissionGrant[];
	allowedDomains: string[];
	computeHosts: WorkbenchRuntimeComputeHost[];
	modelEndpoints: WorkbenchRuntimeModelEndpoint[];
	memoryCategories: WorkbenchRuntimeMemoryCategory[];
};

export type WorkbenchEnvironmentFileSnapshot = {
	path: string;
	kind: string;
	sizeBytes: number;
	checksum: string;
	updatedAt: string;
};

export type WorkbenchEnvironmentSnapshot = {
	schema: "feynman.workbenchEnvironmentSnapshot.v1";
	capturedAt: string;
	cwd: string;
	platform: string;
	arch: string;
	nodeVersion: string;
	language?: string;
	executionMode?: string;
	kernelId?: string;
	command?: string;
	runtime?: {
		executable?: string;
		version?: string;
	};
	environmentFiles?: WorkbenchEnvironmentFileSnapshot[];
	resources: WorkbenchRuntimeResources;
};

type EnvironmentSnapshotInput = {
	command?: string;
	executionMode?: string;
	kernelId?: string;
	language?: string;
};

const SNAPSHOT_SCHEMA = "feynman.workbenchEnvironmentSnapshot.v1" as const;
const ENVIRONMENT_FILE_CANDIDATES: Array<{ path: string; kind: string }> = [
	{ path: "package.json", kind: "node manifest" },
	{ path: "package-lock.json", kind: "node lockfile" },
	{ path: "pnpm-lock.yaml", kind: "node lockfile" },
	{ path: "yarn.lock", kind: "node lockfile" },
	{ path: "bun.lock", kind: "node lockfile" },
	{ path: "bun.lockb", kind: "node lockfile" },
	{ path: "pyproject.toml", kind: "python manifest" },
	{ path: "requirements.txt", kind: "python requirements" },
	{ path: "requirements-dev.txt", kind: "python requirements" },
	{ path: "uv.lock", kind: "python lockfile" },
	{ path: "poetry.lock", kind: "python lockfile" },
	{ path: "Pipfile", kind: "python manifest" },
	{ path: "Pipfile.lock", kind: "python lockfile" },
	{ path: "environment.yml", kind: "conda environment" },
	{ path: "environment.yaml", kind: "conda environment" },
	{ path: "conda-lock.yml", kind: "conda lockfile" },
	{ path: "conda-lock.yaml", kind: "conda lockfile" },
	{ path: "renv.lock", kind: "r lockfile" },
	{ path: "DESCRIPTION", kind: "r package manifest" },
	{ path: ".feynman/npm/package.json", kind: "pi runtime manifest" },
	{ path: ".feynman/npm/package-lock.json", kind: "pi runtime lockfile" },
];

function envStatus(envVar: string): WorkbenchRuntimeCredentialStatus {
	return process.env[envVar]?.trim() ? "present" : "missing";
}

function toPosixPath(path: string): string {
	return path.split(sep).join("/");
}

function isInsideWorkspace(workingDir: string, path: string): boolean {
	const rel = relative(workingDir, path);
	return Boolean(rel && rel !== ".." && !rel.startsWith("..") && !rel.split(sep).includes(".."));
}

function sha256(buffer: Buffer): string {
	return createHash("sha256").update(buffer).digest("hex");
}

function readEnvironmentFileSnapshots(workingDir: string): WorkbenchEnvironmentFileSnapshot[] {
	const workspace = resolve(workingDir);
	return ENVIRONMENT_FILE_CANDIDATES.flatMap((candidate) => {
		const absPath = resolve(workspace, candidate.path);
		if (!isInsideWorkspace(workspace, absPath) || !existsSync(absPath)) return [];
		try {
			const stats = statSync(absPath);
			if (!stats.isFile()) return [];
			const content = readFileSync(absPath);
			return [{
				path: toPosixPath(relative(workspace, absPath)),
				kind: candidate.kind,
				sizeBytes: stats.size,
				checksum: sha256(content),
				updatedAt: stats.mtime.toISOString(),
			}];
		} catch {
			return [];
		}
	});
}

function connectorAuth(connector: WorkbenchSettings["customConnectors"][number]): WorkbenchRuntimeConnector["auth"] {
	const hasOAuth = Boolean(connector.oauthServerUrl || connector.clientId || connector.scopes);
	const hasHeaders = Boolean(connector.headersHelper);
	if (hasOAuth && hasHeaders) return "oauth-and-headers-helper";
	if (hasOAuth) return "oauth";
	if (hasHeaders) return "headers-helper";
	return "none";
}

function computeProviderEnabled(settings: WorkbenchSettings, providerId: string, fallback: boolean): boolean {
	return settings.computeProviderPreferences.find((item) => item.id === providerId)?.enabled ?? fallback;
}

export function readWorkbenchRuntimeResources(workingDir: string): WorkbenchRuntimeResources {
	const settings = readWorkbenchSettings(workingDir);
	const nvidiaEndpointEnabled = computeProviderEnabled(settings, "nvidia-bionemo", true);
	return {
		customConnectors: settings.customConnectors.map((connector) => ({
			id: connector.id,
			name: connector.name,
			...(connector.description ? { description: connector.description } : {}),
			...(connector.assignedSpecialists?.length ? { assignedSpecialists: connector.assignedSpecialists } : {}),
			...(connector.excludedTools?.length ? { excludedTools: connector.excludedTools } : {}),
			transport: connector.transport,
			target: connector.transport === "local" ? connector.command ?? "" : connector.url,
			auth: connectorAuth(connector),
			...(connector.scopes ? { scopes: connector.scopes } : {}),
			...(connector.skipApprovals ? { skipApprovals: true } : {}),
		})),
		credentialRefs: settings.credentialRefs.map((credential) => ({
			id: credential.id,
			name: credential.name,
			provider: credential.provider,
			envVar: credential.envVar,
			status: envStatus(credential.envVar),
			...(credential.description ? { description: credential.description } : {}),
		})),
		permissionGrants: settings.permissionGrants.map((grant) => ({
			id: grant.id,
			name: grant.name,
			scope: grant.scope,
			decision: grant.decision,
			...(grant.description ? { description: grant.description } : {}),
		})),
		allowedDomains: settings.allowedDomains.map((domain) => domain.domain),
		computeHosts: settings.computeHosts
			.filter((host) => computeProviderEnabled(settings, `ssh:${host.id}`, true))
			.map((host) => ({
				id: host.id,
				name: host.name,
				target: [
					host.user ? `${host.user}@${host.host}` : host.host,
					host.port ? `port ${host.port}` : undefined,
				].filter(Boolean).join(" "),
				...(host.scheduler ? { scheduler: host.scheduler } : {}),
				...(host.scratchRoot ? { scratchRoot: host.scratchRoot } : {}),
				...(host.guidance ? { guidance: host.guidance } : {}),
			})),
		modelEndpoints: [{
			id: "nvidia-bionemo",
			name: "NVIDIA BioNeMo NIM",
			provider: "nvidia-bionemo",
			models: ["esmfold", "alphafold2"],
			defaultEndpoint: "https://health.api.nvidia.com/v1/biology/nvidia/esmfold",
			credentialEnvVar: "NVIDIA_API_KEY",
			status: nvidiaEndpointEnabled ? envStatus("NVIDIA_API_KEY") : "disabled",
			tool: "feynman_model_endpoint_call",
			description: nvidiaEndpointEnabled
				? "Hosted ESMFold requires NVIDIA_API_KEY; self-hosted AlphaFold2 NIM can be called with endpointUrl."
				: "Disabled in Feynman compute provider settings for this workspace.",
		}],
		memoryCategories: settings.memoryCategories.map((category) => ({
			id: category.id,
			name: category.name,
			guidance: category.guidance,
			autoRecall: category.autoRecall,
		})),
	};
}

function runtimeProbe(workingDir: string, input: EnvironmentSnapshotInput): WorkbenchEnvironmentSnapshot["runtime"] | undefined {
	const normalized = input.language?.toLowerCase();
	if (normalized === "python") {
		const executable = resolvePythonRuntimeCommand(workingDir).command;
		const result = spawnSync(executable, ["-c", "import json,sys; print(json.dumps({'executable': sys.executable, 'version': sys.version.split()[0]}))"], {
			encoding: "utf8",
			env: notebookRuntimeProcessEnv(workingDir),
			timeout: 3000,
		});
		const stdout = typeof result.stdout === "string" ? result.stdout : "";
		try {
			const parsed = JSON.parse(stdout.trim()) as { executable?: unknown; version?: unknown };
			return {
				...(typeof parsed.executable === "string" ? { executable: parsed.executable } : {}),
				...(typeof parsed.version === "string" ? { version: parsed.version } : {}),
			};
		} catch {
			return { executable };
		}
	}
	if (normalized === "r") {
		const runtime = input.executionMode === "session" ? resolveRRuntimeCommand() : resolveRscriptRuntimeCommand();
		const executable = runtime.command;
		const args = input.executionMode === "session"
			? ["--slave", "-e", "cat(R.version.string)"]
			: ["-e", "cat(R.version.string)"];
		const result = spawnSync(executable, args, { encoding: "utf8", env: notebookRuntimeProcessEnv(workingDir), timeout: 3000 });
		const stdout = typeof result.stdout === "string" ? result.stdout : "";
		return {
			executable,
			...(stdout.trim() ? { version: stdout.trim() } : {}),
		};
	}
	if (normalized === "bash") {
		const result = spawnSync("bash", ["--version"], { encoding: "utf8", timeout: 3000 });
		const stdout = typeof result.stdout === "string" ? result.stdout : "";
		return {
			executable: "bash",
			...(stdout.trim() ? { version: stdout.split("\n")[0]?.trim() } : {}),
		};
	}
	return undefined;
}

export function captureWorkbenchEnvironmentSnapshot(
	workingDir: string,
	input: EnvironmentSnapshotInput = {},
): WorkbenchEnvironmentSnapshot {
	const runtime = runtimeProbe(workingDir, input);
	const environmentFiles = readEnvironmentFileSnapshots(workingDir);
	return {
		schema: SNAPSHOT_SCHEMA,
		capturedAt: new Date().toISOString(),
		cwd: workingDir,
		platform: platform(),
		arch: arch(),
		nodeVersion: process.version,
		...(input.language ? { language: input.language } : {}),
		...(input.executionMode ? { executionMode: input.executionMode } : {}),
		...(input.kernelId ? { kernelId: input.kernelId } : {}),
		...(input.command ? { command: input.command } : {}),
		...(runtime ? { runtime } : {}),
		...(environmentFiles.length ? { environmentFiles } : {}),
		resources: readWorkbenchRuntimeResources(workingDir),
	};
}

function hasRuntimeResources(resources: WorkbenchRuntimeResources): boolean {
	return Boolean(
		resources.customConnectors.length ||
			resources.credentialRefs.length ||
			resources.permissionGrants.length ||
			resources.allowedDomains.length ||
			resources.computeHosts.length ||
			resources.modelEndpoints.length ||
			resources.memoryCategories.length
	);
}

function listLines<T>(items: T[], format: (item: T) => string): string[] {
	return items.length ? items.map((item) => `  - ${format(item)}`) : ["  - none configured"];
}

export function formatWorkbenchRuntimeContextForPrompt(
	workingDir: string,
	config?: WorkbenchSessionConfig,
): string[] {
	const resources = readWorkbenchRuntimeResources(workingDir);
	const lines = [
		"Configured science runtime resources:",
		"- These are app-owned Feynman workbench settings. Credential values are never included; only env var names and presence are shown.",
				"- Built-in read-only science database search is executable through feynman_science_database_search for PubMed search/metadata/ID conversion/related articles/citation lookup/copyright/PMC full-text routing, Europe PMC metadata/open-access full-text sections, OpenAlex, Crossref, arXiv, bioRxiv, medRxiv, DataCite, ClinicalTrials.gov, ChEMBL, PubChem, ChEBI, BindingDB, ZINC, BioMart, STRING, IntAct, Complex Portal, KEGG, Rhea, Rfam, UniProt, AlphaFold DB, RCSB PDB, EMDB, Ensembl, MyGene.info, CellGuide, Antibody Registry, ClinVar, dbSNP, CADD, NCBI Variation Services, ClinGen, COSMIC, DepMap, cBioPortal, CIViC, Open Targets, GWAS Catalog, openFDA, Human Protein Atlas, eQTL Catalogue, OLS, ENCODE, GEO, ArrayExpress/BioStudies, MetaboLights, MGnify, UCSC Genome Browser, UniBind, gnomAD, GTEx, InterPro, PRIDE, JASPAR, QuickGO, and Reactome; ChEMBL supports compound name/SMILES similarity/substructure, drug indication and warning, calculated ADMET, bioactivity, mechanism, target, assay, and molecule workflows. Preserve returned PMIDs, PMCIDs, PubMed related-link IDs, citation-match PMIDs, PubMed copyright/license fields, Europe PMC full-text statuses, section inventories, figure/table/reference counts, OpenAlex W/A/S IDs, OpenAlex DOI claimant notes, source/venue IDs, author ORCIDs, citation/reference counts, OA status, arXiv IDs, preprint DOIs, DOIs, NCT IDs, ChEMBL IDs, ChEMBL mechanism ids/action types, pChEMBL values, activity standard values/units, assay/document ids, drug indication ids, EFO/MeSH terms, max phase values, warning classes, calculated molecular properties, PubChem CIDs/InChIKeys/SMILES, ChEBI accessions/InChIKeys/SMILES/ontology fields, BindingDB monomer IDs/affinity fields/PMIDs, ZINC IDs, ZINC task ids, SMILES, supplier catalog codes, catalog names, source counts, tranche names, tranche heavy-atom/logP bins, 3D repository path patterns, BioMart mart names, dataset names, internal attribute/filter names, Ensembl gene IDs, STRING IDs/preferred names/edge scores, IntAct interaction accessions/MI scores/PubMed IDs, Complex Portal CPX accessions/participants/stoichiometry, KEGG entry IDs, Rhea IDs/EC numbers/ChEBI IDs, Rfam accessions/family IDs/clans, UniProt accessions, AlphaFold entry/model IDs and PDB/CIF/PAE links, PDB IDs, EMDB EMD accessions/resolution/map metadata, Ensembl stable IDs, MyGene Entrez/Ensembl/UniProt IDs, CellGuide CL IDs, cell type names, marker symbols/scores/specificity, tissue contexts, snapshot ids, source collection URLs, Antibody Registry AB/RRID accessions, vendor names, catalog numbers, clone ids, antibody targets, source organisms, target species, applications, citation counts, registry last-update dates, UCSC genome db names, track names, chromosome coordinates, itemsReturned/maxItemsLimit, conservation score summaries, TFBS factor names, UniBind TF ids, JASPAR matrix ids, prediction model names, model BED/FASTA/plot URLs, UniBind collection names, UniBind TFBS chromosome coordinates, ClinVar VCV/RCV accessions and review statuses, dbSNP rsIDs/placements/HGVS/SPDI, CADD RawScore/PHRED/version, NCBI Variation single/batch contextual SPDI/HGVS/VCF fields, ClinGen CGGV assertion IDs, HGNC IDs, MONDO IDs, validity classifications, dosage assertion codes/labels, actionability document IDs, CAIDs, ClinVar variation IDs, evidence codes, expert panels, COSMIC mutation IDs, legacy mutation IDs, genomic mutation IDs, COSG/COSO IDs, GRCh versions, mutation CDS/amino-acid/genome-position fields, primary site/histology, DepMap SIDM model IDs, SIDG gene IDs, HGNC IDs, tissue/cancer type labels, model availability flags, dependency scores and source labels, gnomAD short/SV/mitochondrial variant IDs, dataset pins, allele frequencies, heteroplasmy fields, cBioPortal study IDs, cancer type IDs, molecular profile IDs, sample/patient IDs, gene symbols, Entrez IDs, mutation positions/protein changes, CIViC molecular profile/evidence/assertion IDs, AMP levels, evidence levels, diseases, therapies, PubMed-backed sources, Open Targets Ensembl IDs, EFO/MONDO IDs, ChEMBL drug IDs, association scores, datasource IDs, clinical stages, mechanism/action types, GWAS Catalog association IDs, study accessions, rsIDs, EFO/MONDO traits, p-values, odds ratios, betas, ancestry/sample metadata, openFDA set/safety-report/recall IDs, Human Protein Atlas Ensembl/UniProt/tissue fields, eQTL Catalogue study/dataset/variant/gene/p-value/beta fields, ontology CURIEs, ENCODE accessions, GEO accessions, ArrayExpress accessions, MetaboLights MTBLS accessions/study statuses/assay technologies/file names, MGnify study accessions, GTEx GENCODE IDs, InterPro accessions, PRIDE accessions, JASPAR matrix IDs, QuickGO GO IDs, Reactome stable IDs, citation counts, source URLs, and endpoint provenance.",
		"- Scientific model endpoints are executable through feynman_model_endpoint_call when their status below is not disabled. Hosted ESMFold uses NVIDIA_API_KEY and self-hosted AlphaFold2 NIM uses endpointUrl; endpoint outputs are saved under outputs/model-endpoints with provenance sidecars.",
		"- Streamable HTTP, SSE, and local command custom MCP connectors are executable through the Pi tools feynman_connector_tools and feynman_connector_call. Missing or ask grants create a pending permission request; matching allow grants, wildcard allow grants, or connector skip-approvals execute the tool.",
	];
	if (config) {
		lines.push(`- Active session config: specialist ${config.specialist}; compute ${config.compute}; memory ${config.memory ? "enabled" : "disabled"}; delegation ${config.delegation ? "enabled" : "disabled"}; auto-review ${config.autoReview ? "enabled" : "disabled"}.`);
		if (config.specialist !== "None") {
			lines.push(`- Pass specialist "${config.specialist}" to feynman_connector_tools and feynman_connector_call so connector assignment rules are enforced for this chat.`);
		}
	}
	if (!hasRuntimeResources(resources)) {
		lines.push(
			"Custom connectors:",
			"  - none configured",
			"Runtime policy:",
			"  - Treat built-in science database search results as external source evidence and cite or preserve returned identifiers.",
			"  - Never print or persist secret values from credential env vars.",
		);
		return lines;
	}
	lines.push(
		"Custom connectors:",
		...listLines(resources.customConnectors, (connector) => [
			connector.name,
			connector.transport,
			connector.target,
			`auth ${connector.auth}`,
			connector.scopes ? `scopes ${connector.scopes}` : undefined,
			connector.assignedSpecialists?.length ? `assigned specialists ${connector.assignedSpecialists.join(", ")}` : undefined,
			connector.excludedTools?.length ? `excluded tools ${connector.excludedTools.join(", ")}` : undefined,
			connector.skipApprovals ? "skip approvals" : undefined,
		].filter(Boolean).join(" | ")),
		"Credential references:",
		...listLines(resources.credentialRefs, (credential) =>
			`${credential.name} | ${credential.provider} | ${credential.envVar} ${credential.status}`),
		"Permission grants:",
		...listLines(resources.permissionGrants, (grant) => `${grant.name} | ${grant.scope} | ${grant.decision}`),
		"Allowed domains:",
		...listLines(resources.allowedDomains, (domain) => domain),
		"Compute hosts:",
		...listLines(resources.computeHosts, (host) => [
			host.name,
			host.target,
			host.scheduler,
			host.scratchRoot,
			host.guidance,
		].filter(Boolean).join(" | ")),
		"Model endpoints:",
		...listLines(resources.modelEndpoints, (endpoint) => [
			endpoint.name,
			endpoint.provider,
			`models ${endpoint.models.join(", ")}`,
			`tool ${endpoint.tool}`,
			endpoint.credentialEnvVar ? `${endpoint.credentialEnvVar} ${endpoint.status}` : undefined,
			endpoint.defaultEndpoint,
			endpoint.description,
		].filter(Boolean).join(" | ")),
		"Memory categories:",
		...listLines(resources.memoryCategories, (category) =>
			`${category.name} | ${category.autoRecall ? "auto-recall" : "manual"} | ${category.guidance}`),
		"Runtime policy:",
		"  - Empty connector assignment means available to every specialist; assigned connectors must match the active specialist passed to connector tools.",
		"  - Excluded connector tools are unavailable even when skip approvals or allow grants exist.",
		"  - Treat deny grants as unavailable.",
		"  - Treat ask or missing grants as pending approval requests; the connector call creates the request and stops before execution.",
		"  - Treat connector skip-approvals as an explicit per-connector allow for its tools.",
		"  - For connector tools, use scope connector:<connector-id>:<tool-name> or connector:<connector-id>:*.",
		"  - Never print or persist secret values from credential env vars.",
	);
	return lines;
}
