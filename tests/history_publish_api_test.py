from fastapi.testclient import TestClient

from api.app import app
from api.dependencies import get_pixelle_video


class FakeHistoryManager:
    def __init__(self):
        self.list_calls = []
        self.detail_calls = []
        self.delete_calls = []

    async def get_task_list(self, **kwargs):
        self.list_calls.append(kwargs)
        return {
            "tasks": [
                {
                    "task_id": "task-1",
                    "status": "completed",
                    "title": "Daily pet care",
                    "created_at": "2026-07-01T10:00:00",
                    "completed_at": "2026-07-01T10:03:00",
                    "result": {"video_path": "output/task-1/final.mp4"},
                }
            ],
            "total": 1,
            "page": kwargs["page"],
            "page_size": kwargs["page_size"],
            "total_pages": 1,
        }

    async def get_task_detail(self, task_id):
        self.detail_calls.append(task_id)
        if task_id == "missing":
            return None
        return {
            "metadata": {
                "task_id": task_id,
                "status": "completed",
                "input": {"text": "Scene one."},
                "result": {"video_path": "output/task-1/final.mp4"},
            },
            "storyboard": {"frames": [{"index": 0, "narration": "Scene one."}]},
            "generation_summary": {
                "primary_video": {"path": "output/task-1/final.mp4"},
                "quality_review": {"publishable": True},
            },
        }

    async def get_statistics(self):
        return {"total_tasks": 2, "completed": 1, "failed": 1}

    async def delete_task(self, task_id):
        self.delete_calls.append(task_id)
        return task_id == "task-1"


class FakePublishManager:
    def __init__(self):
        self.check_calls = []
        self.publish_calls = []

    async def load_publish_record(self, task_id):
        if task_id == "empty":
            return None
        return {
            "task_id": task_id,
            "title": "Daily pet care",
            "caption": "Hydration tips",
            "jobs": [{"platform": "youtube", "status": "scheduled"}],
        }

    async def check_configuration(self, platforms=None):
        self.check_calls.append(platforms)
        return [{"name": "Buffer youtube", "ok": True, "message": "Channel reachable"}]

    async def publish_task(self, *, task_id, platforms, caption, title=None, due_at=None):
        self.publish_calls.append(
            {
                "task_id": task_id,
                "platforms": platforms,
                "caption": caption,
                "title": title,
                "due_at": due_at,
            }
        )
        return {
            "task_id": task_id,
            "title": title,
            "caption": caption,
            "jobs": [{"platform": platforms[0], "status": "scheduled"}],
        }


class FakePixelleVideoCore:
    def __init__(self):
        self.history = FakeHistoryManager()
        self.publish = FakePublishManager()


fake_core = FakePixelleVideoCore()


async def get_fake_pixelle_video():
    return fake_core


def test_history_tasks_endpoint_exposes_paginated_task_list():
    app.dependency_overrides[get_pixelle_video] = get_fake_pixelle_video

    try:
        response = TestClient(app).get(
            "/api/history/tasks",
            params={
                "page": 2,
                "page_size": 10,
                "status": "completed",
                "sort_by": "completed_at",
                "sort_order": "asc",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["tasks"][0]["task_id"] == "task-1"
    assert payload["page"] == 2
    assert fake_core.history.list_calls[-1] == {
        "page": 2,
        "page_size": 10,
        "status": "completed",
        "sort_by": "completed_at",
        "sort_order": "asc",
    }


def test_history_detail_statistics_and_delete_endpoints_delegate_to_history_manager():
    app.dependency_overrides[get_pixelle_video] = get_fake_pixelle_video

    try:
        client = TestClient(app)
        detail_response = client.get("/api/history/tasks/task-1")
        stats_response = client.get("/api/history/statistics")
        delete_response = client.delete("/api/history/tasks/task-1")
        missing_response = client.get("/api/history/tasks/missing")
    finally:
        app.dependency_overrides.clear()

    assert detail_response.status_code == 200
    assert detail_response.json()["metadata"]["task_id"] == "task-1"
    assert detail_response.json()["generation_summary"]["quality_review"]["publishable"] is True
    assert stats_response.status_code == 200
    assert stats_response.json()["completed"] == 1
    assert delete_response.status_code == 200
    assert delete_response.json() == {"deleted": True, "task_id": "task-1"}
    assert missing_response.status_code == 404


def test_publish_endpoints_expose_platforms_record_check_and_submit():
    app.dependency_overrides[get_pixelle_video] = get_fake_pixelle_video

    try:
        client = TestClient(app)
        platforms_response = client.get("/api/publish/platforms")
        timezones_response = client.get("/api/publish/timezones")
        record_response = client.get("/api/publish/tasks/task-1/record")
        empty_record_response = client.get("/api/publish/tasks/empty/record")
        check_response = client.post(
            "/api/publish/check",
            json={"platforms": ["youtube"]},
        )
        submit_response = client.post(
            "/api/publish/tasks/task-1",
            json={
                "platforms": ["youtube"],
                "caption": "Hydration tips #petcare",
                "title": "Daily pet care",
                "due_at": "2026-07-04T09:00:00+08:00",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert platforms_response.status_code == 200
    assert platforms_response.json()["platforms"][0]["id"] == "youtube"
    assert timezones_response.status_code == 200
    assert timezones_response.json()["default_timezone"] == "Asia/Shanghai"
    assert "UTC" in timezones_response.json()["timezones"]
    assert record_response.status_code == 200
    assert record_response.json()["record"]["jobs"][0]["status"] == "scheduled"
    assert empty_record_response.status_code == 200
    assert empty_record_response.json() == {"record": None, "task_id": "empty"}
    assert check_response.status_code == 200
    assert check_response.json()["checks"][0]["ok"] is True
    assert fake_core.publish.check_calls[-1] == ["youtube"]
    assert submit_response.status_code == 200
    assert submit_response.json()["record"]["caption"] == "Hydration tips #petcare"
    assert fake_core.publish.publish_calls[-1] == {
        "task_id": "task-1",
        "platforms": ["youtube"],
        "caption": "Hydration tips #petcare",
        "title": "Daily pet care",
        "due_at": "2026-07-04T09:00:00+08:00",
    }
