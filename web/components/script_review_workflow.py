"""Streamlit UI for script review before video generation."""

from __future__ import annotations

import traceback
from pathlib import Path
from typing import Any

import streamlit as st
from loguru import logger

from pixelle_video.config import config_manager
from pixelle_video.generation.script_review import (
    DEFAULT_REVIEW_LANGUAGES,
    DEFAULT_TARGET_LANGUAGES,
    SOURCE_LANGUAGE_KEY,
    PromptTemplate,
    build_generation_jobs,
    draft_titles,
    generate_independent_language_drafts,
    load_prompt_templates,
    split_review_lines,
    validate_draft_translation_counts,
    validate_language_tts_overrides,
)
from pixelle_video.models.progress import ProgressEvent
from web.components.content_input import parse_batch_text_input
from web.i18n import tr
from web.utils.async_helpers import run_async

DRAFTS_KEY = "script_review_drafts"
RESULTS_KEY = "script_review_generation_results"
ERRORS_KEY = "script_review_generation_errors"
LANGUAGE_TTS_KEY = "script_review_language_tts_overrides"

BAZI_TEMPLATE_NAME = "Bazi Storyboard Oral Script"
BAZI_DEFAULT_SCRIPT_MODEL = "doubao-seed-2-0-lite-260428"
BAZI_DEFAULT_SPLIT_MODEL = "deepseek-v4-flash"
BAZI_DEFAULT_LANGUAGE_SCRIPT_MODELS = {
    "Chinese": "doubao-seed-2-0-lite-260428",
    "English": "gemini-3.5-flash",
}

STAGE_LABEL_KEYS = {
    "generating_script": "script_review.stage.generating_script",
    "splitting_script": "script_review.stage.splitting_script",
    "generating_title": "script_review.stage.generating_title",
    "translating": "script_review.stage.translating",
}

LANGUAGE_LABEL_KEYS = {
    SOURCE_LANGUAGE_KEY: "script_review.language.source",
    "Chinese": "script_review.language.chinese",
    "English": "script_review.language.english",
    "Japanese": "script_review.language.japanese",
    "Korean": "script_review.language.korean",
    "Spanish": "script_review.language.spanish",
    "Traditional Chinese": "script_review.language.traditional_chinese",
}

TEMPLATE_LABEL_KEYS = {
    "Short Oral Script": "script_review.template.script_short_oral",
    "Bazi Storyboard Oral Script": "script_review.template.bazi_oral_script",
    "Bazi Storyboard Oral Script English": "script_review.template.bazi_oral_script_english",
    "Copy-Safe Scene Split": "script_review.template.copy_safe_scene_split",
    "Scene-Aligned Translation": "script_review.template.translate_scene_aligned",
}


def _sr(key: str, fallback: str, **kwargs) -> str:
    return tr(f"script_review.{key}", fallback=fallback, **kwargs)


def _language_label(language: str) -> str:
    key = LANGUAGE_LABEL_KEYS.get(language)
    return tr(key, fallback=language) if key else language


def _template_label(template_name: str) -> str:
    key = TEMPLATE_LABEL_KEYS.get(template_name)
    return tr(key, fallback=template_name) if key else template_name


def _stage_label(stage: str, detail: str) -> str:
    key = STAGE_LABEL_KEYS.get(stage)
    if not key:
        return f"{stage}: {detail}"
    return tr(key, fallback="{detail}", detail=detail)


def _video_event_label(event: ProgressEvent) -> str:
    if event.event_type == "frame_step" and event.frame_current and event.frame_total:
        action_text = tr(
            f"progress.step_{event.action}",
            fallback=event.action or "",
        )
        message = tr(
            "progress.frame_step",
            fallback="Frame {current}/{total} - Step {step}/4: {action}",
            current=event.frame_current,
            total=event.frame_total,
            step=event.step or "",
            action=action_text,
        )
    elif event.event_type == "processing_frame" and event.frame_current and event.frame_total:
        message = tr(
            "progress.frame",
            fallback="Frame {current}/{total}",
            current=event.frame_current,
            total=event.frame_total,
        )
    else:
        message = tr(
            f"progress.{event.event_type}",
            fallback=event.event_type.replace("_", " "),
        )

    if event.extra_info:
        return f"{message} - {event.extra_info}"
    return message


