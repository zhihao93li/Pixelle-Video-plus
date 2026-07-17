"""Use-case API shared by the React console and trusted Agent clients."""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from api.dependencies import GenerationServiceDep, PixelleVideoDep
from api.security import (
    RequestIdentity,
    get_request_identity,
    require_agent,
)
from pixelle_video.content.drafting import split_confirmed_script
from pixelle_video.content.models import (
    ContentItem,
    ContentVariant,
    Publication,
    SceneDraft,
    SceneManifest,
    new_content_item,
    now_iso,
)
from pixelle_video.content.operations import (
    ContentFlowOperation,
    begin_operation,
    complete_operation,
    fail_operation,
    load_operation,
    request_hash,
    save_operation,
)
from pixelle_video.content.production_tasks import load_production_task
from pixelle_video.content.projects import get_project
from pixelle_video.content.reviews import (
    apply_revision_to_item,
    create_item_stage_revision,
    validate_review_session,
)
from pixelle_video.content.stage_revisions import (
    ConfirmationRequestConflict,
    StageRevisionAlreadyConfirmed,
    StaleStageRevision,
    confirm_revision,
    get_revision,
)
from pixelle_video.content.store import load_item, save_item
from pixelle_video.generation import (
    ProductionTemplateError,
    build_default_pipeline_registry,
    build_default_production_template_registry,
    detect_available_generation_capabilities,
)
from pixelle_video.generation.agent_images import (
    AgentImageError,
    resolve_agent_image_path,
    save_agent_image,
)
from pixelle_video.generation.schemas import GenerationError
from pixelle_video.utils.os_util import get_data_path

router = APIRouter(prefix="/content-items", tags=["Content Flows"])
IdentityDep = Annotated[RequestIdentity, Depends(get_request_identity)]


class TraceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: str = Field(min_length=1, max_length=200)
    client_name: str | None = Field(default=None, max_length=120)
    agent_session_id: str | None = Field(default=None, max_length=200)
    source: str | None = Field(default=None, max_length=120)


class TopicsRequest(TraceRequest):
    titles: list[str] = Field(min_length=1, max_length=50)
    project_id: str = Field(min_length=1)
    languages: list[str] | None = None
    content_source: Literal["manual", "derived"] = "manual"


class DraftRequest(TraceRequest):
    recipe_id: str = Field(min_length=1)
    overrides: dict[str, Any] = Field(default_factory=dict)


class ConfirmRequest(TraceRequest):
    review_id: str = Field(min_length=1)
    content_version: str = Field(min_length=1)
    explicit_user_confirmation: bool = False


class ReviseReviewRequest(TraceRequest):
    action: Literal["direct_edit", "rewrite_script", "regenerate_all"]
    review_id: str = Field(min_length=1)
    content_version: str = Field(min_length=1)
    instruction: str | None = Field(default=None, max_length=2000)
    variants: dict[str, ContentVariant] | None = None
    scene_manifest: SceneManifest | None = None


class SceneManifestRequest(TraceRequest):
    scenes: list[SceneDraft] = Field(min_length=1)
    overwrite_draft: bool = False

    @model_validator(mode="after")
    def reject_prebound_assets(self):
        if any(scene.asset_id for scene in self.scenes):
            raise ValueError("scene manifest is text-only; upload images after user confirmation")
        return self


class SceneImageInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scene_id: str = Field(min_length=1, max_length=120)
    image_data_url: str = Field(min_length=1)
    replace: bool = False


class SceneImagesRequest(TraceRequest):
    images: list[SceneImageInput] = Field(min_length=1)


class ProduceRequest(TraceRequest):
    recipe_id: str = Field(min_length=1)
    language: str | None = None
    overrides: dict[str, Any] = Field(default_factory=dict)


