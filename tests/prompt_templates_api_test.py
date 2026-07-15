from fastapi.testclient import TestClient

from api.app import app
from api.routers import drafting as drafting_router
from pixelle_video.generation import drafting_support


def test_custom_prompt_can_be_created_renamed_and_deleted(tmp_path, monkeypatch):
    def fake_get_data_path(*parts):
        return str(tmp_path.joinpath(*parts))

    monkeypatch.setattr(drafting_router, "get_data_path", fake_get_data_path)
    monkeypatch.setattr(drafting_support, "get_data_path", fake_get_data_path)
    client = TestClient(app)

    created = client.post(
        "/api/drafting/prompt-templates",
        json={
            "kind": "script",
            "name": "我的口播",
            "content": "围绕 {topic} 写一段文案。",
        },
    )
    assert created.status_code == 200, created.text
    original_name = created.json()["name"]

    renamed = client.put(
        "/api/drafting/prompt-templates",
        json={
            "kind": "script",
            "name": original_name,
            "new_name": "品牌口播",
            "content": "围绕 {topic} 写一段品牌口播。",
        },
    )
    assert renamed.status_code == 200, renamed.text
    renamed_name = renamed.json()["name"]
    listing = client.get("/api/drafting/prompt-templates").json()
    assert any(
        item["name"] == renamed_name and "品牌口播" in item["content"]
        for item in listing["script_templates"]
    )

    deleted = client.delete(
        "/api/drafting/prompt-templates",
        params={"kind": "script", "name": renamed_name},
    )
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["deleted"] is True


def test_builtin_prompt_cannot_be_modified(tmp_path, monkeypatch):
    def fake_get_data_path(*parts):
        return str(tmp_path.joinpath(*parts))

    monkeypatch.setattr(drafting_router, "get_data_path", fake_get_data_path)
    monkeypatch.setattr(drafting_support, "get_data_path", fake_get_data_path)
    response = TestClient(app).put(
        "/api/drafting/prompt-templates",
        json={
            "kind": "script",
            "name": "Short Oral Script",
            "content": "不要覆盖内置提示词",
        },
    )
    assert response.status_code == 400
    assert "内置模板不可修改" in response.json()["detail"]
