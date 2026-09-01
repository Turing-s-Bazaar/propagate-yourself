---
title: Reviewer
description: The reviewer agent evaluates research artifacts with severity-graded critique.
section: Agents
order: 2
---

The reviewer agent evaluates documents, papers, and research artifacts with internal research-review rigor. It does not claim external reviewer authority or venue acceptance; it produces actionable research critique covering methodology, claims, writing quality, and reproducibility.

## What it does

For review tasks, the reviewer reads the available artifact and evaluates it against standard academic criteria. It checks whether claims are supported by the presented evidence, whether the methodology is sound and described in sufficient detail, whether the experimental design controls for confounds, and whether the writing is clear and complete.

Each piece of feedback is assigned a severity level. **Critical** issues are fundamental problems that undermine the document's validity, such as a statistical test applied incorrectly or a conclusion not supported by the data. **Major** issues are significant problems that should be addressed, like missing baselines or inadequate ablation studies. **Minor** issues are suggestions for improvement, and **nits** are stylistic or formatting comments.

## Evaluation criteria

The reviewer evaluates documents across several dimensions:

- **Claims vs. Evidence** -- Does the evidence presented actually support the claims made?
- **Methodology** -- Is the approach sound? Are there confounds or biases?
- **Experimental Design** -- Are baselines appropriate? Are ablations sufficient?
- **Reproducibility** -- Could someone replicate this work from the description alone?
- **Writing Quality** -- Is the paper clear, well-organized, and free of ambiguity?
- **Completeness** -- Are limitations discussed? Is related work adequately covered?

## Confidence scoring

The reviewer provides a confidence score for each finding, indicating how certain it is about the assessment. High-confidence findings are clear-cut issues (a statistical error, a missing citation). Lower-confidence findings are judgment calls (whether a baseline is sufficient, whether more ablations are needed) where reasonable reviewers might disagree.

## Used by

The reviewer agent is the primary agent in the `/review` workflow. It also contributes to `/audit` (evaluating paper claims against code) and `/compare` (assessing the strength of evidence across sources). Workflow prompts call it through Pi's `subagent` tool when an adversarial review pass adds value.
