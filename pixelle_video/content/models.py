"""ContentItem 数据模型与状态迁移合法表。

内容条目是内容工作台的一等公民：一个选题/标题从选题池一路走到已发布/已复盘。
多语言是条目的**变体**维度（``variants``），不是多个条目。
状态迁移只允许出现在 ``ALLOWED_TRANSITIONS`` 中的边（非法迁移由 API 返回 400）。
"""

import uuid
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

STATUSES = [
    "idea",
    "drafting",
    "draft_ready",
    "pending_review",
    "confirmed",
    "producing",
    "produced",
    "scheduled",
    "published",
    "measured",
    "archived",
]

# 状态迁移合法表：key 为当前状态，value 为允许迁移到的状态列表。
ALLOWED_TRANSITIONS: dict[str, list[str]] = {
    "idea": ["drafting", "confirmed", "archived"],
    "drafting": ["draft_ready", "idea"],
    "draft_ready": ["pending_review", "confirmed", "archived"],
    "pending_review": ["confirmed", "draft_ready", "archived"],
    "confirmed": ["producing", "archived"],
    "producing": ["produced", "confirmed"],  # 失败回 confirmed
    "produced": ["scheduled", "producing", "archived"],  # 可重出
    "scheduled": ["published", "produced"],
    "published": ["measured", "archived"],
    "measured": ["archived"],
    "archived": ["idea"],  # 复活
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def is_valid_transition(from_status: str, to_status: str) -> bool:
    return to_status in ALLOWED_TRANSITIONS.get(from_status, [])


class ContentVariant(BaseModel):
    language: str
    status: Literal["pending", "confirmed", "rejected"] = "pending"
    title: str = ""
    script: str = ""


class ContentEvent(BaseModel):
    type: str  # created / status_changed / draft_generated / confirmed / produced / scheduled / published / metrics_recorded / note
    actor: str  # "user" | "agent" | "system"
    at: str  # ISO 时间
    detail: dict = Field(default_factory=dict)


class SceneDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scene_id: str = Field(min_length=1, max_length=120)
    order: int = Field(ge=1)
    narration: str = Field(min_length=1)
    image_prompt: str = Field(min_length=1)
    duration: float | None = Field(default=None, gt=0)
    asset_id: str | None = None

    @field_validator("scene_id", "narration", "image_prompt")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value


class SceneManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    review_kind: Literal["video_scenes", "agent_image_scenes", "image_pages"] = "agent_image_scenes"
    scenes: list[SceneDraft] = Field(min_length=1)
    confirmed: bool = False
    updated_at: str = Field(default_factory=now_iso)

    @model_validator(mode="after")
    def validate_scenes(self):
        ids = [scene.scene_id for scene in self.scenes]
        orders = [scene.order for scene in self.scenes]
        if len(ids) != len(set(ids)):
            raise ValueError("scene_id values must be unique")
        if len(orders) != len(set(orders)):
            raise ValueError("scene order values must be unique")
        self.scenes.sort(key=lambda scene: scene.order)
        return self


class Publication(BaseModel):
    publication_id: str
    production_task_id: str | None = None
    platform: str
    published_at: str
    evidence_type: Literal["url", "platform_post_id", "buffer_id", "manual"]
    evidence_value: str
    actor: Literal["user", "agent", "system"]
    request_id: str


class ContentItem(BaseModel):
    item_id: str  # uuid4().hex
    project: str = "PetWoods"
    channel: str = "xiaohongshu"
    title: str  # 选题/标题
    kind: Literal["text", "asset"] = "text"
    source: Literal["manual", "agent", "derived"] = "manual"
    status: str = "idea"  # ∈ STATUSES
    languages: list[str] = Field(default_factory=lambda: ["Chinese"])
    variants: dict[str, ContentVariant] = Field(default_factory=dict)
    asset_paths: list[str] = Field(default_factory=list)
    links: dict = Field(default_factory=dict)
    # links: {"task_ids": [str], "batch_ids": [str], "publish_record_ids": [str]}
    metrics: dict = Field(default_factory=dict)
    # metrics: {"likes": int, "favorites": int, "comments": int, "note": str, "recorded_at": str}
    automation: dict = Field(default_factory=dict)  # 预留，本期不用
    scene_manifest: SceneManifest | None = None
    publications: list[Publication] = Field(default_factory=list)
    events: list[ContentEvent] = Field(default_factory=list)
    created_at: str
    updated_at: str

    def add_event(self, type: str, actor: str, detail: dict | None = None) -> None:
        self.events.append(ContentEvent(type=type, actor=actor, at=now_iso(), detail=detail or {}))


def new_content_item(
    *,
    title: str,
    kind: str = "text",
    source: str = "manual",
    status: str = "idea",
    languages: list[str] | None = None,
    project: str = "PetWoods",
    channel: str = "xiaohongshu",
    variants: dict[str, ContentVariant] | None = None,
    asset_paths: list[str] | None = None,
    links: dict | None = None,
    actor: str = "user",
) -> ContentItem:
    """Factory: build a fresh ContentItem with a `created` event."""
    timestamp = now_iso()
    item = ContentItem(
        item_id=uuid.uuid4().hex,
        title=title,
        kind=kind,
        source=source,
        status=status,
        languages=languages or ["Chinese"],
        project=project,
        channel=channel,
        variants=variants or {},
        asset_paths=asset_paths or [],
        links=links or {},
        created_at=timestamp,
        updated_at=timestamp,
    )
    item.add_event("created", actor, {"status": status})
    return item
