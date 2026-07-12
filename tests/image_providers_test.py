import httpx
import pytest

from pixelle_video.config.schema import (
    AliyunBailianImageConfig,
    VolcengineArkImageConfig,
)
from pixelle_video.services.image_providers import (
    AliyunBailianImageProvider,
    ImageGenerationRequest,
    VolcengineArkImageProvider,
    provider_size,
)


def test_provider_size_maps_vertical_video_to_supported_provider_size():
    assert provider_size("aliyun_bailian", "qwen-image-2.0", 1080, 1920) == (
        1536,
        2688,
    )
    assert provider_size("aliyun_bailian", "wan2.6-t2i", 1080, 1920) == (
        960,
        1696,
    )
    assert provider_size("volcengine_ark", "doubao-seedream-5-0-lite", 1080, 1920) == (
        1440,
        2560,
    )


@pytest.mark.asyncio
async def test_aliyun_provider_normalizes_request_and_result():
    seen = {}

    async def handler(request: httpx.Request):
        seen["url"] = str(request.url)
        seen["body"] = request.content.decode()
        return httpx.Response(
            200,
            json={
                "request_id": "ali-request-1",
                "output": {
                    "choices": [
                        {"message": {"content": [{"image": "https://example.com/ali.png"}]}}
                    ]
                },
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = AliyunBailianImageProvider(
            AliyunBailianImageConfig(
                enabled=True,
                api_key="secret",
                workspace_id="workspace-1",
            ),
            client,
        )
        result = await provider.generate(
            ImageGenerationRequest(
                prompt="猫",
                model="qwen-image-2.0",
                target_width=1080,
                target_height=1920,
            )
        )

    assert "workspace-1.cn-beijing.maas.aliyuncs.com" in seen["url"]
    assert '"size":"1536*2688"' in seen["body"].replace(" ", "")
    assert result.image_url == "https://example.com/ali.png"
    assert result.request_id == "ali-request-1"


@pytest.mark.asyncio
async def test_volcengine_provider_normalizes_request_and_result():
    seen = {}

    async def handler(request: httpx.Request):
        seen["url"] = str(request.url)
        seen["body"] = request.content.decode()
        return httpx.Response(
            200,
            headers={"x-request-id": "ark-request-1"},
            json={"data": [{"url": "https://example.com/ark.png"}]},
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = VolcengineArkImageProvider(
            VolcengineArkImageConfig(enabled=True, api_key="secret"), client
        )
        result = await provider.generate(
            ImageGenerationRequest(
                prompt="猫",
                model="doubao-seedream-5-0-lite",
                target_width=1080,
                target_height=1920,
            )
        )

    assert seen["url"].endswith("/images/generations")
    assert '"size":"1440x2560"' in seen["body"].replace(" ", "")
    assert result.image_url == "https://example.com/ark.png"
    assert result.request_id == "ark-request-1"
