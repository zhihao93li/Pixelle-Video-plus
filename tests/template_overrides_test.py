import json

import pytest

from pixelle_video.generation import build_default_production_template_registry, template_overrides
from pixelle_video.generation.template_overrides import (
    TemplateOverrideError,
    load_all_enabled,
    load_drafting,
    load_enabled,
    load_overrides,
    save_drafting,
    save_enabled,
    save_overrides,
    validate_overrides,
)

# 用已启用的标准骨架（compile 需要 enabled=True）
TEMPLATE_ID = "pipeline_standard_base_v1"


@pytest.fixture(autouse=True)
def isolated_overrides(tmp_path, monkeypatch):
    path = tmp_path / "production-template-overrides.json"
    monkeypatch.setattr(
        template_overrides, "_overrides_path", lambda: str(path)
    )
    yield path


def _allowed_params():
    registry = build_default_production_template_registry()
    return registry.get(TEMPLATE_ID).allowed_user_params


def test_validate_rejects_non_whitelisted_key():
    with pytest.raises(TemplateOverrideError):
        validate_overrides(
            {"pipeline_id": "evil"}, allowed_user_params=_allowed_params()
        )


def test_validate_rejects_key_not_allowed_by_template():
    # media_workflow 在白名单里，但素材骨架不允许它
    registry = build_default_production_template_registry()
    asset_allowed = registry.get(
        "pipeline_asset_based_base_v1"
    ).allowed_user_params
    with pytest.raises(TemplateOverrideError):
        validate_overrides(
            {"media_workflow": "wf"}, allowed_user_params=asset_allowed
        )


def test_validate_rejects_wrong_type():
    with pytest.raises(TemplateOverrideError):
        validate_overrides(
            {"tts_speed": "fast"}, allowed_user_params=_allowed_params()
        )


def test_validate_drops_empty_values():
    cleaned = validate_overrides(
        {"tts_voice": "", "tts_speed": 1.5},
        allowed_user_params=_allowed_params(),
    )
    assert cleaned == {"tts_speed": 1.5}


def test_save_and_apply_overrides(isolated_overrides):
    cleaned = validate_overrides(
        {"tts_inference_mode": "fish", "tts_voice": "ref-123", "bgm_volume": 0.35},
        allowed_user_params=_allowed_params(),
    )
    save_overrides(TEMPLATE_ID, cleaned)

    stored = json.loads(isolated_overrides.read_text(encoding="utf-8"))
    # 包裹格式：参数在 overrides 子对象里
    assert stored[TEMPLATE_ID]["overrides"]["tts_voice"] == "ref-123"

    registry = build_default_production_template_registry()
    params = registry.get(TEMPLATE_ID).fixed_params
    assert params["tts_inference_mode"] == "fish"
    assert params["tts_voice"] == "ref-123"
    assert params["bgm_volume"] == 0.35


def test_save_empty_removes_entry(isolated_overrides):
    save_overrides(TEMPLATE_ID, {"tts_speed": 1.4})
    save_overrides(TEMPLATE_ID, {})
    stored = json.loads(isolated_overrides.read_text(encoding="utf-8"))
    assert TEMPLATE_ID not in stored

    registry = build_default_production_template_registry()
    assert registry.get(TEMPLATE_ID).fixed_params.get("tts_speed") != 1.4


def test_compile_request_uses_override(isolated_overrides):
    save_overrides(
        TEMPLATE_ID,
        validate_overrides(
            {"tts_voice": "zh-CN-XiaoxiaoNeural"},
            allowed_user_params=_allowed_params(),
        ),
    )
    registry = build_default_production_template_registry()
    request = registry.compile_request(
        TEMPLATE_ID, input={"script": "测试文案"}
    )
    assert request.params["tts_voice"] == "zh-CN-XiaoxiaoNeural"


def test_legacy_flat_format_still_parses(isolated_overrides):
    # 旧扁平格式（无 overrides/enabled 包裹）向后兼容
    isolated_overrides.write_text(
        json.dumps({TEMPLATE_ID: {"tts_voice": "legacy-voice"}}),
        encoding="utf-8",
    )
    registry = build_default_production_template_registry()
    assert registry.get(TEMPLATE_ID).fixed_params["tts_voice"] == "legacy-voice"


def test_validate_rejects_unknown_workflow_key():
    registry = build_default_production_template_registry()
    i2v_allowed = registry.get("pixelle_i2v_basic_v1").allowed_user_params
    with pytest.raises(TemplateOverrideError, match="workflow 文件不存在"):
        validate_overrides(
            {"workflow_key": "runninghub/does_not_exist.json"},
            allowed_user_params=i2v_allowed,
        )


def test_validate_accepts_existing_workflow_key():
    registry = build_default_production_template_registry()
    i2v_allowed = registry.get("pixelle_i2v_basic_v1").allowed_user_params
    cleaned = validate_overrides(
        {"workflow_key": "runninghub/i2v_LTX2.json"},
        allowed_user_params=i2v_allowed,
    )
    assert cleaned == {"workflow_key": "runninghub/i2v_LTX2.json"}


