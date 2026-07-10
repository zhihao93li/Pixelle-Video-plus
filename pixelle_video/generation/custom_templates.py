"""Persisted custom production templates (克隆自内置模板的自定义风格线).

运营者可以在不改代码的情况下，从现有生产模板克隆出一条新风格线并持久化。
自定义模板存为 JSON（``data/production-templates-custom.json``），结构为
``{template_id: ProductionTemplate 字段 dict}``，在注册表构建时追加到内置模板之后
（id 与内置冲突时保留内置、跳过自定义），随后再套用 per-template overrides。

写文件遵循 ``template_overrides.py`` 的做法：临时文件 + ``os.replace`` + ``threading.Lock``。
"""

import json
import os
import threading

from loguru import logger

from pixelle_video.generation.templates import ProductionTemplate
from pixelle_video.utils.os_util import get_data_path

CUSTOM_TEMPLATES_FILENAME = "production-templates-custom.json"

_lock = threading.Lock()


def _custom_templates_path() -> str:
    return get_data_path(CUSTOM_TEMPLATES_FILENAME)


def _load_raw() -> dict[str, dict]:
    path = _custom_templates_path()
    if not os.path.exists(path):
        return {}
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {
        template_id: payload
        for template_id, payload in data.items()
        if isinstance(template_id, str) and isinstance(payload, dict)
    }


def load_custom_templates() -> list[ProductionTemplate]:
    """Load persisted custom templates, skipping any entry that fails to parse."""
    templates: list[ProductionTemplate] = []
    for template_id, payload in _load_raw().items():
        try:
            template = ProductionTemplate(**payload)
        except (TypeError, ValueError) as error:
            logger.warning(f"跳过无法解析的自定义模板 {template_id!r}: {error}")
            continue
        template.is_custom = True
        templates.append(template)
    return templates


def custom_template_ids() -> set[str]:
    return set(_load_raw().keys())


def _write_all(all_templates: dict[str, dict]) -> None:
    path = _custom_templates_path()
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as handle:
        json.dump(all_templates, handle, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)


def save_custom_template(template: ProductionTemplate) -> ProductionTemplate:
    """Persist (create or replace) a single custom template."""
    with _lock:
        all_templates = _load_raw()
        all_templates[template.id] = template.model_dump()
        _write_all(all_templates)
    return template


def delete_custom_template(template_id: str) -> bool:
    """Delete a custom template. Returns True if an entry was removed."""
    with _lock:
        all_templates = _load_raw()
        if template_id not in all_templates:
            return False
        all_templates.pop(template_id, None)
        _write_all(all_templates)
    return True
