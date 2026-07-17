"""Durable user-visible production tasks for the unified workbench.

A production task exists from the moment a route is submitted. Provider jobs
and generation-engine tasks are execution attempts linked to this stable task;
they are not separate workbench cards.
"""

from __future__ import annotations

import json
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from pixelle_video.generation.schemas import GenerationError, GenerationTask, PipelineManifest
from pixelle_video.utils.os_util import get_data_path

PRODUCTION_TASKS_DIR: Path | None = None

ProductionTaskState = Literal[
    "needs_user",
    "in_progress",
    "failed",
    "produced",
    "cancelled",
]
ProductionActor = Literal["user", "system", "agent"]

_lock = threading.RLock()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ProductionAttempt(BaseModel):
    model_config = ConfigDict(extra="forbid")

    generation_task_id: str
    run_id: str = ""
    status: str
    stage: str = ""
    error: GenerationError | None = None
    required_artifacts_ok: bool | None = None
    artifact_ids: list[str] = Field(default_factory=list)
    provider_job_ids: list[str] = Field(default_factory=list)
    created_at: str
    updated_at: str


class ProductionTask(BaseModel):
    model_config = ConfigDict(extra="forbid")

    production_task_id: str
    content_item_id: str
    project_id: str
    pipeline_id: str
    recipe_id: str
    recipe_version: str = ""
    title: str
    artifact_type: Literal["video", "image_set", "text", "audio"]
    source: Literal["react", "agent", "batch"]
    actor: ProductionActor = "user"
    client_name: str | None = None
    agent_session_id: str | None = None
    batch_id: str | None = None
    state: ProductionTaskState
    stage_id: str
    stage_label: str
    next_actor: ProductionActor
    progress_current: int | None = None
    progress_total: int | None = None
    progress_percentage: float | None = None
    action_type: str | None = None
    action_label: str | None = None
    input_snapshot: dict[str, Any] = Field(default_factory=dict)
    confirmed_version_refs: dict[str, str] = Field(default_factory=dict)
    effective_params: dict[str, Any] = Field(default_factory=dict)
    request_id: str
    request_hash: str
    generation_task_ids: list[str] = Field(default_factory=list)
    operation_ids: list[str] = Field(default_factory=list)
    artifact_ids: list[str] = Field(default_factory=list)
    provider_job_ids: list[str] = Field(default_factory=list)
    attempts: list[ProductionAttempt] = Field(default_factory=list)
    error: GenerationError | None = None
    created_at: str
    updated_at: str
    state_since: str
    waiting_since: str | None = None
    failed_at: str | None = None
    produced_at: str | None = None
    cancelled_at: str | None = None
    cancellation_request_id: str | None = None
    archived_at: str | None = None
    archived_by: ProductionActor | None = None


class ProductionTaskConflict(ValueError):
    pass


def task_directory(directory: Path | None = None) -> Path:
    target = directory or PRODUCTION_TASKS_DIR
    if target is None:
        target = Path(get_data_path("production-tasks"))
    target = Path(target)
    target.mkdir(parents=True, exist_ok=True)
    return target


def _task_path(task_id: str, directory: Path | None = None) -> Path:
    return task_directory(directory) / f"{task_id}.json"


