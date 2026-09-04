from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy as np

from graphs.corpus_ingest.cluster import assign_clusters
from graphs.corpus_ingest.embed import policy_alignment
from graphs.corpus_ingest.pipeline import run_taste_graph
from graphs.corpus_ingest.policy import rank_papers


class BowEncoder:
    VOCAB = ("ultrasound", "simulation", "vision", "cortex", "neuro")

    def encode(self, texts):
        vecs = []
        for text in texts:
            vector = np.zeros(len(self.VOCAB), dtype=np.float32)
            for index, word in enumerate(self.VOCAB):
                if word in text.lower():
                    vector[index] = 1.0
            vecs.append(vector)
        return np.array(vecs, dtype=np.float32)


class EmbedTests(unittest.TestCase):
    def test_policy_alignment_rewards_matching_tokens(self) -> None:
        encoder = BowEncoder()
        policy = {
            "heuristics": [{"text": "prefer ultrasound simulation", "weight": 0.9}],
            "mental_models": [],
        }
        match = policy_alignment(encoder.encode, policy, "ultrasound simulation paper")
        miss = policy_alignment(encoder.encode, policy, "vision cortex paper")
        self.assertGreater(match, miss)

    def test_policy_alignment_empty_policy_is_neutral(self) -> None:
        encoder = BowEncoder()
        self.assertEqual(
            policy_alignment(
                encoder.encode, {"heuristics": [], "mental_models": []}, "x"
            ),
            0.5,
        )


class ClusterTests(unittest.TestCase):
    def test_assign_clusters_splits_two_blobs(self) -> None:
        embeddings = np.vstack(
            [
                np.array([[i * 0.01, 0.0, 0.0] for i in range(5)], dtype=np.float32),
                np.array(
                    [[100.0 + i * 0.01, 0.0, 0.0] for i in range(5)], dtype=np.float32
                ),
            ]
        )
        labels = assign_clusters(embeddings, min_cluster_size=3)
        self.assertEqual(labels.shape[0], 10)
        self.assertEqual(len(set(labels.tolist())), 2)

    def test_assign_clusters_handles_small_input(self) -> None:
        labels = assign_clusters(np.array([[1.0, 0.0]], dtype=np.float32))
        self.assertEqual(labels.tolist(), [-1])


class PolicyEmbedTests(unittest.TestCase):
    def test_embedder_breaks_ties_using_policy(self) -> None:
        papers = [
            {
                "paper_id": 1,
                "doi": "10.1/ultrasound",
                "title": "Ultrasound simulation",
                "url": "https://doi.org/10.1/ultrasound",
                "taste_score": 1.0,
            },
            {
                "paper_id": 2,
                "doi": "10.1/vision",
                "title": "Vision cortex",
                "url": "https://doi.org/10.1/vision",
                "taste_score": 1.0,
            },
        ]
        policy = {
            "heuristics": [{"text": "prefer ultrasound simulation", "weight": 0.9}],
            "mental_models": [],
        }
        ranked = rank_papers("", papers, embedder=BowEncoder(), policy=policy)
        self.assertEqual(ranked[0]["paper_id"], 1)
        self.assertIn("policy_alignment", ranked[0]["signals"])


class PipelineTests(unittest.TestCase):
    def test_run_taste_graph_writes_observability(self) -> None:
        papers = [
            {
                "paper_id": 1,
                "doi": "10.1/ultrasound",
                "title": "Ultrasound simulation",
                "url": "https://doi.org/10.1/ultrasound",
                "taste_score": 1.0,
            },
            {
                "paper_id": 2,
                "doi": "10.1/vision",
                "title": "Vision cortex",
                "url": "https://doi.org/10.1/vision",
                "taste_score": 1.0,
            },
        ]
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / "obs"
            result = run_taste_graph(
                "focused ultrasound simulation",
                papers,
                embedder=BowEncoder(),
                out_dir=str(out),
            )
            self.assertIn("clusters", result)
            self.assertIn("noise", result)
            self.assertTrue((out / "clusters.json").exists())
            self.assertTrue((out / "cluster-summary.md").exists())
            self.assertTrue((out / "clusters-2d.png").exists())
            self.assertIn("cluster", result["papers"][0])

    def test_run_taste_graph_without_embedder_matches_policy(self) -> None:
        papers = [
            {
                "paper_id": 1,
                "doi": "10.1/ultrasound",
                "title": "Fast transcranial focused ultrasound simulation",
                "url": "https://doi.org/10.1/ultrasound",
                "taste_score": 1.0,
            },
            {
                "paper_id": 2,
                "doi": "10.1/vision",
                "title": "Visual cortical coding",
                "url": "https://doi.org/10.1/vision",
                "taste_score": 1.0,
            },
        ]
        result = run_taste_graph("focused ultrasound simulation", papers)
        self.assertEqual(result["papers"][0]["paper_id"], 1)
        self.assertEqual(result["clusters"], None)
        self.assertEqual(result["noise"], None)
        self.assertAlmostEqual(sum(result["urges"].values()), 1.0, places=5)


if __name__ == "__main__":
    unittest.main()
