import json
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from api.dependencies import GenerationServiceDep, PixelleVideoDep
from pixelle_video.generation import (
    GenerationProgress,
    GenerationRequest,
    GenerationResult,
    GenerationTask,
    PipelineManifest,
    ProductionTemplate,
    ProductionTemplateError,
    build_default_production_template_registry,
    detect_available_generation_capabilities,
)
from pixelle_video.utils.os_util import get_data_path
from web.utils.script_review import (
    DEFAULT_REVIEW_LANGUAGES,
    PromptTemplate,
    build_generation_jobs,
    generate_independent_language_drafts,
    load_prompt_templates,
    validate_draft_translation_counts,
    validate_language_tts_overrides,
)

router = APIRouter(prefix="/generation", tags=["Generation Pipelines"])

GENERATION_ASSET_UPLOAD_DIR: Path | None = None
GENERATION_BATCH_DIR: Path | None = None
GENERATION_SCRIPT_REVIEW_DIR: Path | None = None
GENERATION_ASSET_TYPES = {
    ".jpg": "image",
    ".jpeg": "image",
    ".png": "image",
    ".gif": "image",
    ".webp": "image",
    ".mp4": "video",
    ".mov": "video",
    ".avi": "video",
    ".mkv": "video",
    ".webm": "video",
    ".mp3": "audio",
    ".wav": "audio",
    ".flac": "audio",
    ".m4a": "audio",
    ".aac": "audio",
    ".ogg": "audio",
}


class PipelineListResponse(BaseModel):
    default_pipeline: str | None
    pipelines: list[PipelineManifest]


class ProductionTemplateListResponse(BaseModel):
    default_template: str | None
    templates: list[ProductionTemplate]


class ProductionTemplateTaskRequest(BaseModel):
    input: dict
    metadata: dict = Field(default_factory=dict)
    idempotency_key: str | None = None


class ProductionTemplateBatchItemRequest(BaseModel):
    input: dict
    metadata: dict = Field(default_factory=dict)
    idempotency_key: str | None = None


class ProductionTemplateBatchRequest(BaseModel):
    template_id: str
    items: list[ProductionTemplateBatchItemRequest] = Field(..., min_length=1, max_length=100)
    metadata: dict = Field(default_factory=dict)
    idempotency_key: str | None = None


class ProductionTemplateCloneRequest(BaseModel):
    source_template_id: str
    id: str
    display_name: str
    description: str | None = None
    fixed_params_patch: dict = Field(default_factory=dict)


class GenerationSubmitResponse(BaseModel):
    success: bool = True
    message: str = "Generation task created successfully"
    generation_task_id: str
    task: GenerationTask


class UploadedGenerationAsset(BaseModel):
    original_filename: str
    filename: str
    path: str
    kind: str
    content_type: str | None = None
    size: int


class GenerationAssetUploadResponse(BaseModel):
    count: int
    assets: list[UploadedGenerationAsset]


class GenerationBatchItem(BaseModel):
    index: int
    input: dict
    params: dict = Field(default_factory=dict)
    metadata: dict
    task_id: str | None = None
    status: str
    progress: GenerationProgress | None = None
    error: dict | None = None


class GenerationBatchResponse(BaseModel):
    batch_id: str
    template_id: str
    status: str
    total_count: int
    submitted_count: int
    failed_count: int
    created_at: str
    updated_at: str
    metadata: dict
    items: list[GenerationBatchItem]


class GenerationBatchListResponse(BaseModel):
    batches: list[GenerationBatchResponse]


class ScriptReviewPromptTemplateResponse(BaseModel):
    name: str
    content: str
    source: str


class ScriptReviewTemplateListResponse(BaseModel):
    default_languages: list[str]
    script_templates: list[ScriptReviewPromptTemplateResponse]
    split_templates: list[ScriptReviewPromptTemplateResponse]


class ScriptReviewDraftCreateRequest(BaseModel):
    topics: list[str] = Field(..., min_length=1, max_length=50)
    # None = 未显式指定语言，走配方默认（与旧默认区分开）
    languages: list[str] | None = None
    drafting_profile_id: str | None = None
    project_id: str | None = None
    script_template_name: str | None = None
    split_template_name: str | None = None
    script_model: str | None = None
    split_model: str | None = None
    language_script_templates: dict[str, str] = Field(default_factory=dict)
    language_script_models: dict[str, str] = Field(default_factory=dict)
    metadata: dict = Field(default_factory=dict)
    idempotency_key: str | None = None


class ScriptReviewDraftUpdateRequest(BaseModel):
    drafts: list[dict]
    metadata: dict = Field(default_factory=dict)


class ScriptReviewSubmitRequest(BaseModel):
    drafts: list[dict] | None = None
    template_id: str | None = None
    base_params: dict = Field(default_factory=dict)
    language_tts_overrides: dict[str, dict] = Field(default_factory=dict)
    metadata: dict = Field(default_factory=dict)
    idempotency_key: str | None = None


class ScriptReviewDraftSetResponse(BaseModel):
    draft_set_id: str
    status: str
    created_at: str
    updated_at: str
    topics: list[str]
    languages: list[str]
    metadata: dict
    draft_settings: dict
    drafts: list[dict]
    errors: list[dict]
    submissions: list[dict] = Field(default_factory=list)


