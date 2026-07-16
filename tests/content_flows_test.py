import base64
import io
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import api.routers.content_flows as content_flows
import api.security as security
import pixelle_video.content.operations as operations
import pixelle_video.content.production_tasks as production_tasks
import pixelle_video.content.projects as projects
import pixelle_video.content.stage_revisions as stage_revisions
import pixelle_video.content.store as content_store
import pixelle_video.generation.agent_images as agent_images
import pixelle_video.generation.task_store as task_store
from api.app import app
from api.dependencies import get_generation_service, get_pixelle_video
from pixelle_video.content.models import (
    ContentItem,
    ContentVariant,
    SceneDraft,
    SceneManifest,
    new_content_item,
    now_iso,
)
from pixelle_video.content.reviews import build_pending_review
from pixelle_video.generation.schemas import GenerationProgress, GenerationTask


class FakeGenerationService:
    def __init__(self):
        self.requests = []
        self.fail_on_submit_number = None

    def submit(self, request, progress_callback=None, *, surface=None):
        next_number = len(self.requests) + 1
        if self.fail_on_submit_number == next_number:
            raise RuntimeError("simulated submission failure")
        self.requests.append((request, surface))
        return GenerationTask(
            task_id=f"task-{len(self.requests)}",
            pipeline_id=request.pipeline_id,
            request=request,
            progress=GenerationProgress(stage="queued", percentage=0),
        )


fake_generation_service = FakeGenerationService()


async def get_fake_generation_service():
    return fake_generation_service


@pytest.fixture(autouse=True)
def isolated_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(content_store, "CONTENT_ITEMS_DIR", tmp_path / "content-items")
    monkeypatch.setattr(stage_revisions, "STAGE_REVISIONS_DIR", tmp_path / "stage-revisions")
    monkeypatch.setattr(operations, "CONTENT_FLOW_OPERATION_DIR", tmp_path / "operations")
    monkeypatch.setattr(task_store, "GENERATION_TASK_DIR", tmp_path / "tasks")
    monkeypatch.setattr(production_tasks, "PRODUCTION_TASKS_DIR", tmp_path / "production-tasks")
    monkeypatch.setattr(projects, "get_data_path", lambda *parts: str(tmp_path / Path(*parts)))
    monkeypatch.setattr(content_flows, "get_data_path", lambda *parts: str(tmp_path / Path(*parts)))
    monkeypatch.setattr(agent_images, "get_data_path", lambda *parts: str(tmp_path / Path(*parts)))
    monkeypatch.setattr(security, "agent_token_path", lambda: tmp_path / "agent-token")
    monkeypatch.setattr(
        content_flows,
        "detect_available_generation_capabilities",
        lambda: {"tts", "ffmpeg", "persistence", "llm", "media"},
    )
    projects.create_project(
        name="Test project",
        default_production_template_id="pipeline_topic_to_video_base_v1",
    )
    fake_generation_service.requests.clear()
    fake_generation_service.fail_on_submit_number = None
    app.dependency_overrides[get_generation_service] = get_fake_generation_service
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def client():
    return TestClient(app)


def _trace(request_id):
    return {"request_id": request_id, "client_name": "test-agent", "source": "test"}


def _agent_headers():
    return {"X-Pixelle-Agent-Token": security.ensure_agent_token()}


def _project_id():
    return projects.list_projects()[1][0].project_id


def _review_identity(item):
    model = ContentItem.model_validate(item) if isinstance(item, dict) else item
    review = build_pending_review(model)
    assert review is not None
    return {"review_id": review.review_id, "content_version": review.version}


def _review_task(item, *, pipeline_id: str, recipe_id: str):
    task, _ = production_tasks.create_production_task(
        content_item_id=item.item_id,
        project_id=item.project,
        pipeline_id=pipeline_id,
        recipe_id=recipe_id,
        recipe_version="v1",
        title=item.title,
        artifact_type="image_set" if "image_post" in pipeline_id else "video",
        source="react",
        actor="user",
        stage_id="review_script",
        stage_label="确认内容",
        next_actor="user",
        request_id=f"review-{item.item_id}",
        request_hash=f"hash-{item.item_id}",
        input_snapshot={"topic": item.title},
        effective_params={},
    )
    production_tasks.set_task_state(
        task.production_task_id,
        state="needs_user",
        stage_id="review_script",
        stage_label="确认内容",
        next_actor="user",
    )
    return task


