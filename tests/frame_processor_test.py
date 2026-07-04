from types import SimpleNamespace

import pytest

from pixelle_video.models.storyboard import StoryboardConfig
from pixelle_video.services.frame_processor import FrameProcessor


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
        "runninghub_timeout": 600,
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
        "runninghub_timeout": 600,
        "provider_task_id": "rh-task-1",
        "provider_status": "QUEUED",
    }
