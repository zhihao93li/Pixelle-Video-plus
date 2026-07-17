"""ContentItem API：内容工作台看板的后端。

内容条目是一等公民实体（选题→草稿→确认→生产→发布→数据）。生产/发布动作由前端编排
调用现有 API，再通过这些端点回写条目状态；后端不做事件驱动重构。
"""

from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from pixelle_video.content.models import (
    STATUSES,
    ContentItem,
    ContentVariant,
    SceneManifest,
    is_valid_transition,
    new_content_item,
    now_iso,
)
from pixelle_video.content.projects import ensure_default_project, get_default_project
from pixelle_video.content.reviews import PendingReviewResponse, build_pending_review
from pixelle_video.content.stage_revisions import (
    StageConfirmation,
    StageRevision,
    list_confirmations,
    list_revisions,
)
from pixelle_video.content.store import (
    delete_item,
    list_items,
    load_item,
    save_item,
)
from pixelle_video.generation.task_store import load_generation_task

router = APIRouter(prefix="/content-items", tags=["Content Items"])


def _default_project_id() -> str:
    """Return the internal fallback content-space id for a new installation."""
    ensure_default_project()
    project = get_default_project()
    return project.project_id if project else "PetWoods"


# ---------------------------------------------------------------------------
# Request/response models
# ---------------------------------------------------------------------------


class ContentItemCreateRequest(BaseModel):
    titles: list[str] = Field(..., min_length=1)
    kind: Literal["text", "asset"] = "text"
    languages: list[str] | None = None
    source: Literal["manual", "agent", "derived"] = "manual"
    initial_status: Literal["idea", "confirmed"] = "idea"
    # 可选：与 titles 等长的主语言确认稿（现成文案场景，initial_status=confirmed 时写入变体）
    scripts: list[str] | None = None
    asset_paths: list[str] | None = None
    # 可选内容空间归属；缺省使用内部初始空间。
    project_id: str | None = None


class ContentItemPatchRequest(BaseModel):
    title: str | None = None
    languages: list[str] | None = None
    variants: dict[str, dict] | None = None
    asset_paths: list[str] | None = None
    metrics: dict | None = None
    links: dict | None = None
    scene_manifest: SceneManifest | None = None
    content_version: str | None = None


class ContentItemTransitionRequest(BaseModel):
    to: str
    actor: str = "user"
    detail: dict = Field(default_factory=dict)


class ContentRevisionHistoryResponse(BaseModel):
    revisions: list[StageRevision]
    confirmations: list[StageConfirmation]


# ---------------------------------------------------------------------------
# CRUD endpoints
# ---------------------------------------------------------------------------


@router.get("", response_model=list[ContentItem])
async def list_content_items(
    status: str | None = Query(default=None),
    project: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
):
    # A new installation always has one project; no project filter returns all items.
    ensure_default_project()
    items = list_items(limit=1000, project=project)
    reconciled = [_reconcile_production_state(item) for item in items]
    if status:
        wanted = {part.strip() for part in status.split(",") if part.strip()}
        reconciled = [item for item in reconciled if item.status in wanted]
    return reconciled[:limit]


@router.post("", response_model=list[ContentItem])
async def create_content_items(request: ContentItemCreateRequest):
    titles = [title.strip() for title in request.titles if title.strip()]
    if not titles:
        raise HTTPException(status_code=400, detail="至少需要一个标题。")

    languages = request.languages or ["Chinese"]
    main_language = languages[0]
    scripts = request.scripts or []
    project_id = request.project_id or _default_project_id()

    created: list[ContentItem] = []
    for index, title in enumerate(titles):
        variants: dict[str, ContentVariant] = {}
        script = scripts[index].strip() if index < len(scripts) else ""
        if request.initial_status == "confirmed" and script and request.kind == "text":
            variants[main_language] = ContentVariant(
                language=main_language,
                status="confirmed",
                title=title,
                script=script,
            )
        item = new_content_item(
            title=title,
            kind=request.kind,
            source=request.source,
            status=request.initial_status,
            languages=list(languages),
            variants=variants,
            asset_paths=request.asset_paths,
            project=project_id,
        )
        save_item(item)
        created.append(item)
    return created


@router.get("/{item_id}", response_model=ContentItem)
async def get_content_item(item_id: str):
    item = load_item(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail=f"未找到内容条目：{item_id}")
    return _reconcile_production_state(item)


@router.get("/{item_id}/pending-review", response_model=PendingReviewResponse)
async def get_pending_review(item_id: str):
    """Return the one exact, versioned object currently waiting for approval."""

    item = load_item(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail=f"未找到内容条目：{item_id}")
    item = _reconcile_production_state(item)
    return PendingReviewResponse(item=item, review=build_pending_review(item))


@router.get("/{item_id}/revisions", response_model=ContentRevisionHistoryResponse)
async def get_content_revision_history(item_id: str):
    """Return immutable stage versions and their independent approval evidence."""

    if load_item(item_id) is None:
        raise HTTPException(status_code=404, detail=f"未找到内容条目：{item_id}")
    revisions = list_revisions(item_id=item_id)
    revision_ids = {revision.revision_id for revision in revisions}
    confirmations = [
        confirmation
        for confirmation in list_confirmations()
        if confirmation.revision_id in revision_ids
    ]
    return ContentRevisionHistoryResponse(
        revisions=revisions,
        confirmations=confirmations,
    )