def test_pending_review_contract_projects_one_authoritative_payload(client):
    item = new_content_item(
        title="猫为什么喜欢纸箱",
        project=_project_id(),
        status="pending_review",
        variants={
            "Chinese": ContentVariant(
                language="Chinese", status="confirmed", script="这是原始文案。"
            )
        },
    )
    item.scene_manifest = SceneManifest(
        review_kind="video_scenes",
        scenes=[
            SceneDraft(
                scene_id="scene-1",
                order=1,
                narration="第一镜。",
                image_prompt="纸箱里的猫",
            )
        ],
    )
    content_store.save_item(item)

    response = client.get(f"/api/content-items/{item.item_id}/pending-review")

    assert response.status_code == 200, response.text
    context = response.json()
    assert context["item"]["item_id"] == item.item_id
    assert context["review"]["review_id"]
    assert context["review"]["version"] == "v1"
    assert context["review"]["payload"]["kind"] == "video_scenes"
    assert context["review"]["payload"]["scene_manifest"]["scenes"][0]["narration"] == "第一镜。"
    assert context["review"]["reference"]["variants"]["Chinese"]["script"] == ("这是原始文案。")


def test_confirm_rejects_wrong_review_object_and_accepts_idempotent_retry(client):
    item = new_content_item(
        title="猫为什么喜欢纸箱",
        project=_project_id(),
        status="pending_review",
        variants={
            "Chinese": ContentVariant(language="Chinese", status="pending", script="待确认文案")
        },
    )
    content_store.save_item(item)
    identity = _review_identity(item)

    wrong = client.post(
        f"/api/content-items/{item.item_id}/confirm",
        json={
            **_trace("wrong-review"),
            **identity,
            "review_id": f"{item.item_id}:video_scenes",
        },
    )
    assert wrong.status_code == 409

    payload = {**_trace("confirm-idempotent"), **identity}
    first = client.post(f"/api/content-items/{item.item_id}/confirm", json=payload)
    repeated = client.post(f"/api/content-items/{item.item_id}/confirm", json=payload)
    assert first.status_code == 200, first.text
    assert repeated.status_code == 200, repeated.text
    assert repeated.json()["status"] == "confirmed"


