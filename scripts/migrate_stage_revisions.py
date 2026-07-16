#!/usr/bin/env python3
"""Migrate legacy inline review content to immutable stage revisions.

The command is deliberately dry-run by default.  It reads the raw JSON stores
instead of the application repositories because legacy ``narrations`` fields
are intentionally absent from the current Pydantic models.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# Allow ``python scripts/migrate_stage_revisions.py`` from any working directory.
REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))

from pixelle_video.content.models import SceneManifest  # noqa: E402
from pixelle_video.content.stage_revisions import (  # noqa: E402
    AgentImageScenesStagePayload,
    ImagePagesStagePayload,
    ScenePlanStagePayload,
    ScriptStagePayload,
    StageConfirmation,
    StageRevision,
)
from pixelle_video.generation.defaults import build_default_pipeline_manifests  # noqa: E402

FINAL_CONTENT_STATUSES = {
    "confirmed",
    "producing",
    "produced",
    "scheduled",
    "published",
    "measured",
    "archived",
}
SCENE_CONFIRMED_TASK_STATES = {"in_progress", "produced"}
MIGRATION_NAMESPACE = uuid.UUID("46dba37d-54df-4f63-a031-b0d769ac6558")


@dataclass(frozen=True)
class PlannedWrite:
    path: Path
    payload: dict[str, Any]
    description: str
    allow_update: bool = False


@dataclass
class MigrationReport:
    apply_requested: bool
    scanned_items: int = 0
    scanned_tasks: int = 0
    writes: list[PlannedWrite] = field(default_factory=list)
    unchanged: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    conflicts: list[str] = field(default_factory=list)
    applied_writes: int = 0

    @property
    def ok(self) -> bool:
        return not self.conflicts

    def summary(self) -> str:
        mode = "APPLY" if self.apply_requested else "DRY-RUN"
        lines = [
            f"[{mode}] scanned {self.scanned_items} content items and "
            f"{self.scanned_tasks} production tasks",
            f"planned writes: {len(self.writes)}; conflicts: {len(self.conflicts)}; "
            f"applied writes: {self.applied_writes}",
        ]
        lines.extend(f"NOTE: {message}" for message in self.notes)
        lines.extend(f"CONFLICT: {message}" for message in self.conflicts)
        if self.apply_requested and self.conflicts:
            lines.append("No files were changed because conflicts must be resolved first.")
        elif not self.apply_requested and self.writes:
            lines.append("No files were changed. Re-run with --apply after reviewing this report.")
        return "\n".join(lines)


def _read_json(path: Path, report: MigrationReport) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        report.conflicts.append(f"{path}: cannot read JSON ({exc})")
        return None
    if not isinstance(value, dict):
        report.conflicts.append(f"{path}: root JSON value must be an object")
        return None
    return value


def _canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _stable_id(prefix: str, *parts: str) -> str:
    material = "\x1f".join((prefix, *parts))
    return uuid.uuid5(MIGRATION_NAMESPACE, material).hex


def _atomic_write(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _load_directory(directory: Path, report: MigrationReport) -> dict[str, dict[str, Any]]:
    records: dict[str, dict[str, Any]] = {}
    if not directory.exists():
        return records
    for path in sorted(directory.glob("*.json")):
        record = _read_json(path, report)
        if record is not None:
            records[path.name] = record
    return records


def _pipeline_review_kind(task: dict[str, Any]) -> str | None:
    pipeline_id = task.get("pipeline_id")
    if not isinstance(pipeline_id, str) or not pipeline_id:
        return None
    manifests = {manifest.id: manifest for manifest in build_default_pipeline_manifests()}
    manifest = manifests.get(pipeline_id)
    if manifest is None:
        return None
    if manifest.category == "image_post" and task.get("artifact_type") == "image_set":
        return "image_pages"
    if task.get("artifact_type") == "video" and any(
        output.kind == "video" and output.required for output in manifest.outputs
    ):
        return "video_scenes"
    return None


def _extract_script_payload(
    item: dict[str, Any], item_path: Path, report: MigrationReport
) -> dict[str, Any] | None:
    variants = item.get("variants")
    if not isinstance(variants, dict):
        report.conflicts.append(f"{item_path}: variants must be an object")
        return None
    migrated: dict[str, Any] = {}
    for language, variant in variants.items():
        if not isinstance(language, str) or not language.strip() or not isinstance(variant, dict):
            report.conflicts.append(f"{item_path}: invalid variant entry {language!r}")
            continue
        script = variant.get("script")
        if not isinstance(script, str) or not script.strip():
            continue
        migrated[language] = {
            "language": str(variant.get("language") or language),
            "title": str(variant.get("title") or ""),
            "script": script,
        }
    if not migrated:
        return None
    try:
        return ScriptStagePayload(variants=migrated).model_dump(mode="json")
    except ValueError as exc:
        report.conflicts.append(f"{item_path}: invalid script payload ({exc})")
        return None


def _legacy_narrations(
    item: dict[str, Any], item_path: Path, report: MigrationReport
) -> list[str] | None:
    candidates: list[list[str]] = []
    variants = item.get("variants")
    if not isinstance(variants, dict):
        return None
    for language, variant in variants.items():
        if not isinstance(variant, dict) or "narrations" not in variant:
            continue
        raw = variant.get("narrations")
        if raw in (None, []):
            continue
        if not isinstance(raw, list) or not all(
            isinstance(value, str) and value.strip() for value in raw
        ):
            report.conflicts.append(
                f"{item_path}: variants.{language}.narrations is not a non-empty string list"
            )
            continue
        candidates.append([value.strip() for value in raw])
    distinct = {_canonical(candidate) for candidate in candidates}
    if len(distinct) > 1:
        report.conflicts.append(
            f"{item_path}: language variants contain different legacy narrations; "
            "the migration cannot choose one silently"
        )
        return None
    return candidates[0] if candidates else None


def _remove_narrations(item: dict[str, Any]) -> bool:
    changed = False
    variants = item.get("variants")
    if not isinstance(variants, dict):
        return changed
    for variant in variants.values():
        if isinstance(variant, dict) and "narrations" in variant:
            del variant["narrations"]
            changed = True
    return changed


def _manifest_from_narrations(narrations: list[str], review_kind: str) -> SceneManifest:
    return SceneManifest.model_validate(
        {
            "review_kind": review_kind,
            "scenes": [
                {
                    "scene_id": f"scene-{index}",
                    "order": index,
                    "narration": narration,
                    # Legacy data had no independent visual prompt.  Keeping the narration
                    # is lossless and satisfies the old SceneManifest contract.
                    "image_prompt": narration,
                }
                for index, narration in enumerate(narrations, start=1)
            ],
            "confirmed": False,
        }
    )


def _scene_payload(manifest: SceneManifest) -> tuple[str, dict[str, Any]]:
    kind_by_review = {
        "video_scenes": "scene_plan",
        "image_pages": "image_pages",
        "agent_image_scenes": "agent_image_scenes",
    }
    kind = kind_by_review[manifest.review_kind]
    payload = {
        "kind": kind,
        "scenes": [scene.model_dump(mode="json") for scene in manifest.scenes],
    }
    payload_type = {
        "scene_plan": ScenePlanStagePayload,
        "image_pages": ImagePagesStagePayload,
        "agent_image_scenes": AgentImageScenesStagePayload,
    }[kind]
    return kind, payload_type.model_validate(payload).model_dump(mode="json")


def _existing_revision(
    revisions: list[dict[str, Any]], item_id: str, task_id: str, kind: str
) -> dict[str, Any] | None:
    matches = [
        revision
        for revision in revisions
        if revision.get("item_id") == item_id
        and revision.get("production_task_id") == task_id
        and revision.get("kind") == kind
    ]
    if not matches:
        return None
    return max(
        matches,
        key=lambda revision: (int(revision.get("sequence", 0)), revision.get("created_at", "")),
    )


def _plan_revision(
    *,
    item_id: str,
    task_id: str,
    kind: str,
    payload: dict[str, Any],
    created_at: str,
    revisions: list[dict[str, Any]],
    revision_dir: Path,
    report: MigrationReport,
) -> dict[str, Any] | None:
    current = _existing_revision(revisions, item_id, task_id, kind)
    if current is not None:
        if _canonical(current.get("payload")) != _canonical(payload):
            report.conflicts.append(
                f"item {item_id}, task {task_id}, stage {kind}: an immutable revision "
                "already exists with different content"
            )
            return None
        return current

    payload_hash = hashlib.sha256(_canonical(payload).encode("utf-8")).hexdigest()
    revision = StageRevision.model_validate(
        {
            "revision_id": _stable_id("revision", item_id, task_id, kind, payload_hash),
            "item_id": item_id,
            "production_task_id": task_id,
            "kind": kind,
            "sequence": 1,
            "supersedes_revision_id": None,
            "payload": payload,
            "created_by": "system",
            "source": "migration",
            "created_at": created_at,
        }
    ).model_dump(mode="json")
    report.writes.append(
        PlannedWrite(
            revision_dir / f"{revision['revision_id']}.json",
            revision,
            f"create {kind} revision for item {item_id}, task {task_id}",
        )
    )
    revisions.append(revision)
    return revision


def _plan_confirmation(
    *,
    revision: dict[str, Any],
    confirmations: list[dict[str, Any]],
    confirmation_dir: Path,
    confirmed_at: str,
    report: MigrationReport,
) -> dict[str, Any] | None:
    existing = [
        confirmation
        for confirmation in confirmations
        if confirmation.get("revision_id") == revision["revision_id"]
    ]
    if len(existing) > 1:
        report.conflicts.append(
            f"revision {revision['revision_id']}: multiple confirmation records exist"
        )
        return None
    if existing:
        candidate = existing[0]
        expected = {
            "item_id": revision["item_id"],
            "production_task_id": revision["production_task_id"],
            "kind": revision["kind"],
        }
        if any(candidate.get(key) != value for key, value in expected.items()):
            report.conflicts.append(
                f"revision {revision['revision_id']}: its confirmation points to a "
                "different item, task, or stage"
            )
            return None
        return existing[0]
    request_id = f"migration-stage-revision:{revision['revision_id']}"
    request_collision = next(
        (
            confirmation
            for confirmation in confirmations
            if confirmation.get("request_id") == request_id
        ),
        None,
    )
    if request_collision is not None:
        report.conflicts.append(
            f"revision {revision['revision_id']}: migration request id is already used by "
            f"revision {request_collision.get('revision_id')}"
        )
        return None
    confirmation = StageConfirmation.model_validate(
        {
            "confirmation_id": _stable_id("confirmation", revision["revision_id"]),
            "revision_id": revision["revision_id"],
            "item_id": revision["item_id"],
            "production_task_id": revision["production_task_id"],
            "kind": revision["kind"],
            "request_id": request_id,
            "actor": "system",
            "source": "migration",
            "confirmed_at": confirmed_at,
        }
    ).model_dump(mode="json")
    report.writes.append(
        PlannedWrite(
            confirmation_dir / f"{confirmation['confirmation_id']}.json",
            confirmation,
            f"confirm migrated revision {revision['revision_id']}",
        )
    )
    confirmations.append(confirmation)
    return confirmation


def _set_reference(
    task: dict[str, Any], key: str, value: str, task_id: str, report: MigrationReport
) -> bool:
    references = task.setdefault("confirmed_version_refs", {})
    if not isinstance(references, dict):
        report.conflicts.append(f"task {task_id}: confirmed_version_refs must be an object")
        return False
    existing = references.get(key)
    if existing and existing != value:
        report.conflicts.append(f"task {task_id}: {key} already points to {existing}, not {value}")
        return False
    if existing == value:
        return False
    references[key] = value
    return True


def migrate(data_dir: Path, *, apply: bool = False) -> MigrationReport:
    """Plan and optionally apply the one-time migration.

    Any conflict aborts the complete apply pass, ensuring that an ambiguous
    item is never partly migrated while its legacy source is removed.
    """

    data_dir = Path(data_dir)
    report = MigrationReport(apply_requested=apply)
    item_dir = data_dir / "content-items"
    task_dir = data_dir / "production-tasks"
    revision_dir = data_dir / "stage-revisions" / "revisions"
    confirmation_dir = data_dir / "stage-revisions" / "confirmations"

    item_records = _load_directory(item_dir, report)
    task_records = _load_directory(task_dir, report)
    raw_revision_records = list(_load_directory(revision_dir, report).values())
    raw_confirmation_records = list(_load_directory(confirmation_dir, report).values())
    revision_records: list[dict[str, Any]] = []
    confirmation_records: list[dict[str, Any]] = []
    for revision in raw_revision_records:
        try:
            revision_records.append(StageRevision.model_validate(revision).model_dump(mode="json"))
        except ValueError as exc:
            report.conflicts.append(f"existing stage revision is invalid ({exc})")
    for confirmation in raw_confirmation_records:
        try:
            confirmation_records.append(
                StageConfirmation.model_validate(confirmation).model_dump(mode="json")
            )
        except ValueError as exc:
            report.conflicts.append(f"existing stage confirmation is invalid ({exc})")
    report.scanned_items = len(item_records)
    report.scanned_tasks = len(task_records)

    tasks_by_item: dict[str, list[tuple[Path, dict[str, Any]]]] = {}
    for filename, task in task_records.items():
        task_id = task.get("production_task_id")
        item_id = task.get("content_item_id")
        if (
            not isinstance(task_id, str)
            or not task_id
            or not isinstance(item_id, str)
            or not item_id
        ):
            report.conflicts.append(f"{task_dir / filename}: missing task or content item id")
            continue
        tasks_by_item.setdefault(item_id, []).append((task_dir / filename, task))

    known_item_ids = {
        item.get("item_id")
        for item in item_records.values()
        if isinstance(item.get("item_id"), str)
    }
    for item_id, tasks in tasks_by_item.items():
        if item_id not in known_item_ids:
            report.conflicts.append(
                f"production task(s) {', '.join(str(task.get('production_task_id')) for _, task in tasks)} "
                f"reference missing content item {item_id}"
            )

    for filename, original_item in item_records.items():
        item_path = item_dir / filename
        item = json.loads(json.dumps(original_item))
        item_id = item.get("item_id")
        if not isinstance(item_id, str) or not item_id:
            report.conflicts.append(f"{item_path}: missing item_id")
            continue
        associated_tasks = tasks_by_item.get(item_id, [])
        script_payload = _extract_script_payload(item, item_path, report)
        narrations = _legacy_narrations(item, item_path, report)

        raw_manifest = item.get("scene_manifest")
        manifest: SceneManifest | None = None
        if raw_manifest is not None:
            try:
                manifest = SceneManifest.model_validate(raw_manifest)
            except ValueError as exc:
                report.conflicts.append(f"{item_path}: invalid scene_manifest ({exc})")
        elif narrations:
            if not associated_tasks:
                report.conflicts.append(
                    f"{item_path}: legacy narrations have no associated production task; "
                    "their video/image-post type cannot be inferred safely"
                )
            else:
                review_kinds = {_pipeline_review_kind(task) for _, task in associated_tasks}
                if None in review_kinds:
                    unknown = [
                        str(task.get("pipeline_id") or "<missing>")
                        for _, task in associated_tasks
                        if _pipeline_review_kind(task) is None
                    ]
                    report.conflicts.append(
                        f"{item_path}: legacy narrations are linked to unsupported or unknown "
                        f"pipeline(s): {', '.join(unknown)}"
                    )
                elif len(review_kinds) != 1:
                    report.conflicts.append(
                        f"{item_path}: legacy narrations are shared by video and image-post tasks; "
                        "one global scene_manifest cannot represent both"
                    )
                else:
                    try:
                        manifest = _manifest_from_narrations(narrations, review_kinds.pop())
                        item["scene_manifest"] = manifest.model_dump(mode="json")
                    except ValueError as exc:
                        report.conflicts.append(
                            f"{item_path}: legacy narrations cannot form a SceneManifest ({exc})"
                        )

        removed_narrations = _remove_narrations(item)
        item_changed = removed_narrations or item != original_item
        task_changes: dict[Path, dict[str, Any]] = {}
        created_at = str(
            item.get("updated_at") or item.get("created_at") or "1970-01-01T00:00:00+00:00"
        )

        for task_path, original_task in associated_tasks:
            task = json.loads(json.dumps(original_task))
            task_id = str(task["production_task_id"])
            task_changed = False
            stages: list[tuple[str, dict[str, Any], bool]] = []
            if script_payload is not None:
                variants = item.get("variants", {})
                statuses = [
                    variant.get("status")
                    for variant in variants.values()
                    if isinstance(variant, dict)
                    and isinstance(variant.get("script"), str)
                    and variant.get("script", "").strip()
                ]
                script_confirmed = bool(statuses) and all(
                    status == "confirmed" for status in statuses
                )
                script_confirmed = script_confirmed or item.get("status") in FINAL_CONTENT_STATUSES
                script_confirmed = script_confirmed or task.get("state") == "produced"
                stages.append(("script", script_payload, script_confirmed))
            if manifest is not None:
                scene_kind, scene_payload = _scene_payload(manifest)
                scene_confirmed = (
                    bool(manifest.confirmed) or task.get("state") in SCENE_CONFIRMED_TASK_STATES
                )
                stages.append((scene_kind, scene_payload, scene_confirmed))

            for kind, payload, should_confirm in stages:
                revision = _plan_revision(
                    item_id=item_id,
                    task_id=task_id,
                    kind=kind,
                    payload=payload,
                    created_at=created_at,
                    revisions=revision_records,
                    revision_dir=revision_dir,
                    report=report,
                )
                if revision is None or not should_confirm:
                    continue
                confirmation = _plan_confirmation(
                    revision=revision,
                    confirmations=confirmation_records,
                    confirmation_dir=confirmation_dir,
                    confirmed_at=str(task.get("updated_at") or created_at),
                    report=report,
                )
                if confirmation is None:
                    continue
                task_changed |= _set_reference(
                    task,
                    f"approved_{kind}_revision_id",
                    revision["revision_id"],
                    task_id,
                    report,
                )
                task_changed |= _set_reference(
                    task,
                    f"approved_{kind}_confirmation_id",
                    confirmation["confirmation_id"],
                    task_id,
                    report,
                )
            if task_changed:
                task_changes[task_path] = task

        if item_changed:
            report.writes.append(
                PlannedWrite(
                    item_path,
                    item,
                    f"remove legacy narrations/update manifest for {item_id}",
                    allow_update=True,
                )
            )
        for task_path, task in task_changes.items():
            report.writes.append(
                PlannedWrite(
                    task_path,
                    task,
                    f"record migrated revision references for {task['production_task_id']}",
                    allow_update=True,
                )
            )

    # A deterministic target may already exist from an interrupted prior pass.
    unique_writes: dict[Path, PlannedWrite] = {}
    for write in report.writes:
        prior = unique_writes.get(write.path)
        if prior is not None and _canonical(prior.payload) != _canonical(write.payload):
            report.conflicts.append(f"{write.path}: migration planned two different payloads")
            continue
        unique_writes[write.path] = write
    report.writes = list(unique_writes.values())

    for write in list(report.writes):
        if not write.path.exists():
            continue
        existing = _read_json(write.path, report)
        if existing is None:
            continue
        if _canonical(existing) == _canonical(write.payload):
            report.writes.remove(write)
            report.unchanged.append(str(write.path))
        elif not write.allow_update:
            report.conflicts.append(
                f"{write.path}: target exists with different content; refusing to overwrite"
            )

    if apply and not report.conflicts:
        for write in report.writes:
            _atomic_write(write.path, write.payload)
            report.applied_writes += 1
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=REPOSITORY_ROOT / "data",
        help="Pixelle data directory (default: repository data/)",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="write the migration; without this flag the command is a dry-run",
    )
    args = parser.parse_args(argv)
    report = migrate(args.data_dir, apply=args.apply)
    print(report.summary())
    return 0 if report.ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
