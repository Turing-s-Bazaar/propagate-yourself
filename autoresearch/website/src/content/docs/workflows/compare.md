---
title: Source Comparison
description: Compare multiple sources and produce an agreement/disagreement matrix.
section: Workflows
order: 7
---

The source comparison workflow analyzes multiple papers, articles, or documents side by side and produces a structured matrix showing where they agree, disagree, and differ in methodology. It is useful for understanding conflicting results, evaluating competing approaches, and identifying which claims have broad support versus limited evidence.

## Usage

From the REPL:

```
/compare "GPT-4 vs Claude vs Gemini on reasoning benchmarks"
```

```
/compare arxiv:2401.12345 arxiv:2402.67890 arxiv:2403.11111
```

From the CLI:

```bash
feynman compare "topic or list of sources"
```

You can provide a topic and let Feynman find the sources, or list specific papers and documents for a targeted comparison.

## How it works

The comparison workflow begins by identifying or retrieving the sources to compare. If you provide a topic, the researcher agents find the most relevant and contrasting papers. If you provide specific IDs or files, they are used directly.

Each source is analyzed independently first: the researcher agents extract claims, results, methodology, and limitations from each document. Then the comparison engine aligns claims across sources -- identifying where two papers make the same claim (agreement), where they report contradictory results (disagreement), and where they measure different things entirely (non-overlapping scope).

The alignment step handles the nuance that papers often measure slightly different quantities or use different evaluation protocols. The comparison explicitly notes when an apparent disagreement might be explained by methodological differences rather than genuine conflicting results.

## Output format

The comparison produces:

- **Source Summaries** -- One-paragraph summary of each source's key contributions
- **Agreement Matrix** -- Claims supported by multiple sources with citation evidence
- **Disagreement Matrix** -- Conflicting claims with analysis of why sources diverge
- **Methodology Differences** -- How the sources differ in approach, data, and evaluation
- **Synthesis** -- An overall assessment of which claims are well-supported and which remain contested

## When to use it

Use `/compare` when you encounter contradictory results in the literature, when evaluating competing approaches to the same problem, or when you need to understand how different research groups frame the same topic. It is also useful for writing related work sections where you need to accurately characterize the state of debate.
