from fastapi.testclient import TestClient

from api.app import app
from api.dependencies import get_pixelle_video
from pixelle_video.models.media import MediaResult


class FakeMediaService:
    def __init__(self):
        self.calls = []

    async def __call__(self, **kwargs):
        self.calls.append(kwargs)
        return MediaResult(
            media_type=kwargs["media_type"],
            url="output/preview.mp4"
            if kwargs["media_type"] == "video"
            else "output/preview.png",
            duration=3.5 if kwargs["media_type"] == "video" else None,
        )


class FakePixelleVideo:
    def __init__(self):
        self.media = FakeMediaService()


fake_pixelle_video = FakePixelleVideo()


async def get_fake_pixelle_video():
    return fake_pixelle_video


def test_media_generate_calls_shared_media_service():
    fake_pixelle_video.media.calls.clear()
    app.dependency_overrides[get_pixelle_video] = get_fake_pixelle_video

    try:
        response = TestClient(app).post(
            "/api/media/generate",
            json={
                "prompt": "warm pet care image",
                "workflow": "runninghub/image_flux.json",
                "media_type": "image",
                "width": 1080,
                "height": 1440,
                "seed": 42,
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["media_type"] == "image"
    assert payload["media_path"] == "output/preview.png"
    assert fake_pixelle_video.media.calls == [
        {
            "prompt": "warm pet care image",
            "workflow": "runninghub/image_flux.json",
            "media_type": "image",
            "width": 1080,
            "height": 1440,
            "duration": None,
            "negative_prompt": None,
            "seed": 42,
        }
    ]


def test_media_generate_supports_video_workflows():
    fake_pixelle_video.media.calls.clear()
    app.dependency_overrides[get_pixelle_video] = get_fake_pixelle_video

    try:
        response = TestClient(app).post(
            "/api/media/generate",
            json={
                "prompt": "a dog running",
                "media_type": "video",
                "width": 720,
                "height": 1280,
                "duration": 4,
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["media_type"] == "video"
    assert payload["media_path"] == "output/preview.mp4"
    assert payload["duration"] == 3.5
