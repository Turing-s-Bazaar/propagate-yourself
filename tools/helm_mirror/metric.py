from __future__ import annotations

from typing import ClassVar

from .state import ScenarioState, Stat


class Metric:
    name: ClassVar[str] = ""
    description: ClassVar[str] = ""
    tags: ClassVar[list[str]] = []

    def evaluate(self, scenario_state: ScenarioState) -> list[Stat]:
        raise NotImplementedError

    def get_metadata(self) -> list:
        return []


def _results(scenario_state: ScenarioState):
    for state in scenario_state.request_states:
        if state.result is not None:
            yield state.result


class TimeMetric(Metric):
    name = "time"
    description = "Wall-clock seconds per feynman run"
    tags: ClassVar[list[str]] = ["efficiency"]

    def evaluate(self, scenario_state: ScenarioState) -> list[Stat]:
        wall = Stat("wall_seconds")
        for result in _results(scenario_state):
            if result.request_time is not None:
                wall.add(result.request_time)
        return [wall]


class TokensMetric(Metric):
    name = "tokens"
    description = "Token usage reported by feynman"
    tags: ClassVar[list[str]] = ["efficiency"]

    def evaluate(self, scenario_state: ScenarioState) -> list[Stat]:
        stats = {
            "input_tokens": Stat("input_tokens"),
            "output_tokens": Stat("output_tokens"),
            "cache_read_tokens": Stat("cache_read_tokens"),
            "cache_write_tokens": Stat("cache_write_tokens"),
        }
        for result in _results(scenario_state):
            usage = result.token_usage
            if usage is None:
                continue
            stats["input_tokens"].add(usage.input_tokens)
            stats["output_tokens"].add(usage.output_tokens)
            stats["cache_read_tokens"].add(usage.cache_read_tokens)
            stats["cache_write_tokens"].add(usage.cache_write_tokens)
        return [stat for stat in stats.values() if stat.values]
