import json

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


def _seed_project(service):
    return service.create_project(
        name="PetWoods",
        product="PetWoods",
        channel="xiaohongshu",
        source=_source(),
    )


def _make_cheat_workspace(path):
    path.mkdir()
    (path / ".cheat-state.json").write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "skill_version": "2026.06",
                "content_form": "xiaohongshu_short_video",
                "rubric_version": "rubric-v3",
                "calibration_samples": 12,
                "confidence": "medium",
                "buffer": {"count": 3, "status": "green"},
                "pending_retros": ["video-a"],
                "latest_published_at": "2026-06-20T12:00:00Z",
                "latest_retro_at": "2026-06-22T12:00:00Z",
                "latest_bump_at": "2026-06-23T12:00:00Z",
                "secret": "must-not-leak",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (path / "candidates.md").write_text(
        "- 母猫打滚就是想配了吗？\n- 同一窝小猫，可能不是一个爹吗？\n",
        encoding="utf-8",
    )
    (path / "audience.md").write_text("核心受众：新手铲屎官", encoding="utf-8")
    (path / "rubric-memo.md").write_text("最近校准：收藏率更重要", encoding="utf-8")
    (path / "benchmark.md").write_text("对标：猫咪繁育账号", encoding="utf-8")
    (path / "predictions").mkdir()
    (path / "predictions" / "prediction-1.md").write_text("prediction", encoding="utf-8")
    (path / "scripts").mkdir()
    (path / "scripts" / "script-1.md").write_text("script", encoding="utf-8")


def test_service_binds_valid_cheat_workspace_and_returns_safe_summary(service, tmp_path):
    project = _seed_project(service)
    workspace = tmp_path / "cheat-workspace"
    _make_cheat_workspace(workspace)

    result = service.set_project_cheat_workspace(
        project_id=project["id"],
        workspace_path=str(workspace),
        source=_source(),
    )
    summary = service.get_cheat_workspace_summary(project["id"])

    assert result["status"] == "ok"
    assert result["cheat_workspace"]["status"] == "valid"
    assert result["cheat_workspace"]["workspace_path"] == str(workspace)
    assert summary["status"] == "ok"
    assert summary["cheat_workspace"]["status"] == "valid"
    assert summary["summary"]["rubric_version"] == "rubric-v3"
    assert summary["summary"]["confidence"] == "medium"
    assert summary["summary"]["candidate_count"] == 2
    assert summary["summary"]["prediction_count"] == 1
    assert summary["summary"]["buffer_count"] == 3
    assert summary["summary"]["pending_retro_count"] == 1
    assert summary["summary"]["audience_status"] == "present"
    assert summary["summary"]["rubric_memo_status"] == "present"
    assert "must-not-leak" not in json.dumps(summary, ensure_ascii=False)


def test_service_rejects_remote_cheat_workspace_path(service):
    project = _seed_project(service)

    with pytest.raises(OpsError, match="cheat_workspace_path_must_be_local"):
        service.set_project_cheat_workspace(
            project_id=project["id"],
            workspace_path="https://example.com/cheat-workspace",
            source=_source(),
        )


def test_service_records_missing_cheat_workspace_without_mutating_project_flow(service, tmp_path):
    project = _seed_project(service)
    missing = tmp_path / "missing-cheat-workspace"

    result = service.set_project_cheat_workspace(
        project_id=project["id"],
        workspace_path=str(missing),
        source=_source(),
    )
    current = service.current_view(project_id=project["id"])

    assert result["cheat_workspace"]["status"] == "missing"
    assert result["summary"]["health_issues"][0]["code"] == "workspace_missing"
    assert current["next_action"]["kind"] == "create_cycle"


def test_service_summary_read_does_not_update_persisted_binding_status(service, tmp_path):
    project = _seed_project(service)
    workspace = tmp_path / "cheat-workspace"
    _make_cheat_workspace(workspace)
    service.set_project_cheat_workspace(
        project_id=project["id"],
        workspace_path=str(workspace),
        source=_source(),
    )
    for child in workspace.iterdir():
        if child.is_file():
            child.unlink()
        elif child.is_dir():
            for grandchild in child.iterdir():
                grandchild.unlink()
            child.rmdir()
    workspace.rmdir()

    summary = service.get_cheat_workspace_summary(project["id"])
    persisted = service.store.get_project_cheat_workspace(project["id"])

    assert summary["cheat_workspace"]["status"] == "missing"
    assert persisted["status"] == "valid"


def test_service_context_export_combines_ops_state_and_cheat_summary(service, tmp_path):
    project = _seed_project(service)
    account = service.create_channel_account(
        project_id=project["id"],
        platform="xiaohongshu",
        account_name="PetWoods XHS",
        source=_source(),
    )
    cycle = service.create_cycle(
        project_id=project["id"],
        name="R1",
        goal="Validate cat breeding topics",
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
    workspace = tmp_path / "cheat-workspace"
    _make_cheat_workspace(workspace)
    service.set_project_cheat_workspace(
        project_id=project["id"],
        workspace_path=str(workspace),
        source=_source(),
    )

    exported = service.get_context_export(project_id=project["id"])

    assert exported["status"] == "ok"
    context = exported["context_export"]
    assert context["project"]["id"] == project["id"]
    assert context["channel_account"]["id"] == account["id"]
    assert context["current_cycle"]["id"] == cycle["id"]
    assert context["current_experiment"]["id"] == experiment["id"]
    assert context["next_action"]["kind"] == "submit_generation_draft"
    assert context["recent_ops_events"][0]["event_type"] == "prediction_locked"
    assert context["cheat_workspace_summary"]["rubric_version"] == "rubric-v3"
    assert context["sync_status"]["cheat_workspace"] == "valid"
    assert service.store.get_experiment(experiment["id"])["stage"] == "prediction_locked"
