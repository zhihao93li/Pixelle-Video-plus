import json

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
    assert ambiguous.json()["next_action"]["kind"] == "select_channel_account"
    assert ambiguous.json()["next_action"]["reason"] == "multiple_accounts"
    assert selected.status_code == 200
    assert selected.json()["selected_channel_account"]["id"] == first["id"]
    assert selected.json()["context"]["channel_account_id"] == first["id"]


def test_ops_api_current_view_auto_selects_single_channel_account(tmp_path, monkeypatch):
    db_path = tmp_path / "ops.db"
    monkeypatch.setenv("PIXELLE_OPS_DB_PATH", str(db_path))

    store = OpsStore(db_path)
    store.init_db()
    service = OpsService(store)
    project = service.create_project(
        name="PetWoods",
        product="PetWoods",
        channel="youtube",
        source=_source(),
    )
    account = service.create_channel_account(
        project_id=project["id"],
        platform="youtube",
        account_name="PetWoods YouTube",
        source=_source(),
    )

    client = TestClient(app)
    response = client.get(f"/api/ops/current?project_id={project['id']}")

    assert response.status_code == 200
    body = response.json()
    assert body["selected_channel_account"]["id"] == account["id"]
    assert body["context"]["channel_account_id"] == account["id"]
    assert body["context"]["selection"] == "implicit_single_channel_account"


def test_ops_api_lists_projects_with_channel_accounts(tmp_path, monkeypatch):
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
    account = service.create_channel_account(
        project_id=project["id"],
        platform="xiaohongshu",
        account_name="PetWoods 宠物森友会",
        account_handle="petwoods",
        source=_source(),
    )

    client = TestClient(app)
    response = client.get("/api/ops/projects")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["projects"][0]["id"] == project["id"]
    assert body["projects"][0]["channel_accounts"][0]["id"] == account["id"]
    assert body["projects"][0]["social_accounts"][0]["id"] == account["id"]


