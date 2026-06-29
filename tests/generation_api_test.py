from fastapi.testclient import TestClient

from api.app import app
from api.dependencies import get_pixelle_video
from pixelle_video.generation import build_default_pipeline_registry


class FakePixelleVideoCore:
    def __init__(self):
        self.pipeline_registry = build_default_pipeline_registry()


async def get_fake_pixelle_video():
    return FakePixelleVideoCore()


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
