"""Smoke-test the Codex natural-language Pixelle Ops entry contract."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sqlite3
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from fastmcp import Client

from codex_plugin import server
from ops.service import OpsService
from ops.store import OpsStore

TRACKED_TABLES = (
    "operating_projects",
    "channel_accounts",
    "operation_cycles",
    "content_experiments",
    "content_items",
    "ops_events",
)


def _source(kind: str = "codex") -> dict[str, Any]:
    return {
        "kind": kind,
        "skill": "p1-codex-direct-entry-smoke" if kind == "codex" else None,
        "surface": "p1_codex_direct_entry_smoke" if kind == "ui" else None,
        "confirmed_by_user": True,
    }


def _table_counts(db_path: Path) -> dict[str, int]:
    with sqlite3.connect(db_path) as conn:
        return {table: conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] for table in TRACKED_TABLES}


def _seed_state(db_path: Path) -> dict[str, Any]:
    store = OpsStore(db_path)
    store.init_db()
    service = OpsService(store)

    petwoods = service.create_project(
        name="PetWoods",
        product="PetWoods",
        channel="xiaohongshu",
        source=_source(),
    )
    xhs_account = service.create_channel_account(
        project_id=petwoods["id"],
        platform="xiaohongshu",
        account_name="PetWoods 小红书",
        account_handle="petwoods",
        source=_source("ui"),
    )
    douyin_account = service.create_channel_account(
        project_id=petwoods["id"],
        platform="douyin",
        account_name="PetWoods 抖音",
        account_handle="petwoods_dy",
        source=_source("ui"),
    )
    pet_cycle = service.create_cycle(
        project_id=petwoods["id"],
        name="PetWoods 当前轮",
        goal="Verify direct Codex entry.",
        source=_source(),
    )
    pet_experiment = service.create_experiment(
        project_id=petwoods["id"],
        cycle_id=pet_cycle["id"],
        title="母猫配完后，多久能看出怀孕？",
        hypothesis="配种判断题承接搜索意图。",
        source=_source(),
    )

    youtube_project = service.create_project(
        name="PetWoods YouTube",
        product="PetWoods",
        channel="youtube",
        source=_source(),
    )
    youtube_account = service.create_channel_account(
        project_id=youtube_project["id"],
        platform="youtube",
        account_name="PetWoods YouTube",
        account_handle="@petwoods",
        source=_source("ui"),
    )
    youtube_cycle = service.create_cycle(
        project_id=youtube_project["id"],
        name="YouTube 当前轮",
        goal="Verify single-account selected flow.",
        source=_source(),
    )
    youtube_experiment = service.create_experiment(
        project_id=youtube_project["id"],
        cycle_id=youtube_cycle["id"],
        title="同一窝小猫，可能不是一个爹吗？",
        hypothesis="遗传猎奇题适合跨平台分发。",
        source=_source(),
    )

    return {
        "service": service,
        "petwoods": petwoods,
        "xhs_account": xhs_account,
        "douyin_account": douyin_account,
        "pet_experiment": pet_experiment,
        "youtube_project": youtube_project,
        "youtube_account": youtube_account,
        "youtube_experiment": youtube_experiment,
    }


async def run_smoke(db_path: Path) -> dict[str, Any]:
    os.environ["PIXELLE_OPS_DB_PATH"] = str(db_path)
    seeded = _seed_state(db_path)
    service = seeded["service"]
    server._build_service = lambda: service

    before_counts = _table_counts(db_path)

    async with Client(server.mcp) as client:
        capabilities = await client.call_tool("pixelle_get_capabilities", {})
        assert capabilities.data["conversation_contract"]["requires_capability_first"] is True
        assert capabilities.data["conversation_contract"]["primary_entry"] == "codex_natural_language"
        assert capabilities.data["conversation_contract"]["ui_context_copy"] == "fallback_only"
        assert capabilities.data["intent_routes"]["codex_natural_language_entry"]["primary_entry"] is True
        assert (
            capabilities.data["intent_routes"]["codex_natural_language_entry"][
                "ask_user_for_project_or_account_when_ambiguous"
            ]
            is True
        )
        assert capabilities.data["intent_routes"]["ui_context_copy_fallback"]["fallback_only"] is True
        assert (
            capabilities.data["intent_routes"]["ui_context_copy_fallback"]["must_verify_against_current_state"]
            is True
        )
        assert capabilities.data["intent_routes"]["status_check"]["writes_state"] is False
        assert capabilities.data["intent_routes"]["content_recommendation"]["writes_state"] is False

        projects = await client.call_tool("pixelle_list_projects", {})
        ambiguous = await client.call_tool("pixelle_get_current", {})
        selected_project = await client.call_tool(
            "pixelle_get_current",
            {"project_id": seeded["petwoods"]["id"]},
        )
        selected_account = await client.call_tool(
            "pixelle_get_current",
            {"channel_account_id": seeded["xhs_account"]["id"]},
        )
        single_account_project = await client.call_tool(
            "pixelle_get_current",
            {"project_id": seeded["youtube_project"]["id"]},
        )

    after_counts = _table_counts(db_path)
    assert after_counts == before_counts
    assert {project["name"] for project in projects.data["projects"]} == {"PetWoods YouTube", "PetWoods"}
    assert ambiguous.data["next_action"]["kind"] == "select_project"
    assert ambiguous.data["next_action"]["blocked"] is True
    assert selected_project.data["next_action"]["kind"] == "select_channel_account"
    assert selected_project.data["next_action"]["blocked"] is True
    assert selected_account.data["context"]["channel_account_id"] == seeded["xhs_account"]["id"]
    assert selected_account.data["experiment"]["id"] == seeded["pet_experiment"]["id"]
    assert selected_account.data["next_action"]["kind"] == "lock_prediction"
    assert single_account_project.data["selected_channel_account"]["id"] == seeded["youtube_account"]["id"]
    assert single_account_project.data["experiment"]["id"] == seeded["youtube_experiment"]["id"]
    assert single_account_project.data["next_action"]["kind"] == "lock_prediction"

    return {
        "status": "ok",
        "checks": {
            "primary_entry": capabilities.data["conversation_contract"]["primary_entry"],
            "ui_context_copy": capabilities.data["conversation_contract"]["ui_context_copy"],
            "ambiguous_no_selection": ambiguous.data["next_action"]["kind"],
            "selected_multi_account_project": selected_project.data["next_action"]["kind"],
            "selected_channel_account": selected_account.data["next_action"]["kind"],
            "single_account_project": single_account_project.data["next_action"]["kind"],
            "read_only_counts_unchanged": after_counts == before_counts,
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
        result = asyncio.run(run_smoke(args.db))
    else:
        with TemporaryDirectory(prefix="pixelle-p1-direct-entry-") as tmp_dir:
            result = asyncio.run(run_smoke(Path(tmp_dir) / "ops.db"))
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
