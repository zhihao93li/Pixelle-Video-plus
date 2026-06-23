"""Read-only Pixelle operations API."""

from copy import deepcopy
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, HTTPException

from api.schemas.ops import (
    OpsChannelAccountCreateRequest,
    OpsChannelAccountCreateResponse,
    OpsChannelAccountUpdateRequest,
    OpsChannelAccountUpdateResponse,
    OpsCurrentResponse,
    OpsExperimentResponse,
    OpsProjectCyclesResponse,
    OpsProjectsResponse,
)
from ops.service import OpsError, OpsService

router = APIRouter(prefix="/ops", tags=["Ops"])


@router.get("/current", response_model=OpsCurrentResponse)
async def get_current_ops_view(
    project_id: str | None = None,
    channel_account_id: str | None = None,
    account_id: str | None = None,
):
    try:
        return _with_asset_preview_urls(
            OpsService().current_view(
                project_id=project_id,
                channel_account_id=channel_account_id,
                account_id=account_id,
            )
        )
    except OpsError as exc:
        _raise_ops_error(exc)


@router.get("/experiments/{experiment_id}", response_model=OpsExperimentResponse)
async def get_ops_experiment(experiment_id: str):
    try:
        return _with_asset_preview_urls(OpsService().get_experiment_view(experiment_id))
    except OpsError as exc:
        _raise_ops_error(exc)


@router.get("/projects", response_model=OpsProjectsResponse)
async def list_ops_projects():
    try:
        return OpsService().list_projects()
    except OpsError as exc:
        _raise_ops_error(exc)


@router.get("/projects/{project_id}/cycles", response_model=OpsProjectCyclesResponse)
async def list_ops_project_cycles(project_id: str):
    try:
        return _with_asset_preview_urls(OpsService().list_project_cycles(project_id))
    except OpsError as exc:
        _raise_ops_error(exc)


@router.post(
    "/projects/{project_id}/channel-accounts",
    response_model=OpsChannelAccountCreateResponse,
)
async def create_ops_channel_account(
    project_id: str,
    request: OpsChannelAccountCreateRequest,
):
    try:
        credential_ref = dict(request.credential_ref)
        if request.buffer_channel_id:
            credential_ref["buffer_channel_id"] = request.buffer_channel_id
        account = OpsService().create_channel_account(
            project_id=project_id,
            platform=request.platform,
            account_name=request.account_name,
            account_handle=request.account_handle,
            external_account_id=request.external_account_id,
            status=request.status,
            credential_ref=credential_ref,
            source={
                "kind": "ui",
                "surface": "p1_ops_ui",
                "confirmed_by_user": True,
            },
        )
    except OpsError as exc:
        _raise_ops_error(exc)

    return {
        "status": "ok",
        "channel_account": account,
        "next_action": {"kind": "select_channel_account", "blocked": False},
    }


@router.patch(
    "/channel-accounts/{channel_account_id}",
    response_model=OpsChannelAccountUpdateResponse,
)
async def update_ops_channel_account(
    channel_account_id: str,
    request: OpsChannelAccountUpdateRequest,
):
    try:
        credential_ref = dict(request.credential_ref)
        if request.buffer_channel_id:
            credential_ref["buffer_channel_id"] = request.buffer_channel_id
        account = OpsService().update_channel_account(
            channel_account_id=channel_account_id,
            platform=request.platform,
            account_name=request.account_name,
            account_handle=request.account_handle,
            external_account_id=request.external_account_id,
            status=request.status,
            credential_ref=credential_ref,
            source={
                "kind": "ui",
                "surface": "p1_ops_ui",
                "confirmed_by_user": True,
            },
        )
    except OpsError as exc:
        _raise_ops_error(exc)

    return {
        "status": "ok",
        "channel_account": account,
        "next_action": {"kind": "select_channel_account", "blocked": False},
    }


def _raise_ops_error(exc: OpsError) -> None:
    status_code = 404 if exc.code.endswith("_not_found") else 400
    raise HTTPException(
        status_code=status_code,
        detail={
            "status": "error",
            "error": {"code": exc.code, "message": exc.message},
        },
    ) from exc


def _with_asset_preview_urls(payload: dict) -> dict:
    response = deepcopy(payload)
    for item in _walk_content_items(response):
        _attach_asset_preview_url(item)
    return response


def _walk_content_items(value):
    if isinstance(value, dict):
        items = value.get("content_items")
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict):
                    yield item
        for child in value.values():
            yield from _walk_content_items(child)
    elif isinstance(value, list):
        for item in value:
            yield from _walk_content_items(item)


def _attach_asset_preview_url(item: dict) -> None:
    asset_ref = item.get("asset_ref")
    if not isinstance(asset_ref, dict):
        return
    asset_path = _asset_path_from_ref(asset_ref)
    if not asset_path:
        return
    local_path = _resolve_output_asset_path(asset_path)
    if local_path is None:
        return
    suffix = local_path.suffix.lower()
    media_type = {
        ".mp4": "video",
        ".mov": "video",
        ".webm": "video",
        ".mp3": "audio",
        ".wav": "audio",
        ".png": "image",
        ".jpg": "image",
        ".jpeg": "image",
        ".gif": "image",
    }.get(suffix, "file")
    relative_path = local_path.relative_to(Path.cwd()).as_posix()
    item["asset_url"] = f"/api/files/{quote(relative_path, safe='/')}"
    item["asset_media_type"] = media_type
    item["asset_preview_available"] = local_path.is_file()


def _asset_path_from_ref(asset_ref: dict) -> str | None:
    for key in ("video_path", "path", "output_path", "asset_url", "url", "uri"):
        value = asset_ref.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return None


def _resolve_output_asset_path(asset_path: str) -> Path | None:
    if asset_path.startswith(("http://", "https://")):
        return None
    cwd = Path.cwd().resolve()
    output_root = (cwd / "output").resolve(strict=False)
    raw_path = Path(asset_path).expanduser()
    candidate = raw_path if raw_path.is_absolute() else cwd / raw_path
    try:
        resolved = candidate.resolve(strict=False)
        resolved.relative_to(output_root)
    except ValueError:
        return None
    return resolved
