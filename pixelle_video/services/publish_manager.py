"""
Publish manager for generated Pixelle videos.

This service keeps publishing separate from generation. It reads completed task
metadata, uploads the final video to public storage, sends one Buffer request per
selected platform, and persists per-platform status to publish.json.
"""

import asyncio
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any

from loguru import logger

from pixelle_video.services.buffer_publisher import (
    BufferPublisher,
    BufferPublishError,
)
from pixelle_video.services.persistence import PersistenceService
from pixelle_video.services.public_storage import PublicMediaStorage

CHANNEL_ENV_BY_PLATFORM = {
    "youtube": "BUFFER_CHANNEL_YOUTUBE",
    "tiktok": "BUFFER_CHANNEL_TIKTOK",
    "instagram": "BUFFER_CHANNEL_INSTAGRAM",
    "x": "BUFFER_CHANNEL_X",
    "pinterest": "BUFFER_CHANNEL_PINTEREST",
}

PUBLISH_PLATFORM_ALIASES = {
    "ig": "instagram",
    "ins": "instagram",
    "twitter": "x",
    "pintrest": "pinterest",
}

SUPPORTED_PUBLISH_PLATFORMS = tuple(CHANNEL_ENV_BY_PLATFORM)
PUBLISH_PLATFORM_LABELS = {
    "instagram": "Instagram",
    "pinterest": "Pinterest",
    "tiktok": "TikTok",
    "youtube": "YouTube",
    "x": "X",
}