class ScriptReviewDraftSetListResponse(BaseModel):
    draft_sets: list[ScriptReviewDraftSetResponse]


class ScriptReviewSubmitResponse(BaseModel):
    draft_set: ScriptReviewDraftSetResponse
    batch: GenerationBatchResponse


@router.get("/pipelines", response_model=PipelineListResponse)
async def list_generation_pipelines(pixelle_video: PixelleVideoDep):
    manifests = pixelle_video.pipeline_registry.list_manifests()
    default_pipeline = (
        "standard" if "standard" in pixelle_video.pipeline_registry.pipeline_ids() else None
    )

    return PipelineListResponse(
        default_pipeline=default_pipeline,
        pipelines=manifests,
    )


@router.get("/templates", response_model=ProductionTemplateListResponse)
async def list_generation_templates(project: str | None = None):
    from pixelle_video.generation.templates import annotate_retired

    registry = build_default_production_template_registry()
    templates = registry.list()
    annotate_retired(templates)  # 展示用退役标记（代码层停用的 generate 预设）
    return ProductionTemplateListResponse(
        default_template=_default_template_for_project(project),
        templates=templates,
    )


class TemplateGenerationConfigResponse(BaseModel):
    template_id: str
    overridable_keys: list[str]
    overrides: dict[str, Any]
    effective_params: dict[str, Any]


class TemplateGenerationConfigUpdateRequest(BaseModel):
    overrides: dict[str, Any]


def _template_generation_config_response(
    template_id: str,
) -> TemplateGenerationConfigResponse:
    from pixelle_video.generation.template_overrides import (
        OVERRIDABLE_PARAMS,
        load_overrides,
    )

    registry = build_default_production_template_registry()
    try:
        template = registry.get(template_id)
    except ProductionTemplateError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

    allowed = set(template.allowed_user_params)
    overridable = [key for key in OVERRIDABLE_PARAMS if key in allowed]
    return TemplateGenerationConfigResponse(
        template_id=template.id,
        overridable_keys=overridable,
        overrides=load_overrides(template.id),
        effective_params={
            key: value for key, value in template.fixed_params.items() if key in OVERRIDABLE_PARAMS
        },
    )


@router.get(
    "/templates/{template_id}/generation-config",
    response_model=TemplateGenerationConfigResponse,
)
async def get_template_generation_config(template_id: str):
    """模板级默认生成配置（设置管接入，模板管默认，表单管这一次）。"""
    return _template_generation_config_response(template_id)


@router.put(
    "/templates/{template_id}/generation-config",
    response_model=TemplateGenerationConfigResponse,
)
async def update_template_generation_config(
    template_id: str,
    request: TemplateGenerationConfigUpdateRequest,
):
    from pixelle_video.generation.template_overrides import (
        TemplateOverrideError,
        save_overrides,
        validate_overrides,
    )

    registry = build_default_production_template_registry()
    try:
        template = registry.get(template_id)
    except ProductionTemplateError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

    try:
        cleaned = validate_overrides(
            request.overrides,
            allowed_user_params=template.allowed_user_params,
        )
    except TemplateOverrideError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    save_overrides(template_id, cleaned)
    return _template_generation_config_response(template_id)


class TemplateEnabledRequest(BaseModel):
    enabled: bool


def _project_using_default_template(template_id: str) -> str | None:
    """返回把该模板设为默认生产模板的项目名（含 archived）；无则 None。"""
    from pixelle_video.content.projects import list_projects

    _, projects = list_projects()
    for project in projects:
        if project.default_production_template_id == template_id:
            return project.name
    return None


@router.put("/templates/{template_id}/enabled", response_model=ProductionTemplate)
async def set_template_enabled(template_id: str, request: TemplateEnabledRequest):
    """用户侧启用/停用模板（退役的内置模板不可启用；被项目默认引用的不可停用）。"""
    from pixelle_video.generation.template_overrides import save_enabled
    from pixelle_video.generation.templates import code_level_enabled

    registry = build_default_production_template_registry()
    try:
        registry.get(template_id)
    except ProductionTemplateError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

    if request.enabled:
        if code_level_enabled(template_id) is False:
            raise HTTPException(
                status_code=400,
                detail="该模板已退役，不能启用；如需类似能力请克隆骨架模板。",
            )
        # 清除停用开关，回到代码默认启用
        save_enabled(template_id, None)
    else:
        used_by = _project_using_default_template(template_id)
        if used_by:
            raise HTTPException(
                status_code=400,
                detail=f"项目「{used_by}」正在用它作默认模板，请先换默认再停用。",
            )
        save_enabled(template_id, False)

    return build_default_production_template_registry().get(template_id)