def test_validate_accepts_compose_runtime(monkeypatch):
    # 标准骨架已把 compose_runtime 纳入白名单；html_ffmpeg 无需 npx
    monkeypatch.setattr(template_overrides.shutil, "which", lambda name: None)
    assert validate_overrides(
        {"compose_runtime": "html_ffmpeg"}, allowed_user_params=_allowed_params()
    ) == {"compose_runtime": "html_ffmpeg"}
    # hyperframes 在有 npx 时通过
    monkeypatch.setattr(
        template_overrides.shutil, "which", lambda name: "/usr/bin/npx"
    )
    assert validate_overrides(
        {"compose_runtime": "hyperframes"}, allowed_user_params=_allowed_params()
    ) == {"compose_runtime": "hyperframes"}


def test_validate_rejects_unknown_compose_runtime():
    with pytest.raises(TemplateOverrideError, match="合成方式"):
        validate_overrides(
            {"compose_runtime": "premiere"}, allowed_user_params=_allowed_params()
        )


def test_validate_hyperframes_requires_local_npx(monkeypatch):
    monkeypatch.setattr(template_overrides.shutil, "which", lambda name: None)
    with pytest.raises(TemplateOverrideError, match="npx"):
        validate_overrides(
            {"compose_runtime": "hyperframes"},
            allowed_user_params=_allowed_params(),
        )


def _long_form_allowed():
    registry = build_default_production_template_registry()
    return registry.get("pipeline_long_form_base_v1").allowed_user_params


def test_validate_accepts_long_form_params():
    cleaned = validate_overrides(
        {
            "long_form_prompt": "按 {script} 扩写",
            "word_count": 1800,
            "llm_model": "deepseek-v4",
        },
        allowed_user_params=_long_form_allowed(),
    )
    assert cleaned["word_count"] == 1800
    assert cleaned["llm_model"] == "deepseek-v4"


def test_validate_rejects_long_form_prompt_without_script():
    with pytest.raises(TemplateOverrideError, match=r"\{script\}"):
        validate_overrides(
            {"long_form_prompt": "没有占位符"},
            allowed_user_params=_long_form_allowed(),
        )


def test_validate_rejects_word_count_out_of_range():
    with pytest.raises(TemplateOverrideError, match="目标字数"):
        validate_overrides(
            {"word_count": 50}, allowed_user_params=_long_form_allowed()
        )
    with pytest.raises(TemplateOverrideError, match="目标字数"):
        validate_overrides(
            {"word_count": 30000}, allowed_user_params=_long_form_allowed()
        )


def test_save_and_load_enabled_flag(isolated_overrides):
    save_enabled(TEMPLATE_ID, False)
    assert load_enabled(TEMPLATE_ID) is False
    assert load_all_enabled() == {TEMPLATE_ID: False}

    # None 清除开关 → 回到代码默认
    save_enabled(TEMPLATE_ID, None)
    assert load_enabled(TEMPLATE_ID) is None
    assert TEMPLATE_ID not in load_all_enabled()


def test_enabled_flag_and_overrides_coexist(isolated_overrides):
    save_overrides(
        TEMPLATE_ID,
        validate_overrides(
            {"tts_voice": "keep-me"}, allowed_user_params=_allowed_params()
        ),
    )
    save_enabled(TEMPLATE_ID, False)

    stored = json.loads(isolated_overrides.read_text(encoding="utf-8"))
    assert stored[TEMPLATE_ID]["overrides"]["tts_voice"] == "keep-me"
    assert stored[TEMPLATE_ID]["enabled"] is False

    # 停用开关不应抹掉已存的参数覆盖
    assert load_enabled(TEMPLATE_ID) is False
    assert load_overrides(TEMPLATE_ID)["tts_voice"] == "keep-me"


def test_disabled_override_disables_builtin_template(isolated_overrides):
    save_enabled(TEMPLATE_ID, False)
    registry = build_default_production_template_registry()
    assert registry.get(TEMPLATE_ID).enabled is False


def test_drafting_config_is_recipe_owned_and_preserves_other_overrides(isolated_overrides):
    save_overrides(TEMPLATE_ID, {"tts_speed": 1.2})
    save_drafting(
        TEMPLATE_ID,
        {
            "script_template_name": "Short Oral Script",
            "split_template_name": "Copy-Safe Scene Split",
            "script_model": "writer-model",
            "split_model": "splitter-model",
            "language_script_models": {"English": "writer-en"},
        },
    )

    registry = build_default_production_template_registry()
    drafting = registry.get(TEMPLATE_ID).drafting
    assert drafting.script_model == "writer-model"
    assert drafting.language_script_models == {"English": "writer-en"}
    assert load_overrides(TEMPLATE_ID) == {"tts_speed": 1.2}
    assert load_drafting(TEMPLATE_ID)["split_model"] == "splitter-model"

    save_drafting(TEMPLATE_ID, None)
    assert load_drafting(TEMPLATE_ID) is None
    assert load_overrides(TEMPLATE_ID) == {"tts_speed": 1.2}
