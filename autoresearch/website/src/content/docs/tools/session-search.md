---
title: Session Search
description: Search prior Feynman session transcripts to recall past research.
section: Tools
order: 4
---

The optional session search package recovers prior Feynman work from stored session transcripts. Feynman persists sessions to disk, and the package adds indexed search over past research, findings, and generated artifacts when it is installed on a supported runtime.

## Installation

Session search is an optional package. Install it with:

```bash
feynman packages install session-search
```

It is available through Node.js 22.x while the upstream sqlite dependency remains native-bound. On newer Node majors, Feynman skips it instead of making first launch depend on a local C++ build toolchain.

Once installed and visible in the REPL, the `/search` slash command becomes available in future sessions. If `/search` is not visible, use the direct file search fallback below.

## Usage

Inside the REPL, invoke session search directly:

```
/search transformer scaling laws
```

Natural-language recall depends on the optional package being installed and loaded in the current Pi session. When it is not visible, search the session files directly:

```bash
rg -n "protein folding" ~/.feynman/sessions
```

## What it searches

The optional package indexes the full contents of your session history:

- Full session transcripts including your prompts and Feynman's responses
- Tool outputs and agent results from workflows like deep research and literature review
- Generated artifacts such as drafts, reports, and comparison matrices
- Metadata like timestamps, topics, and workflow types

The search uses both keyword matching and semantic similarity to find relevant past work. Results include the session ID, timestamp, and relevant excerpts so you can identify which session contains the information you need.

## When to use it

Session search is valuable when the optional package is installed and you want to pick up a previous research thread without rerunning an expensive workflow, find specific findings or citations from a past deep research session, reference prior analysis in a new research context, or check what you have already investigated on a topic before launching a new round.

## How it works

The `@kaiserlich-dev/pi-session-search` package provides the underlying search and indexing. Sessions are stored in `~/.feynman/sessions/` by default (configurable with `--session-dir`). The index is built incrementally as new sessions complete.
