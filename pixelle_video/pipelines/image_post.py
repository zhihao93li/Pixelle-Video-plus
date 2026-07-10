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
Xiaohongshu Image Post Pipeline

标准线的减法：无 TTS、无视频合成。确认稿（split_mode=line，行=页）→
封面 + 每行一页配图的图集（PNG）+ 发布文案（全文）。

复用 FrameProcessor 的 `_step_generate_media`（每页配图）与 `_compose_frame_html`
（页文本 + 配图 + 版式模板 → PNG），不生成音频、不合成视频。
"""

import dataclasses
from datetime import datetime
from typing import Callable, Optional

from loguru import logger

from pixelle_video.models.progress import ProgressEvent
from pixelle_video.models.storyboard import (
    Storyboard,
    StoryboardConfig,
    StoryboardFrame,
)
from pixelle_video.pipelines.base import BasePipeline
from pixelle_video.utils.content_generators import (
    generate_image_prompts,
    generate_title,
    split_narration_script,
)
from pixelle_video.utils.os_util import create_task_output_dir, get_task_frame_path
from pixelle_video.utils.prompt_helper import build_image_prompt

# 小红书图集上限 18 图（含封面）→ 正文最多 17 页
MAX_BODY_PAGES = 17
DEFAULT_PAGE_TEMPLATE = "1080x1440/image_post_default.html"
COVER_TEMPLATE = "1080x1440/image_post_cover.html"


@dataclasses.dataclass
class ImagePostResult:
    """图文帖产物：封面 + 每页图 + 发布文案。

    与 VideoGenerationResult 平级，供 GenerationService 按 ``artifact_type`` 分支
    转成 image_set 形态的 GenerationResult。
    """

    artifact_type: str  # 恒为 "image_set"
    image_paths: list[str]  # 封面在首，其后每页正文
    cover_path: str
    page_paths: list[str]
    caption: str
    title: str
    page_count: int
    task_id: str


class ImagePostPipeline(BasePipeline):
    """小红书图文帖管线（image_post）。"""

    async def __call__(
        self,
        text: str,
        progress_callback: Optional[Callable[[ProgressEvent], None]] = None,
        **kwargs,
    ) -> ImagePostResult:
        params = kwargs
        split_mode = params.get("split_mode") or "line"

        # 1. 分页（确认稿主路径：line 时行=页）
        self._report_progress(progress_callback, "paginate", 0.02)
        narrations = await split_narration_script(text, split_mode=split_mode)
        narrations = [line for line in narrations if line and line.strip()]
        if not narrations:
            raise ValueError("图文帖没有可用的正文（确认稿为空）。")
        if len(narrations) > MAX_BODY_PAGES:
            raise ValueError(
                f"图文帖正文 {len(narrations)} 页，超过小红书上限"
                f"（封面 + {MAX_BODY_PAGES} 页 = 18 图）。"
                f"请把确认稿精简到 ≤{MAX_BODY_PAGES} 行后重试。"
            )

        # 2. 标题（封面用）
        title = params.get("title") or await generate_title(
            self.llm, text, strategy="llm"
        )

        # 3. 每页配图提示词
        self._report_progress(progress_callback, "generate_image_prompts", 0.1)
        prefix = params.get("prompt_prefix") or ""
        base_prompts = await generate_image_prompts(
            self.llm,
            narrations=narrations,
            visual_context=params.get("image_prompt_visual_context"),
            generation_rules=params.get("image_prompt_generation_rules"),
            all_narrations=narrations,
        )
        image_prompts = [build_image_prompt(prompt, prefix) for prompt in base_prompts]

        # 任务目录 + 配置（图文帖不需要 TTS 相关字段）
        _task_dir, task_id = create_task_output_dir()
        # 页面版式（PNG）是 1080×1440（3:4，模板 CSS 决定）；这里是每页 AI 配图的生成尺寸
        media_width = params.get("media_width") or 1024
        media_height = params.get("media_height") or 1024
        page_config = StoryboardConfig(
            media_width=media_width,
            media_height=media_height,
            task_id=task_id,
            n_storyboard=len(narrations),
            media_workflow=params.get("media_workflow"),
            frame_template=params.get("frame_template") or DEFAULT_PAGE_TEMPLATE,
            template_params=params.get("template_params"),
        )
        storyboard = Storyboard(
            title=title, config=page_config, created_at=datetime.now()
        )
        for index, (narration, image_prompt) in enumerate(
            zip(narrations, image_prompts)
        ):
            storyboard.frames.append(
                StoryboardFrame(
                    index=index,
                    narration=narration,
                    image_prompt=image_prompt,
                    created_at=datetime.now(),
                )
            )

        frame_processor = self.core.frame_processor

        # 4. 逐页：配图 + 版式渲染成 PNG（复用 FrameProcessor，跳过 TTS / 视频段）
        total = len(storyboard.frames)
        page_paths: list[str] = []
        for index, frame in enumerate(storyboard.frames):
            self._report_progress(
                progress_callback,
                "generate_media",
                0.15 + 0.7 * (index / max(total, 1)),
                frame_current=index + 1,
                frame_total=total,
            )
            await frame_processor._step_generate_media(frame, page_config)
            composed = await frame_processor._compose_frame_html(
                frame,
                storyboard,
                page_config,
                get_task_frame_path(task_id, frame.index, "composed"),
            )
            frame.composed_image_path = composed
            page_paths.append(composed)

        # 5. 封面（大标题 + 配图，用 cover 版式变体）
        self._report_progress(progress_callback, "compose_pages", 0.9)
        cover_path = await self._render_cover(
            frame_processor,
            storyboard,
            page_config,
            task_id,
            params,
            prefix,
            title,
            cover_index=total,
        )

        caption = text  # 全文即发布文案

        result = ImagePostResult(
            artifact_type="image_set",
            image_paths=[cover_path, *page_paths],
            cover_path=cover_path,
            page_paths=page_paths,
            caption=caption,
            title=title,
            page_count=len(page_paths),
            task_id=task_id,
        )
        await self._persist(storyboard, result, params)
        self._report_progress(progress_callback, "completed", 1.0)
        logger.success(
            f"🖼️ Image post generated: cover + {len(page_paths)} pages "
            f"(task {task_id})"
        )
        return result

    async def _render_cover(
        self,
        frame_processor,
        storyboard: Storyboard,
        page_config: StoryboardConfig,
        task_id: str,
        params: dict,
        prefix: str,
        title: str,
        *,
        cover_index: int,
    ) -> str:
        cover_config = dataclasses.replace(page_config, frame_template=COVER_TEMPLATE)
        cover_prompts = await generate_image_prompts(
            self.llm,
            narrations=[title],
            visual_context=params.get("image_prompt_visual_context"),
            generation_rules=params.get("image_prompt_generation_rules"),
            all_narrations=[title],
        )
        cover_prompt = build_image_prompt(
            cover_prompts[0] if cover_prompts else title, prefix
        )
        cover_frame = StoryboardFrame(
            index=cover_index,
            narration="",
            image_prompt=cover_prompt,
            created_at=datetime.now(),
        )
        await frame_processor._step_generate_media(cover_frame, cover_config)
        return await frame_processor._compose_frame_html(
            cover_frame,
            storyboard,
            cover_config,
            get_task_frame_path(task_id, cover_index, "composed"),
        )

    async def _persist(
        self, storyboard: Storyboard, result: ImagePostResult, params: dict
    ) -> None:
        """落 task metadata，让作品库能列出图集。失败静默——持久化失败不该中断出片。"""
        try:
            input_with_title = dict(params)
            input_with_title.pop("progress_callback", None)
            input_with_title["text"] = result.caption
            input_with_title.setdefault("title", result.title)
            metadata = {
                "task_id": result.task_id,
                "created_at": storyboard.created_at.isoformat()
                if storyboard.created_at
                else None,
                "completed_at": datetime.now().isoformat(),
                "status": "completed",
                "input": input_with_title,
                "result": {
                    "artifact_type": "image_set",
                    "cover_path": result.cover_path,
                    "image_paths": result.image_paths,
                    "page_paths": result.page_paths,
                    "page_count": result.page_count,
                    "caption": result.caption,
                    "n_frames": result.page_count,
                },
            }
            await self.core.persistence.save_task_metadata(result.task_id, metadata)
            await self.core.persistence.save_storyboard(result.task_id, storyboard)
            logger.info(f"💾 Saved image-post task metadata: {result.task_id}")
        except Exception as error:  # noqa: BLE001 - persistence must not break generation
            logger.error(f"Failed to persist image-post task data: {error}")
