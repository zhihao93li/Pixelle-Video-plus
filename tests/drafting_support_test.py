from pathlib import Path

import pytest

from pixelle_video.config.schema import AIHUBMIX_BASE_URL
from pixelle_video.generation.drafting_support import (
    DraftParseError,
    generate_independent_language_scripts,
    parse_language_script_payload,
    parse_narrations_response,
    parse_script_response,
    parse_title_response,
    render_language_script_prompt,
    render_language_title_prompt,
    render_prompt_template,
)
from pixelle_video.services.llm_service import LLMService, build_completion_token_kwargs


class FakeLLM:
    def __init__(self):
        self.calls = []

    async def __call__(self, prompt, **kwargs):
        self.calls.append({"prompt": prompt, **kwargs})
        if "Write Chinese script" in prompt:
            return '{"title": "中文标题", "script": "中文一。中文二。中文三。"}'
        if "Write English script" in prompt:
            return '{"title": "English Title", "script": "English one. English two."}'
        return '{"script": "Scene one. Scene two."}'


class MissingLanguageTitleLLM:
    def __init__(self):
        self.calls = []

    async def __call__(self, prompt, **kwargs):
        self.calls.append({"prompt": prompt, **kwargs})
        if "Create a short native Chinese title" in prompt:
            return '{"title": "关键时刻掉链子"}'
        if "Create a short native English title" in prompt:
            return '{"title": "Why Pressure Makes You Freeze"}'
        if "Write Chinese script" in prompt:
            return '{"script": "中文一。中文二。"}'
        if "Write English script" in prompt:
            return '{"script": "You freeze under pressure. It is not a lack of skill."}'
        return '{"script": "Fallback script."}'


class EmptyChineseTitleLLM(MissingLanguageTitleLLM):
    async def __call__(self, prompt, **kwargs):
        self.calls.append({"prompt": prompt, **kwargs})
        if "Create a short native Chinese title" in prompt:
            return ""
        if "Write Chinese script" in prompt:
            return '{"script": "中文一。中文二。"}'
        return '{"script": "Fallback script."}'


class MissingLanguageTitleModelLLM(MissingLanguageTitleLLM):
    pass


class PlainEnglishScriptThenRepairLLM:
    def __init__(self):
        self.calls = []

    async def __call__(self, prompt, **kwargs):
        self.calls.append({"prompt": prompt, **kwargs})
        if "Normalize this English script-generation response" in prompt:
            return '{"title": "Why Pressure Makes You Freeze", "script": "You freeze under pressure. It is not a lack of skill."}'
        if "Write English script" in prompt:
            return "You freeze under pressure. It is not a lack of skill."
        return '{"title": "Fallback", "script": "Fallback script."}'


def test_bazi_prompt_templates_request_title_and_script():
    root = Path(__file__).resolve().parents[1]
    chinese_prompt = (
        root / "data/prompt_templates/script/bazi_storyboard_oral_script.md"
    ).read_text(encoding="utf-8")
    english_prompt = (
        root / "data/prompt_templates/script/bazi_storyboard_oral_script_english.md"
    ).read_text(encoding="utf-8")

    assert '"title"' in chinese_prompt
    assert '"script"' in chinese_prompt
    assert '"title"' in english_prompt
    assert '"script"' in english_prompt


def test_parse_script_response_accepts_script_json():
    assert (
        parse_script_response('```json\n{"script": "A full oral script."}\n```')
        == "A full oral script."
    )


def test_parse_language_script_payload_does_not_invent_title_from_script():
    payload = parse_language_script_payload(
        '{"script": "This is a long opening hook that should not become a title."}'
    )

    assert payload == {
        "title": "",
        "script": "This is a long opening hook that should not become a title.",
    }


def test_parse_title_response_requires_title():
    assert (
        parse_title_response('```json\n{"title": "Why Pressure Makes You Freeze"}\n```')
        == "Why Pressure Makes You Freeze"
    )

    with pytest.raises(DraftParseError, match="missing 'title'"):
        parse_title_response('{"script": "No title here."}')


