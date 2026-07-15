"""Pixelle MCP tools for complete production routes and their continuations."""

from __future__ import annotations

import os
import uuid
from typing import Any

from fastmcp import FastMCP

from agent_plugin.client import PixelleAPIClient, PixelleAPIError, file_as_data_url

mcp = FastMCP("pixelle-agent")
_client = PixelleAPIClient()


def _trace(request_id: str | None = None) -> dict[str, str]:
    return {
        "request_id": request_id or uuid.uuid4().hex,
        "client_name": os.environ.get("PIXELLE_AGENT_CLIENT_NAME", "agent_plugin"),
        "agent_session_id": os.environ.get("PIXELLE_AGENT_SESSION_ID", "stdio"),
        "source": "mcp",
    }


def _error(exc: PixelleAPIError) -> dict[str, Any]:
    return {"status": "error", "error": {"code": exc.code, "message": exc.message}}


def _bounded(value: Any) -> Any:
    if isinstance(value, str):
        return value if len(value) <= 500 else value[:497] + "..."
    if isinstance(value, list):
        return [_bounded(entry) for entry in value[:50]]
    if isinstance(value, dict):
        bounded = {str(key): _bounded(entry) for key, entry in value.items()}
        error = bounded.get("error")
        if isinstance(error, dict) and error.get("message"):
            layer = str(error.get("layer") or "runtime")
            if layer not in {"input", "permissions"}:
                error["message"] = "Pixelle 执行失败；请查看本机 API 日志定位原因。"
        return bounded
    return value


async def _call(action):
    try:
        return _bounded(await action())
    except PixelleAPIError as exc:
        return _error(exc)


@mcp.tool
async def get_capabilities() -> dict[str, Any]:
    """Read live Pixelle capabilities before choosing a workflow."""
    return await _call(lambda: _client.request("GET", "/agent/capabilities"))


@mcp.tool
async def list_projects() -> Any:
    """List configured Pixelle projects."""
    return await _call(lambda: _client.request("GET", "/projects"))


@mcp.tool
async def list_content_items(
    status: str | None = None, project_id: str | None = None, limit: int = 50
) -> Any:
    """List at most 50 content items, optionally filtered by status/project."""
    params = {"limit": min(max(limit, 1), 50)}
    if status:
        params["status"] = status
    if project_id:
        params["project"] = project_id
    return await _call(lambda: _client.request("GET", "/content-items", params=params))


@mcp.tool
async def get_content_item(item_id: str) -> Any:
    """Read one content item and its events, manifest, tasks and publications."""
    return await _call(lambda: _client.request("GET", f"/content-items/{item_id}"))


@mcp.tool
async def confirm_pending_item(
    item_id: str,
    content_version: str,
    explicit_user_confirmation: bool,
    request_id: str | None = None,
) -> Any:
    """Relay a user's explicit approval of the exact content version previously displayed.

    Never call this from inferred sentiment. ``content_version`` must be the
    ``updated_at`` value returned with the full pending item, and
    ``explicit_user_confirmation`` must only be true after an unambiguous user reply.
    """
    return await _call(
        lambda: _client.request(
            "POST",
            f"/content-items/{item_id}/confirm",
            json={
                "content_version": content_version,
                "explicit_user_confirmation": explicit_user_confirmation,
                **_trace(request_id),
            },
        )
    )


@mcp.tool
async def edit_pending_review(
    item_id: str,
    content_version: str,
    variants: dict[str, dict[str, Any]] | None = None,
    scenes: list[dict[str, Any]] | None = None,
    review_kind: str | None = None,
    request_id: str | None = None,
) -> Any:
    """Save the user's direct edits to the exact pending version without creating a new task."""
    scene_manifest = None
    if scenes is not None:
        scene_manifest = {
            "review_kind": review_kind or "video_scenes",
            "scenes": scenes,
            "confirmed": False,
        }
    return await _call(
        lambda: _client.request(
            "POST",
            f"/content-items/{item_id}/revise-review",
            json={
                "action": "direct_edit",
                "content_version": content_version,
                "variants": variants,
                "scene_manifest": scene_manifest,
                **_trace(request_id),
            },
        )
    )


@mcp.tool
async def regenerate_pending_review(
    item_id: str,
    content_version: str,
    action: str,
    selected_scene_ids: list[str] | None = None,
    instruction: str | None = None,
    request_id: str | None = None,
) -> Any:
    """Rewrite a pending script, selected scenes/pages, or the complete scene/page plan.

    ``action`` must be ``rewrite_script``, ``regenerate_selected``, or
    ``regenerate_all``. The optional instruction is the user's direction, not
    an approval, and the existing production task remains stable.
    """
    if action not in {"rewrite_script", "regenerate_selected", "regenerate_all"}:
        return {
            "status": "error",
            "error": {
                "code": 422,
                "message": "action 必须是 rewrite_script、regenerate_selected 或 regenerate_all。",
            },
        }
    return await _call(
        lambda: _client.request(
            "POST",
            f"/content-items/{item_id}/revise-review",
            json={
                "action": action,
                "content_version": content_version,
                "selected_scene_ids": selected_scene_ids or [],
                "instruction": instruction,
                **_trace(request_id),
            },
        )
    )


