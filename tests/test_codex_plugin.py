import asyncio
import json

import pytest
from fastmcp import Client

from codex_plugin import server
from ops.service import OpsService
from ops.store import OpsStore


def _source(confirmed=True):
    return {"kind": "codex", "confirmed_by_user": confirmed, "skill": "cheat-on-content"}


@pytest.fixture
def plugin_service(tmp_path, monkeypatch):
    video_path = tmp_path / "plugin.mp4"

    async def fake_generation_runner(**kwargs):
        video_path.write_bytes(b"fake video bytes")
        return {"path": str(video_path), "file_size": video_path.stat().st_size, "text": kwargs["text"]}

    store = OpsStore(tmp_path / "ops.db")
    store.init_db()
    service = OpsService(
        store,
        generation_runner=fake_generation_runner,
        available_pipelines=("standard", "custom", "asset_based"),
    )
    monkeypatch.setattr(server, "_build_service", lambda: service)
    return service


@pytest.mark.asyncio
async def test_plugin_tools_run_complete_loop(plugin_service):
    project = await server.pixelle_create_project(
        name="PetWoods",
        product="PetWoods",
        channel="xiaohongshu",
        source=_source(),
    )
    cycle = await server.pixelle_create_cycle(
        project_id=project["entity"]["id"],
        name="Launch week",
        goal="Validate demand",
        source=_source(),
    )
    experiment = await server.pixelle_create_experiment(
        project_id=project["entity"]["id"],
        cycle_id=cycle["entity"]["id"],
        title="Hook test",
        hypothesis="Pain hook wins.",
        source=_source(),
    )
    await server.pixelle_lock_prediction(
        experiment_id=experiment["entity"]["id"],
        prediction={"expected_metric": "save_rate"},
        source=_source(),
    )
    draft = await server.pixelle_submit_generation_draft(
        experiment_id=experiment["entity"]["id"],
        text="Generate a video",
        source=_source(),
    )
    approval = await server.pixelle_approve_generation_draft(
        experiment_id=experiment["entity"]["id"],
        draft_id=draft["event"]["id"],
        source=_source(),
    )
    generation = await server.pixelle_request_generation(
        experiment_id=experiment["entity"]["id"],
        approved_draft_id=approval["event"]["id"],
        wait_for_completion=True,
        source=_source(),
    )
    asset_check = await server.pixelle_check_generation_asset(
        experiment_id=experiment["entity"]["id"],
        content_item_id=generation["content_item"]["id"],
        source=_source(),
    )
    publish = await server.pixelle_record_publish(
        experiment_id=experiment["entity"]["id"],
        content_item_id=generation["content_item"]["id"],
        evidence={"platform_url": "https://example.com/post/1"},
        source=_source(),
    )
    await server.pixelle_record_metrics(
        experiment_id=experiment["entity"]["id"],
        content_item_id=generation["content_item"]["id"],
        metrics={"views": 100, "likes": 10},
        source=_source(),
    )
    await server.pixelle_write_retro(
        experiment_id=experiment["entity"]["id"],
        retro={"summary": "Prediction held."},
        source=_source(),
    )
    current = await server.pixelle_get_current()

    assert asset_check["next_action"]["kind"] == "record_publish"
    assert publish["next_action"]["kind"] == "record_metrics"
    assert current["experiment"]["id"] == experiment["entity"]["id"]


@pytest.mark.asyncio
async def test_plugin_rejects_unconfirmed_codex_write(plugin_service):
    result = await server.pixelle_create_project(
        name="PetWoods",
        product="PetWoods",
        channel="xiaohongshu",
        source=_source(confirmed=False),
    )

    assert result["status"] == "error"
    assert result["error"]["code"] == "source_not_confirmed"
    assert result["next_action"]["blocked"] is True


