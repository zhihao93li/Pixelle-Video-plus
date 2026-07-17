import asyncio
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Callable

from pixelle_video.generation.quality import build_asset_manifest, run_quality_review
from pixelle_video.generation.registry import PipelineRegistry
from pixelle_video.generation.schemas import (
    GenerationArtifact,
    GenerationError,
    GenerationProgress,
    GenerationRequest,
    GenerationResult,
    GenerationTask,
)
from pixelle_video.generation.task_store import (
    load_generation_tasks,
    save_generation_task,
)
from pixelle_video.models.progress import ProgressEvent


class GenerationService:
    def __init__(
        self,
        pipeline_registry: PipelineRegistry,
        task_id_factory: Callable[[], str] | None = None,
        storage_dir: Path | None = None,
        surface: str = "public",
    ):
        self.pipeline_registry = pipeline_registry
        self._task_id_factory = task_id_factory or (lambda: str(uuid.uuid4()))
        self._tasks: dict[str, GenerationTask] = {}
        self._futures: dict[str, asyncio.Task] = {}
        self._idempotency_index: dict[str, str] = {}
        self._progress_callbacks: dict[str, Callable[[GenerationTask], None]] = {}
        self._storage_dir = storage_dir
        self._surface = surface
        self._shutting_down = False
        self._restore_tasks()

    def submit(
        self,
        request: GenerationRequest,
        progress_callback: Callable[[GenerationTask], None] | None = None,
        *,
        surface: str | None = None,
    ) -> GenerationTask:
        if request.idempotency_key and request.idempotency_key in self._idempotency_index:
            return self.get_task(self._idempotency_index[request.idempotency_key])

        self._validate_request(request, surface=surface)

        task_id = self._task_id_factory()
        manifest = self.pipeline_registry.get_manifest(request.pipeline_id)
        task = GenerationTask(
            task_id=task_id,
            pipeline_id=request.pipeline_id,
            request=request,
            progress=GenerationProgress(stage=manifest.stages[0].id, percentage=0.0),
        )
        self._tasks[task_id] = task
        self._persist_task(task)

        if request.idempotency_key:
            self._idempotency_index[request.idempotency_key] = task_id
        if progress_callback:
            self._progress_callbacks[task_id] = progress_callback

        self._futures[task_id] = asyncio.create_task(self._run_task(task_id))
        return task

    def get_task(self, task_id: str) -> GenerationTask:
        try:
            return self._tasks[task_id]
        except KeyError:
            raise KeyError(f"Unknown generation task: {task_id}") from None

    def get_result(self, task_id: str) -> GenerationResult:
        task = self.get_task(task_id)
        if task.result is None:
            raise ValueError(f"Generation task {task_id} has no completed result")
        return task.result

    async def wait_for_task(self, task_id: str) -> GenerationTask:
        future = self._futures.get(task_id)
        if future:
            await future
        return self.get_task(task_id)

    def cancel_task(self, task_id: str) -> GenerationTask:
        task = self.get_task(task_id)
        if task.status in {"completed", "failed", "cancelled", "interrupted"}:
            return task

        future = self._futures.get(task_id)
        if future and not future.done():
            future.cancel()

        task.status = "cancelled"
        task.updated_at = datetime.now()
        self._notify_progress(task)
        return task

    async def shutdown(self) -> None:
        self._shutting_down = True
        for task_id, future in self._futures.items():
            if not future.done():
                task = self.get_task(task_id)
                self._set_interrupted(
                    task,
                    message="生成服务停止，任务未能继续执行。",
                    exception_type="GenerationServiceShutdown",
                )
                self._notify_progress(task)
                future.cancel()
        if self._futures:
            await asyncio.gather(*self._futures.values(), return_exceptions=True)

    def _validate_request(self, request: GenerationRequest, *, surface: str | None = None) -> None:
        try:
            manifest = self.pipeline_registry.get_manifest(request.pipeline_id)
        except KeyError:
            raise ValueError(f"Unknown pipeline: {request.pipeline_id}") from None

        effective_surface = surface or self._surface
        if manifest.access_scope == "agent" and effective_surface != "agent":
            raise ValueError(f"Pipeline {request.pipeline_id!r} is only available through an Agent")

        missing = [
            field.name
            for field in manifest.input.required_fields
            if field.name not in request.input or request.input[field.name] in (None, "", [])
        ]
        if missing:
            fields = ", ".join(missing)
            raise ValueError(
                f"Generation request for pipeline {request.pipeline_id!r} "
                f"is missing required field(s): {fields}"
            )

        if self.pipeline_registry.get_pipeline(request.pipeline_id) is None:
            raise ValueError(f"Pipeline {request.pipeline_id!r} has no executable instance")

    async def _run_task(self, task_id: str) -> None:
        task = self.get_task(task_id)
        task.status = "running"
        task.updated_at = datetime.now()
        self._notify_progress(task)

        try:
            pipeline = self.pipeline_registry.get_pipeline(task.pipeline_id)
            kwargs = self._build_pipeline_kwargs(task.request)
            kwargs["progress_callback"] = lambda event: self._update_progress(task, event)

            pipeline_result = await pipeline(**kwargs)
            task.result = self._to_generation_result(task, pipeline_result)
            task.status = "completed"
            if task.progress.percentage < 100.0:
                task.progress = GenerationProgress(stage="completed", percentage=100.0)
            task.updated_at = datetime.now()
            self._notify_progress(task)

        except asyncio.CancelledError:
            if self._shutting_down:
                self._set_interrupted(
                    task,
                    message="生成服务停止，任务未能继续执行。",
                    exception_type="GenerationServiceShutdown",
                )
            else:
                task.status = "cancelled"
                task.updated_at = datetime.now()
            self._notify_progress(task)
        except Exception as exc:
            task.status = "failed"
            task.error = self._to_generation_error(exc)
            task.updated_at = datetime.now()
            self._notify_progress(task)

    def _build_pipeline_kwargs(self, request: GenerationRequest) -> dict:
        params = dict(request.params)
        # Route selection is structural; runtime params cannot override it.
        params.pop("mode", None)

        if request.pipeline_id == "topic_to_video":
            confirmed_script = request.input.get("script")
            if not isinstance(confirmed_script, str) or not confirmed_script.strip():
                raise ValueError(
                    "topic_to_video must complete writing and human confirmation before production"
                )
            kwargs = {
                "text": confirmed_script,
                **params,
                "_split_language": request.metadata.get("language") or "Chinese",
                "_split_topic": request.input["topic"],
            }
            if request.input.get("scenes"):
                kwargs["_confirmed_scenes"] = request.input["scenes"]
            return kwargs

        if request.pipeline_id == "topic_to_image_post":
            confirmed_script = request.input.get("script")
            if not isinstance(confirmed_script, str) or not confirmed_script.strip():
                raise ValueError(
                    "topic_to_image_post must complete writing and human confirmation before production"
                )
            page_text = request.input.get("pages")
            text = (
                "\n".join(str(page).strip() for page in page_text if str(page).strip())
                if isinstance(page_text, list)
                else confirmed_script
            )
            return {"text": text, **params}

        if request.pipeline_id == "image_post":
            pages = request.input.get("pages")
            text = (
                "\n".join(str(page).strip() for page in pages if str(page).strip())
                if isinstance(pages, list) and pages
                else request.input["script"]
            )
            return {"text": text, **params}

        if request.pipeline_id == "script_to_video":
            kwargs = {
                "text": request.input["script"],
                **params,
                **(
                    {
                        "_split_language": request.metadata.get("language") or "Chinese",
                        "_split_topic": request.metadata.get("topic") or "",
                    }
                    if request.pipeline_id == "script_to_video"
                    else {}
                ),
            }
            if request.input.get("scenes"):
                kwargs["_confirmed_scenes"] = request.input["scenes"]
            return kwargs

        if request.pipeline_id == "topic_to_long_form":
            return {
                "text": request.input["topic"],
                **({"title": request.input["title"]} if request.input.get("title") else {}),
                **params,
            }

        if request.pipeline_id == "long_form":
            return {
                "text": request.input["script"],
                **({"title": request.input["title"]} if request.input.get("title") else {}),
                **(
                    {"language": request.input["language"]} if request.input.get("language") else {}
                ),
                **params,
            }

        return {
            **request.input,
            **params,
        }

    def _update_progress(self, task: GenerationTask, event: ProgressEvent) -> None:
        detail = {}
        for key in ("action", "step", "extra_info"):
            value = getattr(event, key)
            if value is not None:
                detail[key] = value
        detail.update(event.detail)

        task.progress = GenerationProgress(
            stage=event.event_type,
            percentage=round(event.progress * 100, 2),
            message=event.extra_info or event.event_type,
            current=event.frame_current,
            total=event.frame_total,
            detail=detail,
        )
        task.updated_at = datetime.now()
        self._notify_progress(task)

    def _notify_progress(self, task: GenerationTask) -> None:
        self._persist_task(task)
        if task.request.metadata.get("production_task_id"):
            from pixelle_video.content.production_tasks import sync_generation_task

            manifest = self.pipeline_registry.get_manifest(task.pipeline_id)
            sync_generation_task(task, manifest)
        callback = self._progress_callbacks.get(task.task_id)
        if callback:
            callback(task)

    def _persist_task(self, task: GenerationTask) -> None:
        if self._storage_dir is not None:
            save_generation_task(task, self._storage_dir)

    def _restore_tasks(self) -> None:
        if self._storage_dir is None:
            return
        for task in load_generation_tasks(self._storage_dir):
            if task.status in {"pending", "running"}:
                self._set_interrupted(
                    task,
                    message="生成服务重启，任务未能继续执行。",
                    exception_type="GenerationServiceRestart",
                )
                save_generation_task(task, self._storage_dir)
            self._tasks[task.task_id] = task
            if task.request.idempotency_key:
                self._idempotency_index[task.request.idempotency_key] = task.task_id

    @staticmethod
    def _set_interrupted(
        task: GenerationTask,
        *,
        message: str,
        exception_type: str,
    ) -> None:
        task.status = "interrupted"
        task.progress = GenerationProgress(
            stage="interrupted",
            percentage=task.progress.percentage,
            message=message,
            current=task.progress.current,
            total=task.progress.total,
            detail=task.progress.detail,
        )
        task.error = GenerationError(
            layer="runtime",
            message=message,
            exception_type=exception_type,
        )
        task.updated_at = datetime.now()

    def _to_generation_result(self, task: GenerationTask, pipeline_result) -> GenerationResult:
        artifact_type = self._get_result_value(pipeline_result, "artifact_type")
        if artifact_type == "image_set":
            return self._to_image_set_result(task, pipeline_result)
        if artifact_type == "text":
            return self._to_text_result(task, pipeline_result)
        return self._to_video_result(task, pipeline_result)

    def _to_text_result(self, task: GenerationTask, pipeline_result) -> GenerationResult:
        article = self._get_result_value(pipeline_result, "article") or ""
        if not article.strip():
            raise ValueError("Long-form pipeline completed without any article text")
        article_path = self._get_result_value(pipeline_result, "article_path")
        title = self._get_result_value(pipeline_result, "title") or ""
        language = self._get_result_value(pipeline_result, "language")
        word_count = self._get_result_value(pipeline_result, "word_count")
        if word_count is None:
            word_count = len(article)

        artifact = GenerationArtifact(
            kind="metadata",
            path=article_path or "",
            media_type="text/markdown",
            role="article",
            metadata={"word_count": word_count, "language": language},
        )
        file_size = None
        if article_path and os.path.exists(article_path):
            file_size = os.path.getsize(article_path)

        return GenerationResult(
            task_id=task.task_id,
            pipeline_id=task.pipeline_id,
            artifact_type="text",
            artifacts=[artifact],
            primary_video=None,
            file_size=file_size,
            metadata={
                "source_result_type": type(pipeline_result).__name__,
                "artifact_type": "text",
                # 全文承载字段（与 image_set 存 caption 同一机制：读取端从 metadata 取）
                "article": article,
                "title": title,
                "language": language,
                "word_count": word_count,
                **task.request.metadata,
            },
        )

    def _to_image_set_result(self, task: GenerationTask, pipeline_result) -> GenerationResult:
        image_paths = self._get_result_value(pipeline_result, "image_paths") or []
        if not image_paths:
            raise ValueError("Image-post pipeline completed without any images")
        cover_path = self._get_result_value(pipeline_result, "cover_path")
        caption = self._get_result_value(pipeline_result, "caption") or ""

        artifacts: list[GenerationArtifact] = []
        total_size = 0
        for index, path in enumerate(image_paths):
            is_cover = path == cover_path if cover_path else index == 0
            if os.path.exists(path):
                total_size += os.path.getsize(path)
            artifacts.append(
                GenerationArtifact(
                    kind="image",
                    path=path,
                    media_type="image/png",
                    role="cover" if is_cover else "page",
                    metadata={"index": index, "is_cover": is_cover},
                )
            )

        page_count = self._get_result_value(pipeline_result, "page_count")
        return GenerationResult(
            task_id=task.task_id,
            pipeline_id=task.pipeline_id,
            artifact_type="image_set",
            artifacts=artifacts,
            primary_video=None,
            file_size=total_size or None,
            metadata={
                "source_result_type": type(pipeline_result).__name__,
                "artifact_type": "image_set",
                "caption": caption,
                "page_count": page_count if page_count is not None else len(artifacts),
                **task.request.metadata,
            },
        )

    def _to_video_result(self, task: GenerationTask, pipeline_result) -> GenerationResult:
        video_path = self._get_result_value(
            pipeline_result, "video_path"
        ) or self._get_result_value(pipeline_result, "final_video_path")
        if not video_path:
            raise ValueError("Pipeline completed without a video_path")

        file_size = self._get_result_value(pipeline_result, "file_size")
        if file_size is None and os.path.exists(video_path):
            file_size = os.path.getsize(video_path)

        primary_video = GenerationArtifact(
            kind="video",
            path=video_path,
            media_type="video/mp4",
            role="primary_video",
        )
        duration = self._get_result_value(pipeline_result, "duration")
        storyboard = self._get_result_value(pipeline_result, "storyboard")
        title = self._get_result_value(pipeline_result, "title") or getattr(storyboard, "title", "")
        storyboard_path = self._get_result_value(pipeline_result, "storyboard_path")
        if not storyboard_path:
            persisted_storyboard = Path(video_path).parent / "storyboard.json"
            if persisted_storyboard.is_file():
                storyboard_path = str(persisted_storyboard)
        compose_runtime = task.request.params.get("compose_runtime", "html_ffmpeg")
        quality_profile = task.request.params.get("quality_profile", "basic")
        asset_manifest = build_asset_manifest(
            video_path=video_path,
            storyboard=storyboard,
            bgm_path=task.request.params.get("bgm_path"),
        )
        quality_review = run_quality_review(
            video_path,
            expected_duration=duration,
            quality_profile=quality_profile,
            allow_silent=bool(task.request.params.get("allow_silent", False)),
        )

        return GenerationResult(
            task_id=task.task_id,
            pipeline_id=task.pipeline_id,
            artifacts=[primary_video],
            primary_video=primary_video,
            duration=duration,
            file_size=file_size,
            storyboard_path=storyboard_path,
            metadata={
                "source_result_type": type(pipeline_result).__name__,
                "title": title,
                "asset_manifest": asset_manifest,
                "quality_review": quality_review,
                "compose_runtime": compose_runtime,
                "quality_profile": quality_profile,
                **task.request.metadata,
            },
        )

    def _to_generation_error(self, exc: Exception) -> GenerationError:
        from pixelle_video.services.image_providers import ImageProviderError

        if isinstance(exc, ImageProviderError):
            layer_map = {
                "config": "config",
                "credentials": "credentials",
                "permissions": "permissions",
                "network": "network",
                "api_contract": "api_contract",
                "validation": "input",
                "download": "network",
                "provider_runtime": "runtime",
            }
            return GenerationError(
                layer=layer_map.get(exc.layer, "runtime"),
                message=str(exc),
                exception_type=type(exc).__name__,
                detail={
                    "provider": exc.provider,
                    "code": exc.code,
                    "request_id": exc.request_id,
                    "retryable": exc.retryable,
                },
            )
        if isinstance(exc, (KeyError, TypeError, ValueError)):
            return GenerationError(
                layer="input",
                message=str(exc),
                exception_type=type(exc).__name__,
            )
        return GenerationError(
            layer="runtime",
            message=str(exc),
            exception_type=type(exc).__name__,
        )

    def _get_result_value(self, pipeline_result, field: str):
        if isinstance(pipeline_result, dict):
            return pipeline_result.get(field)
        return getattr(pipeline_result, field, None)
