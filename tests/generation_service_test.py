from pathlib import Path
from types import SimpleNamespace

import pytest

from pixelle_video.generation import (
    GenerationRequest,
    GenerationService,
    build_default_pipeline_manifests,
    build_pipeline_registry,
)
from pixelle_video.models.progress import ProgressEvent
from pixelle_video.models.storyboard import (
    Storyboard,
    StoryboardConfig,
    StoryboardFrame,
    VideoGenerationResult,
)


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
        kwargs["progress_callback"](ProgressEvent(event_type="compose_video", progress=1.0))
        return _video_result()


class FailingPipeline:
    async def __call__(self, **kwargs):
        raise RuntimeError("tts provider unavailable")


class DetailedProgressPipeline:
    async def __call__(self, **kwargs):
        kwargs["progress_callback"](
            ProgressEvent(
                event_type="frame_step",
                progress=0.42,
                frame_current=1,
                frame_total=1,
                step=2,
                action="media",
                extra_info="RunningHub media workflow queued",
                detail={
                    "provider": "runninghub",
                    "workflow": "runninghub/image_flux.json",
                    "media_type": "image",
                    "runninghub_timeout": 600,
                },
            )
        )
        return _video_result()


def _service_for_pipeline(pipeline, storage_dir=None):
    manifest = build_default_pipeline_manifests()[0]
    registry = build_pipeline_registry([manifest], pipelines={"standard": pipeline})
    return GenerationService(
        pipeline_registry=registry,
        task_id_factory=lambda: "gen-task-1",
        storage_dir=storage_dir,
    )


def _service_for_asset_pipeline(pipeline):
    manifest = next(
        manifest
        for manifest in build_default_pipeline_manifests()
        if manifest.id == "asset_based"
    )
    registry = build_pipeline_registry([manifest], pipelines={"asset_based": pipeline})
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
async def test_generation_result_exposes_persisted_storyboard_path(tmp_path):
    output_dir = tmp_path / "run"
    output_dir.mkdir()
    video_path = output_dir / "final.mp4"
    video_path.write_bytes(b"not-a-real-video")
    storyboard_path = output_dir / "storyboard.json"
    storyboard_path.write_text("{}", encoding="utf-8")

    class PersistedStoryboardPipeline:
        async def __call__(self, **kwargs):
            return _video_result(str(video_path))

    service = _service_for_pipeline(PersistedStoryboardPipeline())
    task = service.submit(
        GenerationRequest(
            pipeline_id="standard",
            entry="topic",
            input={"topic": "storyboard contract"},
        )
    )
    completed = await service.wait_for_task(task.task_id)

    assert completed.status == "completed"
    assert completed.result is not None
    assert completed.result.storyboard_path == str(storyboard_path)


@pytest.mark.asyncio
async def test_generation_service_restores_completed_tasks_and_idempotency(tmp_path):
    request = GenerationRequest(
        pipeline_id="standard",
        entry="script",
        input={"script": "Scene one."},
        idempotency_key="stable-request",
    )
    first = _service_for_pipeline(SuccessfulPipeline(), tmp_path)
    completed = await first.wait_for_task(first.submit(request).task_id)
    assert completed.status == "completed"

    restored = _service_for_pipeline(SuccessfulPipeline(), tmp_path)
    assert restored.get_task(completed.task_id).status == "completed"
    assert restored.submit(request).task_id == completed.task_id


@pytest.mark.asyncio
async def test_generation_service_marks_inflight_tasks_interrupted_after_restart(tmp_path):
    first = _service_for_pipeline(SuccessfulPipeline(), tmp_path)
    task = first.submit(
        GenerationRequest(
            pipeline_id="standard",
            entry="script",
            input={"script": "Scene one."},
        )
    )

    restored = _service_for_pipeline(SuccessfulPipeline(), tmp_path).get_task(task.task_id)
    assert restored.status == "interrupted"
    assert restored.error is not None
    assert restored.error.exception_type == "GenerationServiceRestart"
    await first.shutdown()


@pytest.mark.asyncio
async def test_generation_service_marks_inflight_tasks_interrupted_on_graceful_shutdown(tmp_path):
    service = _service_for_pipeline(SuccessfulPipeline(), tmp_path)
    task = service.submit(
        GenerationRequest(
            pipeline_id="standard",
            entry="script",
            input={"script": "Scene one."},
        )
    )

    await service.shutdown()

    interrupted = service.get_task(task.task_id)
    assert interrupted.status == "interrupted"
    assert interrupted.error is not None
    assert interrupted.error.exception_type == "GenerationServiceShutdown"


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