class MarkPublishedRequest(TraceRequest):
    production_task_id: str | None = None
    platform: str = Field(min_length=1)
    published_at: str = Field(min_length=1)
    publish_url: str | None = None
    platform_post_id: str | None = None
    buffer_id: str | None = None
    manual_evidence: str | None = None

    @field_validator("platform")
    @classmethod
    def validate_platform(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("platform must not be blank")
        return value

    @field_validator("published_at")
    @classmethod
    def validate_published_at(cls, value: str) -> str:
        try:
            datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("published_at must be an ISO-8601 timestamp") from exc
        return value


class MetricsRequest(TraceRequest):
    production_task_id: str | None = None
    likes: int | None = Field(default=None, ge=0)
    favorites: int | None = Field(default=None, ge=0)
    comments: int | None = Field(default=None, ge=0)
    note: str | None = None
    publication_id: str | None = None
    mock: bool = False
    mock_label: str | None = None

    @model_validator(mode="after")
    def require_observation(self):
        if all(
            value is None or (isinstance(value, str) and not value.strip())
            for value in (self.likes, self.favorites, self.comments, self.note)
        ):
            raise ValueError("at least one metric or note is required")
        return self


def _trace(request: TraceRequest) -> dict[str, Any]:
    return {
        key: value
        for key, value in {
            "client_name": request.client_name,
            "agent_session_id": request.agent_session_id,
            "request_id": request.request_id,
            "source": request.source,
        }.items()
        if value not in (None, "")
    }


def _item_or_404(item_id: str) -> ContentItem:
    item = load_item(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail=f"未找到内容条目：{item_id}")
    return item


async def plan_video_scenes(
    *,
    item: ContentItem,
    production_task,
    pixelle_video,
    actor: str = "system",
    review_kind: Literal["video_scenes", "image_pages"] = "video_scenes",
) -> ContentItem:
    """Create the reviewable scene plan before any media provider is called."""

    confirmed_variant = next(
        (
            variant
            for variant in item.variants.values()
            if variant.status == "confirmed" and variant.script.strip()
        ),
        None,
    )
    if confirmed_variant is None:
        raise ValueError("没有可用于规划分镜的已确认文案。")
    if pixelle_video.llm is None:
        raise RuntimeError("写稿模型服务尚未初始化。")
    narrations = await split_confirmed_script(
        llm_service=pixelle_video.llm,
        script=confirmed_variant.script,
        settings=dict(production_task.effective_params),
        language=confirmed_variant.language,
        topic=item.title,
    )
    item.scene_manifest = SceneManifest(
        review_kind=review_kind,
        scenes=[
            SceneDraft(
                scene_id=f"scene-{index}",
                order=index,
                narration=narration,
                # Standard video generates the visual prompt only after scene approval.
                image_prompt=narration,
            )
            for index, narration in enumerate(narrations, start=1)
        ],
        confirmed=False,
    )
    item.status = "pending_review"
    item.updated_at = now_iso()
    create_item_stage_revision(item, created_by=actor, source="system")
    item.add_event(
        "scene_plan_generated",
        actor,
        {"scene_count": len(narrations), "production_task_id": production_task.production_task_id},
    )
    save_item(item)
    from pixelle_video.content.production_tasks import set_task_state

    set_task_state(
        production_task.production_task_id,
        state="needs_user",
        stage_id="review_pages" if review_kind == "image_pages" else "review_scenes",
        stage_label="确认分页" if review_kind == "image_pages" else "确认分镜",
        next_actor="user",
        action_type="confirm_pages" if review_kind == "image_pages" else "confirm_scenes",
        action_label="确认分页" if review_kind == "image_pages" else "确认分镜",
    )
    return item


async def run_scene_planning(
    *,
    item_id: str,
    production_task_id: str,
    pixelle_video,
    review_kind: Literal["video_scenes", "image_pages"],
) -> None:
    """Run a persisted scene-planning stage after the HTTP response is sent.

    The stable production task is the durable checkpoint. Re-entering this
    function after a service restart is safe when the review result already
    exists: it restores the task projection instead of generating a duplicate
    revision.
    """

    from pixelle_video.content.production_tasks import (
        load_production_task,
        set_task_state,
    )

    item = load_item(item_id)
    task = load_production_task(production_task_id)
    if item is None or task is None or task.state == "cancelled":
        return
    if (
        item.status == "pending_review"
        and item.scene_manifest is not None
        and item.scene_manifest.review_kind == review_kind
        and not item.scene_manifest.confirmed
    ):
        set_task_state(
            production_task_id,
            state="needs_user",
            stage_id="review_pages" if review_kind == "image_pages" else "review_scenes",
            stage_label="确认分页" if review_kind == "image_pages" else "确认分镜",
            next_actor="user",
            action_type="confirm_pages" if review_kind == "image_pages" else "confirm_scenes",
            action_label="确认分页" if review_kind == "image_pages" else "确认分镜",
        )
        return
    try:
        await plan_video_scenes(
            item=item,
            production_task=task,
            pixelle_video=pixelle_video,
            review_kind=review_kind,
        )
    except Exception as exc:  # noqa: BLE001 - failure is persisted for the workbench
        set_task_state(
            production_task_id,
            state="failed",
            stage_id="plan_scenes",
            stage_label="分镜规划失败",
            next_actor="user",
            action_type="retry",
            action_label="原样重试",
            error=GenerationError(
                layer="runtime",
                message="分镜规划未能完成，请查看本机 API 日志。",
                exception_type=type(exc).__name__,
            ),
        )
        current = load_item(item_id)
        if current is not None:
            current.automation["production_failure"] = {
                "stage": "plan_scenes",
                "message": "已确认的内容已保留，但分镜规划失败。",
            }
            current.updated_at = now_iso()
            save_item(current)


@router.post("/{item_id}/revise-review", response_model=ContentItem)
async def revise_review(
    item_id: str,
    request: ReviseReviewRequest,
    background_tasks: BackgroundTasks,
    identity: IdentityDep,
    pixelle_video: PixelleVideoDep,
):
    """Regenerate the current review content while keeping the production task stable."""

    item = _item_or_404(item_id)
    operation, created = _begin(
        request,
        operation="revise_review",
        item=item,
        payload={"item_id": item_id, **request.model_dump(mode="json")},
    )
    if not created:
        return _item_or_404(item_id)

    try:
        review = validate_review_session(
            item,
            review_id=request.review_id,
            version=request.content_version,
        )
    except ValueError as exc:
        fail_operation(operation, str(exc), layer="input")
        raise HTTPException(status_code=409, detail=str(exc)) from None

    from pixelle_video.content.production_tasks import latest_task_for_content, set_task_state

    task = latest_task_for_content(item.item_id, states={"needs_user", "in_progress"})
    if task is None:
        fail_operation(operation, "没有可继续的生产任务。", layer="product_assumption")
        raise HTTPException(status_code=409, detail="没有可继续的生产任务。")
    if request.action != "direct_edit" and pixelle_video.llm is None:
        fail_operation(operation, "写稿模型服务尚未初始化。", layer="config")
        raise HTTPException(status_code=503, detail="写稿模型服务尚未初始化。")

    if request.action != "direct_edit":
        stage_id = "rewrite_script" if request.action == "rewrite_script" else "regenerate_scenes"
        stage_label = (
            "正在重写文案"
            if request.action == "rewrite_script"
            else "正在重新生成分页"
            if item.scene_manifest and item.scene_manifest.review_kind == "image_pages"
            else "正在重新生成分镜"
        )
        set_task_state(
            task.production_task_id,
            state="in_progress",
            stage_id=stage_id,
            stage_label=stage_label,
            next_actor="system",
            operation_id=operation.operation_id,
        )
        background_tasks.add_task(
            _run_review_regeneration,
            operation_id=operation.operation_id,
            item_id=item.item_id,
            production_task_id=task.production_task_id,
            request=request,
            actor=identity.actor,
            source="agent" if identity.is_agent else "react",
            pixelle_video=pixelle_video,
        )
        return item

    try:
        if item.scene_manifest is not None:
            if request.scene_manifest is None:
                raise ValueError("直接编辑分镜或分页时必须提交完整清单。")
            item.scene_manifest = request.scene_manifest.model_copy(
                update={"confirmed": False, "updated_at": now_iso()}
            )
        else:
            if not request.variants:
                raise ValueError("直接编辑文案时必须提交完整语言版本。")
            if not any(variant.script.strip() for variant in request.variants.values()):
                raise ValueError("待确认文案不能为空。")
            item.variants = {
                language: variant.model_copy(update={"language": language, "status": "pending"})
                for language, variant in request.variants.items()
            }

        item.updated_at = now_iso()
        create_item_stage_revision(
            item,
            created_by=identity.actor,
            source="agent" if identity.is_agent else "react",
            supersedes_revision_id=review.review_id,
        )
        item.add_event(
            "review_regenerated",
            identity.actor,
            {
                "action": request.action,
                "has_instruction": bool((request.instruction or "").strip()),
                **_trace(request),
            },
        )
        save_item(item)
        stage_is_pages = bool(
            item.scene_manifest and item.scene_manifest.review_kind == "image_pages"
        )
        set_task_state(
            task.production_task_id,
            state="needs_user",
            stage_id=("review_pages" if stage_is_pages else "review_scenes")
            if item.scene_manifest
            else "review_script",
            stage_label=("确认分页" if stage_is_pages else "确认分镜")
            if item.scene_manifest
            else "确认文案",
            next_actor="user",
            action_type=("confirm_pages" if stage_is_pages else "confirm_scenes")
            if item.scene_manifest
            else "confirm_script",
            action_label=("确认分页" if stage_is_pages else "确认分镜")
            if item.scene_manifest
            else "确认文案",
            operation_id=operation.operation_id,
        )
        complete_operation(operation, {"item_id": item.item_id, "status": item.status})
        return item
    except ValueError as exc:
        fail_operation(operation, str(exc), layer="input")
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except Exception as exc:
        fail_operation(operation, str(exc), layer="runtime")
        raise HTTPException(status_code=500, detail="修改保存失败。") from exc


async def _run_review_regeneration(
    *,
    operation_id: str,
    item_id: str,
    production_task_id: str,
    request: ReviseReviewRequest,
    actor: str,
    source: Literal["react", "agent"],
    pixelle_video,
) -> None:
    """Run an LLM-assisted review revision after returning an acceptance response."""

    from pixelle_video.content.drafting import draft_topic
    from pixelle_video.content.production_tasks import (
        load_production_task,
        set_task_state,
    )

    operation = load_operation(operation_id)
    item = load_item(item_id)
    task = load_production_task(production_task_id)
    if operation is None or item is None or task is None or task.state == "cancelled":
        return
    try:
        if request.action == "rewrite_script":
            if item.scene_manifest is not None:
                raise ValueError("当前正在确认分镜或分页，不能重写上一个确认站的文案。")
            topic = str(task.input_snapshot.get("topic") or item.title).strip()
            draft = await draft_topic(
                llm_service=pixelle_video.llm,
                topic=topic,
                languages=item.languages or ["Chinese"],
                settings=task.effective_params,
            )
            language_drafts = draft.get("language_drafts") or {}
            if not language_drafts:
                raise ValueError("系统重写没有返回可确认文案。")
            item.variants = {
                language: ContentVariant(
                    language=language,
                    status="pending",
                    title=payload.get("title") or item.title,
                    script=payload.get("script") or "",
                )
                for language, payload in language_drafts.items()
            }
        else:
            manifest = item.scene_manifest
            if manifest is None:
                raise ValueError("当前没有可重新生成的分镜或分页。")
            confirmed_variant = next(
                (variant for variant in item.variants.values() if variant.script.strip()),
                None,
            )
            if confirmed_variant is None:
                raise ValueError("没有可用于重新规划的文案。")
            narrations = await split_confirmed_script(
                llm_service=pixelle_video.llm,
                script=confirmed_variant.script,
                settings=task.effective_params,
                language=confirmed_variant.language,
                topic=item.title,
            )
            manifest.scenes = [
                SceneDraft(
                    scene_id=f"scene-{index}",
                    order=index,
                    narration=narration,
                    image_prompt=narration,
                )
                for index, narration in enumerate(narrations, start=1)
            ]
            manifest.confirmed = False
            manifest.updated_at = now_iso()

        item.updated_at = now_iso()
        create_item_stage_revision(
            item,
            created_by=actor,
            source=source,
            supersedes_revision_id=request.review_id,
        )
        item.add_event(
            "review_regenerated",
            actor,
            {
                "action": request.action,
                "has_instruction": bool((request.instruction or "").strip()),
                **_trace(request),
            },
        )
        save_item(item)
        stage_is_pages = bool(
            item.scene_manifest and item.scene_manifest.review_kind == "image_pages"
        )
        set_task_state(
            task.production_task_id,
            state="needs_user",
            stage_id=("review_pages" if stage_is_pages else "review_scenes")
            if item.scene_manifest
            else "review_script",
            stage_label=("确认分页" if stage_is_pages else "确认分镜")
            if item.scene_manifest
            else "确认文案",
            next_actor="user",
            action_type=("confirm_pages" if stage_is_pages else "confirm_scenes")
            if item.scene_manifest
            else "confirm_script",
            action_label=("确认分页" if stage_is_pages else "确认分镜")
            if item.scene_manifest
            else "确认文案",
            operation_id=operation.operation_id,
        )
        complete_operation(operation, {"item_id": item.item_id, "status": item.status})
    except Exception as exc:  # noqa: BLE001 - preserve the old review and expose the failure
        fail_operation(operation, str(exc), layer="runtime")
        stage_is_pages = bool(
            item.scene_manifest and item.scene_manifest.review_kind == "image_pages"
        )
        set_task_state(
            task.production_task_id,
            state="needs_user",
            stage_id=("review_pages" if stage_is_pages else "review_scenes")
            if item.scene_manifest
            else "review_script",
            stage_label=("确认分页" if stage_is_pages else "确认分镜")
            if item.scene_manifest
            else "确认文案",
            next_actor="user",
            action_type=("confirm_pages" if stage_is_pages else "confirm_scenes")
            if item.scene_manifest
            else "confirm_script",
            action_label=("确认分页" if stage_is_pages else "确认分镜")
            if item.scene_manifest
            else "确认文案",
            error=GenerationError(
                layer="runtime",
                message="重新生成失败，原确认内容仍已保留。",
                exception_type=type(exc).__name__,
            ),
            operation_id=operation.operation_id,
        )


def _begin(
    request: TraceRequest, *, operation: str, item: ContentItem, payload: dict[str, Any]
) -> tuple[ContentFlowOperation, bool]:
    try:
        return begin_operation(
            request_id=request.request_id,
            payload_hash=request_hash(payload),
            operation=operation,
            item_id=item.item_id,
            prior_status=item.status,
            payload=payload,
        )
    except FileExistsError:
        raise HTTPException(
            status_code=409, detail="request_id 已被另一份不同内容的请求使用。"
        ) from None
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None


def _existing_result(operation: ContentFlowOperation) -> dict[str, Any]:
    return {
        "operation_id": operation.operation_id,
        "status": operation.status,
        "result": operation.result,
        "error": operation.error,
        "idempotent": True,
    }


@router.post("/topics", response_model=list[ContentItem])
async def add_topics(request: TopicsRequest, identity: IdentityDep):
    titles = [title.strip() for title in request.titles if title.strip()]
    if not titles:
        raise HTTPException(status_code=400, detail="至少需要一个标题。")
    project_id = request.project_id
    if get_project(project_id) is None:
        raise HTTPException(status_code=404, detail=f"未找到项目：{project_id}")

    synthetic = ContentItem(
        item_id=f"topics:{request.request_id}",
        title="topics",
        project=project_id,
        created_at=now_iso(),
        updated_at=now_iso(),
    )
    operation, created = _begin(
        request,
        operation="topics",
        item=synthetic,
        payload=request.model_dump(mode="json"),
    )
    if not created and operation.result:
        return [
            item
            for item_id in operation.result.get("item_ids", [])
            if (item := load_item(item_id)) is not None
        ]
    if not created:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "这次选题请求已经处理过，且没有可重复返回的结果。",
                "operation_id": operation.operation_id,
                "status": operation.status,
            },
        )

    items: list[ContentItem] = []
    for title in titles:
        item = new_content_item(
            title=title,
            source="agent" if identity.is_agent else request.content_source,
            project=project_id,
            languages=request.languages or ["Chinese"],
            actor=identity.actor,
        )
        item.events[-1].detail.update(_trace(request))
        save_item(item)
        items.append(item)
    complete_operation(operation, {"item_ids": [item.item_id for item in items]})
    return items


