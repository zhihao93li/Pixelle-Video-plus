"""Recover durable pre-generation stages after a local service restart.

Only stages that have not submitted work to an external media provider are
replayed automatically. Generation tasks keep their existing conservative
restart behaviour because repeating an unknown provider job could spend money
or create duplicate artifacts.
"""

from __future__ import annotations

from api.security import RequestIdentity
from pixelle_video.content.operations import list_operations
from pixelle_video.content.production_tasks import (
    list_production_tasks,
    set_task_state,
)
from pixelle_video.content.store import load_item
from pixelle_video.generation.schemas import GenerationError


def _running_operation(item_id: str, operation_name: str):
    candidates = [
        operation
        for operation in list_operations()
        if operation.item_id == item_id
        and operation.operation == operation_name
        and operation.status == "running"
    ]
    candidates.sort(key=lambda operation: operation.created_at, reverse=True)
    return candidates[0] if candidates else None


async def recover_pre_generation_stages(pixelle_video, generation_service) -> None:
    """Resume persisted LLM/planning commands that are safe to replay."""

    from api.routers.content_flows import (
        ConfirmRequest,
        DraftRequest,
        ProduceRequest,
        ReviseReviewRequest,
        _run_confirmed_content_production,
        _run_confirmed_digital_human,
        _run_draft,
        _run_review_regeneration,
        run_scene_planning,
    )
    from api.routers.production_tasks import _run_digital_human_script_stage

    for task in list_production_tasks():
        if task.state != "in_progress" or task.generation_task_ids:
            continue
        item = load_item(task.content_item_id)
        if item is None:
            set_task_state(
                task.production_task_id,
                state="failed",
                stage_id=task.stage_id,
                stage_label="恢复失败",
                next_actor="user",
                action_type="view_error",
                action_label="查看原因",
                error=GenerationError(layer="persistence", message="关联内容已不可读。"),
            )
            continue
        try:
            if task.stage_id == "generate_script":
                if task.pipeline_id in {"topic_to_video", "topic_to_image_post"}:
                    operation = _running_operation(item.item_id, "draft")
                    if operation is None or not operation.payload:
                        raise ValueError("缺少可恢复的写稿请求。")
                    payload = {
                        key: value
                        for key, value in operation.payload.items()
                        if key != "item_id"
                    }
                    request = DraftRequest.model_validate(payload)
                    await _run_draft(
                        operation.operation_id,
                        item.item_id,
                        request,
                        task.pipeline_id,
                        task.actor,
                        pixelle_video,
                    )
                elif task.pipeline_id == "digital_human":
                    await _run_digital_human_script_stage(
                        task_id=task.production_task_id,
                        input_payload=task.input_snapshot,
                        pixelle_video=pixelle_video,
                    )
            elif task.stage_id == "plan_scenes":
                await run_scene_planning(
                    item_id=item.item_id,
                    production_task_id=task.production_task_id,
                    pixelle_video=pixelle_video,
                    review_kind=(
                        "image_pages"
                        if task.pipeline_id in {"image_post", "topic_to_image_post"}
                        else "video_scenes"
                    ),
                )
            elif task.stage_id in {"rewrite_script", "regenerate_scenes"}:
                operation = _running_operation(item.item_id, "revise_review")
                if operation is None or not operation.payload:
                    raise ValueError("缺少可恢复的重新生成请求。")
                payload = {
                    key: value
                    for key, value in operation.payload.items()
                    if key != "item_id"
                }
                request = ReviseReviewRequest.model_validate(payload)
                await _run_review_regeneration(
                    operation_id=operation.operation_id,
                    item_id=item.item_id,
                    production_task_id=task.production_task_id,
                    request=request,
                    actor=task.actor,
                    source="agent" if task.source == "agent" else "react",
                    pixelle_video=pixelle_video,
                )
            elif task.stage_id == "submit_production" and item.status == "confirmed":
                identity = RequestIdentity(
                    actor="agent" if task.source == "agent" else "user",
                    is_agent=task.source == "agent",
                )
                if task.pipeline_id == "digital_human":
                    operation = next(
                        (
                            candidate
                            for candidate in sorted(
                                list_operations(),
                                key=lambda value: value.created_at,
                                reverse=True,
                            )
                            if candidate.item_id == item.item_id
                            and candidate.operation == "confirm"
                            and candidate.payload
                        ),
                        None,
                    )
                    if operation is None:
                        raise ValueError("缺少可恢复的确认记录。")
                    payload = {
                        key: value
                        for key, value in operation.payload.items()
                        if key != "item_id"
                    }
                    await _run_confirmed_digital_human(
                        item_id=item.item_id,
                        production_task_id=task.production_task_id,
                        request=ConfirmRequest.model_validate(payload),
                        identity=identity,
                        generation_service=generation_service,
                    )
                else:
                    await _run_confirmed_content_production(
                        item_id=item.item_id,
                        production_task_id=task.production_task_id,
                        request=ProduceRequest(
                            request_id=f"recovery:{task.production_task_id}:produce",
                            recipe_id=task.recipe_id,
                            client_name="startup-recovery",
                            source="system",
                        ),
                        identity=identity,
                        generation_service=generation_service,
                    )
        except Exception as exc:  # noqa: BLE001 - recovery failures must be observable
            set_task_state(
                task.production_task_id,
                state="failed",
                stage_id=task.stage_id,
                stage_label="服务重启后恢复失败",
                next_actor="user",
                action_type="retry",
                action_label="原样重试",
                error=GenerationError(
                    layer="runtime",
                    message="任务保留完整，但未能在服务重启后自动恢复。",
                    exception_type=type(exc).__name__,
                ),
            )
