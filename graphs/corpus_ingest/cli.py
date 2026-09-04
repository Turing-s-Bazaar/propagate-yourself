from __future__ import annotations

import argparse
import json
import os

from .corpus import ingest_corpus
from .db import sync_papers


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="corpus-ingest",
        description="Resolve a rough Markdown paper dump into the PostgreSQL papers table",
    )
    parser.add_argument(
        "source",
        nargs="?",
        default="graphs/corpus/paper-dump.md",
        help="rough Markdown corpus source",
    )
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    parser.add_argument(
        "--dry-run", action="store_true", help="resolve without writing PostgreSQL"
    )
    parser.add_argument("--max-workers", type=int, default=4)
    parser.add_argument("--timeout", type=float, default=15.0)
    args = parser.parse_args(argv)
    result = ingest_corpus(
        args.source,
        max_workers=args.max_workers,
        timeout=args.timeout,
    )
    if not args.dry_run:
        if not args.database_url:
            parser.error(
                "--database-url or DATABASE_URL is required unless --dry-run is used"
            )
        sync_papers(args.database_url, result["papers"])
    summary = {
        "paper_count": len(result["papers"]),
        "skipped": result["skipped"],
        "expansion_source_count": result["expansion_source_count"],
        "database_written": not args.dry_run,
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