def save_production_task(task: ProductionTask, directory: Path | None = None) -> ProductionTask:
    with _lock:
        path = _task_path(task.production_task_id, directory)
        temporary = path.with_suffix(".json.tmp")
        temporary.write_text(
            json.dumps(task.model_dump(mode="json"), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        os.replace(temporary, path)
    return task


def load_production_task(task_id: str, directory: Path | None = None) -> ProductionTask | None:
    path = _task_path(task_id, directory)
    if not path.exists():
        return None
    try:
        return ProductionTask.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def list_production_tasks(directory: Path | None = None) -> list[ProductionTask]:
    tasks: list[ProductionTask] = []
    for path in task_directory(directory).glob("*.json"):
        try:
            tasks.append(ProductionTask.model_validate_json(path.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            continue
    tasks.sort(key=lambda task: task.created_at, reverse=True)
    return tasks


def find_task_by_request_id(
    request_id: str, directory: Path | None = None
) -> ProductionTask | None:
    return next(
        (task for task in list_production_tasks(directory) if task.request_id == request_id),
        None,
    )


def delete_production_task(task_id: str, directory: Path | None = None) -> bool:
    with _lock:
        path = _task_path(task_id, directory)
        if not path.exists():
            return False
        path.unlink()
        return True


def set_task_archived(
    task_id: str,
    *,
    archived: bool,
    actor: ProductionActor,
    directory: Path | None = None,
) -> ProductionTask:
    """Hide or restore one workbench card without changing its production state."""

    with _lock:
        task = load_production_task(task_id, directory)
        if task is None:
            raise KeyError(f"Unknown production task: {task_id}")
        if archived and task.state not in {"failed", "produced", "cancelled"}:
            raise ValueError("只能归档失败、已产出或已取消的任务。")
        if archived == (task.archived_at is not None):
            return task
        task.archived_at = now_iso() if archived else None
        task.archived_by = actor if archived else None
        task.updated_at = now_iso()
        return save_production_task(task, directory)


def create_production_task(
    *,
    content_item_id: str,
    project_id: str,
    pipeline_id: str,
    recipe_id: str,
    recipe_version: str,
    title: str,
    artifact_type: Literal["video", "image_set", "text", "audio"],
    source: Literal["react", "agent", "batch"],
    actor: ProductionActor,
    stage_id: str,
    stage_label: str,
    next_actor: ProductionActor,
    request_id: str,
    request_hash: str,
    input_snapshot: dict[str, Any] | None = None,
    effective_params: dict[str, Any] | None = None,
    state: ProductionTaskState = "in_progress",
    action_type: str | None = None,
    action_label: str | None = None,
    client_name: str | None = None,
    agent_session_id: str | None = None,
    batch_id: str | None = None,
    directory: Path | None = None,
) -> tuple[ProductionTask, bool]:
    """Create idempotently; same request id with different content is a conflict."""

    with _lock:
        for existing in list_production_tasks(directory):
            if existing.request_id != request_id:
                continue
            if existing.request_hash != request_hash:
                raise ProductionTaskConflict("request_id 已被另一份不同内容的生产请求使用。")
            return existing, False

        timestamp = now_iso()
        task = ProductionTask(
            production_task_id=uuid.uuid4().hex,
            content_item_id=content_item_id,
            project_id=project_id,
            pipeline_id=pipeline_id,
            recipe_id=recipe_id,
            recipe_version=recipe_version,
            title=title,
            artifact_type=artifact_type,
            source=source,
            actor=actor,
            client_name=client_name,
            agent_session_id=agent_session_id,
            batch_id=batch_id,
            state=state,
            stage_id=stage_id,
            stage_label=stage_label,
            next_actor=next_actor,
            action_type=action_type,
            action_label=action_label,
            input_snapshot=input_snapshot or {},
            effective_params=effective_params or {},
            request_id=request_id,
            request_hash=request_hash,
            created_at=timestamp,
            updated_at=timestamp,
            state_since=timestamp,
            waiting_since=timestamp if state == "needs_user" else None,
        )
        save_production_task(task, directory)
        return task, True


def latest_task_for_content(
    content_item_id: str,
    *,
    states: set[ProductionTaskState] | None = None,
    pipeline_id: str | None = None,
    directory: Path | None = None,
) -> ProductionTask | None:
    for task in list_production_tasks(directory):
        if task.content_item_id != content_item_id:
            continue
        if states is not None and task.state not in states:
            continue
        if pipeline_id is not None and task.pipeline_id != pipeline_id:
            continue
        return task
    return None


def set_task_state(
    task_id: str,
    *,
    state: ProductionTaskState,
    stage_id: str,
    stage_label: str,
    next_actor: ProductionActor,
    action_type: str | None = None,
    action_label: str | None = None,
    error: GenerationError | None = None,
    operation_id: str | None = None,
    directory: Path | None = None,
) -> ProductionTask:
    with _lock:
        task = load_production_task(task_id, directory)
        if task is None:
            raise KeyError(f"Unknown production task: {task_id}")
        timestamp = now_iso()
        if task.state != state:
            task.state_since = timestamp
        task.state = state
        task.stage_id = stage_id
        task.stage_label = stage_label
        task.next_actor = next_actor
        task.action_type = action_type
        task.action_label = action_label
        task.error = error
        # A stage transition invalidates progress reported by the previous
        # stage.  The generation-task synchronizer will populate real numbers
        # again when the new runtime can measure them; until then the UI shows
        # an honest indeterminate state instead of a stale percentage.
        task.progress_current = None
        task.progress_total = None
        task.progress_percentage = None
        task.updated_at = timestamp
        task.waiting_since = timestamp if state == "needs_user" else None
        task.failed_at = timestamp if state == "failed" else task.failed_at
        task.produced_at = timestamp if state == "produced" else task.produced_at
        task.cancelled_at = timestamp if state == "cancelled" else task.cancelled_at
        if operation_id and operation_id not in task.operation_ids:
            task.operation_ids.append(operation_id)
        return save_production_task(task, directory)


def record_task_confirmation(
    task_id: str,
    *,
    references: dict[str, str],
    directory: Path | None = None,
) -> ProductionTask:
    """Attach immutable confirmation references to the stable production task."""

    with _lock:
        task = load_production_task(task_id, directory)
        if task is None:
            raise KeyError(f"Unknown production task: {task_id}")
        task.confirmed_version_refs = {
            **task.confirmed_version_refs,
            **{key: value for key, value in references.items() if value},
        }
        task.updated_at = now_iso()
        return save_production_task(task, directory)


def attach_generation_task(
    production_task_id: str,
    generation_task: GenerationTask,
    *,
    effective_params: dict[str, Any] | None = None,
    directory: Path | None = None,
) -> ProductionTask:
    with _lock:
        task = load_production_task(production_task_id, directory)
        if task is None:
            raise KeyError(f"Unknown production task: {production_task_id}")
        if generation_task.task_id not in task.generation_task_ids:
            task.generation_task_ids.append(generation_task.task_id)
        if not any(
            attempt.generation_task_id == generation_task.task_id for attempt in task.attempts
        ):
            timestamp = now_iso()
            task.attempts.append(
                ProductionAttempt(
                    generation_task_id=generation_task.task_id,
                    run_id=str(
                        generation_task.request.metadata.get("production_run_id")
                        or generation_task.request.metadata.get("batch_id")
                        or generation_task.task_id
                    ),
                    status=generation_task.status,
                    stage=generation_task.progress.stage,
                    error=generation_task.error,
                    created_at=timestamp,
                    updated_at=timestamp,
                )
            )
        if effective_params is not None:
            task.effective_params = effective_params
        task.updated_at = now_iso()
        return save_production_task(task, directory)


def sync_generation_task(
    generation_task: GenerationTask,
    manifest: PipelineManifest,
    *,
    directory: Path | None = None,
) -> ProductionTask | None:
    production_task_id = generation_task.request.metadata.get("production_task_id")
    if not isinstance(production_task_id, str) or not production_task_id:
        return None
    with _lock:
        task = attach_generation_task(
            production_task_id,
            generation_task,
            effective_params=generation_task.request.params,
            directory=directory,
        )
        attempt = next(
            item for item in task.attempts if item.generation_task_id == generation_task.task_id
        )
        attempt.status = generation_task.status
        attempt.stage = generation_task.progress.stage
        attempt.error = generation_task.error
        attempt.updated_at = now_iso()
        attempt.provider_job_ids = _provider_job_ids(generation_task.progress.detail)
        task.provider_job_ids = list(
            dict.fromkeys(
                job_id for candidate in task.attempts for job_id in candidate.provider_job_ids
            )
        )
        task.progress_current = generation_task.progress.current
        task.progress_total = generation_task.progress.total
        task.progress_percentage = generation_task.progress.percentage

        if generation_task.status == "completed":
            missing = _missing_required_artifacts(generation_task, manifest)
            attempt.required_artifacts_ok = not missing
            attempt.artifact_ids = [
                f"{generation_task.task_id}:{artifact.role or f'{artifact.kind}:{index}'}"
                for index, artifact in enumerate(
                    generation_task.result.artifacts if generation_task.result else []
                )
            ]
            if missing:
                attempt.error = GenerationError(
                    layer="persistence",
                    message=f"任务结束但缺少可读取的必需产物：{', '.join(missing)}",
                    exception_type="MissingRequiredArtifact",
                )

        current_run_id = attempt.run_id
        current_attempts = [item for item in task.attempts if item.run_id == current_run_id]
        statuses = {item.status for item in current_attempts}
        if statuses & {"pending", "running"}:
            state: ProductionTaskState = "in_progress"
            error = None
            next_actor: ProductionActor = "system"
        elif statuses & {"failed", "interrupted"} or any(
            item.required_artifacts_ok is False for item in current_attempts
        ):
            state = "failed"
            error = next((item.error for item in current_attempts if item.error), None)
            next_actor = "user"
        elif "cancelled" in statuses:
            state = "cancelled"
            error = None
            next_actor = "user"
        else:
            state = "produced"
            error = None
            next_actor = "user"
            task.artifact_ids = [
                artifact_id for item in current_attempts for artifact_id in item.artifact_ids
            ]

        timestamp = now_iso()
        if task.state != state:
            task.state_since = timestamp
        task.state = state
        task.stage_id = generation_task.progress.stage
        task.stage_label = generation_task.progress.message or generation_task.progress.stage
        task.next_actor = next_actor
        task.error = error
        if state == "failed":
            task.action_type = "view_error"
            task.action_label = "查看原因"
        elif state == "produced":
            task.action_type = "view_artifacts"
            task.action_label = "查看产物"
        else:
            task.action_type = None
            task.action_label = None
        task.updated_at = timestamp
        task.waiting_since = None
        if state == "failed":
            task.failed_at = timestamp
        elif state == "produced":
            task.produced_at = timestamp
        elif state == "cancelled":
            task.cancelled_at = timestamp
        saved = save_production_task(task, directory)
        _sync_content_projection(saved, generation_task)
        return saved


def _missing_required_artifacts(
    generation_task: GenerationTask, manifest: PipelineManifest
) -> list[str]:
    result = generation_task.result
    if result is None:
        return [output.role for output in manifest.outputs if output.required]
    missing: list[str] = []
    for output in manifest.outputs:
        if not output.required:
            continue
        candidates = [
            artifact
            for artifact in result.artifacts
            if artifact.role == output.role or artifact.kind == output.kind
        ]
        if not candidates:
            missing.append(output.role)
            continue
        if output.kind == "metadata" and output.role == "article":
            if str(result.metadata.get("article") or "").strip():
                continue
        if not any(artifact.path and Path(artifact.path).is_file() for artifact in candidates):
            missing.append(output.role)
    return missing


def _provider_job_ids(detail: Any) -> list[str]:
    if not isinstance(detail, dict):
        return []
    found: list[str] = []
    for key, value in detail.items():
        normalized = key.lower()
        if normalized in {"provider_job_id", "provider_task_id", "external_job_id"}:
            if value not in (None, ""):
                found.append(str(value))
        elif isinstance(value, dict):
            found.extend(_provider_job_ids(value))
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    found.extend(_provider_job_ids(item))
    return list(dict.fromkeys(found))


def _sync_content_projection(
    production_task: ProductionTask, generation_task: GenerationTask
) -> None:
    """Keep the content ledger status and artifact links synchronized.

    Production-task state remains authoritative; the content item projection
    supports content detail and publishing views.
    """

    from pixelle_video.content.store import load_item, save_item

    item = load_item(production_task.content_item_id)
    if item is None:
        return
    links = dict(item.links)
    task_ids = list(links.get("task_ids") or [])
    if generation_task.task_id not in task_ids:
        task_ids.append(generation_task.task_id)
    links["task_ids"] = task_ids
    item.links = links
    previous = item.status
    if production_task.state == "produced":
        item.status = "produced"
        item.automation.pop("production_failure", None)
    elif production_task.state == "failed":
        item.status = "confirmed" if item.variants or item.scene_manifest else "idea"
        item.automation["production_failure"] = {
            "task_id": generation_task.task_id,
            "message": production_task.error.message if production_task.error else "生产失败",
        }
    elif production_task.state == "in_progress":
        item.status = "producing"
    item.updated_at = now_iso()
    if previous != item.status:
        item.add_event(
            "status_changed",
            "system",
            {"from": previous, "to": item.status, "projection": "production_task"},
        )
    save_item(item)
