import json

import pytest
from pydantic import ValidationError

from pixelle_video.content.stage_revisions import (
    ConfirmationRequestConflict,
    StageRevisionAlreadyConfirmed,
    StageRevisionConflict,
    StaleStageRevision,
    confirm_revision,
    create_revision,
    get_current_revision,
    get_revision,
    get_revision_confirmation,
)


def _script(text: str = "猫喜欢纸箱。"):
    return {
        "kind": "script",
        "variants": {
            "Chinese": {
                "language": "Chinese",
                "title": "猫与纸箱",
                "script": text,
            }
        },
    }


def _scenes(kind: str = "scene_plan"):
    return {
        "kind": kind,
        "scenes": [
            {
                "scene_id": "scene-2",
                "order": 2,
                "narration": "纸箱还能保温。",
                "image_prompt": "猫在纸箱里睡觉",
            },
            {
                "scene_id": "scene-1",
                "order": 1,
                "narration": "纸箱让猫有安全感。",
                "image_prompt": "猫蹲在纸箱里",
            },
        ],
    }


def test_create_and_read_immutable_revision_sequence(tmp_path):
    first = create_revision(
        item_id="item-1",
        production_task_id="task-1",
        kind="script",
        payload=_script(),
        created_by="system",
        source="system",
        directory=tmp_path,
    )
    second = create_revision(
        item_id="item-1",
        production_task_id="task-1",
        kind="script",
        payload=_script("猫喜欢小而封闭的空间。"),
        created_by="user",
        source="react",
        supersedes_revision_id=first.revision_id,
        directory=tmp_path,
    )

    assert first.sequence == 1
    assert first.supersedes_revision_id is None
    assert second.sequence == 2
    assert second.supersedes_revision_id == first.revision_id
    assert get_revision(first.revision_id, tmp_path) == first
    assert (
        get_current_revision(
            item_id="item-1",
            production_task_id="task-1",
            kind="script",
            directory=tmp_path,
        )
        == second
    )
    assert (
        get_revision(first.revision_id, tmp_path).payload.variants["Chinese"].script
        == "猫喜欢纸箱。"
    )
    with pytest.raises(ValidationError):
        second.sequence = 3

    stored = json.loads((tmp_path / "revisions" / f"{second.revision_id}.json").read_text("utf-8"))
    assert stored["item_id"] == "item-1"
    assert not list((tmp_path / "revisions").glob("*.tmp"))


@pytest.mark.parametrize("kind", ["scene_plan", "image_pages", "agent_image_scenes"])
def test_scene_payload_kinds_are_typed_and_canonically_ordered(tmp_path, kind):
    revision = create_revision(
        item_id=f"item-{kind}",
        production_task_id=f"task-{kind}",
        kind=kind,
        payload=_scenes(kind),
        created_by="agent",
        source="agent",
        directory=tmp_path,
    )

    assert revision.payload.kind == kind
    assert [scene.scene_id for scene in revision.payload.scenes] == ["scene-1", "scene-2"]


def test_scene_payload_has_no_arbitrary_twenty_scene_ceiling(tmp_path):
    scenes = [
        {
            "scene_id": f"scene-{index}",
            "order": index,
            "narration": f"第 {index} 镜。",
            "image_prompt": f"第 {index} 镜画面",
        }
        for index in range(1, 25)
    ]

    revision = create_revision(
        item_id="item-long-scene-plan",
        production_task_id="task-long-scene-plan",
        kind="scene_plan",
        payload={"kind": "scene_plan", "scenes": scenes},
        created_by="system",
        source="system",
        directory=tmp_path,
    )

    assert len(revision.payload.scenes) == 24


def test_rejects_payload_kind_mismatch_and_stale_predecessor(tmp_path):
    first = create_revision(
        item_id="item-1",
        production_task_id="task-1",
        kind="scene_plan",
        payload=_scenes(),
        created_by="system",
        source="system",
        directory=tmp_path,
    )
    create_revision(
        item_id="item-1",
        production_task_id="task-1",
        kind="scene_plan",
        payload=_scenes(),
        created_by="user",
        source="react",
        directory=tmp_path,
    )

    with pytest.raises(StageRevisionConflict):
        create_revision(
            item_id="item-1",
            production_task_id="task-1",
            kind="scene_plan",
            payload=_scenes(),
            created_by="user",
            source="react",
            supersedes_revision_id=first.revision_id,
            directory=tmp_path,
        )
    with pytest.raises(ValidationError):
        create_revision(
            item_id="item-2",
            production_task_id="task-2",
            kind="image_pages",
            payload=_scenes("scene_plan"),
            created_by="system",
            source="system",
            directory=tmp_path,
        )


def test_confirmation_is_separate_idempotent_and_rejects_request_reuse(tmp_path):
    revision = create_revision(
        item_id="item-1",
        production_task_id="task-1",
        kind="script",
        payload=_script(),
        created_by="system",
        source="system",
        directory=tmp_path,
    )
    confirmed = confirm_revision(
        revision.revision_id,
        request_id="confirm-script-1",
        actor="user",
        source="react",
        directory=tmp_path,
    )
    repeated = confirm_revision(
        revision.revision_id,
        request_id="confirm-script-1",
        actor="user",
        source="react",
        directory=tmp_path,
    )

    assert repeated == confirmed
    assert get_revision_confirmation(revision.revision_id, tmp_path) == confirmed
    assert get_revision(revision.revision_id, tmp_path) == revision

    other = create_revision(
        item_id="item-2",
        production_task_id="task-2",
        kind="script",
        payload=_script(),
        created_by="system",
        source="system",
        directory=tmp_path,
    )
    with pytest.raises(ConfirmationRequestConflict):
        confirm_revision(
            other.revision_id,
            request_id="confirm-script-1",
            actor="user",
            source="react",
            directory=tmp_path,
        )
    with pytest.raises(StageRevisionAlreadyConfirmed):
        confirm_revision(
            revision.revision_id,
            request_id="different-request",
            actor="user",
            source="react",
            directory=tmp_path,
        )


def test_only_current_revision_can_be_confirmed(tmp_path):
    first = create_revision(
        item_id="item-1",
        production_task_id="task-1",
        kind="script",
        payload=_script(),
        created_by="system",
        source="system",
        directory=tmp_path,
    )
    create_revision(
        item_id="item-1",
        production_task_id="task-1",
        kind="script",
        payload=_script("新版文案"),
        created_by="user",
        source="react",
        directory=tmp_path,
    )

    with pytest.raises(StaleStageRevision):
        confirm_revision(
            first.revision_id,
            request_id="stale-confirmation",
            actor="user",
            source="react",
            directory=tmp_path,
        )