def test_render_language_title_prompt_uses_topic_and_same_language_script_context():
    prompt = render_language_title_prompt(
        topic="测试",
        language="English",
        script="You freeze under pressure. It is not a lack of skill.",
    )

    assert "Original topic:\n测试" in prompt
    assert "You freeze under pressure" in prompt
    assert "Title must be written in English" in prompt
    assert "Source Chinese title" not in prompt
    assert '"title": "short native English title"' in prompt


def test_parse_narrations_response_accepts_markdown_json():
    assert parse_narrations_response('```json\n{"narrations": ["A", "B"]}\n```') == ["A", "B"]


def test_render_prompt_template_replaces_supported_variables():
    rendered = render_prompt_template(
        'Topic={topic}; Count={narration_count}; Script={source_script}; JSON={{"script":"x"}}',
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
    assert '"title": "short native English video title"' in prompt
    assert '"script": "complete English spoken script"' in prompt
    assert "Write a short script for Money patterns." in prompt


def test_llm_service_defaults_to_aihubmix_relay_base_url():
    client = LLMService()._create_client(api_key="test-key")

    assert str(client.base_url).rstrip("/") == AIHUBMIX_BASE_URL


def test_gpt5_models_use_max_completion_tokens():
    assert build_completion_token_kwargs("gpt-5-mini", 3000) == {"max_completion_tokens": 3000}


def test_non_gpt5_models_keep_max_tokens():
    assert build_completion_token_kwargs("doubao-seed-2-0-lite-260428", 3000) == {
        "max_tokens": 3000
    }


@pytest.mark.asyncio
async def test_generate_independent_language_scripts_creates_each_language_without_translation():
    fake_llm = FakeLLM()
    statuses = []

    draft = await generate_independent_language_scripts(
        llm_service=fake_llm,
        topic="Money patterns",
        script_template="Write {language} script for {topic}.",
        script_model="script-model",
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
            "narrations": [],
        },
        "English": {
            "title": "English Title",
            "script": "English one. English two.",
            "narrations": [],
        },
    }
    assert draft["selected_languages"] == ["Chinese", "English"]
    assert "translations" not in draft
    assert [call["model"] for call in fake_llm.calls] == [
        "script-model",
        "script-model",
    ]
    assert not any("Translate" in call["prompt"] for call in fake_llm.calls)
    assert "Write Chinese script for Money patterns." in fake_llm.calls[0]["prompt"]
    assert "Write English script for Money patterns." in fake_llm.calls[1]["prompt"]
    assert "Create this version directly in English" in fake_llm.calls[1]["prompt"]
    assert statuses == [
        ("generating_script", "Chinese"),
        ("generating_script", "English"),
    ]


@pytest.mark.asyncio
async def test_generate_independent_language_scripts_builds_missing_titles_per_language_without_cross_language_context():
    fake_llm = MissingLanguageTitleLLM()
    statuses = []

    draft = await generate_independent_language_scripts(
        llm_service=fake_llm,
        topic="测试",
        script_template="Write {language} script for {topic}.",
        script_model="script-model",
        languages=["Chinese", "English"],
        language_script_templates={
            "English": "Write English script for {topic}.",
        },
        status_callback=lambda stage, detail: statuses.append((stage, detail)),
    )

    assert draft["language_drafts"]["Chinese"]["title"] == "关键时刻掉链子"
    assert draft["language_drafts"]["English"]["title"] == "Why Pressure Makes You Freeze"
    assert (
        draft["language_drafts"]["English"]["script"]
        == "You freeze under pressure. It is not a lack of skill."
    )
    assert [call["model"] for call in fake_llm.calls] == [
        "script-model",
        "script-model",
        "script-model",
        "script-model",
    ]
    chinese_title_prompt = fake_llm.calls[2]["prompt"]
    english_title_prompt = fake_llm.calls[3]["prompt"]
    assert "中文一。中文二。" in chinese_title_prompt
    assert "You freeze under pressure" in english_title_prompt
    assert "关键时刻掉链子" not in english_title_prompt
    assert "中文一。中文二。" not in english_title_prompt
    assert not any("Translate" in call["prompt"] for call in fake_llm.calls)
    assert statuses == [
        ("generating_script", "Chinese"),
        ("generating_script", "English"),
        ("generating_title", "Chinese"),
        ("generating_title", "English"),
    ]


