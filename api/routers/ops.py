"""Read-only Pixelle operations API."""

import os
from copy import deepcopy
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, HTTPException

from api.schemas.ops import (
    OpsChannelAccountCreateRequest,
    OpsChannelAccountCreateResponse,
    OpsChannelAccountUpdateRequest,
    OpsChannelAccountUpdateResponse,
    OpsCheatWorkspaceBindRequest,
    OpsCheatWorkspaceResponse,
    OpsContextExportResponse,
    OpsCurrentResponse,
    OpsExperimentResponse,
    OpsIntegrationsResponse,
    OpsProjectCyclesResponse,
    OpsProjectsResponse,
)
from ops.service import OpsError, OpsService
from pixelle_video.config.loader import load_config_dict
from pixelle_video.config.schema import PixelleVideoConfig

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


@router.get(
    "/projects/{project_id}/cheat-workspace",
    response_model=OpsCheatWorkspaceResponse,
)
async def get_ops_project_cheat_workspace(project_id: str):
    try:
        return OpsService().get_project_cheat_workspace(project_id)
    except OpsError as exc:
        _raise_ops_error(exc)


@router.put(
    "/projects/{project_id}/cheat-workspace",
    response_model=OpsCheatWorkspaceResponse,
)
async def bind_ops_project_cheat_workspace(
    project_id: str,
    request: OpsCheatWorkspaceBindRequest,
):
    try:
        return OpsService().set_project_cheat_workspace(
            project_id=project_id,
            workspace_path=request.workspace_path,
            source={
                "kind": "ui",
                "surface": "p2_ops_ui",
                "confirmed_by_user": True,
            },
        )
    except OpsError as exc:
        _raise_ops_error(exc)


@router.get(
    "/projects/{project_id}/cheat-workspace-summary",
    response_model=OpsCheatWorkspaceResponse,
)
async def get_ops_project_cheat_workspace_summary(project_id: str):
    try:
        return OpsService().get_cheat_workspace_summary(project_id)
    except OpsError as exc:
        _raise_ops_error(exc)


@router.get("/integrations", response_model=OpsIntegrationsResponse)
async def list_ops_integrations():
    return _build_integrations_response()


@router.get("/context-export", response_model=OpsContextExportResponse)
async def get_ops_context_export(
    project_id: str | None = None,
    channel_account_id: str | None = None,
    account_id: str | None = None,
):
    try:
        return OpsService().get_context_export(
            project_id=project_id,
            channel_account_id=channel_account_id,
            account_id=account_id,
        )
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


def _build_integrations_response() -> dict:
    config_path = Path("config.yaml")
    raw_config = load_config_dict(str(config_path))
    config = PixelleVideoConfig(**raw_config)
    integrations = _integration_statuses(config)
    return {
        "status": "ok",
        "config_source": {
            "path": str(config_path),
            "exists": config_path.exists(),
            "writable": os.access(config_path, os.W_OK) if config_path.exists() else os.access(Path.cwd(), os.W_OK),
            "write_owner": "Streamlit Settings / config.yaml",
        },
        "integrations": integrations,
        "capabilities": {
            "writes_ops_facts": False,
            "returns_plaintext_secrets": False,
            "ui_write_scope": "configuration_only",
            "advanced_settings_url": "http://localhost:8501/Settings",
        },
        "next_action": {"kind": "open_settings_if_configuration_missing", "blocked": False},
    }


