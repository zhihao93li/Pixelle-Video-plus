"""Thin authenticated HTTP client for Pixelle's use-case API."""

from __future__ import annotations

import asyncio
import base64
import mimetypes
import os
import re
from pathlib import Path
from typing import Any

import httpx


class PixelleAPIError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _safe_message(message: str, *, status_code: int | None = None) -> str:
    if status_code is not None and status_code >= 500:
        return "Pixelle 服务执行失败；请查看本机 API 日志定位原因。"
    message = re.sub(r"(?<![A-Za-z0-9])(?:/[^\s:;,]+)+", "[本机路径]", message)
    return message[:500]


def _token() -> str:
    inline = os.environ.get("PIXELLE_AGENT_TOKEN", "").strip()
    if inline:
        return inline
    configured_file = os.environ.get("PIXELLE_AGENT_TOKEN_FILE", "").strip()
    root = Path(os.environ.get("PIXELLE_VIDEO_ROOT", Path.cwd()))
    path = Path(configured_file).expanduser() if configured_file else root / "data/agent-token"
    try:
        token = path.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise PixelleAPIError(
            "agent_token_missing",
            "找不到 Pixelle Agent Token；请先启动 Pixelle API 或配置 PIXELLE_AGENT_TOKEN。",
        ) from exc
    if not token:
        raise PixelleAPIError("agent_token_empty", "Pixelle Agent Token 文件为空。")
    return token


class PixelleAPIClient:
    def __init__(self, *, base_url: str | None = None, timeout: float = 30.0):
        self.base_url = (
            base_url or os.environ.get("PIXELLE_API_BASE") or "http://127.0.0.1:8000/api"
        ).rstrip("/")
        self.timeout = timeout

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any = None,
        authenticated: bool = True,
    ) -> Any:
        headers = {"Accept": "application/json"}
        if authenticated:
            headers["X-Pixelle-Agent-Token"] = _token()
        url = f"{self.base_url}/{path.lstrip('/')}"
        last_error: Exception | None = None
        for attempt in range(2):
            try:
                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    response = await client.request(
                        method, url, params=params, json=json, headers=headers
                    )
                if response.is_success:
                    return response.json() if response.content else None
                detail: Any
                try:
                    detail = response.json().get("detail")
                except (ValueError, AttributeError):
                    detail = None
                if isinstance(detail, dict):
                    message = str(detail.get("message") or detail)
                else:
                    message = str(detail or f"Pixelle API 返回 HTTP {response.status_code}")
                raise PixelleAPIError(
                    f"http_{response.status_code}",
                    _safe_message(message, status_code=response.status_code),
                )
            except PixelleAPIError:
                raise
            except (httpx.ConnectError, httpx.TimeoutException) as exc:
                last_error = exc
                if attempt == 0:
                    await asyncio.sleep(0.15)
                    continue
        raise PixelleAPIError(
            "api_unavailable",
            "Pixelle API 未启动（uv run uvicorn api.app:app --host 127.0.0.1 --port 8000）。",
        ) from last_error


def file_as_data_url(file_path: str) -> str:
    path = Path(file_path).expanduser()
    if not path.is_file():
        raise PixelleAPIError("image_missing", "找不到指定图片文件。")
    media_type = mimetypes.guess_type(path.name)[0]
    if media_type not in {"image/png", "image/jpeg", "image/webp"}:
        raise PixelleAPIError("image_format", "分镜图片只支持 PNG、JPEG 或 WebP。")
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{media_type};base64,{encoded}"
