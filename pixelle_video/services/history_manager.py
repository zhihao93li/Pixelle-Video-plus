# Copyright (C) 2025 AIDC-AI
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#     http://www.apache.org/licenses/LICENSE-2.0
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""
History Manager Service

Business logic for history management (UI-agnostic).
Provides high-level operations on top of PersistenceService.
"""

import asyncio
from typing import Any, Dict, Optional

from pixelle_video.generation.summaries import build_generation_summary
from pixelle_video.services.persistence import PersistenceService


class HistoryManager:
    """
    History management service

    Provides business logic for:
    - Task listing and filtering
    - Task detail retrieval
    - Task duplication (for re-generation)
    - Task deletion
    """

    def __init__(self, persistence: PersistenceService):
        """
        Initialize history manager

        Args:
            persistence: PersistenceService instance
        """
        self.persistence = persistence

    async def get_task_list(
        self,
        page: int = 1,
        page_size: int = 20,
        status: Optional[str] = None,
        sort_by: str = "created_at",
        sort_order: str = "desc",
    ) -> Dict[str, Any]:
        """
        Get paginated task list

        Args:
            page: Page number (1-indexed)
            page_size: Items per page
            status: Filter by status (optional)
            sort_by: Sort field (created_at, completed_at, title, duration)
            sort_order: Sort order (asc, desc)

        Returns:
            {
                "tasks": [...],
                "total": 100,
                "page": 1,
                "page_size": 20,
                "total_pages": 5
            }
        """
        result = await self.persistence.list_tasks_paginated(
            page=page, page_size=page_size, status=status, sort_by=sort_by, sort_order=sort_order
        )
        tasks = result.get("tasks", [])
        metadata_items = await asyncio.gather(
            *[self.persistence.load_task_metadata(str(task.get("task_id") or "")) for task in tasks]
        )
        enriched_tasks = []
        for task, metadata in zip(tasks, metadata_items):
            summary = dict(task)
            if metadata:
                summary["result"] = _list_result_summary(metadata.get("result"))
                summary["title"] = _history_title(metadata, summary.get("title"))
            enriched_tasks.append(summary)
        return {**result, "tasks": enriched_tasks}

    async def get_task_detail(self, task_id: str) -> Optional[Dict[str, Any]]:
        """
        Get full task detail including storyboard

        Args:
            task_id: Task ID

        Returns:
            {
                "metadata": {...},      # Task metadata
                "storyboard": {...}     # Storyboard data (if available)
            }
            or None if task not found
        """
        metadata = await self.persistence.load_task_metadata(task_id)
        if not metadata:
            return None

        storyboard = await self.persistence.load_storyboard(task_id)

        return {
            "metadata": metadata,
            "storyboard": storyboard,
            "generation_summary": build_generation_summary(metadata.get("result")),
        }

    async def get_statistics(self) -> Dict[str, Any]:
        """
        Get statistics about all tasks

        Returns:
            {
                "total_tasks": 100,
                "completed": 95,
                "failed": 5,
                "total_duration": 3600.5,  # seconds
                "total_size": 1024000000,  # bytes
            }
        """
        return await self.persistence.get_statistics()

    async def delete_task(self, task_id: str) -> bool:
        """
        Delete a task and all its files

        Args:
            task_id: Task ID to delete

        Returns:
            True if successful, False otherwise
        """
        return await self.persistence.delete_task(task_id)

    async def rebuild_index(self):
        """Rebuild task index (useful for maintenance or after manual changes)"""
        await self.persistence.rebuild_index()


def _list_result_summary(result: Any) -> Dict[str, Any] | None:
    if not isinstance(result, dict):
        return None
    assets = []
    manifest = result.get("asset_manifest")
    if isinstance(manifest, dict) and isinstance(manifest.get("assets"), list):
        assets = [asset for asset in manifest["assets"] if isinstance(asset, dict)]

    def asset_path(*, roles: set[str], kind: str | None = None) -> str | None:
        for asset in assets:
            if asset.get("role") not in roles:
                continue
            if kind is not None and asset.get("kind") != kind:
                continue
            path = asset.get("path") or asset.get("url")
            if isinstance(path, str) and path.strip():
                return path
        return None

    image_paths = result.get("image_paths")
    article = result.get("article")
    artifact_type = result.get("artifact_type")
    if artifact_type not in {"video", "image_set", "text"}:
        artifact_type = (
            "image_set"
            if isinstance(image_paths, list)
            else "text"
            if isinstance(article, str)
            else "video"
        )

    cover_path = result.get("cover_path")
    if not isinstance(cover_path, str) or not cover_path.strip():
        cover_path = (
            asset_path(roles={"cover"}, kind="image")
            or asset_path(roles={"composed_frame"}, kind="image")
            or asset_path(roles={"primary_visual"}, kind="image")
        )
    if not cover_path and isinstance(image_paths, list):
        cover_path = next(
            (path for path in image_paths if isinstance(path, str) and path.strip()),
            None,
        )

    video_path = result.get("video_path")
    if not isinstance(video_path, str) or not video_path.strip():
        video_path = asset_path(roles={"final_video", "primary_video"}, kind="video")

    return {
        "artifact_type": artifact_type,
        "cover_path": cover_path,
        "video_path": video_path,
        "duration": result.get("duration"),
        "file_size": result.get("file_size"),
        "page_count": result.get("page_count")
        or (len(image_paths) if isinstance(image_paths, list) else None),
        "word_count": result.get("word_count")
        or (len(article) if isinstance(article, str) else None),
        "error": result.get("error"),
    }


def _history_title(metadata: Dict[str, Any], fallback: Any) -> str:
    """Prefer an explicit artifact/content title over a script preview."""
    result = metadata.get("result")
    input_payload = metadata.get("input")
    result = result if isinstance(result, dict) else {}
    input_payload = input_payload if isinstance(input_payload, dict) else {}
    for value in (
        result.get("title"),
        input_payload.get("title"),
        input_payload.get("topic"),
        input_payload.get("_split_topic"),
        fallback,
    ):
        if isinstance(value, str) and value.strip():
            return value.strip()
    return "未命名作品"
