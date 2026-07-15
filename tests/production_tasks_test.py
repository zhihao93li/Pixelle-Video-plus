import pytest
from fastapi.testclient import TestClient

import api.security as security
import pixelle_video.content.production_service as production_service
import pixelle_video.content.production_tasks as production_tasks
import pixelle_video.content.projects as projects
import pixelle_video.content.store as content_store
from api.app import app
from api.dependencies import get_generation_service
from pixelle_video.content.models import new_content_item
from pixelle_video.content.production_service import prepare_production
from pixelle_video.content.production_tasks import (
    ProductionTaskConflict,
    attach_generation_task,
    create_production_task,
    load_production_task,
    set_task_state,
    sync_generation_task,
)
from pixelle_video.generation import build_default_pipeline_registry
from pixelle_video.generation.schemas import (
    GenerationArtifact,
    GenerationError,
    GenerationProgress,
    GenerationRequest,
    GenerationResult,
    GenerationTask,
)


class FakeGenerationService:
    pipeline_registry = build_default_pipeline_registry()

    def get_task(self, task_id):
        raise KeyError(task_id)


@pytest.fixture
def isolated_production(tmp_path, monkeypatch):
    projects_path = tmp_path / "projects.json"
    monkeypatch.setattr(projects, "_projects_path", lambda: str(projects_path))
    monkeypatch.setattr(content_store, "CONTENT_ITEMS_DIR", tmp_path / "content-items")
    monkeypatch.setattr(production_tasks, "PRODUCTION_TASKS_DIR", tmp_path / "production-tasks")
    monkeypatch.setattr(security, "agent_token_path", lambda: tmp_path / "agent-token")
    project = projects.create_project(name="Unified production")
    yield tmp_path, project
    app.dependency_overrides.clear()


def test_prepare_production_creates_stable_ledger_and_preserves_identity(
    isolated_production,
    monkeypatch,
):
    _, project = isolated_production
    prepared = prepare_production(
        project_id=project.project_id,
        pipeline_id="script_to_video",
        recipe_id="pipeline_standard_base_v1",
        input_payload={"script": "猫喜欢纸箱。", "title": "纸箱的安全感"},
        overrides={},
        request_id="stable-production",
        source="react",
        actor="user",
        metadata={"client_name": "react-console", "agent_session_id": "session-1"},
    )

    assert prepared.created is True
    assert content_store.load_item(prepared.item.item_id) is not None
    stored = load_production_task(prepared.task.production_task_id)
    assert stored is not None
    assert stored.content_item_id == prepared.item.item_id
    assert stored.pipeline_id == "script_to_video"
    assert stored.actor == "user"
    assert stored.client_name == "react-console"
    assert stored.agent_session_id == "session-1"
    assert prepared.generation_request.metadata["production_task_id"] == stored.production_task_id
    assert prepared.generation_request.input == {
        "script": "猫喜欢纸箱。",
        "title": "纸箱的安全感",
    }

    monkeypatch.setattr(
        production_service,
        "detect_available_generation_capabilities",
        lambda: (_ for _ in ()).throw(RuntimeError("capabilities changed")),
    )
    repeated = prepare_production(
        project_id=project.project_id,
        pipeline_id="script_to_video",
        recipe_id="pipeline_standard_base_v1",
        input_payload={"script": "猫喜欢纸箱。", "title": "纸箱的安全感"},
        overrides={},
        request_id="stable-production",
        source="react",
        actor="user",
    )
    assert repeated.created is False
    assert repeated.task.production_task_id == stored.production_task_id

    with pytest.raises(ProductionTaskConflict):
        prepare_production(
            project_id=project.project_id,
            pipeline_id="script_to_video",
            recipe_id="pipeline_standard_base_v1",
            input_payload={"script": "不同文案"},
            overrides={},
            request_id="stable-production",
            source="react",
            actor="user",
        )


def test_production_create_rejects_removed_entry_field(isolated_production):
    _, project = isolated_production

    async def fake_generation_service():
        return FakeGenerationService()

    app.dependency_overrides[get_generation_service] = fake_generation_service
    response = TestClient(app).post(
        "/api/production-tasks",
        json={
            "request_id": "removed-entry",
            "project_id": project.project_id,
            "pipeline_id": "script_to_video",
            "recipe_id": "pipeline_standard_base_v1",
            "input": {"script": "完整文案"},
            "overrides": {},
            "entry": "script",
        },
    )

    assert response.status_code == 422


