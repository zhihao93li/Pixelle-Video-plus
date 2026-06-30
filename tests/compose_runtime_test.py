from pathlib import Path

import pytest

from pixelle_video.generation.compose_runtime import (
    ComposeRuntimeContext,
    ComposeRuntimeError,
    ComposeRuntimeRegistry,
    ComposeRuntimeResult,
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
