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
        buffer_channel_instagram="channel-instagram",
        buffer_channel_pinterest="channel-pinterest",
        buffer_channel_tiktok="channel-tiktok",
        buffer_channel_youtube="channel-youtube",
        buffer_channel_x="channel-x",
        cos_region="ap-hongkong",
        cos_bucket="pixlle-publish-1250000000",
        cos_secret_id="cos-secret-id",
        cos_secret_key="cos-secret-key",
        cos_public_base_url="https://pixlle-publish-1250000000.cos.ap-hongkong.myqcloud.com",
    )
    manager.save()

    ConfigManager._instance = None
    reloaded = ConfigManager(str(config_path))

    assert reloaded.get_publish_config() == {
        "buffer": {
            "api_key": "buffer-key",
            "channels": {
                "instagram": "channel-instagram",
                "pinterest": "channel-pinterest",
                "tiktok": "channel-tiktok",
                "youtube": "channel-youtube",
                "x": "channel-x",
            },
        },
        "cos": {
            "region": "ap-hongkong",
            "bucket": "pixlle-publish-1250000000",
            "secret_id": "cos-secret-id",
            "secret_key": "cos-secret-key",
            "public_base_url": "https://pixlle-publish-1250000000.cos.ap-hongkong.myqcloud.com",
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
                    "instagram": "channel-instagram",
                    "pinterest": "channel-pinterest",
                    "youtube": "channel-youtube",
                    "x": "channel-x",
                },
            },
            "cos": {},
        },
    )

    assert manager.channel_ids == {
        "instagram": "channel-instagram",
        "pinterest": "channel-pinterest",
        "youtube": "channel-youtube",
        "x": "channel-x",
    }
