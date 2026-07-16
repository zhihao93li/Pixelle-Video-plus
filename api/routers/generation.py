import json
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, ConfigDict, Field

from api.dependencies import GenerationServiceDep, PixelleVideoDep
from api.security import RequestIdentity, get_request_identity
from pixelle_video.generation import (
    GenerationProgress,
    GenerationRequest,
    GenerationResult,
    GenerationTask,
    PipelineManifest,
    ProductionTemplate,
    ProductionTemplateError,
    build_base_production_template_registry,
    build_default_pipeline_registry,
    build_default_production_template_registry,
    detect_available_generation_capabilities,
)
from pixelle_video.utils.os_util import get_data_path

router = APIRouter(prefix="/generation", tags=["Generation Pipelines"])
IdentityDep = Annotated[RequestIdentity, Depends(get_request_identity)]

GENERATION_ASSET_UPLOAD_DIR: Path | None = None
GENERATION_BATCH_DIR: Path | None = None
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


class ProductionTemplateResponse(ProductionTemplate):
    """Public recipe projection."""


class ProductionTemplateListResponse(BaseModel):
    default_template: str | None
    templates: list[ProductionTemplateResponse]
    agent_templates: list[ProductionTemplateResponse] = Field(default_factory=list)


class ProductionTemplateBatchItemRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input: dict
    overrides: dict = Field(default_factory=dict)
    metadata: dict = Field(default_factory=dict)
    idempotency_key: str | None = None


class ProductionTemplateBatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    template_id: str
    pipeline_id: str
    project_id: str
    items: list[ProductionTemplateBatchItemRequest] = Field(..., min_length=1, max_length=100)
    metadata: dict = Field(default_factory=dict)
    idempotency_key: str = Field(min_length=1, max_length=200)


class ProductionTemplateCloneRequest(BaseModel):
    source_template_id: str
    id: str
    display_name: str
    description: str | None = None
    fixed_params_patch: dict = Field(default_factory=dict)


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
    production_task_id: str | None = None
    content_item_id: str | None = None
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


@router.get("/pipelines", response_model=PipelineListResponse)
async def list_generation_pipelines(pixelle_video: PixelleVideoDep):
    manifests = [
        manifest
        for manifest in pixelle_video.pipeline_registry.list_manifests()
        if manifest.access_scope == "public"
    ]
    default_pipeline = (
        "script_to_video"
        if "script_to_video" in pixelle_video.pipeline_registry.pipeline_ids()
        else None
    )

    return PipelineListResponse(
        default_pipeline=default_pipeline,
        pipelines=manifests,
    )


def _production_template_responses(
    templates: list[ProductionTemplate],
) -> list[ProductionTemplateResponse]:
    responses: list[ProductionTemplateResponse] = []
    for template in templates:
        responses.append(ProductionTemplateResponse(**template.model_dump(mode="python")))
    return responses


def _production_template_response(template: ProductionTemplate) -> ProductionTemplateResponse:
    return _production_template_responses([template])[0]


@router.get("/templates", response_model=ProductionTemplateListResponse)
async def list_generation_templates(project: str | None = None):
    registry = build_default_production_template_registry()
    all_templates = _production_template_responses(registry.list())
    templates = [template for template in all_templates if template.access_scope == "public"]
    agent_templates = [template for template in all_templates if template.access_scope == "agent"]
    return ProductionTemplateListResponse(
        default_template=_default_template_for_project(project),
        templates=templates,
        agent_templates=agent_templates,
    )


class TemplateGenerationConfigResponse(BaseModel):
    template_id: str
    overridable_keys: list[str]
    overrides: dict[str, Any]
    base_params: dict[str, Any]
    effective_params: dict[str, Any]


class TemplateGenerationConfigUpdateRequest(BaseModel):
    overrides: dict[str, Any]


def _template_overridable_keys(template) -> list[str]:
    """Resolve one template's setting contract without silently dropping drift."""
    from pixelle_video.generation.template_overrides import OVERRIDABLE_PARAMS

    manifest = build_default_pipeline_registry().get_manifest(template.pipeline_id)
    pipeline_setting_keys = {key for stage in manifest.stages for key in stage.setting_keys}
    template_setting_keys = set(template.allowed_user_params) & pipeline_setting_keys
    missing_contract = sorted(template_setting_keys - set(OVERRIDABLE_PARAMS))
    if missing_contract:
        raise HTTPException(
            status_code=500,
            detail=(
                f"模板 {template.id} 的生产设置合同不完整："
                f"{', '.join(missing_contract)}"
            ),
        )
    return [key for key in OVERRIDABLE_PARAMS if key in template_setting_keys]


