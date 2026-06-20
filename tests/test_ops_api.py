from fastapi.testclient import TestClient

from api.app import app
from ops.service import OpsService
from ops.store import OpsStore


def _source():
    return {"kind": "codex", "confirmed_by_user": True, "skill": "cheat-on-content"}


def test_ops_api_exposes_current_view_as_read_only(tmp_path, monkeypatch):
    db_path = tmp_path / "ops.db"
    monkeypatch.setenv("PIXELLE_OPS_DB_PATH", str(db_path))

    store = OpsStore(db_path)
    store.init_db()
    service = OpsService(store)
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
    service.create_experiment(
        project_id=project["id"],
        cycle_id=cycle["id"],
        title="Hook test",
        hypothesis="Pain hook wins.",
        source=_source(),
    )

    client = TestClient(app)
    response = client.get("/api/ops/current")
    post_response = client.post("/api/ops/current", json={})

    assert response.status_code == 200
    assert response.json()["project"]["name"] == "PetWoods"
    assert post_response.status_code == 405


def test_ops_api_returns_404_for_missing_experiment(tmp_path, monkeypatch):
    monkeypatch.setenv("PIXELLE_OPS_DB_PATH", str(tmp_path / "ops.db"))

    client = TestClient(app)
    response = client.get("/api/ops/experiments/missing")

    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "experiment_not_found"
