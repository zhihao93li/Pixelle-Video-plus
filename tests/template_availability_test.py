"""生产模板启停与配置可用性测试。"""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import pixelle_video.content.projects as projects
from api.app import app
from pixelle_video.generation import template_overrides
from pixelle_video.generation.templates import (
    build_default_production_template_registry,
    code_level_enabled,
)

STANDARD_SKELETON = "pipeline_standard_base_v1"
ASSET_SKELETON = "pipeline_asset_based_base_v1"


@pytest.fixture(autouse=True)
def isolated_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(
        projects, "get_data_path", lambda *parts: str(tmp_path / Path(*parts))
    )
    monkeypatch.setattr(
        template_overrides,
        "_overrides_path",
        lambda: str(tmp_path / "production-template-overrides.json"),
    )
    yield


def test_code_level_enabled_reports_builtin_and_unknown_templates():
    assert code_level_enabled(STANDARD_SKELETON) is True
    assert code_level_enabled("no_such_template") is None


def test_user_disabled_builtin_can_be_reenabled_by_clearing_override():
    template_overrides.save_enabled(ASSET_SKELETON, False)
    assert build_default_production_template_registry().get(ASSET_SKELETON).enabled is False
    # 清除开关 → 回到代码默认启用
    template_overrides.save_enabled(ASSET_SKELETON, None)
    assert build_default_production_template_registry().get(ASSET_SKELETON).enabled is True


def test_enabled_endpoint_rejects_disable_when_used_as_project_default():
    projects.create_project(
        name="AssetProject", default_production_template_id=ASSET_SKELETON
    )
    response = TestClient(app).put(
        f"/api/generation/templates/{ASSET_SKELETON}/enabled",
        json={"enabled": False},
    )
    assert response.status_code == 400
    assert "AssetProject" in response.json()["detail"]


def test_enabled_endpoint_disables_then_reenables_builtin():
    client = TestClient(app)
    disable = client.put(
        f"/api/generation/templates/{ASSET_SKELETON}/enabled",
        json={"enabled": False},
    )
    assert disable.status_code == 200
    assert disable.json()["enabled"] is False

    enable = client.put(
        f"/api/generation/templates/{ASSET_SKELETON}/enabled",
        json={"enabled": True},
    )
    assert enable.status_code == 200
    assert enable.json()["enabled"] is True


def test_enabled_endpoint_unknown_template_is_404():
    response = TestClient(app).put(
        "/api/generation/templates/no_such_template/enabled",
        json={"enabled": False},
    )
    assert response.status_code == 404


# --- workflow_key 默认配置校验（API 层 400） ---


def test_generation_config_rejects_unknown_workflow_key():
    response = TestClient(app).put(
        "/api/generation/templates/pixelle_i2v_basic_v1/generation-config",
        json={"overrides": {"workflow_key": "runninghub/does_not_exist.json"}},
    )
    assert response.status_code == 400
    assert "workflow" in response.json()["detail"].lower()
