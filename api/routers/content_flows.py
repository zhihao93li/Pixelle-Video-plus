"""Use-case API shared by the React console and trusted Agent clients."""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator, model_validator

from api.dependencies import GenerationServiceDep, PixelleVideoDep
from api.security import (
    RequestIdentity,
    get_request_identity,
    reject_agent_confirmation,
    require_agent,
)
from pixelle_video.content.models import (
    ContentItem,
    ContentVariant,
    Publication,
    SceneDraft,
    SceneManifest,
    new_content_item,
    now_iso,
)
from pixelle_video.content.operations import (
    ContentFlowOperation,
    begin_operation,
    complete_operation,
    fail_operation,
    load_operation,
    request_hash,
    save_operation,
)
from pixelle_video.content.projects import get_default_project, get_project
from pixelle_video.content.store import load_item, save_item
from pixelle_video.generation import (
    ProductionTemplateError,
    build_default_production_template_registry,
    detect_available_generation_capabilities,
)
from pixelle_video.generation.agent_images import (
    AgentImageError,
    resolve_agent_image_path,
    save_agent_image,
)
from pixelle_video.utils.os_util import get_data_path

router = APIRouter(prefix="/content-items", tags=["Content Flows"])
IdentityDep = Annotated[RequestIdentity, Depends(get_request_identity)]


class TraceRequest(BaseModel):
    request_id: str = Field(min_length=1, max_length=200)
    client_name: str | None = Field(default=None, max_length=120)
    agent_session_id: str | None = Field(default=None, max_length=200)
    source: str | None = Field(default=None, max_length=120)


class TopicsRequest(TraceRequest):
    titles: list[str] = Field(min_length=1, max_length=50)
    project_id: str | None = None
    languages: list[str] | None = None
    content_source: Literal["manual", "derived"] = "manual"


class DraftRequest(TraceRequest):
    template_id: str | None = None


class ConfirmRequest(TraceRequest):
    variants: dict[str, ContentVariant] | None = None


class SceneManifestRequest(TraceRequest):
    scenes: list[SceneDraft] = Field(min_length=1, max_length=20)
    overwrite_draft: bool = False

    @model_validator(mode="after")
    def reject_prebound_assets(self):
        if any(scene.asset_id for scene in self.scenes):
            raise ValueError("scene manifest is text-only; upload images after user confirmation")
        return self


class SceneImageInput(BaseModel):
    scene_id: str = Field(min_length=1, max_length=120)
    image_data_url: str = Field(min_length=1)
    replace: bool = False


class SceneImagesRequest(TraceRequest):
    images: list[SceneImageInput] = Field(min_length=1, max_length=20)


class ProduceRequest(TraceRequest):
    recipe_id: str | None = None
    language: str | None = None
    overrides: dict[str, Any] = Field(default_factory=dict)


