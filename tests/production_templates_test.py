import pytest

from pixelle_video.generation.templates import (
    ProductionTemplateError,
    build_default_production_template_registry,
)


def test_daily_production_template_compiles_to_existing_generation_request():
    registry = build_default_production_template_registry()

    request = registry.compile_request(
        "petwoods_xhs_daily_v1",
        input={
            "script": "Scene one.\nScene two.",
            "title": "User title",
            "bgm_volume": 0.12,
            "media_width": 1080,
            "media_height": 1440,
            "image_prompt_visual_context": "warm pet care brand context",
            "ref_audio": "/tmp/ref.wav",
            "provider": "should-not-pass-through",
        },
        metadata={"experiment_id": "exp-1"},
    )
    second_request = registry.compile_request(
        "petwoods_xhs_daily_v1",
        input={"script": "A different script."},
    )

    assert request.pipeline_id == "standard"
    assert request.entry == "script"
    assert request.input == {"script": "Scene one.\nScene two."}
    assert request.params["title"] == "User title"
    assert request.params["bgm_volume"] == 0.12
    assert request.params["media_width"] == 1080
    assert request.params["media_height"] == 1440
    assert request.params["image_prompt_visual_context"] == "warm pet care brand context"
    assert request.params["ref_audio"] == "/tmp/ref.wav"
    assert "provider" not in request.params
    assert request.params["compose_runtime"] == second_request.params["compose_runtime"]
    assert request.params["quality_profile"] == second_request.params["quality_profile"]
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
    assert template.migration_status == "ready"
    assert template.enabled is True


def test_topic_template_compiles_to_standard_topic_generation_request():
    registry = build_default_production_template_registry()

    request = registry.compile_request(
        "petwoods_xhs_topic_to_video_v1",
        input={
            "topic": "猫咪夏天饮水",
            "title": "猫咪饮水提醒",
            "n_scenes": 4,
            "frame_template": "1080x1920/image_modern.html",
        },
    )

    assert request.pipeline_id == "standard"
    assert request.entry == "topic"
    assert request.input == {"topic": "猫咪夏天饮水"}
    assert request.params["mode"] == "generate"
    assert request.params["title"] == "猫咪饮水提醒"
    assert request.params["n_scenes"] == 4
    assert request.params["frame_template"] == "1080x1920/image_modern.html"


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
        "petwoods_xhs_static_subtitle_v1",
        "petwoods_xhs_topic_to_video_v1",
        "petwoods_xhs_quality_explainer_v1",
        "petwoods_xhs_asset_enhanced_v1",
        "petwoods_xhs_real_material_montage_v1",
        "pixelle_i2v_basic_v1",
        "pixelle_action_transfer_basic_v1",
        "pixelle_digital_human_basic_v1",
        "pixelle_script_review_v1",
        "pixelle_batch_production_v1",
    ]
    assert templates["petwoods_xhs_static_subtitle_v1"].use_case == "static_subtitle"
    assert templates["petwoods_xhs_static_subtitle_v1"].required_capabilities == [
        "llm",
        "tts",
        "ffmpeg",
        "persistence",
    ]
    assert templates["petwoods_xhs_static_subtitle_v1"].user_selectable_providers == []
    assert templates["petwoods_xhs_quality_explainer_v1"].use_case == "high_quality"
    assert templates["petwoods_xhs_quality_explainer_v1"].runtime_label == "高质量动效合成"
    assert "渲染环境" in templates["petwoods_xhs_quality_explainer_v1"].failure_guidance
    assert templates["petwoods_xhs_real_material_montage_v1"].requires_user_assets is True
    assert templates["petwoods_xhs_real_material_montage_v1"].pipeline_id == "asset_based"
    assert templates["petwoods_xhs_real_material_montage_v1"].entry == "assets"
    assert templates["petwoods_xhs_real_material_montage_v1"].user_selectable_providers == []
    assert templates["pixelle_i2v_basic_v1"].enabled is True
    assert templates["pixelle_i2v_basic_v1"].migration_status == "ready"
    assert templates["pixelle_i2v_basic_v1"].pipeline_id == "i2v"
    assert templates["pixelle_action_transfer_basic_v1"].enabled is True
    assert templates["pixelle_action_transfer_basic_v1"].pipeline_id == "action_transfer"
    assert templates["pixelle_digital_human_basic_v1"].enabled is True
    assert templates["pixelle_digital_human_basic_v1"].pipeline_id == "digital_human"
    assert templates["pixelle_script_review_v1"].migration_status == "ready"
    assert templates["pixelle_script_review_v1"].enabled is False
    assert "专用 draft API" in templates["pixelle_script_review_v1"].migration_notes
    assert templates["pixelle_batch_production_v1"].migration_status == "ready"
    assert templates["pixelle_batch_production_v1"].enabled is False
    assert "持久化 batch API" in templates["pixelle_batch_production_v1"].migration_notes


def test_static_subtitle_template_compiles_to_provider_independent_request():
    registry = build_default_production_template_registry()

    request = registry.compile_request(
        "petwoods_xhs_static_subtitle_v1",
        input={
            "script": "Scene one.",
            "title": "字幕版",
            "media_workflow": "runninghub/image_flux.json",
        },
        available_capabilities={"llm", "tts", "ffmpeg", "persistence"},
    )

    assert request.pipeline_id == "standard"
    assert request.entry == "script"
    assert request.input == {"script": "Scene one."}
    assert request.params["frame_template"] == "1080x1920/static_default.html"
    assert request.params["title"] == "字幕版"
    assert "media_workflow" not in request.params
    assert request.metadata["production_template"]["id"] == "petwoods_xhs_static_subtitle_v1"


