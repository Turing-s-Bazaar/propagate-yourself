---
title: Writer
description: The writer agent produces structured academic prose from research findings.
section: Agents
order: 3
---

The writer agent transforms raw research findings into structured, well-organized documents. It specializes in academic prose, producing papers, briefs, surveys, and reports with proper citations, section structure, and narrative flow.

## What it does

The writer takes source material -- findings from researcher agents, review feedback, comparison matrices -- and synthesizes it into a coherent document. It handles the difficult task of turning a collection of extracted claims and citations into prose that tells a clear story.

The writer understands academic conventions. Claims are attributed to their sources with inline citations. Methodology sections describe procedures with sufficient detail for reproduction. Results are presented with appropriate qualifiers. Limitations are discussed honestly rather than buried or omitted.

## Writing capabilities

The writer agent handles several document types:

- **Research Briefs** -- Concise summaries of a topic with key findings and citations, produced by the deep research workflow
- **Literature Reviews** -- Survey-style documents that map consensus, disagreement, and open questions across the field
- **Paper Drafts** -- Full academic papers with abstract, introduction, body sections, discussion, and references
- **Comparison Reports** -- Structured analyses of how multiple sources agree and differ
- **Summaries** -- Condensed versions of longer documents or multi-source findings

## Citation handling

The writer maintains citation integrity for research claims in the document. Strong factual claims are linked back to source material, and single-source claims are qualified so the reader can assess confidence. The final reference list includes works actually cited in the text.

## Iteration

The writer supports iterative refinement. After producing an initial draft, you can ask Feynman to revise specific sections, add more detail on a subtopic, restructure the argument, or adjust the tone and level of technical detail. Each revision preserves the citation links and document structure.

## Used by

The writer agent is used by `/deepresearch` (for the final brief), `/lit` (for the review document), `/draft` (as the primary agent), and `/compare` (for the comparison report). It usually runs near the end of a workflow, producing the final output from material gathered and evaluated earlier.