class MarkPublishedRequest(TraceRequest):
    platform: str = Field(min_length=1)
    published_at: str = Field(min_length=1)
    publish_url: str | None = None
    platform_post_id: str | None = None
    buffer_id: str | None = None
    manual_evidence: str | None = None

    @field_validator("platform")
    @classmethod
    def validate_platform(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("platform must not be blank")
        return value

    @field_validator("published_at")
    @classmethod
    def validate_published_at(cls, value: str) -> str:
        try:
            datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("published_at must be an ISO-8601 timestamp") from exc
        return value


class MetricsRequest(TraceRequest):
    likes: int | None = Field(default=None, ge=0)
    favorites: int | None = Field(default=None, ge=0)
    comments: int | None = Field(default=None, ge=0)
    note: str | None = None
    publication_id: str | None = None
    mock: bool = False
    mock_label: str | None = None

    @model_validator(mode="after")
    def require_observation(self):
        if all(
            value is None or (isinstance(value, str) and not value.strip())
            for value in (self.likes, self.favorites, self.comments, self.note)
        ):
            raise ValueError("at least one metric or note is required")
        return self


def _trace(request: TraceRequest) -> dict[str, Any]:
    return {
        key: value
        for key, value in {
            "client_name": request.client_name,
            "agent_session_id": request.agent_session_id,
            "request_id": request.request_id,
            "source": request.source,
        }.items()
        if value not in (None, "")
    }


def _item_or_404(item_id: str) -> ContentItem:
    item = load_item(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail=f"未找到内容条目：{item_id}")
    return item


def _begin(
    request: TraceRequest, *, operation: str, item: ContentItem, payload: dict[str, Any]
) -> tuple[ContentFlowOperation, bool]:
    try:
        return begin_operation(
            request_id=request.request_id,
            payload_hash=request_hash(payload),
            operation=operation,
            item_id=item.item_id,
            prior_status=item.status,
        )
    except FileExistsError:
        raise HTTPException(
            status_code=409, detail="request_id 已被另一份不同内容的请求使用。"
        ) from None
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None


def _existing_result(operation: ContentFlowOperation) -> dict[str, Any]:
    return {
        "operation_id": operation.operation_id,
        "status": operation.status,
        "result": operation.result,
        "error": operation.error,
        "idempotent": True,
    }


@router.post("/topics", response_model=list[ContentItem])
async def add_topics(request: TopicsRequest, identity: IdentityDep):
    titles = [title.strip() for title in request.titles if title.strip()]
    if not titles:
        raise HTTPException(status_code=400, detail="至少需要一个标题。")
    project_id = request.project_id
    if not project_id:
        project = get_default_project()
        project_id = project.project_id if project else "PetWoods"
    elif get_project(project_id) is None:
        raise HTTPException(status_code=404, detail=f"未找到项目：{project_id}")

    synthetic = ContentItem(
        item_id=f"topics:{request.request_id}",
        title="topics",
        project=project_id,
        created_at=now_iso(),
        updated_at=now_iso(),
    )
    operation, created = _begin(
        request,
        operation="topics",
        item=synthetic,
        payload=request.model_dump(mode="json"),
    )
    if not created and operation.result:
        return [
            item
            for item_id in operation.result.get("item_ids", [])
            if (item := load_item(item_id)) is not None
        ]
    if not created:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "这次选题请求已经处理过，且没有可重复返回的结果。",
                "operation_id": operation.operation_id,
                "status": operation.status,
            },
        )

    items: list[ContentItem] = []
    for title in titles:
        item = new_content_item(
            title=title,
            source="agent" if identity.is_agent else request.content_source,
            project=project_id,
            languages=request.languages or ["Chinese"],
            actor=identity.actor,
        )
        item.events[-1].detail.update(_trace(request))
        save_item(item)
        items.append(item)
    complete_operation(operation, {"item_ids": [item.item_id for item in items]})
    return items


@router.post("/{item_id}/draft", status_code=status.HTTP_202_ACCEPTED)
async def draft_item(
    item_id: str,
    request: DraftRequest,
    background_tasks: BackgroundTasks,
    pixelle_video: PixelleVideoDep,
    identity: IdentityDep,
):
    item = _item_or_404(item_id)
    operation, created = _begin(
        request,
        operation="draft",
        item=item,
        payload={"item_id": item_id, **request.model_dump(mode="json")},
    )
    if not created:
        return _existing_result(operation)
    if item.status != "idea":
        fail_operation(operation, f"只有 idea 状态可以起草，当前为 {item.status}。", layer="input")
        raise HTTPException(status_code=400, detail="只有选题池中的内容可以开始起草。")

    item.status = "drafting"
    item.updated_at = now_iso()
    item.add_event(
        "status_changed",
        identity.actor,
        {"from": "idea", "to": "drafting", **_trace(request)},
    )
    save_item(item)
    background_tasks.add_task(
        _run_draft,
        operation.operation_id,
        item_id,
        request,
        identity.actor,
        pixelle_video,
    )
    return {"operation_id": operation.operation_id, "status": operation.status}


