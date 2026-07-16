"""Unified production-task use cases and workbench projection."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Annotated, Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field

from api.dependencies import GenerationServiceDep, PixelleVideoDep
from api.security import RequestIdentity, get_request_identity
from pixelle_video.content.production_service import prepare_production
from pixelle_video.content.production_tasks import (
    ProductionTask,
    ProductionTaskConflict,
    attach_generation_task,
    list_production_tasks,
    load_production_task,
    save_production_task,
    set_task_state,
    sync_generation_task,
)
from pixelle_video.content.projects import get_project
from pixelle_video.content.store import load_item
from pixelle_video.content.task_timeline import (
    ProductionTimelinePage,
    build_production_timeline,
    paginate_timeline,
)
from pixelle_video.generation import ProductionTemplateError
from pixelle_video.generation.schemas import GenerationError

router = APIRouter(prefix="/production-tasks", tags=["Production Tasks"])
IdentityDep = Annotated[RequestIdentity, Depends(get_request_identity)]


class ProductionTaskCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: str = Field(min_length=1, max_length=200)
    project_id: str = Field(min_length=1)
    pipeline_id: str
    recipe_id: str
    input: dict[str, Any]
    overrides: dict[str, Any] = Field(default_factory=dict)
    content_item_id: str | None = None
    source: Literal["react"] = "react"
    client_name: str | None = Field(default=None, max_length=120)
    agent_session_id: str | None = Field(default=None, max_length=200)


class ProductionTaskCreateResponse(BaseModel):
    production_task_id: str
    content_item_id: str
    state: str
    created: bool
    task: ProductionTask


class ProductionTaskRetryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: str = Field(min_length=1, max_length=200)
    client_name: str | None = Field(default=None, max_length=120)
    agent_session_id: str | None = Field(default=None, max_length=200)
    source: str | None = Field(default=None, max_length=120)


def _request_is_replayable(request, pipeline_registry) -> bool:
    """Return whether a stored generation request still satisfies today's contract."""

    try:
        manifest = pipeline_registry.get_manifest(request.pipeline_id)
    except (KeyError, ValueError):
        return False
    for field in manifest.input.required_fields:
        value = request.input.get(field.name)
        if value is None or value == "" or value == []:
            return False
    # Topic routes have a human-confirmation output in addition to their public
    # topic input. Old snapshots stored that script only in metadata and cannot
    # safely be replayed under the current pipeline contract.
    if request.pipeline_id in {"topic_to_video", "topic_to_image_post"}:
        script = request.input.get("script")
        return isinstance(script, str) and bool(script.strip())
    return True


def _queue_confirmed_content_retry(
    *,
    task: ProductionTask,
    request: ProductionTaskRetryRequest,
    background_tasks: BackgroundTasks,
    identity: RequestIdentity,
    generation_service,
) -> ProductionTask:
    from api.routers.content_flows import ProduceRequest, _run_confirmed_content_production

    set_task_state(
        task.production_task_id,
        state="in_progress",
        stage_id="split_scenes",
        stage_label="正在从已确认内容恢复生产",
        next_actor="system",
    )
    background_tasks.add_task(
        _run_confirmed_content_production,
        item_id=task.content_item_id,
        production_task_id=task.production_task_id,
        request=ProduceRequest(
            request_id=request.request_id,
            recipe_id=task.recipe_id,
            client_name=request.client_name,
            agent_session_id=request.agent_session_id,
            source=request.source,
        ),
        identity=identity,
        generation_service=generation_service,
    )
    return load_production_task(task.production_task_id) or task


class WorkbenchStage(BaseModel):
    id: str
    label: str


class WorkbenchProgress(BaseModel):
    current: int | None = None
    total: int | None = None
    percentage: float | None = None


class WorkbenchAction(BaseModel):
    type: str
    label: str


class WorkbenchError(BaseModel):
    layer: str
    code: str | None = None
    message: str


class WorkbenchTaskCard(BaseModel):
    production_task_id: str
    content_item_id: str
    project_id: str
    project_name: str
    state: str
    title: str
    pipeline_id: str
    recipe_id: str
    artifact_type: str
    source: str
    stage: WorkbenchStage
    progress: WorkbenchProgress | None
    next_actor: str
    action: WorkbenchAction | None
    error: WorkbenchError | None
    created_at: str
    updated_at: str
    state_since: str
    waiting_since: str | None
    failed_at: str | None
    produced_at: str | None


