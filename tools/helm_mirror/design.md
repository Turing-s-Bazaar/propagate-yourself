# helm-mirror — design

A minimal mirror of Stanford HELM's architecture (borrowed from
<https://github.com/stanford-crfm/helm/blob/main/docs/code.md>) for driving
`feynman` research runs and metering time + tokens.

## Three kinds of classes

- **Specs** (`specs.py`): user-authored config — `ObjectSpec(class_name, args)`,
  `ExecutionSpec`, `RunSpec`. Loaded from `tools/run_specs.yaml`.
- **States** (`state.py`): serializable data — `Instance`, `Request`,
  `RequestResult`, `RequestState`, `ScenarioState`, `TokenUsage`, `Stat`.
- **Controllers**: logic, not serialized:
  - `scenario.py` — `Scenario` → `get_instances() -> list[Instance]`
  - `datapreprocessor.py` — assigns unique instance IDs
  - `adapter.py` — `Adapter.adapt(instances) -> ScenarioState` (builds the feynman argv)
  - `executor.py` — `Executor.execute() -> ScenarioState` (spawns feynman, records time/tokens)
  - `metric.py` — `Metric.evaluate() -> list[Stat]`
  - `runner.py` — top-level controller, driven by a `RunSpec`

## Flow

```
RunSpec → Scenario → DataPreprocessor → Adapter → Executor (asyncio) → Metrics → run.json
```

- feynman artifacts: `autoresearch/runs/<run_id>/<instance_id>/`
- harness results: `tools/outputs/<run_id>/<instance_id>/` (`result.json`, `stdout.json`)
- metrics: time (`TimeMetric`), tokens (`TokensMetric`); token source from feynman's
  `--mode json` stdout then the `--session-dir` ledger

## Adding a scenario / metric

- Scenario: subclass `Scenario`, implement `get_instances()`, register in `run_specs.yaml`.
- Metric: subclass `Metric`, implement `evaluate()` returning `list[Stat]`,
  `Stat(name).add(value)` accumulates (mean/sum/min/max on report).

## TODO

- confirm feynman token fields (stdout vs session ledger)
- costs (dropped for now)
- paper ingestion → graph construction
