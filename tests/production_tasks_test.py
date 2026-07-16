from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import api.security as security
import pixelle_video.content.production_service as production_service
import pixelle_video.content.production_tasks as production_tasks
import pixelle_video.content.projects as projects
import pixelle_video.content.stage_revisions as stage_revisions
import pixelle_video.content.store as content_store
from api.app import app
from api.dependencies import get_generation_service, get_pixelle_video
from api.production_recovery import recover_pre_generation_stages
from pixelle_video.content.models import ContentVariant, new_content_item
from pixelle_video.content.production_service import prepare_production
from pixelle_video.content.production_tasks import (
    ProductionAttempt,
    ProductionTaskConflict,
    attach_generation_task,
    create_production_task,
    load_production_task,
    save_production_task,
    set_task_state,
    sync_generation_task,
)
from pixelle_video.content.stage_revisions import confirm_revision, create_revision
from pixelle_video.config import config_manager
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
    monkeypatch.setattr(stage_revisions, "STAGE_REVISIONS_DIR", tmp_path / "stage-revisions")
    monkeypatch.setattr(security, "agent_token_path", lambda: tmp_path / "agent-token")
    project = projects.create_project(name="Unified production")
    yield tmp_path, project
    app.dependency_overrides.clear()


def test_prepare_production_creates_stable_ledger_and_preserves_identity(
    isolated_production,
    monkeypatch,
):
    _, project = isolated_production
    monkeypatch.setattr(config_manager.config.comfyui.tts, "inference_mode", "fish")
    monkeypatch.setattr(
        config_manager.config.comfyui.tts.fish_audio,
        "reference_id",
        "fish-default-voice",
    )
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
    assert prepared.generation_request.params["tts_inference_mode"] == "fish"
    assert prepared.generation_request.params["tts_voice"] == "fish-default-voice"
    assert stored.effective_params["tts_inference_mode"] == "fish"
    assert stored.effective_params["tts_voice"] == "fish-default-voice"

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


@pytest.mark.asyncio
async def test_restart_recovers_safe_scene_planning_stage(
    isolated_production,
    monkeypatch,
):
    _, project = isolated_production
    item = new_content_item(title="猫为什么喜欢纸箱", project=project.project_id)
    item.status = "confirmed"
    item.variants["Chinese"] = ContentVariant(
        language="Chinese",
        status="confirmed",
        script="纸箱能提供安全感。纸板还能保温。",
    )
    content_store.save_item(item)
    task, _ = create_production_task(
        content_item_id=item.item_id,
        project_id=project.project_id,
        pipeline_id="script_to_video",
        recipe_id="pipeline_standard_base_v1",
        recipe_version="v1",
        title=item.title,
        artifact_type="video",
        source="react",
        actor="user",
        stage_id="plan_scenes",
        stage_label="正在规划分镜",
        next_actor="system",
        request_id="recover-scene-plan",
        request_hash="recover-scene-plan-hash",
    )

    async def fake_split(**_kwargs):
        return ["纸箱能提供安全感。", "纸板还能保温。"]

    monkeypatch.setattr("api.routers.content_flows.split_confirmed_script", fake_split)
    await recover_pre_generation_stages(
        SimpleNamespace(llm=object()),
        SimpleNamespace(),
    )

    recovered_task = load_production_task(task.production_task_id)
    recovered_item = content_store.load_item(item.item_id)
    assert recovered_task is not None
    assert recovered_task.state == "needs_user"
    assert recovered_task.stage_id == "review_scenes"
    assert recovered_item is not None
    assert recovered_item.status == "pending_review"
    assert [scene.narration for scene in recovered_item.scene_manifest.scenes] == [
        "纸箱能提供安全感。",
        "纸板还能保温。",
    ]


def test_failed_script_scene_planning_retries_the_same_stage(
    isolated_production,
    monkeypatch,
):
    _, project = isolated_production
    item = new_content_item(title="猫为什么喜欢纸箱", project=project.project_id)
    item.status = "confirmed"
    item.variants["Chinese"] = ContentVariant(
        language="Chinese",
        status="confirmed",
        script="纸箱能提供安全感。纸板还能保温。",
    )
    content_store.save_item(item)
    task, _ = create_production_task(
        content_item_id=item.item_id,
        project_id=project.project_id,
        pipeline_id="script_to_video",
        recipe_id="pipeline_standard_base_v1",
        recipe_version="v1",
        title=item.title,
        artifact_type="video",
        source="react",
        actor="user",
        stage_id="plan_scenes",
        stage_label="分镜规划失败",
        next_actor="user",
        request_id="retry-scene-plan",
        request_hash="retry-scene-plan-hash",
    )
    set_task_state(
        task.production_task_id,
        state="failed",
        stage_id="plan_scenes",
        stage_label="分镜规划失败",
        next_actor="user",
    )

    async def fake_split(**_kwargs):
        return ["纸箱能提供安全感。", "纸板还能保温。"]

    async def fake_core():
        return SimpleNamespace(llm=object())

    async def fake_generation_service():
        return FakeGenerationService()

    monkeypatch.setattr("api.routers.content_flows.split_confirmed_script", fake_split)
    app.dependency_overrides[get_pixelle_video] = fake_core
    app.dependency_overrides[get_generation_service] = fake_generation_service
    response = TestClient(app).post(
        f"/api/production-tasks/{task.production_task_id}/retry",
        json={
            "request_id": "retry-scene-plan-run",
            "client_name": "react-console",
            "source": "react",
        },
    )

    assert response.status_code == 202, response.text
    recovered_task = load_production_task(task.production_task_id)
    assert recovered_task is not None
    assert recovered_task.state == "needs_user"
    assert recovered_task.stage_id == "review_scenes"


