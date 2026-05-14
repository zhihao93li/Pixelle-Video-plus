import pytest

from pixelle_video.config.manager import ConfigManager
from pixelle_video.config.schema import PixelleVideoConfig
from pixelle_video.services import tts_service as tts_service_module
from pixelle_video.services.tts_service import TTSService


class FakeFishAudioResponse:
    status_code = 200
    headers = {"content-type": "audio/mpeg"}
    content = b"fake-mp3-bytes"
    text = ""

    def raise_for_status(self):
        return None


class FakeAsyncClient:
    requests = []

    def __init__(self, *args, **kwargs):
        self.kwargs = kwargs

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url, *, headers, json):
        self.__class__.requests.append(
            {
                "url": url,
                "headers": headers,
                "json": json,
                "timeout": self.kwargs.get("timeout"),
            }
        )
        return FakeFishAudioResponse()


def make_service(api_key: str = "fish-test-key") -> TTSService:
    return TTSService(
        {
            "comfyui": {
                "tts": {
                    "inference_mode": "fish",
                    "fish_audio": {
                        "api_key": api_key,
                        "model": "s2-pro",
                        "reference_id": "configured-voice",
                        "format": "mp3",
                        "mp3_bitrate": 128,
                        "latency": "balanced",
                        "temperature": 0.6,
                        "top_p": 0.8,
                        "normalize": True,
                    },
                }
            }
        }
    )


def test_config_manager_updates_fish_audio_config():
    manager = object.__new__(ConfigManager)
    manager.config = PixelleVideoConfig()

    manager.set_tts_fish_audio_config(
        api_key="fish-key",
        reference_id="voice-id",
        model="s2-pro",
    )

    fish_config = manager.config.comfyui.tts.fish_audio
    assert fish_config.api_key == "fish-key"
    assert fish_config.reference_id == "voice-id"
    assert fish_config.model == "s2-pro"


@pytest.mark.asyncio
async def test_fish_audio_tts_posts_request_and_saves_binary_audio(monkeypatch, tmp_path):
    FakeAsyncClient.requests = []
    monkeypatch.setattr(tts_service_module.httpx, "AsyncClient", FakeAsyncClient)

    output_path = tmp_path / "voice.mp3"
    result = await make_service()(
        text="Hello from Pixelle",
        inference_mode="fish",
        output_path=str(output_path),
        reference_id="runtime-voice",
        speed=1.4,
    )

    assert result == str(output_path)
    assert output_path.read_bytes() == b"fake-mp3-bytes"

    assert len(FakeAsyncClient.requests) == 1
    request = FakeAsyncClient.requests[0]
    assert request["url"] == "https://api.fish.audio/v1/tts"
    assert request["headers"]["Authorization"] == "Bearer fish-test-key"
    assert request["headers"]["Content-Type"] == "application/json"
    assert request["headers"]["model"] == "s2-pro"
    assert request["json"] == {
        "text": "Hello from Pixelle",
        "reference_id": "runtime-voice",
        "temperature": 0.6,
        "top_p": 0.8,
        "prosody": {
            "speed": 1.4,
            "volume": 0.0,
            "normalize_loudness": True,
        },
        "chunk_length": 300,
        "normalize": True,
        "format": "mp3",
        "mp3_bitrate": 128,
        "latency": "balanced",
        "max_new_tokens": 1024,
        "repetition_penalty": 1.2,
        "min_chunk_length": 50,
        "condition_on_previous_chunks": True,
        "early_stop_threshold": 1.0,
    }


@pytest.mark.asyncio
async def test_fish_audio_tts_requires_api_key(tmp_path):
    output_path = tmp_path / "voice.mp3"

    with pytest.raises(ValueError, match="Fish Audio API key"):
        await make_service(api_key="")(
            text="Hello from Pixelle",
            inference_mode="fish",
            output_path=str(output_path),
        )

    assert not output_path.exists()
