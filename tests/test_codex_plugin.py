import pytest
from fastmcp import Client

from codex_plugin import server
from ops.service import OpsService
from ops.store import OpsStore


def _source(confirmed=True):
    return {"kind": "codex", "confirmed_by_user": confirmed, "skill": "cheat-on-content"}


@pytest.fixture
def plugin_service(tmp_path, monkeypatch):
    async def fake_generation_runner(**kwargs):
        return {"path": "output/plugin.mp4", "text": kwargs["text"]}

    store = OpsStore(tmp_path / "ops.db")
    store.init_db()
    service = OpsService(store, generation_runner=fake_generation_runner)
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
    generation = await server.pixelle_request_generation(
        experiment_id=experiment["entity"]["id"],
        text="Generate a video",
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
