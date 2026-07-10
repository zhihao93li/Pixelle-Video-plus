"""Fish Audio 时间戳能力实测：TTS 合成 → ASR 回标，打印 segment 粒度与精度。

用法（项目根目录）：
    uv run python scripts/fish_timestamp_probe.py
    uv run python scripts/fish_timestamp_probe.py "自定义测试文案，第一句。这是第二句，稍微长一点。"

判读要点：
- segments 数量：中文多句文本若只返回 1 个 segment，说明粒度太粗，句级高亮不可行；
  若按句/短语切开且 start/end 与听感一致，句级卡拉OK可行。
- 词级：官方 schema 无词级字段，本脚本同时打印"按字符均匀插值"的近似词级切分，
  供对比近似方案的可接受度。
"""

import io
import json
import sys
from pathlib import Path

import httpx
import yaml

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_TEXT = "夏天猫咪喝水少不一定是生病。先观察精神和食欲，再看排尿是否正常。"


def load_fish_config() -> dict:
    config_path = PROJECT_ROOT / "config.yaml"
    if not config_path.exists():
        raise SystemExit("找不到 config.yaml，请在项目根目录运行。")
    with open(config_path, encoding="utf-8") as handle:
        config = yaml.safe_load(handle) or {}
    fish = (
        config.get("comfyui", {}).get("tts", {}).get("fish_audio", {})
        if isinstance(config, dict)
        else {}
    )
    if not fish.get("api_key"):
        raise SystemExit("config.yaml 里没有 Fish Audio api_key。")
    return fish


def synthesize(fish: dict, text: str) -> bytes:
    base_url = (fish.get("base_url") or "https://api.fish.audio").rstrip("/")
    payload = {
        "text": text,
        "format": "mp3",
        "prosody": {"speed": 1.0, "volume": 0.0, "normalize_loudness": True},
    }
    if fish.get("reference_id"):
        payload["reference_id"] = fish["reference_id"]
    response = httpx.post(
        f"{base_url}/v1/tts",
        json=payload,
        headers={
            "Authorization": f"Bearer {fish['api_key']}",
            "model": fish.get("model", "s2-pro"),
        },
        timeout=120,
    )
    response.raise_for_status()
    return response.content


def transcribe_with_timestamps(fish: dict, audio: bytes) -> dict:
    base_url = (fish.get("base_url") or "https://api.fish.audio").rstrip("/")
    response = httpx.post(
        f"{base_url}/v1/asr",
        files={"audio": ("probe.mp3", io.BytesIO(audio), "audio/mpeg")},
        data={"ignore_timestamps": "false", "language": "zh"},
        headers={"Authorization": f"Bearer {fish['api_key']}"},
        timeout=180,
    )
    response.raise_for_status()
    return response.json()


def approximate_char_timing(segment: dict) -> list[tuple[str, float]]:
    """按字符数在 segment 时长内均匀插值——近似词级方案的效果参照。"""
    text = segment["text"]
    chars = [c for c in text if c.strip()]
    if not chars:
        return []
    per_char = (segment["end"] - segment["start"]) / len(chars)
    return [(c, round(segment["start"] + i * per_char, 3)) for i, c in enumerate(chars)]


def main() -> None:
    text = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_TEXT
    fish = load_fish_config()

    print(f"[1/2] TTS 合成：{text!r}")
    audio = synthesize(fish, text)
    out_path = PROJECT_ROOT / "output" / "fish_timestamp_probe.mp3"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(audio)
    print(f"      音频已存：{out_path}（{len(audio) / 1024:.1f} KB）")

    print("[2/2] ASR 回标（ignore_timestamps=false）…")
    result = transcribe_with_timestamps(fish, audio)

    print(f"\n总时长：{result.get('duration'):.2f}s")
    print(f"识别文本：{result.get('text')!r}")
    segments = result.get("segments") or []
    print(f"\nsegments（{len(segments)} 个）——判断粒度与精度：")
    for seg in segments:
        print(f"  [{seg['start']:7.3f} → {seg['end']:7.3f}]  {seg['text']}")

    if segments:
        print("\n第一个 segment 的字符均匀插值（近似词级参照）：")
        for char, at in approximate_char_timing(segments[0])[:12]:
            print(f"  {at:7.3f}s  {char}")

    print("\n原始响应已存：output/fish_timestamp_probe.json")
    (PROJECT_ROOT / "output" / "fish_timestamp_probe.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
