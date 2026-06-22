"""Run a local Pixelle Ops P0 smoke loop through the MCP tool surface."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from fastmcp import Client

from codex_plugin import server
from ops.service import OpsService
from ops.store import OpsStore


def _source() -> dict[str, Any]:
    return {
        "kind": "codex",
        "skill": "cheat-on-content",
        "confirmed_by_user": True,
    }


async def _fake_generation_runner(**kwargs: Any) -> dict[str, Any]:
    output_path = Path(os.environ["PIXELLE_OPS_DB_PATH"]).with_name("p0-codex-smoke.mp4")
    output_path.write_bytes(b"fake video bytes")
    return {
        "path": str(output_path),
        "file_size": output_path.stat().st_size,
        "media_type": "video",
        "task_id": "p0-codex-smoke",
    }


async def run_smoke(db_path: Path) -> dict[str, Any]:
    store = OpsStore(db_path)
    store.init_db()
    service = OpsService(
        store,
        generation_runner=_fake_generation_runner,
        available_pipelines=("standard", "custom", "asset_based"),
    )
    server._build_service = lambda: service

    async with Client(server.mcp) as client:
        capabilities = await client.call_tool("pixelle_get_capabilities", {})
        assert capabilities.data["status"] == "ok"
        assert capabilities.data["plugin"] == "pixelle-ops"
        assert capabilities.data["protocol_version"] == server.PIXELLE_OPS_PROTOCOL_VERSION
        assert capabilities.data["conversation_contract_version"] == server.PIXELLE_OPS_CONVERSATION_CONTRACT_VERSION
        assert capabilities.data["conversation_contract"]["requires_capability_first"] is True
        assert capabilities.data["conversation_gates"]["project_context_gate"] is True
        assert capabilities.data["conversation_gates"]["social_account_context_gate"] is True
        assert capabilities.data["conversation_gates"]["content_shape_gate"] is True
        assert capabilities.data["conversation_gates"]["existing_generation_gate"] is True
        assert (
            capabilities.data["intent_routes"]["project_context_selection"]["required_when_multiple_projects"]
            is True
        )
        assert capabilities.data["intent_routes"]["content_recommendation"]["requires_project_context"] is True
        assert capabilities.data["intent_routes"]["ambiguous_copy_request"]["requires_user_choice"] is True
        assert capabilities.data["intent_routes"]["video_generation"]["requires_draft_approval"] is True
        assert capabilities.data["intent_routes"]["video_generation"]["requires_user_pipeline_choice"] is True
        assert "pixelle_list_projects" in capabilities.data["required_tools"]
        assert "pixelle_create_social_account" in capabilities.data["required_tools"]
        assert "pixelle_submit_generation_draft" in capabilities.data["required_tools"]
        assert "pixelle_approve_generation_draft" in capabilities.data["required_tools"]

        unconfirmed = await client.call_tool(
            "pixelle_create_project",
            {
                "name": "Rejected project",
                "product": "PetWoods",
                "channel": "xiaohongshu",
                "source": {
                    "kind": "codex",
                    "skill": "cheat-on-content",
                    "confirmed_by_user": False,
                },
            },
        )
        assert unconfirmed.data["status"] == "error"
        assert unconfirmed.data["error"]["code"] == "source_not_confirmed"

        pipelines = await client.call_tool("pixelle_list_generation_pipelines", {})
        assert pipelines.data["pipeline_names"] == ["standard", "custom", "asset_based"]
        assert pipelines.data["default_pipeline"] == "standard"

        project = await client.call_tool(
            "pixelle_create_project",
            {
                "name": "PetWoods P0 Smoke",
                "product": "PetWoods",
                "channel": "xiaohongshu",
                "description": "Disposable P0 Codex smoke project.",
                "source": _source(),
            },
        )
        account = await client.call_tool(
            "pixelle_create_social_account",
            {
                "project_id": project.data["entity"]["id"],
                "platform": "xiaohongshu",
                "account_name": "PetWoods Smoke",
                "account_handle": "@petwoods-smoke",
                "credential_ref": {"provider": "smoke", "key": "petwoods/xhs"},
                "source": _source(),
            },
        )
        assert account.data["entity"]["kind"] == "social_account"
        projects = await client.call_tool("pixelle_list_projects", {})
        assert projects.data["projects"][0]["social_accounts"][0]["id"] == account.data["entity"]["id"]

        cycle = await client.call_tool(
            "pixelle_create_cycle",
            {
                "project_id": project.data["entity"]["id"],
                "name": "P0 validation",
                "goal": "Verify Codex plugin and Pixelle Ops state loop.",
                "source": _source(),
            },
        )
        experiment = await client.call_tool(
            "pixelle_create_experiment",
            {
                "project_id": project.data["entity"]["id"],
                "cycle_id": cycle.data["entity"]["id"],
                "title": "Hook test",
                "hypothesis": "A concrete pain hook should outperform a generic intro.",
                "source": _source(),
            },
        )

        blocked_generation = await client.call_tool(
            "pixelle_request_generation",
            {
                "experiment_id": experiment.data["entity"]["id"],
                "source": _source(),
            },
        )
        assert blocked_generation.data["status"] == "error"
        assert blocked_generation.data["error"]["code"] == "prediction_required"

        await client.call_tool(
            "pixelle_lock_prediction",
            {
                "experiment_id": experiment.data["entity"]["id"],
                "prediction": {
                    "expected_metric": "save_rate",
                    "expected_direction": "above_baseline",
                },
                "source": _source(),
            },
        )
        invalid_draft_text = await client.call_tool(
            "pixelle_submit_generation_draft",
            {
                "experiment_id": experiment.data["entity"]["id"],
                "text": "【视频目标】生成短视频。\n【屏幕字幕版】\nGenerate a short PetWoods validation video.",
                "pipeline": "standard",
                "source": _source(),
            },
        )
        assert invalid_draft_text.data["status"] == "error"
        assert invalid_draft_text.data["error"]["code"] == "generation_draft_invalid"

        unapproved_draft = await client.call_tool(
            "pixelle_submit_generation_draft",
            {
                "experiment_id": experiment.data["entity"]["id"],
                "text": "Generate a short PetWoods validation video.",
                "pipeline": "standard",
                "title": "PetWoods hook validation",
                "source": _source(),
            },
        )
        draft_blocked_generation = await client.call_tool(
            "pixelle_request_generation",
            {
                "experiment_id": experiment.data["entity"]["id"],
                "approved_draft_id": unapproved_draft.data["event"]["id"],
                "source": _source(),
            },
        )
        assert draft_blocked_generation.data["status"] == "error"
        assert draft_blocked_generation.data["error"]["code"] == "approved_draft_required"

        invalid_pipeline_draft = await client.call_tool(
            "pixelle_submit_generation_draft",
            {
                "experiment_id": experiment.data["entity"]["id"],
                "text": "Generate a short PetWoods validation video.",
                "pipeline": "xhs_short_video_v1",
                "source": _source(),
            },
        )
        invalid_pipeline_approval = await client.call_tool(
            "pixelle_approve_generation_draft",
            {
                "experiment_id": experiment.data["entity"]["id"],
                "draft_id": invalid_pipeline_draft.data["event"]["id"],
                "source": _source(),
            },
        )
        unknown_pipeline = await client.call_tool(
            "pixelle_request_generation",
            {
                "experiment_id": experiment.data["entity"]["id"],
                "approved_draft_id": invalid_pipeline_approval.data["event"]["id"],
                "source": _source(),
            },
        )
        assert unknown_pipeline.data["status"] == "error"
        assert unknown_pipeline.data["error"]["code"] == "unknown_generation_pipeline"

        approval = await client.call_tool(
            "pixelle_approve_generation_draft",
            {
                "experiment_id": experiment.data["entity"]["id"],
                "draft_id": unapproved_draft.data["event"]["id"],
                "source": _source(),
            },
        )

        generation = await client.call_tool(
            "pixelle_request_generation",
            {
                "experiment_id": experiment.data["entity"]["id"],
                "approved_draft_id": approval.data["event"]["id"],
                "source": _source(),
            },
        )
        assert generation.data["entity"]["stage"] == "generation_requested"

        generation_status = None
        for _ in range(20):
            generation_status = await client.call_tool(
                "pixelle_get_generation_status",
                {"experiment_id": experiment.data["entity"]["id"]},
            )
            if generation_status.data["status"] == "completed":
                break
            await asyncio.sleep(0.01)
        assert generation_status is not None
        assert generation_status.data["status"] == "completed"

        content_item_id = generation_status.data["content_item"]["id"]
        asset_check = await client.call_tool(
            "pixelle_check_generation_asset",
            {
                "experiment_id": experiment.data["entity"]["id"],
                "content_item_id": content_item_id,
                "source": _source(),
            },
        )
        assert asset_check.data["asset_check"]["status"] == "passed"
        publish = await client.call_tool(
            "pixelle_record_publish",
            {
                "experiment_id": experiment.data["entity"]["id"],
                "content_item_id": content_item_id,
                "evidence": {
                    "platform_url": "https://example.com/petwoods/p0-smoke",
                },
                "source": _source(),
            },
        )
        await client.call_tool(
            "pixelle_record_metrics",
            {
                "experiment_id": experiment.data["entity"]["id"],
                "content_item_id": content_item_id,
                "metrics": {
                    "views": 100,
                    "likes": 8,
                    "saves": 12,
                },
                "source": _source(),
            },
        )
        await client.call_tool(
            "pixelle_write_retro",
            {
                "experiment_id": experiment.data["entity"]["id"],
                "retro": {
                    "summary": "P0 smoke completed through the plugin tool surface.",
                },
                "source": _source(),
            },
        )
        await client.call_tool(
            "pixelle_write_memory",
            {
                "experiment_id": experiment.data["entity"]["id"],
                "memory": {
                    "learning": "Pixelle Ops P0 plugin smoke can complete the state loop.",
                },
                "source": _source(),
            },
        )
        await client.call_tool(
            "pixelle_create_project",
            {
                "name": "Other Brand P0 Smoke",
                "product": "Other Brand",
                "channel": "xiaohongshu",
                "description": "Second project used to verify explicit context selection.",
                "source": _source(),
            },
        )
        ambiguous_current = await client.call_tool("pixelle_get_current", {})
        assert ambiguous_current.data["next_action"]["kind"] == "select_project"
        assert ambiguous_current.data["next_action"]["blocked"] is True
        current = await client.call_tool(
            "pixelle_get_current",
            {"project_id": project.data["entity"]["id"]},
        )

    assert publish.data["next_action"]["kind"] == "record_metrics"
    assert current.data["experiment"]["id"] == experiment.data["entity"]["id"]
    assert current.data["next_action"]["kind"] == "done"

    return {
        "status": "ok",
        "db_path": str(db_path),
        "project_id": project.data["entity"]["id"],
        "cycle_id": cycle.data["entity"]["id"],
        "experiment_id": experiment.data["entity"]["id"],
        "content_item_id": content_item_id,
        "current_next_action": current.data["next_action"],
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
        os.environ["PIXELLE_OPS_DB_PATH"] = str(args.db)
        result = asyncio.run(run_smoke(args.db))
    else:
        with TemporaryDirectory(prefix="pixelle-p0-smoke-") as tmp_dir:
            db_path = Path(tmp_dir) / "ops.db"
            os.environ["PIXELLE_OPS_DB_PATH"] = str(db_path)
            result = asyncio.run(run_smoke(db_path))
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
