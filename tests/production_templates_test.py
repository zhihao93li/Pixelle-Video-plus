import pytest

from pixelle_video.generation.templates import (
    ProductionTemplateError,
    build_default_production_template_registry,
)

STANDARD_SKELETON = "pipeline_standard_base_v1"
LINE_SCRIPT_SKELETON = "pipeline_line_script_to_video_base_v1"
TOPIC_SKELETON = "pipeline_topic_to_video_base_v1"
ASSET_SKELETON = "pipeline_asset_based_base_v1"
CODEX_IMAGE_STORY = "codex_image_story_v1"


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

    assert request.pipeline_id == "script_to_video"
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
        "pipeline_id": "script_to_video",
        "quality_tier": "daily",
    }


def test_codex_image_story_is_codex_only_and_preserves_confirmed_scenes():
    registry = build_default_production_template_registry()
    scenes = [
        {
            "scene_id": "scene-1",
            "narration": "Cats like narrow boxes.",
            "image_prompt": "A cat inside a cardboard box",
            "image_path": "/tmp/scene-1.png",
        }
    ]

    template = registry.get(CODEX_IMAGE_STORY)
    assert template.access_scope == "agent"
    assert template.pipeline_id == "codex_scene_video"
    assert "prompt_prefix" in template.allowed_user_params

    with pytest.raises(ProductionTemplateError, match="only available through an Agent"):
        registry.compile_request(CODEX_IMAGE_STORY, input={"scenes": scenes})

    request = registry.compile_request(
        CODEX_IMAGE_STORY,
        input={
            "scenes": scenes,
            "prompt_prefix": "warm editorial illustration",
        },
        surface="agent",
    )
    assert request.pipeline_id == "codex_scene_video"
    assert request.input == {"scenes": scenes}
    assert request.params["prompt_prefix"] == "warm editorial illustration"
    assert "media_workflow" not in request.params


def test_line_script_skeleton_preserves_lines_without_scene_planning_settings():
    registry = build_default_production_template_registry()
    template = registry.get(LINE_SCRIPT_SKELETON)

    assert template.pipeline_id == "line_script_to_video"
    assert template.input_requirements == ["script"]
    assert not any(key.startswith("split_") for key in template.allowed_user_params)
    assert not any(key.startswith("split_") for key in template.fixed_params)

    request = registry.compile_request(
        LINE_SCRIPT_SKELETON,
        input={
            "script": "第一镜\n\n第二镜",
            "title": "逐行测试",
        },
    )
    assert request.pipeline_id == "line_script_to_video"
    assert request.input == {"script": "第一镜\n\n第二镜"}
    assert request.params["title"] == "逐行测试"


def test_writing_and_scene_settings_belong_to_the_route_recipe():
    registry = build_default_production_template_registry()
    topic = registry.get(TOPIC_SKELETON)
    script = registry.get(STANDARD_SKELETON)

    assert topic.fixed_params["script_template_name"] == "Short Oral Script"
    assert topic.fixed_params["split_template_name"] == "Copy-Safe Scene Split"
    assert "script_template_name" in topic.allowed_user_params
    assert "split_template_name" in topic.allowed_user_params
    assert "script_template_name" not in script.allowed_user_params
    assert script.fixed_params["split_template_name"] == "Copy-Safe Scene Split"
    assert "n_scenes" not in topic.fixed_params
    assert "n_scenes" not in script.fixed_params
    assert "split_mode" not in topic.fixed_params
    assert "split_mode" not in script.fixed_params


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

    assert registry.initial_template_id() == STANDARD_SKELETON
    template = registry.get(STANDARD_SKELETON)
    assert template.pipeline_id == "script_to_video"
    assert template.enabled is True


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


def test_builtin_video_templates_inherit_the_system_tts_service():
    registry = build_default_production_template_registry()
    for template_id in (
        TOPIC_SKELETON,
        STANDARD_SKELETON,
        LINE_SCRIPT_SKELETON,
        ASSET_SKELETON,
        "pixelle_digital_human_basic_v1",
    ):
        params = registry.get(template_id).fixed_params
        assert "tts_inference_mode" not in params
        assert "tts_voice" not in params


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


def test_registry_lists_current_skeletons_in_stable_order():
    registry = build_default_production_template_registry()
    ids = [template.id for template in registry.list()]

    assert ids[0] == TOPIC_SKELETON
    assert ids[1] == STANDARD_SKELETON
    assert ids[2] == LINE_SCRIPT_SKELETON
    assert ids[3] == CODEX_IMAGE_STORY
    assert ids[4] == ASSET_SKELETON


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
