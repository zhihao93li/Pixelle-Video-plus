"""
Application settings API.

This exposes the same config_manager-backed settings currently edited by the
Streamlit Settings page.
"""

import shutil
from pathlib import Path
from typing import Any, Literal

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, ValidationError

from api.dependencies import ConfigManagerDep
from pixelle_video.config.schema import PixelleVideoConfig
from pixelle_video.services.buffer_publisher import BufferPublisher, BufferPublishError
from pixelle_video.services.image_providers import (
    ImageGenerationRequest,
    ImageProviderError,
    ImageProviderRegistry,
    public_image_provider_catalog,
)
from pixelle_video.services.public_storage import PublishConfigurationError
from pixelle_video.utils.llm_util import fetch_available_models, test_llm_connection
from pixelle_video.utils.runninghub_workflows import (
    create_runninghub_workflow_file,
    list_custom_runninghub_workflows,
)

router = APIRouter(prefix="/settings", tags=["settings"])

RUNNINGHUB_WORKFLOWS_DIR: Path | None = None


class LlmConnectionRequest(BaseModel):
    api_key: str = Field(default="")
    base_url: str = Field(default="")


class LlmModelListResponse(BaseModel):
    models: list[str]


class LlmConnectionResponse(BaseModel):
    ok: bool
    message: str
    model_count: int


class ComfyuiConnectionRequest(BaseModel):
    comfyui_url: str = Field(default="")


class ComfyuiConnectionResponse(BaseModel):
    ok: bool
    message: str


class RunninghubWorkflowRequest(BaseModel):
    kind: str
    name: str
    workflow_id: str
    overwrite: bool = False


class RunninghubWorkflowListResponse(BaseModel):
    workflows: list[dict[str, str]]


class RunninghubWorkflowCreateResponse(BaseModel):
    workflow: dict[str, str]
    workflows: list[dict[str, str]]


class BufferChannelsRequest(BaseModel):
    api_key: str = Field(default="")
    organization_id: str | None = None


class BufferChannelsResponse(BaseModel):
    channels: list[dict[str, Any]]
    detected_channels: dict[str, str]


class SettingsDiagnosticCheck(BaseModel):
    id: str
    label: str
    ok: bool
    severity: Literal["info", "warning", "error"] = "error"
    message: str


class SettingsDiagnosticsResponse(BaseModel):
    ok: bool
    checks: list[SettingsDiagnosticCheck]


ImageProviderId = Literal["aliyun_bailian", "volcengine_ark"]


class ImageProviderUpdateRequest(BaseModel):
    enabled: bool | None = None
    api_key: str | None = None
    clear_api_key: bool = False
    base_url: str | None = None
    default_model: str | None = None
    timeout: int | None = Field(default=None, ge=30, le=1800)
    concurrency_limit: int | None = Field(default=None, ge=1, le=10)
    region: Literal["cn-beijing", "ap-southeast-1"] | None = None
    workspace_id: str | None = None


@router.get("/config")
async def get_settings_config(config_manager: ConfigManagerDep):
    """Return the current app configuration."""
    return _settings_payload(config_manager)


@router.get("/diagnostics", response_model=SettingsDiagnosticsResponse)
async def get_settings_diagnostics(config_manager: ConfigManagerDep):
    """Return redacted production-readiness checks for generation and publishing."""
    config = config_manager.config
    checks = _diagnostic_checks(config)
    return SettingsDiagnosticsResponse(
        ok=all(check.ok or check.severity != "error" for check in checks),
        checks=checks,
    )


@router.put("/config")
async def update_settings_config(
    updates: dict[str, Any],
    config_manager: ConfigManagerDep,
):
    """Update and persist the app configuration."""
    current = config_manager.config.to_dict()
    merged = _merge_settings_updates(current, updates)
    try:
        config_manager.config = PixelleVideoConfig(**merged)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc

    config_manager.save()
    return _settings_payload(config_manager)


@router.post("/config/reset")
async def reset_settings_config(config_manager: ConfigManagerDep):
    """Reset app configuration to schema defaults."""
    config_manager.config = PixelleVideoConfig()
    config_manager.save()
    return _settings_payload(config_manager)


@router.get("/image-providers")
async def list_image_providers(config_manager: ConfigManagerDep):
    return public_image_provider_catalog(config_manager.config.image_generation)


@router.put("/image-providers/{provider_id}")
async def update_image_provider(
    provider_id: ImageProviderId,
    request: ImageProviderUpdateRequest,
    config_manager: ConfigManagerDep,
):
    current = getattr(config_manager.config.image_generation, provider_id).model_dump()
    updates = request.model_dump(exclude_none=True, exclude={"clear_api_key"})
    incoming_key = updates.pop("api_key", None)
    if request.clear_api_key:
        current["api_key"] = ""
    elif incoming_key and incoming_key.strip():
        current["api_key"] = incoming_key.strip()
    current.update(updates)
    config_manager.update({"image_generation": {provider_id: current}})
    config_manager.save()
    return await list_image_providers(config_manager)