class WorkbenchTaskListResponse(BaseModel):
    items: list[WorkbenchTaskCard]
    counts: dict[str, int]
    next_cursor: str | None


async def _plan_digital_human_script(*, item, task, input_payload, pixelle_video):
    from pixelle_video.content.drafting import draft_digital_human_script
    from pixelle_video.content.models import ContentVariant, now_iso
    from pixelle_video.content.reviews import create_item_stage_revision
    from pixelle_video.content.store import save_item

    if pixelle_video.llm is None:
        raise RuntimeError("写稿模型服务尚未初始化。")
    set_task_state(
        task.production_task_id,
        state="in_progress",
        stage_id="generate_script",
        stage_label="正在生成数字人口播文案",
        next_actor="system",
    )
    script = await draft_digital_human_script(
        llm_service=pixelle_video.llm,
        goods_title=str(input_payload.get("goods_title") or item.title),
    )
    item.languages = ["Chinese"]
    item.variants = {
        "Chinese": ContentVariant(
            language="Chinese",
            status="pending",
            title=item.title,
            script=script,
        )
    }
    item.status = "pending_review"
    item.updated_at = now_iso()
    create_item_stage_revision(item, created_by="system", source="system")
    item.add_event(
        "draft_generated",
        "system",
        {"production_task_id": task.production_task_id},
    )
    save_item(item)
    return set_task_state(
        task.production_task_id,
        state="needs_user",
        stage_id="review_script",
        stage_label="确认数字人口播文案",
        next_actor="user",
        action_type="confirm_script",
        action_label="确认文案",
    )


async def _run_digital_human_script_stage(
    *, task_id: str, input_payload: dict[str, Any], pixelle_video
) -> None:
    """Generate reviewable digital-human copy without holding the create request open."""

    task = load_production_task(task_id)
    if task is None or task.state == "cancelled":
        return
    item = load_item(task.content_item_id)
    if item is None:
        set_task_state(
            task_id,
            state="failed",
            stage_id="generate_script",
            stage_label="数字人口播写稿失败",
            next_actor="user",
            action_type="retry",
            action_label="原样重试",
            error=GenerationError(layer="persistence", message="关联内容已不可读。"),
        )
        return
    if item.status == "pending_review" and any(
        variant.script.strip() for variant in item.variants.values()
    ):
        set_task_state(
            task_id,
            state="needs_user",
            stage_id="review_script",
            stage_label="确认数字人口播文案",
            next_actor="user",
            action_type="confirm_script",
            action_label="确认文案",
        )
        return
    try:
        await _plan_digital_human_script(
            item=item,
            task=task,
            input_payload=input_payload,
            pixelle_video=pixelle_video,
        )
    except Exception as exc:  # noqa: BLE001 - durable task failure is the contract
        set_task_state(
            task_id,
            state="failed",
            stage_id="generate_script",
            stage_label="数字人口播写稿失败",
            next_actor="user",
            action_type="retry",
            action_label="原样重试",
            error=GenerationError(
                layer="runtime",
                message="数字人口播文案未能生成，请查看本机 API 日志。",
                exception_type=type(exc).__name__,
            ),
        )