def test_ops_api_creates_channel_account_with_ui_source(tmp_path, monkeypatch):
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

    client = TestClient(app)
    response = client.post(
        f"/api/ops/projects/{project['id']}/channel-accounts",
        json={
            "platform": "xiaohongshu",
            "account_name": "PetWoods 宠物森友会",
            "account_handle": "petwoods",
            "external_account_id": "xhs-petwoods",
            "status": "configured",
            "credential_ref": {"provider": "manual", "key": "pixelle/petwoods/xhs"},
            "buffer_channel_id": "buffer-channel-petwoods",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["channel_account"]["project_id"] == project["id"]
    assert body["channel_account"]["source"]["kind"] == "ui"
    assert body["channel_account"]["credential_ref"]["provider"] == "manual"
    assert body["channel_account"]["credential_ref"]["buffer_channel_id"] == "buffer-channel-petwoods"
    assert body["next_action"]["kind"] == "select_channel_account"


def test_ops_api_updates_channel_account_with_ui_source(tmp_path, monkeypatch):
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
    account = service.create_channel_account(
        project_id=project["id"],
        platform="xiaohongshu",
        account_name="PetWoods 宠物森友会",
        account_handle="petwoods",
        source=_source(),
    )

    client = TestClient(app)
    response = client.patch(
        f"/api/ops/channel-accounts/{account['id']}",
        json={
            "platform": "douyin",
            "account_name": "PetWoods Douyin",
            "account_handle": "petwoods_dy",
            "external_account_id": "dy-petwoods",
            "status": "connected",
            "credential_ref": {"provider": "manual", "key": "pixelle/petwoods/douyin"},
            "buffer_channel_id": "buffer-channel-douyin",
        },
    )
    projects = client.get("/api/ops/projects").json()

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["channel_account"]["id"] == account["id"]
    assert body["channel_account"]["platform"] == "douyin"
    assert body["channel_account"]["source"]["kind"] == "ui"
    assert body["channel_account"]["credential_ref"]["buffer_channel_id"] == "buffer-channel-douyin"
    assert projects["projects"][0]["channel_accounts"][0]["account_name"] == "PetWoods Douyin"


def test_ops_api_lists_integrations_without_plaintext_secrets(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / "config.yaml").write_text(
        """
project_name: Pixelle-Video
llm:
  api_key: sk-test-secret
  base_url: https://example.test/v1
  model: test-model
comfyui:
  comfyui_url: http://127.0.0.1:8188
  comfyui_api_key: comfy-secret
  runninghub_api_key: runninghub-secret
  runninghub_concurrent_limit: 2
  image:
    default_workflow: runninghub/image.json
  video:
    default_workflow: runninghub/video.json
  tts:
    inference_mode: fish
    fish_audio:
      api_key: fish-secret
      base_url: https://api.fish.audio
      model: s2-pro
      reference_id: fish-voice
publish:
  buffer:
    api_key: buffer-secret
    channels:
      x: buffer-x-channel
  cos:
    region: ap-singapore
    bucket: pixelle-1300000000
    secret_id: cos-secret-id
    secret_key: cos-secret-key
    public_base_url: https://pixelle.example.test
""",
        encoding="utf-8",
    )

    client = TestClient(app)
    response = client.get("/api/ops/integrations")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["capabilities"]["returns_plaintext_secrets"] is False
    integrations = {item["id"]: item for item in body["integrations"]}
    assert integrations["llm"]["status"] == "configured"
    assert integrations["buffer"]["status"] == "configured"
    assert integrations["cos"]["status"] == "configured"
    assert integrations["buffer"]["safe_fields"][0]["label"] == "已配置渠道数"
    rendered = json.dumps(body, ensure_ascii=False)
    for secret in (
        "sk-test-secret",
        "comfy-secret",
        "runninghub-secret",
        "fish-secret",
        "buffer-secret",
        "cos-secret-id",
        "cos-secret-key",
    ):
        assert secret not in rendered


def test_ops_api_lists_project_cycles_with_experiment_evidence(tmp_path, monkeypatch):
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
    first_cycle = service.create_cycle(
        project_id=project["id"],
        name="R1",
        goal="First loop",
        source=_source(),
    )
    first_experiment = service.create_experiment(
        project_id=project["id"],
        cycle_id=first_cycle["id"],
        title="母猫打滚就是想配了吗？",
        hypothesis="打滚判断题能承接配种系列。",
        source=_source(),
    )
    service.lock_prediction(
        experiment_id=first_experiment["id"],
        prediction={"expected": "comments"},
        source=_source(),
    )
    second_cycle = service.create_cycle(
        project_id=project["id"],
        name="R2",
        goal="Second loop",
        source=_source(),
    )
    second_experiment = service.create_experiment(
        project_id=project["id"],
        cycle_id=second_cycle["id"],
        title="同一窝小猫，可能不是一个爹吗？",
        hypothesis="遗传猎奇题能带来收藏。",
        source=_source(),
    )

    client = TestClient(app)
    response = client.get(f"/api/ops/projects/{project['id']}/cycles")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["project"]["id"] == project["id"]
    assert [cycle_view["cycle"]["name"] for cycle_view in body["cycles"]] == ["R2", "R1"]
    assert body["cycles"][0]["experiments"][0]["experiment"]["id"] == second_experiment["id"]
    assert body["cycles"][0]["experiments"][0]["next_action"]["kind"] == "lock_prediction"
    assert body["cycles"][1]["experiments"][0]["experiment"]["id"] == first_experiment["id"]
    assert body["cycles"][1]["experiments"][0]["events"][0]["event_type"] == "prediction_locked"
    assert body["cycles"][1]["experiments"][0]["next_action"]["kind"] == "submit_generation_draft"


def test_ops_api_binds_and_reads_project_cheat_workspace_summary(tmp_path, monkeypatch):
    db_path = tmp_path / "ops.db"
    monkeypatch.setenv("PIXELLE_OPS_DB_PATH", str(db_path))
    workspace = tmp_path / "cheat"
    workspace.mkdir()
    (workspace / ".cheat-state.json").write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "rubric_version": "rubric-v3",
                "confidence": "medium",
                "buffer": {"count": 2, "status": "green"},
            }
        ),
        encoding="utf-8",
    )
    (workspace / "candidates.md").write_text("- 选题 A\n- 选题 B\n", encoding="utf-8")

    store = OpsStore(db_path)
    store.init_db()
    service = OpsService(store)
    project = service.create_project(
        name="PetWoods",
        product="PetWoods",
        channel="xiaohongshu",
        source=_source(),
    )

    client = TestClient(app)
    bind_response = client.put(
        f"/api/ops/projects/{project['id']}/cheat-workspace",
        json={"workspace_path": str(workspace)},
    )
    summary_response = client.get(f"/api/ops/projects/{project['id']}/cheat-workspace-summary")

    assert bind_response.status_code == 200
    assert bind_response.json()["cheat_workspace"]["status"] == "valid"
    assert summary_response.status_code == 200
    body = summary_response.json()
    assert body["summary"]["rubric_version"] == "rubric-v3"
    assert body["summary"]["candidate_count"] == 2
    assert body["summary"]["buffer_count"] == 2
    assert "选题 A" not in json.dumps(body, ensure_ascii=False)


