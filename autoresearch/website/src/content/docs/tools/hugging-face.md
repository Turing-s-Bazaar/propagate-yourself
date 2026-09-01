---
title: Hugging Face Hub
description: Inspect Hugging Face datasets and repository files during research workflows.
section: Tools
order: 3
---

Feynman includes read-only Hugging Face Hub tools for grounding ML recipes and replication plans. They help the researcher verify whether a dataset or repo actually exposes the files, splits, schema, and card metadata needed for implementation.

These tools are grounded in Hugging Face's public [Hub API endpoint docs](https://huggingface.co/docs/hub/api). Authentication follows the `HF_TOKEN` environment variable documented by [`huggingface_hub`](https://huggingface.co/docs/huggingface_hub/main/en/package_reference/environment_variables); Feynman also accepts `HUGGINGFACE_HUB_TOKEN` for compatibility with existing shells.

## Authentication

Public Hub resources work without configuration. For private or gated resources, set an access token in your shell before launching Feynman:

```bash
export HF_TOKEN=hf_...
```

Feynman also checks `HUGGINGFACE_HUB_TOKEN`. The tools send whichever token is present with Hub requests.

## Tools

The researcher agent can use these tools automatically:

| Tool | Purpose |
| --- | --- |
| `hf_dataset_info` | Inspect dataset metadata, tags, access status, card data, features, splits, downloads, likes, and sibling files |
| `hf_repo_files` | List files in a model, dataset, or Space repository before reading anything large |
| `hf_repo_read_file` | Read small text files from Hub repos, such as `README.md`, configs, examples, and scripts |

The file reader truncates output by default and is intended for text files only. It is not a weight downloader or dataset bulk reader. It refuses obvious model weight files, archives, and dataset shards such as `.safetensors`, `.bin`, `.gguf`, `.parquet`, `.zip`, and `.tar` before download.

## Where it is used

The `/recipe` workflow uses Hugging Face Hub inspection to validate dataset availability and schema before recommending a training recipe. The `/replicate` workflow uses the same checks for ML-heavy papers and benchmark claims.

For example, a recipe using a chat SFT dataset should verify that the dataset has a `messages`, `text`, or prompt/completion-style schema before calling it usable. If Feynman cannot check that schema, the final artifact should mark the dataset as `unverified` or `blocked`.

## Boundaries

These tools are read-only. They do not create repos, upload files, start jobs, or manage private data. If an experiment needs execution on Hugging Face infrastructure, Feynman should record that as a follow-up implementation decision rather than silently attempting it.
