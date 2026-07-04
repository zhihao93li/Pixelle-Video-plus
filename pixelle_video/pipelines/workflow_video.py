import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Callable

import httpx
from loguru import logger

from pixelle_video.models.progress import ProgressEvent
from pixelle_video.models.storyboard import (
    Storyboard,
    StoryboardConfig,
    StoryboardFrame,
    VideoGenerationResult,
)
from pixelle_video.pipelines.base import BasePipeline
from pixelle_video.services.provider_execution import (
    execute_workflow_with_provider_progress,
)
from pixelle_video.utils.os_util import create_task_output_dir


class WorkflowVideoPipeline(BasePipeline):
    """Shared helpers for ComfyKit/RunningHub single-result video workflows."""

    def _workflow_input(self, workflow_path: Path) -> str:
        return self._workflow_source_and_input(workflow_path)[1]

    def _workflow_source_and_input(self, workflow_path: Path) -> tuple[str, str]:
        if not workflow_path.exists():
            raise FileNotFoundError(f"Workflow file does not exist: {workflow_path}")
        workflow_config = json.loads(workflow_path.read_text(encoding="utf-8"))
        if workflow_config.get("source") == "runninghub" and workflow_config.get("workflow_id"):
            return "runninghub", str(workflow_config["workflow_id"])
        return str(workflow_config.get("source") or "selfhost"), str(workflow_path)

    async def _execute_workflow(
        self,
        workflow_path: Path,
        params: dict,
        progress_callback: Callable[[ProgressEvent], None] | None = None,
        progress: float = 0.1,
    ):
        kit = await self.core._get_or_create_comfykit()
        source, workflow_input = self._workflow_source_and_input(workflow_path)

        def provider_progress_callback(provider_detail: dict) -> None:
            detail = {
                "provider": source,
                "workflow": str(workflow_path),
                **provider_detail,
            }
            status = provider_detail.get("provider_status")
            self._report_progress(
                progress_callback,
                "execute_workflow",
                progress,
                extra_info=f"Provider task {status}" if status else None,
                detail=detail,
            )

        return await execute_workflow_with_provider_progress(
            kit,
            workflow_input,
            params,
            source=source,
            provider_progress_callback=provider_progress_callback if progress_callback else None,
        )

    async def _download_or_copy(self, source: str, destination: str) -> None:
        destination_path = Path(destination)
        destination_path.parent.mkdir(parents=True, exist_ok=True)

        if source.startswith(("http://", "https://")):
            timeout = httpx.Timeout(300.0)
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.get(source)
                response.raise_for_status()
                destination_path.write_bytes(response.content)
            return

        source_path = Path(source)
        if not source_path.exists():
            raise FileNotFoundError(f"Workflow output video not found: {source}")
        shutil.copy2(source_path, destination_path)

    def _first_video(self, workflow_result) -> str:
        videos = getattr(workflow_result, "videos", None)
        if videos:
            return str(videos[0])

        outputs = getattr(workflow_result, "outputs", None)
        if isinstance(outputs, dict):
            for node_output in outputs.values():
                if isinstance(node_output, dict) and node_output.get("videos"):
                    return str(node_output["videos"][0])

        raise ValueError("Workflow did not return a video. Check workflow configuration.")

    def _first_image(self, workflow_result) -> str:
        images = getattr(workflow_result, "images", None)
        if images:
            return str(images[0])

        outputs = getattr(workflow_result, "outputs", None)
        if isinstance(outputs, dict):
            for node_output in outputs.values():
                if isinstance(node_output, dict) and node_output.get("images"):
                    return str(node_output["images"][0])

        raise ValueError("Workflow did not return an image. Check workflow configuration.")

    def _first_text(self, workflow_result) -> str:
        texts = getattr(workflow_result, "texts", None)
        if texts:
            return str(texts[0])

        outputs = getattr(workflow_result, "outputs", None)
        if isinstance(outputs, dict):
            for node_output in outputs.values():
                if isinstance(node_output, dict) and node_output.get("texts"):
                    return str(node_output["texts"][0])

        return ""

    def _workflow_path(self, workflow_key: str) -> Path:
        workflow_path = Path("workflows") / workflow_key
        if not workflow_path.exists():
            raise FileNotFoundError(f"Workflow file does not exist: {workflow_path}")
        return workflow_path

    def _probe_video_seconds(self, video_path: str, *, max_seconds: int = 30) -> int:
        source_path = Path(video_path)
        if not source_path.exists():
            raise FileNotFoundError(f"Reference video not found: {video_path}")

        ffprobe = shutil.which("ffprobe")
        if not ffprobe:
            raise RuntimeError(
                "Cannot determine reference video duration because ffprobe is not available."
            )

        completed = subprocess.run(
            [
                ffprobe,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                str(source_path),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if completed.returncode != 0:
            raise RuntimeError(
                completed.stderr.strip()
                or f"Cannot determine reference video duration: {video_path}"
            )

        try:
            duration = float(json.loads(completed.stdout)["format"]["duration"])
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise RuntimeError(
                f"Cannot determine reference video duration: {video_path}"
            ) from exc

        if duration <= 0:
            raise RuntimeError(f"Reference video duration is invalid: {video_path}")

        return min(max(int(duration), 1), max_seconds)

    def _result(
        self,
        *,
        task_id: str,
        title: str,
        final_video_path: str,
        duration: float,
        narration: str = "",
        image_prompt: str = "",
    ) -> VideoGenerationResult:
        file_size = os.path.getsize(final_video_path) if os.path.exists(final_video_path) else 0
        storyboard = Storyboard(
            title=title,
            config=StoryboardConfig(media_width=1080, media_height=1920, task_id=task_id),
            frames=[
                StoryboardFrame(
                    index=0,
                    narration=narration,
                    image_prompt=image_prompt,
                    video_segment_path=final_video_path,
                    duration=duration,
                )
            ],
            final_video_path=final_video_path,
            total_duration=duration,
        )
        result = VideoGenerationResult(
            video_path=final_video_path,
            storyboard=storyboard,
            duration=duration,
            file_size=file_size,
        )
        return result

    async def _persist_result(
        self,
        *,
        task_id: str,
        result: VideoGenerationResult,
        input_payload: dict,
        config_payload: dict,
    ) -> None:
        if not getattr(self.core, "persistence", None):
            return
        metadata = {
            "task_id": task_id,
            "created_at": result.created_at.isoformat(),
            "completed_at": result.created_at.isoformat(),
            "status": "completed",
            "input": input_payload,
            "result": {
                "video_path": result.video_path,
                "duration": result.duration,
                "file_size": result.file_size,
                "n_frames": len(result.storyboard.frames),
            },
            "config": config_payload,
        }
        await self.core.persistence.save_task_metadata(task_id, metadata)
        await self.core.persistence.save_storyboard(task_id, result.storyboard)

    def _report(
        self,
        callback: Callable[[ProgressEvent], None] | None,
        event_type: str,
        progress: float,
        extra_info: str = "",
    ) -> None:
        self._report_progress(
            callback,
            event_type,
            progress,
            extra_info=extra_info or None,
        )


class ImageToVideoPipeline(WorkflowVideoPipeline):
    async def __call__(
        self,
        assets: list[str],
        prompt: str,
        workflow_key: str = "runninghub/i2v_LTX2.json",
        title: str = "Image to video",
        progress_callback: Callable[[ProgressEvent], None] | None = None,
        **kwargs,
    ) -> VideoGenerationResult:
        if not assets:
            raise ValueError("At least one image asset is required.")
        if not prompt:
            raise ValueError("Prompt is required.")

        task_dir, task_id = create_task_output_dir()
        final_video_path = os.path.join(task_dir, "final.mp4")
        self._report(progress_callback, "execute_workflow", 0.1, "Starting I2V workflow")

        workflow_result = await self._execute_workflow(
            self._workflow_path(workflow_key),
            {"image": assets[0], "prompt": prompt},
            progress_callback=progress_callback,
            progress=0.1,
        )
        generated_video = self._first_video(workflow_result)
        self._report(progress_callback, "download_video", 0.8, "Saving generated video")
        await self._download_or_copy(generated_video, final_video_path)
        self._report(progress_callback, "completed", 1.0)

        result = self._result(
            task_id=task_id,
            title=title,
            final_video_path=final_video_path,
            duration=float(kwargs.get("duration") or 0.0),
            narration=prompt,
            image_prompt=prompt,
        )
        await self._persist_result(
            task_id=task_id,
            result=result,
            input_payload={
                "assets": assets,
                "prompt": prompt,
                "title": title,
                "workflow_key": workflow_key,
            },
            config_payload={"pipeline": "i2v", "workflow_key": workflow_key},
        )
        logger.success(f"✅ I2V video generated: {final_video_path}")
        return result


class ActionTransferPipeline(WorkflowVideoPipeline):
    async def __call__(
        self,
        reference_video: str,
        assets: list[str],
        prompt: str,
        duration: int | float = 0,
        workflow_key: str = "runninghub/af_scail.json",
        title: str = "Action transfer",
        progress_callback: Callable[[ProgressEvent], None] | None = None,
        **kwargs,
    ) -> VideoGenerationResult:
        if not reference_video:
            raise ValueError("Reference video is required.")
        if not assets:
            raise ValueError("At least one target image asset is required.")
        if not prompt:
            raise ValueError("Prompt is required.")

        task_dir, task_id = create_task_output_dir()
        final_video_path = os.path.join(task_dir, "final.mp4")
        seconds = int(duration or 0)
        if seconds <= 0:
            seconds = self._probe_video_seconds(reference_video)
        self._report(progress_callback, "execute_workflow", 0.1, "Starting action transfer workflow")
        workflow_result = await self._execute_workflow(
            self._workflow_path(workflow_key),
            {
                "video": reference_video,
                "image": assets[0],
                "prompt": prompt,
                "second": seconds,
            },
            progress_callback=progress_callback,
            progress=0.1,
        )
        generated_video = self._first_video(workflow_result)
        self._report(progress_callback, "download_video", 0.8, "Saving generated video")
        await self._download_or_copy(generated_video, final_video_path)
        self._report(progress_callback, "completed", 1.0)

        result = self._result(
            task_id=task_id,
            title=title,
            final_video_path=final_video_path,
            duration=float(seconds),
            narration=prompt,
            image_prompt=prompt,
        )
        await self._persist_result(
            task_id=task_id,
            result=result,
            input_payload={
                "reference_video": reference_video,
                "assets": assets,
                "prompt": prompt,
                "duration": seconds,
                "workflow_key": workflow_key,
            },
            config_payload={"pipeline": "action_transfer", "workflow_key": workflow_key},
        )
        logger.success(f"✅ Action transfer video generated: {final_video_path}")
        return result


class DigitalHumanPipeline(WorkflowVideoPipeline):
    async def __call__(
        self,
        character_assets: list[str],
        script: str = "",
        mode: str = "customize",
        goods_assets: list[str] | None = None,
        goods_title: str = "",
        workflow_paths: dict | None = None,
        title: str = "Digital human",
        tts_inference_mode: str = "local",
        tts_voice: str | None = "zh-CN-YunjianNeural",
        tts_speed: float | None = 1.2,
        tts_workflow: str | None = None,
        ref_audio: str | None = None,
        progress_callback: Callable[[ProgressEvent], None] | None = None,
        **kwargs,
    ) -> VideoGenerationResult:
        if not character_assets:
            raise ValueError("At least one character image is required.")
        if not script and mode == "customize":
            raise ValueError("Script is required for customize mode.")
        if mode == "digital" and not goods_assets:
            raise ValueError("Goods image is required for digital mode.")
        if mode == "digital" and not (script or goods_title):
            raise ValueError("Goods title or script is required for digital mode.")

        workflow_paths = workflow_paths or {
            "first_workflow_path": "workflows/runninghub/digital_image.json",
            "second_workflow_path": "workflows/runninghub/digital_combination.json",
            "third_workflow_path": "workflows/runninghub/digital_customize.json",
        }
        task_dir, task_id = create_task_output_dir()
        final_video_path = os.path.join(task_dir, "final.mp4")
        audio_path = os.path.join(task_dir, "narration.mp3")

        generated_image = character_assets[0]
        generated_text = script
        if mode == "digital":
            if script.strip():
                self._report(progress_callback, "compose_image", 0.15, "Combining product and character image")
                image_result = await self._execute_workflow(
                    Path(str(workflow_paths["third_workflow_path"])),
                    {"firstimage": character_assets[0], "secondimage": (goods_assets or [])[0]},
                    progress_callback=progress_callback,
                    progress=0.15,
                )
                generated_image = self._first_image(image_result)
            else:
                self._report(progress_callback, "compose_image", 0.15, "Generating digital human image and copy")
                image_result = await self._execute_workflow(
                    Path(str(workflow_paths["first_workflow_path"])),
                    {
                        "firstimage": character_assets[0],
                        "secondimage": (goods_assets or [])[0],
                        "goodstype": goods_title,
                    },
                    progress_callback=progress_callback,
                    progress=0.15,
                )
                generated_image = self._first_image(image_result)
                generated_text = self._first_text(image_result)
                if not generated_text:
                    raise ValueError("Digital human workflow did not return generated script text.")

        self._report(progress_callback, "generate_tts", 0.45, "Generating narration audio")
        tts_kwargs = {
            "text": generated_text,
            "output_path": audio_path,
            "inference_mode": tts_inference_mode,
        }
        if tts_inference_mode == "local":
            tts_kwargs["voice"] = tts_voice
            tts_kwargs["speed"] = tts_speed
        elif tts_inference_mode == "fish":
            if tts_voice:
                tts_kwargs["reference_id"] = tts_voice
            if tts_speed is not None:
                tts_kwargs["speed"] = tts_speed
        elif tts_inference_mode == "comfyui":
            if tts_workflow:
                tts_kwargs["workflow"] = tts_workflow
            if ref_audio:
                tts_kwargs["ref_audio"] = ref_audio
        await self.core.tts(**tts_kwargs)

        self._report(progress_callback, "execute_workflow", 0.7, "Combining image and audio")
        video_result = await self._execute_workflow(
            Path(str(workflow_paths["second_workflow_path"])),
            {"videoimage": generated_image, "audio": audio_path},
            progress_callback=progress_callback,
            progress=0.7,
        )
        generated_video = self._first_video(video_result)
        self._report(progress_callback, "download_video", 0.9, "Saving generated video")
        await self._download_or_copy(generated_video, final_video_path)
        self._report(progress_callback, "completed", 1.0)

        result = self._result(
            task_id=task_id,
            title=title,
            final_video_path=final_video_path,
            duration=float(kwargs.get("duration") or 0.0),
            narration=generated_text,
            image_prompt=goods_title or script,
        )
        await self._persist_result(
            task_id=task_id,
            result=result,
            input_payload={
                "character_assets": character_assets,
                "goods_assets": goods_assets or [],
                "goods_title": goods_title,
                "script": script,
                "mode": mode,
            },
            config_payload={
                "pipeline": "digital_human",
                "workflow_paths": workflow_paths,
                "tts_inference_mode": tts_inference_mode,
            },
        )
        logger.success(f"✅ Digital human video generated: {final_video_path}")
        return result