@pytest.mark.asyncio
async def test_generate_independent_language_scripts_reports_empty_title_stage():
    with pytest.raises(
        DraftParseError, match="Chinese title generation failed: LLM response is empty"
    ):
        await generate_independent_language_scripts(
            llm_service=EmptyChineseTitleLLM(),
            topic="测试",
            script_template="Write {language} script for {topic}.",
            script_model="script-model",
            languages=["Chinese"],
        )


@pytest.mark.asyncio
async def test_generate_independent_language_scripts_repairs_plain_text_script_response():
    fake_llm = PlainEnglishScriptThenRepairLLM()

    draft = await generate_independent_language_scripts(
        llm_service=fake_llm,
        topic="测试",
        script_template="Write {language} script for {topic}.",
        script_model="english-script-model",
        languages=["English"],
    )

    assert draft["language_drafts"]["English"] == {
        "title": "Why Pressure Makes You Freeze",
        "script": "You freeze under pressure. It is not a lack of skill.",
        "narrations": [],
    }
    assert [call["model"] for call in fake_llm.calls] == [
        "english-script-model",
        "english-script-model",
    ]
    assert "Normalize this English script-generation response" in fake_llm.calls[1]["prompt"]


@pytest.mark.asyncio
async def test_generate_independent_language_scripts_uses_language_script_models_for_script_and_title():
    fake_llm = MissingLanguageTitleModelLLM()

    draft = await generate_independent_language_scripts(
        llm_service=fake_llm,
        topic="测试",
        script_template="Write {language} script for {topic}.",
        script_model="default-script-model",
        languages=["Chinese", "English"],
        language_script_templates={
            "English": "Write English script for {topic}.",
        },
        language_script_models={
            "Chinese": "chinese-script-model",
            "English": "english-script-model",
        },
    )

    assert draft["language_script_models"] == {
        "Chinese": {"provider_id": "", "model": "chinese-script-model"},
        "English": {"provider_id": "", "model": "english-script-model"},
    }
    assert [call["model"] for call in fake_llm.calls] == [
        "chinese-script-model",
        "english-script-model",
        "chinese-script-model",
        "english-script-model",
    ]


@pytest.mark.asyncio
async def test_language_overrides_route_each_language_to_its_real_provider():
    fake_llm = MissingLanguageTitleModelLLM()
    await generate_independent_language_scripts(
        llm_service=fake_llm,
        topic="测试",
        script_template="Write {language} script for {topic}.",
        script_provider_id="aihubmix-main",
        script_model="default-model",
        languages=["Chinese", "English"],
        language_script_models={
            "Chinese": {"provider_id": "aihubmix-main", "model": "qwen-max"},
            "English": {"provider_id": "openai-direct", "model": "gpt-4.1"},
        },
    )

    script_calls = [call for call in fake_llm.calls if "script for" in call["prompt"]]
    assert [(call["provider_id"], call["model"]) for call in script_calls] == [
        ("aihubmix-main", "qwen-max"),
        ("openai-direct", "gpt-4.1"),
    ]
    assert [(call["provider_id"], call["model"]) for call in fake_llm.calls] == [
        ("aihubmix-main", "qwen-max"),
        ("openai-direct", "gpt-4.1"),
        ("aihubmix-main", "qwen-max"),
        ("openai-direct", "gpt-4.1"),
    ]


@pytest.mark.asyncio
async def test_generate_independent_language_scripts_falls_back_to_default_script_model_per_language():
    fake_llm = MissingLanguageTitleModelLLM()

    draft = await generate_independent_language_scripts(
        llm_service=fake_llm,
        topic="测试",
        script_template="Write {language} script for {topic}.",
        script_model="default-script-model",
        languages=["Chinese", "English"],
        language_script_templates={
            "English": "Write English script for {topic}.",
        },
        language_script_models={
            "English": "english-script-model",
        },
    )

    assert draft["language_script_models"] == {
        "Chinese": {"provider_id": "", "model": "default-script-model"},
        "English": {"provider_id": "", "model": "english-script-model"},
    }
    assert [call["model"] for call in fake_llm.calls] == [
        "default-script-model",
        "english-script-model",
        "default-script-model",
        "english-script-model",
    ]