async def _run_draft(
    operation_id: str,
    item_id: str,
    request: DraftRequest,
    actor: str,
    pixelle_video,
) -> None:
    from api.routers.generation import (
        ScriptReviewDraftCreateRequest,
        create_script_review_draft_set,
    )

    operation = load_operation(operation_id)
    item = load_item(item_id)
    if operation is None or item is None:
        return
    try:
        draft_set = await create_script_review_draft_set(
            ScriptReviewDraftCreateRequest(
                topics=[item.title],
                languages=item.languages,
                template_id=request.template_id,
                project_id=item.project,
                metadata={"content_item_id": item.item_id, **_trace(request)},
                idempotency_key=operation.request_id,
            ),
            pixelle_video,
        )
        draft_set = (
            draft_set.model_dump(mode="json")
            if hasattr(draft_set, "model_dump")
            else dict(draft_set)
        )
        operation.draft_set_id = draft_set["draft_set_id"]
        operation.phase = "external_completed"
        save_operation(operation)
        draft = next(
            (entry for entry in draft_set.get("drafts", []) if entry.get("topic") == item.title),
            None,
        )
        if not draft or not draft.get("language_drafts"):
            error = next(iter(draft_set.get("errors") or []), {})
            raise RuntimeError(error.get("message") or "草稿生成没有返回可审核内容。")
        variants: dict[str, ContentVariant] = {}
        for language, payload in draft["language_drafts"].items():
            variants[language] = ContentVariant(
                language=language,
                status="pending",
                title=payload.get("title") or item.title,
                script=payload.get("script") or "",
                narrations=list(payload.get("narrations") or []),
            )
        item = _item_or_404(item_id)
        item.variants = variants
        item.links = {
            **item.links,
            "draft_set_id": draft_set["draft_set_id"],
            "draft_index": draft.get("index", 1),
        }
        item.status = "pending_review"
        item.updated_at = now_iso()
        item.add_event(
            "draft_generated",
            actor,
            {"draft_set_id": draft_set["draft_set_id"], **_trace(request)},
        )
        save_item(item)
        operation.phase = "item_updated"
        save_operation(operation)
        complete_operation(operation, {"item_id": item.item_id, "status": item.status})
    except Exception as exc:  # noqa: BLE001 - persisted failure is the API contract
        item = load_item(item_id)
        if item is not None and item.status == "drafting":
            item.status = "idea"
            item.updated_at = now_iso()
            item.add_event(
                "status_changed",
                "system",
                {"from": "drafting", "to": "idea", "reason": str(exc)},
            )
            save_item(item)
        fail_operation(operation, str(exc))


@router.post("/{item_id}/confirm", response_model=ContentItem)
async def confirm_item(item_id: str, request: ConfirmRequest, identity: IdentityDep):
    reject_agent_confirmation(identity)
    item = _item_or_404(item_id)
    operation, created = _begin(
        request,
        operation="confirm",
        item=item,
        payload={"item_id": item_id, **request.model_dump(mode="json")},
    )
    if not created:
        existing = load_item(item_id)
        return existing or item
    if item.status not in {"draft_ready", "pending_review"}:
        fail_operation(operation, f"当前状态 {item.status} 不允许确认。", layer="input")
        raise HTTPException(status_code=400, detail="当前内容不在待确认状态。")
    if not item.variants:
        fail_operation(operation, "没有可确认的内容变体。", layer="input")
        raise HTTPException(status_code=400, detail="没有可确认的内容变体。")
    if request.variants is not None:
        item.variants = {
            language: variant.model_copy(update={"language": language})
            for language, variant in request.variants.items()
        }
        if not item.variants:
            fail_operation(operation, "没有可确认的内容变体。", layer="input")
            raise HTTPException(status_code=400, detail="没有可确认的内容变体。")
    for variant in item.variants.values():
        if variant.script.strip():
            variant.status = "confirmed"
    if not any(variant.status == "confirmed" for variant in item.variants.values()):
        fail_operation(operation, "确认内容不能为空。", layer="input")
        raise HTTPException(status_code=400, detail="确认内容不能为空。")
    _sync_legacy_draft_set(item)
    if item.scene_manifest:
        item.scene_manifest.confirmed = True
        item.scene_manifest.updated_at = now_iso()
    previous = item.status
    item.status = "confirmed"
    item.updated_at = now_iso()
    item.add_event("confirmed", "user", {"from": previous, "to": "confirmed", **_trace(request)})
    save_item(item)
    complete_operation(operation, {"item_id": item.item_id, "status": item.status})
    return item


