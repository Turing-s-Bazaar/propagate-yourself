from __future__ import annotations

import asyncio
import json
from dataclasses import asdict
from pathlib import Path

from .state import RequestResult, RequestState, ScenarioState, TokenUsage


class Executor:
    async def execute(self, scenario_state: ScenarioState) -> ScenarioState:
        raise NotImplementedError


_TOKEN_KEYS = {
    "input_tokens": {"inputTokens", "input_tokens", "prompt_tokens"},
    "output_tokens": {"outputTokens", "output_tokens", "completion_tokens"},
    "cache_read_tokens": {"cacheReadTokens", "cache_read_tokens", "cached_tokens"},
    "cache_write_tokens": {"cacheWriteTokens", "cache_write_tokens"},
}


def _collect_tokens(obj: object, acc: dict) -> None:
    if isinstance(obj, dict):
        for key, value in obj.items():
            if isinstance(value, int):
                for field, names in _TOKEN_KEYS.items():
                    if key in names:
                        acc[field] = acc.get(field, 0) + value
            else:
                _collect_tokens(value, acc)
    elif isinstance(obj, list):
        for item in obj:
            _collect_tokens(item, acc)


def _tokens_from_bytes(data: bytes, acc: dict) -> None:
    text = data.decode("utf-8", errors="replace")
    try:
        _collect_tokens(json.loads(text), acc)
        return
    except (UnicodeDecodeError, json.JSONDecodeError):
        pass
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            _collect_tokens(json.loads(line), acc)
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue


def extract_token_usage(stdout_path: str, session_dir: str) -> TokenUsage | None:
    acc: dict = {}
    stdout = Path(stdout_path)
    if stdout.exists():
        _tokens_from_bytes(stdout.read_bytes(), acc)
    sessions = Path(session_dir)
    if sessions.exists():
        for path in list(sessions.rglob("*.json")) + list(sessions.rglob("*.jsonl")):
            try:
                _tokens_from_bytes(path.read_bytes(), acc)
            except OSError:
                continue
    if not any(acc.values()):
        return None
    return TokenUsage(
        input_tokens=acc.get("input_tokens", 0),
        output_tokens=acc.get("output_tokens", 0),
        cache_read_tokens=acc.get("cache_read_tokens", 0),
        cache_write_tokens=acc.get("cache_write_tokens", 0),
    )


class FeynmanExecutor(Executor):
    def __init__(self, max_workers: int = 2, timeout_s: int = 3600, **kwargs):
        self.max_workers = max_workers
        self.timeout_s = timeout_s

    async def execute(self, scenario_state: ScenarioState) -> ScenarioState:
        semaphore = asyncio.Semaphore(self.max_workers)

        async def run_one(state: RequestState) -> None:
            async with semaphore:
                result_path = Path(state.request.result_path)
                if result_path.exists():
                    state.result = _load_result(result_path)
                    return
                await _run(state, self.timeout_s)

        await asyncio.gather(
            *[run_one(state) for state in scenario_state.request_states]
        )
        return scenario_state


async def _run(state: RequestState, timeout_s: int) -> None:
    request = state.request
    for path in (
        Path(request.stdout_path).parent,
        Path(request.cwd),
        Path(request.session_dir),
    ):
        path.mkdir(parents=True, exist_ok=True)

    error: str | None = None
    returncode: int | None = None
    elapsed: float | None = None
    stdout_file = await asyncio.to_thread(open, request.stdout_path, "wb")
    stderr_file = await asyncio.to_thread(open, request.stderr_path, "wb")
    try:
        loop = asyncio.get_running_loop()
        start = loop.time()
        process = await asyncio.create_subprocess_exec(
            *request.command,
            stdout=stdout_file,
            stderr=stderr_file,
            cwd=request.process_cwd or None,
        )
        try:
            returncode = await asyncio.wait_for(process.wait(), timeout=timeout_s)
        except TimeoutError:
            process.kill()
            await process.wait()
            returncode = None
            error = f"timeout after {timeout_s}s"
        elapsed = loop.time() - start
    except OSError as exc:
        error = str(exc)
    finally:
        stdout_file.close()
        stderr_file.close()

    token_usage = extract_token_usage(request.stdout_path, request.session_dir)
    success = returncode == 0
    state.result = RequestResult(
        request=request,
        success=success,
        returncode=returncode,
        stdout_path=request.stdout_path,
        output_dir=request.cwd,
        request_time=elapsed,
        token_usage=token_usage,
        error=error if not success else None,
    )
    _write_result(state.result, Path(request.result_path))


def _load_result(path: Path) -> RequestResult:
    from .state import Request

    data = json.loads(path.read_text())
    request = Request(**data["request"])
    token_usage = data.get("token_usage")
    return RequestResult(
        request=request,
        success=data.get("success", False),
        returncode=data.get("returncode"),
        stdout_path=data.get("stdout_path", ""),
        output_dir=data.get("output_dir", ""),
        request_time=data.get("request_time"),
        token_usage=TokenUsage(**token_usage) if token_usage else None,
        error=data.get("error"),
    )


def _write_result(result: RequestResult, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(result), indent=2))
