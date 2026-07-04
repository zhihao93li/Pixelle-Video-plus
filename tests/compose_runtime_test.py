import subprocess
from pathlib import Path

import pytest

from pixelle_video.generation.compose_runtime import (
    ComposeRuntimeContext,
    ComposeRuntimeError,
    ComposeRuntimeRegistry,
    ComposeRuntimeResult,
    HyperframesComposeRuntime,
    render_with_compose_runtime,
)


class RecordingRuntime:
    def __init__(self, runtime_id: str, output: str):
        self.runtime_id = runtime_id
        self.output = output
        self.calls = []

    def render(self, context: ComposeRuntimeContext) -> ComposeRuntimeResult:
        self.calls.append(context)
        Path(self.output).write_bytes(self.runtime_id.encode("utf-8"))
        return ComposeRuntimeResult(
            output_path=self.output,
            runtime_id=self.runtime_id,
            metadata={"called": self.runtime_id},
        )


class FailingRuntime:
    runtime_id = "hyperframes"

    def __init__(self):
        self.calls = []

    def render(self, context: ComposeRuntimeContext) -> ComposeRuntimeResult:
        self.calls.append(context)
        raise ComposeRuntimeError("hyperframes render failed")


def _context(tmp_path):
    segment = tmp_path / "scene-1.mp4"
    segment.write_bytes(b"segment")
    return ComposeRuntimeContext(
        segment_paths=[str(segment)],
        output_path=str(tmp_path / "final.mp4"),
        task_dir=str(tmp_path),
    )


def test_render_with_compose_runtime_calls_requested_runtime(tmp_path):
    hyperframes = RecordingRuntime("hyperframes", str(tmp_path / "final.mp4"))
    html_ffmpeg = RecordingRuntime("html_ffmpeg", str(tmp_path / "fallback.mp4"))
    registry = ComposeRuntimeRegistry()
    registry.register("html_ffmpeg", html_ffmpeg)
    registry.register("hyperframes", hyperframes)

    result = render_with_compose_runtime("hyperframes", _context(tmp_path), registry=registry)

    assert result.runtime_id == "hyperframes"
    assert len(hyperframes.calls) == 1
    assert html_ffmpeg.calls == []
    assert Path(result.output_path).read_bytes() == b"hyperframes"


def test_render_with_compose_runtime_does_not_fallback_after_runtime_failure(tmp_path):
    hyperframes = FailingRuntime()
    html_ffmpeg = RecordingRuntime("html_ffmpeg", str(tmp_path / "fallback.mp4"))
    registry = ComposeRuntimeRegistry()
    registry.register("html_ffmpeg", html_ffmpeg)
    registry.register("hyperframes", hyperframes)

    with pytest.raises(ComposeRuntimeError, match="hyperframes render failed"):
        render_with_compose_runtime("hyperframes", _context(tmp_path), registry=registry)

    assert len(hyperframes.calls) == 1
    assert html_ffmpeg.calls == []
    assert not (tmp_path / "fallback.mp4").exists()


def test_hyperframes_render_uses_non_interactive_npx_yes(monkeypatch, tmp_path):
    commands = []
    output_path = tmp_path / "final.mp4"

    def fake_run(self, command, *, cwd):
        commands.append(command)
        if "render" in command:
            output_path.write_bytes(b"video")

    monkeypatch.setattr("pixelle_video.generation.compose_runtime.shutil.which", lambda name: "/usr/bin/npx")
    monkeypatch.setattr(HyperframesComposeRuntime, "_run", fake_run)

    result = HyperframesComposeRuntime().render(
        ComposeRuntimeContext(
            segment_paths=[str(_context(tmp_path).segment_paths[0])],
            output_path=str(output_path),
            task_dir=str(tmp_path),
        )
    )

    assert result.runtime_id == "hyperframes"
    assert [command[:3] for command in commands] == [
        ["npx", "--yes", "hyperframes"],
        ["npx", "--yes", "hyperframes"],
        ["npx", "--yes", "hyperframes"],
    ]


def test_hyperframes_run_reports_timeout_as_runtime_error(monkeypatch, tmp_path):
    def fake_run(command, **kwargs):
        raise subprocess.TimeoutExpired(command, timeout=180)

    monkeypatch.setattr("pixelle_video.generation.compose_runtime.subprocess.run", fake_run)

    with pytest.raises(ComposeRuntimeError, match="timed out after 180s"):
        HyperframesComposeRuntime()._run(
            ["npx", "--yes", "hyperframes", "lint"],
            cwd=tmp_path,
        )
