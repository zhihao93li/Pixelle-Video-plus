import pytest
from fastapi.testclient import TestClient

import api.routers.generation as generation_router
from api.app import app
from api.dependencies import get_generation_service, get_pixelle_video
from pixelle_video.content import production_tasks, projects
from pixelle_video.content import store as content_store
from pixelle_video.generation import (
    GenerationArtifact,
    GenerationProgress,
    GenerationRequest,
    GenerationResult,
    GenerationTask,
    build_default_pipeline_registry,
    build_default_production_template_registry,
    template_overrides,
)


class FakePixelleVideoCore:
    def __init__(self):
        self.pipeline_registry = build_default_pipeline_registry()


async def get_fake_pixelle_video():
    return FakePixelleVideoCore()


def _completed_task(task_id="gen-task-1"):
    request = GenerationRequest(
        pipeline_id="topic_to_video",
        input={"topic": "Cat hydration"},
    )
    result = GenerationResult(
        task_id=task_id,
        pipeline_id="topic_to_video",
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
        pipeline_id="topic_to_video",
        status="completed",
        progress=GenerationProgress(stage="compose_video", percentage=100.0),
        request=request,
        result=result,
    )


class FakeGenerationService:
    def __init__(self):
        self.requests = []
        self.task = _completed_task()

    def submit(self, request, **_kwargs):
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


@pytest.fixture
def isolated_production_project(tmp_path, monkeypatch):
    (tmp_path / "data").mkdir()
    monkeypatch.setattr(
        projects, "_projects_path", lambda: str(tmp_path / "data" / "projects.json")
    )
    monkeypatch.setattr(content_store, "CONTENT_ITEMS_DIR", tmp_path / "content-items")
    monkeypatch.setattr(production_tasks, "PRODUCTION_TASKS_DIR", tmp_path / "production-tasks")
    project = projects.create_project(
        name="Batch test",
        default_production_template_id="pipeline_standard_base_v1",
    )
    return project.project_id


class FakeBatchGenerationService:
    def __init__(self):
        self.requests = []
        self.tasks = {}
        self.pipeline_registry = build_default_pipeline_registry()

    def submit(self, request, **_kwargs):
        self.requests.append(request)
        task_id = f"batch-task-{len(self.requests)}"
        task = GenerationTask(
            task_id=task_id,
            pipeline_id=request.pipeline_id,
            status="pending",
            progress=GenerationProgress(stage="queued", percentage=0.0),
            request=request,
        )
        self.tasks[task_id] = task
        return task

    def get_task(self, task_id):
        try:
            return self.tasks[task_id]
        except KeyError:
            raise KeyError(task_id) from None

    def cancel_task(self, task_id):
        task = self.get_task(task_id)
        task.status = "cancelled"
        return task


def test_generation_pipelines_endpoint_lists_registered_manifests():
    app.dependency_overrides[get_pixelle_video] = get_fake_pixelle_video

    try:
        response = TestClient(app).get("/api/generation/pipelines")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["default_pipeline"] == "script_to_video"
    assert [pipeline["id"] for pipeline in payload["pipelines"]] == [
        "topic_to_video",
        "script_to_video",
        "asset_based",
        "topic_to_image_post",
        "image_post",
        "topic_to_long_form",
        "long_form",
        "i2v",
        "action_transfer",
        "digital_human",
    ]
    assert payload["pipelines"][0]["input"]["required_fields"][0]["name"] == "topic"
    assert payload["pipelines"][0]["quick_setting_keys"] == [
        "frame_template",
        "tts_voice",
        "tts_speed",
        "bgm_path",
    ]
    assert "entries" not in payload["pipelines"][0]
    assert "codex_scene_video" not in {pipeline["id"] for pipeline in payload["pipelines"]}


def test_generation_pipeline_detail_endpoint_returns_manifest():
    app.dependency_overrides[get_pixelle_video] = get_fake_pixelle_video

    try:
        response = TestClient(app).get("/api/generation/pipelines/topic_to_video")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == "topic_to_video"
    assert payload["input"]["required_fields"][0]["name"] == "topic"
    assert "default_entry" not in payload
    assert "entries" not in payload


