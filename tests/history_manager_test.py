import pytest

from pixelle_video.services.history_manager import HistoryManager
from pixelle_video.services.persistence import PersistenceService


@pytest.mark.asyncio
async def test_history_detail_includes_generation_summary(tmp_path):
    persistence = PersistenceService(output_dir=str(tmp_path / "output"))
    manager = HistoryManager(persistence)
    await persistence.save_task_metadata(
        "task-1",
        {
            "created_at": "2026-06-30T00:00:00",
            "status": "completed",
            "input": {"text": "Scene one.", "title": "Cat hydration"},
            "result": {
                "video_path": "output/task-1/final.mp4",
                "duration": 12.5,
                "file_size": 2048,
                "compose_runtime": "hyperframes",
                "quality_profile": "strict",
                "quality_review": {
                    "status": "passed",
                    "summary": "All quality checks passed.",
                    "checks": [
                        {
                            "id": "video_readable",
                            "status": "passed",
                            "message": "Video is readable.",
                        }
                    ],
                },
                "asset_manifest": {
                    "assets": [
                        {"id": "video-final", "kind": "video", "role": "primary_video"},
                        {"id": "audio-1", "kind": "audio", "role": "voiceover"},
                    ],
                },
            },
        },
    )

    detail = await manager.get_task_detail("task-1")

    assert detail["generation_summary"] == {
        "production_template": None,
        "compose_runtime": "hyperframes",
        "quality_profile": "strict",
        "quality_review": {
            "status": "passed",
            "summary": "All quality checks passed.",
            "failures": [],
        },
        "asset_manifest": {
            "asset_count": 2,
            "roles": ["primary_video", "voiceover"],
            "kinds": ["audio", "video"],
        },
    }


@pytest.mark.asyncio
async def test_history_list_includes_lightweight_artifact_cover(tmp_path):
    persistence = PersistenceService(output_dir=str(tmp_path / "output"))
    manager = HistoryManager(persistence)
    await persistence.save_task_metadata(
        "task-1",
        {
            "created_at": "2026-06-30T00:00:00",
            "status": "completed",
            "input": {"text": "Scene one."},
            "result": {
                "video_path": "output/task-1/final.mp4",
                "duration": 12.5,
                "file_size": 2048,
                "asset_manifest": {
                    "assets": [
                        {
                            "kind": "image",
                            "role": "primary_visual",
                            "path": "output/task-1/frames/01-raw.png",
                        },
                        {
                            "kind": "image",
                            "role": "composed_frame",
                            "path": "output/task-1/frames/01.png",
                        },
                    ]
                },
            },
        },
    )

    listing = await manager.get_task_list()

    assert listing["tasks"][0]["result"] == {
        "artifact_type": "video",
        "cover_path": "output/task-1/frames/01.png",
        "video_path": "output/task-1/final.mp4",
        "duration": 12.5,
        "file_size": 2048,
        "page_count": None,
        "word_count": None,
        "error": None,
    }


@pytest.mark.asyncio
async def test_history_list_prefers_content_title_over_script_preview(tmp_path):
    persistence = PersistenceService(output_dir=str(tmp_path / "output"))
    manager = HistoryManager(persistence)
    await persistence.save_task_metadata(
        "task-1",
        {
            "created_at": "2026-06-30T00:00:00",
            "status": "completed",
            "input": {
                "text": "这是视频文案第一句，不应该被当成作品标题。",
                "title": "",
                "_split_topic": "猫为什么不如狗亲人",
            },
            "result": {"video_path": "output/task-1/final.mp4"},
        },
    )

    listing = await manager.get_task_list()

    assert listing["tasks"][0]["title"] == "猫为什么不如狗亲人"


@pytest.mark.asyncio
async def test_history_list_prefers_generated_artifact_title(tmp_path):
    persistence = PersistenceService(output_dir=str(tmp_path / "output"))
    manager = HistoryManager(persistence)
    await persistence.save_task_metadata(
        "task-1",
        {
            "created_at": "2026-06-30T00:00:00",
            "status": "completed",
            "input": {"title": "提交时标题"},
            "result": {
                "title": "最终成品标题",
                "video_path": "output/task-1/final.mp4",
            },
        },
    )

    listing = await manager.get_task_list()

    assert listing["tasks"][0]["title"] == "最终成品标题"
