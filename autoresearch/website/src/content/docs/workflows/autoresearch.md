---
title: Autoresearch
description: Start a bounded research experiment loop that iteratively optimizes against a benchmark.
section: Workflows
order: 9
---

The autoresearch workflow runs a bounded research experiment loop that iteratively proposes changes, runs a benchmark, records evidence, and decides whether to keep or revert each change. It is designed for model, retrieval, prompt, architecture, or dataset experiments where the feedback signal is explicit.

## Usage

From the REPL:

```
/autoresearch Optimize prompt engineering strategies for math reasoning on GSM8K
```

From the CLI:

```bash
feynman autoresearch "Optimize prompt engineering strategies for math reasoning on GSM8K"
```

Autoresearch runs in the active Feynman session after you confirm the benchmark, metric, environment, files in scope, and iteration limit.

## How it works

The workflow begins by analyzing the research goal and designing an initial experiment plan. It then enters an iterative loop:

1. **Hypothesis** -- The agent proposes a hypothesis or modification based on current results
2. **Experiment** -- It designs and executes an experiment to test the hypothesis
3. **Analysis** -- Results are analyzed and compared against prior iterations
4. **Decision** -- The agent decides whether to continue the current direction, try a variation, or pivot to a new approach

Each iteration builds on the previous ones. The agent maintains a running log of what has been tried, what worked, what failed, and what the current best result is. This prevents repeating failed approaches and ensures the search progresses efficiently.

## Monitoring and control

The loop writes `autoresearch.md`, `autoresearch.jsonl`, and benchmark output in the active workspace. Use those files, plus `CHANGELOG.md` milestone entries, to inspect the current best result, failed hypotheses, and next step.

## Output format

Autoresearch produces a running experiment log that includes:

- **Experiment History** -- What was tried in each iteration with parameters and results
- **Best Configuration** -- The best-performing setup found so far
- **Ablation Results** -- Which factors mattered most based on the experiments run
- **Recommendations** -- Suggested next steps based on observed trends

## When to use it

Use `/autoresearch` for research tasks that benefit from iterative exploration: hyperparameter optimization, prompt-strategy evaluation, architecture search, retrieval tuning, or dataset/benchmark ablations where the search space is large and the feedback signal is clear. It is not the right tool for answering a specific question (use `/deepresearch` for that) and it is not a generic code-optimization loop.
