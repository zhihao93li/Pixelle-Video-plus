from types import SimpleNamespace

import pytest

from pixelle_video.models.storyboard import Storyboard, StoryboardConfig, StoryboardFrame
from pixelle_video.services.frame_processor import FrameProcessor


@pytest.mark.asyncio
async def test_frame_processor_prefers_existing_image_even_when_prompt_is_retained(monkeypatch):
    processor = FrameProcessor(SimpleNamespace())
    calls = []

    async def fake_audio(frame, config):
        frame.audio_path = "/tmp/audio.mp3"

    async def forbidden_media(*args, **kwargs):
        calls.append("media")

    async def fake_compose(*args, **kwargs):
        calls.append("compose")

    async def fake_segment(*args, **kwargs):
        calls.append("segment")

    monkeypatch.setattr(processor, "_step_generate_audio", fake_audio)
    monkeypatch.setattr(processor, "_step_generate_media", forbidden_media)
    monkeypatch.setattr(processor, "_step_compose_frame", fake_compose)
    monkeypatch.setattr(processor, "_step_create_video_segment", fake_segment)

    config = StoryboardConfig(media_width=1080, media_height=1920, task_id="task-1")
    frame = StoryboardFrame(
        index=0,
        narration="Confirmed narration",
        image_prompt="Prompt retained for provenance",
        image_path="/tmp/codex-image.png",
        media_type="image",
    )
    storyboard = Storyboard(title="Title", config=config, frames=[frame])

    await processor(frame=frame, storyboard=storyboard, config=config)

    assert calls == ["compose", "segment"]


def test_frame_processor_builds_provider_progress_detail_for_runninghub_media():
    core = SimpleNamespace(
        config={
            "comfyui": {
                "runninghub_timeout": 600,
                "image": {"default_workflow": "runninghub/image_flux.json"},
            }
        }
    )
    processor = FrameProcessor(core)

    detail = processor._build_media_progress_detail(
        StoryboardConfig(
            media_width=1080,
            media_height=1920,
            media_workflow=None,
        )
    )

    assert detail == {
        "provider": "runninghub",
        "workflow": "runninghub/image_flux.json",
        "media_type": "image",
    }


def test_frame_processor_builds_provider_progress_detail_for_video_workflow():
    core = SimpleNamespace(config={"comfyui": {"runninghub_timeout": 600}})
    processor = FrameProcessor(core)

    detail = processor._build_media_progress_detail(
        StoryboardConfig(
            media_width=1080,
            media_height=1920,
            media_workflow="selfhost/video_wan2.1_fusionx.json",
        )
    )

    assert detail == {
        "provider": "selfhost",
        "workflow": "selfhost/video_wan2.1_fusionx.json",
        "media_type": "video",
    }


def test_frame_processor_reports_direct_image_provider_and_model():
    processor = FrameProcessor(SimpleNamespace(config={"comfyui": {}}))

    detail = processor._build_media_progress_detail(
        StoryboardConfig(
            media_width=1080,
            media_height=1920,
            image_provider="aliyun_bailian",
            image_model="qwen-image-2.0",
        )
    )

    assert detail == {
        "provider": "aliyun_bailian",
        "workflow": "default",
        "media_type": "image",
        "model": "qwen-image-2.0",
    }


@pytest.mark.asyncio
async def test_frame_processor_reports_provider_task_status_during_media_generation(
    monkeypatch,
):
    events = []

    class FakeMediaResult:
        media_type = "image"
        url = "https://example.com/image.png"
        is_image = True
        is_video = False
        duration = None

    async def fake_media(**kwargs):
        kwargs["provider_progress_callback"](
            {
                "provider": "runninghub",
                "provider_task_id": "rh-task-1",
                "provider_status": "QUEUED",
                "runninghub_timeout": 1200,
            }
        )
        return FakeMediaResult()

    core = SimpleNamespace(
        config={
            "comfyui": {
                "runninghub_timeout": 600,
                "image": {"default_workflow": "runninghub/image_flux.json"},
            }
        },
        media=fake_media,
    )
    processor = FrameProcessor(core)

    async def fake_download_media(*args, **kwargs):
        return "output/task/frame-1.png"

    monkeypatch.setattr(
        processor,
        "_download_media",
        fake_download_media,
    )

    frame = SimpleNamespace(
        index=0,
        image_prompt="A calm pet portrait",
        duration=None,
        media_type=None,
        image_path=None,
        video_path=None,
    )

    await processor._step_generate_media(
        frame,
        StoryboardConfig(
            media_width=1080,
            media_height=1920,
            media_workflow=None,
            task_id="task-1",
        ),
        progress_callback=events.append,
        total_frames=1,
    )

    assert frame.image_path == "output/task/frame-1.png"
    assert events[-1].event_type == "frame_step"
    assert events[-1].action == "media"
    assert events[-1].detail == {
        "provider": "runninghub",
        "workflow": "runninghub/image_flux.json",
        "media_type": "image",
        "runninghub_timeout": 1200,
        "provider_task_id": "rh-task-1",
        "provider_status": "QUEUED",
    }
