from pathlib import Path

import pytest

from pixelle_video.generation import (
    GenerationRequest,
    GenerationService,
    build_default_pipeline_manifests,
    build_pipeline_registry,
)
from pixelle_video.models.progress import ProgressEvent
from pixelle_video.models.storyboard import Storyboard, StoryboardConfig, VideoGenerationResult


def _video_result(path: str = "output/task/final.mp4") -> VideoGenerationResult:
    return VideoGenerationResult(
        video_path=path,
        storyboard=Storyboard(
            title="Generated Video",
            config=StoryboardConfig(media_width=1080, media_height=1920),
            final_video_path=path,
            total_duration=12.5,
        ),
        duration=12.5,
        file_size=1234,
    )


class SuccessfulPipeline:
    def __init__(self):
        self.calls = []

    async def __call__(self, **kwargs):
        self.calls.append(kwargs)
        kwargs["progress_callback"](
            ProgressEvent(
                event_type="generating_tts",
                progress=0.25,
                frame_current=1,
                frame_total=2,
                action="audio",
                extra_info="voice ready",
            )
        )
        kwargs["progress_callback"](
            ProgressEvent(event_type="compose_video", progress=1.0)
        )
        return _video_result()


class FailingPipeline:
    async def __call__(self, **kwargs):
        raise RuntimeError("tts provider unavailable")


def _service_for_pipeline(pipeline):
    manifest = build_default_pipeline_manifests()[0]
    registry = build_pipeline_registry([manifest], pipelines={"standard": pipeline})
    return GenerationService(pipeline_registry=registry, task_id_factory=lambda: "gen-task-1")


@pytest.mark.asyncio
async def test_generation_service_runs_pipeline_and_returns_structured_result():
    pipeline = SuccessfulPipeline()
    service = _service_for_pipeline(pipeline)

    task = service.submit(
        GenerationRequest(
            pipeline_id="standard",
            entry="topic",
            input={"topic": "How to keep cats hydrated"},
            params={"frame_template": "1080x1920/image_default.html"},
            metadata={"experiment_id": "exp-1"},
        )
    )

    assert task.task_id == "gen-task-1"
    assert task.status == "pending"

    completed = await service.wait_for_task("gen-task-1")

    assert completed.status == "completed"
    assert completed.progress.stage == "compose_video"
    assert completed.progress.percentage == 100.0
    assert completed.result is not None
    assert completed.result.primary_video.path == "output/task/final.mp4"
    assert completed.result.primary_video.kind == "video"
    assert completed.result.duration == 12.5
    assert completed.result.file_size == 1234
    assert completed.error is None
    assert pipeline.calls == [
        {
            "text": "How to keep cats hydrated",
            "mode": "generate",
            "frame_template": "1080x1920/image_default.html",
            "progress_callback": pipeline.calls[0]["progress_callback"],
        }
    ]


@pytest.mark.asyncio
async def test_generation_service_records_structured_runtime_error():
    service = _service_for_pipeline(FailingPipeline())

    task = service.submit(
        GenerationRequest(
            pipeline_id="standard",
            entry="script",
            input={"script": "Scene one.\nScene two."},
        )
    )

    failed = await service.wait_for_task(task.task_id)

    assert failed.status == "failed"
    assert failed.result is None
    assert failed.error is not None
    assert failed.error.layer == "runtime"
    assert failed.error.exception_type == "RuntimeError"
    assert "tts provider unavailable" in failed.error.message


def test_generation_service_rejects_missing_required_entry_field():
    service = _service_for_pipeline(SuccessfulPipeline())

    with pytest.raises(ValueError, match="topic"):
        service.submit(
            GenerationRequest(
                pipeline_id="standard",
                entry="topic",
                input={},
            )
        )


def test_generation_service_requires_known_pipeline_and_entry():
    service = _service_for_pipeline(SuccessfulPipeline())

    with pytest.raises(ValueError, match="missing"):
        service.submit(
            GenerationRequest(
                pipeline_id="missing",
                entry="topic",
                input={"topic": "Topic"},
            )
        )

    with pytest.raises(ValueError, match="assets"):
        service.submit(
            GenerationRequest(
                pipeline_id="standard",
                entry="assets",
                input={"assets": [str(Path("asset.png"))]},
            )
        )