@pytest.mark.asyncio
async def test_plugin_reports_capabilities(plugin_service):
    result = await server.pixelle_get_capabilities()

    assert result["status"] == "ok"
    assert result["plugin"] == "pixelle-ops"
    assert result["protocol_version"] == "p0.9.20260622"
    assert "pixelle_list_projects" in result["required_tools"]
    assert "pixelle_create_channel_account" in result["required_tools"]
    assert "pixelle_get_capabilities" in result["required_tools"]
    assert "pixelle_submit_generation_draft" in result["required_tools"]
    assert "pixelle_approve_generation_draft" in result["required_tools"]
    assert "pixelle_set_project_cheat_workspace" in result["required_tools"]
    assert "pixelle_get_cheat_workspace_summary" in result["required_tools"]
    assert "pixelle_get_context_export" in result["required_tools"]
    assert "pixelle_submit_writeback_draft" in result["required_tools"]
    assert "pixelle_validate_writeback_draft" in result["required_tools"]
    assert "pixelle_apply_writeback_draft" in result["required_tools"]
    assert "pixelle_reject_writeback_draft" in result["required_tools"]
    assert "pixelle_list_writeback_drafts" in result["required_tools"]
    assert result["p2_capabilities"]["cheat_workspace_summary"] is True
    assert result["p2_capabilities"]["context_export"] is True
    assert result["p2_capabilities"]["writeback_draft"] is True
    assert "create_content_experiment" in result["p2_capabilities"]["writeback_operations"]
    assert result["conversation_gates"]["project_selection_gate"] is True
    assert result["conversation_gates"]["channel_account_gate"] is True
    assert result["conversation_gates"]["content_shape_gate"] is True
    assert result["conversation_gates"]["existing_generation_gate"] is True
    assert result["conversation_gates"]["pipeline_selection_gate"] is True
    assert result["conversation_contract_version"] == "p0.9.20260622"
    assert result["conversation_contract"]["requires_capability_first"] is True
    assert result["conversation_contract"]["first_tool"] == "pixelle_get_capabilities"
    assert result["conversation_contract"]["primary_entry"] == "codex_natural_language"
    assert result["conversation_contract"]["ui_context_copy"] == "fallback_only"
    assert result["intent_routes"]["codex_natural_language_entry"]["primary_entry"] is True
    assert result["intent_routes"]["codex_natural_language_entry"]["ask_user_for_project_or_account_when_ambiguous"] is True
    assert result["intent_routes"]["ui_context_copy_fallback"]["fallback_only"] is True
    assert result["intent_routes"]["ui_context_copy_fallback"]["must_verify_against_current_state"] is True
    assert result["intent_routes"]["status_check"]["first_tools"] == [
        "pixelle_get_capabilities",
        "pixelle_get_current",
    ]
    assert result["intent_routes"]["content_recommendation"]["writes_state"] is False
    assert result["intent_routes"]["content_recommendation"]["requires_project_or_channel_account"] is True
    assert result["intent_routes"]["content_recommendation"]["confirmed_topic_writeback"] == {
        "requires_writeback_draft": True,
        "operation": "create_content_experiment",
        "do_not_call_direct_create_experiment": True,
    }
    assert result["intent_routes"]["ambiguous_copy_request"]["requires_user_choice"] is True
    assert result["intent_routes"]["project_selection"]["required_when_multiple_projects"] is True
    assert result["intent_routes"]["channel_account_selection"]["required_when_multiple_accounts"] is True
    assert result["intent_routes"]["video_generation"]["requires_draft_approval"] is True
    assert result["intent_routes"]["video_generation"]["requires_user_pipeline_choice"] is True
    assert result["intent_routes"]["video_generation"]["default_pipeline_requires_user_acceptance"] is True
    assert result["intent_routes"]["full_operations_experiment"]["cheat_generated_experiment_creation"] == {
        "requires_writeback_draft": True,
        "operation": "create_content_experiment",
        "do_not_call_direct_create_experiment": True,
    }
    assert result["intent_routes"]["existing_generation"]["requires_reuse_decision"] is True
    assert result["intent_routes"]["mock_p0_closeout"]["allows_mock_evidence"] is True
    assert result["next_action"]["kind"] == "route_user_request"


