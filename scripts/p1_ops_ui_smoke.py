"""Smoke-test the P1-A Ops UI data contract with disposable local state."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any


def _source(kind: str = "codex") -> dict[str, Any]:
    return {
        "kind": kind,
        "skill": "p1-ops-ui-smoke" if kind == "codex" else None,
        "surface": "p1_ops_ui_smoke" if kind == "ui" else None,
        "confirmed_by_user": True,
    }


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def run_smoke(db_path: Path) -> dict[str, Any]:
    os.environ["PIXELLE_OPS_DB_PATH"] = str(db_path)

    from fastapi.testclient import TestClient

    from api.app import app
    from ops.service import OpsService
    from ops.store import OpsStore

    store = OpsStore(db_path)
    store.init_db()
    service = OpsService(store)

    empty_project = service.create_project(
        name="No Account Project",
        product="NoAccount",
        channel="xiaohongshu",
        source=_source(),
    )
    multi_project = service.create_project(
        name="Multi Account Project",
        product="MultiAccount",
        channel="xiaohongshu",
        source=_source(),
    )
    first_account = service.create_channel_account(
        project_id=multi_project["id"],
        platform="xiaohongshu",
        account_name="XHS Main",
        source=_source("ui"),
    )
    second_account = service.create_channel_account(
        project_id=multi_project["id"],
        platform="douyin",
        account_name="Douyin Mirror",
        source=_source("ui"),
    )
    no_cycle_project = service.create_project(
        name="No Cycle Project",
        product="NoCycle",
        channel="youtube",
        source=_source(),
    )
    no_experiment_cycle = service.create_cycle(
        project_id=multi_project["id"],
        name="No Experiment Cycle",
        goal="Verify empty experiment state.",
        source=_source(),
    )
    cycle = service.create_cycle(
        project_id=multi_project["id"],
        name="P1-A Edge Cycle",
        goal="Verify Ops UI edge states.",
        source=_source(),
    )
    experiment = service.create_experiment(
        project_id=multi_project["id"],
        cycle_id=cycle["id"],
        title="Generated but unchecked",
        hypothesis="Generated content still needs asset check before publish.",
        source=_source(),
    )
    service.lock_prediction(
        experiment_id=experiment["id"],
        prediction={"topic": "Generated but unchecked", "primary_metric": "save_rate"},
        source=_source(),
    )
    draft = service.submit_generation_draft(
        experiment_id=experiment["id"],
        text="Final subtitles only.",
        pipeline="standard",
        source=_source(),
    )
    approval = service.approve_generation_draft(
        experiment_id=experiment["id"],
        draft_id=draft["event"]["id"],
        source=_source(),
    )
    output_path = Path.cwd() / "output" / "_p1_ui_smoke" / "final.mp4"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(b"mp4")
    content_item = store.create_content_item(
        project_id=multi_project["id"],
        cycle_id=cycle["id"],
        experiment_id=experiment["id"],
        kind="video",
        title=experiment["title"],
        status="generated",
        asset_ref={"video_path": str(output_path), "duration": 35.0, "file_size": output_path.stat().st_size},
    )
    store.append_event(
        project_id=multi_project["id"],
        cycle_id=cycle["id"],
        experiment_id=experiment["id"],
        content_item_id=content_item["id"],
        event_type="generation_completed",
        payload={"asset_ref": content_item["asset_ref"]},
        source=_source(),
    )
    published_cycle = service.create_cycle(
        project_id=multi_project["id"],
        name="Mock Closeout Cycle",
        goal="Verify mock labels.",
        source=_source(),
    )
    published_experiment = service.create_experiment(
        project_id=multi_project["id"],
        cycle_id=published_cycle["id"],
        title="Mock-published content",
        hypothesis="Mock evidence must not look real.",
        source=_source(),
    )
    published_item = store.create_content_item(
        project_id=multi_project["id"],
        cycle_id=published_cycle["id"],
        experiment_id=published_experiment["id"],
        kind="video",
        title=published_experiment["title"],
        status="generated",
        asset_ref={"video_path": str(output_path), "duration": 35.0, "file_size": output_path.stat().st_size},
    )
    store.append_event(
        project_id=multi_project["id"],
        cycle_id=published_cycle["id"],
        experiment_id=published_experiment["id"],
        content_item_id=published_item["id"],
        event_type="asset_checked",
        payload={"status": "passed", "checks": {"local_file_exists": True, "draft_text_clean": True}},
        source=_source(),
    )
    store.append_event(
        project_id=multi_project["id"],
        cycle_id=published_cycle["id"],
        experiment_id=published_experiment["id"],
        content_item_id=published_item["id"],
        event_type="publish_recorded",
        payload={
            "evidence": {
                "mock": True,
                "mock_label": "P1-A smoke mock publish",
                "platform": "xiaohongshu",
                "note": "No real publish.",
            }
        },
        source=_source(),
    )

    client = TestClient(app)
    projects = client.get("/api/ops/projects").json()
    current_ambiguous = client.get("/api/ops/current").json()
    current_multi_account = client.get(f"/api/ops/current?project_id={multi_project['id']}").json()
    cycles_empty = client.get(f"/api/ops/projects/{no_cycle_project['id']}/cycles").json()
    cycles_multi = client.get(f"/api/ops/projects/{multi_project['id']}/cycles").json()
    account_update = client.patch(
        f"/api/ops/channel-accounts/{first_account['id']}",
        json={
            "platform": "xiaohongshu",
            "account_name": "XHS Main Edited",
            "account_handle": "xhs_main_edited",
            "external_account_id": "xhs-main-edited",
            "status": "connected",
            "credential_ref": {"provider": "manual", "key": "pixelle/smoke/xhs"},
            "buffer_channel_id": "buffer-smoke-xhs",
        },
    ).json()
    projects_after_update = client.get("/api/ops/projects").json()
    integrations = client.get("/api/ops/integrations").json()

    _assert(projects["status"] == "ok", "projects endpoint failed")
    _assert(len(projects["projects"]) == 3, "expected seeded projects")
    _assert(current_ambiguous["next_action"]["kind"] == "select_project", "multiple projects must require project selection")
    _assert(
        current_multi_account["next_action"]["kind"] == "select_channel_account",
        "multiple accounts must require account selection",
    )
    _assert(cycles_empty["next_action"]["kind"] == "create_cycle", "project without cycles must ask for cycle creation")
    no_experiment_view = next(view for view in cycles_multi["cycles"] if view["cycle"]["id"] == no_experiment_cycle["id"])
    _assert(no_experiment_view["next_action"]["kind"] == "create_experiment", "cycle without experiments must ask for experiment creation")
    generated_view = next(
        view
        for cycle_view in cycles_multi["cycles"]
        for view in cycle_view["experiments"]
        if view["experiment"]["id"] == experiment["id"]
    )
    _assert(generated_view["next_action"]["kind"] == "check_generation_asset", "unchecked generated item must require asset check")
    _assert(generated_view["content_items"][0]["asset_preview_available"] is True, "local output video should be previewable")
    mock_view = next(
        view
        for cycle_view in cycles_multi["cycles"]
        for view in cycle_view["experiments"]
        if view["experiment"]["id"] == published_experiment["id"]
    )
    publish_event = next(event for event in mock_view["events"] if event["event_type"] == "publish_recorded")
    _assert(publish_event["payload"]["evidence"]["mock"] is True, "mock publish must stay marked mock")
    _assert(publish_event["payload"]["evidence"]["mock_label"], "mock publish must have a mock label")
    _assert(first_account["id"] != second_account["id"], "seeded accounts should be distinct")
    _assert(approval["next_action"]["kind"] == "request_generation", "approved draft should lead to generation")
    _assert(empty_project["id"], "empty-account project should exist")
    _assert(account_update["channel_account"]["account_name"] == "XHS Main Edited", "account update should return edited account")
    updated_accounts = next(project for project in projects_after_update["projects"] if project["id"] == multi_project["id"])[
        "channel_accounts"
    ]
    _assert(
        any(account["account_name"] == "XHS Main Edited" for account in updated_accounts),
        "projects endpoint should reflect account update",
    )
    _assert(integrations["status"] == "ok", "integrations endpoint failed")
    _assert(integrations["capabilities"]["returns_plaintext_secrets"] is False, "integrations must redact secrets")
    _assert(
        {integration["id"] for integration in integrations["integrations"]}
        >= {"llm", "runninghub", "comfyui", "fish_audio", "cos", "buffer"},
        "integrations endpoint should expose expected global services",
    )

    result = {
        "status": "ok",
        "checks": {
            "multiple_projects": current_ambiguous["next_action"]["kind"],
            "multiple_accounts": current_multi_account["next_action"]["kind"],
            "no_cycles": cycles_empty["next_action"]["kind"],
            "no_experiments": no_experiment_view["next_action"]["kind"],
            "unchecked_asset": generated_view["next_action"]["kind"],
            "mock_publish": publish_event["payload"]["evidence"]["mock_label"],
            "account_update": account_update["channel_account"]["status"],
            "integrations": len(integrations["integrations"]),
        },
    }
    output_path.unlink(missing_ok=True)
    try:
        output_path.parent.rmdir()
    except OSError:
        pass
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db-path", type=Path, default=None, help="Optional disposable SQLite path.")
    args = parser.parse_args()
    if args.db_path:
        result = run_smoke(args.db_path)
    else:
        with TemporaryDirectory(prefix="pixelle-p1-ops-ui-") as tmpdir:
            result = run_smoke(Path(tmpdir) / "ops.db")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
