from __future__ import annotations

from pathlib import Path

import psycopg

SCHEMA_PATH = Path(__file__).with_name("schema.sql")


def sync_papers(database_url: str, papers: list[dict]) -> int:
    if not papers:
        raise ValueError("refusing to empty the papers table from an empty import")
    urls = [paper["url"] for paper in papers]
    with psycopg.connect(database_url) as connection:
        connection.execute(SCHEMA_PATH.read_text())
        for paper in papers:
            connection.execute(
                """
                INSERT INTO papers (doi, title, url, taste_score)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (url) DO UPDATE SET
                    doi = EXCLUDED.doi,
                    title = EXCLUDED.title,
                    taste_score = EXCLUDED.taste_score,
                    updated_at = NOW()
                """,
                (
                    paper.get("doi"),
                    paper["title"],
                    paper["url"],
                    paper["taste_score"],
                ),
            )
        connection.execute("DELETE FROM papers WHERE NOT (url = ANY(%s))", (urls,))
    return len(papers)


def fetch_papers(database_url: str) -> list[dict]:
    with psycopg.connect(database_url) as connection:
        rows = connection.execute(
            "SELECT id, doi, title, url, taste_score FROM papers ORDER BY id"
        ).fetchall()
    return [
        {
            "paper_id": row[0],
            "doi": row[1],
            "title": row[2],
            "url": row[3],
            "taste_score": row[4],
        }
        for row in rows
    ]
