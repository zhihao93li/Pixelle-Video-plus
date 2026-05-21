import pytest

from pixelle_video.config.schema import AIHUBMIX_BASE_URL
from pixelle_video.models.progress import ProgressEvent
from pixelle_video.services.llm_service import LLMService, build_completion_token_kwargs
from web.components.script_review_workflow import _overall_video_progress, _video_event_label
from web.utils.script_review import (
    DraftParseError,
    DraftTranslationCountError,
    SOURCE_LANGUAGE_KEY,
    build_generation_jobs,
    draft_titles,
    generate_independent_language_drafts,
    generate_multilingual_script_draft,
    parse_narrations_response,
    parse_script_response,
    parse_translation_payload,
    parse_translations_response,
    render_language_script_prompt,
    render_prompt_template,
    validate_language_tts_overrides,
)


class FakeLLM:
    def __init__(self):
        self.calls = []

    async def __call__(self, prompt, **kwargs):
        self.calls.append({"prompt": prompt, **kwargs})
        if "Translate" in prompt:
            return '{"title": "Translated title", "translations": ["Translated one.", "Translated two."]}'
        if "Split this Chinese script" in prompt:
            return '{"narrations": ["中文一。", "中文二。", "中文三。"]}'
        if "Split this English script" in prompt:
            return '{"narrations": ["English one.", "English two."]}'
        if "Write Chinese script" in prompt:
            return '{"title": "中文标题", "script": "中文一。中文二。中文三。"}'
        if "Write English script" in prompt:
            return '{"title": "English Title", "script": "English one. English two."}'
        if "Split" in prompt:
            return '```json\n{"narrations": ["Scene one.", "Scene two."]}\n```'
        return '{"script": "Scene one. Scene two."}'


def test_parse_script_response_accepts_script_json():
    assert parse_script_response('```json\n{"script": "A full oral script."}\n```') == "A full oral script."


def test_parse_narrations_response_accepts_markdown_json():
    assert parse_narrations_response('```json\n{"narrations": ["A", "B"]}\n```') == ["A", "B"]


def test_parse_translations_response_rejects_count_mismatch():
    with pytest.raises(DraftTranslationCountError, match="expected 2"):
        parse_translations_response('{"translations": ["Only one"]}', expected_count=2, language="English")


def test_parse_translation_payload_accepts_optional_title():
    payload = parse_translation_payload(
        '{"title": "English title", "translations": ["One", "Two"]}',
        expected_count=2,
        language="English",
    )

    assert payload == {"title": "English title", "translations": ["One", "Two"]}


def test_render_prompt_template_replaces_supported_variables():
    rendered = render_prompt_template(
        "Topic={topic}; Count={narration_count}; Script={source_script}; JSON={{\"script\":\"x\"}}",
        {
            "topic": "Money patterns",
            "narration_count": 2,
            "source_script": "A\nB",
        },
    )

    assert rendered == 'Topic=Money patterns; Count=2; Script=A\nB; JSON={"script":"x"}'


def test_render_language_script_prompt_wraps_templates_without_language_variable():
    prompt = render_language_script_prompt(
        "Write a short script for {topic}.",
        topic="Money patterns",
        language="English",
    )

    assert "Create this version directly in English" in prompt
    assert "Do not answer in Chinese unless the target language is Chinese" in prompt
    assert "Write a short script for Money patterns." in prompt


def test_llm_service_defaults_to_aihubmix_relay_base_url():
    client = LLMService({})._create_client(api_key="test-key")

    assert str(client.base_url).rstrip("/") == AIHUBMIX_BASE_URL


def test_gpt5_models_use_max_completion_tokens():
    assert build_completion_token_kwargs("gpt-5-mini", 3000) == {"max_completion_tokens": 3000}


def test_non_gpt5_models_keep_max_tokens():
    assert build_completion_token_kwargs("doubao-seed-2-0-lite-260428", 3000) == {"max_tokens": 3000}


def test_review_video_progress_combines_job_and_frame_progress():
    assert _overall_video_progress(job_index=2, total_jobs=4, event_progress=0.5) == 0.375


def test_review_video_event_label_exposes_frame_step():
    message = _video_event_label(
        ProgressEvent(
            event_type="frame_step",
            progress=0.5,
            frame_current=3,
            frame_total=21,
            step=2,
            action="media",
        )
    )

    assert "3/21" in message
    assert "2/4" in message


