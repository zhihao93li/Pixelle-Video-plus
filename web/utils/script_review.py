"""Helpers for the multilingual script review workflow."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from string import Formatter
from typing import Any

from pixelle_video.utils.os_util import get_data_path

DEFAULT_TARGET_LANGUAGES = ["English", "Japanese", "Korean", "Spanish", "Traditional Chinese"]
SOURCE_LANGUAGE_KEY = "__source__"

BUILTIN_SCRIPT_TEMPLATES = {
    "Short Oral Script": """You are a short-form video script writer.
Create a concise oral narration script for this topic:

{topic}

Return ONLY valid JSON in this format:
{{
  "script": "complete oral narration script"
}}

Requirements:
- Write one complete script, not storyboard scenes.
- Keep the script logical, direct, and suitable for voiceover.
- Do not add markdown or explanations.""",
}

BUILTIN_SPLIT_TEMPLATES = {
    "Copy-Safe Scene Split": """# 角色
你是专业的文案分镜分割师，面对输入的文案，需保证原文案文字内容绝对不变，按特定规则分割且不打断句子。

## 输入原文案
{Content}

## 技能
### 技能 1: 文案分割
1. 仔细剖析输入原文案。
2. 分割时必须保证原文案文字不变、不破坏句子完整性。
3. 按照每段10到25字之间进行分段。每段最低不得低于10个字。
4. 准确输出分割后的文案段落，以字符串数组形式呈现。

## 示例
原文案：深夜给他发了十几条微信，每一条都像是向深渊里投下的石子，没有回音。
宝子啊，你是不是这样，谁不理你，就越会爱上谁。不回复一条消息，内心就兵荒马乱；对方三小时不回应，就能脑补出一百种被抛弃的场景。
无底线地付出，生怕对方离开；需要伴侣随时回应，否则就胡思乱想；情绪内耗到凌晨三点，不是把伴侣逼疯，就是自己失望透顶。
而我们最爱的，往往是那种若即若离的回避型伴侣。他们冷淡疏离，我们越追越近；他们步步后退，我们疯狂输出。这不是巧合，这是依恋风格的致命吸引。
为什么我们总被回避型吸引？宝子们，这内核是缺爱啊！我们在童年经历了不稳定的爱，导致成年后变成了"恋爱中的婴儿"——渴望被爱，却不知如何获得。
我们有两大防御机制：
第一，无底线付出。我们用讨好来交换爱，把自己变成提款机、情绪垃圾桶、24小时客服。但这不是爱，是用筹码换取安全感。

分割后：
深夜给他发了十几条微信，
每一条都像是向深渊里投下的石子，没有回音。
宝子啊，你是不是这样，谁不理你，就越会爱上谁。
不回复一条消息，内心就兵荒马乱；
对方三小时不回应，就能脑补出一百种被抛弃的场景。
无底线地付出，生怕对方离开；
需要伴侣随时回应，否则就胡思乱想；
情绪内耗到凌晨三点，不是把伴侣逼疯，就是自己失望透顶。
而我们最爱的，往往是那种若即若离的回避型伴侣。
他们冷淡疏离，我们越追越近；
他们步步后退，我们疯狂输出。
这不是巧合，这是依恋风格的致命吸引。
为什么我们总被回避型吸引？宝子们，这内核是缺爱啊！
我们在童年经历了不稳定的爱，导致成年后变成了"恋爱中的婴儿"
——渴望被爱，却不知如何获得。
第一，无底线付出。我们用讨好来交换爱，
把自己变成提款机、情绪垃圾桶、24小时客服。
但这不是爱，是用筹码换取安全感。
==示例结束==

## 限制
- 仅进行分割操作，严格保持原文案内容不变。
- 不要改写、润色、删减、扩写原文案。
- 不要添加标题、编号、镜头说明或解释。

## 最终输出格式
只输出合法 JSON，不要 Markdown，不要解释，不要代码块。
JSON 必须完全符合下面格式：
{{
  "narrations": [
    "分割后的第一段文案",
    "分割后的第二段文案"
  ]
}}""",
}

BUILTIN_TRANSLATION_TEMPLATES = {
    "Scene-Aligned Translation": """Translate the following storyboard narrations into {language}.

Topic: {topic}
Narration count: {narration_count}
Source narrations JSON:
{source_script_json}

Return ONLY valid JSON in this format:
{{
  "title": "translated short video title",
  "translations": [
    "translated scene narration 1",
    "translated scene narration 2"
  ]
}}

