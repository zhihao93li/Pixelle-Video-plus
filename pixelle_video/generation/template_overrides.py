"""Persisted per-template generation-config overrides.

模板级默认生成配置：三层配置模型的中间层（设置管接入，模板管默认，表单管这一次）。
Overrides are stored as JSON at ``data/production-template-overrides.json`` and
merged into each template's ``fixed_params`` when the registry is built, so
every request (React or Agent) sees the same effective defaults.

Only whitelisted keys can be overridden, and only when the target template also
allows them as user params — pipeline-level wiring (pipeline_id,
capabilities) is never overridable from the API. ``compose_runtime`` IS
overridable now（html_ffmpeg / hyperframes），让用户零代码自建动效模板；选
hyperframes 时校验本机有 npx（动效合成依赖 Node 环境）。
"""

import json
import os
import shutil
import threading
from pathlib import Path
from typing import Any

from pixelle_video.utils.os_util import get_data_path, get_root_path

OVERRIDES_FILENAME = "production-template-overrides.json"

# 可通过 API 覆盖的生成默认值白名单。pipeline 结构性参数一律不在此列。
OVERRIDABLE_PARAMS: dict[str, type | tuple[type, ...]] = {
    "script_template_name": str,
    "script_prompt": str,
    "script_provider_id": str,
    "script_model": str,
    "language_script_models": dict,
    "split_template_name": str,
    "split_prompt": str,
    "split_provider_id": str,
    "split_model": str,
    "split_mode": str,
    "frame_template": str,
    "template_params": dict,
    "media_workflow": str,
    "image_provider": str,
    "image_model": str,
    "media_width": int,
    "media_height": int,
    "prompt_prefix": str,
    "image_prompt_visual_context": str,
    "image_prompt_generation_rules": str,
    "bgm_path": str,
    "bgm_volume": (int, float),
    "bgm_mode": str,
    "tts_inference_mode": str,
    "tts_workflow": str,
    "tts_voice": str,
    "voice_id": str,
    "tts_speed": (int, float),
    "ref_audio": str,
    # 素材分析/媒体 workflow 的执行端（selfhost=本地 ComfyUI / runninghub=云端）
    "source": str,
    # 单 workflow 直跑玩法的 workflow 文件（相对 workflows/，如 runninghub/i2v_LTX2.json）
    "workflow_key": str,
    # 合成方式：html_ffmpeg（标准）/ hyperframes（动效，依赖本机 npx）
    "compose_runtime": str,
    # 长文线：改写提示词（多行，须含 {script} 占位）/ 目标字数 / 写作模型
    "long_form_prompt": str,
    "word_count": int,
    "llm_model": str,
    "llm_provider_id": str,
}

# 长文目标字数的合理区间
WORD_COUNT_MIN = 200
WORD_COUNT_MAX = 20000

# compose_runtime 合法枚举（与 compose_runtime.py 注册的运行时一致）
COMPOSE_RUNTIMES = ("html_ffmpeg", "hyperframes")
IMAGE_PROVIDERS = ("comfy_workflow", "aliyun_bailian", "volcengine_ark")

# 这些字符串参数的空值本身有产品含义（例如明确不使用 BGM），必须与“删除
# 当前层覆盖、继承上层值”区分。结构性枚举和必填模板仍把空值视为 reset。
CLEARABLE_STRING_PARAMS = {
    "media_workflow",
    "image_model",
    "prompt_prefix",
    "image_prompt_visual_context",
    "image_prompt_generation_rules",
    "bgm_path",
    "tts_workflow",
    "tts_voice",
    "ref_audio",
    "llm_model",
    "script_model",
    "split_model",
    "script_provider_id",
    "split_provider_id",
    "llm_provider_id",
    "script_prompt",
    "split_prompt",
}

_lock = threading.Lock()


class TemplateOverrideError(ValueError):
    pass


def _overrides_path() -> str:
    return get_data_path(OVERRIDES_FILENAME)


