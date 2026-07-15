"""
History API routes.

These endpoints expose persisted generation history to the React console.
"""

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query

from api.dependencies import PixelleVideoDep

router = APIRouter(prefix="/history", tags=["history"])


def _history_manager(pixelle_video: Any):
    manager = getattr(pixelle_video, "history", None)
    if manager is None:
        raise HTTPException(status_code=503, detail="History manager is not initialized")
    return manager


@router.get("/tasks")
async def list_history_tasks(
    pixelle_video: PixelleVideoDep,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    status: str | None = None,
    sort_by: str = "created_at",
    sort_order: Literal["asc", "desc"] = "desc",
):
    """List persisted generation tasks."""
    return await _history_manager(pixelle_video).get_task_list(
        page=page,
        page_size=page_size,
        status=status,
        sort_by=sort_by,
        sort_order=sort_order,
    )


@router.get("/statistics")
async def get_history_statistics(pixelle_video: PixelleVideoDep):
    """Return aggregate generation-history statistics."""
    return await _history_manager(pixelle_video).get_statistics()


@router.get("/tasks/{task_id}")
async def get_history_task_detail(task_id: str, pixelle_video: PixelleVideoDep):
    """Return a task's full persisted detail."""
    detail = await _history_manager(pixelle_video).get_task_detail(task_id)
    if detail is None:
        raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")
    return detail


@router.delete("/tasks/{task_id}")
async def delete_history_task(task_id: str, pixelle_video: PixelleVideoDep):
    """Delete a task and its persisted files."""
    deleted = await _history_manager(pixelle_video).delete_task(task_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")
    return {"deleted": True, "task_id": task_id}