def _integration_statuses(config: PixelleVideoConfig) -> list[dict]:
    llm = config.llm
    comfy = config.comfyui
    fish = comfy.tts.fish_audio
    publish = config.publish
    buffer_channels = publish.buffer.channels.model_dump()

    return [
        _integration(
            integration_id="llm",
            name="LLM",
            group="generation",
            description="文案、标题、提示词等生成能力。",
            required={
                "API Key": bool(llm.api_key.strip()),
                "Base URL": bool(llm.base_url.strip()),
                "Model": bool(llm.model.strip()),
            },
            fields=[
                ("Base URL", llm.base_url),
                ("Model", llm.model),
            ],
            secrets=[("API Key", bool(llm.api_key.strip()), "config.yaml")],
            owner="Video generation",
        ),
        _integration(
            integration_id="runninghub",
            name="RunningHub",
            group="generation",
            description="云端 ComfyUI / 媒体生成工作流执行能力。",
            required={"API Key": bool(comfy.runninghub_api_key)},
            fields=[
                ("并发限制", comfy.runninghub_concurrent_limit),
                ("机器规格", comfy.runninghub_instance_type or "默认"),
                ("默认生图工作流", comfy.image.default_workflow),
                ("默认视频工作流", comfy.video.default_workflow),
            ],
            secrets=[("RunningHub API Key", bool(comfy.runninghub_api_key), "config.yaml")],
            owner="Video generation",
        ),
        _integration(
            integration_id="comfyui",
            name="ComfyUI",
            group="generation",
            description="本地或自建 ComfyUI 服务地址，供工作流执行使用。",
            required={"Server URL": bool(comfy.comfyui_url.strip())},
            fields=[
                ("Server URL", comfy.comfyui_url),
                ("TTS 模式", comfy.tts.inference_mode),
                ("TTS 工作流", comfy.tts.comfyui.default_workflow),
            ],
            secrets=[("ComfyUI API Key", bool(comfy.comfyui_api_key), "config.yaml")],
            owner="Video generation",
        ),
        _integration(
            integration_id="fish_audio",
            name="Fish Audio",
            group="generation",
            description="配音合成能力；可由 config.yaml 或 FISH_API_KEY 提供 key。",
            required={"API Key": bool(fish.api_key or os.getenv("FISH_API_KEY"))},
            fields=[
                ("Base URL", fish.base_url),
                ("Model", fish.model),
                ("默认音色 ID", fish.reference_id),
            ],
            secrets=[
                (
                    "Fish Audio API Key",
                    bool(fish.api_key or os.getenv("FISH_API_KEY")),
                    "env:FISH_API_KEY" if os.getenv("FISH_API_KEY") and not fish.api_key else "config.yaml",
                )
            ],
            owner="Video generation",
        ),
        _integration(
            integration_id="cos",
            name="Tencent COS",
            group="publish",
            description="发布前公共视频素材上传与外链承载。",
            required={
                "Region": bool(publish.cos.region.strip()),
                "Bucket": bool(publish.cos.bucket.strip()),
                "SecretId": bool(publish.cos.secret_id.strip()),
                "SecretKey": bool(publish.cos.secret_key.strip()),
                "Public Base URL": bool(publish.cos.public_base_url.strip()),
            },
            fields=[
                ("Region", publish.cos.region),
                ("Bucket", publish.cos.bucket),
                ("Public Base URL", publish.cos.public_base_url),
                ("Endpoint URL", publish.cos.endpoint_url),
            ],
            secrets=[
                ("COS SecretId", bool(publish.cos.secret_id.strip()), "config.yaml"),
                ("COS SecretKey", bool(publish.cos.secret_key.strip()), "config.yaml"),
            ],
            owner="Publish preparation",
        ),
        _integration(
            integration_id="buffer",
            name="Buffer",
            group="publish",
            description="后续真实发布自动化的候选连接；P1 只展示配置状态，不触发发布。",
            required={
                "API Key": bool(publish.buffer.api_key.strip()),
                "At least one channel": any(bool(value.strip()) for value in buffer_channels.values()),
            },
            fields=[
                ("已配置渠道数", sum(1 for value in buffer_channels.values() if value.strip())),
                ("支持平台", ", ".join(platform for platform, value in buffer_channels.items() if value.strip())),
            ],
            secrets=[("Buffer API Key", bool(publish.buffer.api_key.strip()), "config.yaml")],
            owner="Publish preparation",
        ),
    ]


def _integration(
    *,
    integration_id: str,
    name: str,
    group: str,
    description: str,
    required: dict[str, bool],
    fields: list[tuple[str, object]],
    secrets: list[tuple[str, bool, str]],
    owner: str,
) -> dict:
    missing = [label for label, configured in required.items() if not configured]
    configured_count = len(required) - len(missing)
    if not required or configured_count == len(required):
        status = "configured"
    elif configured_count:
        status = "partial"
    else:
        status = "missing"
    return {
        "id": integration_id,
        "name": name,
        "group": group,
        "status": status,
        "description": description,
        "owner": owner,
        "missing_fields": missing,
        "safe_fields": [
            {"label": label, "value": _safe_display_value(value)}
            for label, value in fields
            if _safe_display_value(value)
        ],
        "secret_refs": [
            {"label": label, "configured": configured, "source": source}
            for label, configured, source in secrets
        ],
    }


def _safe_display_value(value: object) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return text if text else ""