@pytest.mark.asyncio
async def test_generate_multilingual_script_draft_uses_model_overrides_and_templates():
    fake_llm = FakeLLM()
    statuses = []

    draft = await generate_multilingual_script_draft(
        llm_service=fake_llm,
        topic="Money patterns",
        script_template="Write script JSON for {topic}.",
        script_model="script-model",
        split_template="Split this script: {script}",
        split_model="split-model",
        translation_template="Translate to {language}: {source_script_json}",
        translation_model="translation-model",
        target_languages=["English"],
        status_callback=lambda stage, detail: statuses.append((stage, detail)),
    )

    assert draft["title"] == "Money patterns"
    assert draft["source_script"] == "Scene one. Scene two."
    assert draft["source_narrations"] == ["Scene one.", "Scene two."]
    assert draft["titles"] == {
        SOURCE_LANGUAGE_KEY: "Money patterns",
        "English": "Translated title",
    }
    assert draft["translations"]["English"] == ["Translated one.", "Translated two."]
    assert draft["selected_languages"] == [SOURCE_LANGUAGE_KEY, "English"]
    assert fake_llm.calls[0]["model"] == "script-model"
    assert fake_llm.calls[1]["model"] == "split-model"
    assert fake_llm.calls[2]["model"] == "translation-model"
    assert "Scene one. Scene two." in fake_llm.calls[1]["prompt"]
    assert '"Scene one."' in fake_llm.calls[2]["prompt"]
    assert statuses == [
        ("generating_script", "Money patterns"),
        ("splitting_script", "Money patterns"),
        ("translating", "English"),
    ]


@pytest.mark.asyncio
async def test_generate_independent_language_drafts_creates_each_language_without_translation():
    fake_llm = FakeLLM()
    statuses = []

    draft = await generate_independent_language_drafts(
        llm_service=fake_llm,
        topic="Money patterns",
        script_template="Write {language} script for {topic}.",
        script_model="script-model",
        split_template="Split this {language} script: {script}",
        split_model="split-model",
        languages=["Chinese", "English"],
        language_script_templates={
            "English": "Write English script for {topic}.",
        },
        status_callback=lambda stage, detail: statuses.append((stage, detail)),
    )

    assert draft["language_drafts"] == {
        "Chinese": {
            "title": "中文标题",
            "script": "中文一。中文二。中文三。",
            "narrations": ["中文一。", "中文二。", "中文三。"],
        },
        "English": {
            "title": "English Title",
            "script": "English one. English two.",
            "narrations": ["English one.", "English two."],
        },
    }
    assert draft["selected_languages"] == ["Chinese", "English"]
    assert "translations" not in draft
    assert [call["model"] for call in fake_llm.calls] == [
        "script-model",
        "split-model",
        "script-model",
        "split-model",
    ]
    assert not any("Translate" in call["prompt"] for call in fake_llm.calls)
    assert "Write Chinese script for Money patterns." in fake_llm.calls[0]["prompt"]
    assert "Write English script for Money patterns." in fake_llm.calls[2]["prompt"]
    assert "Create this version directly in English" in fake_llm.calls[2]["prompt"]
    assert "Every narration item in the JSON output must remain in English" in fake_llm.calls[3]["prompt"]
    assert statuses == [
        ("generating_script", "Chinese"),
        ("splitting_script", "Chinese"),
        ("generating_script", "English"),
        ("splitting_script", "English"),
    ]


def test_build_generation_jobs_uses_independent_language_fish_tts_params():
    drafts = [
        {
            "topic": "Money patterns",
            "language_drafts": {
                "Chinese": {
                    "title": "中文标题",
                    "script": "中文一。中文二。中文三。",
                    "narrations": ["中文一。", "中文二。", "中文三。"],
                },
                "English": {
                    "title": "English Title",
                    "script": "English one. English two.",
                    "narrations": ["English one.", "English two."],
                },
            },
            "script_model": "script-model",
            "split_model": "split-model",
            "selected_languages": ["Chinese", "English"],
            "workflow_mode": "independent_language_drafts",
        }
    ]

    jobs = build_generation_jobs(
        drafts,
        base_config={"frame_template": "1080x1920/image_default.html", "tts_inference_mode": "fish"},
        language_tts_overrides={
            "Chinese": {"tts_inference_mode": "fish", "tts_voice": "cn-ref", "tts_speed": 1.0},
            "English": {"tts_inference_mode": "fish", "tts_voice": "en-ref", "tts_speed": 0.9},
        },
    )

    assert jobs[0]["language"] == "Chinese"
    assert jobs[0]["params"]["text"] == "中文一。\n中文二。\n中文三。"
    assert jobs[0]["params"]["title"] == "中文标题"
    assert jobs[0]["params"]["tts_inference_mode"] == "fish"
    assert jobs[0]["params"]["tts_voice"] == "cn-ref"
    assert jobs[0]["params"]["tts_speed"] == 1.0
    assert jobs[0]["params"]["review_language"] == "Chinese"
    assert jobs[0]["params"]["review_language_narrations"] == ["中文一。", "中文二。", "中文三。"]

    assert jobs[1]["language"] == "English"
    assert jobs[1]["params"]["text"] == "English one.\nEnglish two."
    assert jobs[1]["params"]["title"] == "English Title"
    assert jobs[1]["params"]["tts_voice"] == "en-ref"
    assert jobs[1]["params"]["tts_speed"] == 0.9
    assert jobs[1]["params"]["review_language_script"] == "English one. English two."


