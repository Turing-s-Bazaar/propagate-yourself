---
title: Research Review
description: Run an internal research critique with severity-graded feedback.
section: Workflows
order: 3
---

The review workflow runs an internal research critique of a paper, draft, or research artifact. It is not an external peer review or publication decision; it identifies likely methodology, evidence, clarity, and reproducibility issues before you trust or revise the work.

## Usage

From the REPL:

```
/review arxiv:2401.12345
```

```
/review ~/papers/my-draft.pdf
```

From the CLI:

```bash
feynman review arxiv:2401.12345
feynman review my-draft.md
```

You can pass an arXiv ID, a URL, or a local file path. For arXiv papers, Feynman fetches the source paper directly when the paper tools are available. For local PDFs, Feynman attempts document extraction and records blocked checks if extraction fails.

## How it works

The review workflow first writes a plan to `outputs/.plans/<slug>-review-plan.md`, then continues immediately into evidence gathering and final review generation. It does not stop to ask for a "proceed" response unless you explicitly asked to review the plan first.

The workflow reads or fetches the artifact, records evidence notes in `outputs/.drafts/<slug>-review-evidence.md`, and then writes exactly one final review to `outputs/<slug>-review.md`. For larger artifacts it can delegate evidence gathering or review synthesis to Feynman's bundled research agents; for smaller artifacts it performs the review directly to avoid unnecessary orchestration.

The reviewer examines the paper's claims, checks whether the methodology supports the conclusions, evaluates the experimental design for potential confounds, and assesses the clarity and completeness of the writing.

Each piece of feedback is assigned a severity level: **critical** (fundamental issues that undermine the paper's validity), **major** (significant problems that should be addressed), **minor** (suggestions for improvement), or **nit** (stylistic or formatting issues). This grading helps you triage feedback and focus on what matters most.

The reviewer also produces a summary assessment with a revision priority and a confidence score indicating how certain it is about each finding. When the reviewer identifies a claim that cannot be verified from the paper alone, it flags it as needing additional evidence.

If a PDF cannot be parsed or an external source is unavailable, the workflow still writes the final review artifact and marks the affected checks as blocked rather than silently ending after a plan.

## Output format

The review output includes:

- **Summary Assessment** -- Overall evaluation and revision priority
- **Strengths** -- What the paper does well
- **Critical Issues** -- Fundamental problems that need to be addressed
- **Major Issues** -- Significant concerns with suggested fixes
- **Minor Issues** -- Smaller improvements and suggestions
- **Inline Annotations** -- Specific comments tied to sections of the document

## Customization

You can focus the review by specifying what to examine: "focus on the statistical methodology" or "check the claims in Section 4 against the experimental results." The reviewer adapts its analysis to your priorities while still performing a baseline check of the full document.
