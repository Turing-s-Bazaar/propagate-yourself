from __future__ import annotations

from .cluster import assign_clusters, cluster_labels_text, write_observability
from .handwritten import load_handwritten_policy
from .policy import compute_urges, rank_papers


def _paper_text(paper: dict) -> str:
    title = paper.get("title") or ""
    abstract = paper.get("abstract") or ""
    return f"{title} {abstract}".strip()


def run_taste_graph(
    problem: str,
    papers: list[dict],
    state: dict | None = None,
    paper_count: int = 5,
    *,
    embedder=None,
    out_dir: str | None = None,
) -> dict:
    """Full pipeline: policy load -> embed + cluster -> top-k -> RWX urges."""
    policy = load_handwritten_policy()

    clusters = None
    noise = None
    tagged = papers
    if embedder is not None and papers:
        embeddings = embedder.encode([_paper_text(paper) for paper in papers])
        labels = assign_clusters(embeddings)
        if out_dir:
            write_observability(out_dir, papers, embeddings, labels=labels)
        clusters = cluster_labels_text(papers, labels)
        noise = int((labels == -1).sum())
        tagged = [
            {**paper, "cluster": int(label)} for paper, label in zip(papers, labels)
        ]

    selected = rank_papers(
        problem, tagged, paper_count, embedder=embedder, policy=policy
    )

    return {
        "schema_version": "rwx.policy.v0",
        "problem": problem,
        "papers": selected,
        "clusters": clusters,
        "noise": noise,
        **compute_urges(selected, state or {}),
        "policy_version": (
            "specter-taste-v0" if embedder is not None else "title-taste-rules-v0"
        ),
    }