@router.post("/templates", response_model=ProductionTemplate)
async def clone_production_template(request_body: ProductionTemplateCloneRequest):
    """从现有生产模板克隆一条自定义风格线（不改代码新增模板）。"""
    from pixelle_video.generation.custom_templates import save_custom_template

    new_id = request_body.id.strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]+", new_id):
        raise HTTPException(
            status_code=400,
            detail="模板 id 只能包含字母、数字、下划线和连字符。",
        )
    display_name = request_body.display_name.strip()
    if not display_name:
        raise HTTPException(status_code=400, detail="模板名称不能为空。")

    registry = build_default_production_template_registry()
    try:
        source = registry.get(request_body.source_template_id)
    except ProductionTemplateError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

    if new_id in {template.id for template in registry.list()}:
        raise HTTPException(status_code=400, detail=f"模板 id 已存在：{new_id}")

    patch = request_body.fixed_params_patch or {}
    allowed = set(source.allowed_user_params)
    for key in patch:
        if key not in allowed:
            raise HTTPException(
                status_code=400,
                detail=f"参数 {key!r} 不在源模板允许的用户参数内，不能作为默认值覆盖。",
            )

    clone = source.model_copy(deep=True)
    clone.id = new_id
    clone.display_name = display_name
    clone.is_custom = True
    clone.enabled = True  # 克隆出来的自定义模板恒可用（即使源已退役）
    clone.project = None
    clone.channel = None
    if request_body.description is not None:
        clone.description = request_body.description
    clone.fixed_params.update(patch)

    save_custom_template(clone)
    return clone


@router.delete("/templates/{template_id}")
async def delete_production_template(template_id: str):
    """删除自定义模板；内置模板不可删除。"""
    from pixelle_video.generation.custom_templates import (
        custom_template_ids,
        delete_custom_template,
    )

    if template_id in custom_template_ids():
        delete_custom_template(template_id)
        return {"deleted": True, "id": template_id}

    registry = build_default_production_template_registry()
    if template_id in {template.id for template in registry.list()}:
        raise HTTPException(
            status_code=400,
            detail="内置模板不可删除，只能删除自定义模板。",
        )
    raise HTTPException(status_code=404, detail=f"未找到模板：{template_id}")


@router.post("/assets", response_model=GenerationAssetUploadResponse)
async def upload_generation_assets(files: list[UploadFile] = File(...)):
    if not files:
        raise HTTPException(status_code=400, detail="At least one asset file is required.")

    upload_dir = _asset_upload_dir()
    upload_dir.mkdir(parents=True, exist_ok=True)
    saved_paths: list[Path] = []
    assets: list[UploadedGenerationAsset] = []

    try:
        for upload in files:
            original_filename = _safe_original_filename(upload.filename)
            suffix = Path(original_filename).suffix.lower()
            kind = GENERATION_ASSET_TYPES.get(suffix)
            if not kind:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Unsupported asset file type: {suffix or 'missing extension'}. "
                        f"Allowed: {', '.join(sorted(GENERATION_ASSET_TYPES))}"
                    ),
                )

            content = await upload.read()
            if not content:
                raise HTTPException(
                    status_code=400,
                    detail=f"Asset file is empty: {original_filename}",
                )

            filename = _stored_asset_filename(original_filename)
            path = upload_dir / filename
            path.write_bytes(content)
            saved_paths.append(path)
            assets.append(
                UploadedGenerationAsset(
                    original_filename=original_filename,
                    filename=filename,
                    path=str(path.resolve()),
                    kind=kind,
                    content_type=upload.content_type,
                    size=len(content),
                )
            )
    except HTTPException:
        for path in saved_paths:
            path.unlink(missing_ok=True)
        raise

    return GenerationAssetUploadResponse(count=len(assets), assets=assets)


def _resolve_project_id(explicit: str | None) -> str:
    """Resolve a real project scope; never invent or silently substitute one."""
    from pixelle_video.content.projects import ensure_migrated, get_default_project, get_project

    ensure_migrated()
    if explicit:
        if get_project(explicit) is None:
            raise HTTPException(status_code=400, detail=f"Unknown project: {explicit}")
        return explicit
    project = get_default_project()
    if project is None:
        raise HTTPException(status_code=409, detail="No default project is configured.")
    return project.project_id


def _default_template_for_project(project_id: str | None) -> str | None:
    """默认生产模板：项目 default_production_template_id（须存在且 enabled）> registry 内置默认。"""
    registry = build_default_production_template_registry()
    if project_id:
        from pixelle_video.content.projects import get_project

        project = get_project(project_id)
        if project and project.default_production_template_id:
            try:
                template = registry.get(project.default_production_template_id)
            except ProductionTemplateError:
                template = None
            if template is not None and template.enabled:
                return template.id
    return registry.default_template_id(project="PetWoods", channel="xiaohongshu")


@router.post("/templates/{template_id}/tasks", response_model=GenerationSubmitResponse)
async def submit_generation_template_task(
    template_id: str,
    request_body: ProductionTemplateTaskRequest,
    generation_service: GenerationServiceDep,
):
    registry = build_default_production_template_registry()
    metadata = {
        **request_body.metadata,
        "project_id": _resolve_project_id(request_body.metadata.get("project_id")),
    }
    try:
        generation_request = registry.compile_request(
            template_id,
            input=request_body.input,
            metadata=metadata,
            idempotency_key=request_body.idempotency_key,
            available_capabilities=detect_available_generation_capabilities(),
        )
        task = generation_service.submit(generation_request)
        return GenerationSubmitResponse(
            generation_task_id=task.task_id,
            task=task,
        )
    except ProductionTemplateError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None


