from collections.abc import Callable

from pixelle_video.generation import GenerationRequest, GenerationService, GenerationTask
from pixelle_video.generation.registry import PipelineRegistry

VIDEO_PARAM_KEYS = (
    "title",
    "n_scenes",
    "split_mode",
    "media_workflow",
    "frame_template",
    "prompt_prefix",
    "image_prompt_visual_context",
    "image_prompt_generation_rules",
    "bgm_path",
    "bgm_volume",
    "media_width",
    "media_height",
    "tts_inference_mode",
    "tts_voice",
    "tts_speed",
    "tts_workflow",
    "ref_audio",
    "template_params",
)


def default_entry_for_video_params(video_params: dict) -> str:
    return "topic" if video_params.get("mode", "generate") == "generate" else "script"


def build_generation_request_from_video_params(
    *,
    pipeline_registry: PipelineRegistry,
    video_params: dict,
    pipeline_id: str = "standard",
    entry_id: str | None = None,
) -> GenerationRequest:
    entry = entry_id or default_entry_for_video_params(video_params)
    try:
        manifest = pipeline_registry.get_manifest(pipeline_id)
        manifest.entry(entry)
    except KeyError as exc:
        raise ValueError(str(exc)) from None

    text = video_params.get("text") or ""
    if entry == "topic":
        input_payload = {"topic": text}
    elif entry == "script":
        input_payload = {"script": text}
    elif entry == "assets":
        input_payload = {"assets": video_params.get("assets", [])}
    else:
        input_payload = {entry: video_params.get(entry)}

    params = {
        key: video_params.get(key)
        for key in VIDEO_PARAM_KEYS
        if video_params.get(key) is not None
    }

    return GenerationRequest(
        pipeline_id=pipeline_id,
        entry=entry,
        input=input_payload,
        params=params,
        metadata={"source_ui": "streamlit_output_preview"},
    )


async def submit_video_params_as_generation_task(
    *,
    pixelle_video,
    video_params: dict,
    pipeline_id: str = "standard",
    entry_id: str | None = None,
    progress_callback: Callable[[GenerationTask], None] | None = None,
    generation_service: GenerationService | None = None,
) -> GenerationTask:
    service = generation_service or GenerationService(
        pipeline_registry=pixelle_video.pipeline_registry,
    )
    request = build_generation_request_from_video_params(
        pipeline_registry=pixelle_video.pipeline_registry,
        video_params=video_params,
        pipeline_id=pipeline_id,
        entry_id=entry_id,
    )
    task = service.submit(request, progress_callback=progress_callback)
    return await service.wait_for_task(task.task_id)