@router.post("", response_model=ProductionTaskCreateResponse, status_code=status.HTTP_202_ACCEPTED)
async def create_production_task(
    request: ProductionTaskCreateRequest,
    background_tasks: BackgroundTasks,
    identity: IdentityDep,
    generation_service: GenerationServiceDep,
    pixelle_video: PixelleVideoDep,
):
    source: Literal["react", "agent", "batch"] = "agent" if identity.is_agent else request.source
    metadata = {
        key: value
        for key, value in {
            "client_name": request.client_name,
            "agent_session_id": request.agent_session_id,
            "request_id": request.request_id,
            "source": source,
        }.items()
        if value not in (None, "")
    }
    try:
        prepared = prepare_production(
            project_id=request.project_id,
            pipeline_id=request.pipeline_id,
            recipe_id=request.recipe_id,
            input_payload=request.input,
            overrides=request.overrides,
            request_id=request.request_id,
            source=source,
            actor="agent" if identity.is_agent else "user",
            content_item_id=request.content_item_id,
            metadata=metadata,
        )
    except ProductionTaskConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    except (ValueError, ProductionTemplateError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None

    if prepared.created:
        if prepared.task.pipeline_id in {"topic_to_video", "topic_to_image_post"}:
            from api.routers.content_flows import DraftRequest, draft_item

            try:
                await draft_item(
                    prepared.item.item_id,
                    DraftRequest(
                        request_id=f"{request.request_id}:draft",
                        recipe_id=prepared.template.id,
                        client_name=request.client_name,
                        agent_session_id=request.agent_session_id,
                        source=source,
                    ),
                    background_tasks,
                    pixelle_video,
                    identity,
                )
            except Exception as exc:
                set_task_state(
                    prepared.task.production_task_id,
                    state="failed",
                    stage_id="generate_script",
                    stage_label="写稿启动失败",
                    next_actor="user",
                    action_type="view_error",
                    action_label="查看原因",
                    error=GenerationError(
                        layer="runtime",
                        message="写稿任务未能启动。",
                        exception_type=type(exc).__name__,
                    ),
                )
                raise exc
        elif prepared.task.pipeline_id == "codex_scene_video":
            from pixelle_video.content.models import (
                SceneDraft,
                SceneManifest,
                now_iso,
            )
            from pixelle_video.content.reviews import create_item_stage_revision
            from pixelle_video.content.store import save_item

            raw_scenes = request.input.get("scenes") or []
            try:
                scenes = [
                    SceneDraft(
                        scene_id=str(scene.get("scene_id") or f"scene-{index}"),
                        order=int(scene.get("order") or index),
                        narration=str(scene.get("narration") or ""),
                        image_prompt=str(scene.get("image_prompt") or ""),
                        duration=scene.get("duration"),
                    )
                    for index, scene in enumerate(raw_scenes, start=1)
                ]
                prepared.item.scene_manifest = SceneManifest(
                    review_kind="agent_image_scenes",
                    scenes=scenes,
                    confirmed=False,
                )
                prepared.item.status = "pending_review"
                prepared.item.updated_at = now_iso()
                create_item_stage_revision(
                    prepared.item,
                    created_by=identity.actor,
                    source="agent",
                )
                save_item(prepared.item)
                set_task_state(
                    prepared.task.production_task_id,
                    state="needs_user",
                    stage_id="review_scenes",
                    stage_label="确认分镜与图片提示词",
                    next_actor="user",
                    action_type="confirm_scenes",
                    action_label="确认分镜",
                )
            except (TypeError, ValueError) as exc:
                set_task_state(
                    prepared.task.production_task_id,
                    state="failed",
                    stage_id="plan_scenes",
                    stage_label="分镜清单无效",
                    next_actor="agent",
                    error=GenerationError(layer="input", message=str(exc)),
                )
                raise HTTPException(status_code=422, detail=str(exc)) from None
        elif prepared.task.pipeline_id in {"script_to_video", "image_post"}:
            from api.routers.content_flows import run_scene_planning

            set_task_state(
                prepared.task.production_task_id,
                state="in_progress",
                stage_id="plan_scenes",
                stage_label="正在规划分镜",
                next_actor="system",
            )
            background_tasks.add_task(
                run_scene_planning,
                item_id=prepared.item.item_id,
                production_task_id=prepared.task.production_task_id,
                pixelle_video=pixelle_video,
                review_kind=(
                    "image_pages" if prepared.task.pipeline_id == "image_post" else "video_scenes"
                ),
            )
        elif (
            prepared.task.pipeline_id == "digital_human"
            and not str(request.input.get("script") or "").strip()
        ):
            set_task_state(
                prepared.task.production_task_id,
                state="in_progress",
                stage_id="generate_script",
                stage_label="正在生成数字人口播文案",
                next_actor="system",
            )
            background_tasks.add_task(
                _run_digital_human_script_stage,
                task_id=prepared.task.production_task_id,
                input_payload=request.input,
                pixelle_video=pixelle_video,
            )
        else:
            if prepared.generation_request is None:
                raise HTTPException(status_code=500, detail="生产请求没有生成执行合同。")
            try:
                generation_task = generation_service.submit(
                    prepared.generation_request,
                    surface="agent" if identity.is_agent else "public",
                )
                attach_generation_task(
                    prepared.task.production_task_id,
                    generation_task,
                    effective_params=prepared.generation_request.params,
                )
            except (ValueError, RuntimeError) as exc:
                set_task_state(
                    prepared.task.production_task_id,
                    state="failed",
                    stage_id="submit_production",
                    stage_label="生产任务提交失败",
                    next_actor="user",
                    action_type="view_error",
                    action_label="查看原因",
                    error=GenerationError(
                        layer="runtime",
                        message="生产任务未能启动，请查看本机 API 日志。",
                        exception_type=type(exc).__name__,
                    ),
                )
                raise HTTPException(status_code=400, detail=str(exc)) from None

    current = load_production_task(prepared.task.production_task_id) or prepared.task
    return ProductionTaskCreateResponse(
        production_task_id=current.production_task_id,
        content_item_id=current.content_item_id,
        state=current.state,
        created=prepared.created,
        task=current,
    )


@router.get("", response_model=WorkbenchTaskListResponse)
async def list_workbench_tasks(
    generation_service: GenerationServiceDep,
    identity: IdentityDep,
    state: Literal["needs_user", "in_progress", "failed", "produced", "cancelled"] | None = None,
    project_id: str | None = None,
    pipeline_id: str | None = None,
    recipe_id: str | None = None,
    artifact_type: str | None = None,
    source: str | None = None,
    created_from: str | None = None,
    created_to: str | None = None,
    include_archived: bool = False,
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
):
    start = _parse_timestamp(created_from, "created_from")
    end = _parse_timestamp(created_to, "created_to")
    if start and end and start > end:
        raise HTTPException(status_code=422, detail="created_from 不能晚于 created_to。")
    filtered: list[ProductionTask] = []
    for stored_task in list_production_tasks():
        task = _refresh_task(stored_task, generation_service)
        if project_id and task.project_id != project_id:
            continue
        if pipeline_id and task.pipeline_id != pipeline_id:
            continue
        if recipe_id and task.recipe_id != recipe_id:
            continue
        if artifact_type and task.artifact_type != artifact_type:
            continue
        if source and task.source != source:
            continue
        created_at = _parse_stored_timestamp(task.created_at)
        if start and created_at < start:
            continue
        if end and created_at > end:
            continue
        item = load_item(task.content_item_id)
        if item is None:
            continue
        if not include_archived and item.status == "archived":
            continue
        filtered.append(task)

    counts = {
        name: sum(1 for task in filtered if task.state == name)
        for name in ("needs_user", "in_progress", "failed", "produced", "cancelled")
    }
    if state is not None:
        filtered = [task for task in filtered if task.state == state]
    filtered.sort(key=_sort_key(state), reverse=state != "needs_user")
    try:
        offset = max(int(cursor or "0"), 0)
    except ValueError:
        raise HTTPException(status_code=422, detail="cursor 无效。") from None
    page = filtered[offset : offset + limit]
    next_cursor = str(offset + limit) if offset + limit < len(filtered) else None
    return WorkbenchTaskListResponse(
        items=[_card(task, allow_user_action=not identity.is_agent) for task in page],
        counts=counts,
        next_cursor=next_cursor,
    )


@router.get("/{task_id}", response_model=ProductionTask)
async def get_production_task(
    task_id: str, generation_service: GenerationServiceDep, identity: IdentityDep
):
    task = load_production_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="未找到生产任务。")
    return _visible_task(_refresh_task(task, generation_service), identity)


