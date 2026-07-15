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
Long-form Article Pipeline

全系统最薄的管线：LLM-only，无配图、无 TTS、无合成。把确认稿（或其分镜行 join）
扩写成结构化的 markdown 长文，产物纯文本（article.md）。每语言一个任务。

长文风格是模板的资产——写作 Prompt 走模板参数 ``long_form_prompt``（含 {script}
占位），克隆模板即复制风格。
"""

import os
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

from loguru import logger

from pixelle_video.models.progress import ProgressEvent
from pixelle_video.pipelines.base import BasePipeline
from pixelle_video.utils.os_util import create_task_output_dir

# 内置中性默认长文提示词（不带品牌词；含 {script} 等占位）
DEFAULT_LONG_FORM_PROMPT = """你是一名资深长文写作者。请把下面的确认稿扩写成一篇结构化的 markdown 长文，适合公众号 / 知乎 / 小红书长文发布。

要求：
- 用 markdown：开头一个抓人的钩子段落；正文用 ## 小标题分成若干小节；结尾给出明确的行动号召（CTA）。
- 忠于确认稿的事实与观点，只做展开、举例、过渡与润色，不要编造与原意相悖的内容。
- 语言：{language}。目标篇幅：{word_count} 字左右。
- 标题（可选，用作一级标题）：{title}
- 只输出正文 markdown，不要额外解释。

确认稿：
{script}
"""


class LongFormResult:
    """长文产物：纯 markdown 全文 + 落盘路径。

    与 VideoGenerationResult / ImagePostResult 平级，供 GenerationService 按
    ``artifact_type`` 分支转成 text 形态的 GenerationResult。
    """

    def __init__(
        self,
        *,
        article: str,
        article_path: str,
        title: str,
        language: str,
        word_count: int,
        task_id: str,
    ):
        self.artifact_type = "text"
        self.article = article
        self.article_path = article_path
        self.title = title
        self.language = language
        self.word_count = word_count
        self.task_id = task_id


class LongFormPipeline(BasePipeline):
    """长文生产线（long_form）。"""

    async def __call__(
        self,
        text: str,
        progress_callback: Optional[Callable[[ProgressEvent], None]] = None,
        **kwargs,
    ) -> LongFormResult:
        from pixelle_video.generation.drafting_support import _call_llm_retrying_empty

        params = kwargs
        script = (text or "").strip()
        if not script:
            raise ValueError("长文没有可用的确认稿（正文为空）。")

        title = params.get("title") or ""
        language = params.get("language") or "中文"
        word_count = int(params.get("word_count") or 1800)
        llm_model = params.get("llm_model") or None
        llm_provider_id = params.get("llm_provider_id") or None
        prompt_template = params.get("long_form_prompt") or DEFAULT_LONG_FORM_PROMPT
        if "{script}" not in prompt_template:
            raise ValueError("长文提示词缺少 {script} 占位符，确认稿将无法注入。")

        assembled_prompt = (
            prompt_template.replace("{script}", script)
            .replace("{title}", title)
            .replace("{language}", language)
            .replace("{word_count}", str(word_count))
        )

        self._report_progress(progress_callback, "write_article", 0.1)
        # 篇幅越长给的 token 上限越高，避免正文被截断（留合理封顶）
        max_tokens = min(8000, max(1500, word_count * 2))
        markdown = await _call_llm_retrying_empty(
            self.llm,
            prompt=assembled_prompt,
            provider_id=llm_provider_id,
            model=llm_model,
            temperature=0.7,
            max_tokens=max_tokens,
        )
        markdown = (markdown or "").strip()
        if not markdown:
            raise ValueError(
                "长文生成失败：模型多次返回空内容，请重试或更换写作模型。"
            )

        self._report_progress(progress_callback, "save_artifacts", 0.9)
        task_dir, task_id = create_task_output_dir()
        article_path = os.path.join(task_dir, "article.md")
        Path(article_path).write_text(markdown, encoding="utf-8")

        result = LongFormResult(
            article=markdown,
            article_path=article_path,
            title=title,
            language=language,
            word_count=len(markdown),
            task_id=task_id,
        )
        await self._persist(result, params)
        self._report_progress(progress_callback, "completed", 1.0)
        logger.success(
            f"📝 Long-form article generated: {len(markdown)} chars (task {task_id})"
        )
        return result

    async def _persist(self, result: LongFormResult, params: dict) -> None:
        """落 task metadata，让作品库能列出长文。失败静默——持久化失败不该中断出片。"""
        try:
            input_snapshot = dict(params)
            input_snapshot.pop("progress_callback", None)
            input_snapshot.setdefault("title", result.title)
            metadata = {
                "task_id": result.task_id,
                "created_at": datetime.now().isoformat(),
                "completed_at": datetime.now().isoformat(),
                "status": "completed",
                "input": input_snapshot,
                "result": {
                    "artifact_type": "text",
                    "article_path": result.article_path,
                    "article": result.article,
                    "title": result.title,
                    "language": result.language,
                    "word_count": result.word_count,
                },
            }
            await self.core.persistence.save_task_metadata(result.task_id, metadata)
            logger.info(f"💾 Saved long-form task metadata: {result.task_id}")
        except Exception as error:  # noqa: BLE001 - persistence must not break generation
            logger.error(f"Failed to persist long-form task data: {error}")
