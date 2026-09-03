from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import yaml

from .db import fetch_papers
from .policy import run_policy


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="rwx-policy",
        description="Select corpus papers and calculate read/write/execute urges",
    )
    parser.add_argument("problem", help="research problem or current question")
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    parser.add_argument("--state", help="optional YAML research-state file")
    parser.add_argument("--paper-count", type=int, default=5)
    parser.add_argument("--output", help="optional JSON output path")
    args = parser.parse_args(argv)
    if not args.database_url:
        parser.error("--database-url or DATABASE_URL is required")
    state = yaml.safe_load(Path(args.state).read_text()) if args.state else {}
    if not isinstance(state, dict):
        raise TypeError("research state must be a YAML mapping")
    result = run_policy(
        args.problem,
        fetch_papers(args.database_url),
        state=state,
        paper_count=args.paper_count,
    )
    content = json.dumps(result, indent=2) + "\n"
    if args.output:
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(content)
    print(content, end="")


if __name__ == "__main__":
    main()