@router.post("/image-providers/{provider_id}/test")
async def test_image_provider(
    provider_id: ImageProviderId,
    config_manager: ConfigManagerDep,
):
    image_config = config_manager.config.image_generation
    provider_config = getattr(image_config, provider_id)
    provider = ImageProviderRegistry(image_config).get(provider_id)
    try:
        result = await provider.generate(
            ImageGenerationRequest(
                prompt="一只橙色小猫，简洁白色背景，清晰插画",
                model=provider_config.default_model,
                target_width=1024,
                target_height=1024,
            )
        )
    except ImageProviderError as exc:
        raise HTTPException(
            status_code=422 if exc.layer in {"config", "credentials"} else 502,
            detail={
                "provider": exc.provider,
                "layer": exc.layer,
                "code": exc.code,
                "message": str(exc),
                "request_id": exc.request_id,
                "retryable": exc.retryable,
            },
        ) from exc
    return {
        "ok": True,
        "provider": provider_id,
        "model": result.model,
        "request_id": result.request_id,
        "image_url": result.image_url,
    }


@router.post("/llm/models", response_model=LlmModelListResponse)
async def list_llm_models(request: LlmConnectionRequest, config_manager: ConfigManagerDep):
    """Load models from the configured OpenAI-compatible LLM endpoint."""
    api_key = request.api_key.strip() or config_manager.config.llm.api_key.strip()
    base_url = request.base_url.strip() or config_manager.config.llm.base_url.strip()
    if not api_key or not base_url:
        raise HTTPException(status_code=400, detail="LLM API key and base URL are required")

    try:
        models = await run_in_threadpool(
            fetch_available_models,
            api_key,
            base_url,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return LlmModelListResponse(models=models)


@router.post("/llm/test", response_model=LlmConnectionResponse)
async def test_llm_settings_connection(
    request: LlmConnectionRequest, config_manager: ConfigManagerDep
):
    """Test the configured OpenAI-compatible LLM endpoint."""
    api_key = request.api_key.strip() or config_manager.config.llm.api_key.strip()
    base_url = request.base_url.strip() or config_manager.config.llm.base_url.strip()
    if not api_key or not base_url:
        raise HTTPException(status_code=400, detail="LLM API key and base URL are required")

    ok, message, model_count = await run_in_threadpool(
        test_llm_connection,
        api_key,
        base_url,
    )
    return LlmConnectionResponse(ok=ok, message=message, model_count=model_count)


@router.post("/comfyui/test", response_model=ComfyuiConnectionResponse)
async def test_comfyui_settings_connection(request: ComfyuiConnectionRequest):
    """Test the self-hosted ComfyUI system_stats endpoint."""
    comfyui_url = request.comfyui_url.strip().rstrip("/")
    if not comfyui_url:
        raise HTTPException(status_code=400, detail="ComfyUI URL is required")

    return await _test_comfyui_connection(comfyui_url)


@router.get(
    "/runninghub/workflows",
    response_model=RunninghubWorkflowListResponse,
)
async def list_runninghub_workflows():
    """List locally registered RunningHub wrapper workflows."""
    return RunninghubWorkflowListResponse(
        workflows=list_custom_runninghub_workflows(base_dir=RUNNINGHUB_WORKFLOWS_DIR),
    )


@router.post(
    "/runninghub/workflows",
    response_model=RunninghubWorkflowCreateResponse,
)
async def create_runninghub_workflow(request: RunninghubWorkflowRequest):
    """Register an existing RunningHub workflow as a local wrapper file."""
    try:
        workflow = create_runninghub_workflow_file(
            kind=request.kind,
            name=request.name,
            workflow_id=request.workflow_id,
            overwrite=request.overwrite,
            base_dir=RUNNINGHUB_WORKFLOWS_DIR,
        )
    except FileExistsError as exc:
        raise HTTPException(
            status_code=409,
            detail=f"A workflow with this local name already exists: {exc}",
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    _clear_existing_workflow_caches()
    return RunninghubWorkflowCreateResponse(
        workflow=workflow,
        workflows=list_custom_runninghub_workflows(base_dir=RUNNINGHUB_WORKFLOWS_DIR),
    )


@router.post("/buffer/channels", response_model=BufferChannelsResponse)
async def fetch_buffer_channels(request: BufferChannelsRequest, config_manager: ConfigManagerDep):
    """Fetch Buffer channels and map supported platforms to channel IDs."""
    api_key = request.api_key.strip() or config_manager.config.publish.buffer.api_key.strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="Buffer API key is required")

    try:
        publisher = BufferPublisher(api_key=api_key)
        channels = await publisher.list_channels(request.organization_id)
    except (BufferPublishError, PublishConfigurationError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    detected_channels = BufferPublisher.supported_channel_ids_from_channels(channels)
    return BufferChannelsResponse(
        channels=[_buffer_channel_payload(channel) for channel in channels],
        detected_channels=detected_channels,
    )


def _settings_payload(config_manager):
    config = _redact_settings_secrets(config_manager.config.to_dict())
    return {
        "configured": config_manager.validate(),
        "config": config,
    }


def _diagnostic_checks(config: PixelleVideoConfig) -> list[SettingsDiagnosticCheck]:
    fish_config = config.comfyui.tts.fish_audio
    buffer_channels = config.publish.buffer.channels.model_dump()
    registered_workflows = list_custom_runninghub_workflows(base_dir=RUNNINGHUB_WORKFLOWS_DIR)

    return [
        _diagnostic_check(
            "llm_config",
            "LLM 配置",
            config.is_llm_configured(),
            "已配置 API Key、Base URL 和默认模型。",
            "缺少 LLM API Key、Base URL 或默认模型，选题生成、标题和提示词生成会失败。",
        ),
        _diagnostic_check(
            "ffmpeg",
            "FFmpeg",
            bool(shutil.which("ffmpeg") and shutil.which("ffprobe")),
            "ffmpeg 和 ffprobe 已可用。",
            "缺少 ffmpeg 或 ffprobe，视频合成、时长读取和质量检查会失败。",
        ),
        _diagnostic_check(
            "hyperframes",
            "HyperFrames",
            bool(shutil.which("npx")),
            "npx 已可用，高质量 HyperFrames 模板具备本地运行前置条件。",
            "缺少 npx，高质量 HyperFrames 模板无法本地渲染。",
            severity="warning",
        ),
        _diagnostic_check(
            "runninghub_config",
            "RunningHub",
            bool((config.comfyui.runninghub_api_key or "").strip()),
            "RunningHub API Key 已配置。",
            "缺少 RunningHub API Key，RunningHub image/video workflow 无法提交。",
        ),
        _diagnostic_check(
            "aliyun_bailian_image",
            "阿里百炼图片生成",
            bool(
                config.image_generation.aliyun_bailian.enabled
                and config.image_generation.aliyun_bailian.api_key.strip()
            ),
            "阿里百炼图片 Provider 已启用并配置凭证。",
            "阿里百炼图片 Provider 未启用或缺少 API Key。",
            severity="info",
        ),
        _diagnostic_check(
            "volcengine_ark_image",
            "火山方舟图片生成",
            bool(
                config.image_generation.volcengine_ark.enabled
                and config.image_generation.volcengine_ark.api_key.strip()
            ),
            "火山方舟图片 Provider 已启用并配置凭证。",
            "火山方舟图片 Provider 未启用或缺少 API Key。",
            severity="info",
        ),
        _diagnostic_check(
            "runninghub_timeout",
            "RunningHub 超时",
            bool(config.comfyui.runninghub_timeout and config.comfyui.runninghub_timeout >= 30),
            f"RunningHub task 超时：{config.comfyui.runninghub_timeout} 秒。",
            "RunningHub task timeout 未配置；外部队列可能导致任务无限等待。",
            severity="warning",
        ),
        _diagnostic_check(
            "comfyui_config",
            "ComfyUI",
            bool(config.comfyui.comfyui_url.strip()),
            f"ComfyUI URL 已配置：{config.comfyui.comfyui_url.strip()}",
            "缺少 ComfyUI URL，selfhost workflow 无法连接。连接是否在线仍需点击 ComfyUI 测试。",
            severity="warning",
        ),
        _diagnostic_check(
            "fish_audio_config",
            "Fish Audio",
            bool(fish_config.api_key.strip() and (fish_config.reference_id or "").strip()),
            "Fish Audio API Key 和默认 reference_id 已配置。",
            "缺少 Fish Audio API Key 或默认 reference_id；文案审核多语言 Fish TTS 需要逐语言配置或补齐默认值。",
            severity="warning",
        ),
        _diagnostic_check(
            "default_image_workflow",
            "默认图片 workflow",
            bool(config.comfyui.image.default_workflow),
            f"默认图片 workflow：{config.comfyui.image.default_workflow}",
            "缺少默认图片 workflow；标准视频和素材包装可能需要手动指定 workflow。",
            severity="warning",
        ),
        _diagnostic_check(
            "default_video_workflow",
            "默认视频 workflow",
            bool(config.comfyui.video.default_workflow),
            f"默认视频 workflow：{config.comfyui.video.default_workflow}",
            "缺少默认视频 workflow；I2V 或视频 workflow 预览需要模板固定或手动指定 workflow。",
            severity="warning",
        ),
        _diagnostic_check(
            "registered_runninghub_workflows",
            "RunningHub workflow 注册",
            bool(registered_workflows),
            f"已注册 {len(registered_workflows)} 个 RunningHub wrapper workflow。",
            "未发现通过设置页注册的 RunningHub wrapper workflow；内置 workflow 仍可能可用。",
            severity="info",
        ),
        _diagnostic_check(
            "buffer_publish",
            "Buffer 发布",
            bool(config.publish.buffer.api_key.strip() and any(buffer_channels.values())),
            "Buffer API Key 和至少一个发布 channel 已配置。",
            "缺少 Buffer API Key 或 channel 映射；发布前需要补齐。",
            severity="warning",
        ),
        _diagnostic_check(
            "cos_publish",
            "COS 公开存储",
            bool(
                config.publish.cos.region.strip()
                and config.publish.cos.bucket.strip()
                and config.publish.cos.secret_id.strip()
                and config.publish.cos.secret_key.strip()
                and config.publish.cos.public_base_url.strip()
            ),
            "COS 区域、Bucket、密钥和公开 URL 已配置。",
            "缺少 COS 配置；Buffer 发布视频前无法生成公开视频 URL。",
            severity="warning",
        ),
    ]


def _diagnostic_check(
    check_id: str,
    label: str,
    ok: bool,
    ok_message: str,
    failure_message: str,
    *,
    severity: Literal["info", "warning", "error"] = "error",
) -> SettingsDiagnosticCheck:
    return SettingsDiagnosticCheck(
        id=check_id,
        label=label,
        ok=ok,
        severity=severity,
        message=ok_message if ok else failure_message,
    )


def _deep_merge(base: dict[str, Any], updates: dict[str, Any]) -> dict[str, Any]:
    for key, value in updates.items():
        if key in base and isinstance(base[key], dict) and isinstance(value, dict):
            _deep_merge(base[key], value)
        else:
            base[key] = value
    return base


_SECRET_FIELD_NAMES = {
    "api_key",
    "comfyui_api_key",
    "runninghub_api_key",
    "secret_id",
    "secret_key",
}


def _redact_settings_secrets(value: Any) -> Any:
    if isinstance(value, list):
        return [_redact_settings_secrets(entry) for entry in value]
    if not isinstance(value, dict):
        return value

    redacted: dict[str, Any] = {}
    for key, entry in value.items():
        if key in _SECRET_FIELD_NAMES:
            redacted[key] = ""
            redacted[f"{key}_configured"] = bool(str(entry or "").strip())
        else:
            redacted[key] = _redact_settings_secrets(entry)
    return redacted


def _merge_settings_updates(current: dict[str, Any], updates: dict[str, Any]) -> dict[str, Any]:
    """Merge a redacted settings payload without erasing stored credentials.

    Empty or omitted secret fields mean "preserve". A secret is removed only
    through its explicit sibling flag, e.g. ``clear_api_key: true``.
    Response-only ``*_configured`` fields are ignored.
    """

    merged = dict(current)
    for key, value in updates.items():
        if key.endswith("_configured") or key.startswith("clear_"):
            continue
        if key in _SECRET_FIELD_NAMES:
            if updates.get(f"clear_{key}") is True:
                merged[key] = ""
            elif value not in (None, ""):
                merged[key] = value
            continue
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _merge_settings_updates(merged[key], value)
        else:
            merged[key] = value
    return merged


async def _test_comfyui_connection(comfyui_url: str) -> ComfyuiConnectionResponse:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{comfyui_url}/system_stats")
    except httpx.HTTPError as exc:
        return ComfyuiConnectionResponse(ok=False, message=str(exc))

    if response.status_code == 200:
        return ComfyuiConnectionResponse(ok=True, message="Connection successful")

    return ComfyuiConnectionResponse(
        ok=False,
        message=f"ComfyUI returned HTTP {response.status_code}",
    )


def _buffer_channel_payload(channel: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": channel.get("id"),
        "name": channel.get("name"),
        "displayName": channel.get("displayName"),
        "service": channel.get("service"),
        "isQueuePaused": channel.get("isQueuePaused"),
    }


def _clear_existing_workflow_caches() -> None:
    try:
        from api import dependencies
    except Exception:
        return

    pixelle_video = getattr(dependencies, "_pixelle_video_instance", None)
    if pixelle_video is None:
        return

    for service_name in ("media", "tts", "image_analysis", "video_analysis"):
        service = getattr(pixelle_video, service_name, None)
        if service is not None and hasattr(service, "_workflows_cache"):
            service._workflows_cache = None
