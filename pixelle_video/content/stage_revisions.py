"""Immutable, versioned content produced at a human-review stage.

Each revision is written once and never updated.  Human approval is stored as
a separate record, so confirming content cannot silently mutate the content
that was reviewed.  The JSON implementation intentionally follows Pixelle's
other local stores: writes use a temporary file plus ``os.replace`` and tests
may provide an isolated directory.
"""

from __future__ import annotations

import json
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from pixelle_video.utils.os_util import get_data_path

STAGE_REVISIONS_DIR: Path | None = None

StageKind = Literal["script", "scene_plan", "image_pages", "agent_image_scenes"]
ConfirmationActor = Literal["user", "agent", "system"]
ConfirmationSource = Literal["react", "agent", "api", "system", "migration"]

_lock = threading.RLock()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ScriptVariant(BaseModel):
    model_config = ConfigDict(extra="forbid")

    language: str = Field(min_length=1)
    title: str = ""
    script: str = Field(min_length=1)

    @field_validator("language", "script")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value


class ScriptStagePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["script"] = "script"
    variants: dict[str, ScriptVariant] = Field(min_length=1)

    @model_validator(mode="after")
    def languages_match_keys(self):
        for key, variant in self.variants.items():
            if not key.strip():
                raise ValueError("variant language key must not be blank")
            if key != variant.language:
                raise ValueError("variant language must match its mapping key")
        return self


