"""ContentItem API：内容工作台看板的后端。

内容条目是一等公民实体（选题→草稿→确认→生产→发布→数据）。生产/发布动作由前端编排
调用现有 API，再通过这些端点回写条目状态；后端不做事件驱动重构。
"""

import json
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from loguru import logger
from pydantic import BaseModel, Field

from api.dependencies import PixelleVideoDep
from pixelle_video.content.models import (
    STATUSES,
    ContentItem,
    ContentVariant,
    is_valid_transition,
    new_content_item,
    now_iso,
)
from pixelle_video.content.projects import ensure_migrated, get_default_project
from pixelle_video.content.store import (
    delete_item,
    list_items,
    load_item,
    save_item,
)
from pixelle_video.generation.task_store import load_generation_task
from pixelle_video.utils.os_util import get_data_path

router = APIRouter(prefix="/content-items", tags=["Content Items"])


def _default_project_id() -> str:
    """当前默认项目 id（触发迁移）；无项目时回退到 'PetWoods' 兜底。"""
    ensure_migrated()
    project = get_default_project()
    return project.project_id if project else "PetWoods"


# 可被测试覆盖的存量草稿目录（None 时回落到 data/script-review-drafts/）。
SCRIPT_REVIEW_DIR: Path | None = None


def _script_review_dir() -> Path:
    if SCRIPT_REVIEW_DIR is not None:
        return Path(SCRIPT_REVIEW_DIR)
    return Path(get_data_path("script-review-drafts"))


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
    # 可选项目归属；缺省用默认项目
    project_id: str | None = None


class ContentItemPatchRequest(BaseModel):
    title: str | None = None
    languages: list[str] | None = None
    variants: dict[str, dict] | None = None
    asset_paths: list[str] | None = None
    metrics: dict | None = None
    links: dict | None = None


class ContentItemTransitionRequest(BaseModel):
    to: str
    actor: str = "user"
    detail: dict = Field(default_factory=dict)


class ImportExistingResponse(BaseModel):
    created: int
    skipped: int


# ---------------------------------------------------------------------------
# CRUD endpoints
# ---------------------------------------------------------------------------


@router.get("", response_model=list[ContentItem])
async def list_content_items(
    status: str | None = Query(default=None),
    project: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
):
    # 触发一次幂等迁移（存量条目归拢到默认项目）；无 project 参数返回全部。
    ensure_migrated()
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


