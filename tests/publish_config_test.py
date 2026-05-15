import pytest

from pixelle_video.config.manager import ConfigManager
from pixelle_video.services.persistence import PersistenceService
from pixelle_video.services.publish_manager import PublishManager


@pytest.fixture(autouse=True)
def reset_config_manager_singleton():
    previous_instance = ConfigManager._instance
    ConfigManager._instance = None
    yield
    ConfigManager._instance = previous_instance


def test_config_manager_saves_and_reloads_publish_config(tmp_path):
    config_path = tmp_path / "config.yaml"
    manager = ConfigManager(str(config_path))

    manager.set_publish_config(
        buffer_api_key="buffer-key",
        buffer_channel_tiktok="channel-tiktok",
        buffer_channel_youtube="channel-youtube",
        buffer_channel_x="channel-x",
        r2_account_id="account",
        r2_bucket="pixlle-publish",
        r2_access_key_id="r2-access",
        r2_secret_access_key="r2-secret",
        r2_public_base_url="https://media.example.com",
    )
    manager.save()

    ConfigManager._instance = None
    reloaded = ConfigManager(str(config_path))

    assert reloaded.get_publish_config() == {
        "buffer": {
            "api_key": "buffer-key",
            "channels": {
                "tiktok": "channel-tiktok",
                "youtube": "channel-youtube",
                "x": "channel-x",
            },
        },
        "r2": {
            "account_id": "account",
            "bucket": "pixlle-publish",
            "access_key_id": "r2-access",
            "secret_access_key": "r2-secret",
            "public_base_url": "https://media.example.com",
            "endpoint_url": None,
        },
    }


def test_publish_manager_uses_publish_config_channels(tmp_path):
    persistence = PersistenceService(output_dir=str(tmp_path))

    manager = PublishManager(
        persistence=persistence,
        publish_config={
            "buffer": {
                "api_key": "buffer-key",
                "channels": {
                    "youtube": "channel-youtube",
                    "x": "channel-x",
                },
            },
            "r2": {},
        },
    )

    assert manager.channel_ids == {
        "youtube": "channel-youtube",
        "x": "channel-x",
    }
