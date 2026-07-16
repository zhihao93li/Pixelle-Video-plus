from pixelle_video.service import PixelleVideoCore
from pixelle_video.services.comfy_base_service import ComfyBaseService


def test_comfykit_config_redaction_hides_secrets_without_changing_runtime_config():
    service = ComfyBaseService(
        {
            "comfyui": {
                "comfyui_url": "http://127.0.0.1:8188",
                "runninghub_api_key": "real-secret",
                "runninghub_instance_type": "plus",
                "runninghub_timeout": 600,
            }
        },
        service_name="image_analysis",
    )

    config = service._prepare_comfykit_config()

    assert config["runninghub_api_key"] == "real-secret"
    assert service._redact_sensitive_config(config) == {
        "comfyui_url": "http://127.0.0.1:8188",
        "runninghub_url": "https://www.runninghub.cn",
        "runninghub_api_key": "***",
        "runninghub_instance_type": "plus",
        "runninghub_timeout": 600,
    }


def test_core_comfykit_config_redaction_hides_secrets_without_changing_runtime_config():
    config = {
        "comfyui_url": "http://127.0.0.1:8188",
        "api_key": "comfy-secret",
        "runninghub_api_key": "runninghub-secret",
        "runninghub_instance_type": "plus",
        "runninghub_timeout": 600,
    }

    redacted = PixelleVideoCore._redact_sensitive_config(config)

    assert config["api_key"] == "comfy-secret"
    assert config["runninghub_api_key"] == "runninghub-secret"
    assert redacted == {
        "comfyui_url": "http://127.0.0.1:8188",
        "api_key": "***",
        "runninghub_api_key": "***",
        "runninghub_instance_type": "plus",
        "runninghub_timeout": 600,
    }
