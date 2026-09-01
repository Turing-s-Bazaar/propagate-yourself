import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, relative, resolve, sep } from "node:path";

import { getPiWebAccessStatus } from "../pi/web-access.js";
import { listWorkbenchCloudExportTargets } from "./cloud-export-targets.js";
import { getWorkbenchDataRoot, migratedWorkbenchDataPath } from "./data-root.js";
import type { WorkbenchMemoryRecord, WorkbenchNoteRecord } from "./memory.js";
import { managedModalCliPath } from "./modal-execution.js";
import { resolvePythonRuntimeCommand, resolveRRuntimeCommand, resolveRscriptRuntimeCommand } from "./notebook-runtimes.js";
import { isOAuthTokenExpired, oauthTokenForConnector } from "./oauth-store.js";
import { buildConnectorResources } from "./package-resources.js";
import { readWorkbenchSettings, type WorkbenchSettings } from "./settings-store.js";
import { WORKBENCH_CREDENTIAL_PROVIDERS } from "./credential-catalog.js";
import type {
	WorkbenchArtifact,
	WorkbenchChangelogEntry,
	WorkbenchComputeProvider,
	WorkbenchExecutionRecord,
	WorkbenchGeneratedPlan,
	WorkbenchResource,
	WorkbenchResourceGroup,
	WorkbenchVerificationCheck,
} from "./types.js";
import {
	buildClaudeScienceReferenceResources,
	readClaudeScienceInstall,
} from "./claude-science.js";

const MAX_RESOURCE_FILES = 240;
const MAX_RESOURCE_READ_BYTES = 24_000;
const MAX_SIZE_SCAN_FILES = 4_000;
const CLAUDE_SCIENCE_REFERENCE_ENV = "FEYNMAN_DEBUG_CLAUDE_SCIENCE_REFERENCE";

function toPosixPath(path: string): string {
	return path.split(sep).join("/");
}

function normalizeResourceId(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 90) || "resource";
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

function humanBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KB", "MB", "GB", "TB"];
	let value = bytes / 1024;
	let unit = units[0];
	for (let index = 1; index < units.length && value >= 1024; index += 1) {
		value /= 1024;
		unit = units[index];
	}
	return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`;
}

function readJsonObject(path: string): Record<string, unknown> | undefined {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
	} catch {
		return undefined;
	}
}

function readTextPrefix(path: string): string {
	const buffer = readFileSync(path);
	return buffer.subarray(0, MAX_RESOURCE_READ_BYTES).toString("utf8");
}

function frontmatterValue(text: string, key: string): string | undefined {
	const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
	if (!match) return undefined;
	const prefix = `${key}:`;
	for (const rawLine of match[1].split("\n")) {
		const line = rawLine.trim();
		if (!line.startsWith(prefix)) continue;
		const value = line.slice(prefix.length).trim();
		return value.replace(/^["']|["']$/g, "").trim() || undefined;
	}
	return undefined;
}

function firstMarkdownSentence(text: string): string {
	return text
		.replace(/^---\n[\s\S]*?\n---\n?/, "")
		.split("\n")
		.map((line) => line.replace(/^#+\s*/, "").trim())
		.filter((line) => line && !line.startsWith("```") && !line.startsWith("|"))
		.find(Boolean)
		?.slice(0, 240) || "";
}

function listFiles(root: string, predicate: (name: string, absPath: string) => boolean, maxFiles = MAX_RESOURCE_FILES): string[] {
	const results: string[] = [];
	function walk(dir: string): void {
		if (results.length >= maxFiles || !existsSync(dir)) return;
		for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const absPath = resolve(dir, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === "node_modules" || entry.name === ".git") continue;
				walk(absPath);
				continue;
			}
			if (entry.isFile() && predicate(entry.name, absPath)) results.push(absPath);
			if (results.length >= maxFiles) return;
		}
	}
	walk(root);
	return results;
}

function directMarkdownFiles(root: string): string[] {
	if (!existsSync(root)) return [];
	return readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
		.map((entry) => resolve(root, entry.name))
		.sort((a, b) => a.localeCompare(b));
}

function countFiles(root: string, predicate: (name: string) => boolean): number {
	return listFiles(root, (name) => predicate(name), 1_000).length;
}

function directorySize(root: string): { bytes: number; files: number; truncated: boolean } {
	let bytes = 0;
	let files = 0;
	let truncated = false;
	function walk(dir: string): void {
		if (truncated || !existsSync(dir)) return;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (files >= MAX_SIZE_SCAN_FILES) {
				truncated = true;
				return;
			}
			const absPath = resolve(dir, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === "node_modules" || entry.name === ".git") continue;
				walk(absPath);
				continue;
			}
			if (!entry.isFile()) continue;
			files += 1;
			try {
				bytes += statSync(absPath).size;
			} catch {
				// Best-effort local usage estimate for the settings surface.
			}
		}
	}
	walk(root);
	return { bytes, files, truncated };
}

function markdownResource(
	workingDir: string,
	absPath: string,
	options: {
		fallbackName?: string;
		section: string;
		source: string;
		status?: WorkbenchResource["status"];
		command?: (name: string) => string;
		tags?: string[];
	},
): WorkbenchResource | undefined {
	try {
		const text = readTextPrefix(absPath);
		const name = frontmatterValue(text, "name") ?? options.fallbackName ?? basename(absPath, extname(absPath));
		const description = frontmatterValue(text, "description") ?? firstMarkdownSentence(text) ?? name;
		const command = options.command?.(name);
		return {
			id: normalizeResourceId(`${options.source}-${name}-${relative(workingDir, absPath)}`),
			name,
			description,
			status: options.status ?? "configured",
			source: options.source,
			section: options.section,
			path: toPosixPath(relative(workingDir, absPath)),
			...(command ? { command } : {}),
			tags: options.tags ?? [],
		};
	} catch {
		return undefined;
	}
}

function envStatus(envVar: string): WorkbenchResource["status"] {
	return process.env[envVar]?.trim() ? "configured" : "available";
}

function envDescription(envVar: string, configuredText: string, missingText: string): string {
	return process.env[envVar]?.trim()
		? `${configuredText} ${envVar} is present in the server environment; the value is not displayed.`
		: `${missingText} Set ${envVar} or use the matching Feynman CLI command.`;
}

function envVarStatus(envVar: string | undefined): WorkbenchResource["status"] {
	return envVar && process.env[envVar]?.trim() ? "configured" : "available";
}

function includeClaudeScienceReferenceResources(): boolean {
	const value = process.env[CLAUDE_SCIENCE_REFERENCE_ENV]?.trim().toLowerCase();
	return value === "1" || value === "true";
}

function modalConfigExists(): boolean {
	return existsSync(resolve(homedir(), ".modal.toml"));
}

function modalCredentialStatus(): WorkbenchResource["status"] {
	return (process.env.MODAL_TOKEN_ID?.trim() && process.env.MODAL_TOKEN_SECRET?.trim()) || modalConfigExists()
		? "configured"
		: "available";
}

function modalCredentialDetail(): string {
	if (process.env.MODAL_TOKEN_ID?.trim() && process.env.MODAL_TOKEN_SECRET?.trim()) return "MODAL_TOKEN_ID / MODAL_TOKEN_SECRET";
	if (modalConfigExists()) return "~/.modal.toml";
	return "MODAL_TOKEN_ID / MODAL_TOKEN_SECRET or ~/.modal.toml";
}

function globalModalCliPath(): string | undefined {
	const result = spawnSync("sh", ["-lc", "command -v modal"], { encoding: "utf8", timeout: 3000 });
	const value = result.stdout.trim();
	return value || undefined;
}

function modalCliDiagnostic(workingDir: string): string {
	const override = process.env.FEYNMAN_MODAL_CLI?.trim();
	if (override) return `CLI: FEYNMAN_MODAL_CLI points to ${override}.`;
	const managed = managedModalCliPath(workingDir);
	if (existsSync(managed)) return `CLI: using managed workbench Modal CLI at ${toPosixPath(relative(workingDir, managed))}.`;
	const global = globalModalCliPath();
	if (global) return `CLI: using modal from PATH at ${global}.`;
	return "CLI: modal command is not installed; Modal notebook cells will record a missing-CLI error until a CLI is available.";
}