def test_generation_pipeline_detail_endpoint_returns_404_for_unknown_pipeline():
    app.dependency_overrides[get_pixelle_video] = get_fake_pixelle_video

    try:
        response = TestClient(app).get("/api/generation/pipelines/missing")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 404
    assert "missing" in response.json()["detail"]


def test_generation_pipeline_detail_hides_codex_only_pipeline():
    app.dependency_overrides[get_pixelle_video] = get_fake_pixelle_video

    try:
        response = TestClient(app).get("/api/generation/pipelines/codex_scene_video")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 404


def test_generation_templates_endpoint_lists_builtin_production_templates():
    response = TestClient(app).get("/api/generation/templates")

    assert response.status_code == 200
    payload = response.json()
    assert payload["default_template"] == "pipeline_standard_base_v1"
    ids = [template["id"] for template in payload["templates"]]
    assert "codex_image_story_v1" not in ids
    assert [template["id"] for template in payload["agent_templates"]] == ["codex_image_story_v1"]
    assert payload["agent_templates"][0]["access_scope"] == "agent"
    # 中性骨架排在最前，历史 PetWoods 预设不再进入当前注册表。
    assert ids[0] == "pipeline_topic_to_video_base_v1"
    assert ids[1] == "pipeline_standard_base_v1"
    assert ids[2] == "pipeline_asset_based_base_v1"
    for removed in [
        "petwoods_xhs_daily_v1",
        "petwoods_xhs_static_subtitle_v1",
        "petwoods_xhs_topic_to_video_v1",
        "petwoods_xhs_quality_explainer_v1",
        "petwoods_xhs_asset_enhanced_v1",
        "petwoods_xhs_real_material_montage_v1",
    ]:
        assert removed not in ids

    templates_by_id = {template["id"]: template for template in payload["templates"]}
    assert templates_by_id["pipeline_standard_base_v1"]["display_name"] == "图文口播视频"
    assert templates_by_id["pipeline_standard_base_v1"]["use_case"] == "standard_base"
    assert templates_by_id["pipeline_standard_base_v1"]["enabled"] is True
    assert templates_by_id["pipeline_asset_based_base_v1"]["display_name"] == "素材增强视频"
    assert templates_by_id["pipeline_asset_based_base_v1"]["requires_user_assets"] is True
    assert templates_by_id["pixelle_i2v_basic_v1"]["pipeline_id"] == "i2v"
    assert templates_by_id["pixelle_action_transfer_basic_v1"]["pipeline_id"] == "action_transfer"
    assert templates_by_id["pixelle_digital_human_basic_v1"]["pipeline_id"] == "digital_human"


def test_template_responses_expose_route_owned_writing_and_scene_settings():
    payload = TestClient(app).get("/api/generation/templates").json()
    templates = {template["id"]: template for template in payload["templates"]}

    topic = templates["pipeline_topic_to_video_base_v1"]
    script = templates["pipeline_standard_base_v1"]
    assert "drafting" not in topic
    assert topic["fixed_params"]["script_template_name"] == "Short Oral Script"
    assert topic["fixed_params"]["split_template_name"] == "Copy-Safe Scene Split"
    assert "script_template_name" not in script["allowed_user_params"]
    assert script["fixed_params"]["split_template_name"] == "Copy-Safe Scene Split"
    assert "n_scenes" not in topic["fixed_params"]
    assert "n_scenes" not in script["fixed_params"]


