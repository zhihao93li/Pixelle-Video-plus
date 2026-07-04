from fastapi.testclient import TestClient

from api.app import app


def test_help_faq_endpoint_returns_chinese_faq_sections():
    response = TestClient(app).get("/api/help/faq?language=zh_CN")

    assert response.status_code == 200
    payload = response.json()
    assert payload["language"] == "zh_CN"
    assert payload["content"]
    assert payload["sections"]
    assert payload["sections"][0]["question"]
