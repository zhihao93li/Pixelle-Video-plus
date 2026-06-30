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
    assert template.use_case == "daily"
    assert template.runtime_label == "标准稳定合成"
    assert template.advanced_controls_hidden is True


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


def test_templates_include_product_metadata_and_light_montage_options():
    registry = build_default_production_template_registry()

    templates = {template.id: template for template in registry.list()}

    assert list(templates) == [
        "petwoods_xhs_daily_v1",
        "petwoods_xhs_quality_explainer_v1",
        "petwoods_xhs_asset_enhanced_v1",
        "petwoods_xhs_real_material_montage_v1",
    ]
    assert templates["petwoods_xhs_quality_explainer_v1"].use_case == "high_quality"
    assert templates["petwoods_xhs_quality_explainer_v1"].runtime_label == "高质量动效合成"
    assert "渲染环境" in templates["petwoods_xhs_quality_explainer_v1"].failure_guidance
    assert templates["petwoods_xhs_real_material_montage_v1"].requires_user_assets is True
    assert templates["petwoods_xhs_real_material_montage_v1"].pipeline_id == "asset_based"
    assert templates["petwoods_xhs_real_material_montage_v1"].entry == "assets"
    assert templates["petwoods_xhs_real_material_montage_v1"].user_selectable_providers == []


def test_asset_montage_template_compiles_to_asset_based_request_without_provider_choice():
    registry = build_default_production_template_registry()

    request = registry.compile_request(
        "petwoods_xhs_real_material_montage_v1",
        input={
            "assets": [
                {"kind": "video", "path": "footage/cat-1.mp4", "role": "source_footage"},
                {"kind": "image", "path": "footage/cat-cover.png", "role": "cover"},
            ],
            "intent": "猫咪生活方式科普",
        },
    )

    assert request.pipeline_id == "asset_based"
    assert request.entry == "assets"
    assert request.input["assets"][0]["role"] == "source_footage"
    assert request.params["compose_runtime"] == "html_ffmpeg"
    assert request.params["quality_profile"] == "basic"
    assert "provider" not in request.params
    assert request.metadata["production_template"]["id"] == "petwoods_xhs_real_material_montage_v1"
