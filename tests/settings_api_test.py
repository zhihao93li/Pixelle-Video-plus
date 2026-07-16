from fastapi.testclient import TestClient

from api.app import app
from api.dependencies import get_config_manager
from api.routers import settings as settings_router
from pixelle_video.config.schema import PixelleVideoConfig


class FakeConfigManager:
    def __init__(self):
        self.config = PixelleVideoConfig(
            llm={
                "api_key": "llm-key",
                "base_url": "https://aihubmix.com/v1",
                "model": "deepseek-v4-flash",
            },
            comfyui={
                "comfyui_url": "http://127.0.0.1:8188",
                "runninghub_concurrent_limit": 1,
            },
            publish={
                "buffer": {
                    "api_key": "buffer-key",
                    "channels": {"youtube": "yt-channel"},
                },
                "cos": {
                    "region": "ap-singapore",
                    "bucket": "bucket-123",
                    "secret_id": "secret-id",
                    "secret_key": "secret-key",
                    "public_base_url": "https://bucket.example.com",
                },
            },
        )
        self.saved = 0
        self.reloads = 0

    def validate(self):
        return self.config.validate_required()

    def update(self, updates):
        current = self.config.to_dict()
        _deep_merge(current, updates)
        self.config = PixelleVideoConfig(**current)

    def save(self):
        self.saved += 1

    def reload(self):
        self.reloads += 1


fake_config_manager = FakeConfigManager()


async def get_fake_config_manager():
    return fake_config_manager


def test_settings_config_endpoint_returns_current_configuration():
    app.dependency_overrides[get_config_manager] = get_fake_config_manager

    try:
        response = TestClient(app).get("/api/settings/config")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["configured"] is True
    assert payload["config"]["llm"]["api_key"] == ""
    assert payload["config"]["llm"]["api_key_configured"] is True
    assert payload["config"]["publish"]["buffer"]["channels"]["youtube"] == "yt-channel"
    assert payload["config"]["publish"]["buffer"]["api_key"] == ""
    assert payload["config"]["publish"]["buffer"]["api_key_configured"] is True
    assert payload["config"]["publish"]["cos"]["secret_id"] == ""
    assert payload["config"]["publish"]["cos"]["secret_id_configured"] is True
    assert payload["config"]["publish"]["cos"]["secret_key"] == ""
    assert payload["config"]["publish"]["cos"]["secret_key_configured"] is True
    assert payload["config"]["image_generation"]["aliyun_bailian"]["api_key"] == ""


def test_image_provider_settings_preserve_secret_when_update_omits_key():
    fake_config_manager.config = PixelleVideoConfig(
        image_generation={
            "aliyun_bailian": {
                "enabled": True,
                "api_key": "existing-secret",
                "workspace_id": "workspace-1",
            }
        }
    )
    app.dependency_overrides[get_config_manager] = get_fake_config_manager

    try:
        client = TestClient(app)
        listed = client.get("/api/settings/image-providers")
        updated = client.put(
            "/api/settings/image-providers/aliyun_bailian",
            json={"concurrency_limit": 3},
        )
    finally:
        app.dependency_overrides.clear()

    assert listed.status_code == 200
    assert listed.json()["providers"][0]["configured"] is True
    assert "api_key" not in listed.json()["providers"][0]
    assert updated.status_code == 200
    assert fake_config_manager.config.image_generation.aliyun_bailian.api_key == "existing-secret"
    assert fake_config_manager.config.image_generation.aliyun_bailian.concurrency_limit == 3


def test_settings_diagnostics_endpoint_returns_redacted_readiness_checks():
    fake_config_manager.config = PixelleVideoConfig(
        llm={
            "api_key": "llm-key",
            "base_url": "https://aihubmix.com/v1",
            "model": "deepseek-v4-flash",
        },
        comfyui={
            "comfyui_url": "http://127.0.0.1:8188",
            "runninghub_api_key": "runninghub-secret",
            "runninghub_timeout": 600,
            "tts": {
                "fish_audio": {
                    "api_key": "fish-secret",
                    "reference_id": "fish-reference",
                }
            },
            "image": {"default_workflow": "runninghub/image_flux.json"},
            "video": {"default_workflow": "runninghub/video_wan2.2.json"},
        },
        publish={
            "buffer": {
                "api_key": "buffer-secret",
                "channels": {"youtube": "yt-channel"},
            },
            "cos": {
                "region": "ap-singapore",
                "bucket": "bucket-123",
                "secret_id": "secret-id",
                "secret_key": "secret-key",
                "public_base_url": "https://bucket.example.com",
            },
        },
    )
    app.dependency_overrides[get_config_manager] = get_fake_config_manager

    try:
        response = TestClient(app).get("/api/settings/diagnostics")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    check_ids = {check["id"] for check in payload["checks"]}
    assert "runninghub_config" in check_ids
    assert "runninghub_timeout" in check_ids
    assert "fish_audio_config" in check_ids
    rendered = str(payload)
    assert "runninghub-secret" not in rendered
    assert "fish-secret" not in rendered
    assert "buffer-secret" not in rendered


