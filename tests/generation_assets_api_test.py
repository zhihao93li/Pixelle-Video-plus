from pathlib import Path

from fastapi.testclient import TestClient

import api.routers.generation as generation_router
from api.app import app


def test_generation_asset_upload_persists_supported_files(monkeypatch, tmp_path):
    monkeypatch.setattr(
        generation_router,
        "GENERATION_ASSET_UPLOAD_DIR",
        tmp_path,
        raising=False,
    )

    response = TestClient(app).post(
        "/api/generation/assets",
        files=[
            ("files", ("../cat photo.jpg", b"image-bytes", "image/jpeg")),
            ("files", ("clip.mp4", b"video-bytes", "video/mp4")),
            ("files", ("voice.wav", b"audio-bytes", "audio/wav")),
        ],
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 3
    assert [asset["kind"] for asset in payload["assets"]] == ["image", "video", "audio"]
    assert payload["assets"][0]["original_filename"] == "cat photo.jpg"
    assert payload["assets"][0]["path"].endswith(".jpg")
    assert Path(payload["assets"][0]["path"]).exists()
    assert Path(payload["assets"][0]["path"]).read_bytes() == b"image-bytes"
    assert Path(payload["assets"][1]["path"]).read_bytes() == b"video-bytes"
    assert Path(payload["assets"][2]["path"]).read_bytes() == b"audio-bytes"


def test_generation_asset_upload_rejects_unsupported_files(monkeypatch, tmp_path):
    monkeypatch.setattr(
        generation_router,
        "GENERATION_ASSET_UPLOAD_DIR",
        tmp_path,
        raising=False,
    )

    response = TestClient(app).post(
        "/api/generation/assets",
        files=[("files", ("notes.txt", b"not media", "text/plain"))],
    )

    assert response.status_code == 400
    assert "Unsupported asset file type" in response.json()["detail"]
    assert list(tmp_path.iterdir()) == []