@pytest.mark.asyncio
async def test_plugin_binds_and_reads_cheat_workspace_summary(plugin_service, tmp_path):
    workspace = tmp_path / "cheat"
    workspace.mkdir()
    (workspace / ".cheat-state.json").write_text(
        json.dumps({"schema_version": "1.0", "rubric_version": "rubric-v3"}),
        encoding="utf-8",
    )
    (workspace / "candidates.md").write_text("- 选题 A\n", encoding="utf-8")
    project = await server.pixelle_create_project(
        name="PetWoods",
        product="PetWoods",
        channel="xiaohongshu",
        source=_source(),
    )

    bind_result = await server.pixelle_set_project_cheat_workspace(
        project_id=project["entity"]["id"],
        workspace_path=str(workspace),
        source=_source(),
    )
    summary = await server.pixelle_get_cheat_workspace_summary(project_id=project["entity"]["id"])

    assert bind_result["status"] == "ok"
    assert bind_result["cheat_workspace"]["status"] == "valid"
    assert summary["summary"]["rubric_version"] == "rubric-v3"
    assert summary["summary"]["candidate_count"] == 1


@pytest.mark.asyncio
async def test_plugin_returns_context_export(plugin_service):
    project = await server.pixelle_create_project(
        name="PetWoods",
        product="PetWoods",
        channel="xiaohongshu",
        source=_source(),
    )
    cycle = await server.pixelle_create_cycle(
        project_id=project["entity"]["id"],
        name="R1",
        goal="Validate cat content",
        source=_source(),
    )
    experiment = await server.pixelle_create_experiment(
        project_id=project["entity"]["id"],
        cycle_id=cycle["entity"]["id"],
        title="母猫打滚就是想配了吗？",
        hypothesis="打滚判断题能承接配种系列。",
        source=_source(),
    )

    exported = await server.pixelle_get_context_export(project_id=project["entity"]["id"])

    assert exported["status"] == "ok"
    assert exported["context_export"]["project"]["id"] == project["entity"]["id"]
    assert exported["context_export"]["current_experiment"]["id"] == experiment["entity"]["id"]
    assert exported["context_export"]["next_action"]["kind"] == "lock_prediction"


@pytest.mark.asyncio
async def test_plugin_writeback_draft_validate_apply_prediction(plugin_service):
    project = await server.pixelle_create_project(
        name="PetWoods",
        product="PetWoods",
        channel="xiaohongshu",
        source=_source(),
    )
    cycle = await server.pixelle_create_cycle(
        project_id=project["entity"]["id"],
        name="R1",
        goal="Validate cat content",
        source=_source(),
    )
    experiment = await server.pixelle_create_experiment(
        project_id=project["entity"]["id"],
        cycle_id=cycle["entity"]["id"],
        title="母猫打滚就是想配了吗？",
        hypothesis="打滚判断题能承接配种系列。",
        source=_source(),
    )

    draft = await server.pixelle_submit_writeback_draft(
        operation="lock_content_prediction",
        target={"experiment_id": experiment["entity"]["id"]},
        payload={"prediction": {"primary_metric": "save_rate"}},
        source=_source(),
    )
    validated = await server.pixelle_validate_writeback_draft(draft_id=draft["draft"]["id"])
    applied = await server.pixelle_apply_writeback_draft(draft_id=draft["draft"]["id"], source=_source())
    listed = await server.pixelle_list_writeback_drafts()

    assert validated["draft"]["status"] == "validation_passed"
    assert applied["draft"]["status"] == "applied"
    assert applied["applied_result"]["entity"]["stage"] == "prediction_locked"
    assert listed["drafts"][0]["id"] == draft["draft"]["id"]