def test_settings_config_endpoint_saves_schema_valid_updates():
    fake_config_manager.saved = 0
    app.dependency_overrides[get_config_manager] = get_fake_config_manager

    try:
        response = TestClient(app).put(
            "/api/settings/config",
            json={
                "llm": {
                    "api_key": "new-key",
                    "base_url": "https://aihubmix.com/v1",
                    "model": "gpt-4.1",
                },
                "comfyui": {
                    "comfyui_url": "http://127.0.0.1:8189",
                    "runninghub_concurrent_limit": 2,
                    "runninghub_instance_type": "plus",
                    "runninghub_timeout": 300,
                    "tts": {
                        "inference_mode": "fish",
                        "fish_audio": {
                            "api_key": "fish-key",
                            "model": "s2-pro",
                            "reference_id": "voice-1",
                            "base_url": "https://api.fish.audio",
                        }
                    },
                },
                "publish": {
                    "buffer": {
                        "api_key": "buffer-new",
                        "channels": {"youtube": "yt-new", "instagram": "ig-new"},
                    },
                    "cos": {
                        "region": "ap-hongkong",
                        "bucket": "new-bucket-123",
                        "secret_id": "cos-id",
                        "secret_key": "cos-key",
                        "public_base_url": "https://new-bucket.example.com/",
                        "endpoint_url": "",
                    },
                },
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["config"]["llm"]["model"] == "gpt-4.1"
    assert payload["config"]["comfyui"]["runninghub_instance_type"] == "plus"
    assert payload["config"]["comfyui"]["runninghub_timeout"] == 300
    assert payload["config"]["comfyui"]["tts"]["inference_mode"] == "fish"
    assert payload["config"]["publish"]["cos"]["public_base_url"] == (
        "https://new-bucket.example.com/"
    )
    assert fake_config_manager.saved == 1


def test_settings_redacted_roundtrip_preserves_and_explicit_clear_removes_secret():
    fake_config_manager.config = PixelleVideoConfig(
        llm={
            "api_key": "keep-me",
            "base_url": "https://aihubmix.com/v1",
            "model": "model-before",
        }
    )
    app.dependency_overrides[get_config_manager] = get_fake_config_manager
    try:
        client = TestClient(app)
        preserved = client.put(
            "/api/settings/config",
            json={
                "llm": {
                    "api_key": "",
                    "api_key_configured": True,
                    "base_url": "https://aihubmix.com/v1",
                    "model": "model-after",
                }
            },
        )
        assert preserved.status_code == 200
        assert fake_config_manager.config.llm.api_key == "keep-me"
        assert fake_config_manager.config.llm.model == "model-after"

        cleared = client.put(
            "/api/settings/config",
            json={"llm": {"api_key": "", "clear_api_key": True}},
        )
    finally:
        app.dependency_overrides.clear()

    assert cleared.status_code == 200
    assert fake_config_manager.config.llm.api_key == ""
    assert cleared.json()["config"]["llm"]["api_key_configured"] is False


def test_settings_config_reset_endpoint_restores_schema_defaults():
    fake_config_manager.saved = 0
    fake_config_manager.config = PixelleVideoConfig(
        llm={
            "api_key": "llm-key",
            "base_url": "https://aihubmix.com/v1",
            "model": "deepseek-v4-flash",
        },
    )
    app.dependency_overrides[get_config_manager] = get_fake_config_manager

    try:
        response = TestClient(app).post("/api/settings/config/reset")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["config"]["llm"]["api_key"] == ""
    assert payload["configured"] is False
    assert fake_config_manager.saved == 1


def test_settings_config_endpoint_rejects_invalid_schema_update():
    app.dependency_overrides[get_config_manager] = get_fake_config_manager

    try:
        response = TestClient(app).put(
            "/api/settings/config",
            json={"comfyui": {"runninghub_concurrent_limit": 99}},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422
    assert "runninghub_concurrent_limit" in str(response.json())


def test_settings_llm_model_endpoint_loads_models(monkeypatch):
    def fake_fetch_available_models(api_key, base_url):
        assert api_key == "llm-key"
        assert base_url == "https://aihubmix.com/v1"
        return ["deepseek-v4-flash", "gpt-4.1"]

    monkeypatch.setattr(
        settings_router,
        "fetch_available_models",
        fake_fetch_available_models,
    )

    response = TestClient(app).post(
        "/api/settings/llm/models",
        json={"api_key": "llm-key", "base_url": "https://aihubmix.com/v1"},
    )

    assert response.status_code == 200
    assert response.json()["models"] == ["deepseek-v4-flash", "gpt-4.1"]


def test_settings_llm_model_catalog_uses_real_configured_provider(monkeypatch):
    fake_config_manager.config = PixelleVideoConfig(
        llm={
            "api_key": "llm-key",
            "base_url": "https://aihubmix.com/v1",
            "model": "gpt-4.1",
        }
    )
    monkeypatch.setattr(
        settings_router,
        "fetch_available_models",
        lambda api_key, base_url, *, provider_type="": [
            "gpt-4.1",
            "claude-sonnet-4",
            "qwen-max",
        ],
    )
    app.dependency_overrides[get_config_manager] = get_fake_config_manager
    try:
        response = TestClient(app).get("/api/settings/llm/model-catalog")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["configured"] is True
    assert payload["default_provider_id"] == "aihubmix"
    assert [provider["id"] for provider in payload["providers"]] == ["aihubmix"]
    assert payload["providers"][0]["provider_type"] == "aihubmix"
    assert payload["providers"][0]["default_model"] == "gpt-4.1"
    assert [model["id"] for model in payload["providers"][0]["models"]] == [
        "claude-sonnet-4",
        "gpt-4.1",
        "qwen-max",
    ]
    assert not any("selected" in provider for provider in payload["providers"])


def test_settings_llm_provider_presets_are_exposed_by_backend():
    response = TestClient(app).get("/api/settings/llm/provider-presets")

    assert response.status_code == 200
    providers = {provider["id"]: provider for provider in response.json()["providers"]}
    assert providers["aihubmix"] == {
        "id": "aihubmix",
        "label": "AiHubMix",
        "base_url": "https://aihubmix.com/v1",
    }
    assert providers["openai"] == {
        "id": "openai",
        "label": "OpenAI",
        "base_url": "https://api.openai.com/v1",
    }
    assert {
        provider_id: providers[provider_id]["base_url"]
        for provider_id in ("deepseek", "minimax", "kimi", "anthropic", "xai")
    } == {
        "deepseek": "https://api.deepseek.com",
        "minimax": "https://api.minimaxi.com/v1",
        "kimi": "https://api.moonshot.cn/v1",
        "anthropic": "https://api.anthropic.com/v1/",
        "xai": "https://api.x.ai/v1",
    }


def test_settings_support_multiple_real_llm_providers_and_default_selection(monkeypatch):
    fake_config_manager.config = PixelleVideoConfig()
    app.dependency_overrides[get_config_manager] = get_fake_config_manager
    client = TestClient(app)
    try:
        aihubmix = client.put(
            "/api/settings/llm/providers/aihubmix-main",
            json={
                "name": "AiHubMix 主账号",
                "provider_type": "aihubmix",
                "enabled": True,
                "api_key": "aihub-secret",
                "base_url": "https://aihubmix.com/v1",
                "default_model": "claude-sonnet-4",
            },
        )
        openai = client.put(
            "/api/settings/llm/providers/openai-direct",
            json={
                "name": "OpenAI 直连",
                "provider_type": "openai",
                "enabled": True,
                "api_key": "openai-secret",
                "base_url": "https://api.openai.com/v1",
                "default_model": "gpt-4.1",
            },
        )
        selected = client.put("/api/settings/llm/default-provider/openai-direct")
    finally:
        app.dependency_overrides.clear()

    assert aihubmix.status_code == 200, aihubmix.text
    assert openai.status_code == 200, openai.text
    assert selected.status_code == 200, selected.text
    assert set(fake_config_manager.config.llm.providers) == {
        "aihubmix-main",
        "openai-direct",
    }
    assert fake_config_manager.config.llm.default_provider_id == "openai-direct"
    assert fake_config_manager.config.llm.providers["openai-direct"].api_key == "openai-secret"
    assert selected.json()["config"]["llm"]["providers"]["openai-direct"]["api_key"] == ""
    assert (
        selected.json()["config"]["llm"]["providers"]["openai-direct"][
            "api_key_configured"
        ]
        is True
    )


def test_llm_model_catalog_calls_each_provider_own_endpoint(monkeypatch):
    fake_config_manager.config = PixelleVideoConfig(
        llm={
            "default_provider_id": "aihubmix-main",
            "providers": {
                "aihubmix-main": {
                    "name": "AiHubMix 主账号",
                    "provider_type": "aihubmix",
                    "api_key": "a-key",
                    "base_url": "https://aihubmix.com/v1",
                    "default_model": "claude-sonnet-4",
                },
                "openai-direct": {
                    "name": "OpenAI 直连",
                    "provider_type": "openai",
                    "api_key": "o-key",
                    "base_url": "https://api.openai.com/v1",
                    "default_model": "gpt-4.1",
                },
            },
        }
    )
    calls = []

    def fake_fetch(api_key, base_url, *, provider_type=""):
        calls.append((api_key, base_url, provider_type))
        return ["gpt-4.1"] if "openai.com" in base_url else ["claude-sonnet-4"]

    monkeypatch.setattr(settings_router, "fetch_available_models", fake_fetch)
    app.dependency_overrides[get_config_manager] = get_fake_config_manager
    try:
        response = TestClient(app).get("/api/settings/llm/model-catalog")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200, response.text
    assert calls == [
        ("a-key", "https://aihubmix.com/v1", "aihubmix"),
        ("o-key", "https://api.openai.com/v1", "openai"),
    ]
    assert [provider["id"] for provider in response.json()["providers"]] == [
        "aihubmix-main",
        "openai-direct",
    ]


def test_settings_llm_test_endpoint_returns_connection_result(monkeypatch):
    def fake_test_llm_connection(api_key, base_url):
        assert api_key == "llm-key"
        assert base_url == "https://aihubmix.com/v1"
        return True, "ok", 2

    monkeypatch.setattr(
        settings_router,
        "test_llm_connection",
        fake_test_llm_connection,
    )

    response = TestClient(app).post(
        "/api/settings/llm/test",
        json={"api_key": "llm-key", "base_url": "https://aihubmix.com/v1"},
    )

    assert response.status_code == 200
    assert response.json() == {"ok": True, "message": "ok", "model_count": 2}


def test_settings_comfyui_test_endpoint_returns_real_status(monkeypatch):
    async def fake_test_comfyui_connection(comfyui_url):
        assert comfyui_url == "http://127.0.0.1:8188"
        return settings_router.ComfyuiConnectionResponse(
            ok=False,
            message="Connection refused",
        )

    monkeypatch.setattr(
        settings_router,
        "_test_comfyui_connection",
        fake_test_comfyui_connection,
    )

    response = TestClient(app).post(
        "/api/settings/comfyui/test",
        json={"comfyui_url": "http://127.0.0.1:8188/"},
    )

    assert response.status_code == 200
    assert response.json() == {"ok": False, "message": "Connection refused"}


def test_settings_runninghub_workflow_endpoints_register_wrapper(tmp_path):
    previous_dir = settings_router.RUNNINGHUB_WORKFLOWS_DIR
    settings_router.RUNNINGHUB_WORKFLOWS_DIR = tmp_path

    try:
        create_response = TestClient(app).post(
            "/api/settings/runninghub/workflows",
            json={
                "kind": "video",
                "name": "wan custom",
                "workflow_id": "1985909483975188481",
            },
        )
        list_response = TestClient(app).get("/api/settings/runninghub/workflows")
    finally:
        settings_router.RUNNINGHUB_WORKFLOWS_DIR = previous_dir

    assert create_response.status_code == 200
    payload = create_response.json()
    assert payload["workflow"]["key"] == "runninghub/video_wan_custom.json"
    assert payload["workflow"]["workflow_id"] == "1985909483975188481"
    assert list_response.status_code == 200
    assert list_response.json()["workflows"][0]["key"] == ("runninghub/video_wan_custom.json")


def test_settings_buffer_channels_endpoint_maps_supported_channels(monkeypatch):
    class FakeBufferPublisher:
        def __init__(self, *, api_key):
            assert api_key == "buffer-key"

        async def list_channels(self, organization_id=None):
            assert organization_id is None
            return [
                {
                    "id": "yt-channel",
                    "name": "PetWoods",
                    "displayName": "PetWoods YouTube",
                    "service": "youtube",
                    "isQueuePaused": False,
                }
            ]

        @classmethod
        def supported_channel_ids_from_channels(cls, channels):
            assert len(channels) == 1
            return {"youtube": "yt-channel"}

    monkeypatch.setattr(settings_router, "BufferPublisher", FakeBufferPublisher)

    response = TestClient(app).post(
        "/api/settings/buffer/channels",
        json={"api_key": "buffer-key"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["detected_channels"] == {"youtube": "yt-channel"}
    assert payload["channels"][0]["displayName"] == "PetWoods YouTube"


def _deep_merge(base, updates):
    for key, value in updates.items():
        if key in base and isinstance(base[key], dict) and isinstance(value, dict):
            _deep_merge(base[key], value)
        else:
            base[key] = value
    return base