class PublishManager:
    """Coordinate object storage uploads, Buffer posts, and local publish status."""

    def __init__(
        self,
        *,
        persistence: PersistenceService,
        storage: PublicMediaStorage | None = None,
        publisher: BufferPublisher | None = None,
        channel_ids: dict[str, str] | None = None,
        publish_config: dict[str, Any] | None = None,
    ):
        self.persistence = persistence
        self.storage = storage
        self.publisher = publisher
        self.publish_config = publish_config or {}
        self.channel_ids = channel_ids or self._channel_ids_from_config_and_env()

    def _channel_ids_from_config_and_env(self) -> dict[str, str]:
        channels: dict[str, str] = {}
        configured_channels = self.publish_config.get("buffer", {}).get("channels", {})
        for platform in CHANNEL_ENV_BY_PLATFORM:
            configured_value = (configured_channels.get(platform) or "").strip()
            if configured_value:
                channels[platform] = configured_value

        for platform, env_name in CHANNEL_ENV_BY_PLATFORM.items():
            if platform not in channels and (value := os.getenv(env_name, "").strip()):
                channels[platform] = value

        return channels

    def _get_storage(self) -> PublicMediaStorage:
        if self.storage is None:
            cos_config = self.publish_config.get("cos")
            self.storage = PublicMediaStorage.from_config(cos_config) if cos_config else PublicMediaStorage.from_env()
        return self.storage

    def _get_publisher(self) -> BufferPublisher:
        if self.publisher is None:
            buffer_config = self.publish_config.get("buffer")
            self.publisher = BufferPublisher.from_config(buffer_config) if buffer_config else BufferPublisher.from_env()
        return self.publisher

    def get_publish_path(self, task_id: str) -> Path:
        return self.persistence.get_task_dir(task_id) / "publish.json"

    async def load_publish_record(self, task_id: str) -> dict[str, Any] | None:
        path = self.get_publish_path(task_id)
        if not path.exists():
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as exc:
            logger.error(f"Failed to load publish record {task_id}: {exc}")
            return None

    async def save_publish_record(self, task_id: str, record: dict[str, Any]) -> None:
        path = self.get_publish_path(task_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        record["task_id"] = task_id
        record["updated_at"] = datetime.now().isoformat()
        with open(path, "w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False, indent=2)

    async def publish_task(
        self,
        *,
        task_id: str,
        platforms: list[str],
        caption: str,
        title: str | None = None,
        due_at: str | None = None,
    ) -> dict[str, Any]:
        """
        Publish one completed task to selected Buffer channels.

        Returns the persisted publish record. Per-platform failures are captured
        in jobs and do not abort other selected platforms.
        """
        selected_platforms = self._normalize_platforms(platforms)
        publish_title = (title or "").strip()
        publish_caption = (caption or "").strip()
        metadata = await self.persistence.load_task_metadata(task_id)
        if not metadata:
            raise FileNotFoundError(f"Task not found: {task_id}")
        if metadata.get("status") != "completed":
            raise ValueError(f"Task must be completed before publishing: {task_id}")

        video_path = metadata.get("result", {}).get("video_path")
        if not video_path:
            raise ValueError(f"Task has no result.video_path: {task_id}")
        if not Path(video_path).exists():
            raise FileNotFoundError(video_path)

        record = await self.load_publish_record(task_id) or {
            "task_id": task_id,
            "created_at": datetime.now().isoformat(),
            "public_video_url": None,
            "jobs": [],
        }
        record["title"] = publish_title
        record["caption"] = publish_caption

        public_url = record.get("public_video_url")

        jobs_by_platform = {
            job.get("platform"): job
            for job in record.get("jobs", [])
            if job.get("platform") not in selected_platforms
        }
        for platform in selected_platforms:
            channel_id = self.channel_ids.get(platform)
            jobs_by_platform[platform] = self._new_job(platform, channel_id, public_url, due_at)

        record["jobs"] = list(jobs_by_platform.values())
        await self.save_publish_record(task_id, record)

        publishable_jobs = [
            job
            for job in jobs_by_platform.values()
            if job.get("platform") in selected_platforms and job.get("buffer_channel_id")
        ]

        for platform in selected_platforms:
            job = jobs_by_platform[platform]
            if not job.get("buffer_channel_id"):
                job["status"] = "failed"
                job["error"] = f"{CHANNEL_ENV_BY_PLATFORM[platform]} is not configured"
                job["updated_at"] = datetime.now().isoformat()

        if publishable_jobs and not public_url:
            try:
                storage = self._get_storage()
                public_url = storage.upload_video(video_path, task_id=task_id)
            except Exception as exc:
                storage_name = getattr(self.storage, "display_name", "Object storage")
                for job in publishable_jobs:
                    job["status"] = "failed"
                    job["error"] = f"{storage_name} upload failed: {exc}"
                    job["updated_at"] = datetime.now().isoformat()
                record["jobs"] = list(jobs_by_platform.values())
                await self.save_publish_record(task_id, record)
                return record

            record["public_video_url"] = public_url
            for job in publishable_jobs:
                job["public_video_url"] = public_url
            await self.save_publish_record(task_id, record)

        publisher = None
        if publishable_jobs:
            try:
                publisher = self._get_publisher()
            except Exception as exc:
                for job in publishable_jobs:
                    job["status"] = "failed"
                    job["error"] = f"Buffer configuration failed: {exc}"
                    job["updated_at"] = datetime.now().isoformat()
                record["jobs"] = list(jobs_by_platform.values())
                await self.save_publish_record(task_id, record)
                return record

        for platform in selected_platforms:
            job = jobs_by_platform[platform]
            record["jobs"] = list(jobs_by_platform.values())
            await self.save_publish_record(task_id, record)

            channel_id = job.get("buffer_channel_id")
            if job["status"] == "failed":
                continue
            if not public_url:
                job["status"] = "failed"
                job["error"] = "Public video URL was not created"
                await self.save_publish_record(task_id, record)
                continue

            job["status"] = "uploaded"
            await self.save_publish_record(task_id, record)

            try:
                result = await publisher.create_video_post(
                    channel_id=channel_id,
                    text=publish_caption,
                    video_url=public_url,
                    title=publish_title,
                    platform=platform,
                    due_at=due_at,
                )
            except Exception as exc:
                job["status"] = "failed"
                job["error"] = str(exc)
                logger.warning(f"Publish failed for {task_id}/{platform}: {exc}")
            else:
                job["status"] = "scheduled"
                job["buffer_post_id"] = result.post_id
                job["due_at"] = result.due_at or due_at
                job["error"] = None

            job["updated_at"] = datetime.now().isoformat()
            await self.save_publish_record(task_id, record)

        return record

    async def check_configuration(self, platforms: list[str] | None = None) -> list[dict[str, Any]]:
        """Run non-mutating diagnostics for publish configuration."""
        selected_platforms = self._normalize_platforms(platforms or list(CHANNEL_ENV_BY_PLATFORM))
        checks: list[dict[str, Any]] = []

        try:
            storage = self._get_storage()
            ok, message = await asyncio.to_thread(storage.check_upload_roundtrip)
            checks.append({"name": storage.display_name, "ok": ok, "message": message})
        except Exception as exc:
            checks.append({"name": "Tencent COS", "ok": False, "message": str(exc)})

        try:
            publisher = self._get_publisher()
        except Exception as exc:
            checks.append({"name": "Buffer API", "ok": False, "message": str(exc)})
            return checks

        for platform in selected_platforms:
            channel_id = self.channel_ids.get(platform)
            if not channel_id:
                checks.append(
                    {
                        "name": f"Buffer {platform}",
                        "ok": False,
                        "message": f"{CHANNEL_ENV_BY_PLATFORM[platform]} is not configured",
                    }
                )
                continue

            try:
                channel = await publisher.get_channel(channel_id)
            except BufferPublishError as exc:
                checks.append({"name": f"Buffer {platform}", "ok": False, "message": str(exc)})
            else:
                display_name = channel.get("displayName") or channel.get("name") or channel_id
                checks.append(
                    {
                        "name": f"Buffer {platform}",
                        "ok": True,
                        "message": f"Channel reachable: {display_name}",
                    }
                )

        return checks

    def _normalize_platforms(self, platforms: list[str]) -> list[str]:
        normalized = []
        for platform in platforms:
            raw_key = platform.strip().lower()
            key = PUBLISH_PLATFORM_ALIASES.get(raw_key, raw_key)
            if key not in CHANNEL_ENV_BY_PLATFORM:
                raise ValueError(f"Unsupported publish platform: {platform}")
            if key not in normalized:
                normalized.append(key)
        if not normalized:
            raise ValueError("At least one publish platform is required")
        return normalized

    def _new_job(
        self,
        platform: str,
        channel_id: str | None,
        public_url: str | None,
        due_at: str | None,
    ) -> dict[str, Any]:
        now = datetime.now().isoformat()
        return {
            "platform": platform,
            "buffer_channel_id": channel_id,
            "status": "pending",
            "public_video_url": public_url,
            "buffer_post_id": None,
            "due_at": due_at,
            "error": None,
            "created_at": now,
            "updated_at": now,
        }