function scienceDomainResource(id: string, name: string, detail: string, tags: string[]): WorkbenchResource {
	return {
		id: `network-${id}`,
		name,
		description: `${name} endpoints are grouped for science workflows; Feynman currently uses the host network and connector-specific settings rather than an enforced domain allowlist.`,
		status: "available",
		source: "Network policy",
		section: "Science domain presets",
		detail,
		tags,
	};
}

type ScienceConnectorPreset = {
	builtInDatabaseSource?: "alphafold" | "antibodyregistry" | "arxiv" | "arrayexpress" | "bindingdb" | "biomart" | "biorxiv" | "cadd" | "cbioportal" | "cellguide" | "chebi" | "chembl" | "clinicaltrials" | "clinvar" | "civic" | "clingen" | "complexportal" | "cosmic" | "crossref" | "datacite" | "dbsnp" | "depmap" | "emdb" | "ensembl" | "encode" | "eqtlcatalogue" | "europepmc" | "geo" | "gnomad" | "gwascatalog" | "gtex" | "intact" | "interpro" | "jaspar" | "kegg" | "medrxiv" | "metabolights" | "mgnify" | "mygene" | "ols" | "openalex" | "openfda" | "opentargets" | "panglaodb" | "pdb" | "pride" | "proteinatlas" | "pubchem" | "pubmed" | "quickgo" | "reactome" | "rfam" | "rhea" | "string" | "ucsc" | "unibind" | "uniprot" | "variation" | "zinc";
	id: string;
	name: string;
	description: string;
	section: "Directory" | "Featured" | "Organization";
	source: string;
	tags: string[];
	tools?: Array<{ name: string; description?: string }>;
};

const FEYNMAN_BIO_TOOL_SOURCE_NAMES = [
	"PubMed",
	"Europe PMC",
	"OpenAlex",
	"Crossref",
	"arXiv",
	"DataCite",
	"ClinicalTrials.gov",
	"ChEMBL",
	"PubChem",
	"ChEBI",
	"BindingDB",
	"ZINC",
	"BioMart",
	"Antibody Registry",
	"STRING",
	"IntAct",
	"Complex Portal",
	"KEGG",
	"Rhea",
	"Rfam",
	"bioRxiv",
	"medRxiv",
	"CellGuide",
	"MetaboLights",
	"UCSC Genome Browser",
	"UniBind",
	"UniProt",
	"AlphaFold DB",
	"RCSB PDB",
	"EMDB",
	"Ensembl",
	"MyGene.info",
	"ClinVar",
	"CIViC",
	"ClinGen",
	"COSMIC",
	"DepMap",
	"cBioPortal",
	"Open Targets",
	"openFDA",
	"PanglaoDB",
	"Human Protein Atlas",
	"eQTL Catalogue",
	"dbSNP",
	"CADD",
	"NCBI Variation Services",
	"OLS",
	"ENCODE",
	"GEO",
	"ArrayExpress/BioStudies",
	"MGnify",
	"gnomAD",
	"GWAS Catalog",
	"GTEx",
	"InterPro",
	"PRIDE",
	"JASPAR",
	"QuickGO",
	"Reactome",
];

