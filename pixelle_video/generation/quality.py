import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from PIL import Image, ImageStat


def build_asset_manifest(
    *,
    video_path: str,
    storyboard: Any = None,
    bgm_path: str | None = None,
) -> dict[str, Any]:
    assets: list[dict[str, Any]] = []

    _append_asset(assets, role="final_video", kind="video", path=video_path)

    for frame in getattr(storyboard, "frames", []) or []:
        frame_index = getattr(frame, "index", None)
        narration = getattr(frame, "narration", None)
        _append_asset(
            assets,
            role="narration_audio",
            kind="audio",
            path=getattr(frame, "audio_path", None),
            frame_index=frame_index,
        )
        _append_asset(
            assets,
            role="primary_visual",
            kind=_visual_kind(frame),
            path=getattr(frame, "image_path", None) or getattr(frame, "video_path", None),
            frame_index=frame_index,
        )
        _append_asset(
            assets,
            role="composed_frame",
            kind="image",
            path=getattr(frame, "composed_image_path", None),
            frame_index=frame_index,
            required=False,
        )
        _append_asset(
            assets,
            role="video_segment",
            kind="video",
            path=getattr(frame, "video_segment_path", None),
            frame_index=frame_index,
            required=False,
        )
        if narration:
            _append_asset(
                assets,
                role="subtitle_text",
                kind="subtitle",
                text=str(narration),
                frame_index=frame_index,
            )

    _append_asset(assets, role="bgm", kind="audio", path=bgm_path, required=False)

    return {
        "schema_version": "2026-06-30",
        "assets": assets,
        "summary": {
            "total": len(assets),
            "by_role": _count_by_key(assets, "role"),
            "by_kind": _count_by_key(assets, "kind"),
        },
    }


def run_quality_review(
    video_path: str,
    *,
    expected_duration: float | None = None,
    quality_profile: str = "basic",
    allow_silent: bool = False,
) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    path = Path(video_path)

    file_exists = path.is_file()
    checks.append(
        _check(
            "file_exists",
            "passed" if file_exists else "failed",
            "Video file exists." if file_exists else "Video file is missing.",
            path=str(path),
        )
    )

    file_size = path.stat().st_size if file_exists else 0
    checks.append(
        _check(
            "file_size_bytes",
            "passed" if file_size > 0 else "failed",
            "Video file is not empty." if file_size > 0 else "Video file is empty.",
            value=file_size,
        )
    )

    probe = _probe_video(path) if file_exists else None
    probe_ok = bool(probe and probe.get("ok"))
    video_streams = _streams(probe, "video")
    audio_streams = _streams(probe, "audio")
    probed_duration = _duration_from_probe(probe)
    duration = probed_duration if probed_duration is not None else expected_duration

    checks.append(
        _check(
            "video_playable",
            "passed" if probe_ok and video_streams else "failed",
            "Video is playable." if probe_ok and video_streams else _probe_error_message(probe),
            value=bool(probe_ok and video_streams),
        )
    )
    checks.append(
        _check(
            "audio_present",
            "passed" if audio_streams or allow_silent else "failed",
            (
                "Video has an audio stream."
                if audio_streams
                else "Silent video is allowed by this template."
                if allow_silent
                else "Video has no audio stream."
            ),
            value=bool(audio_streams),
        )
    )
    checks.append(
        _check(
            "duration_seconds",
            "passed" if duration is not None and duration > 0 else "failed",
            (
                "Video duration is available."
                if duration is not None and duration > 0
                else "Video duration is missing or zero."
            ),
            value=duration,
            expected=expected_duration,
        )
    )
    checks.append(_black_frame_check(path, playable=probe_ok and bool(video_streams)))

    status = _overall_status(checks)
    return {
        "schema_version": "2026-06-30",
        "status": status,
        "quality_profile": quality_profile,
        "summary": _quality_summary(status, checks),
        "checks": checks,
    }


def _append_asset(
    assets: list[dict[str, Any]],
    *,
    role: str,
    kind: str,
    path: str | None = None,
    text: str | None = None,
    frame_index: int | None = None,
    required: bool = True,
) -> None:
    if not path and text is None:
        if required:
            assets.append(
                {
                    "role": role,
                    "kind": kind,
                    "status": "missing",
                    **({"frame_index": frame_index} if frame_index is not None else {}),
                }
            )
        return

    asset = {
        "role": role,
        "kind": kind,
        "status": "available",
    }
    if path:
        asset["path"] = path
        asset["exists"] = Path(path).exists() if not _is_url(path) else None
    if text is not None:
        asset["text"] = text
    if frame_index is not None:
        asset["frame_index"] = frame_index
    assets.append(asset)