class StageScene(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scene_id: str = Field(min_length=1, max_length=120)
    order: int = Field(ge=1)
    narration: str = Field(min_length=1)
    image_prompt: str = ""
    duration: float | None = Field(default=None, gt=0)
    asset_id: str | None = None

    @field_validator("scene_id", "narration")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value


class _SceneStagePayloadBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scenes: list[StageScene] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_scenes(self):
        ids = [scene.scene_id for scene in self.scenes]
        orders = [scene.order for scene in self.scenes]
        if len(ids) != len(set(ids)):
            raise ValueError("scene_id values must be unique")
        if len(orders) != len(set(orders)):
            raise ValueError("scene order values must be unique")
        # Canonical ordering makes hashing, display, and downstream consumption stable.
        self.scenes.sort(key=lambda scene: scene.order)
        return self


class ScenePlanStagePayload(_SceneStagePayloadBase):
    kind: Literal["scene_plan"] = "scene_plan"


class ImagePagesStagePayload(_SceneStagePayloadBase):
    kind: Literal["image_pages"] = "image_pages"


class AgentImageScenesStagePayload(_SceneStagePayloadBase):
    kind: Literal["agent_image_scenes"] = "agent_image_scenes"


SceneStagePayload = ScenePlanStagePayload | ImagePagesStagePayload | AgentImageScenesStagePayload


StagePayload = Annotated[
    ScriptStagePayload
    | ScenePlanStagePayload
    | ImagePagesStagePayload
    | AgentImageScenesStagePayload,
    Field(discriminator="kind"),
]


class StageRevision(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    revision_id: str
    item_id: str
    production_task_id: str
    kind: StageKind
    sequence: int = Field(ge=1)
    supersedes_revision_id: str | None = None
    payload: StagePayload
    created_by: ConfirmationActor
    source: ConfirmationSource
    created_at: str

    @model_validator(mode="after")
    def kind_matches_payload(self):
        if self.kind != self.payload.kind:
            raise ValueError("revision kind must match payload kind")
        return self


class StageConfirmation(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    confirmation_id: str
    revision_id: str
    item_id: str
    production_task_id: str
    kind: StageKind
    request_id: str
    actor: ConfirmationActor
    source: ConfirmationSource
    confirmed_at: str


class StageRevisionConflict(ValueError):
    """The caller tried to create a revision from a stale predecessor."""


class ConfirmationRequestConflict(ValueError):
    """A confirmation request id was already used for another action."""


class StageRevisionAlreadyConfirmed(ValueError):
    """The revision already has a confirmation made by another request."""


class StaleStageRevision(ValueError):
    """Only the current revision of a stage can be confirmed."""


def revision_directory(directory: Path | None = None) -> Path:
    root = Path(directory or STAGE_REVISIONS_DIR or get_data_path("stage-revisions"))
    target = root / "revisions"
    target.mkdir(parents=True, exist_ok=True)
    return target


def confirmation_directory(directory: Path | None = None) -> Path:
    root = Path(directory or STAGE_REVISIONS_DIR or get_data_path("stage-revisions"))
    target = root / "confirmations"
    target.mkdir(parents=True, exist_ok=True)
    return target


def _write_new(path: Path, model: BaseModel) -> None:
    """Atomically create a record and refuse to overwrite an immutable object."""

    if path.exists():
        raise FileExistsError(path)
    temporary = path.with_suffix(f"{path.suffix}.{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_text(
            json.dumps(model.model_dump(mode="json"), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        # IDs are generated while holding ``_lock``; replace makes the visible write atomic.
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def load_revision(revision_id: str, directory: Path | None = None) -> StageRevision | None:
    path = revision_directory(directory) / f"{revision_id}.json"
    if not path.exists():
        return None
    try:
        return StageRevision.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def list_revisions(
    *,
    item_id: str | None = None,
    production_task_id: str | None = None,
    kind: StageKind | None = None,
    directory: Path | None = None,
) -> list[StageRevision]:
    revisions: list[StageRevision] = []
    for path in revision_directory(directory).glob("*.json"):
        try:
            revision = StageRevision.model_validate_json(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if item_id is not None and revision.item_id != item_id:
            continue
        if production_task_id is not None and revision.production_task_id != production_task_id:
            continue
        if kind is not None and revision.kind != kind:
            continue
        revisions.append(revision)
    revisions.sort(key=lambda revision: (revision.sequence, revision.created_at), reverse=True)
    return revisions


def get_current_revision(
    *,
    item_id: str,
    production_task_id: str,
    kind: StageKind,
    directory: Path | None = None,
) -> StageRevision | None:
    revisions = list_revisions(
        item_id=item_id,
        production_task_id=production_task_id,
        kind=kind,
        directory=directory,
    )
    return revisions[0] if revisions else None


def create_revision(
    *,
    item_id: str,
    production_task_id: str,
    kind: StageKind,
    payload: StagePayload | dict,
    created_by: ConfirmationActor,
    source: ConfirmationSource,
    supersedes_revision_id: str | None = None,
    directory: Path | None = None,
) -> StageRevision:
    if not item_id.strip() or not production_task_id.strip():
        raise ValueError("item_id and production_task_id are required")

    payload_model: StagePayload
    payload_types = {
        "script": ScriptStagePayload,
        "scene_plan": ScenePlanStagePayload,
        "image_pages": ImagePagesStagePayload,
        "agent_image_scenes": AgentImageScenesStagePayload,
    }
    payload_model = payload_types[kind].model_validate(payload)
    if payload_model.kind != kind:
        raise ValueError("revision kind must match payload kind")

    with _lock:
        current = get_current_revision(
            item_id=item_id,
            production_task_id=production_task_id,
            kind=kind,
            directory=directory,
        )
        if supersedes_revision_id is not None:
            if current is None or current.revision_id != supersedes_revision_id:
                raise StageRevisionConflict(
                    "supersedes_revision_id is not the current stage revision"
                )
        predecessor = current.revision_id if current is not None else None
        revision = StageRevision(
            revision_id=uuid.uuid4().hex,
            item_id=item_id,
            production_task_id=production_task_id,
            kind=kind,
            sequence=(current.sequence + 1) if current is not None else 1,
            supersedes_revision_id=predecessor,
            payload=payload_model,
            created_by=created_by,
            source=source,
            created_at=now_iso(),
        )
        _write_new(
            revision_directory(directory) / f"{revision.revision_id}.json",
            revision,
        )
        return revision


def load_confirmation(
    confirmation_id: str, directory: Path | None = None
) -> StageConfirmation | None:
    path = confirmation_directory(directory) / f"{confirmation_id}.json"
    if not path.exists():
        return None
    try:
        return StageConfirmation.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def list_confirmations(directory: Path | None = None) -> list[StageConfirmation]:
    confirmations: list[StageConfirmation] = []
    for path in confirmation_directory(directory).glob("*.json"):
        try:
            confirmations.append(
                StageConfirmation.model_validate_json(path.read_text(encoding="utf-8"))
            )
        except (OSError, ValueError):
            continue
    confirmations.sort(key=lambda confirmation: confirmation.confirmed_at, reverse=True)
    return confirmations


def get_revision_confirmation(
    revision_id: str, directory: Path | None = None
) -> StageConfirmation | None:
    return next(
        (
            confirmation
            for confirmation in list_confirmations(directory)
            if confirmation.revision_id == revision_id
        ),
        None,
    )


def confirm_revision(
    revision_id: str,
    *,
    request_id: str,
    actor: ConfirmationActor,
    source: ConfirmationSource,
    directory: Path | None = None,
) -> StageConfirmation:
    request_id = request_id.strip()
    if not request_id:
        raise ValueError("request_id is required")

    with _lock:
        revision = load_revision(revision_id, directory)
        if revision is None:
            raise KeyError(f"Unknown stage revision: {revision_id}")

        existing_request = next(
            (
                confirmation
                for confirmation in list_confirmations(directory)
                if confirmation.request_id == request_id
            ),
            None,
        )
        if existing_request is not None:
            if (
                existing_request.revision_id != revision_id
                or existing_request.actor != actor
                or existing_request.source != source
            ):
                raise ConfirmationRequestConflict(
                    "request_id was already used for another confirmation"
                )
            return existing_request

        existing_confirmation = get_revision_confirmation(revision_id, directory)
        if existing_confirmation is not None:
            raise StageRevisionAlreadyConfirmed(
                "stage revision was already confirmed with another request_id"
            )

        current = get_current_revision(
            item_id=revision.item_id,
            production_task_id=revision.production_task_id,
            kind=revision.kind,
            directory=directory,
        )
        if current is None or current.revision_id != revision_id:
            raise StaleStageRevision("only the current stage revision can be confirmed")

        confirmation = StageConfirmation(
            confirmation_id=uuid.uuid4().hex,
            revision_id=revision.revision_id,
            item_id=revision.item_id,
            production_task_id=revision.production_task_id,
            kind=revision.kind,
            request_id=request_id,
            actor=actor,
            source=source,
            confirmed_at=now_iso(),
        )
        _write_new(
            confirmation_directory(directory) / f"{confirmation.confirmation_id}.json",
            confirmation,
        )
        return confirmation


# Explicit aliases make the read API discoverable without coupling callers to filenames.
get_revision = load_revision
