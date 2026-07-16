"""Agent-owned storyboard images to Pixelle video composition pipeline."""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any, Callable

from pydantic import BaseModel, ConfigDict, Field, field_validator

from pixelle_video.models.progress import ProgressEvent
from pixelle_video.pipelines.linear import PipelineContext
from pixelle_video.pipelines.standard import StandardPipeline


class CodexSceneSpec(BaseModel):
    """A user-confirmed scene produced by an Agent before image generation."""

    model_config = ConfigDict(extra="forbid")

    scene_id: str = Field(min_length=1, max_length=120)
    narration: str = Field(min_length=1)
    image_prompt: str = Field(min_length=1)
    image_path: str = Field(min_length=1)
    duration: float | None = None

    @field_validator("scene_id", "narration", "image_prompt", "image_path")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value

    @field_validator("duration")
    @classmethod
    def validate_duration(cls, value: float | None) -> float | None:
        if value is not None and (not math.isfinite(value) or value <= 0):
            raise ValueError("duration must be a positive finite number")
        return value


def validate_codex_scenes(scenes: Any) -> list[CodexSceneSpec]:
    if not isinstance(scenes, list):
        raise ValueError("Agent scene video requires scenes to be a list")
    if not scenes:
        raise ValueError("Agent scene video requires at least one confirmed scene")

    normalized = [CodexSceneSpec.model_validate(scene) for scene in scenes]
    scene_ids = [scene.scene_id for scene in normalized]
    if len(scene_ids) != len(set(scene_ids)):
        raise ValueError("Agent scene video scene_id values must be unique")

    for scene in normalized:
        image_path = Path(scene.image_path).expanduser()
        if not image_path.is_file():
            raise ValueError(
                f"Agent scene {scene.scene_id!r} image does not exist: {scene.image_path}"
            )
        if image_path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
            raise ValueError(
                f"Agent scene {scene.scene_id!r} image must be PNG, JPEG, or WebP"
            )
        scene.image_path = str(image_path.resolve())
    return normalized


class CodexSceneVideoPipeline(StandardPipeline):
    """Reuse Pixelle's TTS/subtitle/FFmpeg stages with exact Agent scene media."""

    async def __call__(
        self,
        scenes: list[dict[str, Any]],
        progress_callback: Callable[[ProgressEvent], None] | None = None,
        **kwargs: Any,
    ):
        normalized = validate_codex_scenes(scenes)
        text = "\n".join(scene.narration for scene in normalized)
        return await super().__call__(
            text=text,
            progress_callback=progress_callback,
            scenes=[scene.model_dump(mode="json") for scene in normalized],
            **kwargs,
        )

    async def generate_content(self, ctx: PipelineContext):
        scenes = ctx.params["scenes"]
        ctx.narrations = [scene["narration"] for scene in scenes]
        self._report_progress(ctx.progress_callback, "validated_scenes", 0.05)

    async def determine_title(self, ctx: PipelineContext):
        title = (ctx.params.get("title") or "").strip()
        if not title:
            first_narration = ctx.narrations[0].strip()
            title = first_narration[:40].rstrip("\uff0c,\u3002.!\uff01\uff1f? ") or "Agent \u914d\u56fe\u89c6\u9891"
        ctx.title = title

    async def plan_visuals(self, ctx: PipelineContext):
        ctx.image_prompts = [scene["image_prompt"] for scene in ctx.params["scenes"]]
        self._report_progress(ctx.progress_callback, "using_codex_images", 0.15)

    async def initialize_storyboard(self, ctx: PipelineContext):
        await super().initialize_storyboard(ctx)
        for frame, scene in zip(ctx.storyboard.frames, ctx.params["scenes"]):
            frame.scene_id = scene["scene_id"]
            frame.image_path = scene["image_path"]
            frame.media_type = "image"
            frame.planned_duration = scene.get("duration")
