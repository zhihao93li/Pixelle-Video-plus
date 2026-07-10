"""起草配置（与项目 1:1 绑定）与 Prompt 模板自助管理的回归测试。"""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import api.routers.generation as generation_router
from api.app import app
from api.dependencies import get_pixelle_video
from pixelle_video.content import drafting_profiles
from pixelle_video.content import projects
from tests.generation_api_test import get_fake_script_review_pixelle_video


@pytest.fixture(autouse=True)
def isolated_profiles(tmp_path, monkeypatch):
    monkeypatch.setattr(
        drafting_profiles,
        "_profiles_path",
        lambda: str(tmp_path / "drafting-profiles.json"),
    )
    monkeypatch.setattr(
        projects, "get_data_path", lambda *parts: str(tmp_path / Path(*parts))
    )
    yield


def _create_profile(client, **overrides):
    body = {
        "project_id": "proj-1",
        "name": "宠物口播",
        "script_template_name": "Short Oral Script",
        "split_template_name": "Copy-Safe Scene Split",
        "languages": ["Chinese"],
        **overrides,
    }
    return client.post("/api/drafting/profiles", json=body)


# ---------------------------------------------------------------------------
# 1:1 约束
# ---------------------------------------------------------------------------


def test_create_requires_project_id():
    client = TestClient(app)
    assert _create_profile(client, project_id="").status_code == 400


def test_one_profile_per_project():
    client = TestClient(app)
    assert _create_profile(client).status_code == 200
    assert _create_profile(client, name="第二份").status_code == 400  # 同项目再建
    assert _create_profile(client, project_id="proj-2").status_code == 200


def test_profile_response_carries_project_id():
    client = TestClient(app)
    assert _create_profile(client).json()["project_id"] == "proj-1"
    listing = client.get("/api/drafting/profiles").json()
    assert any(p["project_id"] == "proj-1" for p in listing["profiles"])


def test_delete_is_rejected():
    client = TestClient(app)
    profile_id = _create_profile(client).json()["profile_id"]
    assert client.delete(f"/api/drafting/profiles/{profile_id}").status_code == 400


def test_set_default_route_removed():
    client = TestClient(app)
    _create_profile(client)
    response = client.put(
        "/api/drafting/profiles/default", json={"profile_id": "x"}
    )
    assert response.status_code != 200


def test_patch_updates_profile():
    client = TestClient(app)
    profile_id = _create_profile(client).json()["profile_id"]
    patched = client.put(
        f"/api/drafting/profiles/{profile_id}", json={"name": "改名后"}
    )
    assert patched.status_code == 200
    assert patched.json()["name"] == "改名后"


def test_profile_rejects_unknown_prompt_template():
    client = TestClient(app)
    assert _create_profile(client, script_template_name="No Such Prompt").status_code == 400


# ---------------------------------------------------------------------------
# 自愈补建
# ---------------------------------------------------------------------------


def test_get_profile_for_project_self_heals_and_is_idempotent():
    first = drafting_profiles.get_profile_for_project("proj-x")
    assert first.project_id == "proj-x"
    assert first.script_template_name == drafting_profiles.SAFE_DEFAULT_SCRIPT_TEMPLATE
    second = drafting_profiles.get_profile_for_project("proj-x")
    assert second.profile_id == first.profile_id
    _, all_profiles = drafting_profiles.list_profiles()
    assert len([p for p in all_profiles if p.project_id == "proj-x"]) == 1


def test_get_profile_by_project_no_autobuild():
    assert drafting_profiles.get_profile_by_project("nope") is None
    assert drafting_profiles.list_profiles()[1] == []


# ---------------------------------------------------------------------------
# 解析链走项目起草配置
# ---------------------------------------------------------------------------


def test_draft_creation_uses_project_profile(tmp_path):
    client = TestClient(app)
    project = projects.create_project(name="演示项目")
    profile = drafting_profiles.get_profile_for_project(project.project_id)
    drafting_profiles.update_profile(profile.profile_id, {"script_model": "model-Z"})

    previous_dir = generation_router.GENERATION_SCRIPT_REVIEW_DIR
    generation_router.GENERATION_SCRIPT_REVIEW_DIR = tmp_path / "reviews"
    app.dependency_overrides[get_pixelle_video] = get_fake_script_review_pixelle_video
    try:
        response = client.post(
            "/api/generation/script-review/draft-sets",
            json={
                "topics": ["Cat hydration"],
                "languages": ["English"],
                "project_id": project.project_id,
            },
        )
    finally:
        app.dependency_overrides.clear()
        generation_router.GENERATION_SCRIPT_REVIEW_DIR = previous_dir

    assert response.status_code == 200, response.text
    settings = response.json()["draft_settings"]
    assert settings["script_model"] == "model-Z"
    assert settings["script_template_name"] == "Short Oral Script"
    assert settings["project_id"] == project.project_id


# ---------------------------------------------------------------------------
# Prompt 模板文件 CRUD（不受配置改动影响）
# ---------------------------------------------------------------------------


def test_prompt_template_crud_and_guards(tmp_path, monkeypatch):
    import web.utils.script_review as sr
    from pixelle_video.utils import os_util

    monkeypatch.setattr(
        os_util, "get_data_path", lambda *paths: str(tmp_path.joinpath(*paths))
    )
    monkeypatch.setattr(
        sr, "get_data_path", lambda *paths: str(tmp_path.joinpath(*paths))
    )
    import api.routers.drafting as drafting_router_module

    monkeypatch.setattr(
        drafting_router_module,
        "get_data_path",
        lambda *paths: str(tmp_path.joinpath(*paths)),
    )

    client = TestClient(app)
    created = client.post(
        "/api/drafting/prompt-templates",
        json={"kind": "script", "name": "My Pet Prompt", "content": "写 {topic}"},
    )
    assert created.status_code == 200
    assert created.json()["name"] == "My Pet Prompt"

    updated = client.put(
        "/api/drafting/prompt-templates",
        json={"kind": "script", "name": "My Pet Prompt", "content": "新内容 {topic}"},
    )
    assert updated.status_code == 200

    builtin_edit = client.put(
        "/api/drafting/prompt-templates",
        json={"kind": "script", "name": "Short Oral Script", "content": "x"},
    )
    assert builtin_edit.status_code == 400

    deleted = client.delete(
        "/api/drafting/prompt-templates",
        params={"kind": "script", "name": "My Pet Prompt"},
    )
    assert deleted.status_code == 200