@router.post("/batches", response_model=GenerationBatchResponse)
async def submit_generation_batch(
    request_body: ProductionTemplateBatchRequest,
    generation_service: GenerationServiceDep,
):
    """Create a persisted batch and submit each item as a real generation task."""
    registry = build_default_production_template_registry()
    batch_id = uuid.uuid4().hex
    now = _now_iso()
    project_id = _resolve_project_id(request_body.metadata.get("project_id"))
    items: list[dict] = []

    for index, item in enumerate(request_body.items, start=1):
        item_metadata = {
            **request_body.metadata,
            **item.metadata,
            "source": item.metadata.get("source")
            or request_body.metadata.get("source")
            or "react_batch",
            "project_id": item.metadata.get("project_id")
            or request_body.metadata.get("project_id")
            or project_id,
            "batch_id": batch_id,
            "batch_index": index,
        }
        idempotency_key = item.idempotency_key
        if not idempotency_key and request_body.idempotency_key:
            idempotency_key = f"{request_body.idempotency_key}:{index}"

        try:
            generation_request = registry.compile_request(
                request_body.template_id,
                input=item.input,
                metadata=item_metadata,
                idempotency_key=idempotency_key,
                available_capabilities=detect_available_generation_capabilities(),
            )
            task = generation_service.submit(generation_request)
            items.append(
                {
                    "index": index,
                    "input": item.input,
                    "metadata": item_metadata,
                    "task_id": task.task_id,
                    "status": task.status,
                    "progress": task.progress.model_dump(mode="json"),
                    "error": None,
                }
            )
        except (ProductionTemplateError, ValueError) as exc:
            items.append(
                {
                    "index": index,
                    "input": item.input,
                    "metadata": item_metadata,
                    "task_id": None,
                    "status": "failed",
                    "progress": None,
                    "error": {
                        "layer": "input",
                        "message": str(exc),
                        "exception_type": type(exc).__name__,
                    },
                }
            )

    batch = {
        "batch_id": batch_id,
        "template_id": request_body.template_id,
        "status": "submitted",
        "created_at": now,
        "updated_at": now,
        "metadata": {**request_body.metadata, "project_id": project_id},
        "items": items,
    }
    batch = _hydrate_batch(batch, generation_service)
    _save_batch(batch)
    return batch


@router.get("/batches", response_model=GenerationBatchListResponse)
async def list_generation_batches(generation_service: GenerationServiceDep):
    batches = [_hydrate_batch(batch, generation_service) for batch in _load_batches()]
    for batch in batches:
        _save_batch(batch)
    return GenerationBatchListResponse(
        batches=sorted(batches, key=lambda batch: batch["created_at"], reverse=True)
    )


@router.get("/batches/{batch_id}", response_model=GenerationBatchResponse)
async def get_generation_batch(
    batch_id: str,
    generation_service: GenerationServiceDep,
):
    batch = _load_batch(batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail=f"Generation batch not found: {batch_id}")
    batch = _hydrate_batch(batch, generation_service)
    _save_batch(batch)
    return batch


@router.delete("/batches/{batch_id}", response_model=GenerationBatchResponse)
async def cancel_generation_batch(
    batch_id: str,
    generation_service: GenerationServiceDep,
):
    batch = _load_batch(batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail=f"Generation batch not found: {batch_id}")

    batch = _hydrate_batch(batch, generation_service)
    for item in batch.get("items", []):
        if item.get("status") not in {"pending", "submitted", "running"}:
            continue
        task_id = item.get("task_id")
        if not task_id:
            continue
        task = generation_service.cancel_task(task_id)
        item["status"] = task.status
        item["progress"] = task.progress.model_dump(mode="json")
        item["error"] = task.error.model_dump(mode="json") if task.error else None

    batch = _hydrate_batch(batch, generation_service)
    _save_batch(batch)
    return batch


@router.post(
    "/batches/{batch_id}/items/{item_index}/retry",
    response_model=GenerationBatchResponse,
)
async def retry_generation_batch_item(
    batch_id: str,
    item_index: int,
    generation_service: GenerationServiceDep,
):
    batch = _load_batch(batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail=f"Generation batch not found: {batch_id}")

    batch = _hydrate_batch(batch, generation_service)
    item = _find_batch_item(batch, item_index)
    if item is None:
        raise HTTPException(
            status_code=404, detail=f"Generation batch item not found: {item_index}"
        )
    if item.get("status") not in {"failed", "cancelled"}:
        raise HTTPException(
            status_code=409,
            detail=f"Only failed or cancelled batch items can be retried. Current status: {item.get('status')}",
        )

    retry_count = int((item.get("metadata") or {}).get("retry_count") or 0) + 1
    metadata = {
        **batch.get("metadata", {}),
        **(item.get("metadata") or {}),
        "source": "react_batch_retry",
        "batch_id": batch_id,
        "batch_index": item_index,
        "retry_count": retry_count,
        "retry_of_task_id": item.get("task_id"),
    }
    try:
        generation_request = _compile_batch_retry_request(
            batch=batch,
            item=item,
            metadata=metadata,
        )
        task = generation_service.submit(generation_request)
        item.update(
            {
                "metadata": metadata,
                "task_id": task.task_id,
                "status": task.status,
                "progress": task.progress.model_dump(mode="json"),
                "error": None,
            }
        )
    except (ProductionTemplateError, ValueError) as exc:
        item.update(
            {
                "metadata": metadata,
                "status": "failed",
                "progress": None,
                "error": {
                    "layer": "input",
                    "message": str(exc),
                    "exception_type": type(exc).__name__,
                },
            }
        )

    batch = _hydrate_batch(batch, generation_service)
    _save_batch(batch)
    return batch


