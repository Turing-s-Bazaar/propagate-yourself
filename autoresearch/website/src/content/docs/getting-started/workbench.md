---
title: Science Workbench
description: Run the local Feynman science workbench for chat, artifacts, notebooks, compute, provenance, and setup state.
section: Getting Started
order: 3
---

The science workbench is the local app behind `feynman serve`. It gives Feynman a browser-based research control plane while keeping app-owned settings, sessions, uploads, snapshots, memory, OAuth tokens, and compute logs under `~/.feynman/orgs/<org_uuid>/workbench/workspaces/<workspace-id>/`. It also refreshes an org-level SQLite mirror at `~/.feynman/orgs/<org_uuid>/feynman-workbench.db` for core project, frame, message, artifact, execution, verification, memory, note, annotation, read-cursor, artifact-folder, compute-provider, MCP-grant, memory-category, routine-schedule, managed-endpoint, and capability-setting records, plus compact table envelopes for the remaining reference-shaped workbench ledgers Feynman already owns in state. Compute-provider rows include egress policy and Modal environment fields, existing local databases are upgraded in place, and connector ledgers include split science attachments, split MCP grants, and custom MCP resource identifiers. Research artifacts remain ordinary workspace files in `outputs/`, `papers/`, and `notes/`.

```bash
feynman serve
```

The command starts a local server, prints an authenticated localhost URL, and opens the workbench. The URL token is local to that server process. For trusted local testing, run `feynman serve --no-auth` to print a plain localhost URL with no token.

## What the workbench contains

- **Projects and sessions** -- Create projects, open existing research sessions, continue Pi-backed chat, and keep project metadata, frame rows, frame message rows, frame backfill health rows, and run state tied to the workspace.
- **Onboarding context** -- Capture field, goal, workflow, data tools, bottlenecks, permissions, selected first task, suggested specialist, suggested seed workflows, and connector choices.
- **Feynman Bio Tools** -- Use Feynman-owned science connectors for literature, exact OpenAlex work/citation/reference/author/venue workflows, exact arXiv search and batch-paper retrieval, PubMed article metadata, PMID/PMCID/DOI conversion, related-article links, citation matching, copyright/license checks, PMC full-text routing, bioRxiv/medRxiv DOI lookup, date/category preprint windows, published-preprint links, funder/ROR lookup, preprint usage/content statistics, Europe PMC open-access full-text sections, citation graphs, authors, venues, OA status, ClinicalTrials.gov trial search, NCT detail records, sponsor programs, eligibility filters, investigator records, endpoint summaries, Grants.gov Search2 opportunity lookup, FDA labels, adverse events, recalls, Drugs@FDA applications, application counts, pharmacologic classes, generic-equivalent active-ingredient sets, ChEMBL compound search, drug indications and warnings, calculated ADMET properties, bioactivity rows, mechanisms, target records, PubChem compound/search/similarity/bioassay/safety workflows, ChEBI entity/ontology workflows, BindingDB target/compound workflows, Rhea reaction search/detail workflows, editable Ketcher chemistry sketch seeds, gene, BioMart, Ensembl lookup/xref/VEP/homology/sequence/overlap workflows, MyGene query-many lookup, OLS ontology catalogue/search/term lookup, QuickGO annotations, UniProt entry retrieval, Reactome pathway mapping, CellGuide, PanglaoDB marker genes and gene-to-cell-type workflows, exact Antibody Registry antibody/RRID/catalog/stat workflows, reagent, cell-type, metabolomics, genome-track, UCSC exact track/chromosome/conservation/TFBS workflows, UniBind TF-DNA binding, KEGG entry/search/link/ID-conversion workflows, InterPro/Pfam exact domain architecture, entry, clan, family protein/proteome modes, Human Protein Atlas exact gene/search modes, STRING exact ID mapping, network, similarity, and best-hit workflows, purchasable ZINC compounds, exact gnomAD/CADD/ClinVar/dbSNP variant workflows, GWAS Catalog exact association/study/trait/SNP workflows, eQTL Catalogue exact dataset and association workflows, PheWeb/FinnGen PheWAS workflows, GTEx dataset/tissue/sample/gene/expression/eQTL workflows, tissue/protein-atlas, expression, protein, predicted-structure, structure, EM-map, complex, interaction, exact ENCODE/JASPAR/UniBind regulation workflows for experiments, biosamples, files, matrices, species/taxa/collections/releases, datasets, and regional TFBS, exact ArrayExpress/GEO/MetaboLights/MGnify/PRIDE omics-archive workflows for experiments, samples, files, analyses, projects, and protein evidence, metagenomics, pathway, chemical-ontology, chemistry, binding, reaction, exact Rfam RNA family metadata/accession/alignment/model/tree/region/structure/search workflows, cBioPortal study/detail/mutation-frequency/mutation/CNA/clinical-attribute workflows, DepMap model/gene/dependency workflows, CIViC gene/variant/evidence/assertion/profile/disease/therapy workflows, ClinGen validity/dosage/actionability/classification workflows, Open Targets disease-drug/disease-target/drug/search workflows, cancer-curation, canceromics, human-genetics, and target-discovery work.
- **Artifacts and previews** -- Browse outputs, papers, notes, plans, datasets, generated reports, JSON/JSONL, CSV, PDFs, images, audio, video, XLSX workbooks, Jupyter notebooks, LaTeX, KET/RXN/CDXML/CXSMILES/Molfile/SDF/SMILES chemistry artifacts, proteins, alignments, genomes, variants, trees, tensors, and saved snapshots from one artifact pane. Files expose local workspace artifacts, SSH/BYOC compute hosts, and cloud buckets from Feynman's owned host and credential state. HTML reports support element-level annotation inside the sandboxed preview, with selector/text capture and saved badges attached to the artifact annotation ledger. Artifacts written by Pi chat stay attached to the producing run and project through snapshot/output provenance even when their filenames use a different slug. Artifact Notes open target-aware edit and preview modals backed by Feynman's target-note ledger, Customize > Storage opens a cloud credential modal, and Cloud export opens a target-and-destination modal with an owned audit log.
- **Versions and lineage** -- Inspect artifact versions, checksums, producer records, upstream and downstream links, annotations, and execution evidence.
- **Notebooks and compute** -- Run local Python, R, and Bash cells, inspect persistent session kernels, review notebook execution logs, and track configured compute providers and jobs.
- **Settings and resources** -- Review specialists, skills, frame records, frame message records, frame backfill health records, watch routine records, skill source/license records, setup decision records, review feedback records, compute poller lease records, Pi commands, connectors, memory categories, permissions, compute, network, storage, credentials, usage, and general runtime state.
- **Redacted credential state** -- See which provider credentials are configured through settings, environment variables, or Pi auth storage without exposing raw values.

