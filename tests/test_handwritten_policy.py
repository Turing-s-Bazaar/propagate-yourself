from __future__ import annotations

import unittest

from graphs.corpus_ingest.handwritten import (
    heuristic_texts,
    heuristic_weights,
    load_handwritten_policy,
    mental_model_texts,
)


class HandwrittenPolicyTests(unittest.TestCase):
    def test_loads_heuristics_and_mental_models(self) -> None:
        policy = load_handwritten_policy()
        self.assertGreater(len(policy["heuristics"]), 0)
        self.assertGreater(len(policy["mental_models"]), 0)

    def test_all_heuristics_have_id_text_weight(self) -> None:
        policy = load_handwritten_policy()
        for item in policy["heuristics"]:
            self.assertIn("id", item)
            self.assertIn("text", item)
            self.assertIn("weight", item)
            self.assertGreaterEqual(float(item["weight"]), 0.0)
            self.assertLessEqual(float(item["weight"]), 1.0)

    def test_ids_are_unique(self) -> None:
        policy = load_handwritten_policy()
        ids = [item["id"] for item in policy["heuristics"]]
        self.assertEqual(len(ids), len(set(ids)))

    def test_weights_match_heuristic_count(self) -> None:
        policy = load_handwritten_policy()
        self.assertEqual(len(heuristic_weights(policy)), len(policy["heuristics"]))
        self.assertEqual(len(heuristic_texts(policy)), len(policy["heuristics"]))
        self.assertEqual(len(mental_model_texts(policy)), len(policy["mental_models"]))


if __name__ == "__main__":
    unittest.main()