@pytest.mark.asyncio
async def test_generation_service_preserves_provider_progress_detail():
    service = _service_for_pipeline(DetailedProgressPipeline())
    progress_snapshots = []

    task = service.submit(
        GenerationRequest(
            pipeline_id="standard",
            entry="script",
            input={"script": "Scene one."},
        ),
        progress_callback=lambda task: progress_snapshots.append(task.model_copy(deep=True)),
    )

    completed = await service.wait_for_task(task.task_id)

    assert completed.status == "completed"
    provider_progress = [
        snapshot.progress
        for snapshot in progress_snapshots
        if snapshot.progress.stage == "frame_step"
    ]
    assert provider_progress
    assert provider_progress[-1].detail == {
        "action": "media",
        "step": 2,
        "extra_info": "RunningHub media workflow queued",
        "provider": "runninghub",
        "workflow": "runninghub/image_flux.json",
        "media_type": "image",
        "runninghub_timeout": 600,
    }


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


@pytest.mark.asyncio
async def test_generation_result_includes_quality_review_and_asset_manifest(tmp_path):
    video_path = tmp_path / "final.mp4"
    audio_path = tmp_path / "scene-1.wav"
    image_path = tmp_path / "scene-1.png"
    bgm_path = tmp_path / "bgm.mp3"
    segment_path = tmp_path / "scene-1-segment.mp4"
    for path in (video_path, audio_path, image_path, bgm_path, segment_path):
        path.write_bytes(b"fake media")

    class AssetTrackingPipeline:
        async def __call__(self, **kwargs):
            storyboard = Storyboard(
                title="Tracked Video",
                config=StoryboardConfig(
                    media_width=1080,
                    media_height=1920,
                    task_id="tracked-task",
                ),
                final_video_path=str(video_path),
                total_duration=9.0,
                frames=[
                    StoryboardFrame(
                        index=0,
                        narration="Scene one.",
                        image_prompt="A calm cat drinking water.",
                        audio_path=str(audio_path),
                        image_path=str(image_path),
                        video_segment_path=str(segment_path),
                        duration=9.0,
                    )
                ],
            )
            return VideoGenerationResult(
                video_path=str(video_path),
                storyboard=storyboard,
                duration=9.0,
                file_size=video_path.stat().st_size,
            )

    service = _service_for_pipeline(AssetTrackingPipeline())
    task = service.submit(
        GenerationRequest(
            pipeline_id="standard",
            entry="script",
            input={"script": "Scene one."},
            params={"bgm_path": str(bgm_path), "quality_profile": "basic"},
        )
    )

    completed = await service.wait_for_task(task.task_id)

    assert completed.status == "completed"
    assert completed.result is not None
    metadata = completed.result.metadata
    assert metadata["quality_review"]["status"] == "failed"
    assert {check["id"] for check in metadata["quality_review"]["checks"]} >= {
        "file_exists",
        "video_playable",
        "audio_present",
        "duration_seconds",
        "file_size_bytes",
        "black_frame_sample",
    }
    asset_roles = {asset["role"] for asset in metadata["asset_manifest"]["assets"]}
    assert {
        "final_video",
        "narration_audio",
        "primary_visual",
        "bgm",
        "subtitle_text",
    }.issubset(asset_roles)


@pytest.mark.asyncio
async def test_generation_service_accepts_asset_pipeline_context_final_video_path(tmp_path):
    video_path = tmp_path / "asset-final.mp4"
    video_path.write_bytes(b"fake video")

    class AssetContextPipeline:
        async def __call__(self, **kwargs):
            return SimpleNamespace(
                final_video_path=str(video_path),
                storyboard=Storyboard(
                    title="Asset Video",
                    config=StoryboardConfig(media_width=1080, media_height=1920),
                    final_video_path=str(video_path),
                    total_duration=15.0,
                ),
            )

    service = _service_for_asset_pipeline(AssetContextPipeline())
    task = service.submit(
        GenerationRequest(
            pipeline_id="asset_based",
            entry="assets",
            input={"assets": ["/tmp/petwoods.jpg"]},
        )
    )

    completed = await service.wait_for_task(task.task_id)

    assert completed.status == "completed"
    assert completed.result is not None
    assert completed.result.primary_video.path == str(video_path)
    assert completed.result.file_size == video_path.stat().st_size