@router.put("/{item_id}/scene-manifest", response_model=ContentItem)
async def submit_scene_manifest(item_id: str, request: SceneManifestRequest, identity: IdentityDep):
    require_agent(identity)
    item = _item_or_404(item_id)
    operation, created = _begin(
        request,
        operation="scene_manifest",
        item=item,
        payload={"item_id": item_id, **request.model_dump(mode="json")},
    )
    if not created:
        return _item_or_404(item_id)
    if item.status == "drafting":
        fail_operation(operation, "条目正在起草。", layer="input")
        raise HTTPException(status_code=409, detail="条目正在起草，请等待起草结束。")
    if item.status not in {"idea", "draft_ready", "pending_review"}:
        fail_operation(operation, "分镜文案已经锁定或当前状态不可编辑。", layer="input")
        raise HTTPException(status_code=400, detail="分镜文案已经锁定或当前状态不可编辑。")

    scenes = sorted(request.scenes, key=lambda scene: scene.order)
    narrations = [scene.narration for scene in scenes]
    existing_narrations = [
        narration
        for variant in item.variants.values()
        for narration in variant.narrations
        if narration.strip()
    ]
    if existing_narrations and existing_narrations != narrations and not request.overwrite_draft:
        fail_operation(operation, "已有草稿与分镜文案不一致。", layer="input")
        raise HTTPException(
            status_code=409,
            detail="已有草稿与分镜文案不一致；确认覆盖时请传 overwrite_draft=true。",
        )
    language = item.languages[0] if item.languages else "Chinese"
    item.languages = [language, *[lang for lang in item.languages if lang != language]]
    item.variants[language] = ContentVariant(
        language=language,
        status="pending",
        title=item.title,
        script="\n".join(narrations),
        narrations=narrations,
    )
    item.scene_manifest = SceneManifest(scenes=scenes, confirmed=False)
    previous = item.status
    item.status = "pending_review"
    item.updated_at = now_iso()
    item.add_event(
        "draft_generated",
        identity.actor,
        {"from": previous, "to": "pending_review", "scene_count": len(scenes), **_trace(request)},
    )
    save_item(item)
    operation.phase = "item_updated"
    save_operation(operation)
    complete_operation(operation, {"item_id": item.item_id, "status": item.status})
    return item


