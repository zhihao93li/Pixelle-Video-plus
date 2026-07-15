"""Static safety checks for the Windows portable package builder."""

import hashlib
import importlib.util
from pathlib import Path

import yaml

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BUILD_MODULE_PATH = PROJECT_ROOT / "packaging" / "windows" / "build.py"
SPEC = importlib.util.spec_from_file_location("pixelle_windows_builder", BUILD_MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
BUILD_MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILD_MODULE)


def test_release_allowlist_excludes_runtime_state_and_development_files():
    release_paths = set(BUILD_MODULE.WINDOWS_RELEASE_PATHS)

    assert "api" in release_paths
    assert "agent_plugin" in release_paths
    assert "ops" not in release_paths
    assert "apps/console/dist" in release_paths
    assert "web" not in release_paths
    assert "tests" not in release_paths
    assert "data" not in release_paths
    assert not any(path.startswith("data/") for path in release_paths if "prompt_templates" not in path)
    assert {
        "data/prompt_templates/script/bazi_storyboard_oral_script.md",
        "data/prompt_templates/script/bazi_storyboard_oral_script_english.md",
    }.issubset(release_paths)


def test_download_inputs_are_pinned_and_have_sha256_digests():
    config = yaml.safe_load(
        (PROJECT_ROOT / "packaging/windows/config/build_config.yaml").read_text(
            encoding="utf-8"
        )
    )

    for key in ("python", "pip_bootstrap", "ffmpeg"):
        digest = config[key]["sha256"]
        assert len(digest) == 64
        int(digest, 16)
        assert config[key]["download_url"].startswith("https://")

    assert "/latest/" not in config["ffmpeg"]["download_url"]


def test_sha256_verifier_accepts_only_the_pinned_content(tmp_path: Path):
    payload = tmp_path / "payload.bin"
    payload.write_bytes(b"pixelle-windows-build-input")
    expected = hashlib.sha256(payload.read_bytes()).hexdigest()

    builder = BUILD_MODULE.WindowsPackageBuilder.__new__(
        BUILD_MODULE.WindowsPackageBuilder
    )
    assert builder._verify_sha256(payload, expected)
    assert not builder._verify_sha256(payload, "0" * 64)
