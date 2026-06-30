import pytest

from pixelle_video.generation.templates import (
    ProductionTemplateError,
    build_default_production_template_registry,
)


def test_daily_production_template_compiles_to_existing_generation_request():
    registry = build_default_production_template_registry()

    request = registry.compile_request(
        "petwoods_xhs_daily_v1",
        input={"script": "Scene one.\nScene two."},
        metadata={"experiment_id": "exp-1"},
    )
    second_request = registry.compile_request(
        "petwoods_xhs_daily_v1",
        input={"script": "A different script."},
    )

    assert request.pipeline_id == "standard"
    assert request.entry == "script"
    assert request.input == {"script": "Scene one.\nScene two."}
    assert request.params == second_request.params
    assert request.params["compose_runtime"] == "html_ffmpeg"
    assert request.params["quality_profile"] == "basic"
    assert request.params["allow_silent"] is False
    assert "provider" not in request.input
    assert request.metadata["experiment_id"] == "exp-1"
    assert request.metadata["production_template"] == {
        "id": "petwoods_xhs_daily_v1",
        "version": "v1",
        "name": "PetWoods 小红书日常短视频 v1",
        "quality_tier": "daily",
    }


def test_project_default_template_resolves_without_runtime_provider_choice():
    registry = build_default_production_template_registry()

    assert (
        registry.default_template_id(project="PetWoods", channel="xiaohongshu")
        == "petwoods_xhs_daily_v1"
    )
    template = registry.get(registry.default_template_id(project="PetWoods", channel="xiaohongshu"))

    assert template.pipeline_id == "standard"
    assert template.entry == "script"
    assert template.user_selectable_runtime is False
    assert template.user_selectable_providers == []


def test_template_compile_fails_when_required_capability_is_unavailable():
    registry = build_default_production_template_registry()

    with pytest.raises(ProductionTemplateError, match="ffmpeg"):
        registry.compile_request(
            "petwoods_xhs_daily_v1",
            input={"script": "Scene one."},
            available_capabilities={"llm", "tts", "media", "persistence"},
        )


def test_high_quality_template_uses_new_compose_runtime_when_available():
    registry = build_default_production_template_registry()

    request = registry.compile_request(
        "petwoods_xhs_quality_explainer_v1",
        input={"script": "Scene one."},
        available_capabilities={
            "llm",
            "tts",
            "media",
            "ffmpeg",
            "persistence",
            "hyperframes",
        },
    )

    assert request.pipeline_id == "standard"
    assert request.params["compose_runtime"] == "hyperframes"
    assert request.params["quality_profile"] == "strict"
    assert request.metadata["compose_runtime"] == "hyperframes"
    assert request.metadata["production_template"]["quality_tier"] == "high_quality"


def test_high_quality_template_does_not_fallback_when_new_runtime_is_unavailable():
    registry = build_default_production_template_registry()

    with pytest.raises(ProductionTemplateError, match="hyperframes"):
        registry.compile_request(
            "petwoods_xhs_quality_explainer_v1",
            input={"script": "Scene one."},
            available_capabilities={"llm", "tts", "media", "ffmpeg", "persistence"},
        )
