"""内容空间管理 API。

项目只负责内容、任务、作品和运营记录的归属与筛选。"当前项目"是前端状态；
这些接口显式接收/返回 project_id。
校验失败一律返回 400，中文信息并给出下一步动作。
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from pixelle_video.content.projects import (
    Project,
    archive_project,
    create_project,
    ensure_default_project,
    list_projects,
    restore_project,
    set_default_project,
    update_project,
)

router = APIRouter(prefix="/projects", tags=["Projects"])


class ProjectCreateRequest(BaseModel):
    name: str
    description: str = ""


class ProjectUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None


class ProjectListResponse(BaseModel):
    default_project_id: str | None
    projects: list[Project] = Field(default_factory=list)


def _list_response() -> ProjectListResponse:
    default_id, projects = list_projects()
    return ProjectListResponse(default_project_id=default_id, projects=projects)


@router.get("", response_model=ProjectListResponse)
async def list_all_projects():
    ensure_default_project()
    return _list_response()


@router.post("", response_model=Project)
async def create_new_project(request: ProjectCreateRequest):
    ensure_default_project()
    name = request.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="内容空间名称不能为空。")
    return create_project(
        name=name,
        description=request.description.strip(),
    )


@router.put("/{project_id}", response_model=Project)
async def edit_project(project_id: str, request: ProjectUpdateRequest):
    ensure_default_project()
    if request.name is not None and not request.name.strip():
        raise HTTPException(status_code=400, detail="项目名称不能为空。")
    patch = request.model_dump(exclude_none=True)
    if "name" in patch:
        patch["name"] = patch["name"].strip()
    if "description" in patch:
        patch["description"] = patch["description"].strip()
    project = update_project(project_id, patch)
    if project is None:
        raise HTTPException(status_code=404, detail="项目不存在。")
    return project


@router.post("/{project_id}/archive", response_model=ProjectListResponse)
async def archive(project_id: str):
    ensure_default_project()
    default_id, projects = list_projects()
    target = next((p for p in projects if p.project_id == project_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail="项目不存在。")
    active = [p for p in projects if p.status == "active"]
    if target.status == "active" and len(active) <= 1:
        raise HTTPException(
            status_code=400,
            detail="这是最后一个内容空间，不能归档。",
        )
    if project_id == default_id:
        replacement = next(p for p in active if p.project_id != project_id)
        set_default_project(replacement.project_id)
    archive_project(project_id)
    return _list_response()


@router.post("/{project_id}/restore", response_model=ProjectListResponse)
async def restore(project_id: str):
    ensure_default_project()
    if not restore_project(project_id):
        raise HTTPException(status_code=404, detail="项目不存在。")
    return _list_response()


__all__ = ["router"]
