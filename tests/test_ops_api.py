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


def test_ops_api_current_view_can_be_filtered_by_project(tmp_path, monkeypatch):
    db_path = tmp_path / "ops.db"
    monkeypatch.setenv("PIXELLE_OPS_DB_PATH", str(db_path))

    store = OpsStore(db_path)
    store.init_db()
    service = OpsService(store)
    petwoods = service.create_project(
        name="PetWoods",
        product="PetWoods",
        channel="xiaohongshu",
        source=_source(),
    )
    pet_cycle = service.create_cycle(
        project_id=petwoods["id"],
        name="Pet cycle",
        goal="Grow cat content",
        source=_source(),
    )
    service.create_experiment(
        project_id=petwoods["id"],
        cycle_id=pet_cycle["id"],
        title="Cat hook",
        hypothesis="Cat hook wins.",
        source=_source(),
    )
    other = service.create_project(
        name="Other Brand",
        product="Other",
        channel="xiaohongshu",
        source=_source(),
    )
    other_cycle = service.create_cycle(
        project_id=other["id"],
        name="Other cycle",
        goal="Avoid mixed context",
        source=_source(),
    )
    service.create_experiment(
        project_id=other["id"],
        cycle_id=other_cycle["id"],
        title="Other hook",
        hypothesis="Other hook wins.",
        source=_source(),
    )

    client = TestClient(app)
    ambiguous = client.get("/api/ops/current")
    selected = client.get(f"/api/ops/current?project_id={petwoods['id']}")

    assert ambiguous.status_code == 200
    assert ambiguous.json()["next_action"]["kind"] == "select_project"
    assert selected.status_code == 200
    assert selected.json()["project"]["name"] == "PetWoods"
    assert selected.json()["next_action"]["kind"] == "lock_prediction"


def test_ops_api_current_view_can_be_filtered_by_channel_account(tmp_path, monkeypatch):
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
        name="Pet cycle",
        goal="Grow cat content",
        source=_source(),
    )
    service.create_experiment(
        project_id=project["id"],
        cycle_id=cycle["id"],
        title="Cat hook",
        hypothesis="Cat hook wins.",
        source=_source(),
    )
    first = service.create_channel_account(
        project_id=project["id"],
        platform="xiaohongshu",
        account_name="PetWoods XHS",
        source=_source(),
    )
    service.create_channel_account(
        project_id=project["id"],
        platform="douyin",
        account_name="PetWoods Douyin",
        source=_source(),
    )

    client = TestClient(app)
    ambiguous = client.get(f"/api/ops/current?project_id={project['id']}")
    selected = client.get(f"/api/ops/current?channel_account_id={first['id']}")

    assert ambiguous.status_code == 200
    assert ambiguous.json()["next_action"]["reason"] == "multiple_accounts"
    assert selected.status_code == 200
    assert selected.json()["selected_channel_account"]["id"] == first["id"]
    assert selected.json()["context"]["channel_account_id"] == first["id"]


def test_ops_api_returns_404_for_missing_experiment(tmp_path, monkeypatch):
    monkeypatch.setenv("PIXELLE_OPS_DB_PATH", str(tmp_path / "ops.db"))

    client = TestClient(app)
    response = client.get("/api/ops/experiments/missing")

    assert response.status_code == 404
    assert response.json()["detail"]["error"]["code"] == "experiment_not_found"
    assert "Traceback" not in response.json()["detail"]["error"]["message"]
