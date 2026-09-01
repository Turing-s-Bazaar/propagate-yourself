from __future__ import annotations

import argparse
import asyncio
import json

from .runner import Runner
from .specs import load_run_spec


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="helm-mirror",
        description="Mirror of HELM's architecture driving feynman research runs",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    run_parser = subparsers.add_parser(
        "run", help="run the FUS problem set through feynman"
    )
    run_parser.add_argument("specs", nargs="?", default="tools/run_specs.yaml")

    args = parser.parse_args(argv)

    if args.command == "run":
        summary = asyncio.run(Runner().run(load_run_spec(args.specs)))
        print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
