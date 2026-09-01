---
title: Code Audit
description: Compare a paper's claims against its public codebase for reproducibility.
section: Workflows
order: 4
---

The code audit workflow compares a paper's claims against its public codebase to identify mismatches, undocumented deviations, and reproducibility risks. It bridges the gap between what a paper says and what the code actually does.

## Usage

From the REPL:

```
/audit arxiv:2401.12345
```

```
/audit https://github.com/org/repo --paper arxiv:2401.12345
```

From the CLI:

```bash
feynman audit 2401.12345
```

When given an arXiv ID, Feynman locates the associated code repository from the paper's links, Papers With Code, or GitHub search. You can also provide the repository URL directly.

## How it works

The audit workflow operates in two passes. First, the researcher agent reads the paper and extracts all concrete claims: hyperparameters, architecture details, training procedures, dataset splits, evaluation metrics, and reported results. Each claim is tagged with its location in the paper for traceability.

Second, the verifier agent examines the codebase to find the corresponding implementation for each claim. It checks configuration files, training scripts, model definitions, and evaluation code to verify that the code matches the paper's description. When it finds a discrepancy -- a hyperparameter that differs, a training step that was described but not implemented, or an evaluation procedure that deviates from the paper -- it documents the mismatch with exact file paths and line numbers.

The audit also checks for common reproducibility issues like missing random seeds, non-deterministic operations without pinned versions, hardcoded paths, and absent environment specifications.

## Output format

The audit report contains:

- **Match Summary** -- Percentage of claims that match the code
- **Confirmed Claims** -- Claims that are accurately reflected in the codebase
- **Mismatches** -- Discrepancies between paper and code with evidence from both
- **Missing Implementations** -- Claims in the paper with no corresponding code
- **Reproducibility Risks** -- Issues like missing seeds, unpinned dependencies, or hardcoded paths

## When to use it

Use `/audit` when you are deciding whether to build on a paper's results, when replicating an experiment, or when evaluating a paper before relying on its claims. It is also useful for auditing your own papers before submission to catch inconsistencies between your writeup and implementation.
