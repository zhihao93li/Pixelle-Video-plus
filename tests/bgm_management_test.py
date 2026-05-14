from dataclasses import dataclass
from pathlib import Path

import pytest

from pixelle_video.services.video import VideoService
from web.components.content_input import save_uploaded_bgm_file


@dataclass
class FakeUploadedFile:
    name: str
    content: bytes

    def getbuffer(self):
        return self.content


def test_save_uploaded_bgm_file_writes_audio_to_custom_bgm_dir(tmp_path):
    saved_name = save_uploaded_bgm_file(
        FakeUploadedFile(name="fresh-track.mp3", content=b"custom-bgm"),
        target_dir=tmp_path,
    )

    assert saved_name == "fresh-track.mp3"
    assert (tmp_path / saved_name).read_bytes() == b"custom-bgm"


def test_save_uploaded_bgm_file_rejects_unsupported_file_type(tmp_path):
    with pytest.raises(ValueError, match="Unsupported BGM file type"):
        save_uploaded_bgm_file(
            FakeUploadedFile(name="not-a-song.txt", content=b"text"),
            target_dir=tmp_path,
        )

    assert list(tmp_path.iterdir()) == []


def test_save_uploaded_bgm_file_sanitizes_path_like_names(tmp_path):
    saved_name = save_uploaded_bgm_file(
        FakeUploadedFile(name="../../unsafe name.mp3", content=b"audio"),
        target_dir=tmp_path,
    )

    assert saved_name == "unsafe_name.mp3"
    assert (tmp_path / saved_name).read_bytes() == b"audio"


def test_concat_single_video_adds_bgm_when_requested(monkeypatch, tmp_path):
    input_video = tmp_path / "segment.mp4"
    input_video.write_bytes(b"video")
    output_video = tmp_path / "final.mp4"

    service = VideoService()
    service._ffmpeg_checked = True
    calls = []

    def fake_add_bgm_to_video(*, video, bgm_path, output, volume, mode):
        calls.append(
            {
                "video": video,
                "bgm_path": bgm_path,
                "output": output,
                "volume": volume,
                "mode": mode,
            }
        )
        Path(output).write_bytes(b"video-with-bgm")
        return output

    monkeypatch.setattr(service, "_add_bgm_to_video", fake_add_bgm_to_video)

    result = service.concat_videos(
        videos=[str(input_video)],
        output=str(output_video),
        bgm_path="fresh-track.mp3",
        bgm_volume=0.33,
        bgm_mode="once",
    )

    assert result == str(output_video)
    assert output_video.read_bytes() == b"video-with-bgm"
    assert calls == [
        {
            "video": str(input_video),
            "bgm_path": "fresh-track.mp3",
            "output": str(output_video),
            "volume": 0.33,
            "mode": "once",
        }
    ]