def test_ops_api_returns_context_export(tmp_path, monkeypatch):
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
        name="R1",
        goal="Validate cat content",
        source=_source(),
    )
    experiment = service.create_experiment(
        project_id=project["id"],
        cycle_id=cycle["id"],
        title="母猫打滚就是想配了吗？",
        hypothesis="打滚判断题能承接配种系列。",
        source=_source(),
    )
    service.lock_prediction(
        experiment_id=experiment["id"],
        prediction={"primary_metric": "save_rate"},
        source=_source(),
    )

    client = TestClient(app)
    response = client.get(f"/api/ops/context-export?project_id={project['id']}")

    assert response.status_code == 200
    context = response.json()["context_export"]
    assert context["project"]["id"] == project["id"]
    assert context["current_cycle"]["id"] == cycle["id"]
    assert context["current_experiment"]["id"] == experiment["id"]
    assert context["next_action"]["kind"] == "submit_generation_draft"
    assert context["sync_status"]["cheat_workspace"] == "not_configured"


def test_ops_api_lists_writeback_drafts_without_apply_endpoint(tmp_path, monkeypatch):
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
        name="R1",
        goal="Validate cat content",
        source=_source(),
    )
    experiment = service.create_experiment(
        project_id=project["id"],
        cycle_id=cycle["id"],
        title="母猫打滚就是想配了吗？",
        hypothesis="打滚判断题能承接配种系列。",
        source=_source(),
    )

    draft = service.submit_writeback_draft(
        operation="lock_content_prediction",
        target={"experiment_id": experiment["id"]},
        payload={"prediction": {"primary_metric": "save_rate"}},
        source=_source(),
    )
    client = TestClient(app)
    listed = client.get("/api/ops/writeback-drafts")
    detail = client.get(f"/api/ops/writeback-drafts/{draft['draft']['id']}")
    apply_response = client.post(f"/api/ops/writeback-drafts/{draft['draft']['id']}/apply")

    assert listed.status_code == 200
    assert listed.json()["drafts"][0]["id"] == draft["draft"]["id"]
    assert detail.status_code == 200
    assert detail.json()["draft"]["status"] == "draft_created"
    assert apply_response.status_code == 404
    assert service.store.get_experiment(experiment["id"])["stage"] == "draft"


def test_ops_api_adds_preview_url_for_local_output_video(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    db_path = tmp_path / "ops.db"
    monkeypatch.setenv("PIXELLE_OPS_DB_PATH", str(db_path))
    video_path = tmp_path / "output" / "task-123" / "final.mp4"
    video_path.parent.mkdir(parents=True)
    video_path.write_bytes(b"mp4")

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
        name="R1",
        goal="Preview generated asset",
        source=_source(),
    )
    experiment = service.create_experiment(
        project_id=project["id"],
        cycle_id=cycle["id"],
        title="母猫配完后，多久能看出怀孕？",
        hypothesis="孕早期判断题能承接配种系列。",
        source=_source(),
    )
    content_item = store.create_content_item(
        project_id=project["id"],
        cycle_id=cycle["id"],
        experiment_id=experiment["id"],
        kind="video",
        title=experiment["title"],
        status="generated",
        asset_ref={"video_path": str(video_path), "duration": 71.904},
    )
    store.append_event(
        project_id=project["id"],
        cycle_id=cycle["id"],
        experiment_id=experiment["id"],
        content_item_id=content_item["id"],
        event_type="asset_checked",
        payload={"status": "passed"},
        source=_source(),
    )

    client = TestClient(app)
    response = client.get(f"/api/ops/projects/{project['id']}/cycles")

    assert response.status_code == 200
    item = response.json()["cycles"][0]["experiments"][0]["content_items"][0]
    assert item["asset_url"] == "/api/files/output/task-123/final.mp4"
    assert item["asset_media_type"] == "video"
    assert item["asset_preview_available"] is True
    assert client.get(item["asset_url"]).status_code == 200


def test_ops_api_returns_404_for_missing_experiment(tmp_path, monkeypatch):
    monkeypatch.setenv("PIXELLE_OPS_DB_PATH", str(tmp_path / "ops.db"))

    client = TestClient(app)
    response = client.get("/api/ops/experiments/missing")

    assert response.status_code == 404
    assert response.json()["detail"]["error"]["code"] == "experiment_not_found"
    assert "Traceback" not in response.json()["detail"]["error"]["message"]
