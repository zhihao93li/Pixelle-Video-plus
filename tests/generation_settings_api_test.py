from fastapi.testclient import TestClient

from api.app import app
from api.dependencies import get_ops_service


class FakeOpsService:
    def __init__(self):
        self.saved_settings = []

    def list_projects(self):
        return {
            "status": "ok",
            "projects": [
                {
                    "id": "project-1",
                    "name": "PetWoods",
                    "product": "PetWoods",
                    "channel": "xiaohongshu",
                    "generation_settings": {
                        "default_production_template_id": "petwoods_xhs_daily_v1"
                    },
                }
            ],
        }

    def list_production_templates(self, project_id=None):
        return {
            "status": "ok",
            "default_template": "petwoods_xhs_daily_v1",
            "templates": [
                {
                    "id": "petwoods_xhs_daily_v1",
                    "display_name": "PetWoods 小红书日常短视频 v1",
                    "user_selectable_providers": [],
                }
            ],
        }

    def set_project_generation_settings(
        self,
        *,
        project_id,
        default_production_template_id,
        source,
    ):
        self.saved_settings.append(
            {
                "project_id": project_id,
                "default_production_template_id": default_production_template_id,
                "source": source,
            }
        )
        return {
            "status": "ok",
            "generation_settings": {
                "default_production_template_id": default_production_template_id
            },
        }


fake_ops_service = FakeOpsService()


async def get_fake_ops_service():
    return fake_ops_service


def test_generation_projects_endpoint_lists_projects_with_generation_settings():
    app.dependency_overrides[get_ops_service] = get_fake_ops_service

    try:
        response = TestClient(app).get("/api/generation/projects")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["projects"][0]["id"] == "project-1"
    assert payload["projects"][0]["generation_settings"][
        "default_production_template_id"
    ] == "petwoods_xhs_daily_v1"


def test_generation_project_template_settings_can_be_read_and_saved():
    fake_ops_service.saved_settings = []
    app.dependency_overrides[get_ops_service] = get_fake_ops_service

    try:
        client = TestClient(app)
        templates_response = client.get("/api/generation/projects/project-1/templates")
        settings_response = client.put(
            "/api/generation/projects/project-1/generation-settings",
            json={
                "default_production_template_id": "petwoods_xhs_quality_explainer_v1"
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert templates_response.status_code == 200
    assert templates_response.json()["default_template"] == "petwoods_xhs_daily_v1"
    assert settings_response.status_code == 200
    assert settings_response.json()["generation_settings"][
        "default_production_template_id"
    ] == "petwoods_xhs_quality_explainer_v1"
    assert fake_ops_service.saved_settings[-1] == {
        "project_id": "project-1",
        "default_production_template_id": "petwoods_xhs_quality_explainer_v1",
        "source": {"kind": "react_production_template_demo"},
    }
