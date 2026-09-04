from __future__ import annotations

import re
from pathlib import Path

import yaml

POLICY_PATH = Path(__file__).with_name("handwritten-policy.md")

_YAML_BLOCK = re.compile(r"```yaml\n(?P<body>.*?)\n```", re.DOTALL)


def load_handwritten_policy(path: str | Path = POLICY_PATH) -> dict:
    text = Path(path).read_text()
    policy: dict = {"heuristics": [], "mental_models": []}
    for body in _YAML_BLOCK.findall(text):
        data = yaml.safe_load(body) or {}
        if "heuristics" in data:
            policy["heuristics"] = data["heuristics"]
        if "mental_models" in data:
            policy["mental_models"] = data["mental_models"]
    return policy


def heuristic_weights(policy: dict) -> dict[str, float]:
    return {
        item["id"]: float(item["weight"])
        for item in policy.get("heuristics") or []
        if "weight" in item
    }


def heuristic_texts(policy: dict) -> list[str]:
    return [item["text"].strip() for item in policy.get("heuristics") or []]


def mental_model_texts(policy: dict) -> list[str]:
    return [item["text"].strip() for item in policy.get("mental_models") or []]
