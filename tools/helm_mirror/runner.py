from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

from .datapreprocessor import DataPreprocessor
from .specs import RunSpec, resolve_class
from .state import ScenarioState


class Runner:
    async def run(self, run_spec: RunSpec) -> dict:
        scenario = resolve_class(run_spec.scenario.class_name)(**run_spec.scenario.args)
        instances = DataPreprocessor().preprocess(scenario, run_spec.outputs_dir)

        adapter = resolve_class(run_spec.adapter.class_name)(
            outputs_dir=run_spec.outputs_dir,
            feynman_runs_dir=run_spec.feynman_runs_dir,
            run_id=run_spec.run_id,
            **run_spec.adapter.args,
        )
        scenario_state: ScenarioState = adapter.adapt(instances)

        executor_args = dict(run_spec.executor.args)
        executor_args.setdefault("max_workers", run_spec.execution.max_workers)
        executor_args.setdefault("timeout_s", run_spec.execution.timeout_s)
        executor = resolve_class(run_spec.executor.class_name)(**executor_args)
        await executor.execute(scenario_state)

        stats = []
        for metric_spec in run_spec.metrics:
            metric = resolve_class(metric_spec.class_name)(**metric_spec.args)
            stats.extend(metric.evaluate(scenario_state))

        out_dir = Path(run_spec.outputs_dir) / run_spec.run_id
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "scenario_state.json").write_text(
            json.dumps(asdict(scenario_state), indent=2)
        )
        (out_dir / "stats.json").write_text(
            json.dumps([stat.summary() for stat in stats], indent=2)
        )

        summary = {
            "run_id": run_spec.run_id,
            "name": run_spec.name,
            "instances": len(instances),
            "completed": sum(
                1 for state in scenario_state.request_states if state.result is not None
            ),
            "succeeded": sum(
                1
                for state in scenario_state.request_states
                if state.result is not None and state.result.success
            ),
            "stats": [stat.summary() for stat in stats],
        }
        (out_dir / "run.json").write_text(json.dumps(summary, indent=2))
        return summary
