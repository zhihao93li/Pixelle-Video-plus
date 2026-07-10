from pathlib import Path

import pytest

import pixelle_video.content.drafting_profiles as drafting_profiles
import pixelle_video.content.projects as projects
import pixelle_video.content.store as content_store
from pixelle_video.content.models import new_content_item


@pytest.fixture(autouse=True)
def isolated_storage(tmp_path, monkeypatch):
    # projects 模块内所有落盘都走 tmp（含 ops.db 探测 → 不存在 → 走回退分支）
    monkeypatch.setattr(
        projects, "get_data_path", lambda *parts: str(tmp_path / Path(*parts))
    )
    monkeypatch.setattr(
        drafting_profiles,
        "_profiles_path",
        lambda: str(tmp_path / "drafting-profiles.json"),
    )
    monkeypatch.setattr(content_store, "CONTENT_ITEMS_DIR", tmp_path / "content-items")
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


# ---------------------------------------------------------------------------
# 迁移（幂等 + ops.db 缺失分支 + content-items 改写）
# ---------------------------------------------------------------------------


def test_migration_creates_default_project_without_ops_db():
    projects.ensure_migrated()
    default_id, all_projects = projects.list_projects()
    assert len(all_projects) == 1
    assert all_projects[0].name == "PetWoods"  # ops.db 缺失 → 回退名
    assert default_id == all_projects[0].project_id


def test_migration_is_idempotent():
    projects.ensure_migrated()
    projects.ensure_migrated()
    _, all_projects = projects.list_projects()
    assert len(all_projects) == 1


def test_migration_rewrites_legacy_content_items():
    legacy = new_content_item(title="旧条目")  # project 默认 "PetWoods"
    content_store.save_item(legacy)
    assert legacy.project == "PetWoods"

    projects.ensure_migrated()
    default_id = projects.default_project_id()

    reloaded = content_store.load_item(legacy.item_id)
    assert reloaded.project == default_id
    assert default_id not in (None, "PetWoods")


def test_migration_leaves_valid_project_ids_untouched():
    projects.ensure_migrated()
    default_id = projects.default_project_id()
    item = new_content_item(title="已归属条目", project=default_id)
    content_store.save_item(item)

    # 再次迁移是 no-op，不应改写已合法的 project
    projects.ensure_migrated()
    assert content_store.load_item(item.item_id).project == default_id


# ---------------------------------------------------------------------------
# 起草配置随项目自动创建（1:1，克隆不共享）
# ---------------------------------------------------------------------------


def test_create_project_provisions_profile():
    project = projects.create_project(name="A")
    profile = drafting_profiles.get_profile_by_project(project.project_id)
    assert profile is not None
    assert profile.script_template_name == drafting_profiles.SAFE_DEFAULT_SCRIPT_TEMPLATE


def test_copy_from_clones_profile_not_shared():
    source = projects.create_project(name="源")
    source_profile = drafting_profiles.get_profile_by_project(source.project_id)
    # 改源项目的配置内容
    drafting_profiles.update_profile(
        source_profile.profile_id, {"script_model": "src-model"}
    )

    clone = projects.create_project(name="克隆", copy_from_project_id=source.project_id)
    clone_profile = drafting_profiles.get_profile_by_project(clone.project_id)

    assert clone_profile is not None
    assert clone_profile.profile_id != source_profile.profile_id  # 不共享引用
    assert clone_profile.script_model == "src-model"  # 内容已克隆

    # 改克隆项目的配置不影响源项目
    drafting_profiles.update_profile(
        clone_profile.profile_id, {"script_model": "clone-model"}
    )
    assert (
        drafting_profiles.get_profile_by_project(source.project_id).script_model
        == "src-model"
    )


def test_migration_provisions_profiles_for_preexisting_projects():
    import json

    # 模拟"旧多项目"状态：项目已存在但配置还没有 project_id（升级前数据）
    projects.create_project(name="老项目")
    profiles_path = Path(drafting_profiles._profiles_path())
    raw = json.loads(profiles_path.read_text("utf-8"))
    for payload in raw["profiles"].values():
        payload["project_id"] = ""
    profiles_path.write_text(json.dumps(raw), encoding="utf-8")

    _, projs = projects.list_projects()
    projects.ensure_migrated()  # 应为每个项目补齐配置
    for project in projs:
        assert drafting_profiles.get_profile_by_project(project.project_id) is not None

    # 幂等：再次迁移不新增配置
    _, before = drafting_profiles.list_profiles()
    projects.ensure_migrated()
    _, after = drafting_profiles.list_profiles()
    assert len(after) == len(before)
