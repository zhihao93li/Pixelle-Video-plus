"""Writing and scene-planning steps shared by the formal content routes."""

from __future__ import annotations

from typing import Any

from pixelle_video.generation.drafting_support import (
    PromptTemplate,
    generate_independent_language_scripts,
    load_prompt_templates,
    split_script_into_scenes,
)
from pixelle_video.generation.templates import (
    DEFAULT_SCRIPT_TEMPLATE,
    DEFAULT_SPLIT_TEMPLATE,
    ProductionTemplateError,
)


def _prompt_template(kind: str, name: str) -> PromptTemplate:
    template = next(
        (candidate for candidate in load_prompt_templates(kind) if candidate.name == name),
        None,
    )
    if template is None:
        raise ProductionTemplateError(f"Unknown {kind} prompt template: {name}")
    return template


async def draft_topic(
    *,
    llm_service,
    topic: str,
    languages: list[str],
    settings: dict[str, Any],
) -> dict[str, Any]:
    """Write scripts only; scene planning happens after human confirmation."""

    script_template_name = str(settings.get("script_template_name") or DEFAULT_SCRIPT_TEMPLATE)
    script_prompt = str(settings.get("script_prompt") or "").strip()
    script_provider_id = str(settings.get("script_provider_id") or "")
    script_model = str(settings.get("script_model") or "")
    language_script_models = settings.get("language_script_models") or {}
    if not isinstance(language_script_models, dict):
        raise ValueError("language_script_models 必须是语言到模型名的映射。")
    return await generate_independent_language_scripts(
        llm_service=llm_service,
        topic=topic,
        script_template=script_prompt or _prompt_template("script", script_template_name).content,
        script_provider_id=script_provider_id or None,
        script_model=script_model or None,
        languages=languages,
        language_script_templates={},
        language_script_models={
            str(language): selection
            for language, selection in language_script_models.items()
            if str(language).strip() and isinstance(selection, (dict, str))
        },
    )


async def split_confirmed_script(
    *,
    llm_service,
    script: str,
    settings: dict[str, Any],
    language: str = "Chinese",
    topic: str = "",
) -> list[str]:
    """Plan scenes from the confirmed script with the configured LLM."""

    split_template_name = str(settings.get("split_template_name") or DEFAULT_SPLIT_TEMPLATE)
    split_prompt = str(settings.get("split_prompt") or "").strip()
    split_provider_id = str(settings.get("split_provider_id") or "")
    split_model = str(settings.get("split_model") or "")
    return await split_script_into_scenes(
        llm_service,
        script=script,
        split_template=split_prompt or _prompt_template("split", split_template_name).content,
        split_provider_id=split_provider_id or None,
        split_model=split_model or None,
        language=language,
        topic=topic,
    )


async def draft_digital_human_script(
    *, llm_service, goods_title: str, model: str | None = None
) -> str:
    """Draft reviewable presenter copy before starting the digital-human workflow."""

    from pixelle_video.generation.drafting_support import _call_llm_retrying_empty

    prompt = f"""请为数字人口播写一段简洁、自然、可以直接配音的中文商品介绍。
商品或主题：{goods_title}
要求：不虚构参数或功效，不使用 Markdown，只输出完整口播正文。"""
    script = await _call_llm_retrying_empty(
        llm_service,
        prompt=prompt,
        model=model or None,
        temperature=0.7,
        max_tokens=1200,
    )
    script = (script or "").strip()
    if not script:
        raise ValueError("数字人口播写稿没有返回内容。")
    return script