@router.get("/{task_id}/timeline", response_model=ProductionTimelinePage)
async def get_production_task_timeline(
    task_id: str,
    generation_service: GenerationServiceDep,
    identity: IdentityDep,
    cursor: str | None = None,
    limit: int = Query(default=30, ge=1, le=100),
):
    task = load_production_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="未找到生产任务。")
    visible = _visible_task(_refresh_task(task, generation_service), identity)
    item = load_item(visible.content_item_id)
    try:
        return paginate_timeline(
            build_production_timeline(visible, item),
            cursor=cursor,
            limit=limit,
        )
    except ValueError:
        raise HTTPException(status_code=422, detail="cursor 无效。") from None


@router.delete("/{task_id}", response_model=ProductionTask)
async def cancel_production_task(
    task_id: str,
    generation_service: GenerationServiceDep,
    request_id: str = Query(min_length=1, max_length=200),
):
    task = load_production_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="未找到生产任务。")
    if task.state in {"produced", "failed"}:
        return task
    if task.state == "cancelled":
        if task.cancellation_request_id in {None, request_id}:
            task.cancellation_request_id = request_id
            return save_production_task(task)
        raise HTTPException(status_code=409, detail="这条任务已由另一次请求取消。")
    for generation_task_id in reversed(task.generation_task_ids):
        try:
            generation_service.cancel_task(generation_task_id)
            break
        except KeyError:
            continue
    cancelled = set_task_state(
        task.production_task_id,
        state="cancelled",
        stage_id="cancelled",
        stage_label="已取消",
        next_actor="user",
    )
    cancelled.cancellation_request_id = request_id
    return save_production_task(cancelled)


