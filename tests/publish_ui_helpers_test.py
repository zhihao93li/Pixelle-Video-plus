from web.utils.publish_helpers import build_default_caption


def test_build_default_caption_prefers_title_and_text_preview():
    metadata = {
        "input": {
            "title": "Money patterns",
            "text": "Your chart can show your natural advantage.",
        }
    }

    assert build_default_caption(metadata) == (
        "Money patterns\n\nYour chart can show your natural advantage."
    )


def test_build_default_caption_falls_back_to_text_when_title_missing():
    metadata = {
        "input": {
            "title": "",
            "text": "A long script that still works without a separate title.",
        }
    }

    assert build_default_caption(metadata) == "A long script that still works without a separate title."
