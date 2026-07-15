"""Prompt loading, topic drafting, and scene planning helpers."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from string import Formatter
from typing import Any

from pixelle_video.utils.os_util import get_data_path

DEFAULT_DRAFT_LANGUAGES = ["Chinese", "English"]

BUILTIN_SCRIPT_TEMPLATES = {
    "Short Oral Script": """You are a short-form video script writer.
Create a concise oral narration script in {language} for this topic:

{topic}

Return ONLY valid JSON in this format:
{{
  "title": "short video title in {language}",
  "script": "complete oral narration script"
}}

Requirements:
- Write one complete script, not storyboard scenes.
- Keep the script logical, direct, and suitable for voiceover.
- Use natural, native {language} expression. Do not translate from another language.
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

class DraftParseError(ValueError):
    """Raised when LLM draft JSON cannot be parsed into the expected shape."""


@dataclass(frozen=True)
class PromptTemplate:
    name: str
    content: str
    source: str


async def _call_llm_retrying_empty(llm_service, *, attempts: int = 3, **kwargs) -> str:
    """LLM 偶发空响应属于可重试错误：小退避重试，多次为空则返回空串交由上层报错。"""
    import asyncio

    delay = 1.5
    response = ""
    for attempt in range(attempts):
        response = await llm_service(**kwargs)
        if (response or "").strip():
            return response
        if attempt < attempts - 1:
            await asyncio.sleep(delay)
            delay *= 2
    return response


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


def parse_language_script_payload(response_text: str) -> dict[str, str]:
    payload = _extract_json_object(response_text)
    if "script" not in payload:
        raise DraftParseError("Invalid script response: missing 'script'")

    script = str(payload["script"]).strip()
    if not script:
        raise DraftParseError("Expected 'script' to contain text")

    title = str(payload.get("title") or "").strip()
    return {
        "title": title,
        "script": script,
    }


def parse_title_response(response_text: str) -> str:
    payload = _extract_json_object(response_text)
    title = str(payload.get("title") or "").strip()
    if not title:
        raise DraftParseError("Invalid title response: missing 'title'")
    return title


def _draft_stage_error(language: str, stage: str, exc: Exception) -> DraftParseError:
    return DraftParseError(f"{language} {stage} failed: {exc}")


def _language_script_selection(
    language: str,
    default_provider_id: str | None,
    default_model: str | None,
    language_script_models: dict[str, Any] | None,
) -> tuple[str, str]:
    selection = (language_script_models or {}).get(language)
    if isinstance(selection, dict):
        return (
            str(selection.get("provider_id") or default_provider_id or "").strip(),
            str(selection.get("model") or default_model or "").strip(),
        )
    # Legacy persisted values remain readable until the user saves the structured editor.
    return str(default_provider_id or "").strip(), str(selection or default_model or "").strip()


def render_prompt_template(template: str, variables: dict[str, Any]) -> str:
    required_fields = {
        field_name for _, field_name, _, _ in Formatter().parse(template) if field_name
    }
    missing_fields = required_fields.difference(variables)
    if missing_fields:
        raise KeyError(f"Missing prompt template variable: {sorted(missing_fields)[0]}")
    return template.format(**variables)


def render_language_script_prompt(template: str, topic: str, language: str) -> str:
    rendered_template = render_prompt_template(template, {"topic": topic, "language": language})
    return f"""Output contract hard rule:
- Return ONLY valid JSON.
- The JSON object MUST include both "title" and "script".
- Use this exact shape:
{{
  "title": "short native {language} video title",
  "script": "complete {language} spoken script"
}}

Target language hard rule:
- Create this version directly in {language}.
- The JSON title and script field values MUST be written in {language}.
- Do not answer in Chinese unless the target language is Chinese.
- If the writing brief below contains examples or style notes in another language, treat them only as structural guidance.

Writing brief:
{rendered_template}

Final reminder:
Return ONLY the JSON object. Do not add markdown, notes, explanations, or plain text outside JSON."""


def render_language_split_prompt(template: str, topic: str, language: str, script: str) -> str:
    rendered_template = render_prompt_template(
        template,
        {
            "topic": topic,
            "language": language,
            "script": script,
            "content": script,
            "Content": script,
            "content2": script,
        },
    )
    return f"""Target language hard rule:
- The input script is the {language} version.
- Split the script only. Do not translate, rewrite, summarize, or change the language.
- Every narration item in the JSON output must remain in {language}.

Split brief:
{rendered_template}"""


def render_language_title_prompt(topic: str, language: str, script: str) -> str:
    return f"""Create a short native {language} title for a short-form video.

Original topic:
{topic}

{language} script:
{script}

Return ONLY valid JSON in this format:
{{
  "title": "short native {language} title"
}}

Requirements:
- Title must be written in {language}.
- Use natural {language}, not a literal word-for-word translation if it sounds awkward.
- Capture the core idea of the topic and this {language} script.
- Keep it short, clear, and suitable as a video title.
- Do not use Chinese characters unless the target language is Chinese.
- Do not copy the whole opening sentence from the script.
- Prefer 4 to 12 words for English, or a similarly short title in other languages.
- Do not add markdown or explanations."""