@router.post("/{item_id}/draft", status_code=status.HTTP_202_ACCEPTED)
async def draft_item(
    item_id: str,
    request: DraftRequest,
    background_tasks: BackgroundTasks,
    pixelle_video: PixelleVideoDep,
    identity: IdentityDep,
):
    item = _item_or_404(item_id)
    operation, created = _begin(
        request,
        operation="draft",
        item=item,
        payload={"item_id": item_id, **request.model_dump(mode="json")},
    )
    if not created:
        return _existing_result(operation)
    if item.status != "idea":
        fail_operation(operation, f"只有 idea 状态可以起草，当前为 {item.status}。", layer="input")
        raise HTTPException(status_code=400, detail="只有选题池中的内容可以开始起草。")

    from pixelle_video.content.production_service import prepare_production
    from pixelle_video.content.production_tasks import latest_task_for_content

    template = build_default_production_template_registry().get(request.recipe_id)
    if template.pipeline_id not in {"topic_to_video", "topic_to_image_post"}:
        fail_operation(operation, "所选模板不是主题起稿路线。", layer="input")
        raise HTTPException(status_code=400, detail="所选模板不是主题起稿路线。")

    production_task = latest_task_for_content(
        item.item_id,
        states={"in_progress", "needs_user"},
        pipeline_id=template.pipeline_id,
    )
    if production_task is None:
        try:
            prepare_production(
                project_id=item.project,
                pipeline_id=template.pipeline_id,
                recipe_id=request.recipe_id,
                input_payload={"topic": item.title},
                overrides=request.overrides,
                request_id=f"{request.request_id}:production",
                source="agent" if identity.is_agent else "react",
                actor="agent" if identity.is_agent else "user",
                content_item_id=item.item_id,
                metadata=_trace(request),
            )
        except (ProductionTemplateError, ValueError) as exc:
            fail_operation(operation, str(exc), layer="input")
            item.automation["production_failure"] = {
                "stage": "submit_production",
                "message": str(exc),
            }
            save_item(item)
            return item

    item.status = "drafting"
    item.updated_at = now_iso()
    item.add_event(
        "status_changed",
        identity.actor,
        {"from": "idea", "to": "drafting", **_trace(request)},
    )
    save_item(item)
    background_tasks.add_task(
        _run_draft,
        operation.operation_id,
        item_id,
        request,
        template.pipeline_id,
        identity.actor,
        pixelle_video,
    )
    return {"operation_id": operation.operation_id, "status": operation.status}


