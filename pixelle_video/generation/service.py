import asyncio
import os
import uuid
from datetime import datetime
from typing import Callable

from pixelle_video.generation.registry import PipelineRegistry
from pixelle_video.generation.schemas import (
    EntryId,
    GenerationArtifact,
    GenerationError,
    GenerationProgress,
    GenerationRequest,
    GenerationResult,
    GenerationTask,
)
from pixelle_video.models.progress import ProgressEvent


class GenerationService:
    def __init__(
        self,
        pipeline_registry: PipelineRegistry,
        task_id_factory: Callable[[], str] | None = None,
    ):
        self.pipeline_registry = pipeline_registry
        self._task_id_factory = task_id_factory or (lambda: str(uuid.uuid4()))
        self._tasks: dict[str, GenerationTask] = {}
        self._futures: dict[str, asyncio.Task] = {}
        self._idempotency_index: dict[str, str] = {}

    def submit(self, request: GenerationRequest) -> GenerationTask:
        if request.idempotency_key and request.idempotency_key in self._idempotency_index:
            return self.get_task(self._idempotency_index[request.idempotency_key])

        self._validate_request(request)

        task_id = self._task_id_factory()
        entry_spec = self.pipeline_registry.get_manifest(request.pipeline_id).entry(request.entry)
        task = GenerationTask(
            task_id=task_id,
            pipeline_id=request.pipeline_id,
            entry=request.entry,
            request=request,
            progress=GenerationProgress(stage=entry_spec.start_stage, percentage=0.0),
        )
        self._tasks[task_id] = task

        if request.idempotency_key:
            self._idempotency_index[request.idempotency_key] = task_id

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
        if task.status in {"completed", "failed", "cancelled"}:
            return task

        future = self._futures.get(task_id)
        if future and not future.done():
            future.cancel()

        task.status = "cancelled"
        task.updated_at = datetime.now()
        return task

    async def shutdown(self) -> None:
        for future in self._futures.values():
            if not future.done():
                future.cancel()
        if self._futures:
            await asyncio.gather(*self._futures.values(), return_exceptions=True)

    def _validate_request(self, request: GenerationRequest) -> None:
        try:
            manifest = self.pipeline_registry.get_manifest(request.pipeline_id)
        except KeyError:
            raise ValueError(f"Unknown pipeline: {request.pipeline_id}") from None

        try:
            entry = manifest.entry(request.entry)
        except KeyError:
            raise ValueError(
                f"Pipeline {request.pipeline_id!r} does not support entry {request.entry!r}"
            ) from None

        missing = [
            field.name for field in entry.required_fields if field.name not in request.input
        ]
        if missing:
            fields = ", ".join(missing)
            raise ValueError(
                f"Generation request for pipeline {request.pipeline_id!r} entry "
                f"{request.entry!r} is missing required field(s): {fields}"
            )

        if self.pipeline_registry.get_pipeline(request.pipeline_id) is None:
            raise ValueError(f"Pipeline {request.pipeline_id!r} has no executable instance")

    async def _run_task(self, task_id: str) -> None:
        task = self.get_task(task_id)
        task.status = "running"
        task.updated_at = datetime.now()

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

        except asyncio.CancelledError:
            task.status = "cancelled"
            task.updated_at = datetime.now()
        except Exception as exc:
            task.status = "failed"
            task.error = self._to_generation_error(exc)
            task.updated_at = datetime.now()

    def _build_pipeline_kwargs(self, request: GenerationRequest) -> dict:
        params = dict(request.params)

        if request.entry == "topic":
            return {
                "text": request.input["topic"],
                "mode": params.pop("mode", "generate"),
                **params,
            }

        if request.entry == "script":
            kwargs = {
                "text": request.input["script"],
                **params,
            }
            if request.pipeline_id == "standard":
                kwargs.setdefault("mode", "fixed")
            return kwargs

        if request.entry == "assets":
            return {
                **request.input,
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

        task.progress = GenerationProgress(
            stage=event.event_type,
            percentage=round(event.progress * 100, 2),
            message=event.extra_info or event.event_type,
            current=event.frame_current,
            total=event.frame_total,
            detail=detail,
        )
        task.updated_at = datetime.now()

    def _to_generation_result(self, task: GenerationTask, pipeline_result) -> GenerationResult:
        video_path = self._get_result_value(pipeline_result, "video_path")
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

        return GenerationResult(
            task_id=task.task_id,
            pipeline_id=task.pipeline_id,
            entry=task.entry,
            artifacts=[primary_video],
            primary_video=primary_video,
            duration=self._get_result_value(pipeline_result, "duration"),
            file_size=file_size,
            metadata={
                "source_result_type": type(pipeline_result).__name__,
                **task.request.metadata,
            },
        )

    def _to_generation_error(self, exc: Exception) -> GenerationError:
        return GenerationError(
            layer="runtime",
            message=str(exc),
            exception_type=type(exc).__name__,
        )

    def _get_result_value(self, pipeline_result, field: str):
        if isinstance(pipeline_result, dict):
            return pipeline_result.get(field)
        return getattr(pipeline_result, field, None)


def generation_request_from_legacy_video_request(request_body) -> GenerationRequest:
    entry: EntryId = "topic" if request_body.mode == "generate" else "script"
    input_payload = (
        {"topic": request_body.text}
        if entry == "topic"
        else {"script": request_body.text}
    )

    params = {
        "title": request_body.title,
        "n_scenes": request_body.n_scenes,
        "min_narration_words": request_body.min_narration_words,
        "max_narration_words": request_body.max_narration_words,
        "min_image_prompt_words": request_body.min_image_prompt_words,
        "max_image_prompt_words": request_body.max_image_prompt_words,
        "media_workflow": request_body.media_workflow,
        "video_fps": request_body.video_fps,
        "frame_template": request_body.frame_template,
        "template_params": request_body.template_params,
        "prompt_prefix": request_body.prompt_prefix,
        "image_prompt_visual_context": request_body.image_prompt_visual_context,
        "image_prompt_generation_rules": request_body.image_prompt_generation_rules,
        "bgm_path": request_body.bgm_path,
        "bgm_volume": request_body.bgm_volume,
        "split_mode": request_body.split_mode,
    }

    if request_body.frame_template:
        from pixelle_video.services.frame_html import HTMLFrameGenerator
        from pixelle_video.utils.template_util import resolve_template_path

        template_path = resolve_template_path(request_body.frame_template)
        media_width, media_height = HTMLFrameGenerator(template_path).get_media_size()
        params["media_width"] = media_width
        params["media_height"] = media_height

    optional_params = {
        "tts_inference_mode": request_body.tts_inference_mode,
        "tts_speed": request_body.tts_speed,
        "tts_workflow": request_body.tts_workflow,
        "ref_audio": request_body.ref_audio,
        "voice_id": request_body.voice_id,
    }
    params.update({key: value for key, value in optional_params.items() if value is not None})
    params = {key: value for key, value in params.items() if value is not None}

    return GenerationRequest(
        pipeline_id="standard",
        entry=entry,
        input=input_payload,
        params=params,
        metadata={"source_api": "video.generate.async"},
    )