@pytest.mark.asyncio
async def test_plugin_lists_projects_and_gets_selected_current_project_or_channel_account(plugin_service):
    petwoods = await server.pixelle_create_project(
        name="PetWoods",
        product="PetWoods",
        channel="xiaohongshu",
        source=_source(),
    )
    pet_cycle = await server.pixelle_create_cycle(
        project_id=petwoods["entity"]["id"],
        name="Pet cycle",
        goal="Grow cat content",
        source=_source(),
    )
    await server.pixelle_create_experiment(
        project_id=petwoods["entity"]["id"],
        cycle_id=pet_cycle["entity"]["id"],
        title="Cat hook",
        hypothesis="Cat hook wins.",
        source=_source(),
    )
    account = await server.pixelle_create_channel_account(
        project_id=petwoods["entity"]["id"],
        platform="xiaohongshu",
        account_name="PetWoods 宠物森友会",
        source=_source(),
        account_handle="petwoods",
        status="connected",
    )
    other = await server.pixelle_create_project(
        name="Other Brand",
        product="Other",
        channel="xiaohongshu",
        source=_source(),
    )
    other_cycle = await server.pixelle_create_cycle(
        project_id=other["entity"]["id"],
        name="Other cycle",
        goal="Avoid mixed context",
        source=_source(),
    )
    await server.pixelle_create_experiment(
        project_id=other["entity"]["id"],
        cycle_id=other_cycle["entity"]["id"],
        title="Other hook",
        hypothesis="Other hook wins.",
        source=_source(),
    )

    projects = await server.pixelle_list_projects()
    ambiguous = await server.pixelle_get_current()
    selected_project = await server.pixelle_get_current(project_id=petwoods["entity"]["id"])
    selected_account = await server.pixelle_get_current(channel_account_id=account["entity"]["id"])

    assert projects["status"] == "ok"
    assert [project["name"] for project in projects["projects"]] == ["PetWoods", "Other Brand"]
    assert projects["projects"][0]["channel_accounts"][0]["account_name"] == "PetWoods 宠物森友会"
    assert ambiguous["next_action"]["kind"] == "select_project"
    assert selected_project["project"]["id"] == petwoods["entity"]["id"]
    assert selected_project["selected_channel_account"]["id"] == account["entity"]["id"]
    assert selected_project["context"]["channel_account_id"] == account["entity"]["id"]
    assert selected_project["next_action"]["kind"] == "lock_prediction"
    assert selected_account["project"]["id"] == petwoods["entity"]["id"]


@pytest.mark.asyncio
async def test_plugin_keeps_legacy_social_account_tool_as_alias(plugin_service):
    project = await server.pixelle_create_project(
        name="PetWoods",
        product="PetWoods",
        channel="xiaohongshu",
        source=_source(),
    )

    account = await server.pixelle_create_social_account(
        project_id=project["entity"]["id"],
        platform="xiaohongshu",
        account_name="PetWoods legacy alias",
        source=_source(),
    )
    selected = await server.pixelle_get_current(account_id=account["entity"]["id"])

    assert account["entity"]["kind"] == "channel_account"
    assert selected["context"]["channel_account_id"] == account["entity"]["id"]


@pytest.mark.asyncio
async def test_plugin_lists_generation_pipelines(plugin_service):
    result = await server.pixelle_list_generation_pipelines()

    assert result["status"] == "ok"
    assert result["pipeline_names"] == ["standard", "custom", "asset_based"]
    assert result["default_pipeline"] == "standard"
    assert result["next_action"]["kind"] == "select_generation_pipeline"