def test_validate_language_tts_overrides_blocks_missing_fish_reference_id():
    drafts = [
        {
            "topic": "Money patterns",
            "language_drafts": {
                "Chinese": {"title": "中文标题", "script": "中文一。", "narrations": ["中文一。"]},
                "English": {"title": "English Title", "script": "English one.", "narrations": ["English one."]},
            },
            "selected_languages": ["Chinese", "English"],
        }
    ]

    errors = validate_language_tts_overrides(
        drafts,
        {
            "Chinese": {"tts_inference_mode": "fish", "tts_voice": "cn-ref", "tts_speed": 1.0},
            "English": {"tts_inference_mode": "fish", "tts_voice": "", "tts_speed": 1.0},
        },
    )

    assert errors == ["Money patterns / English: Fish reference_id is required"]


def test_build_generation_jobs_blocks_english_draft_with_chinese_text():
    drafts = [
        {
            "topic": "Money patterns",
            "language_drafts": {
                "English": {
                    "title": "中文标题",
                    "script": "这还是中文。",
                    "narrations": ["这还是中文。"],
                },
            },
            "selected_languages": ["English"],
        }
    ]

    with pytest.raises(DraftParseError, match="expected English text"):
        build_generation_jobs(
            drafts,
            base_config={"tts_inference_mode": "fish"},
            language_tts_overrides={
                "English": {"tts_inference_mode": "fish", "tts_voice": "en-ref", "tts_speed": 1.0},
            },
        )


def test_build_generation_jobs_uses_edited_translation_as_fixed_line_script():
    drafts = [
        {
            "topic": "Money patterns",
            "title": "Edited title",
            "titles": {
                SOURCE_LANGUAGE_KEY: "Edited source title",
                "English": "Edited English title",
            },
            "source_script": "Original complete script.",
            "source_narrations": ["Scene one.", "Scene two."],
            "translations": {
                "English": ["Edited one.", "Edited two."],
                "Japanese": ["翻訳一。", "翻訳二。"],
            },
            "script_model": "script-model",
            "split_model": "split-model",
            "translation_model": "translation-model",
            "selected_languages": [SOURCE_LANGUAGE_KEY, "English"],
        }
    ]

    jobs = build_generation_jobs(drafts, base_config={"frame_template": "1080x1920/image_default.html"})

    assert jobs == [
        {
            "topic": "Money patterns",
            "language": SOURCE_LANGUAGE_KEY,
            "params": {
                "text": "Scene one.\nScene two.",
                "mode": "fixed",
                "split_mode": "line",
                "title": "Edited source title",
                "frame_template": "1080x1920/image_default.html",
                "review_topic": "Money patterns",
                "review_language": SOURCE_LANGUAGE_KEY,
                "review_source_script": "Original complete script.",
                "review_source_narrations": ["Scene one.", "Scene two."],
                "review_script_model": "script-model",
                "review_split_model": "split-model",
                "review_translation_model": "translation-model",
            },
        },
        {
            "topic": "Money patterns",
            "language": "English",
            "params": {
                "text": "Edited one.\nEdited two.",
                "mode": "fixed",
                "split_mode": "line",
                "title": "Edited English title",
                "frame_template": "1080x1920/image_default.html",
                "review_topic": "Money patterns",
                "review_language": "English",
                "review_source_script": "Original complete script.",
                "review_source_narrations": ["Scene one.", "Scene two."],
                "review_script_model": "script-model",
                "review_split_model": "split-model",
                "review_translation_model": "translation-model",
            },
        }
    ]


def test_draft_titles_falls_back_to_first_translation_for_target_title():
    titles = draft_titles(
        {
            "topic": "中文主题",
            "source_narrations": ["中文一。"],
            "translations": {"English": ["English first scene.", "English second scene."]},
        }
    )

    assert titles[SOURCE_LANGUAGE_KEY] == "中文主题"
    assert titles["English"] == "English first scene."
