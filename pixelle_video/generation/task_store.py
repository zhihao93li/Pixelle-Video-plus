"""Durable storage for canonical generation task state."""

import json
import os
import re
import threading
from pathlib import Path

from loguru import logger

from pixelle_video.generation.schemas import GenerationTask
from pixelle_video.utils.os_util import get_data_path

GENERATION_TASK_DIR: Path | None = None

_lock = threading.Lock()


def task_directory(directory: Path | None = None) -> Path:
    target = directory or GENERATION_TASK_DIR
    if target is None:
        target = Path(get_data_path("generation-tasks"))
    target = Path(target)
    target.mkdir(parents=True, exist_ok=True)
    return target


def save_generation_task(task: GenerationTask, directory: Path | None = None) -> None:
    path = _task_path(task.task_id, directory)
    payload = task.model_dump(mode="json")
    with _lock:
        temporary = path.with_suffix(".json.tmp")
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        os.replace(temporary, path)


def load_generation_task(task_id: str, directory: Path | None = None) -> GenerationTask | None:
    path = _task_path(task_id, directory)
    if not path.exists():
        return None
    try:
        return GenerationTask.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        logger.warning(f"生成任务状态无法读取：{path}: {error}")
        return None


def load_generation_tasks(directory: Path | None = None) -> list[GenerationTask]:
    target = task_directory(directory)
    tasks: list[GenerationTask] = []
    for path in sorted(target.glob("*.json")):
        try:
            tasks.append(GenerationTask.model_validate_json(path.read_text(encoding="utf-8")))
        except (OSError, ValueError) as error:
            logger.warning(f"生成任务状态无法读取：{path}: {error}")
            continue
    return tasks


def _task_path(task_id: str, directory: Path | None = None) -> Path:
    safe_id = re.sub(r"[^A-Za-z0-9._-]+", "_", task_id).strip("._-")
    if not safe_id:
        raise ValueError("Generation task id is required")
    return task_directory(directory) / f"{safe_id}.json"
