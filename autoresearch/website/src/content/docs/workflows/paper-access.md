---
title: Paper Access
description: Resolve legal full-text access candidates for one paper.
section: Workflows
order: 3
---

Use `feynman paper` when you already have a DOI, arXiv ID, OpenAlex ID, PMID, PMCID, or title and need to find the best legal access route.

## Usage

```bash
feynman paper 10.7717/peerj.4375
feynman paper pmid:29456894
feynman paper 2309.08600 --fetch-full-text
feynman paper "The state of OA" --json
```

## Output

Each run writes:

- `<slug>-paper-access.md` -- readable access report with identifiers, candidates, and limits
- `<slug>-paper-access.json` -- machine-readable paper metadata and access candidates

The resolver uses OpenAlex primary, best open-access, and all reported location metadata, DOI links, arXiv/alphaXiv for arXiv papers, and Europe PMC full-text XML for deposited open-access PMC articles. It records PDF links as access candidates, but does not parse arbitrary PDFs or bypass paywalls. When `--fetch-full-text` succeeds, artifacts record only status, source, length, and section metadata; raw full-text bodies are not written.
