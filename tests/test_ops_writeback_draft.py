import pytest

from ops.service import OpsError, OpsService
from ops.store import OpsStore


def _source():
    return {"kind": "codex", "confirmed_by_user": True, "skill": "cheat-on-content"}


def _source_from_file(workspace_path, source_file):
    return {
        **_source(),
        "workspace_path": str(workspace_path),
        "source_file": source_file,
    }


@pytest.fixture
def service(tmp_path):
    store = OpsStore(tmp_path / "ops.db")
    store.init_db()
    return OpsService(store)


def _seed_experiment(service):
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
    return project, cycle, experiment


def _seed_generated_content_item(service, experiment):
    return service.store.create_content_item(
        project_id=experiment["project_id"],
        cycle_id=experiment["cycle_id"],
        experiment_id=experiment["id"],
        kind="video",
        title=experiment["title"],
        status="generated",
        asset_ref={"path": "output/final.mp4", "duration": 45.0},
    )


def test_writeback_draft_validate_and_apply_prediction(service):
    _, _, experiment = _seed_experiment(service)
    draft = service.submit_writeback_draft(
        operation="lock_content_prediction",
        target={"experiment_id": experiment["id"]},
        payload={"prediction": {"primary_metric": "save_rate", "expected": "higher than baseline"}},
        source=_source(),
    )

    assert draft["draft"]["status"] == "draft_created"
    assert service.store.get_experiment(experiment["id"])["stage"] == "draft"

    validated = service.validate_writeback_draft(draft["draft"]["id"])
    applied = service.apply_writeback_draft(draft["draft"]["id"], source=_source())
    events = service.store.list_events_for_experiment(experiment["id"])

    assert validated["draft"]["status"] == "validation_passed"
    assert applied["draft"]["status"] == "applied"
    assert applied["applied_result"]["entity"]["stage"] == "prediction_locked"
    assert events[0]["event_type"] == "prediction_locked"
    assert events[0]["source"]["draft_id"] == draft["draft"]["id"]
    assert service.store.get_experiment(experiment["id"])["stage"] == "prediction_locked"


def test_writeback_draft_can_create_content_experiment(service):
    project, cycle, _ = _seed_experiment(service)
    draft = service.submit_writeback_draft(
        operation="create_content_experiment",
        target={"project_id": project["id"], "cycle_id": cycle["id"]},
        payload={
            "title": "母猫配完还叫，是不是没配上？",
            "hypothesis": "配完后继续叫是当前系列的直接后续问题，适合作为下一条实验。",
        },
        source=_source(),
    )

    validated = service.validate_writeback_draft(draft["draft"]["id"])
    applied = service.apply_writeback_draft(draft["draft"]["id"], source=_source())
    created = applied["applied_result"]["entity"]

    assert validated["draft"]["status"] == "validation_passed"
    assert applied["draft"]["status"] == "applied"
    assert created["kind"] == "content_experiment"
    assert created["title"] == "母猫配完还叫，是不是没配上？"
    assert created["stage"] == "draft"
    assert created["project_id"] == project["id"]
    assert created["cycle_id"] == cycle["id"]
    assert applied["next_action"] == {"kind": "lock_prediction", "blocked": False}


def test_writeback_draft_create_content_experiment_requires_valid_target(service):
    project, _, _ = _seed_experiment(service)
    draft = service.submit_writeback_draft(
        operation="create_content_experiment",
        target={"project_id": project["id"], "cycle_id": "missing_cycle"},
        payload={
            "title": "母猫配完还叫，是不是没配上？",
            "hypothesis": "配完后继续叫是当前系列的直接后续问题。",
        },
        source=_source(),
    )

    validated = service.validate_writeback_draft(draft["draft"]["id"])

    assert validated["draft"]["status"] == "validation_failed"
    assert validated["draft"]["validation_result"]["error"]["code"] == "cycle_not_found"
    with pytest.raises(OpsError, match="writeback_draft_not_validated"):
        service.apply_writeback_draft(draft["draft"]["id"], source=_source())


def test_writeback_draft_tracks_and_revalidates_source_hash(service, tmp_path):
    _, _, experiment = _seed_experiment(service)
    workspace = tmp_path / "cheat"
    prediction_dir = workspace / "predictions"
    prediction_dir.mkdir(parents=True)
    source_file = prediction_dir / "prediction.md"
    source_file.write_text("primary metric: save_rate\n", encoding="utf-8")

    draft = service.submit_writeback_draft(
        operation="lock_content_prediction",
        target={"experiment_id": experiment["id"]},
        payload={"prediction": {"primary_metric": "save_rate", "expected": "higher than baseline"}},
        source=_source_from_file(workspace, "predictions/prediction.md"),
    )

    assert draft["draft"]["source"]["source_hash"].startswith("sha256:")
    assert draft["draft"]["source"]["source_mtime"] > 0

    validated = service.validate_writeback_draft(draft["draft"]["id"])
    source_file.write_text("primary metric: comment_rate\n", encoding="utf-8")

    assert validated["draft"]["status"] == "validation_passed"
    with pytest.raises(OpsError, match="source_hash_changed"):
        service.apply_writeback_draft(draft["draft"]["id"], source=_source())

    stale_draft = service.store.get_writeback_draft(draft["draft"]["id"])
    assert stale_draft["status"] == "validation_failed"
    assert stale_draft["validation_result"]["error"]["code"] == "source_hash_changed"