def _workflows_dir() -> Path:
    # workflow 文件在仓库根 workflows/ 下（pipeline 用 Path("workflows") / key 加载）
    return Path(get_root_path("workflows"))


def available_workflow_keys() -> list[str]:
    base = _workflows_dir()
    if not base.is_dir():
        return []
    return sorted(str(path.relative_to(base)).replace(os.sep, "/") for path in base.rglob("*.json"))


def _validate_workflow_key(value: str) -> None:
    if not (_workflows_dir() / value).is_file():
        available = available_workflow_keys()
        listed = "、".join(available) if available else "（无）"
        raise TemplateOverrideError(f"workflow 文件不存在：{value}。可用：{listed}")


def _validate_compose_runtime(value: str) -> None:
    if value not in COMPOSE_RUNTIMES:
        listed = " / ".join(COMPOSE_RUNTIMES)
        raise TemplateOverrideError(f"合成方式只能是 {listed}；收到 {value!r}。")
    # 动效合成（hyperframes）在合成时调 `npx hyperframes`，本机缺 Node 会失败——
    # 保存时就拦下来，别等到出片才报错。
    if value == "hyperframes" and not shutil.which("npx"):
        raise TemplateOverrideError("动效合成需要本机 Node 环境（npx），请先安装 Node.js。")


def _validate_long_form_prompt(value: str) -> None:
    # long_form_prompt 不是可显式清空参数；这里只校验已通过基础类型检查的非空值。
    if "{script}" not in value:
        raise TemplateOverrideError("长文提示词缺少 {script} 占位符，确认稿将无法注入。")


def _validate_creative_prompt(key: str, value: str) -> None:
    if key == "script_prompt" and "{topic}" not in value:
        raise TemplateOverrideError("写稿提示词缺少 {topic} 占位符，主题将无法注入。")
    if key == "split_prompt" and not any(
        placeholder in value for placeholder in ("{Content}", "{content}", "{script}", "{content2}")
    ):
        raise TemplateOverrideError("分镜提示词缺少正文占位符，文案将无法注入。")


def _validate_word_count(value: int) -> None:
    if not (WORD_COUNT_MIN <= value <= WORD_COUNT_MAX):
        raise TemplateOverrideError(
            f"目标字数需在 {WORD_COUNT_MIN}–{WORD_COUNT_MAX} 之间；收到 {value}。"
        )


def _parse_entry(value: Any) -> tuple[dict[str, Any], bool | None]:
    """把当前模板记录解析成 (参数 overrides, enabled)。"""
    if not isinstance(value, dict):
        return {}, None
    raw_overrides = value.get("overrides")
    overrides = dict(raw_overrides) if isinstance(raw_overrides, dict) else {}
    enabled = value.get("enabled")
    enabled = enabled if isinstance(enabled, bool) else None
    filtered = {key: val for key, val in overrides.items() if key in OVERRIDABLE_PARAMS}
    return filtered, enabled


def _load_entries() -> dict[str, dict[str, Any]]:
    path = _overrides_path()
    if not os.path.exists(path):
        return {}
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(data, dict):
        return {}
    entries: dict[str, dict[str, Any]] = {}
    for template_id, value in data.items():
        if not isinstance(template_id, str):
            continue
        overrides, enabled = _parse_entry(value)
        entries[template_id] = {
            "overrides": overrides,
            "enabled": enabled,
        }
    return entries


def _write_entries(entries: dict[str, dict[str, Any]]) -> None:
    out: dict[str, Any] = {}
    for template_id, entry in entries.items():
        overrides = entry.get("overrides") or {}
        enabled = entry.get("enabled")
        if not overrides and enabled is None:
            continue
        record: dict[str, Any] = {}
        if overrides:
            record["overrides"] = overrides
        if enabled is not None:
            record["enabled"] = enabled
        out[template_id] = record
    path = _overrides_path()
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as handle:
        json.dump(out, handle, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)


