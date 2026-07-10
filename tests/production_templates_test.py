import pytest

from pixelle_video.generation.templates import (
    ProductionTemplateError,
    build_default_production_template_registry,
)

STANDARD_SKELETON = "pipeline_standard_base_v1"
ASSET_SKELETON = "pipeline_asset_based_base_v1"

RETIRED_TEMPLATES = [
    "petwoods_xhs_daily_v1",
    "petwoods_xhs_static_subtitle_v1",
    "petwoods_xhs_topic_to_video_v1",
    "petwoods_xhs_quality_explainer_v1",
    "petwoods_xhs_asset_enhanced_v1",
    "petwoods_xhs_real_material_montage_v1",
]


def test_standard_skeleton_compiles_to_existing_generation_request():
    registry = build_default_production_template_registry()

    request = registry.compile_request(
        STANDARD_SKELETON,
        input={
            "script": "Scene one.\nScene two.",
            "title": "User title",
            "bgm_volume": 0.12,
            "media_width": 1080,
            "media_height": 1440,
            "image_prompt_visual_context": "warm brand context",
            "ref_audio": "/tmp/ref.wav",
            "provider": "should-not-pass-through",
        },
        metadata={"experiment_id": "exp-1"},
    )

    assert request.pipeline_id == "standard"
    assert request.entry == "script"
    assert request.input == {"script": "Scene one.\nScene two."}
    assert request.params["title"] == "User title"
    assert request.params["bgm_volume"] == 0.12
    assert request.params["media_width"] == 1080
    assert request.params["compose_runtime"] == "html_ffmpeg"
    assert request.params["quality_profile"] == "basic"
    assert request.params["allow_silent"] is False
    assert "provider" not in request.params
    assert request.metadata["experiment_id"] == "exp-1"
    assert request.metadata["production_template"] == {
        "id": STANDARD_SKELETON,
        "version": "v1",
        "name": "图文口播视频",
        "quality_tier": "daily",
    }


def test_explicit_null_clears_an_inherited_per_run_setting():
    registry = build_default_production_template_registry()
    template = registry.get(STANDARD_SKELETON)
    template.fixed_params["bgm_path"] = "/music/recipe-default.mp3"

    inherited = registry.compile_request(
        STANDARD_SKELETON,
        input={"script": "Keep the recipe music."},
    )
    cleared = registry.compile_request(
        STANDARD_SKELETON,
        input={"script": "No music for this run.", "bgm_path": None},
    )

    assert inherited.params["bgm_path"] == "/music/recipe-default.mp3"
    assert "bgm_path" not in cleared.params


def test_registry_default_is_standard_skeleton():
    registry = build_default_production_template_registry()

    assert (
        registry.default_template_id(project="PetWoods", channel="xiaohongshu")
        == STANDARD_SKELETON
    )
    template = registry.get(STANDARD_SKELETON)
    assert template.pipeline_id == "standard"
    assert template.entry == "script"
    assert template.enabled is True
    assert template.migration_status == "ready"


def test_standard_and_asset_skeletons_allow_compose_runtime_override():
    # WP-C：解锁后标准线/素材线可零代码换合成方式（含 hyperframes）
    registry = build_default_production_template_registry()
    for template_id in (STANDARD_SKELETON, ASSET_SKELETON):
        assert "compose_runtime" in registry.get(template_id).allowed_user_params


def test_skeletons_fixed_params_have_no_brand_words():
    registry = build_default_production_template_registry()
    for template_id in (STANDARD_SKELETON, ASSET_SKELETON):
        template = registry.get(template_id)
        blob = f"{template.fixed_params}{template.project}{template.channel}".lower()
        assert "petwoods" not in blob
        assert template.project is None
        assert template.channel is None


def test_retired_templates_are_disabled_and_reject_compile():
    registry = build_default_production_template_registry()
    for template_id in RETIRED_TEMPLATES:
        template = registry.get(template_id)  # 仍在注册表里（退役≠删除）
        assert template.enabled is False
        assert "退役" in template.migration_notes
        with pytest.raises(ProductionTemplateError):
            registry.compile_request(template_id, input={"script": "x"})


