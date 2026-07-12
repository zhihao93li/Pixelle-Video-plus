"""Direct cloud image providers with a normalized Pixelle contract."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Protocol

import httpx

from pixelle_video.config.schema import ImageGenerationConfig

ProgressCallback = Callable[[dict[str, Any]], None]

IMAGE_PROVIDER_MODELS: dict[str, list[dict[str, str]]] = {
    "aliyun_bailian": [
        {"id": "qwen-image-2.0", "label": "Qwen-Image 2.0"},
        {"id": "qwen-image-2.0-pro", "label": "Qwen-Image 2.0 Pro"},
        {"id": "wan2.6-t2i", "label": "通义万相 2.6 文生图"},
    ],
    "volcengine_ark": [
        {"id": "doubao-seedream-5-0-lite", "label": "Seedream 5.0 Lite"},
    ],
}


class ImageProviderError(RuntimeError):
    def __init__(
        self,
        *,
        provider: str,
        layer: str,
        message: str,
        code: str | None = None,
        request_id: str | None = None,
        retryable: bool = False,
    ):
        super().__init__(message)
        self.provider = provider
        self.layer = layer
        self.code = code
        self.request_id = request_id
        self.retryable = retryable


@dataclass(frozen=True)
class ImageGenerationRequest:
    prompt: str
    model: str
    target_width: int | None = None
    target_height: int | None = None
    negative_prompt: str | None = None
    seed: int | None = None
    count: int = 1
    task_id: str | None = None
    frame_index: int | None = None


@dataclass(frozen=True)
class ImageGenerationResult:
    provider: str
    model: str
    image_url: str
    request_id: str | None = None
    actual_width: int | None = None
    actual_height: int | None = None
    seed: int | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


class ImageProvider(Protocol):
    async def generate(
        self,
        request: ImageGenerationRequest,
        progress_callback: ProgressCallback | None = None,
    ) -> ImageGenerationResult: ...


def _closest_size(width: int | None, height: int | None, sizes: list[tuple[int, int]]):
    if not width or not height:
        return sizes[0]
    target_ratio = width / height
    return min(sizes, key=lambda item: abs(item[0] / item[1] - target_ratio))


def provider_size(provider: str, model: str, width: int | None, height: int | None):
    landscape_first = width is not None and height is not None and width > height
    if provider == "aliyun_bailian":
        if model.startswith("wan"):
            sizes = [(1280, 1280), (960, 1696), (1696, 960), (1104, 1472), (1472, 1104)]
        else:
            sizes = [(2048, 2048), (1536, 2688), (2688, 1536), (1728, 2368), (2368, 1728)]
    else:
        sizes = [(2048, 2048), (1440, 2560), (2560, 1440), (1728, 2304), (2304, 1728)]
    if landscape_first:
        sizes = sorted(sizes, key=lambda item: item[0] <= item[1])
    return _closest_size(width, height, sizes)


def _extract_image_url(payload: Any) -> str | None:
    if isinstance(payload, dict):
        for key in ("url", "image_url", "image"):
            value = payload.get(key)
            if isinstance(value, str) and value.startswith(("http://", "https://")):
                return value
        for value in payload.values():
            found = _extract_image_url(value)
            if found:
                return found
    elif isinstance(payload, list):
        for value in payload:
            found = _extract_image_url(value)
            if found:
                return found
    return None


def _request_id(response: httpx.Response, payload: dict[str, Any]) -> str | None:
    return (
        response.headers.get("x-request-id")
        or payload.get("request_id")
        or payload.get("requestId")
    )


class AliyunBailianImageProvider:
    provider_id = "aliyun_bailian"

    def __init__(self, config, client: httpx.AsyncClient | None = None):
        self.config = config
        self._client = client

    def _endpoint(self) -> str:
        if self.config.base_url.strip():
            return self.config.base_url.rstrip("/")
        workspace = self.config.workspace_id.strip()
        if not workspace:
            raise ImageProviderError(
                provider=self.provider_id,
                layer="config",
                message="阿里百炼缺少 workspace_id 或自定义 base_url",
            )
        domain = (
            f"{workspace}.cn-beijing.maas.aliyuncs.com"
            if self.config.region == "cn-beijing"
            else f"{workspace}.ap-southeast-1.maas.aliyuncs.com"
        )
        return f"https://{domain}/api/v1/services/aigc/multimodal-generation/generation"

    async def generate(self, request, progress_callback=None):
        if not self.config.enabled or not self.config.api_key.strip():
            raise ImageProviderError(
                provider=self.provider_id,
                layer="credentials",
                message="阿里百炼图片 Provider 未启用或缺少 API Key",
            )
        width, height = provider_size(
            self.provider_id, request.model, request.target_width, request.target_height
        )
        parameters: dict[str, Any] = {
            "size": f"{width}*{height}",
            "n": 1,
            "watermark": False,
            "prompt_extend": False,
        }
        if request.negative_prompt:
            parameters["negative_prompt"] = request.negative_prompt
        if request.seed is not None:
            parameters["seed"] = request.seed
        body = {
            "model": request.model,
            "input": {"messages": [{"role": "user", "content": [{"text": request.prompt}]}]},
            "parameters": parameters,
        }
        if progress_callback:
            progress_callback({"provider": self.provider_id, "provider_status": "SUBMITTING"})
        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(timeout=self.config.timeout)
        try:
            response = await client.post(
                self._endpoint(),
                headers={"Authorization": f"Bearer {self.config.api_key}"},
                json=body,
            )
            payload = response.json()
            request_id = _request_id(response, payload)
            if response.status_code >= 400:
                raise ImageProviderError(
                    provider=self.provider_id,
                    layer="credentials" if response.status_code in (401, 403) else "api_contract",
                    code=str(payload.get("code") or response.status_code),
                    message=str(payload.get("message") or payload),
                    request_id=request_id,
                )
            url = _extract_image_url(payload)
            if not url:
                raise ImageProviderError(
                    provider=self.provider_id,
                    layer="api_contract",
                    message="阿里百炼响应中没有图片 URL",
                    request_id=request_id,
                )
            if progress_callback:
                progress_callback(
                    {
                        "provider": self.provider_id,
                        "provider_status": "COMPLETED",
                        "provider_task_id": request_id,
                    }
                )
            return ImageGenerationResult(
                provider=self.provider_id,
                model=request.model,
                image_url=url,
                request_id=request_id,
                actual_width=width,
                actual_height=height,
                seed=request.seed,
            )
        except httpx.HTTPError as exc:
            raise ImageProviderError(
                provider=self.provider_id,
                layer="network",
                message=str(exc),
                retryable=True,
            ) from exc
        finally:
            if owns_client:
                await client.aclose()


class VolcengineArkImageProvider:
    provider_id = "volcengine_ark"

    def __init__(self, config, client: httpx.AsyncClient | None = None):
        self.config = config
        self._client = client

    async def generate(self, request, progress_callback=None):
        if not self.config.enabled or not self.config.api_key.strip():
            raise ImageProviderError(
                provider=self.provider_id,
                layer="credentials",
                message="火山方舟图片 Provider 未启用或缺少 API Key",
            )
        width, height = provider_size(
            self.provider_id, request.model, request.target_width, request.target_height
        )
        body: dict[str, Any] = {
            "model": request.model,
            "prompt": request.prompt,
            "size": f"{width}x{height}",
            "response_format": "url",
            "watermark": False,
        }
        if request.seed is not None:
            body["seed"] = request.seed
        if progress_callback:
            progress_callback({"provider": self.provider_id, "provider_status": "SUBMITTING"})
        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(timeout=self.config.timeout)
        try:
            response = await client.post(
                f"{self.config.base_url.rstrip('/')}/images/generations",
                headers={"Authorization": f"Bearer {self.config.api_key}"},
                json=body,
            )
            payload = response.json()
            request_id = _request_id(response, payload)
            if response.status_code >= 400:
                error = payload.get("error") if isinstance(payload.get("error"), dict) else payload
                raise ImageProviderError(
                    provider=self.provider_id,
                    layer="credentials" if response.status_code in (401, 403) else "api_contract",
                    code=str(error.get("code") or response.status_code),
                    message=str(error.get("message") or error),
                    request_id=request_id,
                )
            url = _extract_image_url(payload)
            if not url:
                raise ImageProviderError(
                    provider=self.provider_id,
                    layer="api_contract",
                    message="火山方舟响应中没有图片 URL",
                    request_id=request_id,
                )
            if progress_callback:
                progress_callback(
                    {
                        "provider": self.provider_id,
                        "provider_status": "COMPLETED",
                        "provider_task_id": request_id,
                    }
                )
            return ImageGenerationResult(
                provider=self.provider_id,
                model=request.model,
                image_url=url,
                request_id=request_id,
                actual_width=width,
                actual_height=height,
                seed=request.seed,
            )
        except httpx.HTTPError as exc:
            raise ImageProviderError(
                provider=self.provider_id,
                layer="network",
                message=str(exc),
                retryable=True,
            ) from exc
        finally:
            if owns_client:
                await client.aclose()


class ImageProviderRegistry:
    def __init__(self, config: ImageGenerationConfig):
        self.config = config

    def get(self, provider: str) -> ImageProvider:
        if provider == "aliyun_bailian":
            return AliyunBailianImageProvider(self.config.aliyun_bailian)
        if provider == "volcengine_ark":
            return VolcengineArkImageProvider(self.config.volcengine_ark)
        raise ImageProviderError(
            provider=provider,
            layer="config",
            message=f"未知图片 Provider：{provider}",
        )

    def concurrency_limit(self, provider: str) -> int:
        config = getattr(self.config, provider, None)
        return int(getattr(config, "concurrency_limit", 1) or 1)


def public_image_provider_catalog(config: ImageGenerationConfig) -> dict[str, Any]:
    providers = []
    for provider_id in ("aliyun_bailian", "volcengine_ark"):
        provider_config = getattr(config, provider_id)
        item = provider_config.model_dump(exclude={"api_key"})
        item.update(
            {
                "id": provider_id,
                "configured": bool(provider_config.api_key.strip()),
                "models": IMAGE_PROVIDER_MODELS[provider_id],
            }
        )
        providers.append(item)
    return {"default_provider": config.default_provider, "providers": providers}