async def _run_draft(
    operation_id: str,
    item_id: str,
    request: DraftRequest,
    pipeline_id: str,
    actor: str,
    pixelle_video,
) -> None:
    from pixelle_video.content.drafting import draft_topic

    operation = load_operation(operation_id)
    item = load_item(item_id)
    if operation is None or item is None:
        return
    try:
        from pixelle_video.content.production_tasks import latest_task_for_content

        production_task = latest_task_for_content(
            item.item_id,
            states={"in_progress"},
            pipeline_id=pipeline_id,
        )
        if production_task is None:
            raise RuntimeError("主题路线缺少可读取的生产设置快照。")
        draft = await draft_topic(
            llm_service=pixelle_video.llm,
            topic=item.title,
            languages=item.languages,
            settings=production_task.effective_params,
        )
        operation.phase = "external_completed"
        save_operation(operation)
        if not draft.get("language_drafts"):
            raise RuntimeError("草稿生成没有返回可审核内容。")
        variants: dict[str, ContentVariant] = {}
        for language, payload in draft["language_drafts"].items():
            variants[language] = ContentVariant(
                language=language,
                status="pending",
                title=payload.get("title") or item.title,
                script=payload.get("script") or "",
            )
        item = _item_or_404(item_id)
        item.variants = variants
        item.status = "pending_review"
        item.updated_at = now_iso()
        create_item_stage_revision(item, created_by=actor, source="system")
        item.add_event(
            "draft_generated",
            actor,
            {"recipe_id": request.recipe_id, **_trace(request)},
        )
        save_item(item)
        operation.phase = "item_updated"
        save_operation(operation)
        complete_operation(operation, {"item_id": item.item_id, "status": item.status})
        from pixelle_video.content.production_tasks import set_task_state

        production_task = latest_task_for_content(
            item.item_id, states={"in_progress"}, pipeline_id=pipeline_id
        )
        if production_task is not None:
            set_task_state(
                production_task.production_task_id,
                state="needs_user",
                stage_id="review_script",
                stage_label="确认文案",
                next_actor="user",
                action_type="confirm_script",
                action_label="确认文案",
                operation_id=operation.operation_id,
            )
    except Exception as exc:  # noqa: BLE001 - persisted failure is the API contract
        item = load_item(item_id)
        if item is not None and item.status == "drafting":
            item.status = "idea"
            item.updated_at = now_iso()
            item.add_event(
                "status_changed",
                "system",
                {"from": "drafting", "to": "idea", "reason": str(exc)},
            )
            save_item(item)
        fail_operation(operation, str(exc))
        from pixelle_video.content.production_tasks import (
            latest_task_for_content,
            set_task_state,
        )

        production_task = latest_task_for_content(
            item_id, states={"in_progress"}, pipeline_id=pipeline_id
        )
        if production_task is not None:
            set_task_state(
                production_task.production_task_id,
                state="failed",
                stage_id="generate_script",
                stage_label="写稿失败",
                next_actor="user",
                action_type="view_error",
                action_label="查看原因",
                error=GenerationError(
                    layer="runtime",
                    message=str(exc),
                    exception_type=type(exc).__name__,
                ),
                operation_id=operation.operation_id,
            )


async def _run_confirmed_digital_human(
    *,
    item_id: str,
    production_task_id: str,
    request: ConfirmRequest,
    identity: RequestIdentity,
    generation_service,
) -> None:
    """Submit confirmed digital-human copy after the confirmation response."""

    from pixelle_video.content.production_tasks import (
        attach_generation_task,
        load_production_task,
        set_task_state,
    )

    item = load_item(item_id)
    task = load_production_task(production_task_id)
    if item is None or task is None or task.state == "cancelled":
        return
    try:
        confirmed_variant = next(
            (
                variant
                for variant in item.variants.values()
                if variant.status == "confirmed" and variant.script.strip()
            ),
            None,
        )
        if confirmed_variant is None:
            raise ValueError("数字人口播确认稿不可读。")
        template_registry = build_default_production_template_registry()
        generation_request = template_registry.compile_request(
            task.recipe_id,
            input={
                **task.input_snapshot,
                **task.effective_params,
                "script": confirmed_variant.script,
            },
            metadata={
                "content_item_id": item.item_id,
                "project_id": item.project,
                "production_task_id": task.production_task_id,
                "production_run_id": task.production_task_id,
                **_trace(request),
            },
            idempotency_key=f"{request.request_id}:produce",
            available_capabilities=detect_available_generation_capabilities(),
            surface="agent" if identity.is_agent else "public",
        )
        generation_request.params = dict(task.effective_params)
        generation_request.params["title"] = confirmed_variant.title or item.title
        generation_request.input["script"] = confirmed_variant.script
        generation_task = generation_service.submit(
            generation_request,
            surface="agent" if identity.is_agent else "public",
        )
        attach_generation_task(
            task.production_task_id,
            generation_task,
            effective_params=generation_request.params,
        )
        links = dict(item.links)
        task_ids = list(links.get("task_ids") or [])
        if generation_task.task_id not in task_ids:
            task_ids.append(generation_task.task_id)
        links["task_ids"] = task_ids
        item.links = links
        item.status = "producing"
        item.updated_at = now_iso()
        item.add_event(
            "production_started",
            identity.actor,
            {
                "production_task_id": task.production_task_id,
                "task_id": generation_task.task_id,
                **_trace(request),
            },
        )
        save_item(item)
    except Exception as exc:  # noqa: BLE001 - failure must be visible in the workbench
        set_task_state(
            production_task_id,
            state="failed",
            stage_id="submit_production",
            stage_label="数字人生产启动失败",
            next_actor="user",
            action_type="retry",
            action_label="原样重试",
            error=GenerationError(
                layer="runtime",
                message="已确认的文案已保留，但数字人生产未能启动。",
                exception_type=type(exc).__name__,
            ),
        )


async def _run_confirmed_content_production(
    *,
    item_id: str,
    production_task_id: str,
    request: ProduceRequest,
    identity: RequestIdentity,
    generation_service,
) -> None:
    """Submit approved scenes/pages without holding the confirmation request open."""

    from pixelle_video.content.production_tasks import set_task_state

    try:
        await produce_item(item_id, request, identity, generation_service)
    except Exception as exc:  # noqa: BLE001 - failure is persisted for retry
        set_task_state(
            production_task_id,
            state="failed",
            stage_id="submit_production",
            stage_label="生产任务启动失败",
            next_actor="user",
            action_type="retry",
            action_label="原样重试",
            error=GenerationError(
                layer="runtime",
                message="已确认的内容已保留，但生产未能启动。",
                exception_type=type(exc).__name__,
            ),
        )
        item = load_item(item_id)
        if item is not None:
            item.automation["production_failure"] = {
                "stage": "submit_production",
                "message": "内容已确认，但生产启动失败；请在工作台原样重试。",
            }
            item.updated_at = now_iso()
            save_item(item)


