import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import api.routers.content_items as content_items_router
import pixelle_video.content.projects as projects
import pixelle_video.content.store as content_store
import pixelle_video.generation.task_store as task_store
from api.app import app
from api.dependencies import get_pixelle_video
from pixelle_video.generation.schemas import (
    GenerationError,
    GenerationProgress,
    GenerationRequest,
    GenerationTask,
)
from pixelle_video.generation.task_store import save_generation_task

BASE = "/api/content-items"


class FakeHistory:
    async def get_task_list(self, page=1, page_size=20, status=None, **kwargs):
        return {"tasks": [{"task_id": "task-1", "title": "历史成片作品", "status": "completed"}]}


class FakePublish:
    async def load_publish_record(self, task_id):
        return None


class FakePixelleVideoCore:
    def __init__(self):
        self.history = FakeHistory()
        self.publish = FakePublish()


async def get_fake_core():
    return FakePixelleVideoCore()


@pytest.fixture(autouse=True)
def isolated_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(content_store, "CONTENT_ITEMS_DIR", tmp_path / "content-items")
    monkeypatch.setattr(
        content_items_router, "SCRIPT_REVIEW_DIR", tmp_path / "script-review-drafts"
    )
    # 隔离项目存储（list/create 会触发迁移）；ops.db 探测走 tmp → 缺失 → 回退分支
    monkeypatch.setattr(projects, "get_data_path", lambda *parts: str(tmp_path / Path(*parts)))
    monkeypatch.setattr(task_store, "GENERATION_TASK_DIR", tmp_path / "generation-tasks")
    yield


@pytest.fixture
def client():
    return TestClient(app)


def _write_sample_draft_set(monkeypatch, tmp_dir):
    directory = tmp_dir
    directory.mkdir(parents=True, exist_ok=True)
    draft_set = {
        "draft_set_id": "ds-1",
        "status": "drafted",
        "created_at": "2026-07-01T10:00:00",
        "updated_at": "2026-07-01T10:00:00",
        "topics": ["猫咪为什么不爱喝水"],
        "languages": ["Chinese"],
        "drafts": [
            {
                "topic": "猫咪为什么不爱喝水",
                "title": "猫咪不喝水怎么办",
                "index": 1,
                "selected_languages": ["Chinese"],
                "language_drafts": {
                    "Chinese": {
                        "title": "猫咪不喝水怎么办",
                        "script": "第一段。第二段。",
                        "narrations": ["第一段。", "第二段。"],
                    }
                },
            }
        ],
        "submissions": [],
    }
    (directory / "ds-1.json").write_text(
        json.dumps(draft_set, ensure_ascii=False), encoding="utf-8"
    )


# ---------------------------------------------------------------------------
# 项目作用域
# ---------------------------------------------------------------------------


def test_project_scoped_listing(client):
    project_a = projects.create_project(name="A").project_id
    project_b = projects.create_project(name="B").project_id

    client.post(BASE, json={"titles": ["A 选题"], "project_id": project_a})
    client.post(BASE, json={"titles": ["B 选题"], "project_id": project_b})

    only_a = client.get(f"{BASE}?project={project_a}").json()
    assert [item["title"] for item in only_a] == ["A 选题"]
    assert all(item["project"] == project_a for item in only_a)

    only_b = client.get(f"{BASE}?project={project_b}").json()
    assert [item["title"] for item in only_b] == ["B 选题"]

    # 无 project 参数返回全部
    everything = client.get(BASE).json()
    assert len(everything) == 2


def test_create_defaults_to_default_project(client):
    created = client.post(BASE, json={"titles": ["无项目选题"]}).json()
    assert created[0]["project"] == projects.default_project_id()


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


def test_create_list_get_delete(client):
    create = client.post(BASE, json={"titles": ["选题 A", "选题 B"]})
    assert create.status_code == 200, create.text
    items = create.json()
    assert len(items) == 2
    assert items[0]["status"] == "idea"
    assert items[0]["events"][0]["type"] == "created"

    item_id = items[0]["item_id"]
    listing = client.get(BASE).json()
    assert len(listing) == 2

    got = client.get(f"{BASE}/{item_id}")
    assert got.status_code == 200
    assert got.json()["title"] == "选题 A"

    deleted = client.delete(f"{BASE}/{item_id}")
    assert deleted.status_code == 200
    assert client.get(f"{BASE}/{item_id}").status_code == 404


def test_create_confirmed_with_script(client):
    create = client.post(
        BASE,
        json={
            "titles": ["现成文案标题"],
            "initial_status": "confirmed",
            "scripts": ["这是一段现成的文案。"],
            "languages": ["Chinese"],
        },
    )
    assert create.status_code == 200, create.text
    item = create.json()[0]
    assert item["status"] == "confirmed"
    assert item["variants"]["Chinese"]["status"] == "confirmed"
    assert item["variants"]["Chinese"]["script"] == "这是一段现成的文案。"


