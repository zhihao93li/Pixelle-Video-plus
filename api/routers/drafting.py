"""起草配方与 Prompt 模板的自助管理 API。

目标：新增/修改起草配方（Prompt + 模型 + 语言）零代码。
Prompt 模板 = ``data/prompt_templates/{kind}/*.md`` 文件；内置模板只读，
可"复制为自定义"后编辑。名称由文件名派生（stem → Title Case），
写入时反向生成文件名并以读取端的同一规则回读名称，保证名实一致。
"""

import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from pixelle_video.content.drafting_profiles import (
    DraftingProfile,
    create_profile,
    get_profile,
    get_profile_by_project,
    list_profiles,
    update_profile,
)
from pixelle_video.utils.os_util import get_data_path
from web.utils.script_review import load_prompt_templates

router = APIRouter(prefix="/drafting", tags=["Drafting Profiles"])

PROMPT_KINDS = {"script", "split"}


# ---------------------------------------------------------------------------
# 起草配方
# ---------------------------------------------------------------------------


class DraftingProfileCreateRequest(BaseModel):
    project_id: str
    name: str
    script_template_name: str
    split_template_name: str
    script_model: str = ""
    split_model: str = ""
    languages: list[str] = Field(default_factory=lambda: ["Chinese"])
    language_script_models: dict[str, str] = Field(default_factory=dict)


class DraftingProfilePatchRequest(BaseModel):
    name: str | None = None
    script_template_name: str | None = None
    split_template_name: str | None = None
    script_model: str | None = None
    split_model: str | None = None
    languages: list[str] | None = None
    language_script_models: dict[str, str] | None = None


class DraftingProfileListResponse(BaseModel):
    default_profile_id: str | None
    profiles: list[DraftingProfile]


def _validate_template_names(
    script_template_name: str | None, split_template_name: str | None
) -> None:
    if script_template_name is not None:
        names = {t.name for t in load_prompt_templates("script")}
        if script_template_name not in names:
            raise HTTPException(
                status_code=400, detail=f"脚本 Prompt 不存在：{script_template_name}"
            )
    if split_template_name is not None:
        names = {t.name for t in load_prompt_templates("split")}
        if split_template_name not in names:
            raise HTTPException(
                status_code=400, detail=f"分镜 Prompt 不存在：{split_template_name}"
            )


@router.get("/profiles", response_model=DraftingProfileListResponse)
async def list_drafting_profiles():
    default_id, profiles = list_profiles()
    return DraftingProfileListResponse(
        default_profile_id=default_id, profiles=profiles
    )


@router.post("/profiles", response_model=DraftingProfile)
async def create_drafting_profile(request: DraftingProfileCreateRequest):
    project_id = request.project_id.strip()
    if not project_id:
        raise HTTPException(status_code=400, detail="缺少项目。")
    name = request.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="名称不能为空。")
    # 配方与项目 1:1：一个项目只能有一份起草配置
    if get_profile_by_project(project_id) is not None:
        raise HTTPException(
            status_code=400, detail="每个项目只有一份起草配置。"
        )
    _validate_template_names(
        request.script_template_name, request.split_template_name
    )
    return create_profile(
        name=name,
        script_template_name=request.script_template_name,
        split_template_name=request.split_template_name,
        script_model=request.script_model.strip(),
        split_model=request.split_model.strip(),
        languages=[l for l in request.languages if l.strip()] or ["Chinese"],
        language_script_models=request.language_script_models,
        project_id=project_id,
    )


@router.put("/profiles/{profile_id}", response_model=DraftingProfile)
async def patch_drafting_profile(
    profile_id: str, request: DraftingProfilePatchRequest
):
    _validate_template_names(
        request.script_template_name, request.split_template_name
    )
    patch = request.model_dump(exclude_none=True)
    if "name" in patch and not patch["name"].strip():
        raise HTTPException(status_code=400, detail="起草配置名称不能为空。")
    profile = update_profile(profile_id, patch)
    if profile is None:
        raise HTTPException(status_code=404, detail="起草配置不存在。")
    return profile


@router.delete("/profiles/{profile_id}")
async def delete_drafting_profile(profile_id: str):
    # 起草配置随项目存在，不能单独删除
    raise HTTPException(
        status_code=400,
        detail="起草配置随项目存在，不能单独删除。",
    )


# ---------------------------------------------------------------------------
# Prompt 模板（自定义文件的 CRUD；内置只读）
# ---------------------------------------------------------------------------


class PromptTemplateWriteRequest(BaseModel):
    kind: str
    name: str
    content: str


def _prompt_dir(kind: str) -> Path:
    directory = Path(get_data_path("prompt_templates", kind))
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _name_to_filename(name: str) -> str:
    # 与读取端 stem → Title Case 规则互逆：空格转下划线、小写化 ASCII
    slug = name.strip().replace(" ", "_").lower()
    slug = re.sub(r"[^0-9a-z_一-鿿-]", "", slug)
    if not slug:
        raise HTTPException(status_code=400, detail="模板名称无法生成有效文件名。")
    return f"{slug}.md"


def _derived_name(filename: str) -> str:
    stem = Path(filename).stem
    return stem.replace("_", " ").replace("-", " ").title()


def _find_custom_template_path(kind: str, name: str) -> Path | None:
    for template in load_prompt_templates(kind):
        if template.name == name and template.source != "builtin":
            return Path(template.source)
    return None


def _template_names(kind: str) -> set[str]:
    return {t.name for t in load_prompt_templates(kind)}


@router.post("/prompt-templates")
async def create_prompt_template(request: PromptTemplateWriteRequest):
    if request.kind not in PROMPT_KINDS:
        raise HTTPException(status_code=400, detail=f"未知模板类型：{request.kind}")
    content = request.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Prompt 内容不能为空。")

    filename = _name_to_filename(request.name)
    final_name = _derived_name(filename)
    if final_name in _template_names(request.kind):
        raise HTTPException(
            status_code=400, detail=f"已存在同名模板：{final_name}"
        )

    path = _prompt_dir(request.kind) / filename
    path.write_text(content, encoding="utf-8")
    return {"kind": request.kind, "name": final_name, "source": str(path)}


@router.put("/prompt-templates")
async def update_prompt_template(request: PromptTemplateWriteRequest):
    if request.kind not in PROMPT_KINDS:
        raise HTTPException(status_code=400, detail=f"未知模板类型：{request.kind}")
    content = request.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Prompt 内容不能为空。")

    path = _find_custom_template_path(request.kind, request.name)
    if path is None:
        raise HTTPException(
            status_code=400,
            detail="内置模板不可修改；请先「复制为自定义」再编辑。",
        )
    path.write_text(content, encoding="utf-8")
    return {"kind": request.kind, "name": request.name, "source": str(path)}


@router.delete("/prompt-templates")
async def delete_prompt_template(kind: str, name: str):
    if kind not in PROMPT_KINDS:
        raise HTTPException(status_code=400, detail=f"未知模板类型：{kind}")
    path = _find_custom_template_path(kind, name)
    if path is None:
        raise HTTPException(
            status_code=400, detail="内置模板不可删除，只能删除自定义模板。"
        )
    # 保护：仍被配方引用的模板不可删
    _, profiles = list_profiles()
    for profile in profiles:
        if name in {profile.script_template_name, profile.split_template_name}:
            raise HTTPException(
                status_code=400,
                detail=f"提示词正被「{profile.name}」使用，请先在对应项目里调整起草配置。",
            )
    path.unlink()
    return {"deleted": True, "kind": kind, "name": name}


__all__ = ["router", "get_profile", "list_profiles"]
