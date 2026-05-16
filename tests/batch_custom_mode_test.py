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


def test_batch_manager_uses_first_fixed_line_as_title_and_removes_it_from_script():
    fake = FakePixelleVideo()
    manager = SimpleBatchManager()

    result = manager.execute_batch(
        pixelle_video=fake,
        topics=["My video title\nScene one.\n\nScene two."],
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
            "title": "My video title",
            "split_mode": "paragraph",
            "frame_template": "1080x1920/image_default.html",
        }
    ]


def test_batch_manager_uses_title_prefix_for_generate_mode():
    fake = FakePixelleVideo()
    manager = SimpleBatchManager()

    manager.execute_batch(
        pixelle_video=fake,
        topics=["First topic", "Second topic"],
        shared_config={
            "mode": "generate",
            "title_prefix": "Batch Script",
        },
    )

    assert fake.calls[0]["title"] == "Batch Script - First topic"
    assert fake.calls[1]["title"] == "Batch Script - Second topic"


def test_batch_manager_keeps_single_line_fixed_script_as_body_and_title():
    fake = FakePixelleVideo()
    manager = SimpleBatchManager()

    manager.execute_batch(
        pixelle_video=fake,
        topics=["Single line script"],
        shared_config={
            "mode": "fixed",
            "split_mode": "line",
        },
    )

    assert fake.calls[0]["title"] == "Single line script"
    assert fake.calls[0]["text"] == "Single line script"
