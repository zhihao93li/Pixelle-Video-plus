from fastapi.testclient import TestClient

from api.app import app
from api.routers import resources as resources_router


def test_bgm_upload_persists_custom_audio_and_lists_it(monkeypatch, tmp_path):
    monkeypatch.setattr(
        resources_router,
        "get_data_path",
        lambda *parts: str(tmp_path.joinpath(*parts)),
    )
    monkeypatch.setattr(
        resources_router,
        "get_root_path",
        lambda *parts: str(tmp_path.joinpath("root", *parts)),
    )

    response = TestClient(app).post(
        "/api/resources/bgm/upload",
        files={"file": ("fresh track.mp3", b"custom-bgm", "audio/mpeg")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["bgm_file"] == {
        "name": "fresh_track.mp3",
        "path": "data/bgm/fresh_track.mp3",
        "source": "custom",
    }
    assert (tmp_path / "bgm" / "fresh_track.mp3").read_bytes() == b"custom-bgm"
    assert payload["bgm_files"] == [payload["bgm_file"]]


def test_bgm_upload_rejects_unsupported_file_type(monkeypatch, tmp_path):
    monkeypatch.setattr(
        resources_router,
        "get_data_path",
        lambda *parts: str(tmp_path.joinpath(*parts)),
    )

    response = TestClient(app).post(
        "/api/resources/bgm/upload",
        files={"file": ("notes.txt", b"not audio", "text/plain")},
    )

    assert response.status_code == 400
    assert "Unsupported BGM file type" in response.json()["detail"]
