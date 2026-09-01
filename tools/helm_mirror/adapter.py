from __future__ import annotations

from pathlib import Path

from .state import Instance, Request, RequestState, ScenarioState


class Adapter:
    def adapt(self, instances: list[Instance]) -> ScenarioState:
        raise NotImplementedError


class FeynmanAdapter(Adapter):
    def __init__(
        self,
        outputs_dir: str,
        feynman_runs_dir: str,
        run_id: str,
        feynman_command: list[str] | None = None,
        process_cwd: str = "autoresearch",
        mode: str = "json",
        model: str = "",
        thinking: str = "",
        **kwargs,
    ):
        self.outputs_dir = Path(outputs_dir)
        self.feynman_runs_dir = Path(feynman_runs_dir)
        self.run_id = run_id
        self.feynman_command = list(feynman_command) if feynman_command else ["feynman"]
        self.process_cwd = process_cwd
        self.mode = mode
        self.model = model
        self.thinking = thinking

    def adapt(self, instances: list[Instance]) -> ScenarioState:
        states: list[RequestState] = []
        for instance in instances:
            run_dir = self.feynman_runs_dir / self.run_id / instance.id
            session_dir = run_dir / "sessions"
            harness_dir = self.outputs_dir / self.run_id / instance.id

            model = instance.meta.get("model") or self.model
            thinking = instance.meta.get("thinking") or self.thinking
            flags = [
                "--mode",
                self.mode,
                "--prompt",
                instance.input,
                "--cwd",
                str(run_dir),
                "--session-dir",
                str(session_dir),
                "--new-session",
            ]
            if model:
                flags += ["--model", model]
            if thinking:
                flags += ["--thinking", thinking]

            request = Request(
                instance_id=instance.id,
                model=model,
                prompt=instance.input,
                command=self.feynman_command + flags,
                cwd=str(run_dir),
                session_dir=str(session_dir),
                process_cwd=self.process_cwd,
                stdout_path=str(harness_dir / "stdout.json"),
                stderr_path=str(harness_dir / "stderr.txt"),
                result_path=str(harness_dir / "result.json"),
            )
            states.append(RequestState(instance=instance, request=request))

        return ScenarioState(request_states=states)