def test_direct_edit_does_not_require_an_llm_service(client):
    item = new_content_item(
        title="猫为什么喜欢纸箱",
        project=_project_id(),
        status="pending_review",
        variants={"Chinese": ContentVariant(language="Chinese", status="pending", script="修改前")},
    )
    content_store.save_item(item)
    _review_task(
        item,
        pipeline_id="topic_to_video",
        recipe_id="pipeline_topic_to_video_base_v1",
    )

    async def core_without_llm():
        return SimpleNamespace(llm=None)

    app.dependency_overrides[get_pixelle_video] = core_without_llm
    response = client.post(
        f"/api/content-items/{item.item_id}/revise-review",
        json={
            **_trace("direct-edit-without-llm"),
            **_review_identity(item),
            "action": "direct_edit",
            "variants": {
                "Chinese": {
                    "language": "Chinese",
                    "status": "pending",
                    "title": item.title,
                    "script": "修改后",
                }
            },
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["variants"]["Chinese"]["script"] == "修改后"


def test_rewrite_script_keeps_the_same_production_task(client, monkeypatch):
    import pixelle_video.content.drafting as drafting

    item = new_content_item(
        title="猫为什么喜欢纸箱",
        project=_project_id(),
        status="pending_review",
        variants={"Chinese": ContentVariant(language="Chinese", status="pending", script="旧文案")},
    )
    content_store.save_item(item)
    task = _review_task(
        item,
        pipeline_id="topic_to_video",
        recipe_id="pipeline_topic_to_video_base_v1",
    )

    async def fake_core():
        return SimpleNamespace(llm=object())

    async def fake_draft(**_kwargs):
        return {"language_drafts": {"Chinese": {"title": "新标题", "script": "系统重写后的文案"}}}

    monkeypatch.setattr(drafting, "draft_topic", fake_draft)
    app.dependency_overrides[get_pixelle_video] = fake_core
    response = client.post(
        f"/api/content-items/{item.item_id}/revise-review",
        json={
            "action": "rewrite_script",
            **_review_identity(item),
            **_trace("rewrite-script"),
        },
    )
    assert response.status_code == 200, response.text
    # The request acknowledges the durable background stage immediately.  The
    # completed review is read from the canonical content item afterwards.
    updated = client.get(f"/api/content-items/{item.item_id}").json()
    assert updated["variants"]["Chinese"]["script"] == "系统重写后的文案"
    assert production_tasks.load_production_task(task.production_task_id) is not None
    assert len(production_tasks.list_production_tasks()) == 1


def test_selected_scene_regeneration_preserves_unselected_scene(client, monkeypatch):
    import pixelle_video.content.drafting as drafting

    item = new_content_item(
        title="猫为什么喜欢纸箱",
        project=_project_id(),
        status="pending_review",
        variants={
            "Chinese": ContentVariant(
                language="Chinese", status="confirmed", script="第一段。第二段。"
            )
        },
    )
    item.scene_manifest = SceneManifest(
        review_kind="video_scenes",
        scenes=[
            SceneDraft(scene_id="scene-1", order=1, narration="第一段。", image_prompt="第一段。"),
            SceneDraft(scene_id="scene-2", order=2, narration="第二段。", image_prompt="第二段。"),
        ],
    )
    content_store.save_item(item)
    task = _review_task(
        item,
        pipeline_id="script_to_video",
        recipe_id="pipeline_standard_base_v1",
    )

    async def fake_core():
        return SimpleNamespace(llm=object())

    async def fake_rewrite(**_kwargs):
        return "只改第一段。"

    monkeypatch.setattr(drafting, "rewrite_review_unit", fake_rewrite)
    app.dependency_overrides[get_pixelle_video] = fake_core
    response = client.post(
        f"/api/content-items/{item.item_id}/revise-review",
        json={
            "action": "regenerate_selected",
            "selected_scene_ids": ["scene-1"],
            **_review_identity(item),
            **_trace("rewrite-scene"),
        },
    )
    assert response.status_code == 200, response.text
    updated = client.get(f"/api/content-items/{item.item_id}").json()
    scenes = updated["scene_manifest"]["scenes"]
    assert [scene["narration"] for scene in scenes] == ["只改第一段。", "第二段。"]
    assert production_tasks.load_production_task(task.production_task_id) is not None
    assert len(production_tasks.list_production_tasks()) == 1


def test_topic_image_post_uses_script_and_page_confirmation_on_one_task(client, monkeypatch):
    import pixelle_video.content.drafting as drafting

    async def fake_core():
        return SimpleNamespace(llm=object())

    async def fake_draft(**_kwargs):
        return {
            "language_drafts": {
                "Chinese": {
                    "title": "猫与纸箱",
                    "script": "纸箱给猫安全感。纸板也能保温。",
                }
            }
        }

    async def fake_split(**_kwargs):
        return ["纸箱给猫安全感。", "纸板也能保温。"]

    monkeypatch.setattr(drafting, "draft_topic", fake_draft)
    monkeypatch.setattr(drafting, "split_confirmed_script", fake_split)
    monkeypatch.setattr(content_flows, "split_confirmed_script", fake_split)
    app.dependency_overrides[get_pixelle_video] = fake_core

    started = client.post(
        "/api/production-tasks",
        json={
            "request_id": "topic-image-route",
            "project_id": _project_id(),
            "pipeline_id": "topic_to_image_post",
            "recipe_id": "pipeline_topic_to_image_post_base_v1",
            "input": {"topic": "猫为什么喜欢纸箱"},
            "overrides": {},
        },
    )
    assert started.status_code == 202, started.text
    task_id = started.json()["production_task_id"]
    item_id = started.json()["content_item_id"]
    first_review = client.get(f"/api/content-items/{item_id}").json()
    assert first_review["status"] == "pending_review"
    assert first_review["scene_manifest"] is None

    script_confirmed = client.post(
        f"/api/content-items/{item_id}/confirm",
        json={
            "request_id": "topic-image-confirm-script",
            "client_name": "react-console",
            "source": "react",
            **_review_identity(first_review),
        },
    )
    assert script_confirmed.status_code == 200, script_confirmed.text
    second_review = client.get(f"/api/content-items/{item_id}").json()
    assert second_review["status"] == "pending_review"
    assert second_review["scene_manifest"]["review_kind"] == "image_pages"
    assert len(second_review["scene_manifest"]["scenes"]) == 2

    confirm_pages_payload = {
        "request_id": "topic-image-confirm-pages",
        "client_name": "react-console",
        "source": "react",
        **_review_identity(second_review),
    }
    # Confirmation identifies the already-persisted review version. It must
    # never resend (or accidentally replace) its authoritative scene manifest.
    assert "scenes" not in confirm_pages_payload
    assert "scene_manifest" not in confirm_pages_payload
    page_confirmed = client.post(
        f"/api/content-items/{item_id}/confirm",
        json=confirm_pages_payload,
    )
    assert page_confirmed.status_code == 200, page_confirmed.text
    assert len(fake_generation_service.requests) == 1
    generation_request, _surface = fake_generation_service.requests[0]
    assert generation_request.pipeline_id == "topic_to_image_post"
    assert generation_request.input["pages"] == [
        "纸箱给猫安全感。",
        "纸板也能保温。",
    ]
    assert generation_request.input["script"] == "纸箱给猫安全感。纸板也能保温。"
    assert "scenes" not in generation_request.input
    assert "confirmed_scenes" not in generation_request.metadata
    assert "confirmed_script" not in generation_request.metadata
    assert production_tasks.load_production_task(task_id) is not None
    assert len(production_tasks.list_production_tasks()) == 1


def test_system_generated_digital_human_copy_is_confirmed_before_video(client, monkeypatch):
    import pixelle_video.content.drafting as drafting

    async def fake_core():
        return SimpleNamespace(llm=object())

    async def fake_digital_script(**_kwargs):
        return "这是一段等待用户确认的数字人口播文案。"

    monkeypatch.setattr(drafting, "draft_digital_human_script", fake_digital_script)
    app.dependency_overrides[get_pixelle_video] = fake_core
    started = client.post(
        "/api/production-tasks",
        json={
            "request_id": "digital-human-review",
            "project_id": _project_id(),
            "pipeline_id": "digital_human",
            "recipe_id": "pixelle_digital_human_basic_v1",
            "input": {
                "character_assets": ["/tmp/character.png"],
                "goods_assets": ["/tmp/goods.png"],
                "goods_title": "猫咪纸箱",
                "mode": "digital",
            },
            "overrides": {},
        },
    )
    assert started.status_code == 202, started.text
    task_id = started.json()["production_task_id"]
    item_id = started.json()["content_item_id"]
    pending = client.get(f"/api/content-items/{item_id}").json()
    assert pending["status"] == "pending_review"
    assert pending["variants"]["Chinese"]["script"] == "这是一段等待用户确认的数字人口播文案。"
    assert fake_generation_service.requests == []

    confirmed = client.post(
        f"/api/content-items/{item_id}/confirm",
        json={
            "request_id": "digital-human-confirm",
            "client_name": "react-console",
            "source": "react",
            **_review_identity(pending),
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    # Confirmation is persisted before the potentially slow provider
    # submission starts.  The canonical item reflects the completed
    # background hand-off.
    confirmed_item = client.get(f"/api/content-items/{item_id}").json()
    assert confirmed_item["status"] == "producing"
    assert len(fake_generation_service.requests) == 1
    generation_request, _surface = fake_generation_service.requests[0]
    assert generation_request.pipeline_id == "digital_human"
    assert generation_request.input["script"] == "这是一段等待用户确认的数字人口播文案。"
    assert production_tasks.load_production_task(task_id) is not None
    assert len(production_tasks.list_production_tasks()) == 1


def test_generated_agent_token_is_stable_and_private(tmp_path, monkeypatch):
    path = tmp_path / "private-token"
    monkeypatch.setattr(security, "agent_token_path", lambda: path)
    first = security.ensure_agent_token()
    second = security.ensure_agent_token()
    assert first == second
    assert len(first) >= 32
    assert path.stat().st_mode & 0o777 == 0o600


def test_invalid_agent_token_never_downgrades_to_user(client):
    response = client.post(
        "/api/content-items/topics",
        headers={"X-Pixelle-Agent-Token": "wrong-token"},
        json={"titles": ["不应创建"], **_trace("wrong-token-topic")},
    )
    assert response.status_code == 403
    assert content_store.list_items(limit=10) == []


def test_user_derived_topics_keep_product_source_without_impersonating_agent(client):
    response = client.post(
        "/api/content-items/topics",
        json={
            "titles": ["纸箱选题的后续"],
            "project_id": _project_id(),
            "content_source": "derived",
            **_trace("derived-topic"),
        },
    )
    assert response.status_code == 200, response.text
    item = response.json()[0]
    assert item["source"] == "derived"
    assert item["events"][0]["actor"] == "user"


def _image_data_url(color="red"):
    image = Image.new("RGB", (8, 8), color=color)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def _create_topic(client):
    response = client.post(
        "/api/content-items/topics",
        headers=_agent_headers(),
        json={
            "titles": ["猫为什么喜欢纸箱"],
            "project_id": _project_id(),
            **_trace("topics-1"),
        },
    )
    assert response.status_code == 200, response.text
    return response.json()[0]


def _manifest_payload(request_id="manifest-1"):
    return {
        "scenes": [
            {
                "scene_id": "scene-1",
                "order": 1,
                "narration": "纸箱给猫提供狭小而安全的空间。",
                "image_prompt": "一只橘猫安心地窝在纸箱里",
            },
            {
                "scene_id": "scene-2",
                "order": 2,
                "narration": "纸板还能帮助猫保持温暖。",
                "image_prompt": "温暖房间里的纸箱和猫",
            },
        ],
        **_trace(request_id),
    }


def test_complete_agent_story_route_confirms_exact_version_and_auto_produces(client):
    started = client.post(
        "/api/production-tasks",
        headers=_agent_headers(),
        json={
            "request_id": "codex-route-1",
            "project_id": _project_id(),
            "pipeline_id": "codex_scene_video",
            "recipe_id": "codex_image_story_v1",
            "input": {"title": "猫为什么喜欢纸箱", "scenes": _manifest_payload()["scenes"]},
            "overrides": {},
            "client_name": "test-agent",
            "agent_session_id": "session-1",
        },
    )
    assert started.status_code == 202, started.text
    item_id = started.json()["content_item_id"]
    item = client.get(f"/api/content-items/{item_id}").json()
    assert item["status"] == "pending_review"
    assert started.json()["task"]["state"] == "needs_user"

    inferred = client.post(
        f"/api/content-items/{item_id}/confirm",
        headers=_agent_headers(),
        json={
            **_trace("confirm-inferred"),
            **_review_identity(item),
            "agent_session_id": "session-1",
        },
    )
    assert inferred.status_code == 403

    confirmed = client.post(
        f"/api/content-items/{item_id}/confirm",
        headers=_agent_headers(),
        json={
            **_trace("confirm-explicit"),
            **_review_identity(item),
            "agent_session_id": "session-1",
            "explicit_user_confirmation": True,
        },
    )
    assert confirmed.status_code == 200, confirmed.text

    uploaded = client.post(
        f"/api/content-items/{item_id}/scene-images",
        headers=_agent_headers(),
        json={
            "images": [
                {"scene_id": "scene-1", "image_data_url": _image_data_url()},
                {"scene_id": "scene-2", "image_data_url": _image_data_url("blue")},
            ],
            **_trace("images-complete"),
            "agent_session_id": "session-1",
        },
    )
    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()["production"]["task_ids"] == ["task-1"]
    request, surface = fake_generation_service.requests[0]
    assert request.pipeline_id == "codex_scene_video"
    assert surface == "agent"


def _legacy_topics_and_two_stage_agent_story_flow(client):
    item = _create_topic(client)
    assert item["events"][0]["actor"] == "agent"

    denied = client.put(
        f"/api/content-items/{item['item_id']}/scene-manifest",
        json=_manifest_payload("manifest-denied"),
    )
    assert denied.status_code == 403

    manifest = client.put(
        f"/api/content-items/{item['item_id']}/scene-manifest",
        headers=_agent_headers(),
        json=_manifest_payload(),
    )
    assert manifest.status_code == 200, manifest.text
    payload = manifest.json()
    assert payload["status"] == "pending_review"
    assert "narrations" not in payload["variants"]["Chinese"]
    assert payload["scene_manifest"]["confirmed"] is False

    before_confirm = client.post(
        f"/api/content-items/{item['item_id']}/scene-images",
        headers=_agent_headers(),
        json={
            "images": [{"scene_id": "scene-1", "image_data_url": _image_data_url()}],
            **_trace("images-too-soon"),
        },
    )
    assert before_confirm.status_code == 400

    agent_confirm = client.post(
        f"/api/content-items/{item['item_id']}/confirm",
        headers=_agent_headers(),
        json={**_trace("confirm-agent"), **_review_identity(payload)},
    )
    assert agent_confirm.status_code == 403

    invalid_token_confirm = client.post(
        f"/api/content-items/{item['item_id']}/confirm",
        headers={"X-Pixelle-Agent-Token": "wrong-token"},
        json={**_trace("confirm-invalid-token"), **_review_identity(payload)},
    )
    assert invalid_token_confirm.status_code == 403

    confirmed = client.post(
        f"/api/content-items/{item['item_id']}/confirm",
        json={**_trace("confirm-user"), **_review_identity(payload)},
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["scene_manifest"]["confirmed"] is True

    one_image = client.post(
        f"/api/content-items/{item['item_id']}/scene-images",
        headers=_agent_headers(),
        json={
            "images": [{"scene_id": "scene-1", "image_data_url": _image_data_url()}],
            **_trace("images-1"),
        },
    )
    assert one_image.status_code == 200, one_image.text
    assert "path" not in one_image.json()["images"][0]

    missing = client.post(
        f"/api/content-items/{item['item_id']}/produce",
        headers=_agent_headers(),
        json={"recipe_id": "codex_image_story_v1", **_trace("produce-missing")},
    )
    assert missing.status_code == 400
    assert missing.json()["detail"]["missing_scene_ids"] == ["scene-2"]

    all_images = client.post(
        f"/api/content-items/{item['item_id']}/scene-images",
        headers=_agent_headers(),
        json={
            "images": [{"scene_id": "scene-2", "image_data_url": _image_data_url("blue")}],
            **_trace("images-2"),
        },
    )
    assert all_images.status_code == 200, all_images.text

    produced = client.post(
        f"/api/content-items/{item['item_id']}/produce",
        headers=_agent_headers(),
        json={"recipe_id": "codex_image_story_v1", **_trace("produce-1")},
    )
    assert produced.status_code == 200, produced.text
    assert produced.json()["task_ids"] == ["task-1"]
    request, surface = fake_generation_service.requests[0]
    assert request.pipeline_id == "codex_scene_video"
    assert request.input["scenes"][0]["image_path"].endswith("scene-1.png")
    first_scene_path = Path(request.input["scenes"][0]["image_path"])
    assert surface == "agent"

    blocked_replace = client.post(
        f"/api/content-items/{item['item_id']}/scene-images",
        headers=_agent_headers(),
        json={
            "images": [
                {
                    "scene_id": "scene-1",
                    "image_data_url": _image_data_url("green"),
                    "replace": True,
                }
            ],
            **_trace("replace-producing"),
        },
    )
    assert blocked_replace.status_code == 409

    stored = content_store.load_item(item["item_id"])
    stored.status = "produced"
    content_store.save_item(stored)
    replaced = client.post(
        f"/api/content-items/{item['item_id']}/scene-images",
        headers=_agent_headers(),
        json={
            "images": [
                {
                    "scene_id": "scene-1",
                    "image_data_url": _image_data_url("green"),
                    "replace": True,
                }
            ],
            **_trace("replace-produced"),
        },
    )
    assert replaced.status_code == 200
    reproduced = client.post(
        f"/api/content-items/{item['item_id']}/produce",
        headers=_agent_headers(),
        json={"recipe_id": "codex_image_story_v1", **_trace("produce-2")},
    )
    assert reproduced.status_code == 200
    assert first_scene_path.is_file()
    assert fake_generation_service.requests[1][0].input["scenes"][0]["image_path"] != str(
        first_scene_path
    )
    current = content_store.load_item(item["item_id"])
    assert current.links["task_ids"] == ["task-1", "task-2"]
    assert current.automation["production_prior_status"] == "produced"


def test_publish_evidence_and_mock_metrics_are_separate(client):
    item = _create_topic(client)
    stored = content_store.load_item(item["item_id"])
    stored.status = "produced"
    content_store.save_item(stored)

    no_evidence = client.post(
        f"/api/content-items/{item['item_id']}/mark-published",
        headers=_agent_headers(),
        json={"platform": "xiaohongshu", "published_at": now_iso(), **_trace("pub-bad")},
    )
    assert no_evidence.status_code == 400

    published = client.post(
        f"/api/content-items/{item['item_id']}/mark-published",
        headers=_agent_headers(),
        json={
            "platform": "xiaohongshu",
            "published_at": now_iso(),
            "publish_url": "https://example.com/post/1",
            **_trace("pub-ok"),
        },
    )
    assert published.status_code == 200
    assert published.json()["status"] == "published"
    assert len(published.json()["publications"]) == 1

    mocked = client.post(
        f"/api/content-items/{item['item_id']}/metrics",
        headers=_agent_headers(),
        json={"likes": 999, "mock": True, "mock_label": "acceptance", **_trace("mock")},
    )
    assert mocked.status_code == 200
    assert mocked.json()["status"] == "published"
    assert mocked.json()["metrics"] == {}
    assert mocked.json()["automation"]["mock_metrics"][0]["likes"] == 999

    official = client.post(
        f"/api/content-items/{item['item_id']}/metrics",
        headers=_agent_headers(),
        json={"likes": 12, **_trace("metrics")},
    )
    assert official.status_code == 200
    assert official.json()["status"] == "measured"
    assert official.json()["metrics"]["likes"] == 12


def test_publish_and_metrics_are_linked_to_the_exact_production_timeline(client):
    item = new_content_item(title="猫为什么喜欢纸箱", project=_project_id())
    item.status = "produced"
    content_store.save_item(item)
    task = _review_task(
        item,
        pipeline_id="script_to_video",
        recipe_id="pipeline_standard_base_v1",
    )
    production_tasks.set_task_state(
        task.production_task_id,
        state="produced",
        stage_id="completed",
        stage_label="已产出",
        next_actor="user",
    )

    published = client.post(
        f"/api/content-items/{item.item_id}/mark-published",
        json={
            "production_task_id": task.production_task_id,
            "platform": "xiaohongshu",
            "published_at": now_iso(),
            "publish_url": "https://example.com/post/task-linked",
            **_trace("publish-task-linked"),
        },
    )
    assert published.status_code == 200, published.text
    publication = published.json()["publications"][0]
    assert publication["production_task_id"] == task.production_task_id

    measured = client.post(
        f"/api/content-items/{item.item_id}/metrics",
        json={
            "production_task_id": task.production_task_id,
            "publication_id": publication["publication_id"],
            "likes": 12,
            **_trace("metrics-task-linked"),
        },
    )
    assert measured.status_code == 200, measured.text

    timeline = client.get(f"/api/production-tasks/{task.production_task_id}/timeline")
    assert timeline.status_code == 200, timeline.text
    assert [
        entry["event_type"]
        for entry in timeline.json()["items"]
        if entry["event_type"] in {"published", "metrics_recorded"}
    ] == ["metrics_recorded", "published"]


def _legacy_manifest_conflicts_locking_and_idempotency(client):
    item = _create_topic(client)
    stored = content_store.load_item(item["item_id"])
    stored.status = "pending_review"
    stored.variants = {
        "Chinese": ContentVariant(
            language="Chinese",
            script="另一份草稿",
        )
    }
    content_store.save_item(stored)

    conflict = client.put(
        f"/api/content-items/{item['item_id']}/scene-manifest",
        headers=_agent_headers(),
        json=_manifest_payload("manifest-conflict"),
    )
    assert conflict.status_code == 409

    overwrite_payload = _manifest_payload("manifest-overwrite")
    overwrite_payload["overwrite_draft"] = True
    accepted = client.put(
        f"/api/content-items/{item['item_id']}/scene-manifest",
        headers=_agent_headers(),
        json=overwrite_payload,
    )
    assert accepted.status_code == 200
    repeated = client.put(
        f"/api/content-items/{item['item_id']}/scene-manifest",
        headers=_agent_headers(),
        json=overwrite_payload,
    )
    assert repeated.status_code == 200

    changed = {**overwrite_payload, "scenes": [*overwrite_payload["scenes"]]}
    changed["scenes"][0] = {**changed["scenes"][0], "narration": "修改后的文案"}
    request_id_conflict = client.put(
        f"/api/content-items/{item['item_id']}/scene-manifest",
        headers=_agent_headers(),
        json=changed,
    )
    assert request_id_conflict.status_code == 409

    confirmed = client.post(
        f"/api/content-items/{item['item_id']}/confirm",
        json={**_trace("confirm-lock"), **_review_identity(accepted.json())},
    )
    assert confirmed.status_code == 200
    locked = client.put(
        f"/api/content-items/{item['item_id']}/scene-manifest",
        headers=_agent_headers(),
        json=_manifest_payload("manifest-after-confirm"),
    )
    assert locked.status_code == 400


def test_scene_manifest_cannot_prebind_an_asset_before_confirmation(client):
    item = _create_topic(client)
    payload = _manifest_payload("manifest-with-asset")
    payload["scenes"][0]["asset_id"] = "agent-image:not-issued-here"
    response = client.put(
        f"/api/content-items/{item['item_id']}/scene-manifest",
        headers=_agent_headers(),
        json=payload,
    )
    assert response.status_code == 422
    assert content_store.load_item(item["item_id"]).scene_manifest is None


def test_drafting_state_rejects_manifest_and_unknown_image_is_durable_failure(client):
    item = _create_topic(client)
    stored = content_store.load_item(item["item_id"])
    stored.status = "drafting"
    content_store.save_item(stored)
    drafting = client.put(
        f"/api/content-items/{item['item_id']}/scene-manifest",
        headers=_agent_headers(),
        json=_manifest_payload("manifest-drafting"),
    )
    assert drafting.status_code == 409

    stored.status = "confirmed"
    stored.scene_manifest = SceneManifest(
        scenes=_manifest_payload("unused")["scenes"], confirmed=True
    )
    content_store.save_item(stored)
    unknown = client.post(
        f"/api/content-items/{item['item_id']}/scene-images",
        headers=_agent_headers(),
        json={
            "images": [{"scene_id": "missing", "image_data_url": _image_data_url()}],
            **_trace("unknown-image"),
        },
    )
    assert unknown.status_code == 400
    operation = operations.find_by_request_id("unknown-image")
    assert operation is not None
    assert operation.status == "failed"


def test_multi_platform_publications_require_metric_binding(client):
    item = _create_topic(client)
    stored = content_store.load_item(item["item_id"])
    stored.status = "produced"
    content_store.save_item(stored)

    first = client.post(
        f"/api/content-items/{item['item_id']}/mark-published",
        headers=_agent_headers(),
        json={
            "platform": "xiaohongshu",
            "published_at": now_iso(),
            "publish_url": "https://example.com/xhs/1",
            **_trace("pub-xhs"),
        },
    )
    second = client.post(
        f"/api/content-items/{item['item_id']}/mark-published",
        headers=_agent_headers(),
        json={
            "platform": "youtube",
            "published_at": now_iso(),
            "platform_post_id": "youtube-1",
            **_trace("pub-youtube"),
        },
    )
    assert first.status_code == 200
    assert second.status_code == 200
    assert len(second.json()["publications"]) == 2

    missing_binding = client.post(
        f"/api/content-items/{item['item_id']}/metrics",
        headers=_agent_headers(),
        json={"likes": 10, **_trace("metrics-unbound")},
    )
    assert missing_binding.status_code == 400
    publication_id = second.json()["publications"][1]["publication_id"]
    bound = client.post(
        f"/api/content-items/{item['item_id']}/metrics",
        headers=_agent_headers(),
        json={"likes": 10, "publication_id": publication_id, **_trace("metrics-bound")},
    )
    assert bound.status_code == 200
    assert bound.json()["status"] == "measured"


def test_empty_metrics_do_not_advance_published_content(client):
    item = _create_topic(client)
    stored = content_store.load_item(item["item_id"])
    stored.status = "published"
    content_store.save_item(stored)
    response = client.post(
        f"/api/content-items/{item['item_id']}/metrics",
        headers=_agent_headers(),
        json=_trace("empty-metrics"),
    )
    assert response.status_code == 422
    assert content_store.load_item(item["item_id"]).status == "published"


def test_agent_capabilities_are_live_and_authenticated(client):
    public = client.get("/api/agent/capabilities")
    agent = client.get("/api/agent/capabilities", headers=_agent_headers())
    assert public.status_code == 200
    assert public.json()["authenticated"] is False
    assert agent.json()["authenticated"] is True
    recipe = next(
        recipe for recipe in agent.json()["recipes"] if recipe["id"] == "codex_image_story_v1"
    )
    assert recipe["access_scope"] == "agent"
    assert recipe["requires"] == ["scene_manifest", "client_generated_images"]
    assert recipe["agent_producible"] is True
    i2v = next(
        recipe for recipe in agent.json()["recipes"] if recipe["id"] == "pixelle_i2v_basic_v1"
    )
    assert i2v["agent_producible"] is False
    assert i2v["unavailable_reason"]


def _legacy_partial_multi_language_submission_is_linked_and_reported(client):
    item = new_content_item(
        title="多语言",
        status="confirmed",
        languages=["Chinese", "English"],
        variants={
            "Chinese": ContentVariant(language="Chinese", status="confirmed", script="中文文案"),
            "English": ContentVariant(
                language="English", status="confirmed", script="English script"
            ),
        },
    )
    content_store.save_item(item)
    fake_generation_service.fail_on_submit_number = 2
    response = client.post(
        f"/api/content-items/{item.item_id}/produce",
        json={"recipe_id": "pipeline_standard_base_v1", **_trace("partial-produce")},
    )
    assert response.status_code == 502, response.text
    current = content_store.load_item(item.item_id)
    assert current.status == "producing"
    assert current.links["task_ids"] == ["task-1"]
    assert current.automation["production_submission_incomplete"]["task_ids"] == ["task-1"]
    operation = operations.find_by_request_id("partial-produce")
    assert operation.status == "failed"


def test_asset_recipe_is_honestly_rejected_by_content_use_case(client):
    item = new_content_item(
        title="素材型任务",
        status="confirmed",
        variants={
            "Chinese": ContentVariant(
                language="Chinese", status="confirmed", script="不能冒充素材输入"
            )
        },
    )
    content_store.save_item(item)
    response = client.post(
        f"/api/content-items/{item.item_id}/produce",
        json={"recipe_id": "pixelle_i2v_basic_v1", **_trace("unsupported-assets")},
    )
    assert response.status_code == 400
    assert "React 快速生成" in response.json()["detail"]
    operation = operations.find_by_request_id("unsupported-assets")
    assert operation.error["layer"] == "product_assumption"


def test_async_draft_is_server_owned_and_operation_is_pollable(client, monkeypatch):
    import pixelle_video.content.drafting as drafting_service

    async def fake_create_draft(*, llm_service, topic, languages, settings):
        del llm_service, languages, settings
        return {
            "topic": topic,
            "language_drafts": {
                "Chinese": {
                    "title": topic,
                    "script": "猫喜欢纸箱，因为它安全又保暖。",
                }
            },
        }

    async def fake_core():
        return SimpleNamespace(llm=object())

    monkeypatch.setattr(drafting_service, "draft_topic", fake_create_draft)
    app.dependency_overrides[get_pixelle_video] = fake_core
    try:
        item = _create_topic(client)
        started = client.post(
            f"/api/content-items/{item['item_id']}/draft",
            headers=_agent_headers(),
            json={
                "recipe_id": "pipeline_topic_to_video_base_v1",
                **_trace("draft-1"),
            },
        )
        assert started.status_code == 202, started.text
        operation_id = started.json()["operation_id"]
        polled = client.get(f"/api/agent/operations/{operation_id}", headers=_agent_headers())
    finally:
        app.dependency_overrides.pop(get_pixelle_video, None)

    assert polled.status_code == 200
    assert polled.json()["status"] == "completed"
    drafted = content_store.load_item(item["item_id"])
    assert drafted.status == "pending_review"
