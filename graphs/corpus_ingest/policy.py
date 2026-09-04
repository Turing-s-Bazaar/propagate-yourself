from __future__ import annotations

import re

from .embed import policy_alignment
from .handwritten import load_handwritten_policy

TOKEN_RE = re.compile(r"[a-z0-9]+")
STOP_WORDS = {
    "a",
    "an",
    "and",
    "for",
    "from",
    "in",
    "of",
    "on",
    "or",
    "the",
    "to",
    "with",
}


def _tokens(value: str) -> set[str]:
    return {
        token for token in TOKEN_RE.findall(value.lower()) if token not in STOP_WORDS
    }


def _paper_text(paper: dict) -> str:
    title = paper.get("title") or ""
    abstract = paper.get("abstract") or ""
    return f"{title} {abstract}".strip()


def rank_papers(
    problem: str,
    papers: list[dict],
    paper_count: int = 5,
    *,
    embedder=None,
    policy: dict | None = None,
) -> list[dict]:
    query = _tokens(problem)
    ranked = []
    for paper in papers:
        title_tokens = _tokens(paper["title"])
        relevance = len(query & title_tokens) / len(query) if query else 0.0
        taste = float(paper["taste_score"])
        base = 100 * (0.75 * relevance + 0.25 * taste)
        signals = {"title_relevance": round(relevance, 6), "taste": taste}
        if embedder is not None and policy is not None:
            alignment = policy_alignment(embedder.encode, policy, _paper_text(paper))
            score = 0.7 * base + 0.3 * (100 * alignment)
            signals["policy_alignment"] = round(alignment, 6)
        else:
            score = base
        ranked.append({**paper, "score": round(score, 3), "signals": signals})
    ranked.sort(key=lambda paper: (-paper["score"], str(paper["paper_id"])))
    return ranked[: max(1, paper_count)]


def _fraction(selected: list[dict], values: set[str]) -> float:
    if not selected:
        return 0.0
    return sum(str(paper["paper_id"]) in values for paper in selected) / len(selected)


def compute_urges(selected: list[dict], state: dict) -> dict:
    read_ids = {str(value) for value in state.get("read_paper_ids") or []}
    noted_ids = {str(value) for value in state.get("noted_paper_ids") or []}
    read_coverage = _fraction(selected, read_ids)
    note_coverage = _fraction(selected, noted_ids)
    hypotheses = state.get("hypotheses") or []
    experiments = state.get("experiments") or []
    hypothesis_ready = float(
        any(item.get("status") == "testable" for item in hypotheses)
    )
    runnable = float(any(item.get("status") == "runnable" for item in experiments))
    result_coverage = (
        sum(
            bool(item.get("result_recorded"))
            or item.get("status") in {"completed", "failed"}
            for item in experiments
        )
        / len(experiments)
        if experiments
        else 0.0
    )
    raw = {
        "read": 0.05 + 0.75 * (1.0 - read_coverage),
        "write": 0.05 + 0.65 * max(note_coverage, result_coverage),
        "execute": 0.05 + hypothesis_ready * (0.55 * runnable + 0.40 * read_coverage),
    }
    total = sum(raw.values())
    return {
        "urges": {key: round(value / total, 6) for key, value in raw.items()},
        "raw_urges": {key: round(value, 6) for key, value in raw.items()},
    }


def run_policy(
    problem: str,
    papers: list[dict],
    state: dict | None = None,
    paper_count: int = 5,
    *,
    embedder=None,
) -> dict:
    policy = load_handwritten_policy() if embedder is not None else None
    selected = rank_papers(
        problem, papers, paper_count, embedder=embedder, policy=policy
    )
    return {
        "schema_version": "rwx.policy.v0",
        "problem": problem,
        "papers": selected,
        **compute_urges(selected, state or {}),
        "policy_version": (
            "specter-taste-v0" if embedder is not None else "title-taste-rules-v0"
        ),
    }