@router.post("/{task_id}/retry", response_model=ProductionTask, status_code=202)
async def retry_production_task(
    task_id: str,
    request: ProductionTaskRetryRequest,
    background_tasks: BackgroundTasks,
    identity: IdentityDep,
    generation_service: GenerationServiceDep,
    pixelle_video: PixelleVideoDep,
):
    task = load_production_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="未找到生产任务。")
    if task.state not in {"failed", "cancelled"}:
        raise HTTPException(status_code=409, detail="只能重试失败或已取消的任务。")

    if not task.generation_task_ids and task.pipeline_id in {
        "topic_to_video",
        "topic_to_image_post",
        "script_to_video",
        "image_post",
        "digital_human",
    }:
        from api.routers.content_flows import (
            DraftRequest,
            ProduceRequest,
            draft_item,
        )

        item = load_item(task.content_item_id)
        if item is None:
            raise HTTPException(status_code=409, detail="关联内容已不可读，无法重试。")
        try:
            if item.status == "idea" and task.pipeline_id in {
                "topic_to_video",
                "topic_to_image_post",
            }:
                set_task_state(
                    task.production_task_id,
                    state="in_progress",
                    stage_id="generate_script",
                    stage_label="正在重新写稿",
                    next_actor="system",
                )
                await draft_item(
                    task.content_item_id,
                    DraftRequest(
                        request_id=request.request_id,
                        recipe_id=task.recipe_id,
                        client_name=request.client_name,
                        agent_session_id=request.agent_session_id,
                        source=request.source,
                    ),
                    background_tasks,
                    pixelle_video,
                    identity,
                )
            elif (
                task.pipeline_id == "digital_human"
                and not str(task.input_snapshot.get("script") or "").strip()
                and item.status in {"producing", "idea"}
            ):
                set_task_state(
                    task.production_task_id,
                    state="in_progress",
                    stage_id="generate_script",
                    stage_label="正在重新生成数字人口播文案",
                    next_actor="system",
                )
                background_tasks.add_task(
                    _run_digital_human_script_stage,
                    task_id=task.production_task_id,
                    input_payload=task.input_snapshot,
                    pixelle_video=pixelle_video,
                )
            elif item.status in {"draft_ready", "pending_review"}:
                review_scenes = item.scene_manifest is not None
                return set_task_state(
                    task.production_task_id,
                    state="needs_user",
                    stage_id="review_scenes" if review_scenes else "review_script",
                    stage_label="确认分镜" if review_scenes else "确认文案",
                    next_actor="user",
                    action_type="confirm_scenes" if review_scenes else "confirm_script",
                    action_label="确认分镜" if review_scenes else "确认文案",
                )
            elif (
                item.status == "confirmed"
                and task.stage_id == "plan_scenes"
                and task.pipeline_id
                in {
                    "topic_to_video",
                    "topic_to_image_post",
                    "script_to_video",
                    "image_post",
                }
            ):
                from api.routers.content_flows import run_scene_planning

                set_task_state(
                    task.production_task_id,
                    state="in_progress",
                    stage_id="plan_scenes",
                    stage_label="正在重新规划分镜",
                    next_actor="system",
                )
                background_tasks.add_task(
                    run_scene_planning,
                    item_id=item.item_id,
                    production_task_id=task.production_task_id,
                    pixelle_video=pixelle_video,
                    review_kind=(
                        "image_pages"
                        if task.pipeline_id in {"topic_to_image_post", "image_post"}
                        else "video_scenes"
                    ),
                )
            elif item.status == "confirmed" and task.pipeline_id == "digital_human":
                from pixelle_video.content.store import save_item
                from pixelle_video.generation import (
                    build_default_production_template_registry,
                    detect_available_generation_capabilities,
                )

                variant = next(
                    (
                        candidate
                        for candidate in item.variants.values()
                        if candidate.status == "confirmed" and candidate.script.strip()
                    ),
                    None,
                )
                if variant is None:
                    raise HTTPException(status_code=409, detail="数字人口播确认稿不可读。")
                registry = build_default_production_template_registry()
                generation_request = registry.compile_request(
                    task.recipe_id,
                    input={
                        **task.input_snapshot,
                        **task.effective_params,
                        "script": variant.script,
                    },
                    metadata={
                        "content_item_id": item.item_id,
                        "project_id": item.project,
                        "production_task_id": task.production_task_id,
                        "production_run_id": request.request_id,
                    },
                    idempotency_key=request.request_id,
                    available_capabilities=detect_available_generation_capabilities(),
                    surface="agent" if identity.is_agent else "public",
                )
                generation_request.params = dict(task.effective_params)
                generation_request.input["script"] = variant.script
                generation_task = generation_service.submit(
                    generation_request,
                    surface="agent" if identity.is_agent else "public",
                )
                attach_generation_task(
                    task.production_task_id,
                    generation_task,
                    effective_params=generation_request.params,
                )
                item.status = "producing"
                item.links = {
                    **item.links,
                    "task_ids": [
                        *list(item.links.get("task_ids") or []),
                        generation_task.task_id,
                    ],
                }
                save_item(item)
            elif item.status == "confirmed":
                return _queue_confirmed_content_retry(
                    task=task,
                    request=request,
                    background_tasks=background_tasks,
                    identity=identity,
                    generation_service=generation_service,
                )
            else:
                raise HTTPException(
                    status_code=409,
                    detail=f"当前内容状态 {item.status} 不能原样重试，请新建一次生产。",
                )
        except HTTPException as exc:
            set_task_state(
                task.production_task_id,
                state="failed",
                stage_id="retry",
                stage_label="重试启动失败",
                next_actor="user",
                action_type="view_error",
                action_label="查看原因",
                error=GenerationError(
                    layer="runtime",
                    message=str(exc.detail),
                    exception_type="RetryStartFailed",
                ),
            )
            raise
        return load_production_task(task_id) or task

    if not task.generation_task_ids:
        raise HTTPException(
            status_code=409,
            detail="没有可复用的执行快照，请从原内容新建一次生产。",
        )
    previous = None
    for generation_task_id in reversed(task.generation_task_ids):
        try:
            candidate = generation_service.get_task(generation_task_id)
        except KeyError:
            continue
        if _request_is_replayable(candidate.request, generation_service.pipeline_registry):
            previous = candidate
            break
    if previous is None:
        item = load_item(task.content_item_id)
        if item is not None and item.status in {"confirmed", "produced"}:
            return _queue_confirmed_content_retry(
                task=task,
                request=request,
                background_tasks=background_tasks,
                identity=identity,
                generation_service=generation_service,
            )
        raise HTTPException(
            status_code=409,
            detail="没有可安全重放的执行快照，请从原内容新建一次生产。",
        )

    retry_request = previous.request.model_copy(deep=True)
    retry_request.idempotency_key = request.request_id
    retry_request.metadata = {
        **retry_request.metadata,
        "production_task_id": task.production_task_id,
        "content_item_id": task.content_item_id,
        "project_id": task.project_id,
        "retry_of_task_id": previous.task_id,
        "production_run_id": request.request_id,
        "client_name": request.client_name,
        "agent_session_id": request.agent_session_id,
        "source": "agent" if identity.is_agent else "react",
    }
    set_task_state(
        task.production_task_id,
        state="in_progress",
        stage_id=previous.progress.stage,
        stage_label="正在重试",
        next_actor="system",
    )
    generation_task = generation_service.submit(
        retry_request,
        surface="agent" if identity.is_agent or task.source == "agent" else "public",
    )
    attach_generation_task(
        task.production_task_id,
        generation_task,
        effective_params=retry_request.params,
    )
    manifest = generation_service.pipeline_registry.get_manifest(task.pipeline_id)
    return sync_generation_task(generation_task, manifest) or task