@router.patch("/{item_id}", response_model=ContentItem)
async def patch_content_item(item_id: str, request: ContentItemPatchRequest):
    item = load_item(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail=f"未找到内容条目：{item_id}")

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
    if request.variants is not None:
        for language, patch in request.variants.items():
            existing = item.variants.get(language)
            base: dict[str, Any] = existing.model_dump() if existing else {}
            base.update(patch)
            base["language"] = language
            item.variants[language] = ContentVariant(**base)
        changed.append("variants")
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
        _apply_reconciled_transition(
            item,
            "produced",
            "produced",
            {"task_ids": [task.task_id for task in current_tasks]},
        )
        item.automation.pop("production_failure", None)
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
        _apply_reconciled_transition(
            item,
            "confirmed",
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


# ---------------------------------------------------------------------------
# Import existing data (幂等)
# ---------------------------------------------------------------------------


def _import_from_draft_sets(
    existing: list[ContentItem], default_project: str
) -> tuple[list[ContentItem], int]:
    """为存量 script-review 草稿集建卡。幂等：用 (draft_set_id, draft_index) 去重。"""
    linked_keys: set[tuple[str, int]] = set()
    for item in existing:
        draft_set_id = item.links.get("draft_set_id")
        if draft_set_id:
            linked_keys.add((draft_set_id, int(item.links.get("draft_index", -1))))

    created: list[ContentItem] = []
    skipped = 0
    directory = _script_review_dir()
    if not directory.exists():
        return created, skipped

    for path in sorted(directory.glob("*.json")):
        try:
            with open(path, encoding="utf-8") as handle:
                draft_set = json.load(handle)
        except (OSError, json.JSONDecodeError):
            continue
        draft_set_id = draft_set.get("draft_set_id") or path.stem
        drafts = draft_set.get("drafts") or []
        submissions = draft_set.get("submissions") or []
        has_submissions = len(submissions) > 0
        batch_ids = [s.get("batch_id") for s in submissions if s.get("batch_id")]
        set_languages = draft_set.get("languages") or ["Chinese"]

        for draft in drafts:
            index = int(draft.get("index", 0))
            key = (draft_set_id, index)
            if key in linked_keys:
                skipped += 1
                continue

            status = "produced" if has_submissions else "pending_review"
            variant_status = "confirmed" if has_submissions else "pending"
            language_drafts = draft.get("language_drafts") or {}
            variants: dict[str, ContentVariant] = {}
            for language, payload in language_drafts.items():
                variants[language] = ContentVariant(
                    language=language,
                    status=variant_status,
                    title=(payload or {}).get("title", ""),
                    script=(payload or {}).get("script", ""),
                    narrations=list((payload or {}).get("narrations", []) or []),
                )
            languages = (
                draft.get("selected_languages") or list(language_drafts.keys()) or set_languages
            )
            title = draft.get("title") or draft.get("topic") or "未命名选题"

            item = new_content_item(
                title=title,
                kind="text",
                source="agent",
                status=status,
                languages=list(languages),
                variants=variants,
                links={
                    "draft_set_id": draft_set_id,
                    "draft_index": index,
                    "task_ids": [],
                    "batch_ids": batch_ids,
                    "publish_record_ids": [],
                },
                actor="system",
                project=default_project,
            )
            save_item(item)
            created.append(item)
            linked_keys.add(key)

    return created, skipped


async def _import_from_history(
    pixelle_video: Any, existing: list[ContentItem], default_project: str
) -> tuple[list[ContentItem], int]:
    """为无草稿关联、标题不重复的已完成历史任务建卡。幂等：用 task_id / 标题 去重。"""
    history = getattr(pixelle_video, "history", None)
    if history is None:
        return [], 0

    linked_task_ids: set[str] = set()
    existing_titles: set[str] = set()
    for item in existing:
        existing_titles.add(item.title.strip())
        for task_id in item.links.get("task_ids", []) or []:
            linked_task_ids.add(task_id)

    try:
        listing = await history.get_task_list(page=1, page_size=1000, status="completed")
    except Exception as error:  # noqa: BLE001 - 存量导入不应因历史读失败而中断
        logger.warning(f"导入历史任务失败：{error}")
        return [], 0

    publish = getattr(pixelle_video, "publish", None)
    created: list[ContentItem] = []
    skipped = 0
    for task in listing.get("tasks", []):
        task_id = task.get("task_id")
        if not task_id or task_id in linked_task_ids:
            skipped += 1
            continue
        title = (task.get("title") or "").strip() or "未命名作品"
        if title in existing_titles:
            skipped += 1
            continue

        published = False
        if publish is not None:
            try:
                record = await publish.load_publish_record(task_id)
                published = bool(record)
            except Exception:  # noqa: BLE001
                published = False

        status = "published" if published else "produced"
        item = new_content_item(
            title=title,
            kind="text",
            source="manual",
            status=status,
            links={
                "draft_set_id": None,
                "task_ids": [task_id],
                "batch_ids": [],
                "publish_record_ids": [task_id] if published else [],
            },
            actor="system",
            project=default_project,
        )
        save_item(item)
        created.append(item)
        linked_task_ids.add(task_id)
        existing_titles.add(title)

    return created, skipped


@router.post("/import-existing", response_model=ImportExistingResponse)
async def import_existing_content_items(pixelle_video: PixelleVideoDep):
    default_project = _default_project_id()
    existing = list_items(limit=100000)
    draft_created, draft_skipped = _import_from_draft_sets(existing, default_project)

    # 历史导入需感知刚由草稿建出的条目（标题去重），合并后再算。
    existing_after = existing + draft_created
    task_created, task_skipped = await _import_from_history(
        pixelle_video, existing_after, default_project
    )

    return ImportExistingResponse(
        created=len(draft_created) + len(task_created),
        skipped=draft_skipped + task_skipped,
    )
