import pytest

from pixelle_video.services.image_providers import ImageGenerationResult
from pixelle_video.services.media import MediaService


@pytest.mark.asyncio
async def test_media_service_dispatches_direct_image_provider_without_workflow(monkeypatch):
    calls = []

    class FakeProvider:
        async def generate(self, request, progress_callback=None):
            calls.append(request)
            return ImageGenerationResult(
                provider="aliyun_bailian",
                model=request.model,
                image_url="https://example.com/generated.png",
                request_id="ali-task-1",
                actual_width=1536,
                actual_height=2688,
            )

    monkeypatch.setattr(
        "pixelle_video.services.image_providers.ImageProviderRegistry.get",
        lambda self, provider: FakeProvider(),
    )
    service = MediaService.__new__(MediaService)

    result = await service(
        prompt="一只猫",
        media_type="image",
        image_provider="aliyun_bailian",
        image_model="qwen-image-2.0",
        width=1080,
        height=1920,
    )

    assert len(calls) == 1
    assert calls[0].target_width == 1080
    assert result.provider == "aliyun_bailian"
    assert result.request_id == "ali-task-1"
    assert result.url == "https://example.com/generated.png"