def test_writeback_draft_validation_reports_missing_source_file(service, tmp_path):
    _, _, experiment = _seed_experiment(service)
    workspace = tmp_path / "cheat"
    workspace.mkdir()

    draft = service.submit_writeback_draft(
        operation="lock_content_prediction",
        target={"experiment_id": experiment["id"]},
        payload={"prediction": {"primary_metric": "save_rate"}},
        source=_source_from_file(workspace, "predictions/missing.md"),
    )

    validated = service.validate_writeback_draft(draft["draft"]["id"])

    assert validated["draft"]["status"] == "validation_failed"
    assert validated["draft"]["source"]["source_status"] == "source_missing"
    assert validated["draft"]["validation_result"]["error"]["code"] == "source_missing"


def test_writeback_draft_failed_validation_does_not_apply(service):
    _, _, experiment = _seed_experiment(service)
    service.lock_prediction(
        experiment_id=experiment["id"],
        prediction={"primary_metric": "save_rate"},
        source=_source(),
    )
    item = service.store.create_content_item(
        project_id=experiment["project_id"],
        cycle_id=experiment["cycle_id"],
        experiment_id=experiment["id"],
        kind="video",
        title=experiment["title"],
        status="generated",
        asset_ref={"path": "output/final.mp4"},
    )
    service.store.append_event(
        project_id=experiment["project_id"],
        cycle_id=experiment["cycle_id"],
        experiment_id=experiment["id"],
        content_item_id=item["id"],
        event_type="publish_recorded",
        payload={"evidence": {"mock": True, "mock_label": "test"}},
        source=_source(),
    )
    draft = service.submit_writeback_draft(
        operation="lock_content_prediction",
        target={"experiment_id": experiment["id"]},
        payload={"prediction": {"primary_metric": "comment_rate"}},
        source=_source(),
    )

    validated = service.validate_writeback_draft(draft["draft"]["id"])

    assert validated["draft"]["status"] == "validation_failed"
    assert validated["draft"]["validation_result"]["error"]["code"] == "prediction_window_closed"
    with pytest.raises(OpsError, match="writeback_draft_not_validated"):
        service.apply_writeback_draft(draft["draft"]["id"], source=_source())


def test_writeback_draft_apply_publish_metrics_retro_and_memory(service):
    _, _, experiment = _seed_experiment(service)
    service.lock_prediction(
        experiment_id=experiment["id"],
        prediction={"primary_metric": "save_rate", "expected": "higher than baseline"},
        source=_source(),
    )
    content_item = _seed_generated_content_item(service, experiment)
    publish_draft = service.submit_writeback_draft(
        operation="record_publish_evidence",
        target={
            "experiment_id": experiment["id"],
            "content_item_id": content_item["id"],
        },
        payload={"evidence": {"mock": True, "mock_label": "P2 dry-run publish"}},
        source=_source(),
    )

    service.validate_writeback_draft(publish_draft["draft"]["id"])
    publish_result = service.apply_writeback_draft(publish_draft["draft"]["id"], source=_source())

    assert publish_result["applied_result"]["event"]["event_type"] == "publish_recorded"
    assert service.store.get_experiment(experiment["id"])["stage"] == "published"

    metrics_draft = service.submit_writeback_draft(
        operation="record_metrics_snapshot",
        target={
            "experiment_id": experiment["id"],
            "content_item_id": content_item["id"],
        },
        payload={
            "metrics": {
                "mock": True,
                "mock_label": "P2 dry-run 72h metrics",
                "views": 1000,
                "likes": 88,
                "saves": 42,
                "save_rate": 0.042,
            }
        },
        source=_source(),
    )

    service.validate_writeback_draft(metrics_draft["draft"]["id"])
    metrics_result = service.apply_writeback_draft(metrics_draft["draft"]["id"], source=_source())

    assert metrics_result["applied_result"]["event"]["event_type"] == "metrics_recorded"
    assert service.store.get_experiment(experiment["id"])["stage"] == "metrics_recorded"

    retro_draft = service.submit_writeback_draft(
        operation="record_retro_observation",
        target={"experiment_id": experiment["id"]},
        payload={"retro": {"summary": "保存率高于预期，评论集中在亲缘判断。"}},
        source=_source(),
    )

    service.validate_writeback_draft(retro_draft["draft"]["id"])
    retro_result = service.apply_writeback_draft(retro_draft["draft"]["id"], source=_source())

    assert retro_result["applied_result"]["event"]["event_type"] == "retro_written"
    assert service.store.get_experiment(experiment["id"])["stage"] == "retro_written"

    memory_draft = service.submit_writeback_draft(
        operation="write_project_memory_event",
        target={"experiment_id": experiment["id"]},
        payload={"memory": {"learning": "亲缘判断题适合作为配种系列第三条。"}},
        source=_source(),
    )

    service.validate_writeback_draft(memory_draft["draft"]["id"])
    memory_result = service.apply_writeback_draft(memory_draft["draft"]["id"], source=_source())
    events = service.store.list_events_for_experiment(experiment["id"])

    assert memory_result["applied_result"]["event"]["event_type"] == "memory_written"
    assert [event["event_type"] for event in events[-4:]] == [
        "publish_recorded",
        "metrics_recorded",
        "retro_written",
        "memory_written",
    ]
    assert events[-1]["source"]["draft_id"] == memory_draft["draft"]["id"]


