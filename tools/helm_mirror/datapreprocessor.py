from __future__ import annotations

from .scenario import Scenario
from .state import Instance


class DataPreprocessor:
    def preprocess(
        self, scenario: Scenario, output_path: str = "tools/outputs"
    ) -> list[Instance]:
        instances = scenario.get_instances(output_path)
        for index, instance in enumerate(instances):
            if not instance.id:
                instance.id = f"{scenario.name}-{index:04d}"
        return instances