@router.post("/{item_id}/confirm", response_model=ContentItem)
async def confirm_item(
    item_id: str,
    request: ConfirmRequest,
    background_tasks: BackgroundTasks,
    identity: IdentityDep,
    generation_service: GenerationServiceDep,
    pixelle_video: PixelleVideoDep,
):
    item = _item_or_404(item_id)
    if identity.is_agent:
        if not request.explicit_user_confirmation:
            raise HTTPException(
                status_code=403,
                detail="Agent 只能转交用户明确作出的确认决定。",
            )
        if not request.client_name or not request.agent_session_id:
            raise HTTPException(
                status_code=403,
                detail="Agent 确认缺少可追溯的客户端或会话标识。",
            )
    had_scene_manifest = item.scene_manifest is not None
    operation, created = _begin(
        request,
        operation="confirm",
        item=item,
        payload={"item_id": item_id, **request.model_dump(mode="json")},
    )
    if not created:
        existing = load_item(item_id)
        return existing or item
    try:
        review = validate_review_session(
            item,
            review_id=request.review_id,
            version=request.content_version,
        )
    except ValueError as exc:
        fail_operation(operation, str(exc), layer="input")
        raise HTTPException(status_code=409, detail=str(exc)) from None
    revision = get_revision(review.review_id)
    if revision is None:
        fail_operation(operation, "待确认版本已经不可读。", layer="persistence")
        raise HTTPException(status_code=409, detail="待确认版本已经不可读，请重新读取。")
    try:
        confirmation = confirm_revision(
            revision.revision_id,
            request_id=request.request_id,
            actor=identity.actor,
            source="agent" if identity.is_agent else "react",
        )
    except (ConfirmationRequestConflict, StageRevisionAlreadyConfirmed, StaleStageRevision) as exc:
        fail_operation(operation, str(exc), layer="input")
        raise HTTPException(status_code=409, detail=str(exc)) from None

    apply_revision_to_item(item, revision)
    if revision.kind == "script":
        for variant in item.variants.values():
            variant.status = "confirmed"
        if not any(variant.script.strip() for variant in item.variants.values()):
            fail_operation(operation, "确认文案不能为空。", layer="input")
            raise HTTPException(status_code=400, detail="确认文案不能为空。")
    elif item.scene_manifest:
        item.scene_manifest.confirmed = True
        item.scene_manifest.updated_at = now_iso()
    previous = item.status
    item.status = "confirmed"
    item.updated_at = now_iso()
    item.add_event(
        "confirmed",
        identity.actor,
        {
            "from": previous,
            "to": "confirmed",
            "revision_id": revision.revision_id,
            "confirmation_id": confirmation.confirmation_id,
            **_trace(request),
        },
    )
    save_item(item)
    complete_operation(operation, {"item_id": item.item_id, "status": item.status})
    from pixelle_video.content.production_tasks import (
        latest_task_for_content,
        record_task_confirmation,
        set_task_state,
    )

    production_task = latest_task_for_content(item.item_id, states={"needs_user", "in_progress"})
    if production_task is None:
        return item
    record_task_confirmation(
        production_task.production_task_id,
        references={
            "confirmation_operation_id": operation.operation_id,
            f"approved_{revision.kind}_revision_id": revision.revision_id,
            f"approved_{revision.kind}_confirmation_id": confirmation.confirmation_id,
        },
    )
    if production_task.pipeline_id == "codex_scene_video":
        set_task_state(
            production_task.production_task_id,
            state="in_progress",
            stage_id="generate_agent_images",
            stage_label="等待 Agent 生成并上传图片",
            next_actor="agent",
            operation_id=operation.operation_id,
        )
        return item
    if production_task.pipeline_id == "digital_human" and not had_scene_manifest:
        set_task_state(
            production_task.production_task_id,
            state="in_progress",
            stage_id="submit_production",
            stage_label="正在启动数字人生产",
            next_actor="system",
            operation_id=operation.operation_id,
        )
        background_tasks.add_task(
            _run_confirmed_digital_human,
            item_id=item.item_id,
            production_task_id=production_task.production_task_id,
            request=request,
            identity=identity,
            generation_service=generation_service,
        )
        return item
    if (
        production_task.pipeline_id in {"topic_to_video", "topic_to_image_post"}
        and not had_scene_manifest
    ):
        set_task_state(
            production_task.production_task_id,
            state="in_progress",
            stage_id="plan_scenes",
            stage_label="正在规划分镜",
            next_actor="system",
            operation_id=operation.operation_id,
        )
        background_tasks.add_task(
            run_scene_planning,
            item_id=item.item_id,
            production_task_id=production_task.production_task_id,
            pixelle_video=pixelle_video,
            review_kind=(
                "image_pages"
                if production_task.pipeline_id == "topic_to_image_post"
                else "video_scenes"
            ),
        )
        return item
    if production_task.pipeline_id in {
        "topic_to_video",
        "topic_to_image_post",
        "script_to_video",
        "image_post",
    }:
        is_image_post = production_task.pipeline_id in {"image_post", "topic_to_image_post"}
        set_task_state(
            production_task.production_task_id,
            state="in_progress",
            stage_id="compose_pages" if is_image_post else "split_scenes",
            stage_label="准备生成图集" if is_image_post else "准备视频生产",
            next_actor="system",
            operation_id=operation.operation_id,
        )
        background_tasks.add_task(
            _run_confirmed_content_production,
            item_id=item.item_id,
            production_task_id=production_task.production_task_id,
            request=ProduceRequest(
                request_id=f"{request.request_id}:produce",
                recipe_id=production_task.recipe_id,
                client_name=request.client_name,
                agent_session_id=request.agent_session_id,
                source=request.source,
            ),
            identity=identity,
            generation_service=generation_service,
        )
        return item
    return item


@router.put("/{item_id}/scene-manifest", response_model=ContentItem)
async def submit_scene_manifest(item_id: str, request: SceneManifestRequest, identity: IdentityDep):
    require_agent(identity)
    item = _item_or_404(item_id)
    operation, created = _begin(
        request,
        operation="scene_manifest",
        item=item,
        payload={"item_id": item_id, **request.model_dump(mode="json")},
    )
    if not created:
        return _item_or_404(item_id)
    if item.status == "drafting":
        fail_operation(operation, "条目正在起草。", layer="input")
        raise HTTPException(status_code=409, detail="条目正在起草，请等待起草结束。")
    if item.status not in {"idea", "draft_ready", "pending_review"}:
        fail_operation(operation, "分镜文案已经锁定或当前状态不可编辑。", layer="input")
        raise HTTPException(status_code=400, detail="分镜文案已经锁定或当前状态不可编辑。")

    scenes = sorted(request.scenes, key=lambda scene: scene.order)
    item.scene_manifest = SceneManifest(
        review_kind="agent_image_scenes", scenes=scenes, confirmed=False
    )
    previous = item.status
    item.status = "pending_review"
    item.updated_at = now_iso()
    item.add_event(
        "draft_generated",
        identity.actor,
        {"from": previous, "to": "pending_review", "scene_count": len(scenes), **_trace(request)},
    )
    from pixelle_video.content.production_tasks import latest_task_for_content

    production_task = latest_task_for_content(
        item.item_id,
        states={"in_progress", "needs_user"},
        pipeline_id="codex_scene_video",
    )
    if production_task is None:
        fail_operation(
            operation,
            "没有可继续的 Agent 配图视频生产任务。",
            layer="product_assumption",
        )
        raise HTTPException(
            status_code=409,
            detail="请先用 start_production 发起 Agent 配图视频，再提交分镜修改。",
        )
    links = dict(item.links)
    production_task_ids = list(links.get("production_task_ids") or [])
    if production_task.production_task_id not in production_task_ids:
        production_task_ids.append(production_task.production_task_id)
    links["production_task_ids"] = production_task_ids
    item.links = links
    create_item_stage_revision(
        item,
        created_by=identity.actor,
        source="agent",
    )
    save_item(item)
    operation.phase = "item_updated"
    save_operation(operation)
    complete_operation(operation, {"item_id": item.item_id, "status": item.status})
    return item


