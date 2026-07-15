"""
Publish API routes.

These endpoints expose publishing operations to the React console.
"""

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from api.dependencies import PixelleVideoDep
from pixelle_video.services.publish_manager import (
    PUBLISH_PLATFORM_LABELS,
    SUPPORTED_PUBLISH_PLATFORMS,
)
from pixelle_video.utils.publish_helpers import (
    DEFAULT_PUBLISH_TIMEZONE,
    PUBLISH_TIMEZONE_OPTIONS,
)

router = APIRouter(prefix="/publish", tags=["publish"])


class PublishConfigCheckRequest(BaseModel):
    platforms: list[str] | None = None


class PublishTaskRequest(BaseModel):
    platforms: list[str] = Field(..., min_length=1)
    caption: str = Field(..., min_length=1)
    title: str | None = None
    due_at: str | None = None


class PublishTimezoneListResponse(BaseModel):
    default_timezone: str
    timezones: list[str]


def _publish_manager(pixelle_video: Any):
    manager = getattr(pixelle_video, "publish", None)
    if manager is None:
        raise HTTPException(status_code=503, detail="Publish manager is not initialized")
    return manager


@router.get("/platforms")
async def list_publish_platforms():
    """List supported publish platforms."""
    return {
        "platforms": [
            {
                "id": platform,
                "label": PUBLISH_PLATFORM_LABELS.get(platform, platform),
            }
            for platform in SUPPORTED_PUBLISH_PLATFORMS
        ]
    }


@router.get("/timezones", response_model=PublishTimezoneListResponse)
async def list_publish_timezones():
    """List timezone options used when scheduling Buffer posts."""
    return PublishTimezoneListResponse(
        default_timezone=DEFAULT_PUBLISH_TIMEZONE,
        timezones=PUBLISH_TIMEZONE_OPTIONS,
    )


@router.get("/tasks/{task_id}/record")
async def get_publish_record(task_id: str, pixelle_video: PixelleVideoDep):
    """Return the locally persisted publish record for a task."""
    record = await _publish_manager(pixelle_video).load_publish_record(task_id)
    return {"task_id": task_id, "record": record}


@router.post("/check")
async def check_publish_configuration(
    request: PublishConfigCheckRequest,
    pixelle_video: PixelleVideoDep,
):
    """Run non-mutating publish diagnostics."""
    try:
        checks = await _publish_manager(pixelle_video).check_configuration(request.platforms)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"checks": checks}


@router.post("/tasks/{task_id}")
async def publish_task(
    task_id: str,
    request: PublishTaskRequest,
    pixelle_video: PixelleVideoDep,
):
    """Submit a completed task to configured publish platforms."""
    try:
        record = await _publish_manager(pixelle_video).publish_task(
            task_id=task_id,
            platforms=request.platforms,
            caption=request.caption.strip(),
            title=(request.title or "").strip(),
            due_at=request.due_at,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"task_id": task_id, "record": record}
