import json
from pathlib import Path

from scripts.migrate_stage_revisions import migrate


def _write(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _item(*, item_id="item-1", status="produced", manifest=None, narrations=None):
    variant = {
        "language": "Chinese",
        "status": "confirmed",
        "title": "猫与纸箱",
        "script": "猫喜欢纸箱。",
    }
    if narrations is not None:
        variant["narrations"] = narrations
    return {
        "item_id": item_id,
        "title": "猫与纸箱",
        "status": status,
        "variants": {"Chinese": variant},
        "scene_manifest": manifest,
        "created_at": "2025-01-01T00:00:00+00:00",
        "updated_at": "2025-01-02T00:00:00+00:00",
    }


def _task(
    *,
    task_id="task-1",
    item_id="item-1",
    pipeline_id="script_to_video",
    artifact_type="video",
    state="produced",
):
    return {
        "production_task_id": task_id,
        "content_item_id": item_id,
        "pipeline_id": pipeline_id,
        "artifact_type": artifact_type,
        "state": state,
        "confirmed_version_refs": {},
        "updated_at": "2025-01-03T00:00:00+00:00",
    }


def _manifest(narration="manifest wins", *, kind="video_scenes", confirmed=True):
    return {
        "review_kind": kind,
        "scenes": [
            {
                "scene_id": "scene-1",
                "order": 1,
                "narration": narration,
                "image_prompt": "a cat in a box",
            }
        ],
        "confirmed": confirmed,
        "updated_at": "2025-01-02T00:00:00+00:00",
    }


def _records(directory: Path):
    return [json.loads(path.read_text(encoding="utf-8")) for path in directory.glob("*.json")]


def test_dry_run_does_not_write_and_manifest_has_priority(tmp_path):
    item_path = tmp_path / "content-items" / "item-1.json"
    task_path = tmp_path / "production-tasks" / "task-1.json"
    original = _item(manifest=_manifest(), narrations=["obsolete duplicate"])
    _write(item_path, original)
    _write(task_path, _task())

    report = migrate(tmp_path)

    assert report.ok
    assert report.writes
    assert json.loads(item_path.read_text(encoding="utf-8")) == original
    assert not (tmp_path / "stage-revisions").exists()


def test_apply_creates_typed_revisions_confirmations_and_is_idempotent(tmp_path):
    item_path = tmp_path / "content-items" / "item-1.json"
    task_path = tmp_path / "production-tasks" / "task-1.json"
    _write(item_path, _item(manifest=_manifest(), narrations=["obsolete duplicate"]))
    _write(task_path, _task())

    first = migrate(tmp_path, apply=True)

    assert first.ok
    assert first.applied_writes == 6  # item, task, two revisions, two confirmations
    migrated_item = json.loads(item_path.read_text(encoding="utf-8"))
    assert "narrations" not in migrated_item["variants"]["Chinese"]
    revisions = _records(tmp_path / "stage-revisions" / "revisions")
    assert {revision["kind"] for revision in revisions} == {"script", "scene_plan"}
    scene_revision = next(revision for revision in revisions if revision["kind"] == "scene_plan")
    assert scene_revision["payload"]["scenes"][0]["narration"] == "manifest wins"
    confirmations = _records(tmp_path / "stage-revisions" / "confirmations")
    assert len(confirmations) == 2
    assert {entry["source"] for entry in confirmations} == {"migration"}
    task = json.loads(task_path.read_text(encoding="utf-8"))
    assert task["confirmed_version_refs"]["approved_script_revision_id"]
    assert task["confirmed_version_refs"]["approved_scene_plan_confirmation_id"]

    second = migrate(tmp_path, apply=True)

    assert second.ok
    assert second.applied_writes == 0
    assert second.writes == []


def test_legacy_image_post_narrations_become_image_pages(tmp_path):
    item_path = tmp_path / "content-items" / "item-1.json"
    _write(item_path, _item(manifest=None, narrations=["第一页", "第二页"]))
    _write(
        tmp_path / "production-tasks" / "task-1.json",
        _task(pipeline_id="image_post", artifact_type="image_set"),
    )

    report = migrate(tmp_path, apply=True)

    assert report.ok
    item = json.loads(item_path.read_text(encoding="utf-8"))
    assert item["scene_manifest"]["review_kind"] == "image_pages"
    assert [scene["narration"] for scene in item["scene_manifest"]["scenes"]] == [
        "第一页",
        "第二页",
    ]
    revisions = _records(tmp_path / "stage-revisions" / "revisions")
    assert "image_pages" in {revision["kind"] for revision in revisions}


def test_legacy_narrations_without_task_are_reported_and_not_removed(tmp_path):
    item_path = tmp_path / "content-items" / "item-1.json"
    original = _item(manifest=None, narrations=["cannot infer this"])
    _write(item_path, original)

    report = migrate(tmp_path, apply=True)

    assert not report.ok
    assert report.applied_writes == 0
    assert "no associated production task" in "\n".join(report.conflicts)
    assert json.loads(item_path.read_text(encoding="utf-8")) == original


def test_existing_different_immutable_revision_blocks_entire_apply(tmp_path):
    item_path = tmp_path / "content-items" / "item-1.json"
    task_path = tmp_path / "production-tasks" / "task-1.json"
    original = _item(manifest=_manifest())
    _write(item_path, original)
    _write(task_path, _task())
    _write(
        tmp_path / "stage-revisions" / "revisions" / "existing.json",
        {
            "revision_id": "existing",
            "item_id": "item-1",
            "production_task_id": "task-1",
            "kind": "script",
            "sequence": 1,
            "supersedes_revision_id": None,
            "payload": {
                "kind": "script",
                "variants": {
                    "Chinese": {
                        "language": "Chinese",
                        "title": "猫与纸箱",
                        "script": "different immutable content",
                    }
                },
            },
            "created_by": "system",
            "source": "migration",
            "created_at": "2025-01-01T00:00:00+00:00",
        },
    )

    report = migrate(tmp_path, apply=True)

    assert not report.ok
    assert report.applied_writes == 0
    assert "different content" in "\n".join(report.conflicts)
    assert json.loads(item_path.read_text(encoding="utf-8")) == original