@router.post("/{item_id}/scene-images")
async def upload_scene_images(item_id: str, request: SceneImagesRequest, identity: IdentityDep):
    require_agent(identity)
    item = _item_or_404(item_id)
    operation, created = _begin(
        request,
        operation="scene_images",
        item=item,
        payload={"item_id": item_id, **request.model_dump(mode="json")},
    )
    if not created:
        return _existing_result(operation)
    if item.status == "producing":
        fail_operation(operation, "生产进行中不能替换分镜图片。", layer="input")
        raise HTTPException(status_code=409, detail="生产进行中不能替换分镜图片。")
    if item.status not in {"confirmed", "produced"}:
        fail_operation(operation, "当前状态不允许上传分镜图片。", layer="input")
        raise HTTPException(status_code=400, detail="只有确认后或重新生产前可以上传分镜图片。")
    if not item.scene_manifest or not item.scene_manifest.confirmed:
        fail_operation(operation, "分镜尚未由用户确认。", layer="input")
        raise HTTPException(status_code=400, detail="请先由用户确认完整分镜。")
    scene_by_id = {scene.scene_id: scene for scene in item.scene_manifest.scenes}
    requested_ids = [image.scene_id for image in request.images]
    unknown_ids = [scene_id for scene_id in requested_ids if scene_id not in scene_by_id]
    if unknown_ids:
        fail_operation(
            operation,
            f"未知分镜 scene_id：{', '.join(dict.fromkeys(unknown_ids))}",
            layer="input",
        )
        raise HTTPException(
            status_code=400,
            detail={"message": "包含未知分镜。", "unknown_scene_ids": unknown_ids},
        )
    if len(requested_ids) != len(set(requested_ids)):
        fail_operation(operation, "同一请求不能重复上传同一分镜。", layer="input")
        raise HTTPException(status_code=400, detail="同一请求不能重复上传同一分镜。")
    results: list[dict[str, Any]] = []
    try:
        for image in request.images:
            scene = scene_by_id[image.scene_id]
            result = save_agent_image(
                experiment_id=item.item_id,
                scene_id=scene.scene_id,
                prompt=scene.image_prompt,
                source={"kind": "agent", "confirmed_by_user": True, **_trace(request)},
                image_data_url=image.image_data_url,
                replace=image.replace,
            )
            scene.asset_id = result["asset_id"]
            results.append({key: value for key, value in result.items() if key != "path"})
    except AgentImageError as exc:
        fail_operation(operation, str(exc), layer="input")
        raise HTTPException(status_code=400, detail=str(exc)) from None
    item.scene_manifest.updated_at = now_iso()
    item.updated_at = now_iso()
    item.add_event(
        "note",
        identity.actor,
        {
            "changed": ["scene_images"],
            "scene_ids": [r["scene_id"] for r in results],
            **_trace(request),
        },
    )
    save_item(item)
    complete_operation(operation, {"item_id": item.item_id, "images": results})
    return {"operation_id": operation.operation_id, "images": results, "item": item}


@router.get("/{item_id}/scene-images/{scene_id}")
async def get_scene_image(item_id: str, scene_id: str):
    item = _item_or_404(item_id)
    if not item.scene_manifest:
        raise HTTPException(status_code=404, detail="这条内容没有分镜清单。")
    scene = next(
        (candidate for candidate in item.scene_manifest.scenes if candidate.scene_id == scene_id),
        None,
    )
    if scene is None or not scene.asset_id:
        raise HTTPException(status_code=404, detail="这个分镜还没有图片。")
    try:
        path = resolve_agent_image_path(
            experiment_id=item.item_id, scene_id=scene.scene_id, asset_id=scene.asset_id
        )
    except AgentImageError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None
    suffix = Path(path).suffix.lower()
    media_type = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
    }.get(suffix)
    return FileResponse(path, media_type=media_type)


