from fastapi.testclient import TestClient

from api.app import app
from api.dependencies import get_generation_service, get_pixelle_video
from pixelle_video.generation import (
    GenerationArtifact,
    GenerationProgress,
    GenerationRequest,
    GenerationResult,
    GenerationTask,
    build_default_pipeline_registry,
)


class FakePixelleVideoCore:
    def __init__(self):
        self.pipeline_registry = build_default_pipeline_registry()


async def get_fake_pixelle_video():
    return FakePixelleVideoCore()


def _completed_task(task_id="gen-task-1"):
    request = GenerationRequest(
        pipeline_id="standard",
        entry="topic",
        input={"topic": "Cat hydration"},
    )
    result = GenerationResult(
        task_id=task_id,
        pipeline_id="standard",
        entry="topic",
        artifacts=[
            GenerationArtifact(
                kind="video",
                path="output/task/final.mp4",
                role="primary_video",
            )
        ],
        primary_video=GenerationArtifact(
            kind="video",
            path="output/task/final.mp4",
            role="primary_video",
        ),
        duration=12.5,
        file_size=1234,
    )
    return GenerationTask(
        task_id=task_id,
        pipeline_id="standard",
        entry="topic",
        status="completed",
        progress=GenerationProgress(stage="compose_video", percentage=100.0),
        request=request,
        result=result,
    )


class FakeGenerationService:
    def __init__(self):
        self.requests = []
        self.task = _completed_task()

    def submit(self, request):
        self.requests.append(request)
        return self.task

    def get_task(self, task_id):
        if task_id != self.task.task_id:
            raise KeyError(task_id)
        return self.task

    def get_result(self, task_id):
        if task_id != self.task.task_id:
            raise KeyError(task_id)
        return self.task.result


fake_generation_service = FakeGenerationService()


async def get_fake_generation_service():
    return fake_generation_service


def test_generation_pipelines_endpoint_lists_registered_manifests():
    app.dependency_overrides[get_pixelle_video] = get_fake_pixelle_video

    try:
        response = TestClient(app).get("/api/generation/pipelines")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["default_pipeline"] == "standard"
    assert [pipeline["id"] for pipeline in payload["pipelines"]] == [
        "standard",
        "custom",
        "asset_based",
    ]
    assert payload["pipelines"][0]["entries"][0]["id"] == "topic"


def test_generation_pipeline_detail_endpoint_returns_manifest():
    app.dependency_overrides[get_pixelle_video] = get_fake_pixelle_video

    try:
        response = TestClient(app).get("/api/generation/pipelines/standard")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == "standard"
    assert payload["default_entry"] == "topic"
    assert {entry["id"] for entry in payload["entries"]} == {"topic", "script"}


def test_generation_pipeline_detail_endpoint_returns_404_for_unknown_pipeline():
    app.dependency_overrides[get_pixelle_video] = get_fake_pixelle_video

    try:
        response = TestClient(app).get("/api/generation/pipelines/missing")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 404
    assert "missing" in response.json()["detail"]


def test_generation_tasks_endpoint_submits_generation_request():
    fake_generation_service.requests = []
    app.dependency_overrides[get_generation_service] = get_fake_generation_service

    try:
        response = TestClient(app).post(
            "/api/generation/tasks",
            json={
                "pipeline_id": "standard",
                "entry": "topic",
                "input": {"topic": "Cat hydration"},
                "params": {"frame_template": "1080x1920/image_default.html"},
                "metadata": {"experiment_id": "exp-1"},
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["generation_task_id"] == "gen-task-1"
    assert payload["task"]["status"] == "completed"
    assert fake_generation_service.requests[0].pipeline_id == "standard"
    assert fake_generation_service.requests[0].entry == "topic"
    assert fake_generation_service.requests[0].input["topic"] == "Cat hydration"


def test_generation_task_status_and_result_endpoints_return_structured_task():
    app.dependency_overrides[get_generation_service] = get_fake_generation_service

    try:
        client = TestClient(app)
        task_response = client.get("/api/generation/tasks/gen-task-1")
        result_response = client.get("/api/generation/tasks/gen-task-1/result")
    finally:
        app.dependency_overrides.clear()

    assert task_response.status_code == 200
    assert task_response.json()["progress"]["stage"] == "compose_video"
    assert result_response.status_code == 200
    assert result_response.json()["primary_video"]["path"] == "output/task/final.mp4"


def test_video_async_endpoint_uses_generation_service_and_preserves_split_mode():
    fake_generation_service.requests = []
    app.dependency_overrides[get_generation_service] = get_fake_generation_service

    try:
        response = TestClient(app).post(
            "/api/video/generate/async",
            json={
                "text": "Scene one.\nScene two.",
                "mode": "fixed",
                "split_mode": "line",
                "frame_template": "1080x1920/image_default.html",
                "title": "Hydration script",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["task_id"] == "gen-task-1"
    request = fake_generation_service.requests[0]
    assert request.pipeline_id == "standard"
    assert request.entry == "script"
    assert request.input == {"script": "Scene one.\nScene two."}
    assert request.params["split_mode"] == "line"
    assert request.params["title"] == "Hydration script"
    assert request.params["media_width"] == 1024
    assert request.params["media_height"] == 1024
