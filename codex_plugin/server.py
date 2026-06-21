"""Local MCP/FastMCP tool surface for Pixelle operations."""

from __future__ import annotations

import asyncio
import inspect
from typing import Any

from fastmcp import FastMCP

from ops.service import OpsError, OpsService

mcp = FastMCP("pixelle-ops")
_BACKGROUND_GENERATION_TASKS: set[asyncio.Task] = set()
PIXELLE_OPS_PROTOCOL_VERSION = "p0.7b.20260621"
PIXELLE_OPS_CONVERSATION_CONTRACT_VERSION = "p0.7b.20260621"
PIXELLE_OPS_REQUIRED_TOOLS = (
    "pixelle_get_capabilities",
    "pixelle_get_current",
    "pixelle_create_project",
    "pixelle_create_cycle",
    "pixelle_create_experiment",
    "pixelle_lock_prediction",
    "pixelle_list_generation_pipelines",
    "pixelle_submit_generation_draft",
    "pixelle_approve_generation_draft",
    "pixelle_request_generation",
    "pixelle_get_generation_status",
    "pixelle_check_generation_asset",
    "pixelle_record_publish",
    "pixelle_record_metrics",
    "pixelle_write_retro",
    "pixelle_write_memory",
)
PIXELLE_OPS_CONVERSATION_GATES = {
    "content_shape_gate": True,
    "existing_generation_gate": True,
    "pipeline_selection_gate": True,
    "draft_approval_gate": True,
    "async_generation_status": True,
    "asset_check_gate": True,
}
PIXELLE_OPS_CONVERSATION_CONTRACT = {
    "requires_capability_first": True,
    "first_tool": "pixelle_get_capabilities",
    "no_tool_before_capabilities": True,
}
PIXELLE_OPS_INTENT_ROUTES = {
    "status_check": {
        "first_tools": ["pixelle_get_capabilities", "pixelle_get_current"],
        "writes_state": False,
    },
    "content_recommendation": {
        "first_tools": ["pixelle_get_capabilities", "pixelle_get_current"],
        "writes_state": False,
    },
    "ambiguous_copy_request": {
        "requires_user_choice": True,
        "choice_prompt": "content_shape",
        "writes_state": False,
    },
    "approved_copy_request": {
        "requires_user_choice": False,
        "writes_state": False,
    },
    "full_operations_experiment": {
        "requires_prediction": True,
        "requires_draft_approval": True,
        "writes_state": True,
    },
    "video_generation": {
        "requires_pipeline_selection": True,
        "requires_user_pipeline_choice": True,
        "default_pipeline_requires_user_acceptance": True,
        "requires_draft_approval": True,
        "writes_state": True,
    },
    "existing_generation": {
        "requires_reuse_decision": True,
        "reuse_options": ["reuse_existing", "regenerate_from_reviewed_draft", "new_clean_experiment"],
    },
    "publish_evidence": {
        "requires_external_evidence": True,
        "allows_confirmation_note_only": False,
        "writes_state": True,
    },
    "mock_p0_closeout": {
        "allows_mock_evidence": True,
        "requires_mock_label": True,
        "writes_state": True,
    },
    "metrics_and_retro": {
        "requires_publish_evidence": True,
        "writes_state": True,
    },
}


def _build_service() -> OpsService:
    return OpsService()


async def pixelle_get_capabilities() -> dict[str, Any]:
    """Return the loaded Pixelle Ops plugin protocol and required flow gates."""
    return {
        "status": "ok",
        "plugin": "pixelle-ops",
        "protocol_version": PIXELLE_OPS_PROTOCOL_VERSION,
        "conversation_contract_version": PIXELLE_OPS_CONVERSATION_CONTRACT_VERSION,
        "conversation_contract": dict(PIXELLE_OPS_CONVERSATION_CONTRACT),
        "required_tools": list(PIXELLE_OPS_REQUIRED_TOOLS),
        "conversation_gates": dict(PIXELLE_OPS_CONVERSATION_GATES),
        "intent_routes": PIXELLE_OPS_INTENT_ROUTES,
        "content_shape_options": [
            "xiaohongshu_short_video_subtitles",
            "xiaohongshu_image_text_note",
            "topic_and_hook_only",
            "full_operations_experiment",
        ],
        "default_pipeline": "standard",
        "next_action": {"kind": "route_user_request", "blocked": False},
    }


