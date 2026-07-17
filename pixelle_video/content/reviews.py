"""Canonical read model for the content item currently waiting for approval.

The persisted source of truth remains ``ContentItem``.  This module exposes one
explicit, versioned review session so every client edits and confirms the same
object instead of inferring the active step from several loosely related
fields.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from pixelle_video.content.models import ContentItem, ContentVariant, SceneDraft, SceneManifest
from pixelle_video.content.production_tasks import latest_task_for_content
from pixelle_video.content.stage_revisions import (
    StageRevision,
    create_revision,
    get_current_revision,
)

ReviewKind = Literal["script", "video_scenes", "agent_image_scenes", "image_pages"]
ReviewAction = Literal[
    "direct_edit",
    "rewrite_script",
    "regenerate_all",
    "confirm",
]


class ScriptReviewPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["script"] = "script"
    variants: dict[str, ContentVariant]


class SceneReviewPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["video_scenes", "agent_image_scenes", "image_pages"]
    scene_manifest: SceneManifest


ReviewPayload = Annotated[
    ScriptReviewPayload | SceneReviewPayload,
    Field(discriminator="kind"),
]


class ReviewReference(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    variants: dict[str, ContentVariant]


class PendingReviewSession(BaseModel):
    model_config = ConfigDict(extra="forbid")

    review_id: str
    item_id: str
    version: str
    payload: ReviewPayload
    reference: ReviewReference | None = None
    allowed_actions: list[ReviewAction]


def _stage_kind(item: ContentItem) -> str:
    if item.scene_manifest is None:
        return "script"
    return {
        "video_scenes": "scene_plan",
        "image_pages": "image_pages",
        "agent_image_scenes": "agent_image_scenes",
    }[item.scene_manifest.review_kind]


def _review_task_id(item: ContentItem) -> str:
    task = latest_task_for_content(item.item_id)
    return task.production_task_id if task is not None else f"legacy:{item.item_id}"


def _revision_payload(item: ContentItem) -> dict:
    if item.scene_manifest is None:
        return {
            "kind": "script",
            "variants": {
                language: {
                    "language": language,
                    "title": variant.title,
                    "script": variant.script,
                }
                for language, variant in item.variants.items()
                if variant.script.strip()
            },
        }
    kind = _stage_kind(item)
    return {
        "kind": kind,
        "scenes": [
            {
                "scene_id": scene.scene_id,
                "order": scene.order,
                "narration": scene.narration,
                "image_prompt": scene.image_prompt,
                "duration": scene.duration,
                "asset_id": scene.asset_id,
            }
            for scene in item.scene_manifest.scenes
        ],
    }


def create_item_stage_revision(
    item: ContentItem,
    *,
    created_by: str,
    source: str,
    supersedes_revision_id: str | None = None,
) -> StageRevision:
    """Persist the one immutable payload represented by the current review station."""

    actor = created_by if created_by in {"user", "agent", "system"} else "system"
    normalized_source = source if source in {"react", "agent", "api", "system", "migration"} else "api"
    return create_revision(
        item_id=item.item_id,
        production_task_id=_review_task_id(item),
        kind=_stage_kind(item),
        payload=_revision_payload(item),
        created_by=actor,
        source=normalized_source,
        supersedes_revision_id=supersedes_revision_id,
    )


def _current_or_migrate_revision(item: ContentItem) -> StageRevision:
    kind = _stage_kind(item)
    task_id = _review_task_id(item)
    revision = get_current_revision(
        item_id=item.item_id,
        production_task_id=task_id,
        kind=kind,
    )
    if revision is not None:
        return revision
    return create_item_stage_revision(
        item,
        created_by="system",
        source="migration",
    )


def apply_revision_to_item(item: ContentItem, revision: StageRevision) -> ContentItem:
    """Refresh the mutable ledger projection from the immutable stage payload."""

    if revision.payload.kind == "script":
        item.scene_manifest = None
        item.variants = {
            language: ContentVariant(
                language=language,
                status="pending",
                title=variant.title,
                script=variant.script,
            )
            for language, variant in revision.payload.variants.items()
        }
        return item
    review_kind = {
        "scene_plan": "video_scenes",
        "image_pages": "image_pages",
        "agent_image_scenes": "agent_image_scenes",
    }[revision.payload.kind]
    item.scene_manifest = SceneManifest(
        review_kind=review_kind,
        scenes=[SceneDraft.model_validate(scene.model_dump()) for scene in revision.payload.scenes],
        confirmed=False,
    )
    return item


class PendingReviewResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item: ContentItem
    review: PendingReviewSession | None


def build_pending_review(item: ContentItem) -> PendingReviewSession | None:
    """Project the single current approval station from canonical item state."""

    if item.status not in {"draft_ready", "pending_review"}:
        return None

    revision = _current_or_migrate_revision(item)
    if revision.payload.kind == "script":
        kind: ReviewKind = "script"
        payload: ReviewPayload = ScriptReviewPayload(
            variants={
                language: ContentVariant(
                    language=language,
                    status="pending",
                    title=variant.title,
                    script=variant.script,
                )
                for language, variant in revision.payload.variants.items()
            }
        )
        reference = None
        allowed_actions: list[ReviewAction] = [
            "direct_edit",
            "rewrite_script",
            "confirm",
        ]
    else:
        kind = {
            "scene_plan": "video_scenes",
            "image_pages": "image_pages",
            "agent_image_scenes": "agent_image_scenes",
        }[revision.payload.kind]
        payload = SceneReviewPayload(
            kind=kind,
            scene_manifest=SceneManifest(
                review_kind=kind,
                scenes=[
                    SceneDraft.model_validate(scene.model_dump())
                    for scene in revision.payload.scenes
                ],
                confirmed=False,
                updated_at=revision.created_at,
            ),
        )
        reference = ReviewReference(
            title=item.title,
            variants={
                language: variant.model_copy(deep=True)
                for language, variant in item.variants.items()
            },
        )
        allowed_actions = [
            "direct_edit",
            "regenerate_all",
            "confirm",
        ]

    return PendingReviewSession(
        review_id=revision.revision_id,
        item_id=item.item_id,
        version=f"v{revision.sequence}",
        payload=payload,
        reference=reference,
        allowed_actions=allowed_actions,
    )


def validate_review_session(
    item: ContentItem,
    *,
    review_id: str,
    version: str,
) -> PendingReviewSession:
    """Return the current session or reject a stale/wrong approval target."""

    session = build_pending_review(item)
    if session is None:
        raise ValueError("当前没有待确认内容。")
    if review_id != session.review_id:
        raise ValueError("待确认对象已经变更，请重新读取后再操作。")
    if version != session.version:
        raise ValueError("待确认内容已经更新，请重新读取后再操作。")
    return session