@router.post("/{item_id}/scene-images")
async def upload_scene_images(
    item_id: str,
    request: SceneImagesRequest,
    identity: IdentityDep,
    generation_service: GenerationServiceDep,
):
    require_agent(identity)
    item = _item_or_404(item_id)
    operation, created = _begin(
        request,
        operation="scene_images",
        item=item,
        payload={"item_id": item_id, **request.model_dump(mode="json")},
    )
    if not created:
        return _existing_result(operation)
    if item.status == "producing":
        fail_operation(operation, "生产进行中不能替换分镜图片。", layer="input")
        raise HTTPException(status_code=409, detail="生产进行中不能替换分镜图片。")
    if item.status not in {"confirmed", "produced"}:
        fail_operation(operation, "当前状态不允许上传分镜图片。", layer="input")
        raise HTTPException(status_code=400, detail="只有确认后或重新生产前可以上传分镜图片。")
    if not item.scene_manifest or not item.scene_manifest.confirmed:
        fail_operation(operation, "分镜尚未由用户确认。", layer="input")
        raise HTTPException(status_code=400, detail="请先由用户确认完整分镜。")
    scene_by_id = {scene.scene_id: scene for scene in item.scene_manifest.scenes}
    requested_ids = [image.scene_id for image in request.images]
    unknown_ids = [scene_id for scene_id in requested_ids if scene_id not in scene_by_id]
    if unknown_ids:
        fail_operation(
            operation,
            f"未知分镜 scene_id：{', '.join(dict.fromkeys(unknown_ids))}",
            layer="input",
        )
        raise HTTPException(
            status_code=400,
            detail={"message": "包含未知分镜。", "unknown_scene_ids": unknown_ids},
        )
    if len(requested_ids) != len(set(requested_ids)):
        fail_operation(operation, "同一请求不能重复上传同一分镜。", layer="input")
        raise HTTPException(status_code=400, detail="同一请求不能重复上传同一分镜。")
    results: list[dict[str, Any]] = []
    try:
        for image in request.images:
            scene = scene_by_id[image.scene_id]
            result = save_agent_image(
                experiment_id=item.item_id,
                scene_id=scene.scene_id,
                prompt=scene.image_prompt,
                source={"kind": "agent", "confirmed_by_user": True, **_trace(request)},
                image_data_url=image.image_data_url,
                replace=image.replace,
            )
            scene.asset_id = result["asset_id"]
            results.append({key: value for key, value in result.items() if key != "path"})
    except AgentImageError as exc:
        fail_operation(operation, str(exc), layer="input")
        raise HTTPException(status_code=400, detail=str(exc)) from None
    item.scene_manifest.updated_at = now_iso()
    item.updated_at = now_iso()
    item.add_event(
        "note",
        identity.actor,
        {
            "changed": ["scene_images"],
            "scene_ids": [r["scene_id"] for r in results],
            **_trace(request),
        },
    )
    save_item(item)
    complete_operation(operation, {"item_id": item.item_id, "images": results})
    if all(scene.asset_id for scene in item.scene_manifest.scenes):
        from pixelle_video.content.production_tasks import latest_task_for_content

        production_task = latest_task_for_content(
            item.item_id,
            states={"in_progress", "produced"},
            pipeline_id="codex_scene_video",
        )
        if production_task is None:
            raise HTTPException(status_code=409, detail="关联生产任务不存在，无法继续合成。")
        production = await produce_item(
            item.item_id,
            ProduceRequest(
                request_id=f"{request.request_id}:produce",
                recipe_id=production_task.recipe_id,
                client_name=request.client_name,
                agent_session_id=request.agent_session_id,
                source=request.source,
            ),
            identity,
            generation_service,
        )
        return {
            "operation_id": operation.operation_id,
            "images": results,
            "item": _item_or_404(item.item_id),
            "production": production,
        }
    return {"operation_id": operation.operation_id, "images": results, "item": item}


@router.get("/{item_id}/scene-images/{scene_id}")
async def get_scene_image(item_id: str, scene_id: str):
    item = _item_or_404(item_id)
    if not item.scene_manifest:
        raise HTTPException(status_code=404, detail="这条内容没有分镜清单。")
    scene = next(
        (candidate for candidate in item.scene_manifest.scenes if candidate.scene_id == scene_id),
        None,
    )
    if scene is None or not scene.asset_id:
        raise HTTPException(status_code=404, detail="这个分镜还没有图片。")
    try:
        path = resolve_agent_image_path(
            experiment_id=item.item_id, scene_id=scene.scene_id, asset_id=scene.asset_id
        )
    except AgentImageError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None
    suffix = Path(path).suffix.lower()
    media_type = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
    }.get(suffix)
    return FileResponse(path, media_type=media_type)


