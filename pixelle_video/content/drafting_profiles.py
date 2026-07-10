"""起草配方（DraftingProfile）：内容侧的"配方管默认"。

与生产模板对称：配方 = Prompt + 模型 + 语言组合。存储 ``data/drafting-profiles.json``：
``{"default_profile_id": str|None, "profiles": {profile_id: {...}}}``。

多项目注：当前默认配方为全局单值；多项目落地时迁移到 ops 项目设置
（与 default_production_template_id 并列），本模块接口保持不变。
"""

import json
import os
import threading
import uuid
from datetime import datetime, timezone

from pydantic import BaseModel, Field

from pixelle_video.utils.os_util import get_data_path

PROFILES_FILENAME = "drafting-profiles.json"

# 起草配置与项目 1:1 绑定。查找的唯一真源是 profile.project_id 反向索引。
# 缺失时用这套安全内置默认自愈补建（对应 web.utils.script_review 的内置 Prompt）。
SAFE_DEFAULT_SCRIPT_TEMPLATE = "Short Oral Script"
SAFE_DEFAULT_SPLIT_TEMPLATE = "Copy-Safe Scene Split"

_lock = threading.Lock()


class DraftingProfile(BaseModel):
    profile_id: str
    name: str
    script_template_name: str
    split_template_name: str
    script_model: str = ""  # 空 = 使用设置页 LLM 默认模型
    split_model: str = ""
    languages: list[str] = Field(default_factory=lambda: ["Chinese"])
    language_script_models: dict[str, str] = Field(default_factory=dict)
    project_id: str = ""  # 所属项目；1:1 绑定的真源（反向索引）
    created_at: str
    updated_at: str


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _profiles_path() -> str:
    return get_data_path(PROFILES_FILENAME)


def _load_raw() -> dict:
    path = _profiles_path()
    if not os.path.exists(path):
        return {"default_profile_id": None, "profiles": {}}
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return {"default_profile_id": None, "profiles": {}}
    if not isinstance(data, dict):
        return {"default_profile_id": None, "profiles": {}}
    profiles = data.get("profiles")
    return {
        "default_profile_id": data.get("default_profile_id"),
        "profiles": profiles if isinstance(profiles, dict) else {},
    }


def _write_raw(data: dict) -> None:
    path = _profiles_path()
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)


def list_profiles() -> tuple[str | None, list[DraftingProfile]]:
    raw = _load_raw()
    profiles: list[DraftingProfile] = []
    for payload in raw["profiles"].values():
        try:
            profiles.append(DraftingProfile(**payload))
        except (TypeError, ValueError):
            continue
    profiles.sort(key=lambda p: p.created_at)
    default_id = raw["default_profile_id"]
    if default_id not in {p.profile_id for p in profiles}:
        default_id = profiles[0].profile_id if profiles else None
    return default_id, profiles


def get_profile(profile_id: str) -> DraftingProfile | None:
    _, profiles = list_profiles()
    for profile in profiles:
        if profile.profile_id == profile_id:
            return profile
    return None


def get_default_profile() -> DraftingProfile | None:
    default_id, profiles = list_profiles()
    for profile in profiles:
        if profile.profile_id == default_id:
            return profile
    return None


def _build_profile(
    *,
    name: str,
    script_template_name: str,
    split_template_name: str,
    script_model: str = "",
    split_model: str = "",
    languages: list[str] | None = None,
    language_script_models: dict[str, str] | None = None,
    project_id: str = "",
) -> DraftingProfile:
    """构造一个 DraftingProfile（不落盘、不加锁）。"""
    timestamp = _now_iso()
    return DraftingProfile(
        profile_id=uuid.uuid4().hex,
        name=name,
        script_template_name=script_template_name,
        split_template_name=split_template_name,
        script_model=script_model,
        split_model=split_model,
        languages=languages or ["Chinese"],
        language_script_models=language_script_models or {},
        project_id=project_id,
        created_at=timestamp,
        updated_at=timestamp,
    )


def create_profile(
    *,
    name: str,
    script_template_name: str,
    split_template_name: str,
    script_model: str = "",
    split_model: str = "",
    languages: list[str] | None = None,
    language_script_models: dict[str, str] | None = None,
    project_id: str = "",
) -> DraftingProfile:
    profile = _build_profile(
        name=name,
        script_template_name=script_template_name,
        split_template_name=split_template_name,
        script_model=script_model,
        split_model=split_model,
        languages=languages,
        language_script_models=language_script_models,
        project_id=project_id,
    )
    with _lock:
        raw = _load_raw()
        raw["profiles"][profile.profile_id] = profile.model_dump()
        _write_raw(raw)
    return profile


def get_profile_by_project(project_id: str) -> DraftingProfile | None:
    """按 project_id 反向索引查配方（不补建）。1:1 绑定的唯一真源。"""
    if not project_id:
        return None
    _, profiles = list_profiles()
    for profile in profiles:
        if profile.project_id == project_id:
            return profile
    return None


def get_profile_for_project(project_id: str) -> DraftingProfile:
    """项目的起草配置：按 project_id 查找；缺失时用安全内置默认自愈补建（幂等）。

    这是解析链与前端读取的唯一入口。以 profile.project_id 为真源，不读项目指针。
    """
    with _lock:
        raw = _load_raw()
        for payload in raw["profiles"].values():
            if isinstance(payload, dict) and payload.get("project_id") == project_id:
                try:
                    return DraftingProfile(**payload)
                except (TypeError, ValueError):
                    continue
        profile = _build_profile(
            name="起草配置",
            script_template_name=SAFE_DEFAULT_SCRIPT_TEMPLATE,
            split_template_name=SAFE_DEFAULT_SPLIT_TEMPLATE,
            project_id=project_id,
        )
        raw["profiles"][profile.profile_id] = profile.model_dump()
        _write_raw(raw)
        return profile


def update_profile(profile_id: str, patch: dict) -> DraftingProfile | None:
    with _lock:
        raw = _load_raw()
        payload = raw["profiles"].get(profile_id)
        if payload is None:
            return None
        payload.update({k: v for k, v in patch.items() if v is not None})
        payload["profile_id"] = profile_id
        payload["updated_at"] = _now_iso()
        profile = DraftingProfile(**payload)
        raw["profiles"][profile_id] = profile.model_dump()
        _write_raw(raw)
    return profile


def delete_profile(profile_id: str) -> bool:
    with _lock:
        raw = _load_raw()
        if profile_id not in raw["profiles"]:
            return False
        raw["profiles"].pop(profile_id)
        if raw["default_profile_id"] == profile_id:
            remaining = sorted(
                raw["profiles"].values(), key=lambda p: p.get("created_at", "")
            )
            raw["default_profile_id"] = (
                remaining[0]["profile_id"] if remaining else None
            )
        _write_raw(raw)
    return True


def set_default_profile(profile_id: str) -> bool:
    with _lock:
        raw = _load_raw()
        if profile_id not in raw["profiles"]:
            return False
        raw["default_profile_id"] = profile_id
        _write_raw(raw)
    return True
