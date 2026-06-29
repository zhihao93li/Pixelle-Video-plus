import pytest

from ops.service import OpsError, OpsService
from ops.store import OpsStore
from pixelle_video.generation import (
    GenerationArtifact,
    GenerationError,
    GenerationProgress,
    GenerationRequest,
    GenerationResult,
    GenerationTask,
    build_default_pipeline_registry,
)


def _source():
    return {"kind": "codex", "confirmed_by_user": True, "skill": "cheat-on-content"}


@pytest.fixture
def store(tmp_path):
    store = OpsStore(tmp_path / "ops.db")
    store.init_db()
    return store


def _seed_approved_draft(service: OpsService):
    project = service.create_project(
        name="PetWoods",
        product="PetWoods",
        channel="xiaohongshu",
        source=_source(),
    )
    cycle = service.create_cycle(
        project_id=project["id"],
        name="Launch week",
        goal="Validate demand",
        source=_source(),
    )
    experiment = service.create_experiment(
        project_id=project["id"],
        cycle_id=cycle["id"],
        title="Hydration hook",
        hypothesis="Specific cat care hook wins.",
        source=_source(),
    )
    service.lock_prediction(
        experiment_id=experiment["id"],
        prediction={"expected_metric": "completion_rate"},
        source=_source(),
    )
    draft = service.submit_generation_draft(
        experiment_id=experiment["id"],
        text="Scene one.\nScene two.",
        source=_source(),
        title="Cat hydration",
        generation_params={"frame_template": "1080x1920/image_default.html"},
    )["event"]
    approval = service.approve_generation_draft(
        experiment_id=experiment["id"],
        draft_id=draft["id"],
        source=_source(),
    )["event"]
    return project, cycle, experiment, approval


def _task(
    *,
    status="running",
    task_id="gen-task-1",
    result=None,
    error=None,
):
    request = GenerationRequest(
        pipeline_id="standard",
        entry="script",
        input={"script": "Scene one.\nScene two."},
    )
    return GenerationTask(
        task_id=task_id,
        pipeline_id="standard",
        entry="script",
        status=status,
        progress=GenerationProgress(stage="generate_tts", percentage=40.0),
        request=request,
        result=result,
        error=error,
    )


class FakeGenerationService:
    def __init__(self, task):
        self.task = task
        self.pipeline_registry = build_default_pipeline_registry()
        self.submitted_requests = []

    def submit(self, request):
        self.submitted_requests.append(request)
        return self.task

    async def wait_for_task(self, task_id):
        assert task_id == self.task.task_id
        return self.task

    def get_task(self, task_id):
        assert task_id == self.task.task_id
        return self.task


@pytest.mark.asyncio
async def test_ops_request_generation_records_generation_task_id(store):
    generation_service = FakeGenerationService(_task(status="running"))
    service = OpsService(store=store, generation_service=generation_service)
    _, _, experiment, draft = _seed_approved_draft(service)

    result = await service.request_generation(
        experiment_id=experiment["id"],
        approved_draft_id=draft["id"],
        source=_source(),
        wait_for_completion=False,
    )

    event = result["event"]
    assert result["generation"]["generation_task_id"] == "gen-task-1"
    assert event["payload"]["generation_task_id"] == "gen-task-1"
    assert event["payload"]["generation_request_snapshot"]["entry"] == "script"
    assert generation_service.submitted_requests[0].input == {"script": "Scene one.\nScene two."}
    assert generation_service.submitted_requests[0].params["title"] == "Cat hydration"

    status = service.get_generation_status(experiment["id"])
    assert status["status"] == "running"
    assert status["generation_task"]["task_id"] == "gen-task-1"
    assert status["generation_task"]["progress"]["stage"] == "generate_tts"


@pytest.mark.asyncio
async def test_ops_completed_generation_task_creates_content_item_from_result(store, tmp_path):
    video_path = tmp_path / "output" / "task" / "final.mp4"
    video_path.parent.mkdir(parents=True)
    video_path.write_bytes(b"mp4")
    artifact = GenerationArtifact(
        kind="video",
        path=str(video_path),
        role="primary_video",
        media_type="video/mp4",
    )
    generation_result = GenerationResult(
        task_id="gen-task-1",
        pipeline_id="standard",
        entry="script",
        artifacts=[artifact],
        primary_video=artifact,
        duration=8.0,
        file_size=3,
    )
    generation_service = FakeGenerationService(
        _task(status="completed", result=generation_result)
    )
    service = OpsService(store=store, generation_service=generation_service)
    _, _, experiment, draft = _seed_approved_draft(service)

    completed = await service.request_generation(
        experiment_id=experiment["id"],
        approved_draft_id=draft["id"],
        source=_source(),
        wait_for_completion=True,
    )

    content_item = completed["content_item"]
    assert content_item["asset_ref"]["video_path"] == str(video_path)
    assert content_item["asset_ref"]["generation_task_id"] == "gen-task-1"
    assert completed["event"]["payload"]["generation_task_id"] == "gen-task-1"

    asset_check = service.check_generation_asset(
        experiment_id=experiment["id"],
        content_item_id=content_item["id"],
        source=_source(),
    )
    assert asset_check["asset_check"]["checks"]["local_file_exists"] is True


@pytest.mark.asyncio
async def test_ops_failed_generation_task_records_structured_error(store):
    generation_service = FakeGenerationService(
        _task(
            status="failed",
            error=GenerationError(
                layer="runtime",
                message="tts provider unavailable",
                exception_type="RuntimeError",
            ),
        )
    )
    service = OpsService(store=store, generation_service=generation_service)
    _, _, experiment, draft = _seed_approved_draft(service)

    with pytest.raises(OpsError, match="generation_failed"):
        await service.request_generation(
            experiment_id=experiment["id"],
            approved_draft_id=draft["id"],
            source=_source(),
            wait_for_completion=True,
        )

    status = service.get_generation_status(experiment["id"])
    assert status["status"] == "failed"
    assert status["error"]["layer"] == "runtime"
    assert status["error"]["message"] == "tts provider unavailable"
    assert status["error"]["exception_type"] == "RuntimeError"