const SCIENCE_CONNECTOR_PRESETS: ScienceConnectorPreset[] = [
	{ id: "alphafold-db", name: "AlphaFold DB", description: "Fetch predicted protein-structure entries, confidence summaries, and model file links by UniProt accession.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "structures", "proteins", "alphafold"], builtInDatabaseSource: "alphafold" },
	{ id: "antibody-registry", name: "Antibody Registry", description: "Search antibody RRIDs, catalog numbers, vendors, targets, clones, species, applications, and registry statistics.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "antibodies", "rrid", "reagents"], builtInDatabaseSource: "antibodyregistry" },
	{ id: "arrayexpress", name: "ArrayExpress / BioStudies", description: "Search migrated functional-genomics studies, accessions, file counts, and BioStudies records.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "omics", "arrayexpress", "biostudies"], builtInDatabaseSource: "arrayexpress" },
	{
		id: "biomart",
		name: "BioMart",
		description: "Query Ensembl BioMart marts, datasets, attributes, filters, and translated biological identifiers.",
		section: "Featured",
		source: "Science connector preset",
		tags: ["mcp", "ensembl", "genomics"],
		builtInDatabaseSource: "biomart",
		tools: [
			{ name: "list_marts" },
			{ name: "list_datasets" },
			{ name: "list_common_attributes" },
			{ name: "list_all_attributes" },
			{ name: "list_filters" },
			{ name: "get_data" },
			{ name: "get_translation" },
			{ name: "batch_translate" },
		],
	},
	{ id: "cancer-models", name: "Cancer Models", description: "Find cancer cohorts, molecular profiles, samples, and tumor model evidence for oncology research.", section: "Featured", source: "Science connector preset", tags: ["mcp", "oncology", "models"], builtInDatabaseSource: "cbioportal" },
	{ id: "cellguide", name: "CellGuide", description: "Resolve cell-type references, marker genes, tissue occurrence, and CELLxGENE source collections.", section: "Featured", source: "Science connector preset", tags: ["mcp", "single-cell", "cell types"], builtInDatabaseSource: "cellguide" },
		{ id: "chemistry", name: "Chemistry", description: "Inspect compound identifiers, molecular properties, bioactivity, reactions, structures, and chemistry reference data.", section: "Featured", source: "Science connector preset", tags: ["mcp", "chemistry", "molecules"], builtInDatabaseSource: "pubchem" },
	{ id: "clinical-genomics", name: "Clinical Genomics", description: "Connect variant, disease, and clinical annotation resources for translational genomics.", section: "Featured", source: "Science connector preset", tags: ["mcp", "variants", "clinical"], builtInDatabaseSource: "clinvar" },
	{ id: "drug-regulatory", name: "Drug Regulatory", description: "Look up drug labels, approval context, safety records, and regulatory references.", section: "Featured", source: "Science connector preset", tags: ["mcp", "drug", "regulatory"], builtInDatabaseSource: "openfda" },
	{ id: "expression", name: "Expression", description: "Search expression atlases, tissue profiles, and experiment-level expression evidence.", section: "Featured", source: "Science connector preset", tags: ["mcp", "expression", "omics"], builtInDatabaseSource: "gtex" },
	{ id: "genes-ontologies", name: "Genes & Ontologies", description: "Resolve genes, ontology terms, pathways, and functional annotations.", section: "Featured", source: "Science connector preset", tags: ["mcp", "genes", "ontology"], builtInDatabaseSource: "quickgo" },
	{ id: "genomes", name: "Genomes", description: "Search assemblies, genomic regions, genome-browser tracks, conservation scores, sequence records, and genome metadata.", section: "Featured", source: "Science connector preset", tags: ["mcp", "genomes", "sequence"], builtInDatabaseSource: "ensembl" },
	{ id: "human-genetics", name: "Human Genetics", description: "Connect human genetic association, phenotype, and variant interpretation resources.", section: "Featured", source: "Science connector preset", tags: ["mcp", "human genetics", "phenotype"], builtInDatabaseSource: "gwascatalog" },
	{
		id: "ketcher-chemistry",
		name: "Ketcher Chemistry",
		description: "Create editable KET, Molfile, RXN, or SMILES sketch artifacts for the local Ketcher editor.",
		section: "Featured",
		source: "Science connector preset",
		tags: ["mcp", "chemistry", "structure", "ketcher"],
		tools: [
			{ name: "feynman_open_chemistry_sketcher", description: "Create a Feynman-owned chemistry sketch artifact for the local Ketcher editor." },
		],
	},
	{ id: "literature-graph", name: "Literature Graph", description: "Explore paper, citation, author, source/venue, OA-status, and topic neighborhoods around a claim.", section: "Featured", source: "Science connector preset", tags: ["mcp", "papers", "citations"], builtInDatabaseSource: "openalex" },
	{ id: "omics-archives", name: "Omics Archives", description: "Search public omics repositories for studies, samples, runs, and processed data.", section: "Featured", source: "Science connector preset", tags: ["mcp", "omics", "archives"], builtInDatabaseSource: "geo" },
	{ id: "protein-annotation", name: "Protein Annotation", description: "Resolve proteins, domains, functions, and sequence-level annotations.", section: "Featured", source: "Science connector preset", tags: ["mcp", "proteins", "annotation"], builtInDatabaseSource: "uniprot" },
	{ id: "regulation", name: "Regulation", description: "Inspect regulatory elements, transcription factors, chromatin context, and expression control.", section: "Featured", source: "Science connector preset", tags: ["mcp", "regulation", "chromatin"], builtInDatabaseSource: "encode" },
	{ id: "research-resources", name: "Research Resources", description: "Find datasets, tools, protocols, repositories, and reference assets for experiments.", section: "Featured", source: "Science connector preset", tags: ["mcp", "resources", "datasets"] },
	{ id: "rna", name: "RNA", description: "Search RNA annotations, transcripts, expression, and regulatory evidence.", section: "Featured", source: "Science connector preset", tags: ["mcp", "rna", "transcripts"], builtInDatabaseSource: "rfam" },
	{ id: "structures-interactions", name: "Structures & Interactions", description: "Connect protein structures, complexes, molecular interactions, and structural evidence.", section: "Featured", source: "Science connector preset", tags: ["mcp", "structures", "interactions"], builtInDatabaseSource: "string" },
	{ id: "variants", name: "Variants", description: "Look up variants, consequences, single or batch HGVS/SPDI normalization, population frequency, structural/mitochondrial evidence, CIViC cancer evidence/assertions, dbSNP records, CADD scores, and disease annotations.", section: "Featured", source: "Science connector preset", tags: ["mcp", "variants", "annotation"], builtInDatabaseSource: "dbsnp" },
	{ id: "zinc", name: "ZINC", description: "Search purchasable compounds, ZINC IDs, SMILES exact or analog matches, supplier catalog codes, random screening sets, and 3D tranche file locations.", section: "Featured", source: "Science connector preset", tags: ["mcp", "zinc", "screening"], builtInDatabaseSource: "zinc" },
	{ id: "arxiv", name: "arXiv", description: "Search e-print metadata across physics, math, CS, quantitative biology, and related fields.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "preprints", "papers"], builtInDatabaseSource: "arxiv" },
	{ id: "biorxiv", name: "bioRxiv", description: "Search preprints and metadata for current biology literature.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "preprints", "papers"], builtInDatabaseSource: "biorxiv" },
	{ id: "bindingdb", name: "BindingDB", description: "Search ligand-target affinity rows by UniProt target or compound similarity.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "binding", "affinity", "compounds"], builtInDatabaseSource: "bindingdb" },
	{ id: "cadd", name: "CADD", description: "Retrieve single-SNV RawScore and PHRED deleteriousness scores with explicit genome-build versioning.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "variants", "deleteriousness"], builtInDatabaseSource: "cadd" },
	{ id: "cbioportal", name: "cBioPortal", description: "Search cancer studies, cohorts, cancer types, molecular profiles, samples, clinical attributes, and gene mutation rows.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "cancer", "genomics", "cohorts"], builtInDatabaseSource: "cbioportal" },
	{ id: "chebi", name: "ChEBI", description: "Search Chemical Entities of Biological Interest accessions, formulas, masses, structures, synonyms, and ontology records.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "chemistry", "ontology", "compounds"], builtInDatabaseSource: "chebi" },
		{ id: "chembl", name: "ChEMBL", description: "Search compounds, drug indications and warnings, calculated ADMET properties, bioactivity rows, mechanisms, targets, assays, and molecule records.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "chembl", "bioactivity"], builtInDatabaseSource: "chembl" },
	{ id: "clinical-trials", name: "Clinical Trials", description: "Search trial records, intervention details, eligibility, status, and outcome metadata.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "clinical trials", "medicine"], builtInDatabaseSource: "clinicaltrials" },
	{ id: "clinvar", name: "ClinVar", description: "Search variant clinical interpretations, review statuses, conditions, genes, and VCV/RCV accessions.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "variants", "clinical"], builtInDatabaseSource: "clinvar" },
	{ id: "civic", name: "CIViC", description: "Search curated cancer molecular profiles, accepted evidence items, assertions, AMP levels, diseases, therapies, and PubMed-backed sources.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "cancer", "variants", "curation"], builtInDatabaseSource: "civic" },
	{ id: "clingen", name: "ClinGen", description: "Search gene-disease validity, dosage sensitivity, clinical actionability, and VCEP variant classification curations.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "variants", "clinical genomics", "curation"], builtInDatabaseSource: "clingen" },
	{ id: "complexportal", name: "Complex Portal", description: "Search curated macromolecular complexes by participant accession, CPX accession, name, species, and component metadata.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "complexes", "structures", "interactions"], builtInDatabaseSource: "complexportal" },
	{ id: "cosmic", name: "COSMIC", description: "Search public COSMIC mutation records through the NLM Clinical Tables route, including mutation IDs, CDS/AA changes, GRCh position context, tissue/histology, and PubMed links.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "cancer", "variants", "cosmic"], builtInDatabaseSource: "cosmic" },
	{ id: "crossref", name: "Crossref", description: "Search DOI, journal, funder, license, and scholarly metadata deposited by publishers.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "doi", "metadata"], builtInDatabaseSource: "crossref" },
	{ id: "datacite", name: "DataCite", description: "Search dataset, software, and research-object DOI metadata.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "datasets", "doi"], builtInDatabaseSource: "datacite" },
	{ id: "dbsnp", name: "dbSNP", description: "Fetch RefSNP placements, HGVS/SPDI alleles, gene context, frequencies, and ClinVar cross-references.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "variants", "rsid"], builtInDatabaseSource: "dbsnp" },
	{ id: "depmap", name: "DepMap", description: "Search Sanger Cell Model Passports cancer models, tissue/cancer-type metadata, gene records, and CRISPR dependency scores.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "depmap", "cancer", "models"], builtInDatabaseSource: "depmap" },
	{ id: "variation", name: "NCBI Variation Services", description: "Normalize single HGVS/SPDI variants and batch HGVS lists to contextual SPDI, HGVS, VCF fields, rsIDs, and canonical representatives when available.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "variants", "hgvs", "spdi"], builtInDatabaseSource: "variation" },
	{ id: "emdb", name: "EMDB", description: "Search Electron Microscopy Data Bank entries, map resolution, status, release dates, fitted models, and entry metadata.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "structures", "cryo-em", "maps"], builtInDatabaseSource: "emdb" },
	{ id: "ensembl", name: "Ensembl", description: "Resolve gene symbols, stable IDs, genomic coordinates, biotypes, and transcript counts.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "genes", "genomes"], builtInDatabaseSource: "ensembl" },
	{ id: "encode", name: "ENCODE", description: "Search released functional genomics experiments, biosamples, targets, and assays.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "functional genomics", "encode"], builtInDatabaseSource: "encode" },
	{ id: "eqtl-catalogue", name: "eQTL Catalogue", description: "Search variant-gene eQTL associations, study ids, dataset ids, p-values, effects, and tissue context.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "eqtl", "genetics", "expression"], builtInDatabaseSource: "eqtlcatalogue" },
	{ id: "europe-pmc", name: "Europe PMC", description: "Search life-science literature, preprints, PMC records, citations, open-access signals, and bounded full-text section summaries.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "europe pmc", "papers"], builtInDatabaseSource: "europepmc" },
	{ id: "geo", name: "GEO", description: "Search Gene Expression Omnibus studies, accessions, samples, and platform metadata.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "omics", "geo"], builtInDatabaseSource: "geo" },
	{ id: "gnomad", name: "gnomAD", description: "Search short, structural, and mitochondrial variant IDs with allele frequencies, heteroplasmy, dataset pins, filters, and gene constraint metrics.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "variants", "population genetics"], builtInDatabaseSource: "gnomad" },
	{ id: "gwas-catalog", name: "GWAS Catalog", description: "Search curated SNP-trait associations, EFO traits, study accessions, PMIDs, p-values, mapped genes, and ancestry/sample metadata.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "gwas", "human genetics", "traits"], builtInDatabaseSource: "gwascatalog" },
	{ id: "gtex", name: "GTEx", description: "Resolve genes and search median tissue-expression profiles from GTEx.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "expression", "gtex"], builtInDatabaseSource: "gtex" },
	{ id: "intact", name: "IntAct", description: "Search curated molecular interaction records, participants, MI scores, detection methods, and PubMed-backed evidence.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "interactions", "proteins", "curation"], builtInDatabaseSource: "intact" },
	{ id: "interpro", name: "InterPro", description: "Search protein families, domains, member databases, and GO term links.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "proteins", "domains"], builtInDatabaseSource: "interpro" },
	{ id: "jaspar", name: "JASPAR", description: "Search curated transcription-factor binding profile matrices and sequence-logo records.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "regulation", "transcription factors"], builtInDatabaseSource: "jaspar" },
	{ id: "kegg", name: "KEGG", description: "Fetch KEGG compound, gene, pathway, orthology, reaction, and disease entries.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "pathways", "metabolism"], builtInDatabaseSource: "kegg" },
	{ id: "medrxiv", name: "medRxiv", description: "Search health-science preprints and metadata for current clinical literature.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "preprints", "medicine"], builtInDatabaseSource: "medrxiv" },
	{ id: "metabolights", name: "MetaboLights", description: "Fetch public metabolomics study metadata, ISA-Tab assay context, study-folder files, and public data-file listings by MTBLS accession.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "metabolomics", "omics", "metabolights"], builtInDatabaseSource: "metabolights" },
	{ id: "mgnify", name: "MGnify", description: "Search metagenomics studies, ENA links, biome labels, and analysis-ready microbiome metadata.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "metagenomics", "microbiome"], builtInDatabaseSource: "mgnify" },
	{ id: "mygene", name: "MyGene.info", description: "Search gene annotations, Entrez ids, Ensembl ids, UniProt links, and summaries.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "genes", "annotation"], builtInDatabaseSource: "mygene" },
	{ id: "ols", name: "OLS", description: "Search ontology terms, CURIEs, labels, descriptions, and synonyms.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "ontology", "ols"], builtInDatabaseSource: "ols" },
	{ id: "openalex", name: "OpenAlex", description: "Search scholarly works, citation/reference graphs, authors, venues, OA status, and OpenAlex identifiers.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "papers", "citations", "openalex"], builtInDatabaseSource: "openalex" },
	{ id: "open-targets", name: "Open Targets", description: "Search target, disease, drug, target-disease association, clinical-candidate, mechanism, and evidence datasource records.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "target discovery", "clinical genomics", "drugs"], builtInDatabaseSource: "opentargets" },
	{ id: "openfda", name: "openFDA", description: "Search public FDA drug label, adverse-event, and recall enforcement records with source metadata.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "fda", "drug safety", "regulatory"], builtInDatabaseSource: "openfda" },
	{ id: "panglaodb", name: "PanglaoDB", description: "Search curated single-cell marker genes by cell type or gene symbol, including canonical markers, organ context, species flags, and sensitivity/specificity scores.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "single-cell", "markers", "cell types"], builtInDatabaseSource: "panglaodb" },
	{ id: "pdb", name: "RCSB PDB", description: "Search structures, methods, release metadata, and PDB identifiers.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "structures", "pdb"], builtInDatabaseSource: "pdb" },
	{ id: "pride", name: "PRIDE", description: "Search public proteomics projects, accessions, instruments, and references.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "proteomics", "pride"], builtInDatabaseSource: "pride" },
	{ id: "protein-atlas", name: "Human Protein Atlas", description: "Search gene/protein atlas rows with Ensembl ids, UniProt accessions, synonyms, and tissue expression fields.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "proteins", "expression", "atlas"], builtInDatabaseSource: "proteinatlas" },
	{ id: "pubchem", name: "PubChem", description: "Resolve compound CIDs, identifiers, properties, SMILES, InChIKeys, and synonyms.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "chemistry", "compounds"], builtInDatabaseSource: "pubchem" },
	{ id: "pubmed", name: "PubMed", description: "Search biomedical abstracts, article metadata, PMID/PMCID/DOI conversions, related-article links, citation matches, copyright/license status, and PMC full-text availability.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "pubmed", "papers"], builtInDatabaseSource: "pubmed" },
	{ id: "quickgo", name: "QuickGO", description: "Search GO annotations, evidence codes, references, and gene-product links.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "ontology", "go"], builtInDatabaseSource: "quickgo" },
	{ id: "reactome", name: "Reactome", description: "Map identifiers to pathways, reactions, enrichment scores, and stable IDs.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "pathways", "reactome"], builtInDatabaseSource: "reactome" },
	{ id: "rfam", name: "Rfam", description: "Fetch RNA family metadata, accessions, descriptions, clans, and family counts.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "rna", "families"], builtInDatabaseSource: "rfam" },
	{ id: "rhea", name: "Rhea", description: "Search curated biochemical reactions, equations, EC numbers, and ChEBI links.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "reactions", "metabolism"], builtInDatabaseSource: "rhea" },
	{ id: "string", name: "STRING", description: "Map proteins and search functional association network edges with STRING scores.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "interactions", "proteins"], builtInDatabaseSource: "string" },
	{ id: "ucsc", name: "UCSC Genome Browser", description: "Search UCSC assemblies, track metadata, chromosome sizes, region track rows, conservation scores, and ENCODE TFBS clusters.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "genomics", "tracks", "ucsc"], builtInDatabaseSource: "ucsc" },
	{ id: "unibind", name: "UniBind", description: "Search direct TF-DNA interaction datasets, TF/cell-line/JASPAR model metadata, model files, and UCSC hub-backed TFBS region rows.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "regulation", "tfbs", "transcription factors"], builtInDatabaseSource: "unibind" },
	{ id: "uniprot", name: "UniProt", description: "Resolve protein accessions, functions, genes, organisms, and linked PDB structures.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "proteins", "annotation"], builtInDatabaseSource: "uniprot" },
	{ id: "figma", name: "Figma", description: "Attach design files and product diagrams as research context.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "design", "files"] },
	{ id: "jam", name: "Jam", description: "Attach bug reports, recordings, and product traces as evidence artifacts.", section: "Directory", source: "Connector directory preset", tags: ["mcp", "bugs", "evidence"] },
	{ id: "cash-app", name: "Cash App", description: "Organization connector slot for private financial or business context.", section: "Organization", source: "Organization connector preset", tags: ["mcp", "organization"] },
	{ id: "context7", name: "Context7", description: "Bring library documentation and code examples into research turns.", section: "Organization", source: "Organization connector preset", tags: ["mcp", "docs", "code"] },
	{ id: "excalidraw", name: "Excalidraw", description: "Attach sketches and diagrams as visual research artifacts.", section: "Organization", source: "Organization connector preset", tags: ["mcp", "diagram", "files"] },
	{ id: "gmail", name: "Gmail", description: "Connect mailbox evidence and threaded research correspondence.", section: "Organization", source: "Organization connector preset", tags: ["mcp", "mail", "context"] },
	{ id: "google-drive", name: "Google Drive", description: "Connect research files, lab notes, PDFs, and shared documents.", section: "Organization", source: "Organization connector preset", tags: ["mcp", "drive", "files"] },
	{ id: "microsoft-learn", name: "Microsoft Learn", description: "Search Microsoft documentation and examples as technical references.", section: "Organization", source: "Organization connector preset", tags: ["mcp", "docs", "microsoft"] },
	{ id: "docuseal", name: "DocuSeal", description: "Organization connector slot for document workflows and signed research records.", section: "Organization", source: "Organization connector preset", tags: ["mcp", "documents"] },
	{ id: "google-calendar", name: "Google Calendar", description: "Connect schedule context for research planning and experiment coordination.", section: "Organization", source: "Organization connector preset", tags: ["mcp", "calendar"] },
	{ id: "linear", name: "Linear", description: "Connect issue context and implementation tasks around research work.", section: "Organization", source: "Organization connector preset", tags: ["mcp", "issues", "planning"] },
];

function buildFeynmanBioToolsResource(): WorkbenchResource {
	return {
		id: "feynman-bio-tools",
		name: "Feynman Bio Tools",
			description: "Feynman-owned read-only science database connector for papers, open-access full-text sections, citation graphs, authors, venues, datasets, clinical trials, BioMart, CellGuide, Antibody Registry, metabolomics, genome tracks, TF-DNA binding, proteins, structures, EM maps, complexes, interactions, genes, variants, expression, ontology, pathway, ChEMBL molecular pharmacology, chemistry, and purchasable-compound lookup.",
		status: "configured",
		source: "Feynman built-in science tools",
		connectorKind: "featured",
		section: "Featured",
			detail: `${FEYNMAN_BIO_TOOL_SOURCE_NAMES.length} public or credential-aware sources through feynman_science_database_search.`,
		diagnostics: [
			"Runtime: implemented inside the Feynman repository and available to Pi chat without a local reference-app dependency.",
			`Sources: ${FEYNMAN_BIO_TOOL_SOURCE_NAMES.join(", ")}.`,
			"Approval boundary: built-in read-only search is enabled through Feynman's own permission grants.",
		],
		tags: ["feynman", "bio tools", "science databases", "built-in", "read-only"],
		tools: [{
			name: "feynman_science_database_search",
			description: `Search ${FEYNMAN_BIO_TOOL_SOURCE_NAMES.length} public or credential-aware science sources with Feynman-owned provenance output.`,
		}],
	};
}

function buildScienceConnectorCatalogResources(existingResources: WorkbenchResource[]): WorkbenchResource[] {
	const existingNames = new Set(existingResources.map((resource) => resource.name.toLowerCase()));
	return SCIENCE_CONNECTOR_PRESETS
		.filter((preset) => !existingNames.has(preset.name.toLowerCase()))
		.map((preset) => {
			const builtInTool = preset.builtInDatabaseSource
				? { name: "feynman_science_database_search", description: `Built-in read-only ${preset.name} search source: ${preset.builtInDatabaseSource}.` }
				: undefined;
			const executablePreset = Boolean(builtInTool || preset.tools?.some((tool) => tool.name.startsWith("feynman_")));
			return {
				id: normalizeResourceId(`science-connector-${preset.id}`),
				name: preset.name,
				description: preset.description,
				status: executablePreset ? "configured" as const : "available" as const,
				source: builtInTool ? "Built-in science database tool" : executablePreset ? "Built-in science workbench tool" : preset.source,
				connectorKind: preset.section.toLowerCase() as WorkbenchResource["connectorKind"],
				section: preset.section,
				detail: executablePreset
					? `Executable now in chat through ${(builtInTool ? [builtInTool] : preset.tools ?? []).map((tool) => tool.name).join(", ")}; add a custom MCP connector only for deeper specialized tools.`
					: "Connect a remote MCP server or local command to make this preset executable in chat.",
				diagnostics: [
					"Catalog state: Feynman-owned preset backed by the local workbench settings and tool registry.",
					executablePreset
						? "Execution: built-in Feynman tool is available in Pi chat without connector setup."
						: "Execution: available after you add a matching MCP URL/local command or enable a Pi package that exposes the tool.",
					"Approval boundary: custom MCP calls still use Feynman's connector grants, chat approval cards, assignment, and excluded-tool policy.",
				],
				tags: executablePreset ? [...preset.tags, "built-in", ...(builtInTool ? ["read-only"] : [])] : preset.tags,
				...((preset.tools || builtInTool) ? { tools: [...(builtInTool ? [builtInTool] : []), ...(preset.tools ?? [])] } : {}),
			} satisfies WorkbenchResource;
		});
}

function buildSpecialistResources(workingDir: string): WorkbenchResource[] {
	return directMarkdownFiles(resolve(workingDir, ".feynman", "agents"))
		.map((path) => markdownResource(workingDir, path, {
			source: "Feynman specialist",
			section: "Built-in specialists",
			command: (name) => `/run ${name} <task>`,
			tags: ["agent", "subagent"],
		}))
		.filter((resource): resource is WorkbenchResource => Boolean(resource));
}

function buildSkillResources(workingDir: string): WorkbenchResource[] {
	const skills = listFiles(resolve(workingDir, "skills"), (name) => name === "SKILL.md")
		.map((path) => markdownResource(workingDir, path, {
			source: "Pi skill",
			section: "Project skills",
			command: (name) => `/skill:${name}`,
			tags: ["skill", "slash command"],
		}))
		.filter((resource): resource is WorkbenchResource => Boolean(resource));
	const prompts = directMarkdownFiles(resolve(workingDir, "prompts"))
		.map((path) => markdownResource(workingDir, path, {
			fallbackName: basename(path, ".md"),
			source: "Pi prompt template",
			section: "Prompt templates",
			command: (name) => `/${name}`,
			tags: ["prompt", "slash command"],
		}))
		.filter((resource): resource is WorkbenchResource => Boolean(resource));
	return [...skills, ...prompts];
}

function buildMemoryResources(
	workingDir: string,
	changelog: WorkbenchChangelogEntry[],
	settings: WorkbenchSettings,
	memories: WorkbenchMemoryRecord[],
	notes: WorkbenchNoteRecord[],
): WorkbenchResource[] {
	return [
		{
			id: "memory-off-default",
			name: "Session memory",
			description: "Memory is off by default for new workbench sessions; the session menu can include recent local context per turn.",
			status: "available",
			source: "Workbench chat",
			section: "Memory state",
			tags: ["local", "opt-in"],
		},
		{
			id: "lab-notebook",
			name: "Lab notebook",
			description: `${pluralize(changelog.length, "entry", "entries")} loaded from CHANGELOG.md for continuity and verification state.`,
			status: existsSync(resolve(workingDir, "CHANGELOG.md")) ? "configured" : "available",
			source: "Workspace",
			section: "Categories",
			path: "CHANGELOG.md",
			tags: ["continuity", "verification"],
		},
		{
			id: "session-memory-context",
			name: "Session context",
			description: `${pluralize(memories.length, "memory", "memories")} and ${pluralize(notes.length, "note")} saved in the local workbench memory store.`,
			status: "configured",
			source: "Workbench chat",
			section: "Categories",
			tags: ["notebook", "attachments", "local"],
		},
		{
			id: "target-notes",
			name: "Target notes",
			description: "Message, session, and artifact notes are kept local and linked back to their research target.",
			status: notes.length ? "configured" : "available",
			source: "Workbench notes",
			section: "Notes",
			detail: pluralize(notes.length, "note"),
			tags: ["notes", "artifacts", "sessions"],
		},
		...settings.memoryCategories.map((category) => ({
			id: normalizeResourceId(`memory-category-${category.id}`),
			name: category.name,
			description: category.guidance,
			status: "configured" as const,
			source: "Workbench memory",
			section: "Custom categories",
			detail: category.autoRecall ? "auto-recall on" : "auto-recall off",
			settingsCollection: "memoryCategories" as const,
			settingsRecordId: category.id,
			tags: ["memory", "category", category.autoRecall ? "auto-recall" : "manual"],
		} satisfies WorkbenchResource)),
	];
}

function buildComputeResources(compute: WorkbenchComputeProvider[], settings: WorkbenchSettings, workingDir: string): WorkbenchResource[] {
	return [
		...compute.map((provider) => ({
			id: normalizeResourceId(`compute-${provider.id}`),
			name: provider.name,
			description: provider.description,
			status: provider.status,
			source: provider.family,
			section: provider.family === "Pi"
				? "Agent compute"
				: provider.family === "Cloud provider"
					? "Cloud providers"
					: provider.family === "Model endpoint"
						? "Model endpoints"
						: provider.family === "SSH compute"
							? "SSH hosts"
							: "Local compute",
			detail: provider.detail ?? provider.capabilities.join(", "),
			diagnostics: provider.diagnostics,
			settingsCollection: provider.settingsCollection,
			settingsRecordId: provider.settingsRecordId,
			tags: provider.capabilities,
			tools: provider.tools,
		} satisfies WorkbenchResource)),
		{
			id: "compute-ssh-hosts",
			name: "SSH hosts",
			description: settings.computeHosts.length
				? `${pluralize(settings.computeHosts.length, "SSH host")} configured for remote workstation or HPC execution.`
				: "Remote workstation/HPC execution is not configured yet; local Pi and notebook kernels remain the active compute path.",
			status: settings.computeHosts.length ? "configured" : "available",
			source: "Remote compute",
			section: "SSH hosts",
			detail: "~/.ssh/config",
			tags: ["ssh", "hpc", "remote"],
		},
	];
}

function buildNetworkResources(settings: WorkbenchSettings): WorkbenchResource[] {
	const webStatus = getPiWebAccessStatus();
	const allowedDomains = settings.allowedDomains.map((domain) => ({
		id: normalizeResourceId(`allowed-domain-${domain.id}`),
		name: domain.domain,
		description: "User-added hostname for research code, data fetches, or API calls.",
		status: "configured" as const,
		source: "Network policy",
		section: "Allowed domains",
		detail: domain.domain,
		settingsCollection: "allowedDomains" as const,
		settingsRecordId: domain.id,
		tags: ["allowlist", "domain"],
	} satisfies WorkbenchResource));
	return [
		{
			id: "network-pi-web-access",
			name: "Pi web access",
			description: webStatus.note,
			status: webStatus.configExists ? "configured" : "available",
			source: "pi-web-access",
			section: "Runtime policy",
			path: webStatus.configPath,
			detail: `search ${webStatus.routeLabel}; request ${webStatus.requestProvider}; workflow ${webStatus.workflow}`,
			diagnostics: [
				`Perplexity API: ${webStatus.perplexityConfigured ? "configured" : "not configured"}.`,
				`Exa API: ${webStatus.exaConfigured ? "configured" : "not configured"}.`,
				`Gemini API: ${webStatus.geminiApiConfigured ? "configured" : "not configured"}.`,
				`Gemini browser fallback: ${webStatus.geminiBrowserEnabled ? "enabled" : "disabled"}.`,
			],
			tags: ["search", "web", webStatus.routeLabel.toLowerCase()],
		},
		scienceDomainResource("package-management", "Package management", "npm, pip, conda, CRAN, Bioconductor, GitHub", ["packages", "reproducibility"]),
			scienceDomainResource("literature-citations", "Literature & citations", "PubMed search/metadata/ID conversion/related articles/citation matching, Europe PMC full-text sections, OpenAlex, arXiv, bioRxiv, medRxiv, Crossref, DOI, DataCite", ["papers", "citations"]),
		scienceDomainResource("genomics-biology", "Genomics & biology", "NCBI, Ensembl, UCSC Genome Browser, UniBind, BioMart, CellGuide, Antibody Registry, UniProt, RCSB PDB, ChEMBL, ClinicalTrials, ClinVar, dbSNP, CADD, gnomAD, GTEx, ENCODE, MetaboLights", ["biology", "omics"]),
		scienceDomainResource("clinical-pharma", "Clinical & pharma", "FDA, ClinicalTrials, Open Targets, COSMIC, DepMap, ClinGen, cBioPortal, CIViC", ["clinical", "pharma"]),
		{
			id: "network-allowlist",
			name: "Allowed domains",
			description: allowedDomains.length
				? `${pluralize(allowedDomains.length, "domain")} allowed for code fetches or API calls.`
				: "No enforced domain allowlist is active; connector/package diagnostics show which runtime path owns each external call.",
			status: allowedDomains.length ? "configured" : "available",
			source: "Network policy",
			section: "Runtime policy",
			tags: ["policy", "diagnostics"],
		},
		...allowedDomains,
	];
}

function buildPermissionResources(workingDir: string, settings: WorkbenchSettings): WorkbenchResource[] {
	return [
		{
			id: "pi-project-trust",
			name: "Project trust",
			description: "Pi project trust gates project settings, packages, skills, prompts, and extensions before they are loaded.",
			status: existsSync(resolve(workingDir, ".feynman", "settings.json")) ? "configured" : "available",
			source: "Pi security model",
			section: "Trust boundary",
			path: ".feynman/settings.json",
			tags: ["trust", "packages", "extensions"],
		},
		{
			id: "pi-rpc-chat",
			name: "Pi RPC chat",
			description: "Workbench chat uses Pi RPC prompt, steer, abort, session tree, bash, and command discovery primitives.",
			status: "configured",
			source: "Pi RPC",
			section: "Tool grants",
			detail: "prompt, steer, abort, get_entries, get_tree, get_commands, bash",
			tags: ["chat", "sessions", "tools"],
		},
		{
			id: "pi-package-execution",
			name: "Package and extension execution",
			description: "Pi packages and extensions run inside the local Pi process with user-account permissions after project trust is granted.",
			status: "configured",
			source: "Pi security model",
			section: "Tool grants",
			tags: ["packages", "extensions", "local process"],
		},
		{
			id: "workspace-artifact-scope",
			name: "Workspace artifact scope",
			description: "Preview and downloads are constrained to outputs, papers, notes, and the lab notebook.",
			status: "read-only",
			source: "Workbench server",
			section: "File access",
			path: toPosixPath(workingDir),
			tags: ["files", "provenance"],
		},
		{
			id: "loopback-workbench",
			name: "Loopback workbench",
			description: "The science app runs locally behind a bearer token and cookie, matching the desktop-local control-plane shape.",
			status: "configured",
			source: "Workbench server",
			section: "App access",
			tags: ["local", "browser"],
		},
		...settings.permissionGrants.map((grant) => ({
			id: normalizeResourceId(`permission-grant-${grant.id}`),
			name: grant.name,
			description: grant.description || `Decision for ${grant.scope}.`,
			status: grant.decision === "deny" ? "disabled" as const : grant.decision === "allow" ? "configured" as const : "available" as const,
			source: "Workbench grant",
			section: "Tool grants",
			detail: `${grant.scope} | ${grant.decision}`,
			settingsCollection: "permissionGrants" as const,
			settingsRecordId: grant.id,
			tags: ["grant", grant.decision],
		} satisfies WorkbenchResource)),
	];
}

function buildCredentialResources(settings: WorkbenchSettings): WorkbenchResource[] {
	return [
		...WORKBENCH_CREDENTIAL_PROVIDERS.map((provider) => {
			const isModal = provider.id === "modal";
			return {
				id: `credential-${provider.id}`,
				name: provider.name,
				description: isModal && modalCredentialStatus() === "configured"
					? "Credential detected. Modal credentials are available through the local Modal credential path; values are not displayed."
					: envDescription(provider.envVar, "Credential detected.", "Credential not detected."),
				status: isModal ? modalCredentialStatus() : envStatus(provider.envVar),
				source: provider.source,
				section: provider.section,
				detail: isModal ? modalCredentialDetail() : provider.envVar,
				...(isModal ? { diagnostics: [
					process.env.MODAL_TOKEN_ID?.trim() && process.env.MODAL_TOKEN_SECRET?.trim()
						? "Auth: MODAL_TOKEN_ID and MODAL_TOKEN_SECRET are present in the server environment."
						: modalConfigExists()
							? "Auth: ~/.modal.toml exists and is the active detected Modal credential source."
							: "Auth: Modal credentials were not detected.",
				] } : {}),
				tags: provider.tags,
			} satisfies WorkbenchResource;
		}),
		...settings.credentialRefs.map((credential) => ({
			id: normalizeResourceId(`credential-ref-${credential.id}`),
			name: credential.name,
			description: credential.description || envDescription(credential.envVar, "Credential reference is satisfied.", "Credential reference is waiting on an environment value."),
			status: envVarStatus(credential.envVar),
			source: "Workbench credential",
			section: "Custom credentials",
			detail: `${credential.provider} | ${credential.envVar}`,
			settingsCollection: "credentialRefs" as const,
			settingsRecordId: credential.id,
			tags: ["credential", credential.provider, "env"],
		} satisfies WorkbenchResource)),
	];
}

function buildCustomConnectorResources(settings: WorkbenchSettings, workingDir: string): WorkbenchResource[] {
	return settings.customConnectors.map((connector) => {
		const token = oauthTokenForConnector(workingDir, connector.id);
		const hasOAuthMetadata = Boolean(connector.oauthServerUrl || connector.clientId || connector.scopes);
		const oauthStatus = !hasOAuthMetadata
			? "not_configured"
			: token
				? isOAuthTokenExpired(token) ? "expired" : "connected"
				: "missing";
		const oauthAction = oauthStatus === "connected"
			? "disconnect"
			: hasOAuthMetadata
				? oauthStatus === "expired" ? "reconnect" : "connect"
				: undefined;
		return {
			id: normalizeResourceId(`custom-connector-${connector.id}`),
			name: connector.name,
			description: connector.description || "Custom MCP-style connector added from the workbench.",
			status: "configured" as const,
			source: "Custom MCP connector",
			connectorKind: "custom",
			section: "Custom",
			detail: connector.transport === "local"
				? `local command | ${connector.command ?? ""}`
				: `${connector.transport} | ${connector.url}`,
			diagnostics: [
					"Config: stored in the Feynman app data root.",
				connector.transport === "local"
					? "Runtime: local command connectors can be discovered with feynman_connector_tools and called with feynman_connector_call after approval."
					: connector.transport === "streamable_http"
						? "Runtime: Streamable HTTP connectors can be discovered with feynman_connector_tools and called with feynman_connector_call after approval."
						: "Runtime: SSE connectors can be discovered with feynman_connector_tools and called with feynman_connector_call after approval.",
				connector.headersHelper
					? "Auth: headers helper command is referenced, but helper output is not stored or displayed."
					: "Auth: no headers helper is configured.",
				connector.assignedSpecialists?.length
					? `Assignment: available to ${connector.assignedSpecialists.join(", ")}.`
					: "Assignment: available to every specialist.",
				connector.excludedTools?.length
					? `Excluded tools: ${connector.excludedTools.join(", ")}.`
					: "Excluded tools: none configured.",
				oauthStatus === "connected"
					? `OAuth: connected${token?.expiresAtMs ? ` until ${new Date(token.expiresAtMs).toISOString()}` : " with no expiry"}; token value is stored locally and not displayed.`
					: oauthStatus === "expired"
						? "OAuth: stored token is expired; reconnect this connector."
						: oauthStatus === "missing"
							? "OAuth: metadata is configured; connect OAuth to create a local token record."
							: "OAuth: no OAuth metadata is configured.",
				connector.skipApprovals
					? "Approvals: skip approvals is enabled for this connector."
					: "Approvals: missing or ask tool grants create pending requests before execution.",
			],
			...(oauthAction ? { oauthAction, oauthConnectorId: connector.id, oauthStatus } : { oauthStatus }),
			settingsCollection: "customConnectors" as const,
			settingsRecordId: connector.id,
			settingsRecord: {
				id: connector.id,
				assignedSpecialists: connector.assignedSpecialists ?? [],
				excludedTools: connector.excludedTools ?? [],
				createdAt: connector.createdAt,
				updatedAt: connector.updatedAt,
			},
			tags: [
				"mcp",
				connector.transport === "local" ? "local command" : "remote",
				connector.transport,
				connector.assignedSpecialists?.length ? "assigned specialists" : "all specialists",
				connector.excludedTools?.length ? "excluded tools" : "all tools",
				connector.skipApprovals ? "skip approvals" : "ask first",
				oauthStatus === "connected" ? "oauth connected" : hasOAuthMetadata ? "oauth setup" : "no oauth",
			],
		} satisfies WorkbenchResource;
	});
}

function buildStorageResources(workingDir: string, artifacts: WorkbenchArtifact[]): WorkbenchResource[] {
	const dataRoot = getWorkbenchDataRoot(workingDir);
	const chatCount = countFiles(migratedWorkbenchDataPath(workingDir, "sessions"), (name) => name.endsWith(".json"));
	const piSessionCount = countFiles(resolve(workingDir, ".feynman", "sessions"), (name) => name.endsWith(".jsonl"));
	const artifactBytes = artifacts.reduce((sum, artifact) => sum + artifact.sizeBytes, 0);
	const workbenchUsage = directorySize(dataRoot);
	const cloudTargets = listWorkbenchCloudExportTargets(workingDir);
	return [
		{
			id: "storage-data-location",
			name: "Data location",
			description: "Feynman stores app-owned workbench state under the Feynman app data root.",
			status: "configured",
			source: "Feynman app data",
			section: "Local data",
			path: toPosixPath(dataRoot),
			detail: `${humanBytes(artifactBytes + workbenchUsage.bytes)} indexed or workbench-local data`,
			tags: ["local", "app data"],
		},
		{
			id: "research-artifact-roots",
			name: "Research artifact roots",
			description: `${pluralize(artifacts.length, "artifact")} indexed from outputs, papers, and notes.`,
			status: "configured",
			source: "Workspace",
			section: "Local data",
			detail: `outputs/, papers/, notes/, CHANGELOG.md | ${humanBytes(artifactBytes)}`,
			tags: ["outputs", "papers", "notes"],
		},
		{
			id: "workbench-chat-sessions",
			name: "Workbench chat sessions",
			description: `${pluralize(chatCount, "session")} persisted under the Feynman app data root.`,
			status: chatCount ? "configured" : "available",
			source: "Workbench",
			section: "Local data",
			path: toPosixPath(resolve(dataRoot, "sessions")),
			tags: ["chat", "json"],
		},
		{
			id: "pi-session-history",
			name: "Pi session history",
			description: `${pluralize(piSessionCount, "Pi JSONL session")} available for timeline, branch, and provenance reconstruction.`,
			status: piSessionCount ? "configured" : "available",
			source: "Pi sessions",
			section: "Local data",
			path: ".feynman/sessions",
			tags: ["jsonl", "branches"],
		},
		{
			id: "cloud-storage",
			name: "Cloud storage",
			description: cloudTargets.length
				? `${pluralize(cloudTargets.length, "credential-backed export target")} configured for artifact export.`
				: "No cloud storage configured. Add a credential with bucket access in Credentials.",
			status: cloudTargets.some((target) => target.status === "configured") ? "configured" : "available",
			source: "Storage",
			section: "Cloud storage",
			detail: cloudTargets.length
				? cloudTargets.map((target) => `${target.name}: ${target.detail}`).join("; ")
				: "Configure a credential reference whose env var points at file://, s3://, or gs://.",
			tags: ["exports", "bucket"],
		},
	];
}

function buildUsageResources(
	artifacts: WorkbenchArtifact[],
	plans: WorkbenchGeneratedPlan[],
	execution: WorkbenchExecutionRecord[],
	checks: WorkbenchVerificationCheck[],
): WorkbenchResource[] {
	const artifactBytes = artifacts.reduce((sum, artifact) => sum + artifact.sizeBytes, 0);
	const chatEvents = execution.filter((record) => record.origin === "chat" || record.origin === "pi").length;
	const toolEvents = execution.filter((record) => record.kind === "tool" || record.kind === "bash" || record.kind === "python" || record.kind === "r").length;
	const latestEvent = execution.slice().sort((a, b) => b.createdAtMs - a.createdAtMs)[0];
	return [
		{
			id: "usage-current-workspace",
			name: "Current workspace",
			description: `${pluralize(artifacts.length, "artifact")} and ${pluralize(execution.length, "execution event")} are indexed in the local state scan.`,
			status: "read-only",
			source: "Workbench state",
			section: "Local estimate",
			detail: `${humanBytes(artifactBytes)} artifacts; ${pluralize(plans.length, "plan")}; ${pluralize(checks.length, "check")}`,
			tags: ["local", "artifacts", "execution"],
		},
		{
			id: "usage-chat-tools",
			name: "Chat and tool activity",
			description: `${pluralize(chatEvents, "Pi/chat event")} and ${pluralize(toolEvents, "tool-like event")} are available for provenance and notebook context.`,
			status: "read-only",
			source: "Execution ledger",
			section: "Local estimate",
			detail: latestEvent ? `latest ${latestEvent.title}` : "no execution events yet",
			tags: ["chat", "tools", "provenance"],
		},
		{
			id: "usage-provider-tokens",
			name: "Provider token usage",
			description: "Feynman exposes local run evidence here; provider billing and subscription limits stay with the selected model provider.",
			status: "available",
			source: "Model provider",
			section: "Plan limits",
			tags: ["tokens", "provider"],
		},
	];
}

function buildGeneralResources(workingDir: string): WorkbenchResource[] {
	const packageJson = readJsonObject(resolve(workingDir, "package.json"));
	const piPackageJson = readJsonObject(resolve(workingDir, "node_modules", "@earendil-works", "pi-coding-agent", "package.json"));
	const settings = readJsonObject(resolve(workingDir, ".feynman", "settings.json"));
	const pythonRuntime = resolvePythonRuntimeCommand();
	const rRuntime = resolveRRuntimeCommand();
	const rscriptRuntime = resolveRscriptRuntimeCommand();
	const managedNotebookRuntime = [pythonRuntime, rRuntime, rscriptRuntime].some((runtime) => runtime.source === "managed" || runtime.source === "configured");
	return [
		{
			id: "general-feynman",
			name: "Feynman",
			description: "Local open-science workbench built on Pi, project artifacts, notebook runs, and verifiable research outputs.",
			status: "configured",
			source: "Package",
			section: "About",
			detail: typeof packageJson?.version === "string" ? `v${packageJson.version}` : "version unavailable",
			tags: ["local", "science workbench"],
		},
		{
			id: "general-pi-runtime",
			name: "Pi runtime",
			description: "Embedded agent runtime used for persistent chat sessions, slash commands, packages, and tool execution.",
			status: "configured",
			source: "Pi",
			section: "About",
			detail: typeof piPackageJson?.version === "string" ? `@earendil-works/pi-coding-agent v${piPackageJson.version}` : "version unavailable",
			tags: ["rpc", "sessions", "packages"],
		},
		{
			id: "general-notebook-runtimes",
			name: "Notebook runtimes",
			description: "Notebook cells resolve Python and R from configured env vars, managed local scientific runtimes, then PATH.",
			status: managedNotebookRuntime ? "configured" : "available",
			source: "Runtime resolver",
			section: "About",
			detail: `Python: ${pythonRuntime.detail}; R: ${rRuntime.detail}; Rscript: ${rscriptRuntime.detail}`,
			diagnostics: [
				`Python command source: ${pythonRuntime.source}.`,
				`R command source: ${rRuntime.source}.`,
				`Rscript command source: ${rscriptRuntime.source}.`,
			],
			tags: ["notebook", "python", "r"],
		},
		{
			id: "general-theme",
			name: "Workbench appearance",
			description: "The local UI uses Feynman's green research theme and the Codex-style split control-plane layout.",
			status: "configured",
			source: "Workbench UI",
			section: "Appearance",
			detail: Array.isArray(settings?.themes) ? settings.themes.join(", ") : "default workbench theme",
			tags: ["green", "split pane"],
		},
		{
			id: "general-diagnostics",
			name: "Diagnostics",
			description: "Settings, sessions, package manifests, notebook executions, and artifact snapshots are readable from local files for audit.",
			status: "read-only",
			source: "Local files",
			section: "Diagnostics",
			path: getWorkbenchDataRoot(workingDir),
			tags: ["logs", "audit", "local"],
		},
	];
}

export function buildWorkbenchSettingsResourceGroups(options: {
	artifacts: WorkbenchArtifact[];
	changelog: WorkbenchChangelogEntry[];
	checks: WorkbenchVerificationCheck[];
	compute: WorkbenchComputeProvider[];
	execution: WorkbenchExecutionRecord[];
	memories: WorkbenchMemoryRecord[];
	notes: WorkbenchNoteRecord[];
	plans: WorkbenchGeneratedPlan[];
	workingDir: string;
}): WorkbenchResourceGroup[] {
	const { artifacts, changelog, checks, compute, execution, memories, notes, plans, workingDir } = options;
	const settings = readWorkbenchSettings(workingDir);
	const claudeScienceReferenceResources = includeClaudeScienceReferenceResources()
		? buildClaudeScienceReferenceResources(readClaudeScienceInstall())
		: [];
	const packageConnectors = buildConnectorResources(workingDir);
	const customConnectors = buildCustomConnectorResources(settings, workingDir);
	const feynmanBioTools = buildFeynmanBioToolsResource();
	const connectors = [
		feynmanBioTools,
		...buildScienceConnectorCatalogResources([...packageConnectors, ...customConnectors, feynmanBioTools]),
		...packageConnectors,
		...customConnectors,
	];
	return [
		{
			id: "skills",
			title: "Skills",
			description: "Reusable research playbooks and prompt templates exposed to Pi slash commands.",
			resources: [
				...buildSkillResources(workingDir),
			],
		},
		{
			id: "connectors",
			title: "Connectors",
			description: "Scientific MCP connectors, Pi packages, project extensions, tool grants, and local execution bridges.",
			resources: connectors,
		},
		{
			id: "specialists",
			title: "Specialists",
			description: "Prompted research agents that can be selected or delegated from a session.",
			resources: [
				...buildSpecialistResources(workingDir),
			],
		},
		{
			id: "memory",
			title: "Memory",
			description: "Local continuity records that make research runs resumable and auditable.",
			resources: buildMemoryResources(workingDir, changelog, settings, memories, notes),
		},
		{
			id: "compute",
			title: "Compute",
			description: "Local kernels, Pi agents, and optional cloud or endpoint slots visible to the workbench.",
			resources: buildComputeResources(compute, settings, workingDir),
		},
		{
			id: "network",
			title: "Network",
			description: "Science-domain access, web-search routing, and the current local network policy.",
			resources: buildNetworkResources(settings),
		},
		{
			id: "permissions",
			title: "Permissions",
			description: "Local execution, file, trust, and loopback access boundaries for this app.",
			resources: buildPermissionResources(workingDir, settings),
		},
		{
			id: "credentials",
			title: "Credentials",
			description: "Credential surfaces Feynman can use for model, evidence, code, and compute providers.",
			resources: buildCredentialResources(settings),
		},
		{
			id: "storage",
			title: "Storage",
			description: "Artifact, chat, Pi session, snapshot, and export storage used by the local science workspace.",
			resources: buildStorageResources(workingDir, artifacts),
		},
		{
			id: "usage",
			title: "Usage",
			description: "Local activity counters and provider-owned usage boundaries for the current workspace.",
			resources: buildUsageResources(artifacts, plans, execution, checks),
		},
			{
				id: "general",
				title: "General",
				description: "Version, runtime, appearance, and diagnostic facts for this local app.",
				resources: [
					...claudeScienceReferenceResources,
					...buildGeneralResources(workingDir),
				],
			},
	];
}
