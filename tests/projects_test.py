from pathlib import Path

import pytest

import pixelle_video.content.projects as projects


@pytest.fixture(autouse=True)
def isolated_storage(tmp_path, monkeypatch):
    # projects 模块内所有落盘都走 tmp。
    monkeypatch.setattr(
        projects, "get_data_path", lambda *parts: str(tmp_path / Path(*parts))
    )
    yield


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


def test_first_project_becomes_default():
    project = projects.create_project(name="品牌 A")
    default_id, all_projects = projects.list_projects()
    assert default_id == project.project_id
    assert len(all_projects) == 1


def test_create_copies_defaults_from_source():
    source = projects.create_project(
        name="源项目",
        default_production_template_id="tpl_a",
        languages=["Chinese", "English"],
        tts_voice_by_language={"Chinese": "ref-1"},
        publish_platforms=["buffer"],
    )
    clone = projects.create_project(
        name="复制项目", copy_from_project_id=source.project_id
    )
    assert clone.default_production_template_id == "tpl_a"
    assert clone.languages == ["Chinese", "English"]
    assert clone.tts_voice_by_language == {"Chinese": "ref-1"}
    assert clone.publish_platforms == ["buffer"]
    assert clone.name == "复制项目"  # 名称不复制


def test_update_and_set_default():
    first = projects.create_project(name="A")
    second = projects.create_project(name="B")
    assert projects.set_default_project(second.project_id) is True
    assert projects.default_project_id() == second.project_id

    updated = projects.update_project(first.project_id, {"name": "A2"})
    assert updated is not None
    assert updated.name == "A2"


def test_archive_and_restore():
    first = projects.create_project(name="A")
    second = projects.create_project(name="B")
    projects.set_default_project(second.project_id)

    assert projects.archive_project(first.project_id) is True
    assert projects.get_project(first.project_id).status == "archived"
    # 归档后不在默认候选内
    assert projects.default_project_id() == second.project_id

    assert projects.restore_project(first.project_id) is True
    assert projects.get_project(first.project_id).status == "active"


def test_cannot_set_archived_project_as_default():
    first = projects.create_project(name="A")
    second = projects.create_project(name="B")
    projects.set_default_project(second.project_id)
    projects.archive_project(first.project_id)
    assert projects.set_default_project(first.project_id) is False


def test_default_project_is_created_for_new_installation():
    projects.ensure_default_project()
    default_id, all_projects = projects.list_projects()
    assert len(all_projects) == 1
    assert all_projects[0].name == "PetWoods"
    assert default_id == all_projects[0].project_id


def test_default_project_creation_is_idempotent():
    projects.ensure_default_project()
    projects.ensure_default_project()
    _, all_projects = projects.list_projects()
    assert len(all_projects) == 1