def test_retry_rebuilds_legacy_topic_request_from_confirmed_content(
    isolated_production,
    monkeypatch,
):
    _, project = isolated_production
    item = new_content_item(title="猫为什么喜欢纸箱", project=project.project_id)
    item.status = "confirmed"
    item.variants["Chinese"] = ContentVariant(
        language="Chinese",
        status="confirmed",
        script="纸箱能提供安全感。",
    )
    content_store.save_item(item)
    task, _ = create_production_task(
        content_item_id=item.item_id,
        project_id=project.project_id,
        pipeline_id="topic_to_video",
        recipe_id="pipeline_topic_to_video_base_v1",
        recipe_version="v1",
        title=item.title,
        artifact_type="video",
        source="react",
        actor="user",
        stage_id="generate_script",
        stage_label="生产失败",
        next_actor="user",
        request_id="legacy-topic-task",
        request_hash="legacy-topic-task-hash",
    )
    legacy_attempt = GenerationTask(
        task_id="legacy-attempt",
        pipeline_id="topic_to_video",
        status="failed",
        request=GenerationRequest(
            pipeline_id="topic_to_video",
            input={"topic": item.title},
            metadata={"confirmed_script": "纸箱能提供安全感。"},
        ),
        progress=GenerationProgress(stage="generate_script"),
        error=GenerationError(layer="input", message="legacy request"),
    )
    attach_generation_task(task.production_task_id, legacy_attempt)
    set_task_state(
        task.production_task_id,
        state="failed",
        stage_id="generate_script",
        stage_label="生产失败",
        next_actor="user",
    )

    queued = []

    async def fake_resume(**kwargs):
        queued.append(kwargs)

    class StoredGenerationService:
        pipeline_registry = build_default_pipeline_registry()

        def get_task(self, task_id):
            if task_id == legacy_attempt.task_id:
                return legacy_attempt
            raise KeyError(task_id)

    async def fake_generation_service():
        return StoredGenerationService()

    async def fake_core():
        return SimpleNamespace()

    monkeypatch.setattr(
        "api.routers.content_flows._run_confirmed_content_production",
        fake_resume,
    )
    app.dependency_overrides[get_generation_service] = fake_generation_service
    app.dependency_overrides[get_pixelle_video] = fake_core

    response = TestClient(app).post(
        f"/api/production-tasks/{task.production_task_id}/retry",
        json={
            "request_id": "recover-legacy-topic",
            "client_name": "react-console",
            "source": "react",
        },
    )

    assert response.status_code == 202, response.text
    recovered = load_production_task(task.production_task_id)
    assert recovered is not None
    assert recovered.state == "in_progress"
    assert recovered.stage_id == "split_scenes"
    assert len(queued) == 1
    assert queued[0]["item_id"] == item.item_id


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


def test_production_timeline_is_truthful_reverse_chronological_and_paginated(
    isolated_production,
):
    _, project = isolated_production
    item = new_content_item(title="猫为什么喜欢纸箱", project=project.project_id)
    content_store.save_item(item)
    task = _stable_task(project.project_id, item.item_id)
    revision = create_revision(
        item_id=item.item_id,
        production_task_id=task.production_task_id,
        kind="script",
        payload={
            "kind": "script",
            "variants": {
                "Chinese": {
                    "language": "Chinese",
                    "title": "猫为什么喜欢纸箱",
                    "script": "纸箱能提供安全感。",
                }
            },
        },
        created_by="system",
        source="system",
    )
    confirm_revision(
        revision.revision_id,
        request_id="confirm-script-once",
        actor="user",
        source="react",
    )
    task.attempts = [
        ProductionAttempt(
            generation_task_id="attempt-failed",
            run_id="run-1",
            status="failed",
            stage="compose_video",
            error=GenerationError(layer="runtime", message="provider failed"),
            created_at="2030-01-01T00:01:00+00:00",
            updated_at="2030-01-01T00:02:00+00:00",
        ),
        ProductionAttempt(
            generation_task_id="attempt-succeeded",
            run_id="run-2",
            status="completed",
            stage="compose_video",
            required_artifacts_ok=True,
            artifact_ids=["attempt-succeeded:primary_video"],
            created_at="2030-01-01T00:03:00+00:00",
            updated_at="2030-01-01T00:04:00+00:00",
        ),
    ]
    task.generation_task_ids = ["attempt-failed", "attempt-succeeded"]
    task.artifact_ids = ["attempt-succeeded:primary_video"]
    task.state = "produced"
    task.produced_at = "2030-01-01T00:04:00+00:00"
    save_production_task(task)

    async def fake_generation_service():
        return FakeGenerationService()

    app.dependency_overrides[get_generation_service] = fake_generation_service
    client = TestClient(app)
    response = client.get(f"/api/production-tasks/{task.production_task_id}/timeline")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert [entry["event_type"] for entry in payload["items"]] == [
        "artifact_produced",
        "retry_started",
        "production_failed",
        "production_started",
        "stage_confirmed",
        "script_generated",
        "task_created",
    ]
    assert len({entry["event_id"] for entry in payload["items"]}) == 7

    first_page = client.get(
        f"/api/production-tasks/{task.production_task_id}/timeline",
        params={"limit": 2},
    ).json()
    assert [entry["event_type"] for entry in first_page["items"]] == [
        "artifact_produced",
        "retry_started",
    ]
    assert first_page["next_cursor"] == first_page["items"][-1]["event_id"]
    second_page = client.get(
        f"/api/production-tasks/{task.production_task_id}/timeline",
        params={"cursor": first_page["next_cursor"], "limit": 2},
    ).json()
    assert [entry["event_type"] for entry in second_page["items"]] == [
        "production_failed",
        "production_started",
    ]


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
