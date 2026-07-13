"""Live Agent capability negotiation and operation status."""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from api.dependencies import ConfigManagerDep
from api.routers.settings import _diagnostic_checks
from api.security import RequestIdentity, get_request_identity
from pixelle_video.content.operations import ContentFlowOperation, load_operation
from pixelle_video.generation import build_default_production_template_registry

router = APIRouter(prefix="/agent", tags=["Agent Access"])
IdentityDep = Annotated[RequestIdentity, Depends(get_request_identity)]


def _api_version() -> str:
    for package in ("pixelle-video", "pixelle_video"):
        try:
            return version(package)
        except PackageNotFoundError:
            continue
    return "0.1.0"


@router.get("/capabilities")
async def get_agent_capabilities(
    config_manager: ConfigManagerDep,
    identity: IdentityDep,
):
    templates = [
        template
        for template in build_default_production_template_registry().list()
        if template.enabled
    ]
    diagnostics = _diagnostic_checks(config_manager.config)
    return {
        "schema_version": "1.0",
        "api_version": _api_version(),
        "tool_surface_version": "1.0",
        "authenticated": identity.is_agent,
        "artifact_kinds": ["video", "image_set", "text"],
        "recipes": [
            {
                "id": template.id,
                "name": template.display_name,
                "access_scope": template.access_scope,
                "enabled": template.enabled,
                "requires": (
                    ["scene_manifest", "client_generated_images"]
                    if template.entry == "scenes"
                    else list(template.required_capabilities)
                ),
                "agent_producible": template.entry in {"script", "scenes"},
                "unavailable_reason": (
                    None
                    if template.entry in {"script", "scenes"}
                    else "首批 Agent 接入不接受任意本机素材路径；请从 React 快速生成发起。"
                ),
            }
            for template in templates
        ],
        "human_confirmation": {
            "required_for": ["content_confirmation", "scene_manifest_lock"],
            "agent_can_confirm": False,
        },
        "environment": {
            "ok": all(check.ok or check.severity != "error" for check in diagnostics),
            "checks": [check.model_dump(mode="json") for check in diagnostics],
        },
        "agent_token_configured": True,
    }


@router.get("/operations/{operation_id}", response_model=ContentFlowOperation)
async def get_agent_operation(operation_id: str, identity: IdentityDep):
    operation = load_operation(operation_id)
    if operation is None:
        raise HTTPException(status_code=404, detail="未找到这次操作记录。")
    return operation
