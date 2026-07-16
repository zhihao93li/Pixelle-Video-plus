"""Use-case helpers shared by React, batch, and Agent production entry points."""

from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from pixelle_video.content.models import ContentItem, ContentVariant, new_content_item
from pixelle_video.content.operations import request_hash
from pixelle_video.content.production_tasks import (
    ProductionTask,
    ProductionTaskConflict,
    create_production_task,
    delete_production_task,
    find_task_by_request_id,
)
from pixelle_video.content.projects import get_project
from pixelle_video.content.store import delete_item, load_item, save_item
from pixelle_video.generation import (
    GenerationRequest,
    ProductionTemplate,
    ProductionTemplateError,
    build_default_pipeline_registry,
    build_default_production_template_registry,
    detect_available_generation_capabilities,
)
from pixelle_video.generation.template_overrides import (
    TemplateOverrideError,
    validate_overrides,
)

ProductionSource = Literal["react", "agent", "batch"]
_prepare_lock = threading.RLock()


@dataclass(frozen=True)
class PreparedProduction:
    task: ProductionTask
    item: ContentItem
    template: ProductionTemplate
    generation_request: GenerationRequest | None
    created: bool


def prepare_production(
    *,
    project_id: str,
    recipe_id: str,
    input_payload: dict[str, Any],
    overrides: dict[str, Any],
    request_id: str,
    source: ProductionSource,
    actor: Literal["user", "agent"],
    pipeline_id: str | None = None,
    content_item_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> PreparedProduction:
    """Serialize the local JSON transaction so idempotent races cannot split links."""

    with _prepare_lock:
        return _prepare_production_locked(
            project_id=project_id,
            recipe_id=recipe_id,
            input_payload=input_payload,
            overrides=overrides,
            request_id=request_id,
            source=source,
            actor=actor,
            pipeline_id=pipeline_id,
            content_item_id=content_item_id,
            metadata=metadata,
        )


def _prepare_production_locked(
    *,
    project_id: str,
    recipe_id: str,
    input_payload: dict[str, Any],
    overrides: dict[str, Any],
    request_id: str,
    source: ProductionSource,
    actor: Literal["user", "agent"],
    pipeline_id: str | None = None,
    content_item_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> PreparedProduction:
    """Validate and atomically establish the ledger record and production task.

    No provider or generation engine is started here. Callers may safely stop
    on any exception without leaving an external job running.
    """

    project = get_project(project_id)
    if project is None:
        raise ValueError(f"Unknown project: {project_id}")

    templates = build_default_production_template_registry()
    template = templates.get(recipe_id)
    if pipeline_id is not None and template.pipeline_id != pipeline_id:
        raise ValueError(
            f"模板 {recipe_id!r} 属于 {template.pipeline_id!r}，不能用于 {pipeline_id!r}。"
        )
    pipeline = build_default_pipeline_registry().get_manifest(template.pipeline_id)
    declared_input_keys = {
        field.name for field in pipeline.input.required_fields + pipeline.input.optional_fields
    }
    unknown_input_keys = sorted(set(input_payload) - declared_input_keys)
    if unknown_input_keys:
        raise ValueError(
            f"Pipeline {pipeline.id!r} 不接受输入字段：{', '.join(unknown_input_keys)}。"
        )
    missing_input_keys = [
        field.name
        for field in pipeline.input.required_fields
        if input_payload.get(field.name) in (None, "", [])
    ]
    if missing_input_keys:
        raise ValueError(
            f"Pipeline {pipeline.id!r} 缺少必填输入：{', '.join(missing_input_keys)}。"
        )
    setting_keys = {key for stage in pipeline.stages for key in stage.setting_keys}
    allowed_override_keys = set(template.allowed_user_params) & setting_keys
    unknown_override_keys = sorted(set(overrides) - allowed_override_keys)
    if unknown_override_keys:
        raise ValueError(
            f"模板 {template.id!r} 不允许本次覆盖：{', '.join(unknown_override_keys)}。"
        )
    prompt_overrides = {
        key: value
        for key, value in overrides.items()
        if key in {"script_prompt", "split_prompt"} and isinstance(value, str) and value
    }
    if prompt_overrides:
        try:
            validate_overrides(
                prompt_overrides,
                allowed_user_params=list(allowed_override_keys),
            )
        except TemplateOverrideError as error:
            raise ValueError(str(error)) from error
    surface = "agent" if actor == "agent" else source
    required_surface = (
        "agent" if surface == "agent" else ("batch" if source == "batch" else "react")
    )
    if required_surface not in pipeline.launch_surfaces:
        raise ProductionTemplateError(
            f"Pipeline {pipeline.id!r} cannot be launched from {required_surface}."
        )

    payload_hash = request_hash(
        {
            "project_id": project_id,
            "content_item_id": content_item_id,
            "pipeline_id": template.pipeline_id,
            "recipe_id": recipe_id,
            "input": input_payload,
            "overrides": overrides,
            "source": source,
        }
    )
    existing = find_task_by_request_id(request_id)
    if existing is not None:
        if existing.request_hash != payload_hash:
            raise ProductionTaskConflict("request_id 已被另一份不同内容的生产请求使用。")
        item = load_item(existing.content_item_id)
        if item is None:
            raise RuntimeError("幂等生产任务存在，但关联内容台账记录缺失。")
        return PreparedProduction(
            task=existing,
            item=item,
            template=template,
            generation_request=None,
            created=False,
        )

    compiled = templates.compile_request(
        template.id,
        input={**input_payload, **overrides},
        metadata=metadata,
        idempotency_key=request_id,
        available_capabilities=detect_available_generation_capabilities(),
        surface="agent" if actor == "agent" else "public",
    )
    # Pipeline manifest owns the input contract. Recipe compilation owns only
    # defaults and per-run settings, so preserve every declared content field
    # (for example the optional title) in the executable request.
    compiled.input = {
        key: input_payload[key]
        for key in declared_input_keys
        if key in input_payload and input_payload[key] not in (None, "")
    }
    compiled.params = _snapshot_system_tts_defaults(compiled.params, setting_keys)

    item = load_item(content_item_id) if content_item_id else None
    created_item = item is None
    if content_item_id and item is None:
        raise ValueError(f"Unknown content item: {content_item_id}")
    if item is not None and item.project != project_id:
        raise ValueError("内容记录与所选项目不一致。")
    if item is None:
        item = _new_ledger_item(
            project_id=project_id,
            input_payload=input_payload,
            source=source,
            actor=actor,
            pipeline_id=pipeline.id,
        )

    first_stage = pipeline.stages[0]
    artifact_type = _artifact_type(pipeline.outputs)
    task: ProductionTask | None = None
    try:
        task, created = create_production_task(
            content_item_id=item.item_id,
            project_id=project_id,
            pipeline_id=pipeline.id,
            recipe_id=template.id,
            recipe_version=template.version,
            title=item.title,
            artifact_type=artifact_type,
            source=source,
            actor=actor,
            client_name=str((metadata or {}).get("client_name") or "") or None,
            agent_session_id=str((metadata or {}).get("agent_session_id") or "") or None,
            batch_id=str((metadata or {}).get("batch_id") or "") or None,
            stage_id=first_stage.id,
            stage_label=first_stage.name,
            next_actor=first_stage.actor,
            request_id=request_id,
            request_hash=payload_hash,
            input_snapshot=input_payload,
            effective_params=compiled.params,
        )
        links = dict(item.links)
        production_task_ids = list(links.get("production_task_ids") or [])
        if task.production_task_id not in production_task_ids:
            production_task_ids.append(task.production_task_id)
        links["production_task_ids"] = production_task_ids
        item.links = links
        save_item(item)
    except Exception:
        if task is not None:
            delete_production_task(task.production_task_id)
        if created_item:
            delete_item(item.item_id)
        raise

    compiled.metadata = {
        **compiled.metadata,
        **(metadata or {}),
        "production_task_id": task.production_task_id,
        "content_item_id": item.item_id,
        "project_id": project_id,
        "source": source,
        "production_run_id": task.production_task_id,
    }
    return PreparedProduction(
        task=task,
        item=item,
        template=template,
        generation_request=compiled,
        created=created,
    )


def _snapshot_system_tts_defaults(
    params: dict[str, Any], setting_keys: set[str]
) -> dict[str, Any]:
    """Resolve a template's system-level TTS inheritance when the task is created."""

    if "tts_inference_mode" not in setting_keys or params.get("tts_inference_mode"):
        return params

    from pixelle_video.config import config_manager

    resolved = dict(params)
    tts = config_manager.config.comfyui.tts
    resolved["tts_inference_mode"] = tts.inference_mode
    if "tts_voice" in setting_keys and not resolved.get("tts_voice"):
        if tts.inference_mode == "local":
            resolved["tts_voice"] = tts.local.voice
        elif tts.inference_mode == "fish" and tts.fish_audio.reference_id:
            resolved["tts_voice"] = tts.fish_audio.reference_id
    if "tts_speed" in setting_keys and resolved.get("tts_speed") is None:
        if tts.inference_mode == "local":
            resolved["tts_speed"] = tts.local.speed
        elif tts.inference_mode == "fish":
            resolved["tts_speed"] = tts.fish_audio.speed
    if (
        tts.inference_mode == "comfyui"
        and "tts_workflow" in setting_keys
        and not resolved.get("tts_workflow")
        and tts.comfyui.default_workflow
    ):
        resolved["tts_workflow"] = tts.comfyui.default_workflow
    return resolved


def _new_ledger_item(
    *,
    project_id: str,
    input_payload: dict[str, Any],
    source: ProductionSource,
    actor: Literal["user", "agent"],
    pipeline_id: str,
) -> ContentItem:
    title = _content_title(input_payload)
    script = str(input_payload.get("script") or "").strip()
    topic = str(input_payload.get("topic") or "").strip()
    assets = _asset_paths(input_payload)
    is_topic = pipeline_id in {"topic_to_video", "topic_to_image_post"}
    variants = (
        {
            "Chinese": ContentVariant(
                language="Chinese",
                status="confirmed",
                title=title,
                script=script,
            )
        }
        if script
        else {}
    )
    item = new_content_item(
        title=title,
        kind="asset" if assets and not (script or topic) else "text",
        source="agent" if actor == "agent" else "manual",
        status="idea" if is_topic else "producing",
        project=project_id,
        variants=variants,
        asset_paths=assets,
        actor=actor,
    )
    if title == "未命名内容":
        item.title = f"未命名内容 {item.item_id[:8]}"
    return item


def _content_title(input_payload: dict[str, Any]) -> str:
    for key in ("title", "video_title", "goods_title", "topic"):
        value = str(input_payload.get(key) or "").strip()
        if value:
            return value[:120]
    script = str(input_payload.get("script") or "").strip()
    if script:
        first_line = next((line.strip() for line in script.splitlines() if line.strip()), "")
        if first_line:
            return first_line[:120]
    assets = _asset_paths(input_payload)
    if assets:
        return Path(assets[0]).stem[:100] or "未命名素材内容"
    return "未命名内容"


def _asset_paths(input_payload: dict[str, Any]) -> list[str]:
    paths: list[str] = []
    for key in ("assets", "character_assets", "goods_assets"):
        value = input_payload.get(key)
        if isinstance(value, list):
            paths.extend(str(path) for path in value if path)
    reference_video = input_payload.get("reference_video")
    if reference_video:
        paths.append(str(reference_video))
    return paths


def _artifact_type(outputs) -> Literal["video", "image_set", "text", "audio"]:
    kinds = {output.kind for output in outputs if output.required}
    if "video" in kinds:
        return "video"
    if "image" in kinds:
        return "image_set"
    if "audio" in kinds:
        return "audio"
    return "text"
