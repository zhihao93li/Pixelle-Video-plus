from types import SimpleNamespace

import pytest

from pixelle_video.generation import (
    GenerationRequest,
    GenerationService,
    build_default_pipeline_manifests,
    build_pipeline_registry,
)
from pixelle_video.pipelines.codex_scene_video import (
    CodexSceneVideoPipeline,
    validate_codex_scenes,
)
from pixelle_video.pipelines.linear import PipelineContext


def _scenes(tmp_path, count):
    scenes = []
    for index in range(count):
        image_path = tmp_path / f"scene-{index + 1}.png"
        image_path.write_bytes(b"placeholder")
        scenes.append(
            {
                "scene_id": f"scene-{index + 1}",
                "narration": f"Narration {index + 1}",
                "image_prompt": f"Prompt {index + 1}",
                "image_path": str(image_path),
                "duration": 2.5 + index,
            }
        )
    return scenes


def test_codex_scene_validation_accepts_variable_user_confirmed_counts(tmp_path):
    assert len(validate_codex_scenes(_scenes(tmp_path, 1))) == 1
    assert len(validate_codex_scenes(_scenes(tmp_path, 7))) == 7

    with pytest.raises(ValueError, match="between 1 and 20"):
        validate_codex_scenes([])
    with pytest.raises(ValueError, match="between 1 and 20"):
        validate_codex_scenes(_scenes(tmp_path, 21))


def test_codex_scene_validation_rejects_duplicate_ids_and_missing_images(tmp_path):
    scenes = _scenes(tmp_path, 2)
    scenes[1]["scene_id"] = scenes[0]["scene_id"]
    with pytest.raises(ValueError, match="must be unique"):
        validate_codex_scenes(scenes)

    missing = _scenes(tmp_path, 1)
    missing[0]["image_path"] = str(tmp_path / "missing.png")
    with pytest.raises(ValueError, match="does not exist"):
        validate_codex_scenes(missing)


@pytest.mark.asyncio
async def test_codex_pipeline_builds_storyboard_from_exact_confirmed_scenes(tmp_path):
    core = SimpleNamespace(
        llm=None,
        tts=SimpleNamespace(config={"inference_mode": "local"}),
        media=None,
        video=None,
    )
    pipeline = CodexSceneVideoPipeline(core)
    scenes = _scenes(tmp_path, 3)
    context = PipelineContext(
        input_text="\n".join(scene["narration"] for scene in scenes),
        params={"scenes": scenes, "title": "Confirmed title"},
    )
    context.task_id = "task-1"

    await pipeline.generate_content(context)
    await pipeline.determine_title(context)
    await pipeline.plan_visuals(context)
    await pipeline.initialize_storyboard(context)

    assert context.title == "Confirmed title"
    assert [frame.scene_id for frame in context.storyboard.frames] == [
        "scene-1",
        "scene-2",
        "scene-3",
    ]
    assert [frame.image_path for frame in context.storyboard.frames] == [
        scene["image_path"] for scene in scenes
    ]
    assert [frame.image_prompt for frame in context.storyboard.frames] == [
        "Prompt 1",
        "Prompt 2",
        "Prompt 3",
    ]
    assert [frame.planned_duration for frame in context.storyboard.frames] == [2.5, 3.5, 4.5]


@pytest.mark.asyncio
async def test_generation_service_blocks_codex_pipeline_on_public_surface(tmp_path):
    manifest = next(
        manifest
        for manifest in build_default_pipeline_manifests()
        if manifest.id == "codex_scene_video"
    )

    async def pipeline(**kwargs):
        raise AssertionError("Public surface must reject before pipeline execution")

    registry = build_pipeline_registry(
        [manifest],
        pipelines={"codex_scene_video": pipeline},
    )
    service = GenerationService(registry, surface="public")

    with pytest.raises(ValueError, match="only available through Codex"):
        service.submit(
            GenerationRequest(
                pipeline_id="codex_scene_video",
                entry="scenes",
                input={"scenes": _scenes(tmp_path, 1)},
            )
        )