@router.post("/{item_id}/produce")
async def produce_item(
    item_id: str,
    request: ProduceRequest,
    identity: IdentityDep,
    generation_service: GenerationServiceDep,
):
    item = _item_or_404(item_id)
    operation, created = _begin(
        request,
        operation="produce",
        item=item,
        payload={"item_id": item_id, **request.model_dump(mode="json")},
    )
    if not created:
        return _existing_result(operation)
    if item.status not in {"confirmed", "produced"}:
        fail_operation(operation, "请先在控制台确认内容。", layer="input")
        raise HTTPException(status_code=400, detail="请先在控制台确认内容。")

    project = get_project(item.project)
    template_id = (
        request.recipe_id
        or (project.default_production_template_id if project else None)
        or build_default_production_template_registry().default_template_id(
            project="PetWoods", channel="xiaohongshu"
        )
    )
    registry = build_default_production_template_registry()
    try:
        template = registry.get(template_id)
    except ProductionTemplateError as exc:
        fail_operation(operation, str(exc), layer="input")
        raise HTTPException(status_code=400, detail=str(exc)) from None
    if template.access_scope == "agent":
        if not identity.is_agent:
            fail_operation(operation, "Agent 配方需要有效的 Agent Token。", layer="permissions")
            require_agent(identity)
    if template.entry not in {"script", "scenes"}:
        fail_operation(
            operation,
            "这个配方需要专用素材输入，首批内容用例接口不能安全构造。",
            layer="product_assumption",
        )
        raise HTTPException(
            status_code=400,
            detail="这个配方需要专用素材输入，请从 React 快速生成发起。",
        )

    submissions: list[tuple[str, dict[str, Any]]] = []
    if template.entry == "scenes":
        manifest = item.scene_manifest
        if not manifest or not manifest.confirmed:
            fail_operation(operation, "分镜尚未确认。", layer="input")
            raise HTTPException(status_code=400, detail="分镜尚未确认。")
        missing = [scene.scene_id for scene in manifest.scenes if not scene.asset_id]
        if missing:
            fail_operation(operation, f"缺少分镜图片：{', '.join(missing)}", layer="input")
            raise HTTPException(
                status_code=400,
                detail={"message": "分镜图片不完整。", "missing_scene_ids": missing},
            )
        try:
            scenes = [
                {
                    "scene_id": scene.scene_id,
                    "narration": scene.narration,
                    "image_prompt": scene.image_prompt,
                    "image_path": resolve_agent_image_path(
                        experiment_id=item.item_id,
                        scene_id=scene.scene_id,
                        asset_id=scene.asset_id or "",
                    ),
                    **({"duration": scene.duration} if scene.duration is not None else {}),
                }
                for scene in manifest.scenes
            ]
        except AgentImageError as exc:
            fail_operation(operation, str(exc), layer="persistence")
            raise HTTPException(status_code=400, detail=str(exc)) from None
        submissions.append(
            (request.language or item.languages[0], {"scenes": scenes, "title": item.title})
        )
    else:
        for language, variant in item.variants.items():
            if request.language and language != request.language:
                continue
            if variant.status != "confirmed" or not variant.script.strip():
                continue
            narrations = [line.strip() for line in variant.narrations if line.strip()]
            input_payload: dict[str, Any] = {
                "script": "\n".join(narrations) if narrations else variant.script,
                "title": variant.title or item.title,
            }
            if narrations:
                input_payload["split_mode"] = "line"
            submissions.append((language, input_payload))
    if not submissions:
        fail_operation(operation, "没有可生产的已确认内容。", layer="input")
        raise HTTPException(status_code=400, detail="没有可生产的已确认内容。")

    batch_id = uuid.uuid4().hex
    batch_items: list[dict[str, Any]] = []
    try:
        for index, (language, input_payload) in enumerate(submissions, start=1):
            metadata = {
                "content_item_id": item.item_id,
                "project_id": item.project,
                "source": "agent_content_flow" if identity.is_agent else "react_content_flow",
                "language": language,
                "batch_id": batch_id,
                "batch_index": index,
                **_trace(request),
            }
            generation_request = registry.compile_request(
                template.id,
                input={**input_payload, **request.overrides},
                metadata=metadata,
                idempotency_key=f"{request.request_id}:{index}",
                available_capabilities=detect_available_generation_capabilities(),
                surface="agent" if identity.is_agent else "public",
            )
            task = generation_service.submit(
                generation_request,
                surface="agent" if identity.is_agent else "public",
            )
            operation.task_ids.append(task.task_id)
            operation.batch_id = batch_id
            operation.phase = "task_created"
            save_operation(operation)
            batch_items.append(
                {
                    "index": index,
                    "input": input_payload,
                    "metadata": metadata,
                    "task_id": task.task_id,
                    "status": task.status,
                    "progress": task.progress.model_dump(mode="json"),
                    "error": None,
                }
            )
    except (ProductionTemplateError, ValueError) as exc:
        if not operation.task_ids:
            fail_operation(operation, str(exc), layer="input")
            raise HTTPException(status_code=400, detail=str(exc)) from None
        _persist_partial_production(
            item=item,
            operation=operation,
            template_id=template.id,
            batch_id=batch_id,
            batch_items=batch_items,
            request=request,
            identity=identity,
            error=str(exc),
        )
        raise HTTPException(
            status_code=502,
            detail="部分生产任务已提交并保留；其余任务提交失败，请查看操作记录。",
        ) from None
    except Exception as exc:  # noqa: BLE001 - checkpoint partial external work first
        if operation.task_ids:
            _persist_partial_production(
                item=item,
                operation=operation,
                template_id=template.id,
                batch_id=batch_id,
                batch_items=batch_items,
                request=request,
                identity=identity,
                error=str(exc),
            )
        else:
            fail_operation(operation, str(exc))
        raise HTTPException(
            status_code=502,
            detail="生产任务提交失败，请查看本机 API 日志和操作记录。",
        ) from None

    _save_batch(
        {
            "batch_id": batch_id,
            "template_id": template.id,
            "status": "submitted",
            "created_at": now_iso(),
            "updated_at": now_iso(),
            "metadata": {"content_item_id": item.item_id, **_trace(request)},
            "items": batch_items,
            "total_count": len(batch_items),
            "submitted_count": len(batch_items),
            "failed_count": 0,
        }
    )
    _link_item_production(
        item=item,
        operation=operation,
        batch_id=batch_id,
        request=request,
        identity=identity,
    )
    operation.phase = "linked"
    save_operation(operation)
    result = {"item_id": item.item_id, "batch_id": batch_id, "task_ids": operation.task_ids}
    complete_operation(operation, result)
    return {"operation_id": operation.operation_id, **result}


