from __future__ import annotations

import numpy as np

MODEL_NAME = "allenai/specter2"


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    a = a / (np.linalg.norm(a) + 1e-12)
    b = b / (np.linalg.norm(b) + 1e-12)
    return float(a @ b)


def policy_alignment(encode, policy: dict, text: str) -> float:
    """Score a single text against the handwritten policy.

    `encode` is a callable mapping list[str] -> np.ndarray of embeddings.
    The result is a weighted cosine of heuristics (by their `weight`) blended
    with the mean cosine of the mental models.
    """
    heuristics = policy.get("heuristics") or []
    mental_models = policy.get("mental_models") or []
    if not text.strip():
        return 0.0
    if not heuristics and not mental_models:
        return 0.5

    n_h = len(heuristics)
    texts = [h["text"] for h in heuristics] + [m["text"] for m in mental_models]
    vecs = np.asarray(encode(texts), dtype=np.float32)
    vec = np.asarray(encode([text]), dtype=np.float32)[0]

    heuristic_align = 0.0
    if n_h:
        weights = [float(h.get("weight", 0.5)) for h in heuristics]
        total = sum(weights)
        if total > 0:
            heuristic_align = (
                sum(w * cosine(v, vec) for w, v in zip(weights, vecs[:n_h])) / total
            )

    model_align = 0.0
    if mental_models:
        model_align = float(np.mean([cosine(v, vec) for v in vecs[n_h:]]))

    if n_h and mental_models:
        return 0.7 * heuristic_align + 0.3 * model_align
    if n_h:
        return heuristic_align
    return model_align


class SentenceEmbedder:
    """Lazy SPECTER2 wrapper so importing does not require the model."""

    def __init__(self, model_name: str = MODEL_NAME):
        self.model_name = model_name
        self._model = None

    def _load(self):
        if self._model is None:
            from sentence_transformers import SentenceTransformer

            self._model = SentenceTransformer(self.model_name)
        return self._model

    def encode(self, texts) -> np.ndarray:
        model = self._load()
        return np.asarray(
            model.encode(
                list(texts),
                convert_to_numpy=True,
                normalize_embeddings=True,
            ),
            dtype=np.float32,
        )
