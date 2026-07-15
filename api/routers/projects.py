"""项目（品牌级内容线）管理 API。

项目是控制台的全局作用域维度：管默认生产模板、语言 + 每语言音色、
发布平台预选。"当前项目"是前端状态；这些接口显式接收/返回 project_id。
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
from pixelle_video.generation.templates import (
    ProductionTemplateError,
    build_default_production_template_registry,
)

router = APIRouter(prefix="/projects", tags=["Projects"])


class ProjectCreateRequest(BaseModel):
    name: str
    description: str = ""
    default_production_template_id: str | None = None
    languages: list[str] | None = None
    tts_voice_by_language: dict[str, str] | None = None
    publish_platforms: list[str] | None = None
    copy_from_project_id: str | None = None


class ProjectUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    default_production_template_id: str | None = None
    languages: list[str] | None = None
    tts_voice_by_language: dict[str, str] | None = None
    publish_platforms: list[str] | None = None


class SetDefaultProjectRequest(BaseModel):
    project_id: str


class ProjectListResponse(BaseModel):
    default_project_id: str | None
    projects: list[Project] = Field(default_factory=list)


def _validate_default(default_production_template_id: str | None) -> None:
    if default_production_template_id:
        registry = build_default_production_template_registry()
        try:
            template = registry.get(default_production_template_id)
        except ProductionTemplateError:
            raise HTTPException(
                status_code=400,
                detail=f"默认生产模板不存在：{default_production_template_id}",
            )
        if not template.enabled:
            raise HTTPException(
                status_code=400,
                detail="该生产模板不可提交，请换一个可用的模板作为默认。",
            )


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
        raise HTTPException(status_code=400, detail="项目名称不能为空。")
    _validate_default(request.default_production_template_id)
    languages = (
        [language for language in request.languages if language.strip()]
        if request.languages is not None
        else None
    )
    return create_project(
        name=name,
        description=request.description.strip(),
        default_production_template_id=request.default_production_template_id,
        languages=languages,
        tts_voice_by_language=request.tts_voice_by_language,
        publish_platforms=request.publish_platforms,
        copy_from_project_id=request.copy_from_project_id,
    )


# 注意路由顺序：/default 必须在 /{project_id} 之前，否则会被后者吞掉。
@router.put("/default", response_model=ProjectListResponse)
async def set_default(request: SetDefaultProjectRequest):
    ensure_default_project()
    if not set_default_project(request.project_id):
        raise HTTPException(
            status_code=400,
            detail="该项目不存在或已归档，无法设为默认。",
        )
    return _list_response()


@router.put("/{project_id}", response_model=Project)
async def edit_project(project_id: str, request: ProjectUpdateRequest):
    ensure_default_project()
    if request.name is not None and not request.name.strip():
        raise HTTPException(status_code=400, detail="项目名称不能为空。")
    if request.languages is not None and not [
        language for language in request.languages if language.strip()
    ]:
        raise HTTPException(status_code=400, detail="至少需要一种语言。")
    _validate_default(request.default_production_template_id)
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
    if project_id == default_id:
        raise HTTPException(
            status_code=400,
            detail="这是默认项目，请先把默认项目转移到其他项目，再归档。",
        )
    active = [p for p in projects if p.status == "active"]
    if target.status == "active" and len(active) <= 1:
        raise HTTPException(
            status_code=400,
            detail="这是最后一个进行中的项目，不能归档。",
        )
    archive_project(project_id)
    return _list_response()


@router.post("/{project_id}/restore", response_model=ProjectListResponse)
async def restore(project_id: str):
    ensure_default_project()
    if not restore_project(project_id):
        raise HTTPException(status_code=404, detail="项目不存在。")
    return _list_response()


__all__ = ["router"]