def _overall_video_progress(job_index: int, total_jobs: int, event_progress: float) -> float:
    if total_jobs <= 0:
        return 0.0
    bounded_event_progress = min(max(event_progress, 0.0), 1.0)
    overall = ((job_index - 1) + bounded_event_progress) / total_jobs
    return min(max(overall, 0.0), 1.0)


def _dedupe(items: list[str]) -> list[str]:
    seen = set()
    result = []
    for item in items:
        clean = (item or "").strip()
        if clean and clean not in seen:
            seen.add(clean)
            result.append(clean)
    return result


def _safe_widget_key(value: str) -> str:
    return "".join(char.lower() if char.isalnum() else "_" for char in value).strip("_") or "value"


def _current_model_options() -> list[str]:
    current_model = (config_manager.get_llm_config().get("model") or "").strip()
    loaded_models = st.session_state.get("llm_loaded_models", [])
    return _dedupe([current_model, *loaded_models])


def _render_model_selector(label: str, key: str, default_value: str | None = None) -> str:
    options = _dedupe([default_value or "", *_current_model_options()])
    custom_option = _sr("custom_model_option", "Custom...")
    default_model = (default_value or (options[0] if options else "")).strip()
    preferred_index = options.index(default_model) if default_model in options else 0
    selected = st.selectbox(
        label,
        options=[*options, custom_option],
        index=preferred_index if options else 0,
        key=f"{key}_select",
    )
    if selected == custom_option:
        return st.text_input(_sr("model_name", "Model name"), value=default_model, key=f"{key}_custom").strip()
    return selected.strip()


def _script_model_default_for_template(template_name: str) -> str | None:
    if template_name == BAZI_TEMPLATE_NAME:
        return BAZI_DEFAULT_SCRIPT_MODEL
    return None


def _split_model_default_for_template(template_name: str) -> str | None:
    if template_name == BAZI_TEMPLATE_NAME:
        return BAZI_DEFAULT_SPLIT_MODEL
    return None


def _language_script_model_defaults_for_template(template_name: str, default_model: str) -> dict[str, str]:
    if template_name == BAZI_TEMPLATE_NAME:
        return dict(BAZI_DEFAULT_LANGUAGE_SCRIPT_MODELS)
    return {}


def _render_template_selector(
    kind: str,
    label: str,
    key: str,
    preferred_template_name: str | None = None,
    exclude_template_names: set[str] | None = None,
    return_template: bool = False,
) -> str | PromptTemplate:
    loaded_templates = load_prompt_templates(kind)
    templates = [
        template
        for template in loaded_templates
        if template.name not in (exclude_template_names or set())
    ] or loaded_templates
    preferred_index = 0
    if preferred_template_name:
        for index, template in enumerate(templates):
            if template.name == preferred_template_name:
                preferred_index = index
                break
    selected_index = st.selectbox(
        label,
        options=list(range(len(templates))),
        format_func=lambda index: _template_label(templates[index].name),
        index=preferred_index,
        key=key,
    )
    selected_template = templates[selected_index]
    source = _sr("template_source_builtin", "builtin") if selected_template.source == "builtin" else selected_template.source
    st.caption(_sr("template_source", "Template source: {source}", source=source))
    return selected_template if return_template else selected_template.content


def _language_script_template_overrides(selected_template: PromptTemplate) -> dict[str, str]:
    if selected_template.name != BAZI_TEMPLATE_NAME:
        return {}

    for template in load_prompt_templates("script"):
        if template.name == "Bazi Storyboard Oral Script English":
            return {"English": template.content}
    return {}


def _parse_custom_languages(text: str) -> list[str]:
    return [
        item.strip()
        for item in (text or "").replace("，", ",").split(",")
        if item.strip()
    ]


def _collect_topics(batch_mode: bool, topic_input: str) -> list[str]:
    if batch_mode:
        return parse_batch_text_input(topic_input, mode="generate")
    clean = (topic_input or "").strip()
    return [clean] if clean else []


