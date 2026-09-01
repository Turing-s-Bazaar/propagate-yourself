from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Instance:
    id: str
    input: str
    references: list[str] = field(default_factory=list)
    split: str = "test"
    tags: list[str] = field(default_factory=list)
    meta: dict = field(default_factory=dict)


@dataclass
class TokenUsage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0


@dataclass
class Request:
    instance_id: str
    model: str = ""
    prompt: str = ""
    command: list[str] = field(default_factory=list)
    cwd: str = ""
    session_dir: str = ""
    process_cwd: str = ""
    stdout_path: str = ""
    stderr_path: str = ""
    result_path: str = ""


@dataclass
class RequestResult:
    request: Request
    success: bool = False
    returncode: int | None = None
    stdout_path: str = ""
    output_dir: str = ""
    request_time: float | None = None
    token_usage: TokenUsage | None = None
    error: str | None = None


@dataclass
class RequestState:
    instance: Instance
    request: Request
    result: RequestResult | None = None


@dataclass
class ScenarioState:
    request_states: list[RequestState] = field(default_factory=list)
    adapter_spec: dict = field(default_factory=dict)


@dataclass
class Stat:
    name: str
    values: list[float] = field(default_factory=list)

    def add(self, value: float) -> Stat:
        self.values.append(float(value))
        return self

    def summary(self) -> dict:
        if not self.values:
            return {"name": self.name, "count": 0}
        return {
            "name": self.name,
            "count": len(self.values),
            "mean": sum(self.values) / len(self.values),
            "sum": sum(self.values),
            "min": min(self.values),
            "max": max(self.values),
        }
