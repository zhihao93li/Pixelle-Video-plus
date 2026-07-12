import re
from pathlib import Path

from fastapi.testclient import TestClient

from api.app import app
from api.console import resolve_console_dist


def test_console_dist_requires_index_and_assets(tmp_path: Path):
    assert resolve_console_dist(tmp_path) is None

    dist_dir = tmp_path / "apps" / "console" / "dist"
    dist_dir.mkdir(parents=True)
    (dist_dir / "index.html").write_text("<div id='root'></div>", encoding="utf-8")
    assert resolve_console_dist(tmp_path) is None

    (dist_dir / "assets").mkdir()
    assert resolve_console_dist(tmp_path) == dist_dir


def test_console_root_matches_the_available_build_and_api_info_stays_available():
    client = TestClient(app)
    response = client.get("/")
    project_root = Path(__file__).resolve().parents[1]
    if resolve_console_dist(project_root) is None:
        assert response.status_code == 503
        assert "React console build is missing" in response.json()["detail"]
    else:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/html")
        assert '<div id="root"></div>' in response.text

        asset_path = re.search(r'src="(/assets/[^"]+\.js)"', response.text)
        assert asset_path is not None
        assert client.get(asset_path.group(1)).status_code == 200

    info_response = client.get("/api/info")
    assert info_response.status_code == 200
    assert info_response.json()["service"] == "Pixelle-Video API"

    assert client.get("/not-a-console-route").status_code == 404