@router.get("/script-review/templates", response_model=ScriptReviewTemplateListResponse)
async def list_script_review_templates():
    return ScriptReviewTemplateListResponse(
        default_languages=list(DEFAULT_REVIEW_LANGUAGES),
        script_templates=[
            _prompt_template_response(template) for template in load_prompt_templates("script")
        ],
        split_templates=[
            _prompt_template_response(template) for template in load_prompt_templates("split")
        ],
    )


@router.post("/script-review/draft-sets", response_model=ScriptReviewDraftSetResponse)
async def create_script_review_draft_set(
    request_body: ScriptReviewDraftCreateRequest,
    pixelle_video: PixelleVideoDep,
):
    topics = _clean_string_items(request_body.topics, "topics")
    if not getattr(pixelle_video, "llm", None):
        raise HTTPException(status_code=400, detail="LLM service is not available.")

    # 起草配置解析链：显式 drafting_profile_id（API 兼容）> 项目起草配置（自愈补建）> 安全内置
    from pixelle_video.content.drafting_profiles import (
        get_profile,
        get_profile_for_project,
    )

    resolved_project_id = _resolve_project_id(request_body.project_id)

    profile = None
    if request_body.drafting_profile_id:
        profile = get_profile(request_body.drafting_profile_id)
        if profile is None:
            raise HTTPException(status_code=404, detail="起草配置不存在。")
    else:
        # 项目配置是唯一入口，缺失时自愈补建，恒非 None
        profile = get_profile_for_project(resolved_project_id)

    languages = _clean_string_items(
        request_body.languages
        if request_body.languages is not None
        else (profile.languages if profile else list(DEFAULT_REVIEW_LANGUAGES)),
        "languages",
    )
    if not languages:
        raise HTTPException(status_code=400, detail="At least one language is required.")

    script_template_name = request_body.script_template_name or (
        profile.script_template_name if profile else None
    )
    split_template_name = request_body.split_template_name or (
        profile.split_template_name if profile else None
    )
    script_model = request_body.script_model or (profile.script_model if profile else None) or None
    split_model = request_body.split_model or (profile.split_model if profile else None) or None
    language_script_models = {
        **(profile.language_script_models if profile else {}),
        **request_body.language_script_models,
    }

    script_template = _resolve_prompt_template("script", script_template_name)
    split_template = _resolve_prompt_template("split", split_template_name)
    draft_set_id = request_body.idempotency_key or uuid.uuid4().hex
    now = _now_iso()
    drafts: list[dict] = []
    errors: list[dict] = []

    for index, topic in enumerate(topics, start=1):
        try:
            draft = await generate_independent_language_drafts(
                llm_service=pixelle_video.llm,
                topic=topic,
                script_template=script_template.content,
                script_model=script_model,
                split_template=split_template.content,
                split_model=split_model,
                languages=languages,
                language_script_templates=request_body.language_script_templates,
                language_script_models=language_script_models,
            )
            draft["selected_for_generation"] = True
            draft["index"] = index
            drafts.append(draft)
        except Exception as exc:
            errors.append(
                {
                    "topic": topic,
                    "layer": "runtime",
                    "message": str(exc),
                    "exception_type": type(exc).__name__,
                }
            )

    if not drafts and errors:
        status = "failed"
    elif errors:
        status = "partial_failed"
    else:
        status = "drafted"

    draft_set = {
        "draft_set_id": draft_set_id,
        "status": status,
        "created_at": now,
        "updated_at": now,
        "topics": topics,
        "languages": languages,
        "metadata": request_body.metadata,
        "draft_settings": {
            "script_template_name": script_template.name,
            "project_id": resolved_project_id,
            "drafting_profile_id": profile.profile_id if profile else None,
            "drafting_profile_name": profile.name if profile else None,
            "script_template_source": script_template.source,
            "split_template_name": split_template.name,
            "split_template_source": split_template.source,
            "script_model": script_model or "",
            "split_model": split_model or "",
            "language_script_templates": {
                language: "custom" for language in request_body.language_script_templates
            },
            "language_script_models": language_script_models,
        },
        "drafts": drafts,
        "errors": errors,
        "submissions": [],
    }
    _save_script_review_draft_set(draft_set)
    return draft_set


@router.get("/script-review/draft-sets", response_model=ScriptReviewDraftSetListResponse)
async def list_script_review_draft_sets(project: str | None = None):
    draft_sets = _load_script_review_draft_sets()
    if project is not None:
        # 旧草稿集无 project_id → 视为默认项目（读取端兜底，不回填数据）。
        default_project = _resolve_project_id(None)
        draft_sets = [
            draft_set
            for draft_set in draft_sets
            if (draft_set.get("draft_settings", {}).get("project_id") or default_project) == project
        ]
    return ScriptReviewDraftSetListResponse(
        draft_sets=sorted(
            draft_sets,
            key=lambda draft_set: draft_set["created_at"],
            reverse=True,
        )
    )


