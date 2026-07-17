import pytest

from pixelle_video.generation import (
    PipelineRegistry,
    build_default_pipeline_manifests,
    build_default_pipeline_registry,
)


def _field_names(fields):
    return [field.name for field in fields]


def test_default_pipeline_manifests_have_one_input_contract_each():
    manifests = build_default_pipeline_manifests()

    assert [manifest.id for manifest in manifests] == [
        "topic_to_video",
        "script_to_video",
        "line_script_to_video",
        "codex_scene_video",
        "asset_based",
        "topic_to_image_post",
        "image_post",
        "topic_to_long_form",
        "long_form",
        "i2v",
        "action_transfer",
        "digital_human",
    ]

    topic = next(item for item in manifests if item.id == "topic_to_video")
    assert _field_names(topic.input.required_fields) == ["topic"]
    assert topic.stages[0].id == "generate_script"
    assert any(stage.actor == "user" for stage in topic.stages)

    script = next(item for item in manifests if item.id == "script_to_video")
    assert _field_names(script.input.required_fields) == ["script"]
    assert script.stages[0].id == "split_scenes"
    assert all(stage.id != "generate_script" for stage in script.stages)
    assert script.quick_setting_keys == [
        "frame_template",
        "tts_voice",
        "tts_speed",
        "bgm_path",
    ]
    assert set(script.quick_setting_keys) <= {
        key for stage in script.stages for key in stage.setting_keys
    }

    line_script = next(item for item in manifests if item.id == "line_script_to_video")
    assert _field_names(line_script.input.required_fields) == ["script"]
    assert line_script.stages[0].id == "parse_line_scenes"
    assert all(stage.id != "split_scenes" for stage in line_script.stages)
    assert all(
        not key.startswith("split_") for stage in line_script.stages for key in stage.setting_keys
    )

    codex = next(item for item in manifests if item.id == "codex_scene_video")
    assert codex.access_scope == "agent"
    assert codex.launch_surfaces == ["agent"]
    assert _field_names(codex.input.required_fields) == ["scenes"]
    assert _field_names(codex.input.optional_fields) == ["title"]
    assert all(
        field.name != "n_scenes"
        for field in codex.input.required_fields + codex.input.optional_fields
    )

    assert _field_names(
        next(item for item in manifests if item.id == "asset_based").input.required_fields
    ) == ["assets"]
    assert _field_names(
        next(item for item in manifests if item.id == "i2v").input.required_fields
    ) == ["assets", "prompt"]
    assert _field_names(
        next(item for item in manifests if item.id == "action_transfer").input.required_fields
    ) == ["reference_video", "assets", "prompt"]
    assert _field_names(
        next(item for item in manifests if item.id == "digital_human").input.required_fields
    ) == ["character_assets"]


def test_pipeline_registry_lists_manifests_and_rejects_duplicate_ids():
    registry = PipelineRegistry()
    manifest = build_default_pipeline_manifests()[0]

    registry.register(manifest, pipeline=object())

    assert registry.pipeline_ids() == ["topic_to_video"]
    assert registry.get_manifest("topic_to_video") is manifest
    assert registry.get_pipeline("topic_to_video") is not None
    assert registry.list_manifests() == [manifest]

    with pytest.raises(ValueError, match="topic_to_video"):
        registry.register(manifest)


def test_pipeline_manifest_rejects_quick_settings_outside_stage_contract():
    manifest = build_default_pipeline_manifests()[0]
    payload = manifest.model_dump()
    payload["quick_setting_keys"] = ["invented_setting"]

    with pytest.raises(ValueError, match="outside its stage contract"):
        type(manifest)(**payload)


def test_default_pipeline_registry_can_be_built_without_running_generation():
    registry = build_default_pipeline_registry()

    assert registry.pipeline_ids() == [
        "topic_to_video",
        "script_to_video",
        "line_script_to_video",
        "codex_scene_video",
        "asset_based",
        "topic_to_image_post",
        "image_post",
        "topic_to_long_form",
        "long_form",
        "i2v",
        "action_transfer",
        "digital_human",
    ]


@pytest.mark.asyncio
async def test_pixelle_core_registers_pipeline_instances_and_manifests():
    from pixelle_video.service import PixelleVideoCore

    core = PixelleVideoCore()
    await core.initialize()

    expected = {
        "topic_to_video",
        "script_to_video",
        "line_script_to_video",
        "codex_scene_video",
        "asset_based",
        "topic_to_image_post",
        "image_post",
        "topic_to_long_form",
        "long_form",
        "i2v",
        "action_transfer",
        "digital_human",
    }
    assert set(core.pipeline_registry.pipeline_ids()) == expected
    assert set(core.pipeline_registry.pipeline_ids()) == set(core.pipelines.keys())
    assert core.pipeline_registry.get_pipeline("topic_to_video") is core.pipelines["topic_to_video"]
    assert (
        core.pipeline_registry.get_pipeline("script_to_video") is core.pipelines["script_to_video"]
    )
    assert (
        core.pipeline_registry.get_pipeline("line_script_to_video")
        is core.pipelines["line_script_to_video"]
    )
    assert core.pipeline_registry.get_pipeline("i2v") is core.pipelines["i2v"]
