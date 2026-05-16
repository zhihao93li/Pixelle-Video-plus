import json

import pytest

from web.utils.runninghub_workflows import (
    build_runninghub_workflow_filename,
    create_runninghub_workflow_file,
    list_custom_runninghub_workflows,
)


def test_build_runninghub_workflow_filename_uses_selected_kind_prefix():
    assert build_runninghub_workflow_filename("video", "WAN 2.2!") == "video_wan_2_2.json"


def test_build_runninghub_workflow_filename_does_not_duplicate_existing_prefix():
    assert build_runninghub_workflow_filename("image", "video_story") == "image_story.json"


def test_build_runninghub_workflow_filename_allows_non_ascii_names():
    assert build_runninghub_workflow_filename("video", "中文 工作流") == "video_中文_工作流.json"


def test_create_runninghub_workflow_file_writes_wrapper_json(tmp_path):
    result = create_runninghub_workflow_file(
        kind="video",
        name="WAN Custom",
        workflow_id="1985909483975188481",
        base_dir=tmp_path,
    )

    target = tmp_path / "video_wan_custom.json"
    assert result == {
        "filename": "video_wan_custom.json",
        "key": "runninghub/video_wan_custom.json",
        "path": str(target),
        "workflow_id": "1985909483975188481",
    }
    assert json.loads(target.read_text(encoding="utf-8")) == {
        "source": "runninghub",
        "workflow_id": "1985909483975188481",
    }


def test_create_runninghub_workflow_file_rejects_non_numeric_workflow_id(tmp_path):
    with pytest.raises(ValueError, match="workflow_id"):
        create_runninghub_workflow_file(
            kind="video",
            name="WAN Custom",
            workflow_id="abc",
            base_dir=tmp_path,
        )


def test_create_runninghub_workflow_file_requires_overwrite_for_duplicate(tmp_path):
    create_runninghub_workflow_file(
        kind="tts",
        name="Voice",
        workflow_id="123",
        base_dir=tmp_path,
    )

    with pytest.raises(FileExistsError):
        create_runninghub_workflow_file(
            kind="tts",
            name="Voice",
            workflow_id="456",
            base_dir=tmp_path,
        )

    result = create_runninghub_workflow_file(
        kind="tts",
        name="Voice",
        workflow_id="456",
        overwrite=True,
        base_dir=tmp_path,
    )

    assert result["workflow_id"] == "456"
    assert json.loads((tmp_path / "tts_voice.json").read_text(encoding="utf-8"))["workflow_id"] == "456"


def test_list_custom_runninghub_workflows_reads_only_wrapper_files(tmp_path):
    create_runninghub_workflow_file(
        kind="image",
        name="Flux",
        workflow_id="111",
        base_dir=tmp_path,
    )
    (tmp_path / "broken.json").write_text("{not-json", encoding="utf-8")
    (tmp_path / "plain.json").write_text(json.dumps({"nodes": []}), encoding="utf-8")

    workflows = list_custom_runninghub_workflows(base_dir=tmp_path)

    assert workflows == [
        {
            "filename": "image_flux.json",
            "key": "runninghub/image_flux.json",
            "path": str(tmp_path / "image_flux.json"),
            "workflow_id": "111",
        }
    ]
