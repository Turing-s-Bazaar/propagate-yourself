from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

import numpy as np

_STOP = {
    "the",
    "and",
    "for",
    "are",
    "but",
    "not",
    "you",
    "all",
    "can",
    "had",
    "her",
    "was",
    "one",
    "our",
    "out",
    "has",
    "have",
    "been",
    "some",
    "them",
    "than",
    "its",
    "over",
    "such",
    "that",
    "this",
    "with",
    "will",
    "which",
    "what",
    "when",
    "where",
    "how",
    "about",
    "into",
    "through",
    "during",
    "before",
    "after",
    "above",
    "below",
    "between",
    "under",
    "because",
    "just",
    "also",
    "very",
    "more",
    "most",
    "few",
    "then",
    "own",
    "same",
    "here",
    "there",
    "please",
    "via",
    "from",
    "they",
    "their",
    "would",
    "could",
    "should",
    "may",
    "might",
    "these",
    "those",
    "each",
    "every",
    "both",
}
_TOKEN = re.compile(r"[a-z0-9]{3,}")


def _tokens(text: str) -> list[str]:
    return [token for token in _TOKEN.findall(text.lower()) if token not in _STOP]


def assign_clusters(
    embeddings: np.ndarray,
    *,
    min_cluster_size: int = 3,
    min_samples: int = 3,
    n_components: int = 50,
) -> np.ndarray:
    n = embeddings.shape[0]
    if n < 2:
        return np.full(n, -1, dtype=int)

    from sklearn.cluster import HDBSCAN
    from sklearn.decomposition import PCA

    comps = min(n_components, n, embeddings.shape[1] if embeddings.ndim > 1 else 1)
    reduced = PCA(n_components=comps, random_state=0).fit_transform(embeddings)
    size = max(1, min(min_cluster_size, n))
    labels = HDBSCAN(
        min_cluster_size=size,
        min_samples=min(min_samples, size),
        metric="euclidean",
        copy=True,
    ).fit_predict(reduced)
    return np.asarray(labels, dtype=int)


def project_2d(embeddings: np.ndarray) -> np.ndarray:
    if embeddings.shape[0] < 2:
        return np.zeros((embeddings.shape[0], 2))
    from sklearn.decomposition import PCA

    return PCA(n_components=2, random_state=0).fit_transform(embeddings)


def cluster_labels_text(papers: list[dict], labels: np.ndarray) -> dict:
    grouped: dict[int, list[dict]] = {}
    for paper, label in zip(papers, labels):
        grouped.setdefault(int(label), []).append(paper)

    summary = {}
    for label, members in grouped.items():
        if label == -1:
            continue
        words = Counter()
        for member in members:
            words.update(_tokens(member.get("title", "")))
        summary[str(label)] = {
            "size": len(members),
            "label": ", ".join(word for word, _ in words.most_common(4)),
            "members": [
                {"title": member.get("title"), "url": member.get("url")}
                for member in members
            ],
        }
    return summary


def write_observability(
    out_dir: str | Path,
    papers: list[dict],
    embeddings: np.ndarray,
    *,
    labels: np.ndarray | None = None,
) -> dict:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    cluster_labels = labels if labels is not None else assign_clusters(embeddings)
    summary = cluster_labels_text(papers, cluster_labels)
    noise = int((cluster_labels == -1).sum())

    (out_dir / "clusters.json").write_text(
        json.dumps({"clusters": summary, "noise": noise}, indent=2)
    )

    lines = [
        "# Cluster summary",
        "",
        f"clusters: {len(summary)}",
        f"noise: {noise}",
        "",
    ]
    for label, info in sorted(summary.items(), key=lambda item: -item[1]["size"]):
        lines.append(f"## cluster {label} ({info['size']} papers): {info['label']}")
        for member in info["members"]:
            lines.append(f"- [{member['title']}]({member['url']})")
        lines.append("")
    (out_dir / "cluster-summary.md").write_text("\n".join(lines))

    _write_scatter(out_dir / "clusters-2d.png", project_2d(embeddings), cluster_labels)

    return {"clusters": summary, "noise": noise}


def _write_scatter(path: Path, projected: np.ndarray, labels: np.ndarray) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(8, 6))
    for label in sorted(set(labels.tolist())):
        mask = labels == label
        name = "noise" if label == -1 else f"cluster {label}"
        kwargs = {"c": "#999999"} if label == -1 else {}
        ax.scatter(
            projected[mask, 0],
            projected[mask, 1],
            s=40,
            alpha=0.8,
            label=name,
            **kwargs,
        )
    ax.set_title("PCA projection of paper embeddings")
    ax.legend()
    fig.savefig(path, dpi=120)
    plt.close(fig)