def test_asset_skeleton_compiles_to_asset_based_request():
    registry = build_default_production_template_registry()

    request = registry.compile_request(
        ASSET_SKELETON,
        input={
            "assets": ["/footage/clip-1.mp4", "/footage/cover.png"],
            "intent": "生活方式科普",
            "bgm_path": "/music/light.mp3",
            "bgm_volume": 0.15,
            "voice_id": "zh-CN-YunjianNeural",
            "tts_speed": 1.3,
            "source": "selfhost",
            "provider": "should-not-pass-through",
        },
    )

    assert request.pipeline_id == "asset_based"
    assert request.entry == "assets"
    assert request.input["assets"][0] == "/footage/clip-1.mp4"
    assert request.params["compose_runtime"] == "html_ffmpeg"
    assert request.params["source"] == "runninghub"  # 固定，用户传的 selfhost 不通过
    assert request.params["bgm_path"] == "/music/light.mp3"
    assert request.params["voice_id"] == "zh-CN-YunjianNeural"
    assert "provider" not in request.params


def test_asset_skeleton_rejects_non_path_asset_values():
    registry = build_default_production_template_registry()

    with pytest.raises(ProductionTemplateError, match="assets must be a list of file paths"):
        registry.compile_request(
            ASSET_SKELETON,
            input={"assets": [{"kind": "image", "path": "/footage/cover.png"}]},
        )


def test_standard_skeleton_requires_ffmpeg_capability():
    registry = build_default_production_template_registry()

    with pytest.raises(ProductionTemplateError, match="ffmpeg"):
        registry.compile_request(
            STANDARD_SKELETON,
            input={"script": "Scene one."},
            available_capabilities={"llm", "tts", "media", "persistence"},
        )


def test_registry_lists_skeletons_before_retired_and_placeholders():
    registry = build_default_production_template_registry()
    ids = [template.id for template in registry.list()]

    assert ids[0] == STANDARD_SKELETON
    assert ids[1] == ASSET_SKELETON
    for template_id in RETIRED_TEMPLATES:
        assert template_id in ids  # 退役但保留
        assert ids.index(template_id) < ids.index("pixelle_script_review_v1")
    # 自定义模板会追加在内置占位模板之后，不能假设占位模板永远是列表最后一项。
    assert "pixelle_script_review_v1" in ids


def test_annotate_retired_marks_only_retired_generate_presets():
    from pixelle_video.generation.templates import annotate_retired

    registry = build_default_production_template_registry()
    templates = registry.list()
    annotate_retired(templates)
    by_id = {template.id: template for template in templates}

    for template_id in RETIRED_TEMPLATES:
        assert by_id[template_id].retired is True
    # 骨架、workflow 直跑不算退役
    assert by_id[STANDARD_SKELETON].retired is False
    assert by_id[ASSET_SKELETON].retired is False
    assert by_id["pixelle_i2v_basic_v1"].retired is False
    # 专用流程入口占位（enabled=False 但 product_entry != generate）不算退役
    assert by_id["pixelle_script_review_v1"].retired is False


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
            "script": "大家好，今天介绍这款产品。",
            "goods_assets": ["/tmp/product.jpg"],
            "mode": "digital",
            "tts_inference_mode": "fish",
            "tts_voice": "fish-ref",
        },
    )

    assert i2v_request.pipeline_id == "i2v"
    assert i2v_request.params["workflow_key"] == "runninghub/i2v_LTX2.json"
    assert i2v_request.params["title"] == "I2V title"

    assert action_request.pipeline_id == "action_transfer"
    assert action_request.params["workflow_key"] == "runninghub/af_scail.json"
    assert action_request.params["duration"] == 12

    assert digital_request.pipeline_id == "digital_human"
    assert digital_request.params["mode"] == "digital"
    assert digital_request.params["tts_voice"] == "fish-ref"


def test_dedicated_workflow_templates_do_not_compile_through_generic_task_entry():
    registry = build_default_production_template_registry()

    with pytest.raises(ProductionTemplateError):
        registry.compile_request(
            "pixelle_script_review_v1",
            input={"topic": "Cat hydration"},
        )