@router.get("/script-review/draft-sets/{draft_set_id}", response_model=ScriptReviewDraftSetResponse)
async def get_script_review_draft_set(draft_set_id: str):
    draft_set = _load_script_review_draft_set(draft_set_id)
    if draft_set is None:
        raise HTTPException(
            status_code=404, detail=f"Script review draft set not found: {draft_set_id}"
        )
    return draft_set


@router.put("/script-review/draft-sets/{draft_set_id}", response_model=ScriptReviewDraftSetResponse)
async def update_script_review_draft_set(
    draft_set_id: str,
    request_body: ScriptReviewDraftUpdateRequest,
):
    draft_set = _load_script_review_draft_set(draft_set_id)
    if draft_set is None:
        raise HTTPException(
            status_code=404, detail=f"Script review draft set not found: {draft_set_id}"
        )
    draft_set["drafts"] = request_body.drafts
    draft_set["metadata"] = {
        **(draft_set.get("metadata") or {}),
        **request_body.metadata,
    }
    draft_set["status"] = "reviewed"
    draft_set["updated_at"] = _now_iso()
    _save_script_review_draft_set(draft_set)
    return draft_set


@router.post(
    "/script-review/draft-sets/{draft_set_id}/tasks",
    response_model=ScriptReviewSubmitResponse,
)
async def submit_script_review_draft_set_tasks(
    draft_set_id: str,
    request_body: ScriptReviewSubmitRequest,
    generation_service: GenerationServiceDep,
):
    draft_set = _load_script_review_draft_set(draft_set_id)
    if draft_set is None:
        raise HTTPException(
            status_code=404, detail=f"Script review draft set not found: {draft_set_id}"
        )

    drafts = request_body.drafts if request_body.drafts is not None else draft_set.get("drafts", [])
    selected_drafts = [draft for draft in drafts if draft.get("selected_for_generation", True)]
    validation_errors: list[str] = []
    for draft in selected_drafts:
        validation_errors.extend(validate_draft_translation_counts(draft))
    validation_errors.extend(
        validate_language_tts_overrides(
            selected_drafts,
            request_body.language_tts_overrides,
        )
    )
    if validation_errors:
        raise HTTPException(status_code=400, detail=validation_errors[0])

    try:
        jobs = build_generation_jobs(
            selected_drafts,
            base_config=request_body.base_params,
            language_tts_overrides=request_body.language_tts_overrides,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None

    if not jobs:
        raise HTTPException(status_code=400, detail="No approved script review jobs to submit.")

    # 审核稿出片统一走生产模板体系（模板管默认，表单管这一次）。
    registry = build_default_production_template_registry()
    template_id = (
        request_body.template_id
        or _default_template_for_project(draft_set.get("draft_settings", {}).get("project_id"))
        or "pipeline_standard_base_v1"
    )
    try:
        template = registry.get(template_id)
    except ProductionTemplateError as error:
        raise HTTPException(status_code=400, detail=str(error)) from None
    if (
        not template.enabled
        or template.product_entry != "generate"
        or "script" not in template.input_requirements
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Production template {template_id!r} cannot render reviewed scripts; "
                "choose an enabled script-input template."
            ),
        )

    batch = _submit_generation_jobs_as_batch(
        registry=registry,
        template_id=template_id,
        jobs=jobs,
        generation_service=generation_service,
        metadata={
            **request_body.metadata,
            "source": request_body.metadata.get("source") or "react_script_review",
            "review_flow": "script_review",
            "draft_set_id": draft_set_id,
            "project_id": draft_set.get("draft_settings", {}).get("project_id")
            or _resolve_project_id(request_body.metadata.get("project_id")),
        },
        idempotency_key=request_body.idempotency_key,
    )
    _save_batch(batch)

    draft_set["drafts"] = drafts
    draft_set["status"] = "submitted"
    draft_set["updated_at"] = _now_iso()
    draft_set["submissions"] = [
        *(draft_set.get("submissions") or []),
        {
            "batch_id": batch["batch_id"],
            "submitted_at": draft_set["updated_at"],
            "task_count": batch["submitted_count"],
            "failed_count": batch["failed_count"],
        },
    ]
    _save_script_review_draft_set(draft_set)
    return ScriptReviewSubmitResponse(draft_set=draft_set, batch=batch)


