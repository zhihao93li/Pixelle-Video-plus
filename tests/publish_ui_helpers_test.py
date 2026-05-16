from web.utils.publish_helpers import (
    append_hashtags_to_caption,
    build_default_caption,
    build_default_title,
)


def test_build_default_title_uses_persisted_input_title():
    metadata = {
        "input": {
            "title": "Money patterns",
            "text": "Your chart can show your natural advantage.",
        }
    }

    assert build_default_title(metadata) == "Money patterns"


def test_build_default_title_falls_back_to_first_text_line():
    metadata = {
        "input": {
            "title": "",
            "text": "\n\nFirst publish title\n\nCaption body.",
        }
    }

    assert build_default_title(metadata) == "First publish title"


def test_build_default_caption_uses_text_without_repeating_title():
    metadata = {
        "input": {
            "title": "Money patterns",
            "text": "Your chart can show your natural advantage.",
        }
    }

    assert build_default_caption(metadata) == "Your chart can show your natural advantage."


def test_build_default_caption_falls_back_to_text_when_title_missing():
    metadata = {
        "input": {
            "title": "",
            "text": "A long script that still works without a separate title.",
        }
    }

    assert build_default_caption(metadata) == "A long script that still works without a separate title."


def test_build_default_caption_removes_legacy_fixed_title_line():
    metadata = {
        "input": {
            "mode": "fixed",
            "title": "",
            "text": "Legacy fixed title\n\nCaption body.",
        }
    }

    assert build_default_caption(metadata) == "Caption body."


def test_append_hashtags_to_caption_adds_separate_block():
    assert append_hashtags_to_caption("Caption text", "#ai #video") == "Caption text\n\n#ai #video"


def test_append_hashtags_to_caption_normalizes_words_without_hash_prefix():
    assert append_hashtags_to_caption("Caption text", "ai, video\nshorts") == (
        "Caption text\n\n#ai #video #shorts"
    )
