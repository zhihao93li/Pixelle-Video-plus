from types import SimpleNamespace

from web.components.content_input import parse_batch_text_input
from web.utils.batch_manager import SimpleBatchManager


class FakePixelleVideo:
    def __init__(self):
        self.calls = []

    async def generate_video(self, **kwargs):
        self.calls.append(kwargs)
        task_id = f"task_{len(self.calls)}"
        return SimpleNamespace(video_path=f"output/{task_id}/final.mp4")


def test_parse_fixed_batch_scripts_preserves_multiline_scripts():
    text = """First script line one.
First script line two.

---

Second script paragraph one.

Second script paragraph two."""

    scripts = parse_batch_text_input(text, mode="fixed")

    assert scripts == [
        "First script line one.\nFirst script line two.",
        "Second script paragraph one.\n\nSecond script paragraph two.",
    ]


def test_parse_generate_batch_topics_uses_one_topic_per_line():
    text = """
First topic

Second topic
"""

    topics = parse_batch_text_input(text, mode="generate")

    assert topics == ["First topic", "Second topic"]


def test_batch_manager_runs_fixed_mode_without_using_script_as_title():
    fake = FakePixelleVideo()
    manager = SimpleBatchManager()

    result = manager.execute_batch(
        pixelle_video=fake,
        topics=["Scene one.\n\nScene two."],
        shared_config={
            "mode": "fixed",
            "split_mode": "paragraph",
            "frame_template": "1080x1920/image_default.html",
        },
    )

    assert result["success_count"] == 1
    assert fake.calls == [
        {
            "text": "Scene one.\n\nScene two.",
            "mode": "fixed",
            "split_mode": "paragraph",
            "frame_template": "1080x1920/image_default.html",
        }
    ]


def test_batch_manager_can_title_fixed_mode_with_prefix_and_index():
    fake = FakePixelleVideo()
    manager = SimpleBatchManager()

    manager.execute_batch(
        pixelle_video=fake,
        topics=["First script", "Second script"],
        shared_config={
            "mode": "fixed",
            "split_mode": "line",
            "title_prefix": "Batch Script",
        },
    )

    assert fake.calls[0]["title"] == "Batch Script - 1"
    assert fake.calls[1]["title"] == "Batch Script - 2"
