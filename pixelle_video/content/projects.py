"""项目（Project）：内容、任务、作品与运营记录的隔离范围。

项目只负责归属和筛选，不携带生产默认。模板管理长期生产设置，系统设置
管理 Provider 与凭据，本次设置管理单次覆盖。存储
``data/projects.json``：``{"default_project_id": str|None, "projects": {id: {...}}}``。

实现使用 pydantic + tmp+os.replace + threading.Lock，并保留可 monkeypatch 的
``_projects_path()``。归档而非删除；最后一个 active 内容空间不可归档
（约束在 API 层校验）。"当前项目"是前端状态，服务端 default 仅作内部兜底。
"""

import json
import os
import threading
import uuid
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel

from pixelle_video.utils.os_util import get_data_path

PROJECTS_FILENAME = "projects.json"

_lock = threading.Lock()


class Project(BaseModel):
    project_id: str  # uuid4().hex
    name: str
    description: str = ""
    status: Literal["active", "archived"] = "active"
    created_at: str
    updated_at: str


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _projects_path() -> str:
    return get_data_path(PROJECTS_FILENAME)


def _load_raw() -> dict:
    path = _projects_path()
    if not os.path.exists(path):
        return {"default_project_id": None, "projects": {}}
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return {"default_project_id": None, "projects": {}}
    if not isinstance(data, dict):
        return {"default_project_id": None, "projects": {}}
    projects = data.get("projects")
    return {
        "default_project_id": data.get("default_project_id"),
        "projects": projects if isinstance(projects, dict) else {},
    }


def _write_raw(data: dict) -> None:
    path = _projects_path()
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)


def list_projects() -> tuple[str | None, list[Project]]:
    """Return (default_project_id, projects) including archived, sorted by created_at."""
    raw = _load_raw()
    projects: list[Project] = []
    for payload in raw["projects"].values():
        try:
            projects.append(Project(**payload))
        except (TypeError, ValueError):
            continue
    projects.sort(key=lambda p: p.created_at)
    default_id = raw["default_project_id"]
    active = [p.project_id for p in projects if p.status == "active"]
    if default_id not in active:
        # 确定性回退：created_at 序第一个 active（set 迭代序不稳定会导致默认漂移）
        default_id = active[0] if active else None
    return default_id, projects


def get_project(project_id: str) -> Project | None:
    _, projects = list_projects()
    for project in projects:
        if project.project_id == project_id:
            return project
    return None


def get_default_project() -> Project | None:
    default_id, projects = list_projects()
    for project in projects:
        if project.project_id == default_id:
            return project
    return None


def default_project_id() -> str | None:
    default_id, _ = list_projects()
    return default_id


def create_project(
    *,
    name: str,
    description: str = "",
) -> Project:
    timestamp = _now_iso()
    project = Project(
        project_id=uuid.uuid4().hex,
        name=name,
        description=description,
        created_at=timestamp,
        updated_at=timestamp,
    )
    with _lock:
        raw = _load_raw()
        raw["projects"][project.project_id] = project.model_dump()
        # 第一个项目自动成为默认
        if not raw["default_project_id"]:
            raw["default_project_id"] = project.project_id
        _write_raw(raw)
    return project


def update_project(project_id: str, patch: dict) -> Project | None:
    with _lock:
        raw = _load_raw()
        payload = raw["projects"].get(project_id)
        if payload is None:
            return None
        payload.update({key: value for key, value in patch.items() if value is not None})
        payload["project_id"] = project_id
        payload["updated_at"] = _now_iso()
        project = Project(**payload)
        raw["projects"][project_id] = project.model_dump()
        _write_raw(raw)
    return project


def archive_project(project_id: str) -> bool:
    with _lock:
        raw = _load_raw()
        payload = raw["projects"].get(project_id)
        if payload is None:
            return False
        payload["status"] = "archived"
        payload["updated_at"] = _now_iso()
        raw["projects"][project_id] = payload
        _write_raw(raw)
    return True


def restore_project(project_id: str) -> bool:
    with _lock:
        raw = _load_raw()
        payload = raw["projects"].get(project_id)
        if payload is None:
            return False
        payload["status"] = "active"
        payload["updated_at"] = _now_iso()
        raw["projects"][project_id] = payload
        if not raw["default_project_id"]:
            raw["default_project_id"] = project_id
        _write_raw(raw)
    return True


def set_default_project(project_id: str) -> bool:
    with _lock:
        raw = _load_raw()
        payload = raw["projects"].get(project_id)
        if payload is None or payload.get("status") == "archived":
            return False
        raw["default_project_id"] = project_id
        _write_raw(raw)
    return True


def _bootstrap_default_project() -> None:
    """Create the first project for a new local installation."""
    create_project(
        name="PetWoods",
        description="",
    )


def ensure_default_project() -> None:
    """Ensure a new local installation always has one usable project."""
    if not _load_raw()["projects"]:
        _bootstrap_default_project()