def _stable_task(project_id: str, content_item_id: str):
    task, _ = create_production_task(
        content_item_id=content_item_id,
        project_id=project_id,
        pipeline_id="script_to_video",
        recipe_id="pipeline_standard_base_v1",
        recipe_version="v1",
        title="测试任务",
        artifact_type="video",
        source="react",
        actor="user",
        stage_id="split_scenes",
        stage_label="分镜",
        next_actor="system",
        request_id="stable-task",
        request_hash="hash",
    )
    return task


def _generation_task(
    task_id: str,
    *,
    status: str,
    run_id: str,
    artifact_path: str | None = None,
):
    result = None
    error = None
    if status == "completed":
        artifacts = (
            [GenerationArtifact(kind="video", role="primary_video", path=artifact_path)]
            if artifact_path
            else []
        )
        result = GenerationResult(
            task_id=task_id,
            pipeline_id="script_to_video",
            artifacts=artifacts,
            primary_video=artifacts[0] if artifacts else None,
        )
    elif status == "failed":
        error = GenerationError(layer="runtime", message="provider failed")
    return GenerationTask(
        task_id=task_id,
        pipeline_id="script_to_video",
        status=status,
        request=GenerationRequest(
            pipeline_id="script_to_video",
            input={"script": "test"},
            metadata={"production_run_id": run_id},
        ),
        progress=GenerationProgress(stage="compose_video", percentage=100),
        result=result,
        error=error,
    )


def test_produced_requires_readable_artifact_and_retry_success_keeps_history(
    isolated_production,
):
    tmp_path, project = isolated_production
    item = new_content_item(title="测试", project=project.project_id)
    content_store.save_item(item)
    stable = _stable_task(project.project_id, item.item_id)
    manifest = build_default_pipeline_registry().get_manifest("script_to_video")

    failed = _generation_task("attempt-1", status="failed", run_id="run-1")
    failed.request.metadata["production_task_id"] = stable.production_task_id
    attach_generation_task(stable.production_task_id, failed)
    assert sync_generation_task(failed, manifest).state == "failed"

    missing = _generation_task("attempt-2", status="completed", run_id="run-2")
    missing.request.metadata["production_task_id"] = stable.production_task_id
    assert sync_generation_task(missing, manifest).state == "failed"

    video = tmp_path / "final.mp4"
    video.write_bytes(b"video")
    succeeded = _generation_task(
        "attempt-3", status="completed", run_id="run-3", artifact_path=str(video)
    )
    succeeded.request.metadata["production_task_id"] = stable.production_task_id
    final = sync_generation_task(succeeded, manifest)
    assert final.state == "produced"
    assert [attempt.status for attempt in final.attempts] == [
        "failed",
        "completed",
        "completed",
    ]
    assert final.attempts[1].required_artifacts_ok is False
    assert final.attempts[2].required_artifacts_ok is True


def test_workbench_hides_human_action_from_agent(isolated_production):
    _, project = isolated_production
    item = new_content_item(title="等待确认", project=project.project_id)
    content_store.save_item(item)
    task = _stable_task(project.project_id, item.item_id)
    set_task_state(
        task.production_task_id,
        state="needs_user",
        stage_id="review_script",
        stage_label="确认文案",
        next_actor="user",
        action_type="confirm_script",
        action_label="确认文案",
    )

    async def fake_generation_service():
        return FakeGenerationService()

    app.dependency_overrides[get_generation_service] = fake_generation_service
    client = TestClient(app)
    public = client.get(
        "/api/production-tasks",
        params={"project_id": project.project_id, "state": "needs_user"},
    )
    agent = client.get(
        "/api/production-tasks",
        params={"project_id": project.project_id, "state": "needs_user"},
        headers={"X-Pixelle-Agent-Token": security.ensure_agent_token()},
    )

    assert public.status_code == 200
    assert public.json()["items"][0]["action"]["type"] == "confirm_script"
    assert agent.status_code == 200
    assert agent.json()["items"][0]["action"] is None
