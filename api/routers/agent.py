"""Live Agent capability negotiation and operation status."""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from api.dependencies import ConfigManagerDep
from api.routers.settings import _diagnostic_checks
from api.security import RequestIdentity, get_request_identity
from pixelle_video.content.operations import ContentFlowOperation, load_operation
from pixelle_video.generation import (
    build_default_pipeline_registry,
    build_default_production_template_registry,
    detect_available_generation_capabilities,
)

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
    pipelines = build_default_pipeline_registry()
    available_capabilities = detect_available_generation_capabilities()
    diagnostics = _diagnostic_checks(config_manager.config)
    return {
        "schema_version": "1.2",
        "api_version": _api_version(),
        "tool_surface_version": "1.2",
        "authenticated": identity.is_agent,
        "artifact_kinds": ["video", "image_set", "text"],
        "pipelines": [manifest.model_dump(mode="json") for manifest in pipelines.list_manifests()],
        "recipes": [
            {
                "id": template.id,
                "name": template.display_name,
                "version": template.version,
                "pipeline_id": template.pipeline_id,
                "access_scope": template.access_scope,
                "enabled": template.enabled,
                "input_requirements": list(template.input_requirements),
                "allowed_user_params": list(template.allowed_user_params),
                "outputs": [
                    output.model_dump(mode="json")
                    for output in pipelines.get_manifest(template.pipeline_id).outputs
                ],
                "launch_surfaces": list(
                    pipelines.get_manifest(template.pipeline_id).launch_surfaces
                ),
                "requires": (
                    ["scene_manifest", "client_generated_images"]
                    if template.pipeline_id == "codex_scene_video"
                    else list(template.required_capabilities)
                ),
                "agent_producible": _agent_unavailable_reason(
                    template.pipeline_id,
                    template.required_capabilities,
                    pipelines,
                    available_capabilities,
                )
                is None,
                "unavailable_reason": (
                    _agent_unavailable_reason(
                        template.pipeline_id,
                        template.required_capabilities,
                        pipelines,
                        available_capabilities,
                    )
                ),
            }
            for template in templates
        ],
        "human_confirmation": {
            "required_for": ["content_confirmation", "scene_manifest_lock"],
            "agent_can_confirm": True,
            "requires": [
                "explicit_user_confirmation",
                "review_id",
                "content_version",
                "client_name",
                "agent_session_id",
            ],
            "pending_review_actions": [
                "direct_edit",
                "rewrite_script",
                "regenerate_all",
            ],
        },
        "environment": {
            "ok": all(check.ok or check.severity != "error" for check in diagnostics),
            "checks": [check.model_dump(mode="json") for check in diagnostics],
        },
        "agent_token_configured": True,
    }


def _agent_unavailable_reason(
    pipeline_id: str,
    required_capabilities: list[str],
    pipelines,
    available_capabilities: set[str],
) -> str | None:
    if "agent" not in pipelines.get_manifest(pipeline_id).launch_surfaces:
        return "首批 Agent 接入不接受任意本机素材路径；请从 React 快速生成发起。"
    missing = [
        capability
        for capability in required_capabilities
        if capability not in available_capabilities
    ]
    if missing:
        return f"当前环境缺少能力：{', '.join(missing)}"
    return None


@router.get("/operations/{operation_id}", response_model=ContentFlowOperation)
async def get_agent_operation(operation_id: str, identity: IdentityDep):
    operation = load_operation(operation_id)
    if operation is None:
        raise HTTPException(status_code=404, detail="未找到这次操作记录。")
    return operation