@pytest.mark.asyncio
async def test_plugin_rejects_unknown_generation_pipeline(plugin_service):
    project = await server.pixelle_create_project(
        name="PetWoods",
        product="PetWoods",
        channel="xiaohongshu",
        source=_source(),
    )
    cycle = await server.pixelle_create_cycle(
        project_id=project["entity"]["id"],
        name="Launch week",
        goal="Validate demand",
        source=_source(),
    )
    experiment = await server.pixelle_create_experiment(
        project_id=project["entity"]["id"],
        cycle_id=cycle["entity"]["id"],
        title="Hook test",
        hypothesis="Pain hook wins.",
        source=_source(),
    )
    await server.pixelle_lock_prediction(
        experiment_id=experiment["entity"]["id"],
        prediction={"expected_metric": "save_rate"},
        source=_source(),
    )
    draft = await server.pixelle_submit_generation_draft(
        experiment_id=experiment["entity"]["id"],
        text="Generate a video",
        pipeline="xhs_short_video_v1",
        source=_source(),
    )
    approval = await server.pixelle_approve_generation_draft(
        experiment_id=experiment["entity"]["id"],
        draft_id=draft["event"]["id"],
        source=_source(),
    )

    result = await server.pixelle_request_generation(
        experiment_id=experiment["entity"]["id"],
        approved_draft_id=approval["event"]["id"],
        wait_for_completion=True,
        source=_source(),
    )

    assert result["status"] == "error"
    assert result["error"]["code"] == "unknown_generation_pipeline"
    assert "standard, custom, asset_based" in result["error"]["message"]


@pytest.mark.asyncio
async def test_plugin_requires_approved_generation_draft(plugin_service):
    project = await server.pixelle_create_project(
        name="PetWoods",
        product="PetWoods",
        channel="xiaohongshu",
        source=_source(),
    )
    cycle = await server.pixelle_create_cycle(
        project_id=project["entity"]["id"],
        name="Launch week",
        goal="Validate demand",
        source=_source(),
    )
    experiment = await server.pixelle_create_experiment(
        project_id=project["entity"]["id"],
        cycle_id=cycle["entity"]["id"],
        title="Hook test",
        hypothesis="Pain hook wins.",
        source=_source(),
    )
    await server.pixelle_lock_prediction(
        experiment_id=experiment["entity"]["id"],
        prediction={"expected_metric": "save_rate"},
        source=_source(),
    )
    draft = await server.pixelle_submit_generation_draft(
        experiment_id=experiment["entity"]["id"],
        text="Generate a video",
        source=_source(),
    )

    missing_approval = await server.pixelle_request_generation(
        experiment_id=experiment["entity"]["id"],
        source=_source(),
    )
    unapproved_draft = await server.pixelle_request_generation(
        experiment_id=experiment["entity"]["id"],
        approved_draft_id=draft["event"]["id"],
        source=_source(),
    )

    assert missing_approval["status"] == "error"
    assert missing_approval["error"]["code"] == "approved_draft_required"
    assert unapproved_draft["status"] == "error"
    assert unapproved_draft["error"]["code"] == "approved_draft_required"


@pytest.mark.asyncio
async def test_plugin_rejects_instruction_wrapped_generation_draft(plugin_service):
    project = await server.pixelle_create_project(
        name="PetWoods",
        product="PetWoods",
        channel="xiaohongshu",
        source=_source(),
    )
    cycle = await server.pixelle_create_cycle(
        project_id=project["entity"]["id"],
        name="Launch week",
        goal="Validate demand",
        source=_source(),
    )
    experiment = await server.pixelle_create_experiment(
        project_id=project["entity"]["id"],
        cycle_id=cycle["entity"]["id"],
        title="Hook test",
        hypothesis="Pain hook wins.",
        source=_source(),
    )
    await server.pixelle_lock_prediction(
        experiment_id=experiment["entity"]["id"],
        prediction={"expected_metric": "save_rate"},
        source=_source(),
    )

    result = await server.pixelle_submit_generation_draft(
        experiment_id=experiment["entity"]["id"],
        text="【视频目标】生成短视频。\n【屏幕字幕版】\n母猫打滚就是想配了吗？",
        source=_source(),
    )

    assert result["status"] == "error"
    assert result["error"]["code"] == "generation_draft_invalid"


