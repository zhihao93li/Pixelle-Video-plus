"""项目（Project）：品牌级内容线实体，是控制台的全局作用域维度。

一个项目 = 一个品牌/内容线（发布渠道挂在项目下），管三类默认：默认生产配方、
语言集 + 每语言 TTS 音色、发布平台预选。写稿规则属于生产配方。存储
``data/projects.json``：``{"default_project_id": str|None, "projects": {id: {...}}}``。

实现使用 pydantic + tmp+os.replace + threading.Lock，并保留可 monkeypatch 的
``_projects_path()``。归档而非删除：默认项目与最后一个 active
项目不可归档（约束在 API 层校验）。"当前项目"是前端状态，服务端 default 仅作兜底。
"""

import json
import os
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field

from pixelle_video.utils.os_util import get_data_path

PROJECTS_FILENAME = "projects.json"

_lock = threading.Lock()


class Project(BaseModel):
    project_id: str  # uuid4().hex
    name: str
    description: str = ""
    status: Literal["active", "archived"] = "active"
    default_production_template_id: str | None = None
    languages: list[str] = Field(default_factory=lambda: ["Chinese"])
    tts_voice_by_language: dict[str, str] = Field(default_factory=dict)
    publish_platforms: list[str] = Field(default_factory=list)
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
    default_production_template_id: str | None = None,
    languages: list[str] | None = None,
    tts_voice_by_language: dict[str, str] | None = None,
    publish_platforms: list[str] | None = None,
    copy_from_project_id: str | None = None,
) -> Project:
    source: Project | None = None
    if copy_from_project_id:
        source = get_project(copy_from_project_id)

    timestamp = _now_iso()
    project = Project(
        project_id=uuid.uuid4().hex,
        name=name,
        description=description,
        default_production_template_id=(
            default_production_template_id
            if default_production_template_id is not None
            else (source.default_production_template_id if source else None)
        ),
        languages=(
            languages
            if languages is not None
            else (list(source.languages) if source else ["Chinese"])
        ),
        tts_voice_by_language=(
            tts_voice_by_language
            if tts_voice_by_language is not None
            else (dict(source.tts_voice_by_language) if source else {})
        ),
        publish_platforms=(
            publish_platforms
            if publish_platforms is not None
            else (list(source.publish_platforms) if source else [])
        ),
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


# ---------------------------------------------------------------------------
# 迁移（幂等）
# ---------------------------------------------------------------------------


def _read_ops_seed() -> dict:
    """Best-effort：从 data/ops.db 的 operating_projects 第一行取品牌信息。任何失败回退 {}。"""
    db_path = get_data_path("ops.db")
    if not os.path.exists(db_path):
        return {}
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT name, description, generation_settings_json "
            "FROM operating_projects ORDER BY created_at LIMIT 1"
        ).fetchone()
        conn.close()
    except (sqlite3.Error, OSError):
        return {}
    if row is None:
        return {}
    settings: dict = {}
    try:
        settings = json.loads(row["generation_settings_json"] or "{}")
    except (json.JSONDecodeError, TypeError):
        settings = {}
    return {
        "name": row["name"],
        "description": row["description"] or "",
        "default_production_template_id": settings.get("default_production_template_id"),
    }


def _migrate_content_items(default_project_id_value: str, valid_ids: set[str]) -> None:
    """把 project 字段不是任何合法 project_id 的存量条目改写为默认项目。幂等。"""
    from pixelle_video.content.store import list_items, save_item

    for item in list_items(limit=1_000_000):
        if item.project not in valid_ids:
            item.project = default_project_id_value
            save_item(item)


def _bootstrap_default_project() -> None:
    """无项目时从 ops.db 种子建默认项目并归拢存量条目。"""
    seed = _read_ops_seed()
    name = (seed.get("name") or "PetWoods").strip() or "PetWoods"
    description = seed.get("description") or ""
    template_id = seed.get("default_production_template_id")
    if not template_id:
        from pixelle_video.generation.templates import (
            build_default_production_template_registry,
        )

        registry = build_default_production_template_registry()
        template_id = registry.default_template_id(
            project="PetWoods", channel="xiaohongshu"
        )

    project = create_project(
        name=name,
        description=description,
        default_production_template_id=template_id,
    )

    _, projects = list_projects()
    valid_ids = {p.project_id for p in projects}
    _migrate_content_items(project.project_id, valid_ids)


# 退役模板 → 骨架替代品（主力 static_subtitle 迁往迁移生成的自定义模板）
_MIGRATED_STATIC_SUBTITLE = "migrated_static_subtitle_v1"
_STANDARD_SKELETON = "pipeline_standard_base_v1"
_ASSET_SKELETON = "pipeline_asset_based_base_v1"
_RETIRED_TEMPLATE_REPLACEMENT = {
    "petwoods_xhs_static_subtitle_v1": _MIGRATED_STATIC_SUBTITLE,
    "petwoods_xhs_daily_v1": _STANDARD_SKELETON,
    "petwoods_xhs_topic_to_video_v1": _STANDARD_SKELETON,
    "petwoods_xhs_quality_explainer_v1": _STANDARD_SKELETON,
    "petwoods_xhs_asset_enhanced_v1": _ASSET_SKELETON,
    "petwoods_xhs_real_material_montage_v1": _ASSET_SKELETON,
}


def _ensure_migrated_static_subtitle() -> None:
    """把主力 static_subtitle 的生效参数迁成自定义模板「静态字幕快出」。幂等。"""
    from pixelle_video.generation.custom_templates import (
        custom_template_ids,
        save_custom_template,
    )
    from pixelle_video.generation.templates import (
        ProductionTemplateError,
        build_default_production_template_registry,
    )

    if _MIGRATED_STATIC_SUBTITLE in custom_template_ids():
        return
    registry = build_default_production_template_registry()
    try:
        source = registry.get("petwoods_xhs_static_subtitle_v1")
    except ProductionTemplateError:
        return
    clone = source.model_copy(deep=True)
    clone.id = _MIGRATED_STATIC_SUBTITLE
    clone.display_name = "静态字幕快出"
    clone.description = "静态画面 + 字幕配音，适合快速批量出片。"
    clone.project = None
    clone.channel = None
    clone.is_custom = True
    clone.enabled = True
    clone.migration_notes = "由 static_subtitle 主力迁移生成，保留其当时的生效参数。"
    save_custom_template(clone)


def _repoint_project_default_templates() -> None:
    """把项目默认模板从退役/不存在的模板重指到骨架（含 archived）。幂等。"""
    from pixelle_video.generation.templates import (
        build_default_production_template_registry,
    )

    valid_ids = {t.id for t in build_default_production_template_registry().list()}
    _, projects = list_projects()
    for project in projects:
        current = project.default_production_template_id
        if not current:
            continue
        target = _RETIRED_TEMPLATE_REPLACEMENT.get(current)
        if target is None and current not in valid_ids:
            target = _STANDARD_SKELETON  # 指向不存在的模板 → 重指标准骨架
        if target and target != current:
            update_project(
                project.project_id, {"default_production_template_id": target}
            )


def ensure_migrated() -> None:
    """幂等迁移：无项目时建默认项目并归拢条目；完成骨架化模板迁移。"""
    if not _load_raw()["projects"]:
        _bootstrap_default_project()
    _ensure_migrated_static_subtitle()
    _repoint_project_default_templates()