@router.post("/{item_id}/mark-published", response_model=ContentItem)
async def mark_published(item_id: str, request: MarkPublishedRequest, identity: IdentityDep):
    item = _item_or_404(item_id)
    operation, created = _begin(
        request,
        operation="mark_published",
        item=item,
        payload={"item_id": item_id, **request.model_dump(mode="json")},
    )
    if not created:
        return _item_or_404(item_id)
    if item.status not in {"produced", "scheduled", "published", "measured"}:
        fail_operation(operation, "只有已生产内容可以标记发布。", layer="input")
        raise HTTPException(status_code=400, detail="只有已生产内容可以标记发布。")
    evidence = next(
        (
            (kind, value.strip())
            for kind, value in (
                ("url", request.publish_url),
                ("platform_post_id", request.platform_post_id),
                ("buffer_id", request.buffer_id),
                ("manual", request.manual_evidence),
            )
            if value and value.strip()
        ),
        None,
    )
    if not evidence:
        fail_operation(operation, "至少需要一项发布证据。", layer="input")
        raise HTTPException(
            status_code=400, detail="至少需要 URL、平台 ID、Buffer ID 或人工备注之一。"
        )
    publication = Publication(
        publication_id=uuid.uuid4().hex,
        platform=request.platform.strip(),
        published_at=request.published_at,
        evidence_type=evidence[0],
        evidence_value=evidence[1],
        actor=identity.actor,
        request_id=request.request_id,
    )
    previous = item.status
    if item.status in {"produced", "scheduled"}:
        item.status = "published"
    item.publications.append(publication)
    item.updated_at = now_iso()
    item.add_event(
        "published",
        identity.actor,
        {
            "from": previous,
            "to": item.status,
            "publication_id": publication.publication_id,
            **_trace(request),
        },
    )
    save_item(item)
    complete_operation(operation, {"publication_id": publication.publication_id})
    return item


@router.post("/{item_id}/metrics", response_model=ContentItem)
async def record_metrics(item_id: str, request: MetricsRequest, identity: IdentityDep):
    item = _item_or_404(item_id)
    operation, created = _begin(
        request,
        operation="metrics",
        item=item,
        payload={"item_id": item_id, **request.model_dump(mode="json")},
    )
    if not created:
        return _item_or_404(item_id)
    values = {
        key: value
        for key, value in {
            "likes": request.likes,
            "favorites": request.favorites,
            "comments": request.comments,
            "note": request.note,
            "publication_id": request.publication_id,
            "recorded_at": now_iso(),
        }.items()
        if value is not None
    }
    if request.mock:
        if not request.mock_label:
            fail_operation(operation, "mock 指标必须带 mock_label。", layer="input")
            raise HTTPException(status_code=400, detail="mock 指标必须带 mock_label。")
        item.automation.setdefault("mock_metrics", []).append(
            {**values, "mock_label": request.mock_label, **_trace(request)}
        )
    else:
        if item.status not in {"published", "measured"}:
            fail_operation(operation, "正式指标只能写入已发布内容。", layer="input")
            raise HTTPException(status_code=400, detail="正式指标只能写入已发布内容。")
        if len(item.publications) > 1 and not request.publication_id:
            fail_operation(operation, "多平台内容必须指定 publication_id。", layer="input")
            raise HTTPException(status_code=400, detail="多平台内容必须指定 publication_id。")
        if request.publication_id and request.publication_id not in {
            publication.publication_id for publication in item.publications
        }:
            fail_operation(operation, "publication_id 不属于这条内容。", layer="input")
            raise HTTPException(status_code=400, detail="publication_id 不属于这条内容。")
        item.metrics = {**item.metrics, **values}
        item.status = "measured"
    item.updated_at = now_iso()
    item.add_event(
        "metrics_recorded" if not request.mock else "note",
        identity.actor,
        {"mock": request.mock, **_trace(request)},
    )
    save_item(item)
    complete_operation(operation, {"item_id": item.item_id, "status": item.status})
    return item


