import pytest

from ops.service import OpsError, OpsService
from ops.store import OpsStore


def _source():
    return {"kind": "codex", "confirmed_by_user": True, "skill": "cheat-on-content"}


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
