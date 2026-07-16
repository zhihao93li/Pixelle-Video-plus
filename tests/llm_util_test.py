from pixelle_video.utils import llm_util


class _FakeResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {"data": [{"id": "model-a"}]}


class _FakeClient:
    def __init__(self, captured, timeout):
        self.captured = captured
        self.captured["timeout"] = timeout

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def get(self, url, headers):
        self.captured.update({"url": url, "headers": headers})
        return _FakeResponse()


def test_deepseek_model_discovery_uses_official_models_endpoint(monkeypatch):
    captured = {}
    monkeypatch.setattr(
        llm_util.httpx,
        "Client",
        lambda timeout: _FakeClient(captured, timeout),
    )

    models = llm_util.fetch_available_models(
        "deepseek-key",
        "https://api.deepseek.com",
        provider_type="deepseek",
    )

    assert models == ["model-a"]
    assert captured["url"] == "https://api.deepseek.com/models"
    assert captured["headers"]["Authorization"] == "Bearer deepseek-key"


def test_anthropic_model_discovery_uses_anthropic_auth_headers(monkeypatch):
    captured = {}
    monkeypatch.setattr(
        llm_util.httpx,
        "Client",
        lambda timeout: _FakeClient(captured, timeout),
    )

    models = llm_util.fetch_available_models(
        "anthropic-key",
        "https://api.anthropic.com/v1/",
        provider_type="anthropic",
    )

    assert models == ["model-a"]
    assert captured["url"] == "https://api.anthropic.com/v1/models"
    assert captured["headers"] == {
        "x-api-key": "anthropic-key",
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }
