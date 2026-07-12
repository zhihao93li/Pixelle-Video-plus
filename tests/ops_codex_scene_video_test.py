from pathlib import Path

import pytest

from ops.service import OpsError, OpsService
from ops.store import OpsStore
from pixelle_video.generation import (
    GenerationProgress,
    GenerationTask,
    build_default_pipeline_registry,
)


def _source():
    return {"kind": "codex", "confirmed_by_user": True}


def _seed(service):
    project = service.create_project(
        name="PetWoods",
        product="PetWoods",
        channel="xiaohongshu",
        source=_source(),
    )
    cycle = service.create_cycle(
        project_id=project["id"],
        name="Codex image story",
        goal="Verify image handoff",
        source=_source(),
    )
    experiment = service.create_experiment(
        project_id=project["id"],
        cycle_id=cycle["id"],
        title="Why cats like boxes",
        hypothesis="A scene-based explainer will retain viewers.",
        source=_source(),
    )
    service.lock_prediction(
        experiment_id=experiment["id"],
        prediction={"expected_metric": "completion_rate"},
        source=_source(),
    )
    return project, cycle, experiment


class CaptureGenerationService:
    def __init__(self):
        self.pipeline_registry = build_default_pipeline_registry()
        self.requests = []

    def submit(self, request):
        self.requests.append(request)
        return GenerationTask(
            task_id=f"codex-task-{len(self.requests)}",
            pipeline_id=request.pipeline_id,
            entry=request.entry,
            request=request,
            progress=GenerationProgress(stage="validate_scenes", percentage=0),
        )


@pytest.mark.asyncio
async def test_codex_ops_draft_compiles_exact_scenes_and_starts_automatically(tmp_path):
    capture = CaptureGenerationService()
    store = OpsStore(tmp_path / "ops.db")
    store.init_db()
    service = OpsService(store, generation_service=capture, surface="codex")
    _, _, experiment = _seed(service)

    scenes = [
        {
            "scene_id": "scene-1",
            "narration": "Cats are drawn to small enclosed spaces.",
            "image_prompt": "A curious cat entering a cardboard box",
            "image_path": str(tmp_path / "scene-1.png"),
            "duration": 3.0,
        },
        {
            "scene_id": "scene-2",
            "narration": "The walls help them feel protected.",
            "image_prompt": "A relaxed cat curled inside a cardboard box",
            "image_path": str(tmp_path / "scene-2.png"),
            "duration": 3.5,
        },
    ]
    for scene in scenes:
        Path(scene["image_path"]).write_bytes(b"image placeholder")

    draft = service.submit_generation_draft(
        experiment_id=experiment["id"],
        text="\n".join(scene["narration"] for scene in scenes),
        title="Why cats like boxes",
        generation_params={
            "scenes": scenes,
            "prompt_prefix": "warm editorial illustration",
        },
        production_template_id="codex_image_story_v1",
        source=_source(),
    )
    approval = service.approve_generation_draft(
        experiment_id=experiment["id"],
        draft_id=draft["event"]["id"],
        source=_source(),
    )
    requested = await service.request_generation(
        experiment_id=experiment["id"],
        approved_draft_id=approval["event"]["id"],
        wait_for_completion=False,
        source=_source(),
    )

    request = capture.requests[0]
    assert requested["entity"]["stage"] == "generation_requested"
    assert request.pipeline_id == "codex_scene_video"
    assert request.entry == "scenes"
    assert request.input["scenes"] == scenes
    assert request.params["prompt_prefix"] == "warm editorial illustration"
    assert "media_workflow" not in request.params


def test_public_ops_surface_rejects_codex_recipe(tmp_path):
    store = OpsStore(tmp_path / "ops.db")
    store.init_db()
    service = OpsService(store, surface="public")
    _, _, experiment = _seed(service)

    with pytest.raises(OpsError, match="production_template_forbidden"):
        service.submit_generation_draft(
            experiment_id=experiment["id"],
            text="Confirmed narration",
            generation_params={"scenes": [{"scene_id": "scene-1"}]},
            production_template_id="codex_image_story_v1",
            source=_source(),
        )


def test_agent_image_import_rejects_non_codex_source(tmp_path):
    store = OpsStore(tmp_path / "ops.db")
    store.init_db()
    service = OpsService(store, surface="codex")
    _, _, experiment = _seed(service)

    with pytest.raises(OpsError, match="codex_source_required"):
        service.save_agent_image(
            experiment_id=experiment["id"],
            scene_id="scene-1",
            prompt="A cat in a box",
            file_path=str(tmp_path / "scene-1.png"),
            source={"kind": "manual", "confirmed_by_user": True},
        )