def _render_language_script_model_overrides(
    languages: list[str],
    default_model: str,
    language_default_models: dict[str, str] | None = None,
    key_prefix: str = "script_review_language_script_model",
) -> dict[str, str]:
    if not languages:
        return {}

    overrides = {}
    with st.expander(_sr("language_script_models", "Script models by language"), expanded=True):
        st.caption(
            _sr(
                "language_script_models_help",
                "Only script and title generation use these models. Scene splitting still uses the global split model.",
            )
        )
        for language in languages:
            language_label = _language_label(language)
            safe_language = _safe_widget_key(language)
            overrides[language] = _render_model_selector(
                _sr("language_script_model", "{language} script model", language=language_label),
                f"{key_prefix}_{safe_language}",
                default_value=(language_default_models or {}).get(language) or default_model,
            )
    return overrides


def _render_independent_language_draft_editor(draft: dict[str, Any], draft_index: int) -> dict[str, Any]:
    language_drafts = dict(draft.get("language_drafts") or {})
    titles = draft_titles(draft)
    selected_defaults = set(draft.get("selected_languages") or language_drafts.keys())
    selected_languages = []

    for language, language_draft in language_drafts.items():
        language_label = _language_label(language)
        safe_language = _safe_widget_key(language)
        use_language = st.checkbox(
            _sr("generate_language_video", "Generate {language} video", language=language_label),
            value=language in selected_defaults,
            key=f"script_review_language_{draft_index}_{safe_language}",
        )
        if use_language:
            selected_languages.append(language)

        language_draft["title"] = st.text_input(
            _sr("language_title_field", "{language} title", language=language_label),
            value=titles.get(language) or language_draft.get("title") or "",
            placeholder=_sr("language_title_placeholder", "Optional. Leave blank to use the topic."),
            key=f"script_review_title_{draft_index}_{safe_language}",
        )
        language_draft["script"] = st.text_area(
            _sr("language_script", "{language} complete script", language=language_label),
            value=language_draft.get("script") or "",
            height=180,
            key=f"script_review_full_language_{draft_index}_{safe_language}",
        )
        narrations_text = st.text_area(
            _sr("language_scenes", "{language} scenes", language=language_label),
            value="\n".join(language_draft.get("narrations") or []),
            height=140,
            key=f"script_review_scenes_{draft_index}_{safe_language}",
        )
        language_draft["narrations"] = split_review_lines(narrations_text)
        language_drafts[language] = language_draft

    draft["language_drafts"] = language_drafts
    draft["selected_languages"] = selected_languages
    draft["titles"] = {
        language: (language_draft.get("title") or "").strip()
        for language, language_draft in language_drafts.items()
    }

    errors = validate_draft_translation_counts(draft)
    if errors:
        for error in errors:
            st.error(error)
    else:
        st.success(_sr("language_drafts_ready", "Language drafts are ready"))

    return draft


def _default_fish_reference_id() -> str:
    fish_config = config_manager.get_comfyui_config().get("tts", {}).get("fish_audio", {})
    return str(fish_config.get("reference_id") or "").strip()


def _independent_review_mode(drafts: list[dict[str, Any]]) -> bool:
    return any(bool(draft.get("language_drafts")) for draft in drafts)


def _selected_generation_languages(drafts: list[dict[str, Any]]) -> list[str]:
    languages = []
    for draft in drafts:
        if not draft.get("language_drafts"):
            continue
        languages.extend(draft.get("selected_languages") or [])
    return _dedupe(languages)