def test_writeback_draft_metrics_requires_published_content(service):
    _, _, experiment = _seed_experiment(service)
    service.lock_prediction(
        experiment_id=experiment["id"],
        prediction={"primary_metric": "save_rate"},
        source=_source(),
    )
    content_item = _seed_generated_content_item(service, experiment)
    draft = service.submit_writeback_draft(
        operation="record_metrics_snapshot",
        target={
            "experiment_id": experiment["id"],
            "content_item_id": content_item["id"],
        },
        payload={"metrics": {"mock": True, "mock_label": "no publish yet"}},
        source=_source(),
    )

    validated = service.validate_writeback_draft(draft["draft"]["id"])

    assert validated["draft"]["status"] == "validation_failed"
    assert validated["draft"]["validation_result"]["error"]["code"] == "publish_required"


def test_writeback_draft_retro_and_memory_require_prior_evidence(service):
    _, _, experiment = _seed_experiment(service)
    retro_draft = service.submit_writeback_draft(
        operation="record_retro_observation",
        target={"experiment_id": experiment["id"]},
        payload={"retro": {"summary": "没有指标不能复盘。"}},
        source=_source(),
    )
    memory_draft = service.submit_writeback_draft(
        operation="write_project_memory_event",
        target={"experiment_id": experiment["id"]},
        payload={"memory": {"learning": "没有复盘不能写入记忆。"}},
        source=_source(),
    )

    retro_validated = service.validate_writeback_draft(retro_draft["draft"]["id"])
    memory_validated = service.validate_writeback_draft(memory_draft["draft"]["id"])

    assert retro_validated["draft"]["validation_result"]["error"]["code"] == "metrics_required"
    assert memory_validated["draft"]["validation_result"]["error"]["code"] == "retro_required"


def test_writeback_draft_generation_text_validation_reuses_existing_rules(service):
    _, _, experiment = _seed_experiment(service)
    service.lock_prediction(
        experiment_id=experiment["id"],
        prediction={"primary_metric": "save_rate"},
        source=_source(),
    )
    draft = service.submit_writeback_draft(
        operation="submit_generation_draft",
        target={"experiment_id": experiment["id"]},
        payload={
            "text": "【视频目标】生成短视频。\n【屏幕字幕版】\n母猫打滚就是想配了吗？",
            "pipeline": "standard",
        },
        source=_source(),
    )

    validated = service.validate_writeback_draft(draft["draft"]["id"])

    assert validated["draft"]["status"] == "validation_failed"
    assert validated["draft"]["validation_result"]["error"]["code"] == "generation_draft_invalid"


def test_writeback_draft_apply_generation_draft(service):
    _, _, experiment = _seed_experiment(service)
    service.lock_prediction(
        experiment_id=experiment["id"],
        prediction={"primary_metric": "save_rate"},
        source=_source(),
    )
    draft = service.submit_writeback_draft(
        operation="submit_generation_draft",
        target={"experiment_id": experiment["id"]},
        payload={"text": "母猫打滚就是想配了吗？\n还真不是。", "pipeline": "standard"},
        source=_source(),
    )

    service.validate_writeback_draft(draft["draft"]["id"])
    applied = service.apply_writeback_draft(draft["draft"]["id"], source=_source())
    events = service.store.list_events_for_experiment(experiment["id"])

    assert applied["draft"]["status"] == "applied"
    assert applied["applied_result"]["entity"]["stage"] == "generation_drafted"
    assert events[-1]["event_type"] == "generation_drafted"
    assert events[-1]["payload"]["text"] == "母猫打滚就是想配了吗？\n还真不是。"


def test_writeback_draft_can_be_rejected_without_changing_ops_state(service):
    _, _, experiment = _seed_experiment(service)
    draft = service.submit_writeback_draft(
        operation="lock_content_prediction",
        target={"experiment_id": experiment["id"]},
        payload={"prediction": {"primary_metric": "save_rate"}},
        source=_source(),
    )

    rejected = service.reject_writeback_draft(
        draft["draft"]["id"],
        reason="用户决定不采用这版预测",
        source=_source(),
    )

    assert rejected["draft"]["status"] == "rejected"
    assert rejected["draft"]["validation_result"]["rejection_reason"] == "用户决定不采用这版预测"
    assert service.store.get_experiment(experiment["id"])["stage"] == "draft"
    with pytest.raises(OpsError, match="writeback_draft_not_validated"):
        service.apply_writeback_draft(draft["draft"]["id"], source=_source())
