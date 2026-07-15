from pathlib import Path

from pixelle_video.services.video import VideoService


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