def _render_language_fish_tts_overrides(drafts: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    languages = _selected_generation_languages(drafts)
    if not languages:
        return {}

    st.markdown(f"**{_sr('fish_tts_settings', 'Fish TTS by language')}**")
    st.caption(
        _sr(
            "fish_tts_settings_help",
            "This multilingual review flow always uses Fish TTS. Each selected language needs its own reference_id.",
        )
    )

    default_chinese_reference_id = _default_fish_reference_id()
    overrides = {}
    for language in languages:
        language_label = _language_label(language)
        key_suffix = _safe_widget_key(language)
        default_reference_id = default_chinese_reference_id if language == "Chinese" else ""
        reference_id = st.text_input(
            _sr("fish_reference_id", "{language} Fish reference_id", language=language_label),
            value=default_reference_id,
            help=_sr("fish_reference_id_help", "Fish Audio voice model ID used for this language."),
            key=f"script_review_fish_reference_{key_suffix}",
        ).strip()
        speed = st.slider(
            _sr("fish_speed", "{language} speed", language=language_label),
            min_value=0.5,
            max_value=2.0,
            value=1.0,
            step=0.1,
            key=f"script_review_fish_speed_{key_suffix}",
        )
        overrides[language] = {
            "tts_inference_mode": "fish",
            "tts_voice": reference_id,
            "tts_speed": speed,
        }
    return overrides


def render_script_review_tts_settings():
    drafts = [
        draft
        for draft in st.session_state.get(DRAFTS_KEY, [])
        if draft.get("selected_for_generation", True)
    ]
    if not drafts or not _independent_review_mode(drafts):
        st.session_state[LANGUAGE_TTS_KEY] = {}
        with st.container(border=True):
            st.info(_sr(
                "tts_after_drafts_short",
                "Generate and approve multilingual drafts first, then configure each language voice here.",
            ))
        return

    with st.container(border=True):
        overrides = _render_language_fish_tts_overrides(drafts)
        st.session_state[LANGUAGE_TTS_KEY] = overrides
        for error in validate_language_tts_overrides(drafts, overrides):
            st.error(_sr("fish_reference_required", "{error}", error=error))


def _render_draft_editor():
    drafts = st.session_state.get(DRAFTS_KEY, [])
    if not drafts:
        return

    st.markdown(f"**{_sr('review_drafts', 'Review Script Drafts')}**")
    for draft_index, draft in enumerate(drafts):
        label = f"{draft_index + 1}. {draft.get('topic', _sr('untitled', 'Untitled'))}"
        with st.expander(label, expanded=draft_index == 0):
            draft["selected_for_generation"] = st.checkbox(
                _sr("approve_generation", "Approve for video generation"),
                value=draft.get("selected_for_generation", True),
                key=f"script_review_approve_{draft_index}",
            )

            if draft.get("language_drafts"):
                drafts[draft_index] = _render_independent_language_draft_editor(draft, draft_index)
                continue

            titles = draft_titles(draft)
            existing_selection = draft.get("selected_languages")
            selected_defaults = set(existing_selection or [])
            if not draft.get("source_generation_initialized"):
                selected_defaults.add(SOURCE_LANGUAGE_KEY)

            use_source_language = st.checkbox(
                _sr("generate_source_video", "Generate source video"),
                value=SOURCE_LANGUAGE_KEY in selected_defaults,
                key=f"script_review_language_{draft_index}_{SOURCE_LANGUAGE_KEY}",
            )
            titles[SOURCE_LANGUAGE_KEY] = st.text_input(
                _sr("source_title_field", "Source title"),
                value=titles.get(SOURCE_LANGUAGE_KEY) or draft.get("topic", ""),
                key=f"script_review_title_{draft_index}_{SOURCE_LANGUAGE_KEY}",
            )

            source_text = st.text_area(
                _sr("source_script", "Complete source script"),
                value=draft.get("source_script") or "",
                height=180,
                disabled=True,
                key=f"script_review_full_source_{draft_index}",
            )
            draft["source_script"] = source_text

            source_narrations_text = st.text_area(
                _sr("source_scenes", "Source scenes"),
                value="\n".join(draft.get("source_narrations") or []),
                height=140,
                key=f"script_review_source_{draft_index}",
            )
            draft["source_narrations"] = split_review_lines(source_narrations_text)

            selected_languages = [SOURCE_LANGUAGE_KEY] if use_source_language else []
            translations = dict(draft.get("translations") or {})
            for language in list(translations.keys()):
                language_label = _language_label(language)
                use_language = st.checkbox(
                    _sr("generate_language_video", "Generate {language} video", language=language_label),
                    value=language in selected_defaults or existing_selection is None,
                    key=f"script_review_language_{draft_index}_{language}",
                )
                if use_language:
                    selected_languages.append(language)

                titles[language] = st.text_input(
                    _sr("language_title_field", "{language} title", language=language_label),
                    value=titles.get(language) or "",
                    key=f"script_review_title_{draft_index}_{language}",
                )

                translated_text = st.text_area(
                    _sr("language_scenes", "{language} scenes", language=language_label),
                    value="\n".join(translations[language]),
                    height=140,
                    key=f"script_review_translation_{draft_index}_{language}",
                )
                translations[language] = split_review_lines(translated_text)

            draft["translations"] = translations
            draft["titles"] = titles
            draft["title"] = titles.get(SOURCE_LANGUAGE_KEY, "")
            draft["selected_languages"] = selected_languages
            draft["source_generation_initialized"] = True
            errors = validate_draft_translation_counts(draft)
            if errors:
                for error in errors:
                    st.error(error)
            else:
                st.success(_sr("scene_counts_match", "Scene counts match"))

            drafts[draft_index] = draft

    st.session_state[DRAFTS_KEY] = drafts


def render_script_review_input(pixelle_video):
    with st.container(border=True):
        st.markdown(f"**{_sr('title', 'Script Review Creation')}**")

        if not config_manager.validate():
            st.warning(_sr("llm_incomplete", "LLM config is incomplete. Configure AiHubMix before generating drafts."))

        batch_mode = st.checkbox(_sr("batch_topics", "Batch topics"), value=False, key="script_review_batch_mode")
        if batch_mode:
            topic_input = st.text_area(
                _sr("topics", "Topics"),
                height=160,
                placeholder=_sr("topics_placeholder", "One topic per line"),
                key="script_review_topics",
            )
        else:
            topic_input = st.text_input(_sr("topic", "Topic"), key="script_review_topic")

        script_template_config = _render_template_selector(
            "script",
            _sr("script_prompt_template", "Script type"),
            "script_review_native_script_template",
            preferred_template_name="Bazi Storyboard Oral Script",
            exclude_template_names={"Bazi Storyboard Oral Script English"},
            return_template=True,
        )
        script_template = script_template_config.content
        language_script_templates = _language_script_template_overrides(script_template_config)
        template_key_suffix = _safe_widget_key(script_template_config.name)
        script_model = _render_model_selector(
            _sr("script_generation_model", "Script generation model"),
            f"script_review_script_model_{template_key_suffix}",
            default_value=_script_model_default_for_template(script_template_config.name),
        )

        split_template = _render_template_selector(
            "split",
            _sr("split_prompt_template", "Script split prompt template"),
            "script_review_split_template",
        )
        split_model = _render_model_selector(
            _sr("split_model", "Script split model"),
            f"script_review_split_model_{template_key_suffix}",
            default_value=_split_model_default_for_template(script_template_config.name),
        )

        selected_languages = st.multiselect(
            _sr("target_languages", "Languages"),
            options=_dedupe([*DEFAULT_REVIEW_LANGUAGES, *DEFAULT_TARGET_LANGUAGES]),
            default=DEFAULT_REVIEW_LANGUAGES,
            format_func=_language_label,
            key="script_review_target_languages",
        )
        custom_languages = _parse_custom_languages(
            st.text_input(
                _sr("custom_target_languages", "Custom target languages"),
                placeholder=_sr("custom_target_languages_placeholder", "French, German"),
                key="script_review_custom_languages",
            )
        )
        target_languages = _dedupe([*selected_languages, *custom_languages])
        if "English" in target_languages and language_script_templates.get("English"):
            st.caption(
                _sr(
                    "language_prompt_mapping",
                    "Language prompts are mapped automatically: Chinese uses {base}; English uses {english}.",
                    base=_template_label(script_template_config.name),
                    english=_template_label("Bazi Storyboard Oral Script English"),
                )
            )
        language_script_models = _render_language_script_model_overrides(
            target_languages,
            script_model,
            language_default_models=_language_script_model_defaults_for_template(
                script_template_config.name,
                default_model=script_model,
            ),
            key_prefix=f"script_review_language_script_model_{template_key_suffix}",
        )
        topics = _collect_topics(batch_mode, topic_input)

        generate_disabled = not topics or not target_languages or not config_manager.validate()
        if st.button(
            _sr("generate_drafts", "Generate Review Drafts"),
            type="primary",
            disabled=generate_disabled,
            use_container_width=True,
            key="script_review_generate_drafts",
        ):
            drafts = []
            errors = []
            progress = st.progress(0)
            status = st.empty()

            for index, topic in enumerate(topics, 1):
                def update_draft_status(stage: str, detail: str):
                    status.text(
                        _sr(
                            "generating_draft_stage",
                            "Generating draft {index}/{total}: {topic} - {stage}",
                            index=index,
                            total=len(topics),
                            topic=topic,
                            stage=_stage_label(stage, detail),
                        )
                    )

                status.text(_sr("generating_draft", "Generating draft {index}/{total}: {topic}", index=index, total=len(topics), topic=topic))
                try:
                    draft = run_async(
                        generate_independent_language_drafts(
                            llm_service=pixelle_video.llm,
                            topic=topic,
                            script_template=script_template,
                            script_model=script_model,
                            split_template=split_template,
                            split_model=split_model,
                            languages=target_languages,
                            language_script_templates=language_script_templates,
                            language_script_models=language_script_models,
                            status_callback=update_draft_status,
                        )
                    )
                    draft["selected_for_generation"] = True
                    drafts.append(draft)
                except Exception as exc:
                    logger.exception(exc)
                    errors.append(f"{topic}: {exc}")
                progress.progress(index / len(topics))

            st.session_state[DRAFTS_KEY] = drafts
            st.session_state[RESULTS_KEY] = []
            st.session_state[ERRORS_KEY] = errors
            status.empty()

            if errors:
                for error in errors:
                    st.error(error)
            if drafts:
                st.success(_sr("generated_drafts", "Generated {count} review draft(s)", count=len(drafts)))

        if st.button(_sr("clear_drafts", "Clear Review Drafts"), use_container_width=True, key="script_review_clear"):
            st.session_state[DRAFTS_KEY] = []
            st.session_state[RESULTS_KEY] = []
            st.session_state[ERRORS_KEY] = []

        _render_draft_editor()


def _video_base_config(video_params: dict[str, Any]) -> dict[str, Any]:
    config = {
        "media_workflow": video_params.get("media_workflow"),
        "frame_template": video_params.get("frame_template"),
        "prompt_prefix": video_params.get("prompt_prefix", ""),
        "image_prompt_visual_context": video_params.get("image_prompt_visual_context"),
        "image_prompt_generation_rules": video_params.get("image_prompt_generation_rules"),
        "bgm_path": video_params.get("bgm_path"),
        "bgm_volume": video_params.get("bgm_volume", 0.2) if video_params.get("bgm_path") else 0.2,
        "media_width": st.session_state.get("template_media_width"),
        "media_height": st.session_state.get("template_media_height"),
        "tts_inference_mode": video_params.get("tts_inference_mode", "local"),
    }

    tts_mode = config["tts_inference_mode"]
    if tts_mode in ("local", "fish"):
        if video_params.get("tts_voice"):
            config["tts_voice"] = video_params.get("tts_voice")
        if video_params.get("tts_speed"):
            config["tts_speed"] = video_params.get("tts_speed")
    else:
        if video_params.get("tts_workflow"):
            config["tts_workflow"] = video_params.get("tts_workflow")
        if video_params.get("ref_audio"):
            config["ref_audio"] = str(video_params["ref_audio"])

    if video_params.get("template_params"):
        config["template_params"] = video_params["template_params"]

    return {key: value for key, value in config.items() if value is not None}


def _render_results():
    results = st.session_state.get(RESULTS_KEY, [])
    errors = st.session_state.get(ERRORS_KEY, [])
    if not results and not errors:
        return

    st.markdown("---")
    st.markdown(f"**{_sr('generation_results', 'Generation Results')}**")
    if results:
        for result in results:
            st.success(f"{result['topic']} / {_language_label(result['language'])}: {result['video_path']}")
    if errors:
        for error in errors:
            st.error(error["message"] if isinstance(error, dict) else error)


def render_script_review_generation(pixelle_video, video_params: dict[str, Any]):
    with st.container(border=True):
        st.markdown(f"**{_sr('generate_reviewed_videos', 'Generate Reviewed Videos')}**")

        drafts = [
            draft
            for draft in st.session_state.get(DRAFTS_KEY, [])
            if draft.get("selected_for_generation", True)
        ]
        if not drafts:
            st.info(_sr("generate_drafts_first", "Generate and approve review drafts first."))
            st.info(_sr(
                "per_language_tts_after_drafts",
                "After drafts are ready, each selected language will show its own Fish reference_id and speed here.",
            ))
            _render_results()
            return

        validation_errors = []
        for draft in drafts:
            validation_errors.extend(validate_draft_translation_counts(draft))

        for error in validation_errors:
            st.error(error)

        independent_review = _independent_review_mode(drafts)
        base_config = _video_base_config(video_params)
        language_tts_overrides = None
        if independent_review:
            base_config["tts_inference_mode"] = "fish"
            base_config.pop("tts_workflow", None)
            base_config.pop("ref_audio", None)
            base_config.pop("tts_voice", None)
            base_config.pop("tts_speed", None)
            language_tts_overrides = st.session_state.get(LANGUAGE_TTS_KEY) or {}
            tts_errors = validate_language_tts_overrides(drafts, language_tts_overrides)
            for error in tts_errors:
                st.error(_sr("fish_reference_required", "{error}", error=error))
            validation_errors.extend(tts_errors)

        jobs = []
        if not validation_errors:
            jobs = build_generation_jobs(
                drafts,
                base_config=base_config,
                language_tts_overrides=language_tts_overrides,
            )

        st.caption(_sr("ready_to_generate", "Ready to generate {count} video(s)", count=len(jobs)))
        if st.button(
            _sr("generate_approved_videos", "Generate Approved Videos"),
            type="primary",
            disabled=not jobs or bool(validation_errors),
            use_container_width=True,
            key="script_review_generate_videos",
        ):
            results = []
            errors = []
            progress = st.progress(0)
            status = st.empty()

            for index, job in enumerate(jobs, 1):
                language_label = _language_label(job["language"])
                status.text(_sr("generating_video", "Generating {index}/{total}: {topic} / {language}", index=index, total=len(jobs), topic=job["topic"], language=language_label))

                def update_progress(event: ProgressEvent):
                    progress.progress(_overall_video_progress(index, len(jobs), event.progress))
                    status.text(
                        _sr(
                            "video_progress_status",
                            "Generating {index}/{total}: {topic} / {language} - {progress}",
                            index=index,
                            total=len(jobs),
                            topic=job["topic"],
                            language=language_label,
                            progress=_video_event_label(event),
                        )
                    )

                try:
                    params = dict(job["params"])
                    params["progress_callback"] = update_progress
                    result = run_async(pixelle_video.generate_video(**params))
                    task_id = Path(result.video_path).parent.name
                    results.append(
                        {
                            "topic": job["topic"],
                            "language": job["language"],
                            "task_id": task_id,
                            "video_path": result.video_path,
                        }
                    )
                except Exception as exc:
                    logger.exception(exc)
                    errors.append(
                        {
                            "topic": job["topic"],
                            "language": job["language"],
                            "message": f"{job['topic']} / {job['language']}: {exc}",
                            "traceback": traceback.format_exc(),
                        }
                    )
                progress.progress(index / len(jobs))

            status.empty()
            st.session_state[RESULTS_KEY] = results
            st.session_state[ERRORS_KEY] = errors
            if results:
                st.success(_sr("generated_videos", "Generated {count} video(s)", count=len(results)))
            if errors:
                st.error(_sr("failed_videos", "{count} video(s) failed", count=len(errors)))

        _render_results()
