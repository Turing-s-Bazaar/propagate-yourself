export function buildProjectAgentsTemplate(): string {
	return `# Feynman Project Guide

This file is read automatically at startup. It is the durable project memory for Feynman.

## Project Overview
- State the research question, target artifact, target venue, and key datasets or benchmarks here.

## AI Research Context
- Problem statement:
- Core hypothesis:
- Closest prior work:
- Required baselines:
- Required ablations:
- Primary metrics:
- Datasets / benchmarks:

## Ground Rules
- Do not modify raw data in \`Data/Raw/\` or equivalent raw-data folders.
- Read first, act second: inspect project structure and existing notes before making changes.
- Prefer durable artifacts in \`notes/\`, \`outputs/\`, \`experiments/\`, and \`papers/\`.
- Keep strong claims source-grounded. Include direct URLs in final writeups.

## Current Status
- Replace this section with the latest project status, known issues, and next steps.

## Task Ledger
- Track concrete tasks with IDs, owner, status, and output path.
- Mark tasks as \`todo\`, \`in_progress\`, \`done\`, \`blocked\`, or \`superseded\`.
- Do not silently merge or skip tasks; record the decision here.

## Verification Gates
- List the checks that must pass before delivery.
- For each critical claim, figure, or metric, record how it will be verified and where the raw artifact lives.
- Do not use words like \`verified\`, \`confirmed\`, or \`reproduced\` unless the underlying check actually ran.

## Honesty Contract
- Separate direct observations from inferences.
- If something is uncertain, say so explicitly.
- If a result looks cleaner than expected, assume it needs another check before it goes into the final artifact.

## Session Logging
- Use \`/log\` at the end of meaningful sessions to write a durable session note into \`notes/session-logs/\`.

## Review Readiness
- Known reviewer concerns:
- Missing experiments:
- Missing writing or framing work:
`;
}

export function buildSessionLogsReadme(): string {
	return `# Session Logs

Use \`/log\` to write one durable note per meaningful Feynman session.

Recommended contents:
- what was done
- strongest findings
- artifacts written
- unresolved questions
- next steps
`;
}