def _card(task: ProductionTask, *, allow_user_action: bool) -> WorkbenchTaskCard:
    progress = None
    if task.progress_percentage is not None or task.progress_total is not None:
        progress = WorkbenchProgress(
            current=task.progress_current,
            total=task.progress_total,
            percentage=task.progress_percentage,
        )
    action = (
        WorkbenchAction(type=task.action_type, label=task.action_label)
        if task.action_type
        and task.action_label
        and (allow_user_action or task.next_actor != "user")
        else None
    )
    error = (
        WorkbenchError(
            layer=task.error.layer,
            code=task.error.exception_type,
            message=_safe_error_message(task.error.message),
        )
        if task.error
        else None
    )
    project = get_project(task.project_id)
    return WorkbenchTaskCard(
        production_task_id=task.production_task_id,
        content_item_id=task.content_item_id,
        project_id=task.project_id,
        project_name=project.name if project is not None else task.project_id,
        state=task.state,
        title=task.title,
        pipeline_id=task.pipeline_id,
        recipe_id=task.recipe_id,
        artifact_type=task.artifact_type,
        source=task.source,
        stage=WorkbenchStage(id=task.stage_id, label=task.stage_label),
        progress=progress,
        next_actor=task.next_actor,
        action=action,
        error=error,
        created_at=task.created_at,
        updated_at=task.updated_at,
        state_since=task.state_since,
        waiting_since=task.waiting_since,
        failed_at=task.failed_at,
        produced_at=task.produced_at,
    )


