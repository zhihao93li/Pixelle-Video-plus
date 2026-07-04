from fastapi.testclient import TestClient

from api.app import app


def test_files_endpoint_serves_unicode_filename_with_encoded_disposition(
    monkeypatch,
    tmp_path,
):
    monkeypatch.chdir(tmp_path)
    video_path = tmp_path / "output" / "20260703_test" / "PetWoods P8 混剪验证.mp4"
    video_path.parent.mkdir(parents=True)
    video_path.write_bytes(b"fake-video")

    response = TestClient(app).get(
        "/api/files/20260703_test/PetWoods%20P8%20%E6%B7%B7%E5%89%AA%E9%AA%8C%E8%AF%81.mp4"
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "video/mp4"
    disposition = response.headers["content-disposition"]
    assert "filename*=" in disposition
    assert "%E6%B7%B7%E5%89%AA%E9%AA%8C%E8%AF%81.mp4" in disposition
    disposition.encode("latin-1")
