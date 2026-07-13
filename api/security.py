"""Local Agent authentication for Pixelle's single-user API.

This token separates trusted Agent calls from browser/user calls. It is an
operational boundary for a loopback-only product, not a replacement for user
authentication on a remotely exposed server.
"""

from __future__ import annotations

import hmac
import os
import secrets
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated

from fastapi import Header, HTTPException

from pixelle_video.utils.os_util import get_data_path

AGENT_TOKEN_HEADER = "X-Pixelle-Agent-Token"


def agent_token_path() -> Path:
    override = os.environ.get("PIXELLE_AGENT_TOKEN_FILE", "").strip()
    return Path(override).expanduser() if override else Path(get_data_path("agent-token"))


def ensure_agent_token() -> str:
    """Return the local Agent token, creating it atomically with mode 0600."""

    env_token = os.environ.get("PIXELLE_AGENT_TOKEN", "").strip()
    if env_token:
        return env_token

    path = agent_token_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        token = path.read_text(encoding="utf-8").strip()
        if not token:
            raise RuntimeError(f"Agent token file is empty: {path}")
        try:
            path.chmod(0o600)
        except OSError:
            pass
        return token

    token = secrets.token_urlsafe(48)
    temporary = path.parent / f".{path.name}.{os.getpid()}.{secrets.token_hex(8)}.tmp"
    try:
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(token + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temporary, path)
            return token
        except FileExistsError:
            existing = path.read_text(encoding="utf-8").strip()
            if not existing:
                raise RuntimeError(f"Agent token file is empty: {path}")
            return existing
    finally:
        temporary.unlink(missing_ok=True)


def is_valid_agent_token(candidate: str | None) -> bool:
    if not candidate:
        return False
    expected = ensure_agent_token()
    return hmac.compare_digest(candidate, expected)


@dataclass(frozen=True)
class RequestIdentity:
    actor: str
    is_agent: bool
    token_present: bool = False


async def get_request_identity(
    token: Annotated[str | None, Header(alias=AGENT_TOKEN_HEADER)] = None,
) -> RequestIdentity:
    valid = is_valid_agent_token(token)
    if token and not valid:
        raise HTTPException(status_code=403, detail="Agent Token 无效。")
    return RequestIdentity(
        actor="agent" if valid else "user",
        is_agent=valid,
        token_present=bool(token),
    )


def require_agent(identity: RequestIdentity) -> None:
    if not identity.is_agent:
        raise HTTPException(status_code=403, detail="此操作只能由已认证的 Agent 发起。")


def reject_agent_confirmation(identity: RequestIdentity) -> None:
    if identity.token_present:
        raise HTTPException(status_code=403, detail="确认必须由用户在控制台完成。")
