import base64
import io
import json

import pytest
from PIL import Image

from pixelle_video.generation.agent_images import (
    AgentImageError,
    resolve_agent_image_path,
    save_agent_image,
)


def _image_bytes(color: str, image_format: str = "PNG") -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (24, 16), color=color).save(buffer, format=image_format)
    return buffer.getvalue()


def test_save_agent_image_is_validated_idempotent_and_replaceable(tmp_path):
    first_source = tmp_path / "first.png"
    first_source.write_bytes(_image_bytes("red"))

    first = save_agent_image(
        experiment_id="exp-1",
        scene_id="scene-1",
        prompt="A red paper box",
        source={"kind": "codex", "confirmed_by_user": True},
        file_path=str(first_source),
        storage_root=tmp_path / "assets",
    )
    repeated = save_agent_image(
        experiment_id="exp-1",
        scene_id="scene-1",
        prompt="A red paper box",
        source={"kind": "codex", "confirmed_by_user": True},
        file_path=str(first_source),
        storage_root=tmp_path / "assets",
    )

    assert first["idempotent"] is False
    assert repeated["idempotent"] is True
    assert first["sha256"] == repeated["sha256"]
    assert first["width"] == 24
    assert first["height"] == 16

    second_source = tmp_path / "second.webp"
    second_source.write_bytes(_image_bytes("blue", "WEBP"))
    with pytest.raises(AgentImageError, match="replace=true"):
        save_agent_image(
            experiment_id="exp-1",
            scene_id="scene-1",
            prompt="A blue paper box",
            source={"kind": "codex", "confirmed_by_user": True},
            file_path=str(second_source),
            storage_root=tmp_path / "assets",
        )

    replaced = save_agent_image(
        experiment_id="exp-1",
        scene_id="scene-1",
        prompt="A blue paper box",
        source={"kind": "codex", "confirmed_by_user": True},
        file_path=str(second_source),
        replace=True,
        storage_root=tmp_path / "assets",
    )
    assert replaced["replaced"] is True
    assert replaced["format"] == "WEBP"
    assert (tmp_path / "assets" / "exp-1" / "scene-1.png").exists()
    assert replaced["path"].endswith(".webp")
    assert "scene-1-" in replaced["path"]

    sidecar = json.loads(
        (tmp_path / "assets" / "exp-1" / "scene-1.json").read_text(encoding="utf-8")
    )
    assert sidecar["prompt"] == "A blue paper box"
    assert sidecar["sha256"] == replaced["sha256"]

    (tmp_path / "assets" / "exp-1" / "scene-1.json").unlink()
    repaired = save_agent_image(
        experiment_id="exp-1",
        scene_id="scene-1",
        prompt="A blue paper box",
        source={"kind": "agent", "confirmed_by_user": True},
        file_path=str(second_source),
        storage_root=tmp_path / "assets",
    )
    assert repaired["idempotent"] is True
    resolved = resolve_agent_image_path(
        experiment_id="exp-1",
        scene_id="scene-1",
        asset_id=repaired["asset_id"],
        storage_root=tmp_path / "assets",
    )
    assert resolved.endswith(".webp")


def test_save_agent_image_accepts_codex_data_url(tmp_path):
    content = _image_bytes("green", "JPEG")
    data_url = "data:image/jpeg;base64," + base64.b64encode(content).decode("ascii")

    result = save_agent_image(
        experiment_id="exp-2",
        scene_id="scene-2",
        prompt="A green box",
        source={"kind": "codex", "confirmed_by_user": True},
        image_data_url=data_url,
        storage_root=tmp_path,
    )

    assert result["format"] == "JPEG"
    assert result["media_type"] == "image/jpeg"
    assert result["path"].endswith("scene-2.jpg")


def test_save_agent_image_rejects_invalid_or_oversized_input(tmp_path):
    invalid = tmp_path / "invalid.png"
    invalid.write_bytes(b"not an image")

    with pytest.raises(AgentImageError, match="valid PNG"):
        save_agent_image(
            experiment_id="exp-3",
            scene_id="scene-1",
            prompt="invalid",
            source={"kind": "codex", "confirmed_by_user": True},
            file_path=str(invalid),
            storage_root=tmp_path / "assets",
        )

    valid = tmp_path / "valid.png"
    valid.write_bytes(_image_bytes("white"))
    with pytest.raises(AgentImageError, match="upload limit"):
        save_agent_image(
            experiment_id="exp-3",
            scene_id="scene-1",
            prompt="too large",
            source={"kind": "codex", "confirmed_by_user": True},
            file_path=str(valid),
            max_size=8,
            storage_root=tmp_path / "assets",
        )


def test_save_agent_image_requires_exactly_one_input(tmp_path):
    with pytest.raises(AgentImageError, match="exactly one"):
        save_agent_image(
            experiment_id="exp-4",
            scene_id="scene-1",
            prompt="missing",
            source={"kind": "codex", "confirmed_by_user": True},
            storage_root=tmp_path,
        )
