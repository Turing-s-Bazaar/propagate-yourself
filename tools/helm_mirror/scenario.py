from __future__ import annotations

from pathlib import Path
from typing import ClassVar

from .state import Instance


class Scenario:
    name: ClassVar[str] = ""
    description: ClassVar[str] = ""
    tags: ClassVar[list[str]] = []

    def get_instances(self, output_path: str) -> list[Instance]:
        raise NotImplementedError


def _read_frontmatter(text: str) -> tuple[dict, str]:
    import yaml

    if not text.startswith("---"):
        return {}, text.strip()
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}, text.strip()
    return (yaml.safe_load(parts[1]) or {}), parts[2].strip()


class FUSScenario(Scenario):
    name = "fus"
    description = "FUS simulation research problems"
    tags: ClassVar[list[str]] = ["fus", "simulation"]

    def __init__(self, instructions_dir: str, **kwargs):
        self.instructions_dir = instructions_dir

    def get_instances(self, output_path: str = "tools/outputs") -> list[Instance]:
        instances: list[Instance] = []
        for path in sorted(Path(self.instructions_dir).glob("*.md")):
            frontmatter, body = _read_frontmatter(path.read_text())
            meta = {
                k: frontmatter[k]
                for k in ("title", "model", "thinking")
                if frontmatter.get(k) is not None
            }
            instances.append(
                Instance(
                    id=str(frontmatter.get("id") or path.stem),
                    input=body,
                    tags=[str(t) for t in frontmatter.get("tags", [])],
                    meta=meta,
                )
            )
        return instances