def load_all_overrides() -> dict[str, dict[str, Any]]:
    return {
        template_id: entry["overrides"]
        for template_id, entry in _load_entries().items()
        if entry["overrides"]
    }


def load_overrides(template_id: str) -> dict[str, Any]:
    return _load_entries().get(template_id, {}).get("overrides", {})


def load_all_enabled() -> dict[str, bool]:
    """每模板用户侧的启用/停用开关（None 表示未设置）。"""
    return {
        template_id: entry["enabled"]
        for template_id, entry in _load_entries().items()
        if entry["enabled"] is not None
    }


def load_enabled(template_id: str) -> bool | None:
    return _load_entries().get(template_id, {}).get("enabled")


def save_enabled(template_id: str, enabled: bool | None) -> None:
    """写入模板启用开关；None 清除该开关（回到代码默认）。"""
    with _lock:
        entries = _load_entries()
        entry = entries.setdefault(template_id, {"overrides": {}, "enabled": None})
        entry["enabled"] = enabled
        _write_entries(entries)


def validate_overrides(
    overrides: dict[str, Any],
    *,
    allowed_user_params: list[str],
) -> dict[str, Any]:
    """Validate and normalize an overrides payload for one template."""
    if not isinstance(overrides, dict):
        raise TemplateOverrideError("overrides 必须是对象。")

    cleaned: dict[str, Any] = {}
    for key, value in overrides.items():
        if key not in OVERRIDABLE_PARAMS:
            raise TemplateOverrideError(f"参数 {key!r} 不允许作为模板默认值覆盖。")
        if key not in allowed_user_params:
            raise TemplateOverrideError(f"当前模板不支持参数 {key!r}，不能为它设置默认值。")
        if value is None:
            # null 删除当前层覆盖并继承上层。
            continue
        if value == "":
            if key in CLEARABLE_STRING_PARAMS:
                cleaned[key] = ""
            # 其他参数的空字符串表示删除覆盖。
            continue
        expected = OVERRIDABLE_PARAMS[key]
        if isinstance(expected, tuple):
            ok = isinstance(value, expected) and not isinstance(value, bool)
        else:
            ok = isinstance(value, expected) and not isinstance(value, bool)
        if not ok:
            raise TemplateOverrideError(f"参数 {key!r} 的值类型不正确。")
        if key == "workflow_key":
            _validate_workflow_key(value)
        if key == "compose_runtime":
            _validate_compose_runtime(value)
        if key == "image_provider" and value not in IMAGE_PROVIDERS:
            raise TemplateOverrideError(
                "图片 Provider 只能是 comfy_workflow / aliyun_bailian / volcengine_ark。"
            )
        if key == "long_form_prompt":
            _validate_long_form_prompt(value)
        if key in {"script_prompt", "split_prompt"}:
            _validate_creative_prompt(key, value)
        if key == "word_count":
            _validate_word_count(value)
        if key in {"script_template_name", "split_template_name"}:
            from pixelle_video.generation.drafting_support import load_prompt_templates

            kind = "script" if key == "script_template_name" else "split"
            available = {item.name for item in load_prompt_templates(kind)}
            if value not in available:
                raise TemplateOverrideError(f"{key} 引用的提示词手册不存在：{value}")
        if key == "language_script_models":
            if any(
                not isinstance(language, str)
                or not language.strip()
                or not isinstance(selection, dict)
                or not isinstance(selection.get("provider_id"), str)
                or not isinstance(selection.get("model"), str)
                for language, selection in value.items()
            ):
                raise TemplateOverrideError(
                    "language_script_models 必须是语言到“LLM 服务 + 模型”的映射。"
                )
        cleaned[key] = value
    return cleaned


def save_overrides(template_id: str, overrides: dict[str, Any]) -> dict[str, Any]:
    """Persist param overrides for a template; preserves the enabled flag."""
    with _lock:
        entries = _load_entries()
        entry = entries.setdefault(template_id, {"overrides": {}, "enabled": None})
        entry["overrides"] = overrides
        _write_entries(entries)
    return overrides
