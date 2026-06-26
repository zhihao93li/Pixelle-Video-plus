"""Smoke-test P2 cheat workspace summary and controlled writeback flow."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any


def _source(workspace: Path | None = None, source_file: str | None = None) -> dict[str, Any]:
    source: dict[str, Any] = {
        "kind": "codex",
        "skill": "cheat-on-content",
        "confirmed_by_user": True,
    }
    if workspace and source_file:
        source["workspace_path"] = str(workspace)
        source["source_file"] = source_file
    return source


def _make_cheat_workspace(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    (path / "predictions").mkdir()
    (path / ".cheat-state.json").write_text(
        json.dumps(
            {
                "state_schema_version": "p2-smoke",
                "skill_version": "p2-smoke",
                "rubric_version": "rubric-smoke",
                "confidence": "medium",
                "calibration_samples": 12,
                "buffer": {"count": 2, "status": "healthy"},
                "pending_retros": ["retro-a"],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (path / "candidates.md").write_text("- Topic A\n- Topic B\n", encoding="utf-8")
    (path / "benchmark.md").write_text("# benchmark\n", encoding="utf-8")
    (path / "audience.md").write_text("# audience\n", encoding="utf-8")
    (path / "rubric-memo.md").write_text("# rubric memo\n", encoding="utf-8")


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def run_smoke(db_path: Path) -> dict[str, Any]:
    os.environ["PIXELLE_OPS_DB_PATH"] = str(db_path)

    from fastapi.testclient import TestClient

    from api.app import app
    from ops.service import OpsError, OpsService
    from ops.store import OpsStore

    workspace = db_path.parent / "cheat-workspace"
    _make_cheat_workspace(workspace)
    prediction_file = workspace / "predictions" / "prediction.md"
    prediction_file.write_text("primary_metric: save_rate\nexpected: above_baseline\n", encoding="utf-8")

    store = OpsStore(db_path)
    store.init_db()
    service = OpsService(store)
    project = service.create_project(
        name="PetWoods P2 Smoke",
        product="PetWoods",
        channel="xiaohongshu",
        source=_source(),
    )
    service.create_channel_account(
        project_id=project["id"],
        platform="xiaohongshu",
        account_name="PetWoods 小红书",
        source={"kind": "ui", "surface": "p2_smoke", "confirmed_by_user": True},
    )
    cycle = service.create_cycle(
        project_id=project["id"],
        name="P2 controlled writeback",
        goal="Verify cheat summary, source hash, and writeback apply.",
        source=_source(),
    )
    experiment_draft = service.submit_writeback_draft(
        operation="create_content_experiment",
        target={"project_id": project["id"], "cycle_id": cycle["id"]},
        payload={
            "title": "同一窝小猫，可能不是一个爹吗？",
            "hypothesis": "遗传猎奇题适合承接配种系列。",
        },
        source=_source(),
    )
    service.validate_writeback_draft(experiment_draft["draft"]["id"])
    experiment_apply = service.apply_writeback_draft(experiment_draft["draft"]["id"], source=_source())
    experiment = experiment_apply["applied_result"]["entity"]

    bound = service.set_project_cheat_workspace(
        project_id=project["id"],
        workspace_path=str(workspace),
        source={"kind": "ui", "surface": "p2_smoke", "confirmed_by_user": True},
    )
    draft = service.submit_writeback_draft(
        operation="lock_content_prediction",
        target={"experiment_id": experiment["id"]},
        payload={"prediction": {"primary_metric": "save_rate", "expected_bucket": "above_baseline"}},
        source=_source(workspace, "predictions/prediction.md"),
    )
    validated = service.validate_writeback_draft(draft["draft"]["id"])
    prediction_file.write_text("primary_metric: comment_rate\n", encoding="utf-8")
    try:
        service.apply_writeback_draft(draft["draft"]["id"], source=_source())
    except OpsError as exc:
        _assert(exc.code == "source_hash_changed", "changed source must block apply")
    else:
        raise AssertionError("changed source should have blocked apply")

    prediction_file.write_text("primary_metric: save_rate\nexpected: above_baseline\n", encoding="utf-8")
    fresh_draft = service.submit_writeback_draft(
        operation="lock_content_prediction",
        target={"experiment_id": experiment["id"]},
        payload={"prediction": {"primary_metric": "save_rate", "expected_bucket": "above_baseline"}},
        source=_source(workspace, "predictions/prediction.md"),
    )
    service.validate_writeback_draft(fresh_draft["draft"]["id"])
    applied = service.apply_writeback_draft(fresh_draft["draft"]["id"], source=_source())

    generation_draft = service.submit_generation_draft(
        experiment_id=experiment["id"],
        text="同一窝小猫，可能不是一个爹吗？\n还真不一定。",
        pipeline="standard",
        source=_source(),
    )
    approval = service.approve_generation_draft(
        experiment_id=experiment["id"],
        draft_id=generation_draft["event"]["id"],
        source=_source(),
    )
    content_item = store.create_content_item(
        project_id=project["id"],
        cycle_id=cycle["id"],
        experiment_id=experiment["id"],
        kind="video",
        title=experiment["title"],
        status="generated",
        asset_ref={"path": str(db_path.parent / "final.mp4"), "duration": 42.0},
    )
    store.append_event(
        project_id=project["id"],
        cycle_id=cycle["id"],
        experiment_id=experiment["id"],
        content_item_id=content_item["id"],
        event_type="generation_requested",
        payload={
            "draft_id": approval["event"]["id"],
            "text": "同一窝小猫，可能不是一个爹吗？\n还真不一定。",
            "pipeline": "standard",
        },
        source=_source(),
    )
    store.append_event(
        project_id=project["id"],
        cycle_id=cycle["id"],
        experiment_id=experiment["id"],
        content_item_id=content_item["id"],
        event_type="generation_completed",
        payload={"asset_ref": content_item["asset_ref"]},
        source=_source(),
    )
    store.append_event(
        project_id=project["id"],
        cycle_id=cycle["id"],
        experiment_id=experiment["id"],
        content_item_id=content_item["id"],
        event_type="asset_checked",
        payload={
            "status": "passed",
            "content_item_id": content_item["id"],
            "checks": {
                "generation_completed_event_present": True,
                "asset_reference_present": True,
                "local_file_required": False,
                "draft_text_clean": True,
            },
        },
        source=_source(),
    )
    closeout_operations = [
        (
            "record_publish_evidence",
            {"experiment_id": experiment["id"], "content_item_id": content_item["id"]},
            {"evidence": {"mock": True, "mock_label": "P2 smoke publish"}},
        ),
        (
            "record_metrics_snapshot",
            {"experiment_id": experiment["id"], "content_item_id": content_item["id"]},
            {"metrics": {"mock": True, "mock_label": "P2 smoke metrics", "views": 1000, "saves": 40}},
        ),
        (
            "record_retro_observation",
            {"experiment_id": experiment["id"]},
            {"retro": {"summary": "保存表现符合预期。"}},
        ),
        (
            "write_project_memory_event",
            {"experiment_id": experiment["id"]},
            {"memory": {"learning": "遗传猎奇题可承接配种系列。"}},
        ),
    ]
    for operation, target, payload in closeout_operations:
        step_draft = service.submit_writeback_draft(
            operation=operation,
            target=target,
            payload=payload,
            source=_source(),
        )
        service.validate_writeback_draft(step_draft["draft"]["id"])
        service.apply_writeback_draft(step_draft["draft"]["id"], source=_source())

    client = TestClient(app)
    context = client.get(f"/api/ops/context-export?project_id={project['id']}").json()
    drafts = client.get("/api/ops/writeback-drafts").json()
    current = client.get(f"/api/ops/current?project_id={project['id']}").json()

    _assert(bound["cheat_workspace"]["status"] == "valid", "cheat workspace should bind as valid")
    _assert(experiment_apply["draft"]["status"] == "applied", "experiment writeback draft should apply")
    _assert(experiment["kind"] == "content_experiment", "experiment should be created through writeback")
    _assert(validated["draft"]["source"]["source_hash"].startswith("sha256:"), "draft should store source hash")
    _assert(applied["draft"]["status"] == "applied", "fresh source draft should apply")
    _assert(context["context_export"]["cheat_workspace_summary"]["rubric_version"] == "rubric-smoke", "context export should include cheat summary")
    _assert(any(item["status"] == "validation_failed" for item in drafts["drafts"]), "stale draft should stay visible")
    _assert(current["next_action"]["kind"] == "done", "closed loop should report done")

    return {
        "status": "ok",
        "checks": {
            "cheat_workspace": bound["cheat_workspace"]["status"],
            "created_experiment": experiment["id"],
            "source_hash": validated["draft"]["source"]["source_hash"][:18],
            "stale_draft_visible": any(item["status"] == "validation_failed" for item in drafts["drafts"]),
            "closed_loop": current["next_action"]["kind"],
            "writeback_drafts": len(drafts["drafts"]),
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--db",
        type=Path,
        help="SQLite DB path. Defaults to a temporary isolated database.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.db:
        args.db.parent.mkdir(parents=True, exist_ok=True)
        result = run_smoke(args.db)
    else:
        with TemporaryDirectory(prefix="pixelle-p2-cheat-") as tmp_dir:
            result = run_smoke(Path(tmp_dir) / "ops.db")
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