@router.post("/{item_id}/produce")
async def produce_item(
    item_id: str,
    request: ProduceRequest,
    identity: IdentityDep,
    generation_service: GenerationServiceDep,
):
    item = _item_or_404(item_id)
    operation, created = _begin(
        request,
        operation="produce",
        item=item,
        payload={"item_id": item_id, **request.model_dump(mode="json")},
    )
    if not created:
        return _existing_result(operation)
    if item.status not in {"confirmed", "produced"}:
        fail_operation(operation, "请先在控制台确认内容。", layer="input")
        raise HTTPException(status_code=400, detail="请先在控制台确认内容。")

    template_id = request.recipe_id
    registry = build_default_production_template_registry()
    try:
        template = registry.get(template_id)
    except ProductionTemplateError as exc:
        fail_operation(operation, str(exc), layer="input")
        raise HTTPException(status_code=400, detail=str(exc)) from None
    if template.access_scope == "agent":
        if not identity.is_agent:
            fail_operation(operation, "Agent 模板需要有效的 Agent Token。", layer="permissions")
            require_agent(identity)
    pipeline = build_default_pipeline_registry().get_manifest(template.pipeline_id)
    required_input_names = {field.name for field in pipeline.input.required_fields}
    is_scene_pipeline = template.pipeline_id == "codex_scene_video"
    if not is_scene_pipeline and not ({"script", "topic"} & required_input_names):
        fail_operation(
            operation,
            "这个模板需要专用素材输入，首批内容用例接口不能安全构造。",
            layer="product_assumption",
        )
        raise HTTPException(
            status_code=400,
            detail="这个模板需要专用素材输入，请从 React 快速生成发起。",
        )

    from pixelle_video.content.production_tasks import (
        attach_generation_task,
        latest_task_for_content,
        set_task_state,
    )

    production_task = latest_task_for_content(
        item.item_id,
        states={"needs_user", "in_progress", "produced"},
        pipeline_id=template.pipeline_id,
    )
    if production_task is None:
        fail_operation(operation, "没有可继续的生产任务。", layer="product_assumption")
        raise HTTPException(
            status_code=409,
            detail="生产必须从快速生产或 Agent 的 start_production 发起。",
        )
    has_frozen_task_settings = True

    approved_script_revision = get_revision(
        production_task.confirmed_version_refs.get("approved_script_revision_id", "")
    )
    scene_revision_key = {
        "video_scenes": "approved_scene_plan_revision_id",
        "image_pages": "approved_image_pages_revision_id",
        "agent_image_scenes": "approved_agent_image_scenes_revision_id",
    }.get(item.scene_manifest.review_kind if item.scene_manifest else "")
    approved_scene_revision = (
        get_revision(production_task.confirmed_version_refs.get(scene_revision_key, ""))
        if scene_revision_key
        else None
    )

    submissions: list[tuple[str, dict[str, Any], str | None]] = []
    if is_scene_pipeline:
        manifest = item.scene_manifest
        if not manifest or not manifest.confirmed:
            fail_operation(operation, "分镜尚未确认。", layer="input")
            raise HTTPException(status_code=400, detail="分镜尚未确认。")
        missing = [scene.scene_id for scene in manifest.scenes if not scene.asset_id]
        if missing:
            fail_operation(operation, f"缺少分镜图片：{', '.join(missing)}", layer="input")
            raise HTTPException(
                status_code=400,
                detail={"message": "分镜图片不完整。", "missing_scene_ids": missing},
            )
        approved_scenes = (
            approved_scene_revision.payload.scenes
            if approved_scene_revision is not None
            and approved_scene_revision.payload.kind != "script"
            else manifest.scenes
        )
        asset_by_id = {scene.scene_id: scene.asset_id for scene in manifest.scenes}
        try:
            scenes = [
                {
                    "scene_id": scene.scene_id,
                    "narration": scene.narration,
                    "image_prompt": scene.image_prompt,
                    "image_path": resolve_agent_image_path(
                        experiment_id=item.item_id,
                        scene_id=scene.scene_id,
                        asset_id=asset_by_id.get(scene.scene_id) or "",
                    ),
                    **({"duration": scene.duration} if scene.duration is not None else {}),
                }
                for scene in approved_scenes
            ]
        except AgentImageError as exc:
            fail_operation(operation, str(exc), layer="persistence")
            raise HTTPException(status_code=400, detail=str(exc)) from None
        submissions.append(
            (
                request.language or item.languages[0],
                {"scenes": scenes, "title": item.title},
                None,
            )
        )
    else:
        source_variants = item.variants
        if (
            approved_script_revision is not None
            and approved_script_revision.payload.kind == "script"
        ):
            source_variants = {
                language: ContentVariant(
                    language=language,
                    status="confirmed",
                    title=variant.title,
                    script=variant.script,
                )
                for language, variant in approved_script_revision.payload.variants.items()
            }
        for language, variant in source_variants.items():
            if request.language and language != request.language:
                continue
            if variant.status != "confirmed" or not variant.script.strip():
                continue
            confirmed_script = variant.script
            input_payload: dict[str, Any]
            if "topic" in required_input_names:
                input_payload = {
                    "topic": item.title,
                    "title": variant.title or item.title,
                }
            else:
                input_payload = {
                    "script": confirmed_script,
                    "title": variant.title or item.title,
                }
            submissions.append((language, input_payload, confirmed_script))
    if not submissions:
        fail_operation(operation, "没有可生产的已确认内容。", layer="input")
        raise HTTPException(status_code=400, detail="没有可生产的已确认内容。")

    set_task_state(
        production_task.production_task_id,
        state="in_progress",
        stage_id=pipeline.stages[0].id,
        stage_label=pipeline.stages[0].name,
        next_actor="system",
        operation_id=operation.operation_id,
    )

    batch_id = uuid.uuid4().hex
    batch_items: list[dict[str, Any]] = []
    try:
        for index, (language, input_payload, confirmed_script) in enumerate(submissions, start=1):
            metadata = {
                "content_item_id": item.item_id,
                "project_id": item.project,
                "source": "agent_content_flow" if identity.is_agent else "react_content_flow",
                "language": language,
                "batch_id": batch_id,
                "batch_index": index,
                "production_task_id": production_task.production_task_id,
                **_trace(request),
            }
            approved_segments: list[str] = []
            if (
                approved_scene_revision is not None
                and approved_scene_revision.payload.kind != "script"
            ):
                approved_segments = [
                    scene.narration for scene in approved_scene_revision.payload.scenes
                ]
            elif item.scene_manifest and item.scene_manifest.confirmed:
                # One-way compatibility for pre-revision tasks. New confirmations
                # always record an approved revision reference above.
                approved_segments = [scene.narration for scene in item.scene_manifest.scenes]
            generation_request = registry.compile_request(
                template.id,
                input={**input_payload, **request.overrides},
                metadata=metadata,
                idempotency_key=f"{request.request_id}:{index}",
                available_capabilities=detect_available_generation_capabilities(),
                surface="agent" if identity.is_agent else "public",
            )
            # Approved workflow outputs are explicit generation inputs. They are
            # never reconstructed from hidden metadata or a second legacy field.
            if confirmed_script:
                generation_request.input["script"] = confirmed_script
            if approved_segments:
                generation_request.input[
                    "pages"
                    if template.pipeline_id in {"image_post", "topic_to_image_post"}
                    else "scenes"
                ] = approved_segments
            if has_frozen_task_settings:
                # 主题路线在提交主题时已冻结本次设置。人工确认后
                # 必须继续使用同一份快照，不能重读已变化的模板默认。
                generation_request.params = dict(production_task.effective_params)
                content_title = str(input_payload.get("title") or "").strip()
                if content_title:
                    generation_request.params["title"] = content_title
            task = generation_service.submit(
                generation_request,
                surface="agent" if identity.is_agent else "public",
            )
            attach_generation_task(
                production_task.production_task_id,
                task,
                effective_params=generation_request.params,
            )
            operation.task_ids.append(task.task_id)
            operation.batch_id = batch_id
            operation.phase = "task_created"
            save_operation(operation)
            batch_items.append(
                {
                    "index": index,
                    "input": input_payload,
                    "metadata": metadata,
                    "task_id": task.task_id,
                    "status": task.status,
                    "progress": task.progress.model_dump(mode="json"),
                    "error": None,
                }
            )
    except (ProductionTemplateError, ValueError) as exc:
        if not operation.task_ids:
            fail_operation(operation, str(exc), layer="input")
            set_task_state(
                production_task.production_task_id,
                state="failed",
                stage_id="submit_production",
                stage_label="生产任务提交失败",
                next_actor="user",
                action_type="view_error",
                action_label="查看原因",
            )
            raise HTTPException(status_code=400, detail=str(exc)) from None
        _persist_partial_production(
            item=item,
            operation=operation,
            template_id=template.id,
            batch_id=batch_id,
            batch_items=batch_items,
            request=request,
            identity=identity,
            error=str(exc),
        )
        raise HTTPException(
            status_code=502,
            detail="部分生产任务已提交并保留；其余任务提交失败，请查看操作记录。",
        ) from None
    except Exception as exc:  # noqa: BLE001 - checkpoint partial external work first
        if operation.task_ids:
            _persist_partial_production(
                item=item,
                operation=operation,
                template_id=template.id,
                batch_id=batch_id,
                batch_items=batch_items,
                request=request,
                identity=identity,
                error=str(exc),
            )
        else:
            fail_operation(operation, str(exc))
            set_task_state(
                production_task.production_task_id,
                state="failed",
                stage_id="submit_production",
                stage_label="生产任务提交失败",
                next_actor="user",
                action_type="view_error",
                action_label="查看原因",
            )
        raise HTTPException(
            status_code=502,
            detail="生产任务提交失败，请查看本机 API 日志和操作记录。",
        ) from None

    _save_batch(
        {
            "batch_id": batch_id,
            "template_id": template.id,
            "status": "submitted",
            "created_at": now_iso(),
            "updated_at": now_iso(),
            "metadata": {"content_item_id": item.item_id, **_trace(request)},
            "items": batch_items,
            "total_count": len(batch_items),
            "submitted_count": len(batch_items),
            "failed_count": 0,
        }
    )
    _link_item_production(
        item=item,
        operation=operation,
        batch_id=batch_id,
        request=request,
        identity=identity,
    )
    operation.phase = "linked"
    save_operation(operation)
    result = {"item_id": item.item_id, "batch_id": batch_id, "task_ids": operation.task_ids}
    complete_operation(operation, result)
    return {"operation_id": operation.operation_id, **result}


