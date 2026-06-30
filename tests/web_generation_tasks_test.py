import inspect

import pytest

from pixelle_video.generation import build_default_pipeline_manifests, build_pipeline_registry
from pixelle_video.models.storyboard import Storyboard, StoryboardConfig, VideoGenerationResult


class RecordingPipeline:
    def __init__(self):
        self.calls = []

    async def __call__(self, **kwargs):
        self.calls.append(kwargs)
        return VideoGenerationResult(
            video_path="output/task/final.mp4",
            storyboard=Storyboard(
                title="Generated",
                config=StoryboardConfig(media_width=1024, media_height=1024),
            ),
            duration=8.0,
            file_size=2048,
        )


def _registry_with_pipeline(pipeline):
    return build_pipeline_registry(
        build_default_pipeline_manifests(),
        pipelines={"standard": pipeline},
    )


def test_build_generation_request_from_video_params_uses_manifest_entry_fields():
    from web.utils.generation_tasks import build_generation_request_from_video_params

    pipeline = RecordingPipeline()
    registry = _registry_with_pipeline(pipeline)

    request = build_generation_request_from_video_params(
        pipeline_registry=registry,
        video_params={
            "text": "Scene one.\nScene two.",
            "mode": "fixed",
            "title": "Approved script",
            "split_mode": "line",
            "frame_template": "1080x1920/image_default.html",
            "media_width": 1024,
            "media_height": 1024,
        },
        pipeline_id="standard",
        entry_id="script",
    )

    assert request.pipeline_id == "standard"
    assert request.entry == "script"
    assert request.input == {"script": "Scene one.\nScene two."}
    assert request.params["title"] == "Approved script"
    assert request.params["split_mode"] == "line"
    assert request.params["media_width"] == 1024
    assert request.params["media_height"] == 1024


def test_build_generation_request_from_video_params_can_use_production_template():
    from web.utils.generation_tasks import build_generation_request_from_video_params

    registry = _registry_with_pipeline(RecordingPipeline())

    request = build_generation_request_from_video_params(
        pipeline_registry=registry,
        video_params={
            "text": "Scene one.\nScene two.",
            "mode": "fixed",
            "title": "Approved script",
            "tts_voice": "should-not-override-template",
            "media_workflow": "should-not-override-template",
        },
        production_template_id="petwoods_xhs_daily_v1",
    )

    assert request.pipeline_id == "standard"
    assert request.entry == "script"
    assert request.input == {"script": "Scene one.\nScene two."}
    assert request.params["title"] == "Approved script"
    assert request.params["tts_voice"] == "zh-CN-YunjianNeural"
    assert request.params["compose_runtime"] == "html_ffmpeg"
    assert "media_workflow" not in request.params
    assert request.metadata["production_template"]["id"] == "petwoods_xhs_daily_v1"


@pytest.mark.asyncio
async def test_submit_video_params_as_generation_task_does_not_call_legacy_generate_video():
    from web.utils.generation_tasks import submit_video_params_as_generation_task

    pipeline = RecordingPipeline()
    registry = _registry_with_pipeline(pipeline)

    class FakePixelleVideo:
        pipeline_registry = registry

        async def generate_video(self, **kwargs):
            raise AssertionError("UI should submit a GenerationService task")

    task = await submit_video_params_as_generation_task(
        pixelle_video=FakePixelleVideo(),
        video_params={
            "text": "How to keep cats hydrated",
            "mode": "generate",
            "frame_template": "1080x1920/image_default.html",
            "media_width": 1024,
            "media_height": 1024,
        },
        pipeline_id="standard",
        entry_id="topic",
    )

    assert task.status == "completed"
    assert task.result.primary_video.path == "output/task/final.mp4"
    assert pipeline.calls[0]["text"] == "How to keep cats hydrated"
    assert pipeline.calls[0]["mode"] == "generate"


def test_build_generation_request_rejects_unsupported_pipeline_entry():
    from web.utils.generation_tasks import build_generation_request_from_video_params

    registry = _registry_with_pipeline(RecordingPipeline())

    with pytest.raises(ValueError, match="assets"):
        build_generation_request_from_video_params(
            pipeline_registry=registry,
            video_params={"text": "Topic", "mode": "generate"},
            pipeline_id="standard",
            entry_id="assets",
        )


def test_single_output_preview_uses_generation_task_helper():
    from web.components import output_preview

    source = inspect.getsource(output_preview.render_single_output)

    assert "submit_video_params_as_generation_task" in source
    assert "pixelle_video.generate_video" not in source
    assert "build_default_production_template_registry" in source
    assert "generation_pipeline_select" not in source