def _sort_key(state):
    if state == "needs_user":
        return lambda task: (task.waiting_since or task.state_since, task.production_task_id)
    if state == "failed":
        return lambda task: (task.failed_at or task.updated_at, task.production_task_id)
    if state == "produced":
        return lambda task: (task.produced_at or task.updated_at, task.production_task_id)
    return lambda task: (task.updated_at, task.production_task_id)


def _refresh_task(task: ProductionTask, generation_service) -> ProductionTask:
    if not task.generation_task_ids:
        return task
    try:
        generation_task = generation_service.get_task(task.generation_task_ids[-1])
    except KeyError:
        return task
    manifest = generation_service.pipeline_registry.get_manifest(task.pipeline_id)
    return sync_generation_task(generation_task, manifest) or task


def _visible_task(task: ProductionTask, identity: RequestIdentity) -> ProductionTask:
    visible = task.model_copy(deep=True)
    if identity.is_agent and task.next_actor == "user":
        visible.action_type = None
        visible.action_label = None
    visible.input_snapshot = _redact_mapping(visible.input_snapshot)
    visible.effective_params = _redact_mapping(visible.effective_params)
    if visible.error:
        visible.error.message = _safe_error_message(visible.error.message)
        visible.error.detail = _redact_mapping(visible.error.detail)
    for attempt in visible.attempts:
        if attempt.error:
            attempt.error.message = _safe_error_message(attempt.error.message)
            attempt.error.detail = _redact_mapping(attempt.error.detail)
    return visible


def _parse_timestamp(value: str | None, field: str) -> datetime | None:
    if not value:
        return None
    try:
        return _parse_stored_timestamp(value)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{field} 必须是 ISO 8601 时间。") from None


def _parse_stored_timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


_ABSOLUTE_PATH = re.compile(
    r"(?:[A-Za-z]:\\[^\s]+|/(?:Users|home|private|var|tmp|opt|srv)/[^\s,;，；]+)"
)
_SECRET_VALUE = re.compile(r"(?i)(api[_ -]?key|token|password|secret)\s*[:=]\s*[^\s,;，；]+")


def _safe_error_message(message: str) -> str:
    cleaned = _ABSOLUTE_PATH.sub("[本机路径]", message)
    cleaned = _SECRET_VALUE.sub(lambda match: f"{match.group(1)}=[已隐藏]", cleaned)
    return cleaned[:300]


def _redact_mapping(value: Any, key: str = "") -> Any:
    lowered = key.lower()
    if any(part in lowered for part in ("api_key", "token", "password", "secret")):
        return "[已隐藏]"
    if isinstance(value, dict):
        return {
            str(item_key): _redact_mapping(item, str(item_key)) for item_key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact_mapping(item, key) for item in value]
    if isinstance(value, str):
        return _ABSOLUTE_PATH.sub("[本机路径]", value)
    return value