def test_generation_batch_endpoint_persists_batch_and_continues_item_failures(
    tmp_path, isolated_production_project
):
    fake_batch_service = FakeBatchGenerationService()

    async def get_fake_batch_generation_service():
        return fake_batch_service

    previous_dir = generation_router.GENERATION_BATCH_DIR
    generation_router.GENERATION_BATCH_DIR = tmp_path
    app.dependency_overrides[get_generation_service] = get_fake_batch_generation_service

    try:
        client = TestClient(app)
        create_response = client.post(
            "/api/generation/batches",
            json={
                "template_id": "pipeline_standard_base_v1",
                "pipeline_id": "script_to_video",
                "project_id": isolated_production_project,
                "idempotency_key": "test-batch",
                "items": [
                    {
                        "input": {"script": "Cats need clean water daily."},
                        "overrides": {"tts_speed": 1.1},
                    },
                    {"input": {}},
                ],
                "metadata": {"source": "test_batch"},
            },
        )
        batch_id = create_response.json()["batch_id"]
        get_response = client.get(f"/api/generation/batches/{batch_id}")
        list_response = client.get("/api/generation/batches")
    finally:
        app.dependency_overrides.clear()
        generation_router.GENERATION_BATCH_DIR = previous_dir

    assert create_response.status_code == 200
    payload = create_response.json()
    assert payload["total_count"] == 2
    assert payload["submitted_count"] == 1
    assert payload["failed_count"] == 1
    assert payload["items"][0]["task_id"] == "batch-task-1"
    assert payload["items"][0]["metadata"]["batch_index"] == 1
    assert payload["items"][1]["status"] == "failed"
    assert "script" in payload["items"][1]["error"]["message"]
    assert fake_batch_service.requests[0].pipeline_id == "script_to_video"
    assert fake_batch_service.requests[0].input == {"script": "Cats need clean water daily."}
    assert fake_batch_service.requests[0].params["tts_speed"] == 1.1
    assert (tmp_path / f"{payload['batch_id']}.json").exists()
    assert get_response.status_code == 200
    assert get_response.json()["batch_id"] == payload["batch_id"]
    assert list_response.status_code == 200
    assert list_response.json()["batches"][0]["batch_id"] == payload["batch_id"]


def test_generation_batch_item_retry_resubmits_failed_item(tmp_path, isolated_production_project):
    fake_batch_service = FakeBatchGenerationService()

    async def get_fake_batch_generation_service():
        return fake_batch_service

    previous_dir = generation_router.GENERATION_BATCH_DIR
    generation_router.GENERATION_BATCH_DIR = tmp_path
    app.dependency_overrides[get_generation_service] = get_fake_batch_generation_service

    try:
        client = TestClient(app)
        create_response = client.post(
            "/api/generation/batches",
            json={
                "template_id": "pipeline_standard_base_v1",
                "pipeline_id": "script_to_video",
                "project_id": isolated_production_project,
                "idempotency_key": "retry-batch",
                "items": [{"input": {"script": "Cats need clean water daily."}}],
                "metadata": {"source": "test_batch"},
            },
        )
        batch_id = create_response.json()["batch_id"]
        fake_batch_service.tasks["batch-task-1"].status = "failed"
        client.get(f"/api/generation/batches/{batch_id}")

        retry_response = client.post(
            f"/api/generation/batches/{batch_id}/items/1/retry",
            params={"request_id": "retry-batch-item-1"},
        )
    finally:
        app.dependency_overrides.clear()
        generation_router.GENERATION_BATCH_DIR = previous_dir

    assert create_response.status_code == 200
    assert retry_response.status_code == 200
    payload = retry_response.json()
    assert payload["items"][0]["task_id"] == "batch-task-2"
    assert payload["items"][0]["status"] == "pending"
    assert payload["items"][0]["metadata"]["retry_count"] == 1
    assert payload["items"][0]["metadata"]["retry_of_task_id"] == "batch-task-1"
    assert len(fake_batch_service.requests) == 2
    assert fake_batch_service.requests[1].input == {"script": "Cats need clean water daily."}


