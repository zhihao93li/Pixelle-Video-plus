from fastapi.testclient import TestClient

import api.routers.generation as generation_router
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


class FakeScriptReviewPixelleVideoCore:
    def __init__(self):
        self.pipeline_registry = build_default_pipeline_registry()
        self.responses = [
            '{"title": "Cat hydration", "script": "Cats need clean water every day. Bowls should be refreshed."}',
            '{"narrations": ["Cats need clean water every day.", "Bowls should be refreshed."]}',
        ]

    async def llm(self, **kwargs):
        if not self.responses:
            raise AssertionError(f"Unexpected LLM call: {kwargs}")
        return self.responses.pop(0)


async def get_fake_pixelle_video():
    return FakePixelleVideoCore()


async def get_fake_script_review_pixelle_video():
    return FakeScriptReviewPixelleVideoCore()


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


class FakeBatchGenerationService:
    def __init__(self):
        self.requests = []
        self.tasks = {}

    def submit(self, request):
        self.requests.append(request)
        task_id = f"batch-task-{len(self.requests)}"
        task = GenerationTask(
            task_id=task_id,
            pipeline_id=request.pipeline_id,
            entry=request.entry,
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
    assert payload["default_pipeline"] == "standard"
    assert [pipeline["id"] for pipeline in payload["pipelines"]] == [
        "standard",
        "custom",
        "asset_based",
        "image_post",
        "long_form",
        "i2v",
        "action_transfer",
        "digital_human",
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


def test_generation_templates_endpoint_lists_builtin_production_templates():
    response = TestClient(app).get("/api/generation/templates")

    assert response.status_code == 200
    payload = response.json()
    assert payload["default_template"] == "pipeline_standard_base_v1"
    ids = [template["id"] for template in payload["templates"]]
    # 新的中性骨架排在最前，退役的 PetWoods 预设仍在（退役≠删除）
    assert ids[0] == "pipeline_standard_base_v1"
    assert ids[1] == "pipeline_asset_based_base_v1"
    for retired in [
        "petwoods_xhs_daily_v1",
        "petwoods_xhs_static_subtitle_v1",
        "petwoods_xhs_topic_to_video_v1",
        "petwoods_xhs_quality_explainer_v1",
        "petwoods_xhs_asset_enhanced_v1",
        "petwoods_xhs_real_material_montage_v1",
    ]:
        assert retired in ids

    templates_by_id = {template["id"]: template for template in payload["templates"]}
    assert templates_by_id["pipeline_standard_base_v1"]["display_name"] == "图文口播视频"
    assert templates_by_id["pipeline_standard_base_v1"]["use_case"] == "standard_base"
    assert templates_by_id["pipeline_standard_base_v1"]["enabled"] is True
    assert templates_by_id["pipeline_asset_based_base_v1"]["display_name"] == "素材增强视频"
    assert templates_by_id["pipeline_asset_based_base_v1"]["requires_user_assets"] is True
    # 退役模板 enabled=False 且 retired=True（展示时归入「已退役」）
    assert templates_by_id["petwoods_xhs_daily_v1"]["enabled"] is False
    assert templates_by_id["petwoods_xhs_daily_v1"]["retired"] is True
    assert templates_by_id["pipeline_standard_base_v1"]["retired"] is False
    assert templates_by_id["petwoods_xhs_real_material_montage_v1"]["enabled"] is False
    assert templates_by_id["petwoods_xhs_real_material_montage_v1"]["requires_user_assets"] is True
    assert templates_by_id["pixelle_i2v_basic_v1"]["pipeline_id"] == "i2v"
    assert templates_by_id["pixelle_action_transfer_basic_v1"]["pipeline_id"] == "action_transfer"
    assert templates_by_id["pixelle_digital_human_basic_v1"]["pipeline_id"] == "digital_human"


def test_generation_template_task_endpoint_compiles_template_and_submits_request():
    fake_generation_service.requests = []
    app.dependency_overrides[get_generation_service] = get_fake_generation_service

    try:
        response = TestClient(app).post(
            "/api/generation/templates/pipeline_standard_base_v1/tasks",
            json={
                "input": {"script": "Scene one."},
                "metadata": {"experiment_id": "exp-1"},
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["generation_task_id"] == "gen-task-1"
    request = fake_generation_service.requests[0]
    assert request.pipeline_id == "standard"
    assert request.entry == "script"
    assert request.input == {"script": "Scene one."}
    assert request.params["compose_runtime"] == "html_ffmpeg"
    assert request.metadata["production_template"]["id"] == "pipeline_standard_base_v1"


def test_special_generation_template_task_endpoint_compiles_workflow_request():
    fake_generation_service.requests = []
    app.dependency_overrides[get_generation_service] = get_fake_generation_service

    try:
        response = TestClient(app).post(
            "/api/generation/templates/pixelle_i2v_basic_v1/tasks",
            json={
                "input": {
                    "assets": ["/tmp/cat.jpg"],
                    "prompt": "make the cat look up",
                    "title": "Cat motion",
                },
                "metadata": {"source": "test_i2v"},
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    request = fake_generation_service.requests[0]
    assert request.pipeline_id == "i2v"
    assert request.entry == "assets"
    assert request.input == {
        "assets": ["/tmp/cat.jpg"],
        "prompt": "make the cat look up",
    }
    assert request.params["workflow_key"] == "runninghub/i2v_LTX2.json"
    assert request.params["title"] == "Cat motion"
    assert request.metadata["production_template"]["id"] == "pixelle_i2v_basic_v1"


def test_generation_batch_endpoint_persists_batch_and_continues_item_failures(tmp_path):
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
                "items": [
                    {"input": {"script": "Cats need clean water daily."}},
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
    assert fake_batch_service.requests[0].entry == "script"
    assert fake_batch_service.requests[0].input == {"script": "Cats need clean water daily."}
    assert (tmp_path / f"{payload['batch_id']}.json").exists()
    assert get_response.status_code == 200
    assert get_response.json()["batch_id"] == payload["batch_id"]
    assert list_response.status_code == 200
    assert list_response.json()["batches"][0]["batch_id"] == payload["batch_id"]


def test_generation_batch_item_retry_resubmits_failed_item(tmp_path):
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
                "items": [{"input": {"script": "Cats need clean water daily."}}],
                "metadata": {"source": "test_batch"},
            },
        )
        batch_id = create_response.json()["batch_id"]
        fake_batch_service.tasks["batch-task-1"].status = "failed"
        client.get(f"/api/generation/batches/{batch_id}")

        retry_response = client.post(f"/api/generation/batches/{batch_id}/items/1/retry")
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


def test_generation_batch_cancel_stops_only_unfinished_items(tmp_path):
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
                "items": [
                    {"input": {"script": "First."}},
                    {"input": {"script": "Second."}},
                ],
            },
        )
        batch_id = create_response.json()["batch_id"]
        fake_batch_service.tasks["batch-task-1"].status = "completed"
        cancel_response = client.delete(f"/api/generation/batches/{batch_id}")
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


def test_generation_batch_exposes_missing_canonical_task_state(tmp_path):
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


def test_generation_batch_preserves_persisted_terminal_item_without_task_state(tmp_path):
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


def test_script_review_batch_item_retry_preserves_params(tmp_path):
    fake_batch_service = FakeBatchGenerationService()

    async def get_fake_batch_generation_service():
        return fake_batch_service

    previous_dir = generation_router.GENERATION_BATCH_DIR
    generation_router.GENERATION_BATCH_DIR = tmp_path
    app.dependency_overrides[get_generation_service] = get_fake_batch_generation_service
    batch_id = "review-batch"
    generation_router._save_batch(
        {
            "batch_id": batch_id,
            "template_id": "pipeline_standard_base_v1",
            "status": "failed",
            "created_at": "2026-07-03T00:00:00",
            "updated_at": "2026-07-03T00:00:00",
            "metadata": {"source": "test_review"},
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
        retry_response = client.post(f"/api/generation/batches/{batch_id}/items/1/retry")
    finally:
        app.dependency_overrides.clear()
        generation_router.GENERATION_BATCH_DIR = previous_dir

    assert retry_response.status_code == 200
    payload = retry_response.json()
    assert payload["items"][0]["task_id"] == "batch-task-1"
    assert payload["items"][0]["params"]["tts_voice"] == "fish-reference-id"
    assert fake_batch_service.requests[0].pipeline_id == "standard"
    assert fake_batch_service.requests[0].entry == "script"
    assert fake_batch_service.requests[0].input == {"script": "Keep water away from food."}
    assert fake_batch_service.requests[0].params["tts_inference_mode"] == "fish"


def test_script_review_draft_set_endpoint_generates_and_persists_drafts(tmp_path, monkeypatch):
    from pathlib import Path as _Path

    import pixelle_video.content.projects as projects

    monkeypatch.setattr(projects, "get_data_path", lambda *parts: str(tmp_path / _Path(*parts)))
    previous_dir = generation_router.GENERATION_SCRIPT_REVIEW_DIR
    generation_router.GENERATION_SCRIPT_REVIEW_DIR = tmp_path
    app.dependency_overrides[get_pixelle_video] = get_fake_script_review_pixelle_video

    try:
        client = TestClient(app)
        templates_response = client.get("/api/generation/script-review/templates")
        create_response = client.post(
            "/api/generation/script-review/draft-sets",
            json={
                "topics": ["Cat hydration"],
                "languages": ["English"],
                "script_template_name": "Short Oral Script",
                "split_template_name": "Copy-Safe Scene Split",
                "language_script_templates": {"English": "English prompt"},
                "language_script_models": {"English": "model-en"},
                "metadata": {"source": "test_review"},
            },
        )
        draft_set_id = create_response.json()["draft_set_id"]
        get_response = client.get(f"/api/generation/script-review/draft-sets/{draft_set_id}")
        list_response = client.get("/api/generation/script-review/draft-sets")
    finally:
        app.dependency_overrides.clear()
        generation_router.GENERATION_SCRIPT_REVIEW_DIR = previous_dir

    assert templates_response.status_code == 200
    assert create_response.status_code == 200
    payload = create_response.json()
    assert payload["status"] == "drafted"
    assert payload["topics"] == ["Cat hydration"]
    assert payload["languages"] == ["English"]
    assert payload["draft_settings"]["language_script_templates"] == {"English": "custom"}
    assert payload["draft_settings"]["language_script_models"] == {"English": "model-en"}
    # 每个草稿集记录项目归属（迁移生成的默认项目）
    assert payload["draft_settings"]["project_id"]
    assert payload["draft_settings"]["production_template_id"] == "pipeline_standard_base_v1"
    assert payload["draft_settings"]["production_template_name"]
    assert payload["drafts"][0]["language_script_models"] == {"English": "model-en"}
    assert payload["drafts"][0]["language_drafts"]["English"]["narrations"] == [
        "Cats need clean water every day.",
        "Bowls should be refreshed.",
    ]
    assert (tmp_path / f"{payload['draft_set_id']}.json").exists()
    assert get_response.status_code == 200
    assert get_response.json()["draft_set_id"] == draft_set_id
    assert list_response.status_code == 200
    assert list_response.json()["draft_sets"][0]["draft_set_id"] == draft_set_id


def test_recipe_drafting_config_endpoint_round_trip(tmp_path, monkeypatch):
    from pixelle_video.generation import template_overrides

    monkeypatch.setattr(
        template_overrides,
        "_overrides_path",
        lambda: str(tmp_path / "production-template-overrides.json"),
    )
    client = TestClient(app)
    template_id = "pipeline_standard_base_v1"

    initial = client.get(f"/api/generation/templates/{template_id}/drafting-config")
    assert initial.status_code == 200
    assert initial.json()["is_overridden"] is False

    drafting = {
        "script_template_name": "Short Oral Script",
        "split_template_name": "Copy-Safe Scene Split",
        "script_model": "writer-model",
        "split_model": "splitter-model",
        "language_script_models": {"English": "writer-en"},
    }
    updated = client.put(
        f"/api/generation/templates/{template_id}/drafting-config",
        json={"drafting": drafting},
    )
    assert updated.status_code == 200
    assert updated.json()["drafting"] == drafting
    assert updated.json()["is_overridden"] is True

    reset = client.delete(f"/api/generation/templates/{template_id}/drafting-config")
    assert reset.status_code == 200
    assert reset.json()["is_overridden"] is False


def test_script_review_submit_endpoint_creates_real_generation_tasks(tmp_path):
    fake_batch_service = FakeBatchGenerationService()

    async def get_fake_batch_generation_service():
        return fake_batch_service

    previous_review_dir = generation_router.GENERATION_SCRIPT_REVIEW_DIR
    previous_batch_dir = generation_router.GENERATION_BATCH_DIR
    generation_router.GENERATION_SCRIPT_REVIEW_DIR = tmp_path / "reviews"
    generation_router.GENERATION_BATCH_DIR = tmp_path / "batches"
    app.dependency_overrides[get_pixelle_video] = get_fake_script_review_pixelle_video
    app.dependency_overrides[get_generation_service] = get_fake_batch_generation_service

    try:
        client = TestClient(app)
        create_response = client.post(
            "/api/generation/script-review/draft-sets",
            json={
                "topics": ["Cat hydration"],
                "languages": ["English"],
                "script_template_name": "Short Oral Script",
                "split_template_name": "Copy-Safe Scene Split",
            },
        )
        draft_set_id = create_response.json()["draft_set_id"]
        submit_response = client.post(
            f"/api/generation/script-review/draft-sets/{draft_set_id}/tasks",
            json={
                "base_params": {
                    "frame_template": "1080x1920/image_default.html",
                    "tts_inference_mode": "fish",
                },
                "language_tts_overrides": {
                    "English": {
                        "tts_inference_mode": "fish",
                        "tts_voice": "voice-en",
                        "tts_speed": 1.0,
                    }
                },
                "metadata": {"source": "test_review_submit"},
            },
        )
    finally:
        app.dependency_overrides.clear()
        generation_router.GENERATION_SCRIPT_REVIEW_DIR = previous_review_dir
        generation_router.GENERATION_BATCH_DIR = previous_batch_dir

    assert submit_response.status_code == 200
    payload = submit_response.json()
    assert payload["draft_set"]["status"] == "submitted"
    # 审核提交走生产模板体系，batch 记录真实使用的生产模板。
    assert payload["batch"]["template_id"] == "pipeline_standard_base_v1"
    assert payload["batch"]["submitted_count"] == 1
    assert payload["batch"]["items"][0]["task_id"] == "batch-task-1"
    request = fake_batch_service.requests[0]
    assert request.pipeline_id == "standard"
    assert request.entry == "script"
    assert request.input == {
        "script": "Cats need clean water every day.\nBowls should be refreshed."
    }
    # review_* 溯源信息进 metadata，不再作为生产参数
    assert request.metadata["review_language"] == "English"
    assert "review_language" not in request.params
    # 表单级覆盖（白名单内）生效
    assert request.params["tts_voice"] == "voice-en"
    # 模板 fixed_params 打底生效
    assert request.params["compose_runtime"] == "html_ffmpeg"
    assert request.params["mode"] == "fixed"
    assert request.metadata["draft_set_id"] == draft_set_id
    assert request.metadata["production_template"]["id"] == "pipeline_standard_base_v1"


def _submit_script_review(client, draft_set_id, extra_body=None):
    body = {
        "language_tts_overrides": {
            "English": {
                "tts_inference_mode": "fish",
                "tts_voice": "voice-en",
                "tts_speed": 1.0,
            }
        },
        "metadata": {"source": "test_review_submit"},
        **(extra_body or {}),
    }
    return client.post(
        f"/api/generation/script-review/draft-sets/{draft_set_id}/tasks",
        json=body,
    )


def _create_review_draft_set(client):
    response = client.post(
        "/api/generation/script-review/draft-sets",
        json={
            "topics": ["Cat hydration"],
            "languages": ["English"],
            "script_template_name": "Short Oral Script",
            "split_template_name": "Copy-Safe Scene Split",
        },
    )
    return response.json()["draft_set_id"]


def test_script_review_submit_honors_template_id_and_rejects_invalid(tmp_path):
    fake_batch_service = FakeBatchGenerationService()

    async def get_fake_batch_generation_service():
        return fake_batch_service

    previous_review_dir = generation_router.GENERATION_SCRIPT_REVIEW_DIR
    previous_batch_dir = generation_router.GENERATION_BATCH_DIR
    generation_router.GENERATION_SCRIPT_REVIEW_DIR = tmp_path / "reviews"
    generation_router.GENERATION_BATCH_DIR = tmp_path / "batches"
    app.dependency_overrides[get_pixelle_video] = get_fake_script_review_pixelle_video
    app.dependency_overrides[get_generation_service] = get_fake_batch_generation_service

    try:
        client = TestClient(app)
        draft_set_id = _create_review_draft_set(client)

        # 明确指定已启用模板：审核稿走该模板出片
        submit_response = _submit_script_review(
            client,
            draft_set_id,
            {"template_id": "pipeline_standard_base_v1"},
        )
        assert submit_response.status_code == 200
        payload = submit_response.json()
        assert payload["batch"]["template_id"] == "pipeline_standard_base_v1"
        request = fake_batch_service.requests[0]
        assert request.params["frame_template"] == "1080x1920/image_default.html"

        # 不支持 script 输入或不存在的模板必须被拒绝
        rejected = _submit_script_review(
            client, draft_set_id, {"template_id": "pixelle_i2v_basic_v1"}
        )
        assert rejected.status_code == 409
        unknown = _submit_script_review(client, draft_set_id, {"template_id": "no_such_template"})
        assert unknown.status_code == 409
    finally:
        app.dependency_overrides.clear()
        generation_router.GENERATION_SCRIPT_REVIEW_DIR = previous_review_dir
        generation_router.GENERATION_BATCH_DIR = previous_batch_dir


def test_script_review_submit_uses_template_default_overrides(tmp_path, monkeypatch):
    """验收口径：模板默认配置改一个参数，审核出片下一次生效。"""
    from pixelle_video.generation import template_overrides

    overrides_path = tmp_path / "production-template-overrides.json"
    monkeypatch.setattr(template_overrides, "_overrides_path", lambda: str(overrides_path))
    template_overrides.save_overrides("pipeline_standard_base_v1", {"bgm_volume": 0.35})

    fake_batch_service = FakeBatchGenerationService()

    async def get_fake_batch_generation_service():
        return fake_batch_service

    previous_review_dir = generation_router.GENERATION_SCRIPT_REVIEW_DIR
    previous_batch_dir = generation_router.GENERATION_BATCH_DIR
    generation_router.GENERATION_SCRIPT_REVIEW_DIR = tmp_path / "reviews"
    generation_router.GENERATION_BATCH_DIR = tmp_path / "batches"
    app.dependency_overrides[get_pixelle_video] = get_fake_script_review_pixelle_video
    app.dependency_overrides[get_generation_service] = get_fake_batch_generation_service

    try:
        client = TestClient(app)
        draft_set_id = _create_review_draft_set(client)
        submit_response = _submit_script_review(client, draft_set_id)
        assert submit_response.status_code == 200
        request = fake_batch_service.requests[0]
        assert request.params["bgm_volume"] == 0.35
    finally:
        app.dependency_overrides.clear()
        generation_router.GENERATION_SCRIPT_REVIEW_DIR = previous_review_dir
        generation_router.GENERATION_BATCH_DIR = previous_batch_dir


def test_generation_template_task_endpoint_rejects_missing_runtime_capability(monkeypatch):
    fake_generation_service.requests = []
    app.dependency_overrides[get_generation_service] = get_fake_generation_service
    monkeypatch.setattr(
        generation_router,
        "detect_available_generation_capabilities",
        lambda: {"llm", "tts", "media", "persistence"},
    )

    try:
        response = TestClient(app).post(
            "/api/generation/templates/pipeline_standard_base_v1/tasks",
            json={"input": {"script": "Scene one."}},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 400
    assert "ffmpeg" in response.json()["detail"]
    assert fake_generation_service.requests == []


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
                "split_mode": "line",
                "not_whitelisted_key": "should-be-dropped",
            },
        },
        metadata={"source": "retry-test"},
    )
    assert request.input == {"script": "重试用的文案。"}
    assert request.params["tts_voice"] == "voice-en"
    assert request.params["tts_inference_mode"] == "fish"
    assert request.params["split_mode"] == "line"
    assert "not_whitelisted_key" not in request.params
    assert request.metadata["production_template"]["id"] == "pipeline_standard_base_v1"


def test_prompt_template_default_ignores_custom_file_ordering():
    """安全默认回归：未显式指定 Prompt 时必须命中内置通用模板，
    自定义 Prompt 文件（如 bazi_*.md）的存在与排序不得改变默认起草行为。"""
    script_template = generation_router._resolve_prompt_template("script", None)
    assert script_template.name == "Short Oral Script"
    split_template = generation_router._resolve_prompt_template("split", None)
    assert split_template.name == "Copy-Safe Scene Split"
