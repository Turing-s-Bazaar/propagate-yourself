---
title: Draft Writing
description: Generate a paper-style draft from research findings and session context.
section: Workflows
order: 8
---

The draft writing workflow generates structured academic-style documents from your research findings. It uses the writer agent to produce well-organized prose with proper citations, sections, and formatting suitable for papers, technical reports, or internal research notes.

## Usage

From the REPL:

```
/draft A survey of retrieval-augmented generation techniques
```

```
/draft --from-session
```

From the CLI:

```bash
feynman draft "A survey of retrieval-augmented generation techniques"
```

When used with `--from-session`, the writer draws from the current session's research findings, making it a natural follow-up to a deep research or literature review workflow.

## How it works

The draft workflow leverages the writer agent, which specializes in producing structured academic prose. When given a topic, it first consults the researcher agents to gather source material, then organizes the findings into a coherent document with proper narrative flow.

When working from existing session context (after a deep research or literature review), the writer skips the research phase and works directly with the findings already gathered. This produces a more focused draft because the source material has already been vetted and organized.

The writer pays attention to academic conventions: claims are attributed to their sources with inline citations, methodology sections describe procedures precisely, and limitations are discussed honestly. The draft includes placeholder sections for any content the writer cannot generate from available sources, clearly marking what needs human input.

Drafts follow Feynman's system-wide provenance rules: unsupported results, figures, images, tables, or benchmark data should become clearly labeled gaps or TODOs, not plausible-looking claims.

## Output format

The draft follows standard academic structure:

- **Abstract** -- Concise summary of the document's scope and findings
- **Introduction** -- Motivation, context, and contribution statement
- **Body Sections** -- Organized by topic with subsections as needed
- **Discussion** -- Interpretation of findings and implications
- **Limitations** -- Honest assessment of scope and gaps
- **References** -- Complete bibliography in a consistent citation format

## Preview and iteration

After generating the draft, use `/preview` when a preview command is visible, or render it with shell tools such as `pandoc`, to review HTML/PDF formatting, math rendering, and typography. You can iterate on the draft by asking Feynman to revise specific sections, add more detail, or restructure the argument.