def test_special_workflow_templates_compile_to_unified_generation_requests():
    registry = build_default_production_template_registry()

    i2v_request = registry.compile_request(
        "pixelle_i2v_basic_v1",
        input={
            "assets": ["/tmp/cat.jpg"],
            "prompt": "make it move",
            "title": "I2V title",
        },
    )
    action_request = registry.compile_request(
        "pixelle_action_transfer_basic_v1",
        input={
            "reference_video": "/tmp/action.mp4",
            "assets": ["/tmp/person.jpg"],
            "prompt": "transfer this dance",
            "duration": 12,
        },
    )
    digital_request = registry.compile_request(
        "pixelle_digital_human_basic_v1",
        input={
            "character_assets": ["/tmp/avatar.jpg"],
            "script": "大家好，今天介绍这款猫粮。",
            "goods_assets": ["/tmp/product.jpg"],
            "mode": "digital",
            "tts_inference_mode": "fish",
            "tts_voice": "fish-ref",
        },
    )
    digital_product_request = registry.compile_request(
        "pixelle_digital_human_basic_v1",
        input={
            "character_assets": ["/tmp/avatar.jpg"],
            "goods_assets": ["/tmp/product.jpg"],
            "goods_title": "低敏猫粮",
            "mode": "digital",
        },
    )

    assert i2v_request.pipeline_id == "i2v"
    assert i2v_request.entry == "assets"
    assert i2v_request.input == {
        "assets": ["/tmp/cat.jpg"],
        "prompt": "make it move",
    }
    assert i2v_request.params["workflow_key"] == "runninghub/i2v_LTX2.json"
    assert i2v_request.params["title"] == "I2V title"

    assert action_request.pipeline_id == "action_transfer"
    assert action_request.entry == "video"
    assert action_request.input["reference_video"] == "/tmp/action.mp4"
    assert action_request.params["workflow_key"] == "runninghub/af_scail.json"
    assert action_request.params["duration"] == 12

    assert digital_request.pipeline_id == "digital_human"
    assert digital_request.entry == "assets"
    assert digital_request.input == {
        "character_assets": ["/tmp/avatar.jpg"],
        "script": "大家好，今天介绍这款猫粮。",
    }
    assert digital_request.params["mode"] == "digital"
    assert digital_request.params["goods_assets"] == ["/tmp/product.jpg"]
    assert digital_request.params["tts_voice"] == "fish-ref"
    assert "provider" not in digital_request.params

    assert digital_product_request.input == {
        "character_assets": ["/tmp/avatar.jpg"],
    }
    assert "script" not in digital_product_request.input
    assert digital_product_request.params["mode"] == "digital"
    assert digital_product_request.params["goods_assets"] == ["/tmp/product.jpg"]
    assert digital_product_request.params["goods_title"] == "低敏猫粮"


def test_dedicated_workflow_templates_do_not_compile_through_generic_task_entry():
    registry = build_default_production_template_registry()

    with pytest.raises(ProductionTemplateError, match="generic production-template task endpoint"):
        registry.compile_request(
            "pixelle_script_review_v1",
            input={"topic": "Cat hydration"},
        )


def test_asset_montage_template_compiles_to_asset_based_request_without_provider_choice():
    registry = build_default_production_template_registry()

    request = registry.compile_request(
        "petwoods_xhs_real_material_montage_v1",
        input={
            "assets": [
                "/footage/cat-1.mp4",
                "/footage/cat-cover.png",
            ],
            "intent": "猫咪生活方式科普",
            "bgm_path": "/music/light.mp3",
            "bgm_volume": 0.15,
            "bgm_mode": "once",
            "voice_id": "zh-CN-YunjianNeural",
            "tts_speed": 1.3,
            "source": "selfhost",
            "provider": "should-not-pass-through",
        },
    )

    assert request.pipeline_id == "asset_based"
    assert request.entry == "assets"
    assert request.input["assets"][0] == "/footage/cat-1.mp4"
    assert request.params["compose_runtime"] == "html_ffmpeg"
    assert request.params["quality_profile"] == "basic"
    assert request.params["source"] == "runninghub"
    assert request.params["runninghub_instance_type"] == "plus"
    assert request.params["bgm_path"] == "/music/light.mp3"
    assert request.params["bgm_volume"] == 0.15
    assert request.params["bgm_mode"] == "once"
    assert request.params["voice_id"] == "zh-CN-YunjianNeural"
    assert request.params["tts_speed"] == 1.3
    assert request.params["source"] != "selfhost"
    assert "provider" not in request.params
    assert request.metadata["production_template"]["id"] == "petwoods_xhs_real_material_montage_v1"


def test_asset_template_rejects_non_path_asset_values_before_runtime():
    registry = build_default_production_template_registry()

    with pytest.raises(ProductionTemplateError, match="assets must be a list of file paths"):
        registry.compile_request(
            "petwoods_xhs_asset_enhanced_v1",
            input={
                "assets": [
                    {"kind": "image", "path": "/footage/cat-cover.png"},
                ],
            },
        )
