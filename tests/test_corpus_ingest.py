from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from graphs.corpus_ingest.corpus import PaperSeed, ingest_corpus, parse_markdown
from graphs.corpus_ingest.policy import run_policy


class FakeResolver:
    def resolve(self, seed: PaperSeed) -> tuple[dict | None, str | None]:
        title = seed.title_hint or "Resolved paper"
        doi = seed.doi or f"10.1234/{seed.source_lines[0]}"
        return {
            "doi": doi,
            "title": title,
            "url": f"https://doi.org/{doi}",
            "taste_score": seed.taste_score,
        }, None


class CorpusTests(unittest.TestCase):
    def test_parses_rough_markdown_without_a_generated_metadata_dump(self) -> None:
        content = """\
https://curius.app/example/collection
- https://arxiv.org/pdf/2501.13014
- https://www.biorxiv.org/content/10.1101/2025.03.17.643652v1.full.pdf
- https://www.mdpi.com/2306-5354/11/11/1144
- SCOUT: Skull-Corrected Optimization for Ultrasound Transducers
- kording papers
"""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "paper-dump.md"
            path.write_text(content)
            parsed = parse_markdown(path)

        self.assertEqual(len(parsed.papers), 3)
        self.assertEqual(parsed.papers[0].arxiv_id, "2501.13014")
        self.assertEqual(parsed.papers[1].doi, "10.1101/2025.03.17.643652")
        self.assertEqual(parsed.papers[2].source_lines, [4, 5])
        self.assertEqual(
            parsed.papers[2].title_hint,
            "SCOUT: Skull-Corrected Optimization for Ultrasound Transducers",
        )
        self.assertEqual(len(parsed.expansion_sources), 2)

    def test_ingestion_returns_only_compact_table_fields(self) -> None:
        content = """\
- First paper https://doi.org/10.1234/first
- Second paper https://doi.org/10.1234/second
"""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "paper-dump.md"
            path.write_text(content)
            result = ingest_corpus(path, resolver=FakeResolver())

        self.assertEqual(len(result["papers"]), 2)
        self.assertEqual(
            set(result["papers"][0]), {"doi", "title", "url", "taste_score"}
        )

    def test_policy_uses_title_and_taste_and_normalizes_urges(self) -> None:
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
        empty = run_policy("focused ultrasound simulation", papers)
        active = run_policy(
            "focused ultrasound simulation",
            papers,
            state={
                "read_paper_ids": [1, 2],
                "noted_paper_ids": [1, 2],
                "hypotheses": [{"status": "testable"}],
                "experiments": [{"status": "runnable"}],
            },
        )

        self.assertEqual(empty["papers"][0]["paper_id"], 1)
        self.assertAlmostEqual(sum(empty["urges"].values()), 1.0, places=5)
        self.assertGreater(empty["urges"]["read"], empty["urges"]["execute"])
        self.assertGreater(active["urges"]["execute"], empty["urges"]["execute"])
        self.assertGreater(active["urges"]["write"], empty["urges"]["write"])

    def test_schema_is_minimal(self) -> None:
        schema = (
            Path(__file__).parents[1] / "graphs/corpus_ingest/schema.sql"
        ).read_text()
        for field in (
            "id BIGSERIAL",
            "doi TEXT",
            "title TEXT",
            "url TEXT",
            "taste_score",
        ):
            self.assertIn(field, schema)
        self.assertNotIn("abstract", schema)
        self.assertNotIn("citation", schema)


if __name__ == "__main__":
    unittest.main()