def test_patch_merges_links_and_metrics(client):
    item = client.post(BASE, json={"titles": ["选题"]}).json()[0]
    item_id = item["item_id"]

    patched = client.patch(
        f"{BASE}/{item_id}",
        json={"metrics": {"likes": 12}, "links": {"task_ids": ["t1"]}},
    ).json()
    assert patched["metrics"]["likes"] == 12
    assert patched["links"]["task_ids"] == ["t1"]

    patched2 = client.patch(f"{BASE}/{item_id}", json={"metrics": {"favorites": 3}}).json()
    # 浅合并保留已有 metrics
    assert patched2["metrics"]["likes"] == 12
    assert patched2["metrics"]["favorites"] == 3


# ---------------------------------------------------------------------------
# Transitions
# ---------------------------------------------------------------------------


def test_valid_transition_writes_event(client):
    item = client.post(BASE, json={"titles": ["选题"]}).json()[0]
    item_id = item["item_id"]

    response = client.post(
        f"{BASE}/{item_id}/transition",
        json={"to": "confirmed", "actor": "user", "detail": {"reason": "ok"}},
    )
    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["status"] == "confirmed"
    event = updated["events"][-1]
    assert event["type"] == "status_changed"
    assert event["actor"] == "user"
    assert event["at"]
    assert event["detail"]["from"] == "idea"
    assert event["detail"]["to"] == "confirmed"
    assert event["detail"]["reason"] == "ok"


def test_invalid_transition_rejected(client):
    item = client.post(BASE, json={"titles": ["选题"]}).json()[0]
    item_id = item["item_id"]
    # idea -> published 不在合法表中
    response = client.post(f"{BASE}/{item_id}/transition", json={"to": "published"})
    assert response.status_code == 400


def test_unknown_status_rejected(client):
    item = client.post(BASE, json={"titles": ["选题"]}).json()[0]
    response = client.post(f"{BASE}/{item['item_id']}/transition", json={"to": "nonsense"})
    assert response.status_code == 400


def test_producing_item_reconciles_from_persisted_completed_tasks(client):
    item = client.post(
        BASE,
        json={"titles": ["待出片内容"], "initial_status": "confirmed"},
    ).json()[0]
    batch_id = "batch-complete"
    task = _generation_task("task-complete", batch_id, "completed")
    save_generation_task(task)
    client.post(f"{BASE}/{item['item_id']}/transition", json={"to": "producing"})
    client.patch(
        f"{BASE}/{item['item_id']}",
        json={"links": {"task_ids": [task.task_id], "batch_ids": [batch_id]}},
    )

    reconciled = client.get(f"{BASE}/{item['item_id']}").json()
    assert reconciled["status"] == "produced"
    assert reconciled["events"][-1]["type"] == "produced"


def test_failed_production_returns_to_confirmed_with_visible_error(client):
    item = client.post(
        BASE,
        json={"titles": ["生产失败内容"], "initial_status": "confirmed"},
    ).json()[0]
    batch_id = "batch-failed"
    task = _generation_task("task-failed", batch_id, "failed")
    save_generation_task(task)
    client.post(f"{BASE}/{item['item_id']}/transition", json={"to": "producing"})
    client.patch(
        f"{BASE}/{item['item_id']}",
        json={"links": {"task_ids": [task.task_id], "batch_ids": [batch_id]}},
    )

    reconciled = client.get(BASE).json()[0]
    assert reconciled["status"] == "confirmed"
    assert reconciled["automation"]["production_failure"]["message"] == "render failed"
    assert reconciled["events"][-1]["type"] == "production_failed"


def _generation_task(task_id: str, batch_id: str, status: str) -> GenerationTask:
    return GenerationTask(
        task_id=task_id,
        pipeline_id="standard",
        entry="script",
        status=status,
        progress=GenerationProgress(stage=status, percentage=100),
        request=GenerationRequest(
            pipeline_id="standard",
            entry="script",
            input={"script": "test"},
            metadata={"batch_id": batch_id},
        ),
        error=(
            GenerationError(layer="runtime", message="render failed")
            if status == "failed"
            else None
        ),
    )


# ---------------------------------------------------------------------------
# Import existing (幂等)
# ---------------------------------------------------------------------------


def test_import_existing_is_idempotent(client, monkeypatch, tmp_path):
    _write_sample_draft_set(monkeypatch, tmp_path / "script-review-drafts")
    app.dependency_overrides[get_pixelle_video] = get_fake_core
    try:
        first = client.post(f"{BASE}/import-existing")
        assert first.status_code == 200, first.text
        assert first.json()["created"] == 2  # 1 draft + 1 history task

        listing = client.get(BASE).json()
        statuses = {item["title"]: item["status"] for item in listing}
        assert statuses["猫咪不喝水怎么办"] == "pending_review"
        assert statuses["历史成片作品"] == "produced"

        second = client.post(f"{BASE}/import-existing")
        assert second.json()["created"] == 0
    finally:
        app.dependency_overrides.clear()
