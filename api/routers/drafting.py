"""Prompt 模板的自助管理 API。

Prompt 模板 = ``data/prompt_templates/{kind}/*.md`` 文件；内置模板只读，
可"复制为自定义"后编辑。名称由文件名派生（stem → Title Case），
写入时反向生成文件名并以读取端的同一规则回读名称，保证名实一致。
"""

import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from pixelle_video.generation.drafting_support import DEFAULT_DRAFT_LANGUAGES, load_prompt_templates
from pixelle_video.generation.templates import build_default_production_template_registry
from pixelle_video.utils.os_util import get_data_path

router = APIRouter(prefix="/drafting", tags=["Prompt Templates"])

PROMPT_KINDS = {"script", "split"}


# ---------------------------------------------------------------------------
# Prompt 模板（自定义文件的 CRUD；内置只读）
# ---------------------------------------------------------------------------


class PromptTemplateWriteRequest(BaseModel):
    kind: str
    name: str
    content: str
    new_name: str | None = None


class PromptTemplateResponse(BaseModel):
    name: str
    content: str
    source: str


class PromptTemplateListResponse(BaseModel):
    default_languages: list[str]
    script_templates: list[PromptTemplateResponse] = Field(default_factory=list)
    split_templates: list[PromptTemplateResponse] = Field(default_factory=list)


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


@router.get("/prompt-templates", response_model=PromptTemplateListResponse)
async def list_prompt_templates():
    return PromptTemplateListResponse(
        default_languages=list(DEFAULT_DRAFT_LANGUAGES),
        script_templates=[
            PromptTemplateResponse(name=item.name, content=item.content, source=item.source)
            for item in load_prompt_templates("script")
        ],
        split_templates=[
            PromptTemplateResponse(name=item.name, content=item.content, source=item.source)
            for item in load_prompt_templates("split")
        ],
    )


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
        raise HTTPException(status_code=400, detail=f"已存在同名模板：{final_name}")

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
    final_path = path
    final_name = request.name
    if request.new_name and request.new_name.strip() != request.name:
        for recipe in build_default_production_template_registry().list():
            if request.name in {
                recipe.fixed_params.get("script_template_name"),
                recipe.fixed_params.get("split_template_name"),
            }:
                raise HTTPException(
                    status_code=400,
                    detail=f"提示词正被模板「{recipe.display_name}」使用，请先调整该模板。",
                )
        filename = _name_to_filename(request.new_name)
        final_name = _derived_name(filename)
        if final_name in _template_names(request.kind):
            raise HTTPException(status_code=400, detail=f"已存在同名模板：{final_name}")
        final_path = _prompt_dir(request.kind) / filename
        path.rename(final_path)
    final_path.write_text(content, encoding="utf-8")
    return {"kind": request.kind, "name": final_name, "source": str(final_path)}


@router.delete("/prompt-templates")
async def delete_prompt_template(kind: str, name: str):
    if kind not in PROMPT_KINDS:
        raise HTTPException(status_code=400, detail=f"未知模板类型：{kind}")
    path = _find_custom_template_path(kind, name)
    if path is None:
        raise HTTPException(status_code=400, detail="内置模板不可删除，只能删除自定义模板。")
    # 保护：仍被模板引用的模板不可删
    recipes = build_default_production_template_registry().list()
    for recipe in recipes:
        if name in {
            recipe.fixed_params.get("script_template_name"),
            recipe.fixed_params.get("split_template_name"),
        }:
            raise HTTPException(
                status_code=400,
                detail=f"提示词正被模板「{recipe.display_name}」使用，请先调整该模板。",
            )
    path.unlink()
    return {"deleted": True, "kind": kind, "name": name}


__all__ = ["router"]
