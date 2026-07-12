"""Guards for the React + FastAPI production entry points."""

from pathlib import Path

import yaml

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_default_distribution_entrypoints_do_not_start_streamlit():
    entrypoints = [
        "Dockerfile",
        "docker-compose.yml",
        ".devcontainer/postStart.sh",
        "start_web.sh",
        "start_web.bat",
        "packaging/windows/templates/start.bat",
    ]

    for relative_path in entrypoints:
        content = (PROJECT_ROOT / relative_path).read_text(encoding="utf-8").lower()
        assert "streamlit" not in content, relative_path
        assert "8501" not in content, relative_path


def test_docker_has_one_application_service_on_port_8000():
    compose = yaml.safe_load((PROJECT_ROOT / "docker-compose.yml").read_text(encoding="utf-8"))
    assert set(compose["services"]) == {"init", "api"}
    assert compose["services"]["api"]["ports"] == ["127.0.0.1:8000:8000"]

    dockerfile = (PROJECT_ROOT / "Dockerfile").read_text(encoding="utf-8")
    assert "FROM node:22-alpine AS console-builder" in dockerfile
    assert "COPY --from=console-builder /console/dist ./apps/console/dist" in dockerfile
    assert "COPY ops ./ops" in dockerfile
    assert "COPY docs/en/faq.md ./docs/en/faq.md" in dockerfile
    assert "COPY docs/zh/faq.md ./docs/zh/faq.md" in dockerfile
    assert "COPY web ./web" not in dockerfile


def test_windows_package_builds_and_launches_the_react_console():
    builder = (PROJECT_ROOT / "packaging/windows/build.py").read_text(encoding="utf-8")
    launcher = (
        PROJECT_ROOT / "packaging/windows/templates/start.bat"
    ).read_text(encoding="utf-8")

    assert "self.build_console()" in builder
    assert "self.install_playwright_browser(python_dir)" in builder
    assert 'packaged_project_path = r"..\\..\\Pixelle-Video"' in builder
    assert "-m uvicorn api.app:app" in launcher
    assert "PLAYWRIGHT_BROWSERS_PATH" in launcher
    assert "http://127.0.0.1:8000/#/board" in (
        PROJECT_ROOT / "packaging/windows/templates/open_browser.py"
    ).read_text(encoding="utf-8")