def _template_generation_config_response(
    template_id: str,
) -> TemplateGenerationConfigResponse:
    from pixelle_video.generation.template_overrides import (
        OVERRIDABLE_PARAMS,
        load_overrides,
    )

    registry = build_default_production_template_registry()
    base_registry = build_base_production_template_registry()
    try:
        template = registry.get(template_id)
    except ProductionTemplateError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

    overridable = _template_overridable_keys(template)
    try:
        base_template = base_registry.get(template_id)
    except ProductionTemplateError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return TemplateGenerationConfigResponse(
        template_id=template.id,
        overridable_keys=overridable,
        overrides=load_overrides(template.id),
        base_params={
            key: value
            for key, value in base_template.fixed_params.items()
            if key in OVERRIDABLE_PARAMS
        },
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
            allowed_user_params=_template_overridable_keys(template),
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


@router.put("/templates/{template_id}/enabled", response_model=ProductionTemplateResponse)
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

    return _production_template_response(
        build_default_production_template_registry().get(template_id)
    )


@router.post("/templates", response_model=ProductionTemplateResponse)
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
    source_manifest = build_default_pipeline_registry().get_manifest(source.pipeline_id)
    allowed = set(source.allowed_user_params) & {
        key for stage in source_manifest.stages for key in stage.setting_keys
    }
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
    return _production_template_response(clone)


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
    from pixelle_video.content.projects import (
        ensure_default_project,
        get_default_project,
        get_project,
    )

    ensure_default_project()
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


@router.post("/batches", response_model=GenerationBatchResponse)
async def submit_generation_batch(
    request_body: ProductionTemplateBatchRequest,
    background_tasks: BackgroundTasks,
    generation_service: GenerationServiceDep,
    pixelle_video: PixelleVideoDep,
    identity: IdentityDep,
):
    """Create one ledger item and one stable production task per batch row."""
    from api.routers.content_flows import DraftRequest, draft_item
    from pixelle_video.content.production_service import prepare_production
    from pixelle_video.content.production_tasks import (
        ProductionTaskConflict,
        attach_generation_task,
        set_task_state,
    )

    batch_id = uuid.uuid4().hex
    now = _now_iso()
    project_id = _resolve_project_id(request_body.project_id)
    items: list[dict] = []

    for index, item in enumerate(request_body.items, start=1):
        request_id = item.idempotency_key or f"{request_body.idempotency_key}:{index}"
        item_metadata = {
            **request_body.metadata,
            **item.metadata,
            "source": "batch",
            "project_id": project_id,
            "batch_id": batch_id,
            "batch_index": index,
        }

        try:
            prepared = prepare_production(
                project_id=project_id,
                pipeline_id=request_body.pipeline_id,
                recipe_id=request_body.template_id,
                input_payload=item.input,
                overrides=item.overrides,
                request_id=request_id,
                source="batch",
                actor="agent" if identity.is_agent else "user",
                metadata=item_metadata,
            )
            task = None
            if prepared.created and prepared.task.pipeline_id == "topic_to_video":
                await draft_item(
                    prepared.item.item_id,
                    DraftRequest(
                        request_id=f"{request_id}:draft",
                        recipe_id=prepared.template.id,
                        client_name="react-console",
                        source="batch",
                    ),
                    background_tasks,
                    pixelle_video,
                    identity,
                )
            elif prepared.created:
                if prepared.generation_request is None:
                    raise RuntimeError("批量生产请求缺少执行合同。")
                task = generation_service.submit(prepared.generation_request)
                attach_generation_task(
                    prepared.task.production_task_id,
                    task,
                    effective_params=prepared.generation_request.params,
                )
            items.append(
                {
                    "index": index,
                    "input": item.input,
                    "params": (
                        prepared.generation_request.params
                        if prepared.generation_request is not None
                        else prepared.task.effective_params
                    ),
                    "metadata": item_metadata,
                    "task_id": task.task_id if task else None,
                    "production_task_id": prepared.task.production_task_id,
                    "content_item_id": prepared.item.item_id,
                    "status": task.status if task else prepared.task.state,
                    "progress": task.progress.model_dump(mode="json") if task else None,
                    "error": None,
                }
            )
            items[-1]["metadata"] = {
                **item_metadata,
                "production_task_id": prepared.task.production_task_id,
                "content_item_id": prepared.item.item_id,
            }
        except (ProductionTemplateError, ProductionTaskConflict, ValueError, RuntimeError) as exc:
            if "prepared" in locals() and prepared.created:
                from pixelle_video.generation.schemas import GenerationError

                set_task_state(
                    prepared.task.production_task_id,
                    state="failed",
                    stage_id="submit_production",
                    stage_label="批量任务提交失败",
                    next_actor="user",
                    action_type="view_error",
                    action_label="查看原因",
                    error=GenerationError(
                        layer="input",
                        message=str(exc),
                        exception_type=type(exc).__name__,
                    ),
                )
            items.append(
                {
                    "index": index,
                    "input": item.input,
                    "params": item.overrides,
                    "metadata": item_metadata,
                    "task_id": None,
                    "production_task_id": (
                        prepared.task.production_task_id if "prepared" in locals() else None
                    ),
                    "content_item_id": (prepared.item.item_id if "prepared" in locals() else None),
                    "status": "failed",
                    "progress": None,
                    "error": {
                        "layer": "input",
                        "message": str(exc),
                        "exception_type": type(exc).__name__,
                    },
                }
            )
        finally:
            if "prepared" in locals():
                del prepared

    batch = {
        "batch_id": batch_id,
        "template_id": request_body.template_id,
        "status": "submitted",
        "created_at": now,
        "updated_at": now,
        "metadata": {
            **request_body.metadata,
            "project_id": project_id,
            "pipeline_id": request_body.pipeline_id,
        },
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
    request_id: str = Query(min_length=1, max_length=200),
):
    batch = _load_batch(batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail=f"Generation batch not found: {batch_id}")
    if batch.get("cancellation_request_id") not in {None, request_id}:
        raise HTTPException(status_code=409, detail="这个批次已由另一次请求取消。")
    batch["cancellation_request_id"] = request_id

    batch = _hydrate_batch(batch, generation_service)
    for item in batch.get("items", []):
        if item.get("status") not in {
            "pending",
            "submitted",
            "running",
            "in_progress",
            "needs_user",
        }:
            continue
        task_id = item.get("task_id")
        if task_id:
            task = generation_service.cancel_task(task_id)
            item["status"] = task.status
            item["progress"] = task.progress.model_dump(mode="json")
            item["error"] = task.error.model_dump(mode="json") if task.error else None
        production_task_id = item.get("production_task_id") or (item.get("metadata") or {}).get(
            "production_task_id"
        )
        if production_task_id:
            from pixelle_video.content.production_tasks import set_task_state

            set_task_state(
                production_task_id,
                state="cancelled",
                stage_id="cancelled",
                stage_label="已取消",
                next_actor="user",
            )

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
    request_id: str = Query(min_length=1, max_length=200),
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
    production_task_id = item.get("production_task_id") or (item.get("metadata") or {}).get(
        "production_task_id"
    )
    if not production_task_id:
        raise HTTPException(
            status_code=409,
            detail="批次条目缺少生产任务身份，不能重试。",
        )
    if (item.get("metadata") or {}).get("retry_request_id") == request_id:
        return batch
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
        "retry_request_id": request_id,
        "retry_of_task_id": item.get("task_id"),
        "production_run_id": f"{batch_id}:{item_index}:retry:{retry_count}",
    }
    try:
        if batch.get("metadata", {}).get("pipeline_id") == "topic_to_video":
            raise ValueError("主题路线请在工作台重试，以保留人工确认站。")
        generation_request = _compile_batch_retry_request(
            batch=batch,
            item=item,
            metadata=metadata,
        )
        task = generation_service.submit(generation_request)
        from pixelle_video.content.production_tasks import (
            attach_generation_task,
            set_task_state,
        )

        set_task_state(
            production_task_id,
            state="in_progress",
            stage_id=generation_request.pipeline_id,
            stage_label="正在重试",
            next_actor="system",
        )
        attach_generation_task(
            production_task_id,
            task,
            effective_params=generation_request.params,
        )
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


@router.get("/pipelines/{pipeline_id}", response_model=PipelineManifest)
async def get_generation_pipeline(pipeline_id: str, pixelle_video: PixelleVideoDep):
    try:
        manifest = pixelle_video.pipeline_registry.get_manifest(pipeline_id)
        if manifest.access_scope != "public":
            raise KeyError(pipeline_id)
        return manifest
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown pipeline: {pipeline_id}") from None


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


def _batch_path(batch_id: str) -> Path:
    safe_id = re.sub(r"[^A-Za-z0-9._-]+", "_", batch_id).strip("._-")
    if not safe_id:
        raise HTTPException(status_code=400, detail="Batch id is required")
    return _batch_dir() / f"{safe_id}.json"


def _save_batch(batch: dict) -> None:
    batch_dir = _batch_dir()
    batch_dir.mkdir(parents=True, exist_ok=True)
    _batch_path(batch["batch_id"]).write_text(
        json.dumps(batch, ensure_ascii=False, indent=2) + "\n",
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
