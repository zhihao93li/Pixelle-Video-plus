import pytest

from pixelle_video.generation import (
    PipelineRegistry,
    build_default_pipeline_manifests,
    build_default_pipeline_registry,
)


def _field_names(fields):
    return [field.name for field in fields]


def test_default_pipeline_manifests_describe_current_pipeline_entries():
    manifests = build_default_pipeline_manifests()

    assert [manifest.id for manifest in manifests] == ["standard", "custom", "asset_based"]

    standard = next(manifest for manifest in manifests if manifest.id == "standard")
    assert standard.default_entry == "topic"
    assert {entry.id for entry in standard.entries} == {"topic", "script"}

    topic_entry = standard.entry("topic")
    assert _field_names(topic_entry.required_fields) == ["topic"]
    assert topic_entry.start_stage == "generate_script"

    script_entry = standard.entry("script")
    assert _field_names(script_entry.required_fields) == ["script"]
    assert script_entry.start_stage == "split_scenes"
    assert "generate_script" in script_entry.skipped_stages

    asset_based = next(manifest for manifest in manifests if manifest.id == "asset_based")
    assert asset_based.default_entry == "assets"
    assert {entry.id for entry in asset_based.entries} == {"assets"}
    assert _field_names(asset_based.entry("assets").required_fields) == ["assets"]


def test_pipeline_registry_lists_manifests_and_rejects_duplicate_ids():
    registry = PipelineRegistry()
    manifest = build_default_pipeline_manifests()[0]

    registry.register(manifest, pipeline=object())

    assert registry.pipeline_ids() == ["standard"]
    assert registry.get_manifest("standard") is manifest
    assert registry.get_pipeline("standard") is not None
    assert registry.list_manifests() == [manifest]

    with pytest.raises(ValueError, match="standard"):
        registry.register(manifest)


def test_default_pipeline_registry_can_be_built_without_running_generation():
    registry = build_default_pipeline_registry()

    assert registry.pipeline_ids() == ["standard", "custom", "asset_based"]
    assert registry.get_manifest("custom").default_entry == "script"
    assert registry.get_pipeline("custom") is None


@pytest.mark.asyncio
async def test_pixelle_core_registers_pipeline_instances_and_manifests():
    from pixelle_video.service import PixelleVideoCore

    core = PixelleVideoCore()
    await core.initialize()

    assert core.pipeline_registry.pipeline_ids() == ["standard", "custom", "asset_based"]
    assert set(core.pipeline_registry.pipeline_ids()) == set(core.pipelines.keys())
    assert core.pipeline_registry.get_pipeline("standard") is core.pipelines["standard"]
    assert core.pipeline_registry.get_manifest("asset_based").default_entry == "assets"