@mcp.tool
async def list_recipes() -> Any:
    """List public and Agent recipes, including live requirements."""

    async def action():
        response = await _client.request("GET", "/generation/templates")
        capabilities = await _client.request("GET", "/agent/capabilities")
        capability_by_id = {recipe["id"]: recipe for recipe in capabilities.get("recipes", [])}
        recipes = [
            *response.get("templates", []),
            *(response.get("agent_templates") or []),
        ]
        for recipe in recipes:
            capability = capability_by_id.get(recipe.get("id"), {})
            recipe["agent_producible"] = capability.get("agent_producible", False)
            recipe["unavailable_reason"] = capability.get("unavailable_reason")
        return {
            "default_template": response.get("default_template"),
            "recipes": recipes,
        }

    return await _call(action)


@mcp.tool
async def get_task(task_id: str) -> Any:
    """Read one generation task; completed tasks include the canonical result."""

    async def action():
        task = await _client.request("GET", f"/generation/tasks/{task_id}")
        if task.get("status") == "completed":
            result = await _client.request("GET", f"/generation/tasks/{task_id}/result")
            task["result_summary"] = {
                "primary_video": result.get("primary_video"),
                "image_count": len(result.get("images") or []),
                "text_count": len(result.get("texts") or []),
                "artifact_count": len(result.get("artifacts") or []),
            }
        return task

    return await _call(action)


@mcp.tool
async def get_operation(operation_id: str) -> Any:
    """Poll one asynchronous content-flow operation."""
    return await _call(lambda: _client.request("GET", f"/agent/operations/{operation_id}"))


@mcp.tool
async def submit_scene_manifest(
    item_id: str,
    scenes: list[dict[str, Any]],
    overwrite_draft: bool = False,
    request_id: str | None = None,
) -> Any:
    """Submit the text-only storyboard for human confirmation before image generation."""
    payload = {
        "scenes": scenes,
        "overwrite_draft": overwrite_draft,
        **_trace(request_id),
    }
    return await _call(
        lambda: _client.request("PUT", f"/content-items/{item_id}/scene-manifest", json=payload)
    )


@mcp.tool
async def upload_scene_images(
    item_id: str, images: list[dict[str, Any]], request_id: str | None = None
) -> Any:
    """Upload confirmed-scene images; each item uses image_data_url or local file_path."""
    prepared = []
    try:
        for image in images:
            data_url = image.get("image_data_url")
            if not data_url and image.get("file_path"):
                data_url = file_as_data_url(str(image["file_path"]))
            prepared.append(
                {
                    "scene_id": image.get("scene_id"),
                    "image_data_url": data_url,
                    "replace": bool(image.get("replace", False)),
                }
            )
    except PixelleAPIError as exc:
        return _error(exc)
    return await _call(
        lambda: _client.request(
            "POST",
            f"/content-items/{item_id}/scene-images",
            json={"images": prepared, **_trace(request_id)},
        )
    )


@mcp.tool
async def start_production(
    project_id: str,
    pipeline_id: str,
    recipe_id: str,
    input: dict[str, Any],
    overrides: dict[str, Any] | None = None,
    content_item_id: str | None = None,
    request_id: str | None = None,
) -> Any:
    """Start one declared Agent-capable route and create its ledger task atomically."""
    trace = _trace(request_id)
    trace.pop("source", None)  # HTTP identity, not caller input, owns Agent provenance.
    payload = {
        "project_id": project_id,
        "pipeline_id": pipeline_id,
        "recipe_id": recipe_id,
        "input": input,
        "overrides": overrides or {},
        "content_item_id": content_item_id,
        **trace,
    }
    return await _call(lambda: _client.request("POST", "/production-tasks", json=payload))


@mcp.tool
async def list_production_tasks(
    project_id: str | None = None,
    state: str | None = None,
    limit: int = 50,
) -> Any:
    """Read the unified workbench task cards without mutating state."""
    params: dict[str, Any] = {"limit": min(max(limit, 1), 50)}
    if project_id:
        params["project_id"] = project_id
    if state:
        params["state"] = state
    return await _call(lambda: _client.request("GET", "/production-tasks", params=params))


@mcp.tool
async def mark_published(
    item_id: str,
    platform: str,
    published_at: str,
    evidence: dict[str, str],
    request_id: str | None = None,
) -> Any:
    """Record evidence that a produced item was actually published."""
    return await _call(
        lambda: _client.request(
            "POST",
            f"/content-items/{item_id}/mark-published",
            json={
                "platform": platform,
                "published_at": published_at,
                **evidence,
                **_trace(request_id),
            },
        )
    )


@mcp.tool
async def record_metrics(
    item_id: str,
    likes: int | None = None,
    favorites: int | None = None,
    comments: int | None = None,
    note: str | None = None,
    publication_id: str | None = None,
    mock: bool = False,
    mock_label: str | None = None,
    request_id: str | None = None,
) -> Any:
    """Record official metrics after publication, or explicitly labelled mock metrics."""
    return await _call(
        lambda: _client.request(
            "POST",
            f"/content-items/{item_id}/metrics",
            json={
                "likes": likes,
                "favorites": favorites,
                "comments": comments,
                "note": note,
                "publication_id": publication_id,
                "mock": mock,
                "mock_label": mock_label,
                **_trace(request_id),
            },
        )
    )


def main() -> None:
    mcp.run(transport="stdio", show_banner=False)


if __name__ == "__main__":
    main()
