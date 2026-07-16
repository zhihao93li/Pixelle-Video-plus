"""Canonical, user-visible timeline for one stable production task.

The timeline is assembled from immutable review revisions and confirmations,
durable generation attempts, and task timestamps.  It never infers events from
the current UI state, so clients can render one trustworthy task detail page.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from pixelle_video.content.models import ContentItem
from pixelle_video.content.production_tasks import ProductionAttempt, ProductionTask
from pixelle_video.content.stage_revisions import list_confirmations, list_revisions

TimelineCategory = Literal["output", "activity"]


class ProductionTimelineEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: str
    event_type: str
    category: TimelineCategory
    title: str
    occurred_at: str
    actor: Literal["user", "system", "agent"]
    stage: str | None = None
    revision_id: str | None = None
    generation_task_id: str | None = None
    detail: dict[str, Any] = Field(default_factory=dict)


class ProductionTimelinePage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[ProductionTimelineEntry]
    next_cursor: str | None = None


def _timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _revision_labels(kind: str, sequence: int) -> tuple[str, str]:
    if kind == "script":
        return ("script_generated", "文案已生成" if sequence == 1 else "文案已更新")
    if kind == "image_pages":
        return ("pages_generated", "分页已生成" if sequence == 1 else "分页已更新")
    return ("scenes_generated", "分镜已生成" if sequence == 1 else "分镜已更新")


def _confirmation_label(kind: str) -> str:
    if kind == "script":
        return "文案已确认"
    if kind == "image_pages":
        return "分页已确认"
    return "分镜已确认"


def build_production_timeline(
    task: ProductionTask,
    item: ContentItem | None,
) -> list[ProductionTimelineEntry]:
    entries: list[ProductionTimelineEntry] = [
        ProductionTimelineEntry(
            event_id=f"task-created:{task.production_task_id}",
            event_type="task_created",
            category="activity",
            title="任务已创建",
            occurred_at=task.created_at,
            actor=task.actor,
            stage="created",
            detail={"title": task.title, "input": task.input_snapshot},
        )
    ]

    revisions = list_revisions(production_task_id=task.production_task_id)
    revision_ids = {revision.revision_id for revision in revisions}
    for revision in revisions:
        event_type, title = _revision_labels(revision.kind, revision.sequence)
        entries.append(
            ProductionTimelineEntry(
                event_id=f"revision:{revision.revision_id}",
                event_type=event_type,
                category="output",
                title=title,
                occurred_at=revision.created_at,
                actor=revision.created_by,
                stage=revision.kind,
                revision_id=revision.revision_id,
                detail={
                    "kind": revision.kind,
                    "sequence": revision.sequence,
                    "payload": revision.payload.model_dump(mode="json"),
                },
            )
        )

    for confirmation in list_confirmations():
        if confirmation.production_task_id != task.production_task_id:
            continue
        if confirmation.revision_id not in revision_ids:
            continue
        entries.append(
            ProductionTimelineEntry(
                event_id=f"confirmation:{confirmation.confirmation_id}",
                event_type="stage_confirmed",
                category="activity",
                title=_confirmation_label(confirmation.kind),
                occurred_at=confirmation.confirmed_at,
                actor=confirmation.actor,
                stage=confirmation.kind,
                revision_id=confirmation.revision_id,
                detail={"confirmation_id": confirmation.confirmation_id},
            )
        )

    runs: dict[str, list[ProductionAttempt]] = {}
    for attempt in task.attempts:
        run_id = attempt.run_id or attempt.generation_task_id
        runs.setdefault(run_id, []).append(attempt)
    ordered_runs = sorted(
        runs.items(),
        key=lambda pair: min(_timestamp(attempt.created_at) for attempt in pair[1]),
    )
    for run_index, (run_id, attempts) in enumerate(ordered_runs):
        started_at = min(attempts, key=lambda attempt: _timestamp(attempt.created_at)).created_at
        entries.append(
            ProductionTimelineEntry(
                event_id=f"run-started:{run_id}",
                event_type="production_started" if run_index == 0 else "retry_started",
                category="activity",
                title="开始生产" if run_index == 0 else "重新尝试生成",
                occurred_at=started_at,
                actor="system",
                stage=attempts[0].stage or task.stage_id,
                detail={"run_id": run_id},
            )
        )
        for attempt in attempts:
            failed = attempt.status in {"failed", "interrupted"} or (
                attempt.status == "completed" and attempt.required_artifacts_ok is False
            )
            if failed:
                entries.append(
                    ProductionTimelineEntry(
                        event_id=f"attempt-failed:{attempt.generation_task_id}",
                        event_type="production_failed",
                        category="activity",
                        title="生产失败",
                        occurred_at=attempt.updated_at,
                        actor="system",
                        stage=attempt.stage or task.stage_id,
                        generation_task_id=attempt.generation_task_id,
                        detail={
                            "message": attempt.error.message if attempt.error else "生产未能完成。",
                            "layer": attempt.error.layer if attempt.error else None,
                        },
                    )
                )
            elif attempt.status == "completed" and attempt.required_artifacts_ok is not False:
                entries.append(
                    ProductionTimelineEntry(
                        event_id=f"artifact-produced:{attempt.generation_task_id}",
                        event_type="artifact_produced",
                        category="output",
                        title="产物已生成",
                        occurred_at=attempt.updated_at,
                        actor="system",
                        stage=attempt.stage or task.stage_id,
                        generation_task_id=attempt.generation_task_id,
                        detail={"artifact_ids": attempt.artifact_ids},
                    )
                )

    if task.cancelled_at:
        entries.append(
            ProductionTimelineEntry(
                event_id=f"task-cancelled:{task.production_task_id}",
                event_type="task_cancelled",
                category="activity",
                title="任务已取消",
                occurred_at=task.cancelled_at,
                actor="user",
                stage="cancelled",
            )
        )

    if item is not None:
        for index, event in enumerate(item.events):
            production_task_id = str(event.detail.get("production_task_id") or "")
            if production_task_id != task.production_task_id:
                continue
            if event.type not in {"published", "metrics_recorded"}:
                continue
            entries.append(
                ProductionTimelineEntry(
                    event_id=f"content-event:{index}:{event.at}",
                    event_type=event.type,
                    category="activity",
                    title="已发布" if event.type == "published" else "数据已记录",
                    occurred_at=event.at,
                    actor=event.actor if event.actor in {"user", "agent", "system"} else "system",
                    stage=event.type,
                    detail=event.detail,
                )
            )

    entries.sort(
        key=lambda entry: (_timestamp(entry.occurred_at), entry.event_id),
        reverse=True,
    )
    return entries


def paginate_timeline(
    entries: list[ProductionTimelineEntry],
    *,
    cursor: str | None,
    limit: int,
) -> ProductionTimelinePage:
    start = 0
    if cursor:
        try:
            start = next(
                index + 1 for index, entry in enumerate(entries) if entry.event_id == cursor
            )
        except StopIteration as exc:
            raise ValueError("timeline cursor is no longer available") from exc
    page = entries[start : start + limit]
    next_cursor = page[-1].event_id if start + limit < len(entries) and page else None
    return ProductionTimelinePage(items=page, next_cursor=next_cursor)
