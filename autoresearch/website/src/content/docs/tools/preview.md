---
title: Preview
description: Preview generated research artifacts when preview commands are available.
section: Tools
order: 5
---

Preview support is optional. When a live preview package exposes `/preview`, Feynman can render generated artifacts as HTML or PDF documents and open them in your browser or PDF viewer. When that command is unavailable, use `feynman setup preview` to verify rendering dependencies and use shell tools such as `pandoc` or your browser directly.

## Usage

Inside the REPL, preview the most recent artifact when `/preview` is visible:

```
/preview
```

You can also preview a specific file when the command exists:

```
/preview outputs/scaling-laws-brief.md
```

## Requirements

Markdown-to-HTML and Markdown-to-PDF rendering requires `pandoc`. Verify or install the dependency with:

```bash
feynman setup preview
```

On macOS with Homebrew, the setup command attempts to install pandoc automatically. On Linux, it checks for pandoc in your package manager. If the automatic install does not work, install pandoc manually from [pandoc.org](https://pandoc.org/installing.html) and rerun `feynman setup preview` to verify.

## Supported formats

When preview commands are available, they handle three output formats:

- **Markdown** -- Rendered as HTML with KaTeX-backed math support, syntax-highlighted code blocks, and clean typography when the live preview command supports those features
- **HTML** -- Opened directly in your default browser with no conversion step
- **PDF** -- Generated via pandoc with LaTeX rendering, suitable for sharing or printing

## How it works

The rendering pipeline depends on the live preview command available in your Pi session. For Markdown files, it should convert to HTML or PDF with readable typography and rendered math equations. If no preview command is visible, run `pandoc input.md -o output.html` or `pandoc input.md -o output.pdf`, then open the result directly.

For documents with heavy math notation (common in research drafts), the preview path is intended to render common inline math (`$...$`), display math (`$$...$$`), tables, citation lists, and nested blockquotes when the live preview command or shell renderer supports them.

## Customization

Preview output should preserve research-document structure such as heading hierarchy, code blocks, tables, math equations, citation lists, and blockquotes. Exact styling depends on the preview package or shell renderer used.
