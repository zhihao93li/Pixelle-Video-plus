"""Local MCP/FastMCP tool surface for Pixelle operations."""

from __future__ import annotations

from typing import Any

from fastmcp import FastMCP

from ops.service import OpsService

mcp = FastMCP("pixelle-ops")


def _build_service() -> OpsService:
    return OpsService()


async def pixelle_get_current() -> dict[str, Any]:
    """Return the current Pixelle operations state."""
    return _build_service().current_view()


async def pixelle_create_project(
    *,
    name: str,
    product: str,
    channel: str,
    source: dict[str, Any],
    description: str | None = None,
) -> dict[str, Any]:
    project = _build_service().create_project(
        name=name,
        product=product,
        channel=channel,
        description=description,
        source=source,
    )
    return {"status": "ok", "entity": {"kind": "operating_project", **project}, "next_action": {"kind": "create_cycle", "blocked": False}}


async def pixelle_create_cycle(
    *,
    project_id: str,
    name: str,
    goal: str,
    source: dict[str, Any],
    starts_on: str | None = None,
    ends_on: str | None = None,
) -> dict[str, Any]:
    cycle = _build_service().create_cycle(
        project_id=project_id,
        name=name,
        goal=goal,
        starts_on=starts_on,
        ends_on=ends_on,
        source=source,
    )
    return {"status": "ok", "entity": {"kind": "operation_cycle", **cycle}, "next_action": {"kind": "create_experiment", "blocked": False}}


async def pixelle_create_experiment(
    *,
    project_id: str,
    cycle_id: str,
    title: str,
    hypothesis: str,
    source: dict[str, Any],
) -> dict[str, Any]:
    experiment = _build_service().create_experiment(
        project_id=project_id,
        cycle_id=cycle_id,
        title=title,
        hypothesis=hypothesis,
        source=source,
    )
    return {"status": "ok", "entity": {"kind": "content_experiment", **experiment}, "next_action": {"kind": "lock_prediction", "blocked": False}}


async def pixelle_lock_prediction(
    *,
    experiment_id: str,
    prediction: dict[str, Any],
    source: dict[str, Any],
) -> dict[str, Any]:
    return _build_service().lock_prediction(
        experiment_id=experiment_id,
        prediction=prediction,
        source=source,
    )


async def pixelle_request_generation(
    *,
    experiment_id: str,
    text: str,
    source: dict[str, Any],
    pipeline: str = "standard",
    kind: str = "video",
    title: str | None = None,
    generation_params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return await _build_service().request_generation(
        experiment_id=experiment_id,
        text=text,
        source=source,
        pipeline=pipeline,
        kind=kind,
        title=title,
        generation_params=generation_params,
    )


async def pixelle_record_publish(
    *,
    experiment_id: str,
    evidence: dict[str, Any],
    source: dict[str, Any],
    content_item_id: str | None = None,
) -> dict[str, Any]:
    return _build_service().record_publish(
        experiment_id=experiment_id,
        content_item_id=content_item_id,
        evidence=evidence,
        source=source,
    )


async def pixelle_record_metrics(
    *,
    experiment_id: str,
    metrics: dict[str, Any],
    source: dict[str, Any],
    content_item_id: str | None = None,
) -> dict[str, Any]:
    return _build_service().record_metrics(
        experiment_id=experiment_id,
        content_item_id=content_item_id,
        metrics=metrics,
        source=source,
    )


async def pixelle_write_retro(
    *,
    experiment_id: str,
    retro: dict[str, Any],
    source: dict[str, Any],
) -> dict[str, Any]:
    return _build_service().write_retro(
        experiment_id=experiment_id,
        retro=retro,
        source=source,
    )


async def pixelle_write_memory(
    *,
    experiment_id: str,
    memory: dict[str, Any],
    source: dict[str, Any],
) -> dict[str, Any]:
    return _build_service().write_memory(
        experiment_id=experiment_id,
        memory=memory,
        source=source,
    )


for tool in (
    pixelle_get_current,
    pixelle_create_project,
    pixelle_create_cycle,
    pixelle_create_experiment,
    pixelle_lock_prediction,
    pixelle_request_generation,
    pixelle_record_publish,
    pixelle_record_metrics,
    pixelle_write_retro,
    pixelle_write_memory,
):
    mcp.tool(tool)