@router.post("/{item_id}/mark-published", response_model=ContentItem)
async def mark_published(item_id: str, request: MarkPublishedRequest, identity: IdentityDep):
    item = _item_or_404(item_id)
    operation, created = _begin(
        request,
        operation="mark_published",
        item=item,
        payload={"item_id": item_id, **request.model_dump(mode="json")},
    )
    if not created:
        return _item_or_404(item_id)
    if item.status not in {"produced", "scheduled", "published", "measured"}:
        fail_operation(operation, "只有已生产内容可以标记发布。", layer="input")
        raise HTTPException(status_code=400, detail="只有已生产内容可以标记发布。")
    evidence = next(
        (
            (kind, value.strip())
            for kind, value in (
                ("url", request.publish_url),
                ("platform_post_id", request.platform_post_id),
                ("buffer_id", request.buffer_id),
                ("manual", request.manual_evidence),
            )
            if value and value.strip()
        ),
        None,
    )
    if not evidence:
        fail_operation(operation, "至少需要一项发布证据。", layer="input")
        raise HTTPException(
            status_code=400, detail="至少需要 URL、平台 ID、Buffer ID 或人工备注之一。"
        )
    if request.production_task_id:
        production_task = load_production_task(request.production_task_id)
        if production_task is None or production_task.content_item_id != item.item_id:
            fail_operation(operation, "生产任务不属于这条内容。", layer="input")
            raise HTTPException(status_code=400, detail="生产任务不属于这条内容。")
        if production_task.state != "produced":
            fail_operation(operation, "只能登记已产出任务的发布记录。", layer="input")
            raise HTTPException(status_code=400, detail="只能登记已产出任务的发布记录。")
    publication = Publication(
        publication_id=uuid.uuid4().hex,
        production_task_id=request.production_task_id,
        platform=request.platform.strip(),
        published_at=request.published_at,
        evidence_type=evidence[0],
        evidence_value=evidence[1],
        actor=identity.actor,
        request_id=request.request_id,
    )
    previous = item.status
    if item.status in {"produced", "scheduled"}:
        item.status = "published"
    item.publications.append(publication)
    item.updated_at = now_iso()
    item.add_event(
        "published",
        identity.actor,
        {
            "from": previous,
            "to": item.status,
            "publication_id": publication.publication_id,
            "production_task_id": request.production_task_id,
            **_trace(request),
        },
    )
    save_item(item)
    complete_operation(operation, {"publication_id": publication.publication_id})
    return item


@router.post("/{item_id}/metrics", response_model=ContentItem)
async def record_metrics(item_id: str, request: MetricsRequest, identity: IdentityDep):
    item = _item_or_404(item_id)
    operation, created = _begin(
        request,
        operation="metrics",
        item=item,
        payload={"item_id": item_id, **request.model_dump(mode="json")},
    )
    if not created:
        return _item_or_404(item_id)
    if request.production_task_id:
        production_task = load_production_task(request.production_task_id)
        if production_task is None or production_task.content_item_id != item.item_id:
            fail_operation(operation, "生产任务不属于这条内容。", layer="input")
            raise HTTPException(status_code=400, detail="生产任务不属于这条内容。")
        if not request.mock and production_task.state != "produced":
            fail_operation(operation, "只能把正式指标关联到已产出任务。", layer="input")
            raise HTTPException(
                status_code=400,
                detail="只能把正式指标关联到已产出任务。",
            )
    values = {
        key: value
        for key, value in {
            "likes": request.likes,
            "favorites": request.favorites,
            "comments": request.comments,
            "note": request.note,
            "publication_id": request.publication_id,
            "recorded_at": now_iso(),
        }.items()
        if value is not None
    }
    if request.mock:
        if not request.mock_label:
            fail_operation(operation, "mock 指标必须带 mock_label。", layer="input")
            raise HTTPException(status_code=400, detail="mock 指标必须带 mock_label。")
        item.automation.setdefault("mock_metrics", []).append(
            {**values, "mock_label": request.mock_label, **_trace(request)}
        )
    else:
        if item.status not in {"published", "measured"}:
            fail_operation(operation, "正式指标只能写入已发布内容。", layer="input")
            raise HTTPException(status_code=400, detail="正式指标只能写入已发布内容。")
        if len(item.publications) > 1 and not request.publication_id:
            fail_operation(operation, "多平台内容必须指定 publication_id。", layer="input")
            raise HTTPException(status_code=400, detail="多平台内容必须指定 publication_id。")
        if request.publication_id and request.publication_id not in {
            publication.publication_id for publication in item.publications
        }:
            fail_operation(operation, "publication_id 不属于这条内容。", layer="input")
            raise HTTPException(status_code=400, detail="publication_id 不属于这条内容。")
        selected_publication_id = request.publication_id or (
            item.publications[0].publication_id if item.publications else None
        )
        selected_publication = next(
            (
                publication
                for publication in item.publications
                if publication.publication_id == selected_publication_id
            ),
            None,
        )
        if (
            selected_publication
            and selected_publication.production_task_id
            and request.production_task_id
            and selected_publication.production_task_id != request.production_task_id
        ):
            fail_operation(operation, "发布记录不属于指定的生产任务。", layer="input")
            raise HTTPException(
                status_code=400,
                detail="发布记录不属于指定的生产任务。",
            )
        item.metrics = {**item.metrics, **values}
        item.status = "measured"
    item.updated_at = now_iso()
    publication_task_id = next(
        (
            publication.production_task_id
            for publication in item.publications
            if publication.publication_id == request.publication_id
        ),
        None,
    )
    item.add_event(
        "metrics_recorded" if not request.mock else "note",
        identity.actor,
        {
            "mock": request.mock,
            "production_task_id": request.production_task_id or publication_task_id,
            **_trace(request),
        },
    )
    save_item(item)
    complete_operation(operation, {"item_id": item.item_id, "status": item.status})
    return item


def _save_batch(batch: dict[str, Any]) -> None:
    directory = Path(get_data_path("generation-batches"))
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{batch['batch_id']}.json"
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(batch, ensure_ascii=False, indent=2) + "\n", "utf-8")
    os.replace(temporary, path)


def _link_item_production(
    *,
    item: ContentItem,
    operation: ContentFlowOperation,
    batch_id: str,
    request: ProduceRequest,
    identity: RequestIdentity,
) -> None:
    prior_status = item.status
    item.status = "producing"
    item.links["task_ids"] = list(
        dict.fromkeys([*(item.links.get("task_ids") or []), *operation.task_ids])
    )
    item.links["batch_ids"] = list(dict.fromkeys([*(item.links.get("batch_ids") or []), batch_id]))
    item.automation["production_prior_status"] = prior_status
    item.automation.pop("production_failure", None)
    item.updated_at = now_iso()
    item.add_event(
        "status_changed",
        identity.actor,
        {
            "from": prior_status,
            "to": "producing",
            "task_ids": operation.task_ids,
            **_trace(request),
        },
    )
    save_item(item)


def _persist_partial_production(
    *,
    item: ContentItem,
    operation: ContentFlowOperation,
    template_id: str,
    batch_id: str,
    batch_items: list[dict[str, Any]],
    request: ProduceRequest,
    identity: RequestIdentity,
    error: str,
) -> None:
    _save_batch(
        {
            "batch_id": batch_id,
            "template_id": template_id,
            "status": "partially_submitted",
            "created_at": operation.created_at,
            "updated_at": now_iso(),
            "metadata": {"content_item_id": item.item_id, **_trace(request)},
            "items": batch_items,
            "total_count": len(batch_items),
            "submitted_count": len(batch_items),
            "failed_count": 1,
            "error": {"message": error},
        }
    )
    _link_item_production(
        item=item,
        operation=operation,
        batch_id=batch_id,
        request=request,
        identity=identity,
    )
    item.automation["production_submission_incomplete"] = {
        "message": error,
        "task_ids": list(operation.task_ids),
    }
    save_item(item)
    operation.phase = "linked"
    fail_operation(operation, error)
