---
title: Watch
description: Create a research watch baseline and optionally schedule follow-up checks.
section: Workflows
order: 10
---

The watch workflow creates a baseline survey for a topic and, when scheduling tools are visible in the current session, schedules follow-up checks. When scheduling is unavailable, it still writes the baseline and records the scheduling gap instead of pretending a recurring job exists.

## Usage

From the REPL:

```
/watch New developments in state space models for sequence modeling
```

From the CLI:

```bash
feynman watch "New developments in state space models for sequence modeling"
```

After creating a watch, Feynman writes the baseline artifact and the watch plan. Scheduled recurrence is created only when the `schedule_prompt` tool is visible.

## How it works

The workflow starts by writing a plan with the topic, monitored signals, meaningful-change criteria, and check frequency. It then runs a baseline sweep and saves the result under `outputs/`.

When `schedule_prompt` is available, the workflow schedules the same search plan for a recurring or delayed follow-up. When it is unavailable, the baseline marks scheduling as blocked and includes the exact refresh prompt to run later.

Each check searches AlphaXiv and the web for papers, articles, docs, releases, or code changes matching your topic. Results are compared against the baseline so genuinely new material is visible instead of mixed into old findings.

## Managing watches

Inspect current watch state:

```
/jobs
```

The `/jobs` command reports visible scheduler/process state when those tools are available and points to durable watch artifacts such as `outputs/.plans/<slug>.md` and `outputs/<slug>-baseline.md`.

## Output format

Each watch baseline or follow-up produces:

- **New Papers** -- Titles, authors, and one-paragraph summaries of newly discovered papers
- **New Articles** -- Relevant blog posts, documentation updates, or news articles
- **Relevance Notes** -- Why each item was flagged as relevant to your watch topic

## When to use it

Use `/watch` to preserve a repeatable monitoring plan for a fast-moving research area. It is useful for tracking new papers, specific research groups, code releases, or product surfaces related to an active research question.