@router.patch("/{item_id}", response_model=ContentItem)
async def patch_content_item(item_id: str, request: ContentItemPatchRequest):
    item = load_item(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail=f"未找到内容条目：{item_id}")
    if request.variants is not None or request.scene_manifest is not None:
        raise HTTPException(
            status_code=409,
            detail="文案和分镜必须通过当前确认站修改，以便生成新的可追溯版本。",
        )

    changed: list[str] = []
    if request.title is not None:
        item.title = request.title
        changed.append("title")
    if request.languages is not None:
        item.languages = request.languages
        changed.append("languages")
    if request.asset_paths is not None:
        item.asset_paths = request.asset_paths
        changed.append("asset_paths")
    if request.metrics is not None:
        item.metrics = {**item.metrics, **request.metrics}
        changed.append("metrics")
    if request.links is not None:
        item.links = {**item.links, **request.links}
        changed.append("links")

    if changed:
        event_type = "metrics_recorded" if changed == ["metrics"] else "note"
        item.add_event(event_type, "user", {"changed": changed})
        item.updated_at = now_iso()
        save_item(item)
    return item


@router.post("/{item_id}/transition", response_model=ContentItem)
async def transition_content_item(item_id: str, request: ContentItemTransitionRequest):
    item = load_item(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail=f"未找到内容条目：{item_id}")

    if request.to not in STATUSES:
        raise HTTPException(status_code=400, detail=f"未知状态：{request.to}")
    if not is_valid_transition(item.status, request.to):
        raise HTTPException(
            status_code=400,
            detail=f"不允许的状态迁移：{item.status} → {request.to}",
        )

    previous = item.status
    item.status = request.to
    if request.to == "producing":
        item.automation.pop("production_failure", None)
    item.updated_at = now_iso()
    detail = {"from": previous, "to": request.to}
    if request.detail:
        detail.update(request.detail)
    item.add_event("status_changed", request.actor, detail)
    save_item(item)
    return item


def _reconcile_production_state(item: ContentItem) -> ContentItem:
    """Resolve a producing item from canonical persisted generation tasks."""
    if item.status != "producing":
        return item

    task_ids = [str(task_id) for task_id in item.links.get("task_ids", []) if task_id]
    if not task_ids:
        return item

    tasks = [load_generation_task(task_id) for task_id in task_ids]
    known_tasks = [task for task in tasks if task is not None]
    if not known_tasks:
        return item

    latest_batch_id = next(
        (str(batch_id) for batch_id in reversed(item.links.get("batch_ids", [])) if batch_id),
        None,
    )
    current_tasks = (
        [task for task in known_tasks if task.request.metadata.get("batch_id") == latest_batch_id]
        if latest_batch_id
        else known_tasks
    )
    if not current_tasks:
        return item

    statuses = {task.status for task in current_tasks}
    if statuses == {"completed"}:
        incomplete = item.automation.pop("production_submission_incomplete", None)
        if incomplete:
            item.automation["production_failure"] = incomplete
            prior_status = item.automation.pop("production_prior_status", "confirmed")
            failure_status = (
                prior_status if prior_status in {"confirmed", "produced"} else "confirmed"
            )
            _apply_reconciled_transition(
                item,
                failure_status,
                "production_failed",
                {"message": incomplete.get("message", "部分任务未能提交。")},
            )
            save_item(item)
            return item
        _apply_reconciled_transition(
            item,
            "produced",
            "produced",
            {"task_ids": [task.task_id for task in current_tasks]},
        )
        item.automation.pop("production_failure", None)
        item.automation.pop("production_prior_status", None)
        save_item(item)
    elif statuses.issubset({"completed", "failed", "cancelled", "interrupted"}) and any(
        status in {"failed", "cancelled", "interrupted"} for status in statuses
    ):
        failed_tasks = [task for task in current_tasks if task.status in {"failed", "interrupted"}]
        message = next(
            (task.error.message for task in failed_tasks if task.error),
            "生产任务未完成，可检查设置后重试。",
        )
        item.automation["production_failure"] = {
            "message": message,
            "task_ids": [task.task_id for task in current_tasks],
        }
        prior_status = item.automation.pop("production_prior_status", "confirmed")
        failure_status = prior_status if prior_status in {"confirmed", "produced"} else "confirmed"
        _apply_reconciled_transition(
            item,
            failure_status,
            "production_failed",
            {"message": message},
        )
        save_item(item)

    return item


def _apply_reconciled_transition(
    item: ContentItem,
    target: str,
    event_type: str,
    detail: dict,
) -> None:
    previous = item.status
    item.status = target
    item.updated_at = now_iso()
    item.add_event(
        event_type,
        "system",
        {"from": previous, "to": target, **detail},
    )


@router.delete("/{item_id}")
async def delete_content_item(item_id: str):
    if not delete_item(item_id):
        raise HTTPException(status_code=404, detail=f"未找到内容条目：{item_id}")
    return {"deleted": True, "item_id": item_id}
