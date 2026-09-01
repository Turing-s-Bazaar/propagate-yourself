---
title: ML Training Recipe
description: Find ranked, implementable ML training recipes backed by papers, datasets, docs, and code.
section: Workflows
order: 6
---

The recipe workflow turns a training or fine-tuning goal into a ranked set of implementable recipes. It is designed for ML engineering questions where the useful answer is not just "what papers exist?" but "which dataset, method, hyperparameters, code path, and checks should I try first?"

The workflow borrows the useful idea from Hugging Face's open-source [`ml-intern`](https://github.com/huggingface/ml-intern) repo: make ML research outputs recipe-shaped and implementation-ready. Feynman keeps the implementation native to Pi prompts, bundled skills, and read-only Hub inspection tools rather than copying `ml-intern`'s runtime loop or frontend.

## Usage

From the REPL:

```
/recipe "fine-tune a small model for math reasoning"
```

From the CLI:

```bash
feynman recipe "fine-tune a small model for math reasoning"
```

You can use `/recipe` for tasks such as choosing an SFT dataset, reproducing a benchmark setup, selecting a practical training method, or turning a paper into an implementation plan.

## How it works

The workflow starts by writing a plan to `outputs/.plans/<slug>-recipe.md`, then continues automatically. It gathers evidence from papers, web sources, repositories, official docs, and Hugging Face Hub metadata.

For each candidate, Feynman links the reported result to the recipe that produced it: dataset, split/schema, method, hyperparameters, compute assumptions, benchmark, and implementation code. This result-to-recipe link is the core output. A paper that reports a strong result but does not expose usable data, code, or enough configuration detail is marked as a risk rather than treated as immediately runnable.

## Hugging Face grounding

When a candidate uses a Hugging Face dataset or repository, the researcher can inspect it directly:

- `hf_dataset_info` checks dataset metadata, tags, access status, card data, features, and splits.
- `hf_repo_files` lists files in model, dataset, and Space repos.
- `hf_repo_read_file` reads small text files such as dataset cards, configs, examples, and scripts.

These tools use public Hub endpoints by default and use `HF_TOKEN` or `HUGGINGFACE_HUB_TOKEN` when present for private or gated resources.

## Output format

The final artifact is written to `outputs/<slug>-recipe.md` with a provenance sidecar at `outputs/<slug>-recipe.provenance.md`.

The brief includes:

- **Recommendation** -- The one recipe to try first and why
- **Ranked recipe table** -- Candidate recipes with paper/source, result, dataset, method, hyperparameters, compute, code/docs, and verification status
- **Dataset notes** -- Schema, splits, size, license/access constraints, and unchecked gaps
- **Implementation plan** -- Minimal steps to run the top recipe
- **Known gaps** -- Missing code, inaccessible data, unclear hyperparameters, benchmark mismatch, or unverified assumptions
- **Sources** -- URLs for every paper, repo, dataset, and doc page used

Feynman uses `verified`, `unverified`, `blocked`, and `inferred` labels precisely. It should not call a recipe state of the art, replicated, or production-ready unless the checks actually support that claim.