def render_language_script_repair_prompt(topic: str, language: str, raw_response: str) -> str:
    return f"""Normalize this {language} script-generation response into the required JSON contract.

Original topic:
{topic}

Raw response:
{raw_response}

Return ONLY valid JSON in this exact shape:
{{
  "title": "short native {language} video title",
  "script": "complete {language} spoken script"
}}

Rules:
- Preserve the meaning and tone of the raw response.
- If the raw response contains only a script, create a short native {language} title from it.
- The title and script must be written in {language}.
- Do not add markdown, explanations, or text outside JSON."""


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
    if kind not in {"script", "split"}:
        raise ValueError(f"Unknown prompt template kind: {kind}")

    custom_templates = _load_templates_from_dir(Path(get_data_path("prompt_templates", kind)))
    builtin_maps = {
        "script": BUILTIN_SCRIPT_TEMPLATES,
        "split": BUILTIN_SPLIT_TEMPLATES,
    }
    builtin_map = builtin_maps[kind]
    builtin_templates = [
        PromptTemplate(name=name, content=content, source="builtin")
        for name, content in builtin_map.items()
    ]
    return [*custom_templates, *builtin_templates]


async def split_script_into_scenes(
    llm_service,
    *,
    script: str,
    split_template: str,
    split_model: str | None,
    language: str,
    topic: str = "",
    split_provider_id: str | None = None,
) -> list[str]:
    """Let the configured scene-planning LLM decide the scene boundaries."""

    clean_script = (script or "").strip()
    if not clean_script:
        raise ValueError("Script is required for scene planning")
    split_prompt = render_language_split_prompt(
        split_template,
        (topic or "").strip(),
        (language or "Chinese").strip() or "Chinese",
        clean_script,
    )
    split_response = await _call_llm_retrying_empty(
        llm_service,
        prompt=split_prompt,
        provider_id=(split_provider_id or None),
        model=(split_model or None),
        temperature=0.1,
        max_tokens=2000,
    )
    return parse_narrations_response(split_response)


async def generate_independent_language_scripts(
    llm_service,
    topic: str,
    script_template: str,
    script_model: str | None,
    languages: list[str],
    language_script_templates: dict[str, str] | None = None,
    language_script_models: dict[str, Any] | None = None,
    status_callback=None,
    script_provider_id: str | None = None,
) -> dict[str, Any]:
    clean_topic = (topic or "").strip()
    if not clean_topic:
        raise ValueError("Topic is required")

    selected_languages = _clean_language_selection(languages)
    if not selected_languages:
        raise ValueError("At least one language is required")

    language_drafts = {}
    resolved_language_script_models = {}
    for language in selected_languages:
        if status_callback:
            status_callback("generating_script", language)

        selected_provider_id, selected_script_model = _language_script_selection(
            language, script_provider_id, script_model, language_script_models
        )
        resolved_language_script_models[language] = {
            "provider_id": selected_provider_id,
            "model": selected_script_model,
        }
        selected_script_template = (language_script_templates or {}).get(language, script_template)
        script_prompt = render_language_script_prompt(
            selected_script_template, clean_topic, language
        )
        script_response = await _call_llm_retrying_empty(
            llm_service,
            prompt=script_prompt,
            provider_id=(selected_provider_id or None),
            model=(selected_script_model or None),
            temperature=0.8,
            max_tokens=2000,
        )
        try:
            script_payload = parse_language_script_payload(script_response)
        except DraftParseError as exc:
            if not (script_response or "").strip():
                raise _draft_stage_error(language, "script generation", exc) from exc
            repair_response = await llm_service(
                prompt=render_language_script_repair_prompt(
                    topic=clean_topic,
                    language=language,
                    raw_response=script_response,
                ),
                provider_id=(selected_provider_id or None),
                model=(selected_script_model or None),
                temperature=0.0,
                max_tokens=2500,
            )
            try:
                script_payload = parse_language_script_payload(repair_response)
            except DraftParseError as repair_exc:
                raise _draft_stage_error(
                    language,
                    "script generation",
                    DraftParseError(f"{exc}; JSON repair failed: {repair_exc}"),
                ) from repair_exc
        language_drafts[language] = {
            "title": script_payload["title"],
            "script": script_payload["script"],
            "narrations": [],
        }

    for language, language_draft in language_drafts.items():
        if (language_draft.get("title") or "").strip():
            continue
        if status_callback:
            status_callback("generating_title", language)
        title_response = await _call_llm_retrying_empty(
            llm_service,
            prompt=render_language_title_prompt(
                topic=clean_topic,
                language=language,
                script=language_draft.get("script") or "",
            ),
            provider_id=(
                (resolved_language_script_models.get(language) or {}).get("provider_id")
                or script_provider_id
                or None
            ),
            model=(
                (resolved_language_script_models.get(language) or {}).get("model")
                or script_model
                or None
            ),
            temperature=0.4,
            max_tokens=300,
        )
        try:
            language_draft["title"] = parse_title_response(title_response)
        except DraftParseError as exc:
            raise _draft_stage_error(language, "title generation", exc) from exc

    return {
        "topic": clean_topic,
        "title": clean_topic,
        "language_drafts": language_drafts,
        "script_model": script_model or "",
        "script_provider_id": script_provider_id or "",
        "language_script_models": resolved_language_script_models,
        "selected_languages": selected_languages,
        "workflow_mode": "independent_language_scripts",
    }


def _clean_language_selection(languages: list[str]) -> list[str]:
    seen = set()
    selected = []
    for language in languages:
        clean = str(language or "").strip()
        if clean and clean not in seen:
            seen.add(clean)
            selected.append(clean)
    return selected
