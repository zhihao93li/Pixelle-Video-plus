"""Durable checkpoints for multi-step content use cases."""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import uuid
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

from pixelle_video.content.models import now_iso
from pixelle_video.utils.os_util import get_data_path

CONTENT_FLOW_OPERATION_DIR: Path | None = None
_lock = threading.RLock()


class ContentFlowOperation(BaseModel):
    operation_id: str
    request_id: str
    request_hash: str
    operation: str
    item_id: str
    prior_status: str
    phase: Literal["accepted", "external_completed", "item_updated", "task_created", "linked"] = (
        "accepted"
    )
    status: Literal["running", "completed", "failed"] = "running"
    draft_set_id: str | None = None
    batch_id: str | None = None
    task_ids: list[str] = Field(default_factory=list)
    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


def operation_directory() -> Path:
    target = CONTENT_FLOW_OPERATION_DIR or Path(get_data_path("content-flow-operations"))
    target = Path(target)
    target.mkdir(parents=True, exist_ok=True)
    return target


def request_hash(payload: Any) -> str:
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def begin_operation(
    *, request_id: str, payload_hash: str, operation: str, item_id: str, prior_status: str
) -> tuple[ContentFlowOperation, bool]:
    if not request_id.strip():
        raise ValueError("request_id is required")
    with _lock:
        existing = find_by_request_id(request_id)
        if existing:
            if existing.request_hash != payload_hash:
                raise FileExistsError("request_id_conflict")
            return existing, False
        record = ContentFlowOperation(
            operation_id=uuid.uuid4().hex,
            request_id=request_id,
            request_hash=payload_hash,
            operation=operation,
            item_id=item_id,
            prior_status=prior_status,
        )
        save_operation(record)
        return record, True


def save_operation(record: ContentFlowOperation) -> ContentFlowOperation:
    record.updated_at = now_iso()
    path = _operation_path(record.operation_id)
    with _lock:
        temporary = path.with_suffix(".json.tmp")
        temporary.write_text(
            json.dumps(record.model_dump(mode="json"), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        os.replace(temporary, path)
    return record


def load_operation(operation_id: str) -> ContentFlowOperation | None:
    path = _operation_path(operation_id)
    if not path.exists():
        return None
    try:
        return ContentFlowOperation.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def list_operations() -> list[ContentFlowOperation]:
    records: list[ContentFlowOperation] = []
    for path in operation_directory().glob("*.json"):
        try:
            records.append(ContentFlowOperation.model_validate_json(path.read_text("utf-8")))
        except (OSError, ValueError):
            continue
    return records


def find_by_request_id(request_id: str) -> ContentFlowOperation | None:
    return next((record for record in list_operations() if record.request_id == request_id), None)


def complete_operation(record: ContentFlowOperation, result: dict[str, Any]) -> None:
    record.phase = "linked"
    record.status = "completed"
    record.result = result
    record.error = None
    save_operation(record)


def fail_operation(record: ContentFlowOperation, message: str, *, layer: str = "runtime") -> None:
    record.status = "failed"
    record.error = {"layer": layer, "message": message}
    save_operation(record)


def recover_running_operations() -> None:
    """Reconcile interrupted operations from persisted item/task facts."""

    from pixelle_video.content.store import list_items, load_item, save_item
    from pixelle_video.generation.task_store import load_generation_task

    for record in list_operations():
        if record.status != "running":
            continue
        if record.operation == "topics":
            item_ids = [
                candidate.item_id
                for candidate in list_items(limit=1_000_000)
                if any(
                    event.detail.get("request_id") == record.request_id
                    for event in candidate.events
                )
            ]
            if item_ids:
                complete_operation(record, {"item_ids": item_ids, "recovered": True})
            else:
                fail_operation(record, "服务重启前选题未形成可恢复结果。")
            continue
        item = load_item(record.item_id)
        if item is None:
            fail_operation(record, "内容条目不存在，无法恢复。", layer="persistence")
            continue
        if record.operation == "draft":
            if (
                item.status == "pending_review"
                and record.draft_set_id
                and item.links.get("draft_set_id") == record.draft_set_id
            ):
                complete_operation(record, {"item_id": item.item_id, "status": item.status})
            else:
                if item.status == "drafting":
                    item.status = "idea"
                    item.add_event(
                        "status_changed",
                        "system",
                        {"from": "drafting", "to": "idea", "reason": "interrupted"},
                    )
                    item.updated_at = now_iso()
                    save_item(item)
                fail_operation(record, "服务重启时起草尚未形成可恢复结果。")
            continue
        if record.operation == "produce":
            known_ids = [task_id for task_id in record.task_ids if load_generation_task(task_id)]
            if known_ids:
                item.links["task_ids"] = list(
                    dict.fromkeys([*(item.links.get("task_ids") or []), *known_ids])
                )
                if record.batch_id:
                    item.links["batch_ids"] = list(
                        dict.fromkeys([*(item.links.get("batch_ids") or []), record.batch_id])
                    )
                item.status = "producing"
                item.automation["production_prior_status"] = record.prior_status
                item.updated_at = now_iso()
                save_item(item)
                complete_operation(
                    record, {"item_id": item.item_id, "task_ids": known_ids, "recovered": True}
                )
            else:
                item.status = record.prior_status
                item.updated_at = now_iso()
                save_item(item)
                fail_operation(record, "服务重启前尚未创建生产任务。")
            continue

        matching_event = any(
            event.detail.get("request_id") == record.request_id for event in item.events
        )
        if record.operation == "mark_published":
            publication = next(
                (entry for entry in item.publications if entry.request_id == record.request_id),
                None,
            )
            if publication is not None:
                complete_operation(
                    record,
                    {
                        "publication_id": publication.publication_id,
                        "recovered": True,
                    },
                )
                continue
        if matching_event:
            complete_operation(
                record,
                {"item_id": item.item_id, "status": item.status, "recovered": True},
            )
        else:
            fail_operation(record, "服务重启前操作未形成可恢复结果。")


def _operation_path(operation_id: str) -> Path:
    safe_id = re.sub(r"[^A-Za-z0-9._-]+", "_", operation_id).strip("._-")
    if not safe_id:
        raise ValueError("operation_id is required")
    return operation_directory() / f"{safe_id}.json"
