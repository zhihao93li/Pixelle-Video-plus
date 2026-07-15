import pytest
from fastapi.testclient import TestClient

from api.app import app
from pixelle_video.generation import (
    build_default_production_template_registry,
    custom_templates,
    template_overrides,
)

SOURCE_TEMPLATE_ID = "pipeline_standard_base_v1"


@pytest.fixture(autouse=True)
def isolated_storage(tmp_path, monkeypatch):
    custom_path = tmp_path / "production-templates-custom.json"
    overrides_path = tmp_path / "production-template-overrides.json"
    monkeypatch.setattr(custom_templates, "_custom_templates_path", lambda: str(custom_path))
    monkeypatch.setattr(template_overrides, "_overrides_path", lambda: str(overrides_path))
    yield


def _clone(client, **overrides):
    body = {
        "source_template_id": SOURCE_TEMPLATE_ID,
        "id": "petwoods_xhs_daily_copy",
        "display_name": "PetWoods 日常克隆线",
    }
    body.update(overrides)
    return client.post("/api/generation/templates", json=body)


def test_clone_appears_in_template_list():
    client = TestClient(app)
    response = _clone(client)
    assert response.status_code == 200, response.text
    clone = response.json()
    assert clone["id"] == "petwoods_xhs_daily_copy"
    assert clone["display_name"] == "PetWoods 日常克隆线"

    listing = client.get("/api/generation/templates").json()
    ids = [template["id"] for template in listing["templates"]]
    assert "petwoods_xhs_daily_copy" in ids


def test_clone_applies_fixed_params_patch():
    client = TestClient(app)
    response = _clone(client, fixed_params_patch={"tts_voice": "zh-CN-XiaoxiaoNeural"})
    assert response.status_code == 200, response.text
    assert response.json()["fixed_params"]["tts_voice"] == "zh-CN-XiaoxiaoNeural"

    registry = build_default_production_template_registry()
    template = registry.get("petwoods_xhs_daily_copy")
    assert template.fixed_params["tts_voice"] == "zh-CN-XiaoxiaoNeural"


def test_clone_rejects_patch_key_outside_allowed_params():
    client = TestClient(app)
    response = _clone(client, fixed_params_patch={"pipeline_id": "evil"})
    assert response.status_code == 400


def test_clone_rejects_duplicate_id():
    client = TestClient(app)
    # id 冲突：内置模板 id
    response = _clone(client, id=SOURCE_TEMPLATE_ID)
    assert response.status_code == 400

    # id 冲突：已存在的自定义模板
    assert _clone(client).status_code == 200
    assert _clone(client).status_code == 400


def test_clone_can_be_compiled():
    client = TestClient(app)
    assert _clone(client).status_code == 200

    registry = build_default_production_template_registry()
    request = registry.compile_request(
        "petwoods_xhs_daily_copy", input={"script": "克隆模板出片测试"}
    )
    assert request.pipeline_id == "script_to_video"
    assert request.input == {"script": "克隆模板出片测试"}


def test_delete_custom_template_removes_it():
    client = TestClient(app)
    assert _clone(client).status_code == 200

    delete_response = client.delete("/api/generation/templates/petwoods_xhs_daily_copy")
    assert delete_response.status_code == 200
    assert delete_response.json()["deleted"] is True

    listing = client.get("/api/generation/templates").json()
    ids = [template["id"] for template in listing["templates"]]
    assert "petwoods_xhs_daily_copy" not in ids


def test_delete_builtin_template_is_rejected():
    client = TestClient(app)
    response = client.delete(f"/api/generation/templates/{SOURCE_TEMPLATE_ID}")
    assert response.status_code == 400


def test_delete_unknown_template_is_not_found():
    client = TestClient(app)
    response = client.delete("/api/generation/templates/does_not_exist")
    assert response.status_code == 404
