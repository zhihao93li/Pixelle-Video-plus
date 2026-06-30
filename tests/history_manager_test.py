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
                        {"id": "video_readable", "status": "passed", "message": "Video is readable."}
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