## Standalone boundary

The workbench does not require another local app to be installed. Its visible connectors are Feynman-owned resources such as Feynman Bio Tools, and its durable app records live under Feynman's active local org in `~/.feynman/orgs/<org_uuid>/workbench` plus the owned org database `~/.feynman/orgs/<org_uuid>/feynman-workbench.db` while generated research artifacts remain in the active workspace.

Debug-only reference inspection can be enabled by developers through explicit environment configuration, but ordinary onboarding, chat, settings, connectors, artifacts, notebooks, compute, memory, and provenance paths are Feynman-owned.

## Setup state

The first-run workbench onboarding creates a Feynman project and session, selects an appropriate specialist, records chosen setup scopes, suggests seed workflows, and stores intent declarations derived from the user's own research context. Those intent declarations let later sessions understand the user's setup choices without hardcoding a reference-product dependency.

Skill source rows and license-assent rows are audit records for Feynman's owned local skill pack, not a dependency on an external marketplace service.

Watch routine rows are audit records for `/watch` plans and baselines. They stay disabled with a blocked reason when scheduling tooling was unavailable, so the workbench does not pretend a recurring job exists.

Setup decision rows record public scientific API contact-email consent and provider credential readiness. Contact-email rows use configured NCBI/Entrez/Crossref mailto environment variables, and credential-ask rows derive from redacted provider availability instead of storing raw secret values.

Project rows expose Feynman's durable project spine: local owner id, created and updated timestamps, context text, memory-enabled state, upload-frame id, run slugs, artifact paths, session counts, and artifact counts.

Review feedback rows are audit records for user-requested reviewer passes. They are keyed by frame, user, and feedback type and store bounded context such as the reviewed artifact path and reviewer response id.

Frame rows are control-plane records for Feynman-owned chat sessions, artifact runs, and project upload areas. They expose root frame ids, project ids, agent/delegate names, status, bounded input/output/context JSON, model and compute settings, artifact references, timestamps, and source ownership through local state.

Frame message rows are audit records for persisted chat turns. They are derived from Feynman session files and expose frame id, message index, UUID, role, status, timestamp, and structured message JSON through the local workbench state.

Frame backfill health rows are empty in clean workspaces and appear only when Feynman's own state records a failed historical frame import. They expose frame id, failure count, terminal state, reason, and updated timestamp without depending on another local app.

Compute poller lease rows are current audit records for active compute jobs and pending compute terminations. They mirror the single-writer polling guard shape and disappear when no compute polling work is active.

Credential rows are availability records, not secret dumps. They point to Feynman settings, provider environment variables, or Pi auth storage and store only redacted references.

## Output locations

The workbench follows the same output conventions as the CLI:

- Research outputs go in `outputs/`
- Paper-style drafts go in `papers/`
- Session notes go in `notes/`
- Long-running plans go in `outputs/.plans/`
- The chronological lab notebook is `CHANGELOG.md`

Generated reports and provenance files remain ordinary workspace files, so they can be inspected from the app, terminal, editor, or git.

Workbench control-plane records such as chat session JSON, settings, memory rows, annotations, OAuth token references, uploads, notebook execution logs, Modal job scripts, managed Python/R environments, artifact snapshots, and cloud-export audit logs live under `~/.feynman/orgs/<org_uuid>/workbench/workspaces/<workspace-id>/`. The served workbench also refreshes `~/.feynman/orgs/<org_uuid>/feynman-workbench.db`, which mirrors core tables for projects, frames, frame messages, artifacts, artifact versions, execution logs, verification checks, memories, and notes plus control-plane tables for annotations, frame read cursors, artifact folders, compute providers, MCP tool grants, memory categories, routine schedules, managed endpoints, and capability settings. The database also contains physical table envelopes for Feynman's other owned reference-shaped ledgers such as agents, skills, credentials, OAuth tokens, events, notifications, session activity, claims, host logs, marketplace rows, and archive rows. Existing home-level `~/.feynman/workbench` records and checkout-local `.feynman/workbench` records are copied into that app-data location on first access.
