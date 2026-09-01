from __future__ import annotations

import importlib
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class ObjectSpec:
    class_name: str = ""
    args: dict = field(default_factory=dict)


@dataclass
class ExecutionSpec:
    max_workers: int = 2
    timeout_s: int = 3600


@dataclass
class RunSpec:
    run_id: str = ""
    name: str = ""
    outputs_dir: str = "tools/outputs"
    feynman_runs_dir: str = "autoresearch/runs"
    scenario: ObjectSpec = field(default_factory=ObjectSpec)
    adapter: ObjectSpec = field(default_factory=ObjectSpec)
    executor: ObjectSpec = field(
        default_factory=lambda: ObjectSpec("tools.helm_mirror.executor.FeynmanExecutor")
    )
    execution: ExecutionSpec = field(default_factory=ExecutionSpec)
    metrics: list[ObjectSpec] = field(default_factory=list)
    groups: list[str] = field(default_factory=list)


def resolve_class(class_name: str) -> type:
    module_path, _, name = class_name.rpartition(".")
    if not module_path or not name:
        raise ValueError(f"invalid class_name: {class_name!r}")
    module = importlib.import_module(module_path)
    return getattr(module, name)


def _as_object_spec(data: dict | None, default_class: str = "") -> ObjectSpec:
    if not data:
        return ObjectSpec(default_class)
    return ObjectSpec(
        class_name=data.get("class_name", default_class),
        args=dict(data.get("args") or {}),
    )


def load_run_spec(path: str | Path) -> RunSpec:
    import yaml

    raw = yaml.safe_load(Path(path).read_text()) or {}
    return RunSpec(
        run_id=raw.get("run_id", ""),
        name=raw.get("name", ""),
        outputs_dir=raw.get("outputs_dir", "tools/outputs"),
        feynman_runs_dir=raw.get("feynman_runs_dir", "autoresearch/runs"),
        scenario=_as_object_spec(raw.get("scenario")),
        adapter=_as_object_spec(raw.get("adapter")),
        executor=_as_object_spec(
            raw.get("executor"), "tools.helm_mirror.executor.FeynmanExecutor"
        ),
        execution=ExecutionSpec(**(raw.get("execution") or {})),
        metrics=[_as_object_spec(m) for m in (raw.get("metrics") or [])],
        groups=list(raw.get("groups") or []),
    )