async def pixelle_get_current() -> dict[str, Any]:
    """Return the current Pixelle operations state."""
    return _build_service().current_view()


async def pixelle_create_project(
    name: str,
    product: str,
    channel: str,
    source: dict[str, Any],
    description: str | None = None,
) -> dict[str, Any]:
    def action():
        project = _build_service().create_project(
            name=name,
            product=product,
            channel=channel,
            description=description,
            source=source,
        )
        return {
            "status": "ok",
            "entity": {"kind": "operating_project", **project},
            "next_action": {"kind": "create_cycle", "blocked": False},
        }

    return await _run_tool(action)


async def pixelle_create_cycle(
    project_id: str,
    name: str,
    goal: str,
    source: dict[str, Any],
    starts_on: str | None = None,
    ends_on: str | None = None,
) -> dict[str, Any]:
    def action():
        cycle = _build_service().create_cycle(
            project_id=project_id,
            name=name,
            goal=goal,
            starts_on=starts_on,
            ends_on=ends_on,
            source=source,
        )
        return {
            "status": "ok",
            "entity": {"kind": "operation_cycle", **cycle},
            "next_action": {"kind": "create_experiment", "blocked": False},
        }

    return await _run_tool(action)


async def pixelle_create_experiment(
    project_id: str,
    cycle_id: str,
    title: str,
    hypothesis: str,
    source: dict[str, Any],
) -> dict[str, Any]:
    def action():
        experiment = _build_service().create_experiment(
            project_id=project_id,
            cycle_id=cycle_id,
            title=title,
            hypothesis=hypothesis,
            source=source,
        )
        return {
            "status": "ok",
            "entity": {"kind": "content_experiment", **experiment},
            "next_action": {"kind": "lock_prediction", "blocked": False},
        }

    return await _run_tool(action)


async def pixelle_lock_prediction(
    experiment_id: str,
    prediction: dict[str, Any],
    source: dict[str, Any],
) -> dict[str, Any]:
    return await _run_tool(
        lambda: _build_service().lock_prediction(
            experiment_id=experiment_id,
            prediction=prediction,
            source=source,
        )
    )


async def pixelle_list_generation_pipelines() -> dict[str, Any]:
    """Return available Pixelle generation pipelines for user selection."""
    return await _run_tool(lambda: _build_service().list_generation_pipelines())