Requirements:
- The translations array must contain exactly {narration_count} items.
- Keep the same order and scene boundaries as the source narrations.
- Do not merge, split, omit, or add scenes.
- Translate the title into {language}; keep it short and natural for the platform.
- Do not add markdown or explanations.""",
}


class DraftParseError(ValueError):
    """Raised when LLM draft JSON cannot be parsed into the expected shape."""


class DraftTranslationCountError(ValueError):
    """Raised when translated scenes do not match source scene count."""


@dataclass(frozen=True)
class PromptTemplate:
    name: str
    content: str
    source: str


def _extract_json_object(text: str) -> dict:
    raw = (text or "").strip()
    if not raw:
        raise DraftParseError("LLM response is empty")

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    code_block = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", raw, re.DOTALL)
    if code_block:
        try:
            return json.loads(code_block.group(1))
        except json.JSONDecodeError:
            pass

    start = raw.find("{")
    end = raw.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(raw[start : end + 1])
        except json.JSONDecodeError:
            pass

    raise DraftParseError("No valid JSON object found in LLM response")


def _clean_string_list(value: Any, field_name: str) -> list[str]:
    if not isinstance(value, list):
        raise DraftParseError(f"Expected '{field_name}' to be an array")

    cleaned = []
    for item in value:
        text = str(item).strip()
        if text:
            cleaned.append(text)
    if not cleaned:
        raise DraftParseError(f"Expected '{field_name}' to contain at least one item")
    return cleaned


def parse_narrations_response(response_text: str) -> list[str]:
    payload = _extract_json_object(response_text)
    if "narrations" not in payload:
        raise DraftParseError("Invalid script response: missing 'narrations'")
    return _clean_string_list(payload["narrations"], "narrations")


def parse_script_response(response_text: str) -> str:
    payload = _extract_json_object(response_text)
    if "script" in payload:
        script = str(payload["script"]).strip()
        if not script:
            raise DraftParseError("Expected 'script' to contain text")
        return script

    if "narrations" in payload:
        return "\n".join(_clean_string_list(payload["narrations"], "narrations"))

    raise DraftParseError("Invalid script response: missing 'script'")


def parse_translation_payload(response_text: str, expected_count: int, language: str) -> dict[str, Any]:
    payload = _extract_json_object(response_text)
    if "translations" not in payload:
        raise DraftParseError("Invalid translation response: missing 'translations'")

    translations = _clean_string_list(payload["translations"], "translations")
    if len(translations) != expected_count:
        raise DraftTranslationCountError(
            f"Translation for {language} expected {expected_count} scenes, got {len(translations)}"
        )
    return {
        "title": str(payload.get("title") or "").strip(),
        "translations": translations,
    }


def parse_translations_response(response_text: str, expected_count: int, language: str) -> list[str]:
    return parse_translation_payload(response_text, expected_count, language)["translations"]


def render_prompt_template(template: str, variables: dict[str, Any]) -> str:
    required_fields = {field_name for _, field_name, _, _ in Formatter().parse(template) if field_name}
    missing_fields = required_fields.difference(variables)
    if missing_fields:
        raise KeyError(f"Missing prompt template variable: {sorted(missing_fields)[0]}")
    return template.format(**variables)


def _load_templates_from_dir(directory: Path) -> list[PromptTemplate]:
    if not directory.exists() or not directory.is_dir():
        return []

    templates = []
    for path in sorted(directory.iterdir()):
        if not path.is_file() or path.suffix.lower() not in {".md", ".txt", ".prompt"}:
            continue
        templates.append(
            PromptTemplate(
                name=path.stem.replace("_", " ").replace("-", " ").title(),
                content=path.read_text(encoding="utf-8"),
                source=str(path),
            )
        )
    return templates


def load_prompt_templates(kind: str) -> list[PromptTemplate]:
    if kind not in {"script", "split", "translate"}:
        raise ValueError(f"Unknown prompt template kind: {kind}")

    custom_templates = _load_templates_from_dir(Path(get_data_path("prompt_templates", kind)))
    builtin_maps = {
        "script": BUILTIN_SCRIPT_TEMPLATES,
        "split": BUILTIN_SPLIT_TEMPLATES,
        "translate": BUILTIN_TRANSLATION_TEMPLATES,
    }
    builtin_map = builtin_maps[kind]
    builtin_templates = [
        PromptTemplate(name=name, content=content, source="builtin")
        for name, content in builtin_map.items()
    ]
    return [*custom_templates, *builtin_templates]


async def generate_multilingual_script_draft(
    llm_service,
    topic: str,
    script_template: str,
    script_model: str | None,
    split_template: str,
    split_model: str | None,
    translation_template: str,
    translation_model: str | None,
    target_languages: list[str],
    status_callback=None,
) -> dict[str, Any]:
    clean_topic = (topic or "").strip()
    if not clean_topic:
        raise ValueError("Topic is required")
    if not target_languages:
        raise ValueError("At least one target language is required")

    if status_callback:
        status_callback("generating_script", clean_topic)

    script_prompt = render_prompt_template(script_template, {"topic": clean_topic})
    script_response = await llm_service(
        prompt=script_prompt,
        model=(script_model or None),
        temperature=0.8,
        max_tokens=2000,
    )
    source_script = parse_script_response(script_response)

    if status_callback:
        status_callback("splitting_script", clean_topic)

    split_prompt = render_prompt_template(
        split_template,
        {
            "topic": clean_topic,
            "script": source_script,
            "content": source_script,
            "Content": source_script,
            "content2": source_script,
        },
    )
    split_response = await llm_service(
        prompt=split_prompt,
        model=(split_model or None),
        temperature=0.1,
        max_tokens=2000,
    )
    source_narrations = parse_narrations_response(split_response)

    source_script_json = json.dumps(source_narrations, ensure_ascii=False, indent=2)
    translations = {}
    translated_titles = {}
    for language in target_languages:
        if status_callback:
            status_callback("translating", language)

        translation_prompt = render_prompt_template(
            translation_template,
            {
                "topic": clean_topic,
                "language": language,
                "narration_count": len(source_narrations),
                "source_script": source_script,
                "source_script_json": source_script_json,
            },
        )
        translation_response = await llm_service(
            prompt=translation_prompt,
            model=(translation_model or None),
            temperature=0.3,
            max_tokens=3000,
        )
        translation_payload = parse_translation_payload(
            translation_response,
            expected_count=len(source_narrations),
            language=language,
        )
        translations[language] = translation_payload["translations"]
        translated_titles[language] = translation_payload["title"] or _default_translated_title(
            translation_payload["translations"]
        )

    return {
        "topic": clean_topic,
        "title": clean_topic,
        "titles": {
            SOURCE_LANGUAGE_KEY: clean_topic,
            **translated_titles,
        },
        "source_script": source_script,
        "source_narrations": source_narrations,
        "translations": translations,
        "script_model": script_model or "",
        "split_model": split_model or "",
        "translation_model": translation_model or "",
        "selected_languages": [SOURCE_LANGUAGE_KEY, *target_languages],
    }


def split_review_lines(text: str) -> list[str]:
    return [line.strip() for line in (text or "").splitlines() if line.strip()]


def _default_translated_title(translations: list[str]) -> str:
    for line in translations:
        clean = line.strip()
        if clean:
            return clean[:80]
    return ""


def draft_titles(draft: dict[str, Any]) -> dict[str, str]:
    titles = dict(draft.get("titles") or {})
    source_title = titles.get(SOURCE_LANGUAGE_KEY) or draft.get("title") or draft.get("topic") or ""
    titles[SOURCE_LANGUAGE_KEY] = str(source_title).strip()
    for language, translations in (draft.get("translations") or {}).items():
        title = titles.get(language) or _default_translated_title(translations or [])
        if title:
            titles[language] = str(title).strip()
    return titles


def validate_draft_translation_counts(draft: dict[str, Any]) -> list[str]:
    source_count = len(draft.get("source_narrations") or [])
    errors = []
    for language in draft.get("selected_languages") or []:
        if language == SOURCE_LANGUAGE_KEY:
            continue
        translations = draft.get("translations", {}).get(language, [])
        if len(translations) != source_count:
            errors.append(f"{draft.get('topic', 'Untitled')} / {language}: expected {source_count}, got {len(translations)}")
    return errors


def build_generation_jobs(drafts: list[dict[str, Any]], base_config: dict[str, Any]) -> list[dict[str, Any]]:
    jobs = []
    for draft in drafts:
        source_narrations = draft.get("source_narrations") or []
        titles = draft_titles(draft)
        for language in draft.get("selected_languages") or []:
            if language == SOURCE_LANGUAGE_KEY:
                narrations = source_narrations
            else:
                narrations = draft.get("translations", {}).get(language) or []
                if len(narrations) != len(source_narrations):
                    raise DraftTranslationCountError(
                        f"{draft.get('topic', 'Untitled')} / {language} expected {len(source_narrations)} scenes, got {len(narrations)}"
                    )

            params = dict(base_config)
            params.update(
                {
                    "text": "\n".join(narrations),
                    "mode": "fixed",
                    "split_mode": "line",
                    "title": (titles.get(language) or titles.get(SOURCE_LANGUAGE_KEY) or draft.get("topic") or "").strip(),
                    "review_topic": draft.get("topic"),
                    "review_language": language,
                    "review_source_script": draft.get("source_script") or "",
                    "review_source_narrations": source_narrations,
                    "review_script_model": draft.get("script_model") or "",
                    "review_split_model": draft.get("split_model") or "",
                    "review_translation_model": draft.get("translation_model") or "",
                }
            )
            jobs.append({"topic": draft.get("topic"), "language": language, "params": params})
    return jobs