def test_generation_batch_cancel_stops_only_unfinished_items(tmp_path, isolated_production_project):
    fake_batch_service = FakeBatchGenerationService()

    async def get_fake_batch_generation_service():
        return fake_batch_service

    previous_dir = generation_router.GENERATION_BATCH_DIR
    generation_router.GENERATION_BATCH_DIR = tmp_path
    app.dependency_overrides[get_generation_service] = get_fake_batch_generation_service

    try:
        client = TestClient(app)
        create_response = client.post(
            "/api/generation/batches",
            json={
                "template_id": "pipeline_standard_base_v1",
                "pipeline_id": "script_to_video",
                "project_id": isolated_production_project,
                "idempotency_key": "cancel-batch",
                "items": [
                    {"input": {"script": "First."}},
                    {"input": {"script": "Second."}},
                ],
            },
        )
        batch_id = create_response.json()["batch_id"]
        fake_batch_service.tasks["batch-task-1"].status = "completed"
        cancel_response = client.delete(
            f"/api/generation/batches/{batch_id}",
            params={"request_id": "cancel-batch-1"},
        )
    finally:
        app.dependency_overrides.clear()
        generation_router.GENERATION_BATCH_DIR = previous_dir

    assert cancel_response.status_code == 200
    payload = cancel_response.json()
    assert payload["status"] == "cancelled"
    assert [item["status"] for item in payload["items"]] == [
        "completed",
        "cancelled",
    ]


def test_generation_batch_exposes_missing_canonical_task_state(
    tmp_path, isolated_production_project
):
    fake_batch_service = FakeBatchGenerationService()

    async def get_fake_batch_generation_service():
        return fake_batch_service

    previous_dir = generation_router.GENERATION_BATCH_DIR
    generation_router.GENERATION_BATCH_DIR = tmp_path
    app.dependency_overrides[get_generation_service] = get_fake_batch_generation_service

    try:
        client = TestClient(app)
        create_response = client.post(
            "/api/generation/batches",
            json={
                "template_id": "pipeline_standard_base_v1",
                "pipeline_id": "script_to_video",
                "project_id": isolated_production_project,
                "idempotency_key": "missing-state-batch",
                "items": [{"input": {"script": "First."}}],
            },
        )
        batch_id = create_response.json()["batch_id"]
        fake_batch_service.tasks.clear()
        get_response = client.get(f"/api/generation/batches/{batch_id}")
    finally:
        app.dependency_overrides.clear()
        generation_router.GENERATION_BATCH_DIR = previous_dir

    assert get_response.status_code == 200
    item = get_response.json()["items"][0]
    assert item["status"] == "interrupted"
    assert item["error"]["exception_type"] == "GenerationTaskStateMissing"


def test_generation_batch_preserves_persisted_terminal_item_without_task_state(
    tmp_path, isolated_production_project
):
    fake_batch_service = FakeBatchGenerationService()

    async def get_fake_batch_generation_service():
        return fake_batch_service

    previous_dir = generation_router.GENERATION_BATCH_DIR
    generation_router.GENERATION_BATCH_DIR = tmp_path
    app.dependency_overrides[get_generation_service] = get_fake_batch_generation_service

    try:
        client = TestClient(app)
        create_response = client.post(
            "/api/generation/batches",
            json={
                "template_id": "pipeline_standard_base_v1",
                "pipeline_id": "script_to_video",
                "project_id": isolated_production_project,
                "idempotency_key": "terminal-state-batch",
                "items": [{"input": {"script": "First."}}],
            },
        )
        batch_id = create_response.json()["batch_id"]
        fake_batch_service.tasks["batch-task-1"].status = "completed"
        completed_response = client.get(f"/api/generation/batches/{batch_id}")
        fake_batch_service.tasks.clear()
        restored_response = client.get(f"/api/generation/batches/{batch_id}")
    finally:
        app.dependency_overrides.clear()
        generation_router.GENERATION_BATCH_DIR = previous_dir

    assert completed_response.json()["items"][0]["status"] == "completed"
    assert restored_response.json()["items"][0]["status"] == "completed"
    assert restored_response.json()["items"][0]["error"] is None