def _visual_kind(frame: Any) -> str:
    media_type = getattr(frame, "media_type", None)
    if media_type in {"image", "video"}:
        return media_type
    if getattr(frame, "video_path", None):
        return "video"
    return "image"


def _count_by_key(rows: list[dict[str, Any]], key: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        value = str(row.get(key) or "unknown")
        counts[value] = counts.get(value, 0) + 1
    return counts


def _probe_video(path: Path) -> dict[str, Any]:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return {"ok": False, "error": "ffprobe is not available."}

    try:
        completed = subprocess.run(
            [
                ffprobe,
                "-v",
                "error",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
                str(path),
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=20,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"ok": False, "error": str(exc)}

    if completed.returncode != 0:
        return {"ok": False, "error": completed.stderr.strip() or "ffprobe failed."}

    try:
        return {"ok": True, "data": json.loads(completed.stdout or "{}")}
    except json.JSONDecodeError as exc:
        return {"ok": False, "error": f"ffprobe returned invalid JSON: {exc}"}


def _streams(probe: dict[str, Any] | None, codec_type: str) -> list[dict[str, Any]]:
    if not probe or not probe.get("ok"):
        return []
    data = probe.get("data") or {}
    return [
        stream
        for stream in data.get("streams", [])
        if stream.get("codec_type") == codec_type
    ]


def _duration_from_probe(probe: dict[str, Any] | None) -> float | None:
    if not probe or not probe.get("ok"):
        return None
    data = probe.get("data") or {}
    raw_duration = (data.get("format") or {}).get("duration")
    if raw_duration is None:
        return None
    try:
        return float(raw_duration)
    except (TypeError, ValueError):
        return None


def _probe_error_message(probe: dict[str, Any] | None) -> str:
    if probe and probe.get("error"):
        return f"Video is not playable: {probe['error']}"
    return "Video is not playable."


def _black_frame_check(path: Path, *, playable: bool) -> dict[str, Any]:
    if not playable:
        return _check(
            "black_frame_sample",
            "failed",
            "Cannot sample video frames because the video is not playable.",
            value=None,
        )

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return _check(
            "black_frame_sample",
            "warning",
            "ffmpeg is not available, so black-frame sampling was skipped.",
            value=None,
        )

    with tempfile.TemporaryDirectory() as tmp_dir:
        sample_path = Path(tmp_dir) / "sample.png"
        try:
            completed = subprocess.run(
                [
                    ffmpeg,
                    "-y",
                    "-v",
                    "error",
                    "-i",
                    str(path),
                    "-frames:v",
                    "1",
                    str(sample_path),
                ],
                check=False,
                capture_output=True,
                text=True,
                timeout=20,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            return _check("black_frame_sample", "failed", str(exc), value=None)

        if completed.returncode != 0 or not sample_path.is_file():
            return _check(
                "black_frame_sample",
                "failed",
                completed.stderr.strip() or "Unable to extract a video frame.",
                value=None,
            )

        with Image.open(sample_path) as image:
            grayscale = image.convert("L")
            mean_brightness = ImageStat.Stat(grayscale).mean[0]

    is_black = mean_brightness < 8
    return _check(
        "black_frame_sample",
        "failed" if is_black else "passed",
        "Sampled frame is black." if is_black else "Sampled frame is not black.",
        value={"mean_brightness": round(mean_brightness, 2)},
    )


def _check(check_id: str, status: str, message: str, **extra: Any) -> dict[str, Any]:
    return {
        "id": check_id,
        "status": status,
        "message": message,
        **{key: value for key, value in extra.items() if value is not None},
    }


def _overall_status(checks: list[dict[str, Any]]) -> str:
    statuses = {check.get("status") for check in checks}
    if "failed" in statuses:
        return "failed"
    if "warning" in statuses:
        return "warning"
    return "passed"


def _quality_summary(status: str, checks: list[dict[str, Any]]) -> str:
    if status == "passed":
        return "Video passed all configured quality checks."
    failed = [check["message"] for check in checks if check.get("status") == "failed"]
    if failed:
        return failed[0]
    return "Video completed with quality warnings."


def _is_url(value: str) -> bool:
    return value.startswith(("http://", "https://"))
