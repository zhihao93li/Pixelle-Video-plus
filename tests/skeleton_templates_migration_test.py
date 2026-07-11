"""生产模板迁移、启停与退役行为测试。"""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import pixelle_video.content.projects as projects
from api.app import app
from pixelle_video.generation import custom_templates, template_overrides
from pixelle_video.generation.templates import (
    build_default_production_template_registry,
    code_level_enabled,
)

STANDARD_SKELETON = "pipeline_standard_base_v1"
ASSET_SKELETON = "pipeline_asset_based_base_v1"
MIGRATED_STATIC = "migrated_static_subtitle_v1"
RETIRED_STATIC = "petwoods_xhs_static_subtitle_v1"
RETIRED_DAILY = "petwoods_xhs_daily_v1"


@pytest.fixture(autouse=True)
def isolated_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(
        projects, "get_data_path", lambda *parts: str(tmp_path / Path(*parts))
    )
    monkeypatch.setattr(
        custom_templates,
        "_custom_templates_path",
        lambda: str(tmp_path / "production-templates-custom.json"),
    )
    monkeypatch.setattr(
        template_overrides,
        "_overrides_path",
        lambda: str(tmp_path / "production-template-overrides.json"),
    )
    yield


# --- enabled 覆盖合并：退役不可诈尸 / 用户停用可重启用 ---


def test_code_level_retired_templates_report_disabled():
    assert code_level_enabled(RETIRED_STATIC) is False
    assert code_level_enabled(RETIRED_DAILY) is False
    assert code_level_enabled(STANDARD_SKELETON) is True
    # 非内置（不存在）→ None
    assert code_level_enabled("no_such_template") is None


def test_enabled_override_true_cannot_revive_retired_template():
    # 即便用户 override enabled=True，代码层退役的模板也不复活
    template_overrides.save_enabled(RETIRED_STATIC, True)
    registry = build_default_production_template_registry()
    assert registry.get(RETIRED_STATIC).enabled is False


def test_user_disabled_builtin_can_be_reenabled_by_clearing_override():
    template_overrides.save_enabled(ASSET_SKELETON, False)
    assert build_default_production_template_registry().get(ASSET_SKELETON).enabled is False
    # 清除开关 → 回到代码默认启用
    template_overrides.save_enabled(ASSET_SKELETON, None)
    assert build_default_production_template_registry().get(ASSET_SKELETON).enabled is True


# --- 主力迁移：幂等 + 项目默认重指 ---


def test_migration_creates_migrated_static_subtitle_with_source_params():
    projects.create_project(name="A")  # 确保有项目，触发迁移路径
    projects.ensure_migrated()

    registry = build_default_production_template_registry()
    migrated = registry.get(MIGRATED_STATIC)
    assert migrated.enabled is True
    assert migrated.is_custom is True
    assert migrated.display_name == "静态字幕快出"
    # 保留源模板当时的生效参数（静态帧模板是关键区分点）
    assert migrated.fixed_params["frame_template"] == "1080x1920/static_default.html"
    # 迁移出来的自定义模板可正常编译出片
    request = registry.compile_request(MIGRATED_STATIC, input={"script": "测试文案"})
    assert request.pipeline_id == "standard"
    assert request.entry == "script"


def test_migration_is_idempotent():
    projects.create_project(name="A")
    projects.ensure_migrated()
    first = build_default_production_template_registry().get(MIGRATED_STATIC)
    projects.ensure_migrated()  # 第二次不应重复创建或报错
    second = build_default_production_template_registry().get(MIGRATED_STATIC)
    assert MIGRATED_STATIC in custom_templates.custom_template_ids()
    # 参数不因重复迁移而变化
    assert first.fixed_params == second.fixed_params


def test_migration_repoints_retired_project_defaults():
    static_project = projects.create_project(
        name="Static", default_production_template_id=RETIRED_STATIC
    )
    daily_project = projects.create_project(
        name="Daily", default_production_template_id=RETIRED_DAILY
    )
    kept_project = projects.create_project(
        name="Kept", default_production_template_id="pixelle_i2v_basic_v1"
    )

    projects.ensure_migrated()

    _, all_projects = projects.list_projects()
    by_id = {p.project_id: p for p in all_projects}
    # 退役 static → 迁移出来的自定义模板
    assert by_id[static_project.project_id].default_production_template_id == MIGRATED_STATIC
    # 退役 daily → 标准骨架
    assert by_id[daily_project.project_id].default_production_template_id == STANDARD_SKELETON
    # 指向已启用模板的项目不动
    assert by_id[kept_project.project_id].default_production_template_id == "pixelle_i2v_basic_v1"


def test_migration_repoints_nonexistent_project_default_to_skeleton():
    ghost = projects.create_project(
        name="Ghost", default_production_template_id="does_not_exist"
    )
    projects.ensure_migrated()
    _, all_projects = projects.list_projects()
    by_id = {p.project_id: p for p in all_projects}
    assert by_id[ghost.project_id].default_production_template_id == STANDARD_SKELETON


# --- 启用/停用端点 ---


def test_enabled_endpoint_rejects_reviving_retired_template():
    response = TestClient(app).put(
        f"/api/generation/templates/{RETIRED_STATIC}/enabled",
        json={"enabled": True},
    )
    assert response.status_code == 400
    assert "退役" in response.json()["detail"]


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