def test_batch_retry_rejects_missing_production_task_identity(tmp_path):
    fake_batch_service = FakeBatchGenerationService()

    async def get_fake_batch_generation_service():
        return fake_batch_service

    previous_dir = generation_router.GENERATION_BATCH_DIR
    generation_router.GENERATION_BATCH_DIR = tmp_path
    app.dependency_overrides[get_generation_service] = get_fake_batch_generation_service
    batch_id = "corrupt-batch"
    generation_router._save_batch(
        {
            "batch_id": batch_id,
            "template_id": "pipeline_standard_base_v1",
            "status": "failed",
            "created_at": "2026-07-03T00:00:00",
            "updated_at": "2026-07-03T00:00:00",
            "metadata": {
                "source": "corrupt_batch_fixture",
                "pipeline_id": "script_to_video",
            },
            "items": [
                {
                    "index": 1,
                    "input": {
                        "topic": "Cat hydration",
                        "language": "English",
                        "script": "Keep water away from food.",
                    },
                    "params": {
                        "tts_inference_mode": "fish",
                        "tts_voice": "fish-reference-id",
                    },
                    "metadata": {"batch_index": 1},
                    "task_id": None,
                    "status": "failed",
                    "progress": None,
                    "error": {"layer": "runtime", "message": "Previous failure"},
                }
            ],
        }
    )

    try:
        client = TestClient(app)
        retry_response = client.post(
            f"/api/generation/batches/{batch_id}/items/1/retry",
            params={"request_id": "retry-corrupt-item-1"},
        )
    finally:
        app.dependency_overrides.clear()
        generation_router.GENERATION_BATCH_DIR = previous_dir

    assert retry_response.status_code == 409
    assert fake_batch_service.requests == []


def test_generation_config_exposes_base_values_before_overrides(tmp_path, monkeypatch):
    monkeypatch.setattr(
        template_overrides,
        "_overrides_path",
        lambda: str(tmp_path / "production-template-overrides.json"),
    )
    template_overrides.save_overrides("pipeline_standard_base_v1", {"tts_speed": 1.4})

    response = TestClient(app).get(
        "/api/generation/templates/pipeline_standard_base_v1/generation-config"
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["overrides"]["tts_speed"] == 1.4
    assert payload["base_params"].get("tts_speed") != 1.4
    assert payload["effective_params"]["tts_speed"] == 1.4
    assert "template_params" in payload["overridable_keys"]


def test_all_template_stage_settings_have_a_template_override_contract():
    """A setting shown for one run must not silently disappear from template defaults."""
    from pixelle_video.generation.defaults import build_default_pipeline_registry
    from pixelle_video.generation.template_overrides import OVERRIDABLE_PARAMS
    from pixelle_video.generation.templates import build_default_production_template_registry

    pipeline_registry = build_default_pipeline_registry()
    missing: dict[str, list[str]] = {}
    for template in build_default_production_template_registry().list():
        manifest = pipeline_registry.get_manifest(template.pipeline_id)
        stage_keys = {key for stage in manifest.stages for key in stage.setting_keys}
        unsupported = sorted(
            (set(template.allowed_user_params) & stage_keys) - set(OVERRIDABLE_PARAMS)
        )
        if unsupported:
            missing[template.id] = unsupported

    assert missing == {}


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


def test_batch_retry_preserves_whitelisted_params():
    """重试必须还原当次提交的白名单覆盖（如每语言 Fish 音色）。"""
    request = generation_router._compile_batch_retry_request(
        batch={"template_id": "pipeline_standard_base_v1"},
        item={
            "input": {"script": "重试用的文案。"},
            "params": {
                "tts_inference_mode": "fish",
                "tts_voice": "voice-en",
                "tts_speed": 1.1,
                "split_model": "scene-planner",
                "not_whitelisted_key": "should-be-dropped",
            },
        },
        metadata={"source": "retry-test"},
    )
    assert request.input == {"script": "重试用的文案。"}
    assert request.params["tts_voice"] == "voice-en"
    assert request.params["tts_inference_mode"] == "fish"
    assert request.params["split_model"] == "scene-planner"
    assert "not_whitelisted_key" not in request.params
    assert request.metadata["production_template"]["id"] == "pipeline_standard_base_v1"


def test_prompt_template_default_ignores_custom_file_ordering():
    """安全默认回归：未显式指定 Prompt 时必须命中内置通用模板，
    自定义 Prompt 文件（如 bazi_*.md）的存在与排序不得改变默认起草行为。"""
    topic_recipe = build_default_production_template_registry().get(
        "pipeline_topic_to_video_base_v1"
    )
    assert topic_recipe.fixed_params["script_template_name"] == "Short Oral Script"
    assert topic_recipe.fixed_params["split_template_name"] == "Copy-Safe Scene Split"