@router.get("/pipelines/{pipeline_id}", response_model=PipelineManifest)
async def get_generation_pipeline(pipeline_id: str, pixelle_video: PixelleVideoDep):
    try:
        return pixelle_video.pipeline_registry.get_manifest(pipeline_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown pipeline: {pipeline_id}") from None


@router.post("/tasks", response_model=GenerationSubmitResponse)
async def submit_generation_task(
    request_body: GenerationRequest,
    generation_service: GenerationServiceDep,
):
    try:
        task = generation_service.submit(request_body)
        return GenerationSubmitResponse(
            generation_task_id=task.task_id,
            task=task,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None


@router.get("/tasks/{task_id}", response_model=GenerationTask)
async def get_generation_task(task_id: str, generation_service: GenerationServiceDep):
    try:
        return generation_service.get_task(task_id)
    except KeyError:
        raise HTTPException(
            status_code=404, detail=f"Generation task not found: {task_id}"
        ) from None


@router.get("/tasks/{task_id}/result", response_model=GenerationResult)
async def get_generation_task_result(task_id: str, generation_service: GenerationServiceDep):
    try:
        return generation_service.get_result(task_id)
    except KeyError:
        raise HTTPException(
            status_code=404, detail=f"Generation task not found: {task_id}"
        ) from None
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None


@router.delete("/tasks/{task_id}", response_model=GenerationTask)
async def cancel_generation_task(task_id: str, generation_service: GenerationServiceDep):
    try:
        return generation_service.cancel_task(task_id)
    except KeyError:
        raise HTTPException(
            status_code=404, detail=f"Generation task not found: {task_id}"
        ) from None


def _asset_upload_dir() -> Path:
    if GENERATION_ASSET_UPLOAD_DIR is not None:
        return Path(GENERATION_ASSET_UPLOAD_DIR)
    return Path(get_data_path("uploads", "generation-assets"))


def _batch_dir() -> Path:
    if GENERATION_BATCH_DIR is not None:
        return Path(GENERATION_BATCH_DIR)
    return Path(get_data_path("generation-batches"))


def _script_review_dir() -> Path:
    if GENERATION_SCRIPT_REVIEW_DIR is not None:
        return Path(GENERATION_SCRIPT_REVIEW_DIR)
    return Path(get_data_path("script-review-drafts"))


def _batch_path(batch_id: str) -> Path:
    safe_id = re.sub(r"[^A-Za-z0-9._-]+", "_", batch_id).strip("._-")
    if not safe_id:
        raise HTTPException(status_code=400, detail="Batch id is required")
    return _batch_dir() / f"{safe_id}.json"


def _script_review_path(draft_set_id: str) -> Path:
    safe_id = re.sub(r"[^A-Za-z0-9._-]+", "_", draft_set_id).strip("._-")
    if not safe_id:
        raise HTTPException(status_code=400, detail="Script review draft set id is required")
    return _script_review_dir() / f"{safe_id}.json"


def _save_batch(batch: dict) -> None:
    batch_dir = _batch_dir()
    batch_dir.mkdir(parents=True, exist_ok=True)
    _batch_path(batch["batch_id"]).write_text(
        json.dumps(batch, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _save_script_review_draft_set(draft_set: dict) -> None:
    draft_dir = _script_review_dir()
    draft_dir.mkdir(parents=True, exist_ok=True)
    _script_review_path(draft_set["draft_set_id"]).write_text(
        json.dumps(draft_set, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _load_batch(batch_id: str) -> dict | None:
    path = _batch_path(batch_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def _load_batches() -> list[dict]:
    batch_dir = _batch_dir()
    if not batch_dir.exists():
        return []
    batches = []
    for path in sorted(batch_dir.glob("*.json")):
        try:
            batches.append(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            continue
    return batches


def _load_script_review_draft_set(draft_set_id: str) -> dict | None:
    path = _script_review_path(draft_set_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def _load_script_review_draft_sets() -> list[dict]:
    draft_dir = _script_review_dir()
    if not draft_dir.exists():
        return []
    draft_sets = []
    for path in sorted(draft_dir.glob("*.json")):
        try:
            draft_set = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(draft_set, dict) or draft_set.get("draft_set_id") != path.stem:
            continue
        draft_sets.append(draft_set)
    return draft_sets


def _hydrate_batch(batch: dict, generation_service) -> dict:
    updated = False
    for item in batch.get("items", []):
        task_id = item.get("task_id")
        if not task_id:
            continue
        try:
            task = generation_service.get_task(task_id)
        except KeyError:
            if item.get("status") in {"completed", "failed", "cancelled", "interrupted"}:
                continue
            item["status"] = "interrupted"
            item["error"] = {
                "layer": "persistence",
                "message": "找不到这条生产任务的持久状态，请重新提交。",
                "exception_type": "GenerationTaskStateMissing",
            }
            updated = True
            continue
        item["status"] = task.status
        item["progress"] = task.progress.model_dump(mode="json")
        item["error"] = task.error.model_dump(mode="json") if task.error else None
        updated = True

    statuses = [item.get("status") for item in batch.get("items", [])]
    batch["status"] = _batch_status(statuses)
    batch["updated_at"] = _now_iso() if updated else batch.get("updated_at") or _now_iso()
    batch["total_count"] = len(statuses)
    batch["submitted_count"] = sum(1 for item in batch.get("items", []) if item.get("task_id"))
    batch["failed_count"] = sum(1 for status in statuses if status == "failed")
    return batch


def _find_batch_item(batch: dict, item_index: int) -> dict | None:
    for item in batch.get("items", []):
        if item.get("index") == item_index:
            return item
    return None


def _compile_batch_retry_request(*, batch: dict, item: dict, metadata: dict) -> GenerationRequest:
    # 重试还原当次提交的白名单覆盖（如每语言 Fish 音色）：
    # 它们保存在 item.params 里，合并进 input 交由 compile_request 按白名单过滤。
    registry = build_default_production_template_registry()
    return registry.compile_request(
        batch["template_id"],
        input={**(item.get("params") or {}), **(item.get("input") or {})},
        metadata=metadata,
        available_capabilities=detect_available_generation_capabilities(),
    )


def _submit_generation_jobs_as_batch(
    *,
    registry,
    template_id: str,
    jobs: list[dict],
    generation_service,
    metadata: dict,
    idempotency_key: str | None = None,
) -> dict:
    batch_id = uuid.uuid4().hex
    now = _now_iso()
    items: list[dict] = []
    for index, job in enumerate(jobs, start=1):
        params = dict(job.get("params") or {})
        # review_* 字段是审核流程的溯源信息，进 metadata 而不是生产参数。
        review_metadata = {
            key: params.pop(key) for key in list(params) if key.startswith("review_")
        }
        item_metadata = {
            **metadata,
            "batch_id": batch_id,
            "batch_index": index,
            "review_topic": job.get("topic"),
            "review_language": job.get("language"),
            **review_metadata,
        }
        item_idempotency_key = f"{idempotency_key}:{index}" if idempotency_key else None
        try:
            script = str(params.pop("text", "")).strip()
            if not script:
                raise ValueError("Script review job is missing script text.")
            # 通过模板编译：fixed_params（含模板级 overrides）打底，
            # params 里的字段仅在模板 allowed_user_params 白名单内生效。
            generation_request = registry.compile_request(
                template_id,
                input={**params, "script": script},
                metadata=item_metadata,
                idempotency_key=item_idempotency_key,
            )
            task = generation_service.submit(generation_request)
            items.append(
                {
                    "index": index,
                    "input": {
                        "topic": job.get("topic"),
                        "language": job.get("language"),
                        "script": script,
                    },
                    "params": params,
                    "metadata": item_metadata,
                    "task_id": task.task_id,
                    "status": task.status,
                    "progress": task.progress.model_dump(mode="json"),
                    "error": None,
                }
            )
        except ValueError as exc:
            items.append(
                {
                    "index": index,
                    "input": {
                        "topic": job.get("topic"),
                        "language": job.get("language"),
                    },
                    "params": dict(job.get("params") or {}),
                    "metadata": item_metadata,
                    "task_id": None,
                    "status": "failed",
                    "progress": None,
                    "error": {
                        "layer": "input",
                        "message": str(exc),
                        "exception_type": type(exc).__name__,
                    },
                }
            )

    return _hydrate_batch(
        {
            "batch_id": batch_id,
            "template_id": template_id,
            "status": "submitted",
            "created_at": now,
            "updated_at": now,
            "metadata": metadata,
            "items": items,
        },
        generation_service,
    )


def _batch_status(statuses: list[str]) -> str:
    if not statuses:
        return "empty"
    terminal = {"completed", "failed", "cancelled", "interrupted"}
    if any(status not in terminal for status in statuses):
        return "running"
    if all(status == "completed" for status in statuses):
        return "completed"
    if all(status == "failed" for status in statuses):
        return "failed"
    if all(status in {"completed", "cancelled"} for status in statuses):
        return "cancelled"
    if all(status == "interrupted" for status in statuses):
        return "interrupted"
    return "partial_failed"


def _now_iso() -> str:
    return datetime.now().isoformat()


def _safe_original_filename(filename: str | None) -> str:
    original = Path((filename or "").replace("\\", "/")).name.strip()
    if not original:
        raise HTTPException(status_code=400, detail="Asset filename is required.")
    return original


def _stored_asset_filename(original_filename: str) -> str:
    path = Path(original_filename)
    suffix = path.suffix.lower()
    safe_stem = re.sub(r"[^A-Za-z0-9._-]+", "_", path.stem).strip("._-")
    if not safe_stem:
        safe_stem = "asset"
    return f"{uuid.uuid4().hex[:12]}-{safe_stem}{suffix}"


def _prompt_template_response(template: PromptTemplate) -> ScriptReviewPromptTemplateResponse:
    return ScriptReviewPromptTemplateResponse(
        name=template.name,
        content=template.content,
        source=template.source,
    )


# 未显式指定 Prompt 时的安全默认（内置通用模板）。
# 刻意不取"列表第一个"：自定义 Prompt 文件的存在与排序不应改变默认起草行为。
SAFE_DEFAULT_PROMPT_TEMPLATES = {
    "script": "Short Oral Script",
    "split": "Copy-Safe Scene Split",
}


def _resolve_prompt_template(kind: str, name: str | None) -> PromptTemplate:
    templates = load_prompt_templates(kind)
    if not templates:
        raise HTTPException(status_code=500, detail=f"No {kind} prompt templates are available.")
    if name:
        for template in templates:
            if template.name == name:
                return template
        raise HTTPException(status_code=400, detail=f"Unknown {kind} prompt template: {name}")
    safe_default = SAFE_DEFAULT_PROMPT_TEMPLATES.get(kind)
    for template in templates:
        if template.name == safe_default:
            return template
    return templates[0]


def _clean_string_items(items: list[str], field_name: str) -> list[str]:
    cleaned = []
    seen = set()
    for item in items:
        value = str(item or "").strip()
        if value and value not in seen:
            cleaned.append(value)
            seen.add(value)
    if not cleaned:
        raise HTTPException(
            status_code=400, detail=f"{field_name} must contain at least one value."
        )
    return cleaned