@pytest.mark.asyncio
async def test_plugin_request_generation_defaults_to_async_status_flow(plugin_service):
    project = await server.pixelle_create_project(
        name="PetWoods",
        product="PetWoods",
        channel="xiaohongshu",
        source=_source(),
    )
    cycle = await server.pixelle_create_cycle(
        project_id=project["entity"]["id"],
        name="Launch week",
        goal="Validate demand",
        source=_source(),
    )
    experiment = await server.pixelle_create_experiment(
        project_id=project["entity"]["id"],
        cycle_id=cycle["entity"]["id"],
        title="Hook test",
        hypothesis="Pain hook wins.",
        source=_source(),
    )
    await server.pixelle_lock_prediction(
        experiment_id=experiment["entity"]["id"],
        prediction={"expected_metric": "save_rate"},
        source=_source(),
    )
    draft = await server.pixelle_submit_generation_draft(
        experiment_id=experiment["entity"]["id"],
        text="Generate a video",
        source=_source(),
    )
    approval = await server.pixelle_approve_generation_draft(
        experiment_id=experiment["entity"]["id"],
        draft_id=draft["event"]["id"],
        source=_source(),
    )

    requested = await server.pixelle_request_generation(
        experiment_id=experiment["entity"]["id"],
        approved_draft_id=approval["event"]["id"],
        source=_source(),
    )
    await asyncio.sleep(0)
    status = await server.pixelle_get_generation_status(experiment_id=experiment["entity"]["id"])
    asset_check = await server.pixelle_check_generation_asset(
        experiment_id=experiment["entity"]["id"],
        content_item_id=status["content_item"]["id"],
        source=_source(),
    )

    assert requested["entity"]["stage"] == "generation_requested"
    assert requested["next_action"]["kind"] == "check_generation_status"
    assert status["status"] == "completed"
    assert asset_check["event"]["payload"]["status"] in {"passed", "failed"}


@pytest.mark.asyncio
async def test_fastmcp_client_can_call_pixelle_tools(plugin_service):
    async with Client(server.mcp) as client:
        tools = await client.list_tools()
        tool_names = {tool.name for tool in tools}

        result = await client.call_tool(
            "pixelle_create_project",
            {
                "name": "PetWoods",
                "product": "PetWoods",
                "channel": "xiaohongshu",
                "source": _source(),
            },
        )

    assert "pixelle_create_project" in tool_names
    assert "pixelle_get_capabilities" in tool_names
    assert "pixelle_list_generation_pipelines" in tool_names
    assert "pixelle_submit_generation_draft" in tool_names
    assert "pixelle_approve_generation_draft" in tool_names
    assert "pixelle_get_generation_status" in tool_names
    assert "pixelle_check_generation_asset" in tool_names
    assert result.data["entity"]["kind"] == "operating_project"
    assert result.data["next_action"]["kind"] == "create_cycle"


@pytest.mark.asyncio
async def test_fastmcp_client_gets_structured_business_error(plugin_service):
    async with Client(server.mcp) as client:
        result = await client.call_tool(
            "pixelle_create_project",
            {
                "name": "PetWoods",
                "product": "PetWoods",
                "channel": "xiaohongshu",
                "source": _source(confirmed=False),
            },
        )

    assert result.data["status"] == "error"
    assert result.data["error"]["code"] == "source_not_confirmed"
    assert "Traceback" not in result.data["error"]["message"]


def test_plugin_main_runs_stdio_transport(monkeypatch):
    captured = {}

    def fake_run(*, transport, show_banner):
        captured["transport"] = transport
        captured["show_banner"] = show_banner

    monkeypatch.setattr(server.mcp, "run", fake_run)

    server.main()

    assert captured == {"transport": "stdio", "show_banner": False}
