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


def test_project_default_template_wins():
    # 项目默认必须是「已启用」模板才生效（退役的会被回退）
    project = projects.create_project(
        name="A", default_production_template_id="pixelle_i2v_basic_v1"
    )
    assert (
        generation_router._default_template_for_project(project.project_id)
        == "pixelle_i2v_basic_v1"
    )


def test_invalid_project_template_falls_back_to_builtin():
    project = projects.create_project(name="B", default_production_template_id="does_not_exist")
    assert generation_router._default_template_for_project(project.project_id) == BUILTIN_DEFAULT


def test_none_project_uses_builtin_default():
    assert generation_router._default_template_for_project(None) == BUILTIN_DEFAULT


def test_resolve_project_id_prefers_valid_explicit_project():
    project = projects.create_project(name="C")
    assert generation_router._resolve_project_id(project.project_id) == project.project_id
    # 不传时回退到自动创建的默认项目
    resolved = generation_router._resolve_project_id(None)
    assert resolved is not None


def test_resolve_project_id_rejects_unknown_explicit_project():
    with pytest.raises(HTTPException) as error:
        generation_router._resolve_project_id("does-not-exist")
    assert error.value.status_code == 400