def _save_batch(batch: dict[str, Any]) -> None:
    directory = Path(get_data_path("generation-batches"))
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{batch['batch_id']}.json"
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(batch, ensure_ascii=False, indent=2) + "\n", "utf-8")
    os.replace(temporary, path)


def _link_item_production(
    *,
    item: ContentItem,
    operation: ContentFlowOperation,
    batch_id: str,
    request: ProduceRequest,
    identity: RequestIdentity,
) -> None:
    prior_status = item.status
    item.status = "producing"
    item.links["task_ids"] = list(
        dict.fromkeys([*(item.links.get("task_ids") or []), *operation.task_ids])
    )
    item.links["batch_ids"] = list(dict.fromkeys([*(item.links.get("batch_ids") or []), batch_id]))
    item.automation["production_prior_status"] = prior_status
    item.automation.pop("production_failure", None)
    item.updated_at = now_iso()
    item.add_event(
        "status_changed",
        identity.actor,
        {
            "from": prior_status,
            "to": "producing",
            "task_ids": operation.task_ids,
            **_trace(request),
        },
    )
    save_item(item)


def _persist_partial_production(
    *,
    item: ContentItem,
    operation: ContentFlowOperation,
    template_id: str,
    batch_id: str,
    batch_items: list[dict[str, Any]],
    request: ProduceRequest,
    identity: RequestIdentity,
    error: str,
) -> None:
    _save_batch(
        {
            "batch_id": batch_id,
            "template_id": template_id,
            "status": "partially_submitted",
            "created_at": operation.created_at,
            "updated_at": now_iso(),
            "metadata": {"content_item_id": item.item_id, **_trace(request)},
            "items": batch_items,
            "total_count": len(batch_items),
            "submitted_count": len(batch_items),
            "failed_count": 1,
            "error": {"message": error},
        }
    )
    _link_item_production(
        item=item,
        operation=operation,
        batch_id=batch_id,
        request=request,
        identity=identity,
    )
    item.automation["production_submission_incomplete"] = {
        "message": error,
        "task_ids": list(operation.task_ids),
    }
    save_item(item)
    operation.phase = "linked"
    fail_operation(operation, error)


def _sync_legacy_draft_set(item: ContentItem) -> None:
    """Keep the old review artifact readable while ContentItem stays canonical."""

    draft_set_id = item.links.get("draft_set_id")
    draft_index = item.links.get("draft_index")
    if not draft_set_id or draft_index is None:
        return
    from api.routers.generation import (
        _load_script_review_draft_set,
        _save_script_review_draft_set,
    )

    draft_set = _load_script_review_draft_set(str(draft_set_id))
    if draft_set is None:
        return
    for draft in draft_set.get("drafts", []):
        if draft.get("index") != draft_index:
            continue
        draft["language_drafts"] = {
            language: {
                "title": variant.title,
                "script": variant.script,
                "narrations": variant.narrations,
            }
            for language, variant in item.variants.items()
        }
        break
    draft_set["status"] = "reviewed"
    draft_set["updated_at"] = now_iso()
    _save_script_review_draft_set(draft_set)