async def pixelle_submit_generation_draft(
    experiment_id: str,
    text: str,
    source: dict[str, Any],
    pipeline: str = "standard",
    title: str | None = None,
    generation_params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return await _run_tool(
        lambda: _build_service().submit_generation_draft(
            experiment_id=experiment_id,
            text=text,
            source=source,
            pipeline=pipeline,
            title=title,
            generation_params=generation_params,
        )
    )


async def pixelle_approve_generation_draft(
    experiment_id: str,
    draft_id: str,
    source: dict[str, Any],
) -> dict[str, Any]:
    return await _run_tool(
        lambda: _build_service().approve_generation_draft(
            experiment_id=experiment_id,
            draft_id=draft_id,
            source=source,
        )
    )


async def pixelle_request_generation(
    experiment_id: str,
    source: dict[str, Any],
    approved_draft_id: str | None = None,
    kind: str = "video",
    wait_for_completion: bool = False,
) -> dict[str, Any]:
    service = _build_service()
    result = await _run_tool(
        lambda: service.request_generation(
            experiment_id=experiment_id,
            source=source,
            approved_draft_id=approved_draft_id,
            kind=kind,
            wait_for_completion=wait_for_completion,
        )
    )
    if (
        not wait_for_completion
        and result.get("status") == "ok"
        and result.get("entity", {}).get("stage") == "generation_requested"
    ):
        _schedule_generation_completion(
            service=service,
            experiment_id=experiment_id,
            generation_event_id=result["event"]["id"],
            kind=kind,
            source=source,
        )
    return result


async def pixelle_get_generation_status(experiment_id: str) -> dict[str, Any]:
    return await _run_tool(lambda: _build_service().get_generation_status(experiment_id))


async def pixelle_check_generation_asset(
    experiment_id: str,
    source: dict[str, Any],
    content_item_id: str | None = None,
) -> dict[str, Any]:
    return await _run_tool(
        lambda: _build_service().check_generation_asset(
            experiment_id=experiment_id,
            content_item_id=content_item_id,
            source=source,
        )
    )


def _schedule_generation_completion(
    *,
    service: OpsService,
    experiment_id: str,
    generation_event_id: str,
    kind: str,
    source: dict[str, Any],
) -> None:
    task = asyncio.create_task(
        service.complete_generation_request(
            experiment_id=experiment_id,
            generation_event_id=generation_event_id,
            kind=kind,
            source=source,
        )
    )
    _BACKGROUND_GENERATION_TASKS.add(task)

    def _consume_result(done_task: asyncio.Task) -> None:
        _BACKGROUND_GENERATION_TASKS.discard(done_task)
        try:
            done_task.result()
        except Exception:
            pass

    task.add_done_callback(_consume_result)


async def pixelle_record_publish(
    experiment_id: str,
    evidence: dict[str, Any],
    source: dict[str, Any],
    content_item_id: str | None = None,
) -> dict[str, Any]:
    return await _run_tool(
        lambda: _build_service().record_publish(
            experiment_id=experiment_id,
            content_item_id=content_item_id,
            evidence=evidence,
            source=source,
        )
    )


async def pixelle_record_metrics(
    experiment_id: str,
    metrics: dict[str, Any],
    source: dict[str, Any],
    content_item_id: str | None = None,
) -> dict[str, Any]:
    return await _run_tool(
        lambda: _build_service().record_metrics(
            experiment_id=experiment_id,
            content_item_id=content_item_id,
            metrics=metrics,
            source=source,
        )
    )


async def pixelle_write_retro(
    experiment_id: str,
    retro: dict[str, Any],
    source: dict[str, Any],
) -> dict[str, Any]:
    return await _run_tool(
        lambda: _build_service().write_retro(
            experiment_id=experiment_id,
            retro=retro,
            source=source,
        )
    )


async def pixelle_write_memory(
    experiment_id: str,
    memory: dict[str, Any],
    source: dict[str, Any],
) -> dict[str, Any]:
    return await _run_tool(
        lambda: _build_service().write_memory(
            experiment_id=experiment_id,
            memory=memory,
            source=source,
        )
    )


async def _run_tool(action):
    try:
        result = action()
        if inspect.isawaitable(result):
            result = await result
        return result
    except OpsError as exc:
        return _ops_error(exc)


def _ops_error(exc: OpsError) -> dict[str, Any]:
    return {
        "status": "error",
        "error": {"code": exc.code, "message": exc.message},
        "next_action": {"kind": "resolve_error", "blocked": True, "reason": exc.code},
    }


for tool in (
    pixelle_get_capabilities,
    pixelle_get_current,
    pixelle_create_project,
    pixelle_create_cycle,
    pixelle_create_experiment,
    pixelle_lock_prediction,
    pixelle_list_generation_pipelines,
    pixelle_submit_generation_draft,
    pixelle_approve_generation_draft,
    pixelle_request_generation,
    pixelle_get_generation_status,
    pixelle_check_generation_asset,
    pixelle_record_publish,
    pixelle_record_metrics,
    pixelle_write_retro,
    pixelle_write_memory,
):
    mcp.tool(tool)


def main() -> None:
    mcp.run(transport="stdio", show_banner=False)


if __name__ == "__main__":
    main()
