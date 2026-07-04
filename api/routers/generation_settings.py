"""
Project-scoped generation settings API.

This router exposes the existing OpsService generation settings to React
without creating a second settings store.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from api.dependencies import OpsServiceDep
from ops.service import OpsError

router = APIRouter(prefix="/generation", tags=["generation-settings"])


class ProjectGenerationSettingsRequest(BaseModel):
    default_production_template_id: str = Field(..., min_length=1)


@router.get("/projects")
async def list_generation_projects(ops_service: OpsServiceDep):
    """List operating projects with their generation settings."""
    return ops_service.list_projects()


@router.get("/projects/{project_id}/templates")
async def list_project_production_templates(
    project_id: str,
    ops_service: OpsServiceDep,
):
    """List production templates with the selected project's default."""
    try:
        return ops_service.list_production_templates(project_id=project_id)
    except OpsError as exc:
        raise _ops_http_error(exc) from exc


@router.put("/projects/{project_id}/generation-settings")
async def update_project_generation_settings(
    project_id: str,
    request: ProjectGenerationSettingsRequest,
    ops_service: OpsServiceDep,
):
    """Persist a project's default production template."""
    try:
        return ops_service.set_project_generation_settings(
            project_id=project_id,
            default_production_template_id=request.default_production_template_id,
            source={"kind": "react_production_template_demo"},
        )
    except OpsError as exc:
        raise _ops_http_error(exc) from exc


def _ops_http_error(exc: OpsError) -> HTTPException:
    status_code = 404 if exc.code == "project_not_found" else 400
    return HTTPException(status_code=status_code, detail={"code": exc.code, "message": exc.message})
