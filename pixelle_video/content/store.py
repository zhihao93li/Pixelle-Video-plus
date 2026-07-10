"""ContentItem 持久化：每个条目一个 JSON 文件（``data/content-items/{item_id}.json``）。

沿用现有存储模式（参照 ``data/generation-batches/``）：无数据库，tmp 文件 + ``os.replace`` 原子写，
``threading.Lock`` 串行化写入。目录不存在时自动创建。测试可通过覆盖模块级
``CONTENT_ITEMS_DIR`` 来隔离存储目录（照 ``GENERATION_BATCH_DIR`` 的做法）。
"""

import json
import os
import threading
from pathlib import Path

from pixelle_video.content.models import ContentItem
from pixelle_video.utils.os_util import get_data_path

# 可被测试覆盖的存储目录（None 时回落到 data/content-items/）。
CONTENT_ITEMS_DIR: Path | None = None

_lock = threading.Lock()


def _items_dir() -> Path:
    if CONTENT_ITEMS_DIR is not None:
        directory = Path(CONTENT_ITEMS_DIR)
    else:
        directory = Path(get_data_path("content-items"))
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _item_path(item_id: str) -> Path:
    return _items_dir() / f"{item_id}.json"


def load_item(item_id: str) -> ContentItem | None:
    path = _item_path(item_id)
    if not path.exists():
        return None
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
        return ContentItem(**data)
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return None


def save_item(item: ContentItem) -> ContentItem:
    with _lock:
        path = _item_path(item.item_id)
        tmp_path = path.with_suffix(".json.tmp")
        with open(tmp_path, "w", encoding="utf-8") as handle:
            json.dump(item.model_dump(), handle, ensure_ascii=False, indent=2)
        os.replace(tmp_path, path)
    return item


def delete_item(item_id: str) -> bool:
    with _lock:
        path = _item_path(item_id)
        if not path.exists():
            return False
        path.unlink()
    return True


def list_items(
    status: str | None = None,
    limit: int = 200,
    project: str | None = None,
) -> list[ContentItem]:
    """List items sorted by updated_at desc. ``status`` may be a comma-separated
    list of statuses; None means all. ``project`` filters by project id (None = 全部)."""
    directory = _items_dir()
    wanted: set[str] | None = None
    if status:
        wanted = {part.strip() for part in status.split(",") if part.strip()}

    items: list[ContentItem] = []
    for path in directory.glob("*.json"):
        try:
            with open(path, encoding="utf-8") as handle:
                data = json.load(handle)
            item = ContentItem(**data)
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            continue
        if wanted is not None and item.status not in wanted:
            continue
        if project is not None and item.project != project:
            continue
        items.append(item)

    items.sort(key=lambda it: it.updated_at, reverse=True)
    return items[:limit]
