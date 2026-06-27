"""Smoke-test the P2 cheat-to-generation main path with disposable local state.

This validates the operator path without calling real generation providers:
recommend/confirm topic -> create experiment through writeback -> lock prediction
-> submit/approve generation draft -> request generation -> asset check.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

APPROVED_TEXT = "同一窝小猫，可能不是一个爹吗？\n还真不一定。\n但靠肉眼，不能判亲缘。"


def _source() -> dict[str, Any]:
    return {"kind": "codex", "skill": "cheat-on-content", "confirmed_by_user": True}


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


async def _fake_generation_runner(**kwargs: Any) -> dict[str, Any]:
    output_dir = Path(os.environ["PIXELLE_P2_MAIN_PATH_OUTPUT"])
    output_dir.mkdir(parents=True, exist_ok=True)
    video_path = output_dir / "final.mp4"
    storyboard_path = output_dir / "storyboard.json"
    video_path.write_bytes(b"fake mp4 bytes")
    storyboard_path.write_text(
        json.dumps(
            {
                "frames": [
                    {"narration": line}
                    for line in str(kwargs["text"]).splitlines()
                    if line.strip()
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return {
        "video_path": str(video_path),
        "duration": 18.0,
        "file_size": video_path.stat().st_size,
        "task_id": "p2-main-path-smoke",
    }


async def run_smoke(db_path: Path) -> dict[str, Any]:
    os.environ["PIXELLE_OPS_DB_PATH"] = str(db_path)
    os.environ["PIXELLE_P2_MAIN_PATH_OUTPUT"] = str(db_path.parent / "output" / "p2-main-path")

    from codex_plugin.server import pixelle_get_capabilities
    from ops.service import OpsService
    from ops.store import OpsStore

    store = OpsStore(db_path)
    store.init_db()
    service = OpsService(store, generation_runner=_fake_generation_runner)

    capabilities = await pixelle_get_capabilities()
    project = service.create_project(
        name="PetWoods P2 Main Path",
        product="PetWoods",
        channel="xiaohongshu",
        source=_source(),
    )
    service.create_channel_account(
        project_id=project["id"],
        platform="xiaohongshu",
        account_name="PetWoods 小红书",
        account_handle="petwoods",
        source={"kind": "ui", "surface": "p2_main_path_smoke", "confirmed_by_user": True},
    )
    cycle = service.create_cycle(
        project_id=project["id"],
        name="P2 cheat main path",
        goal="Validate cheat-created experiment through generated asset check.",
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

    prediction_draft = service.submit_writeback_draft(
        operation="lock_content_prediction",
        target={"experiment_id": experiment["id"]},
        payload={
            "prediction": {
                "topic": experiment["title"],
                "primary_metric": "save_rate",
                "expected_bucket": "above_baseline",
                "rationale": "承接配种判断系列，评论区容易追问亲缘问题。",
            }
        },
        source=_source(),
    )
    service.validate_writeback_draft(prediction_draft["draft"]["id"])
    service.apply_writeback_draft(prediction_draft["draft"]["id"], source=_source())

    generation_draft = service.submit_generation_draft(
        experiment_id=experiment["id"],
        text=APPROVED_TEXT,
        pipeline="standard",
        generation_params={"duration_seconds": 25},
        source=_source(),
    )
    approval = service.approve_generation_draft(
        experiment_id=experiment["id"],
        draft_id=generation_draft["event"]["id"],
        source=_source(),
    )
    generation = await service.request_generation(
        experiment_id=experiment["id"],
        approved_draft_id=approval["event"]["id"],
        source=_source(),
        wait_for_completion=True,
    )
    content_item = generation["content_item"]
    asset_check = service.check_generation_asset(
        experiment_id=experiment["id"],
        content_item_id=content_item["id"],
        source=_source(),
    )
    current = service.current_view(project_id=project["id"])
    events = store.list_events_for_experiment(experiment["id"])
    generation_request = next(event for event in events if event["event_type"] == "generation_requested")

    _assert("create_content_experiment" in capabilities["p2_capabilities"]["writeback_operations"], "capability must expose create_content_experiment")
    _assert(capabilities["intent_routes"]["content_recommendation"]["confirmed_topic_writeback"]["requires_writeback_draft"] is True, "content recommendation must route through writeback draft")
    _assert(experiment_apply["draft"]["status"] == "applied", "experiment must be created through writeback")
    _assert(generation_request["payload"]["generation_params"]["mode"] == "fixed", "standard generation must preserve approved text with fixed mode")
    _assert(content_item["id"] == current["content_item"]["id"], "current view must select generated content item")
    _assert(asset_check["asset_check"]["status"] == "passed", "asset check must pass")
    _assert(asset_check["asset_check"]["checks"]["storyboard_text_matches_draft"] is True, "storyboard must match approved draft")
    _assert(current["next_action"]["kind"] == "record_publish", "checked asset should advance to publish evidence")

    return {
        "status": "ok",
        "checks": {
            "experiment": experiment["id"],
            "content_item": content_item["id"],
            "next_action": current["next_action"]["kind"],
            "storyboard_text_matches_draft": asset_check["asset_check"]["checks"]["storyboard_text_matches_draft"],
            "writeback_operation_exposed": "create_content_experiment",
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, help="SQLite DB path. Defaults to a temporary isolated database.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.db:
        args.db.parent.mkdir(parents=True, exist_ok=True)
        result = asyncio.run(run_smoke(args.db))
    else:
        with TemporaryDirectory(prefix="pixelle-p2-main-path-") as tmp_dir:
            result = asyncio.run(run_smoke(Path(tmp_dir) / "ops.db"))
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
