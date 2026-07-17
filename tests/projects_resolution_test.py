from pathlib import Path

import pytest
from fastapi import HTTPException

import api.routers.generation as generation_router
import pixelle_video.content.projects as projects

# registry 内置默认（PetWoods×小红书）→ 标准骨架
BUILTIN_DEFAULT = "pipeline_standard_base_v1"


@pytest.fixture(autouse=True)
def isolated_projects(tmp_path, monkeypatch):
    monkeypatch.setattr(projects, "get_data_path", lambda *parts: str(tmp_path / Path(*parts)))
    yield


def test_template_default_is_not_project_specific():
    projects.create_project(name="A")
    projects.create_project(name="B")
    assert generation_router._default_template_id() == BUILTIN_DEFAULT


def test_resolve_project_id_prefers_valid_explicit_project():
    project = projects.create_project(name="C")
    assert generation_router._resolve_project_id(project.project_id) == project.project_id
    # 不传时回退到自动创建的内部初始空间
    resolved = generation_router._resolve_project_id(None)
    assert resolved is not None


def test_resolve_project_id_rejects_unknown_explicit_project():
    with pytest.raises(HTTPException) as error:
        generation_router._resolve_project_id("does-not-exist")
    assert error.value.status_code == 400
