"""LLM 空响应重试的回归测试（根因：AiHubMix 偶发空响应导致整个选题起草失败）。"""

import asyncio

from pixelle_video.generation.drafting_support import _call_llm_retrying_empty


def test_retries_until_non_empty_response():
    calls = []

    async def flaky_llm(**kwargs):
        calls.append(kwargs)
        return "" if len(calls) < 3 else '{"ok": true}'

    async def run():
        return await _call_llm_retrying_empty(flaky_llm, prompt="p", attempts=3)

    # 缩短退避避免测试变慢
    original_sleep = asyncio.sleep
    asyncio.sleep = lambda _t: original_sleep(0)  # type: ignore[assignment]
    try:
        response = asyncio.run(run())
    finally:
        asyncio.sleep = original_sleep  # type: ignore[assignment]

    assert response == '{"ok": true}'
    assert len(calls) == 3


def test_returns_empty_after_exhausting_attempts():
    async def always_empty(**_kwargs):
        return ""

    async def run():
        return await _call_llm_retrying_empty(always_empty, prompt="p", attempts=2)

    original_sleep = asyncio.sleep
    asyncio.sleep = lambda _t: original_sleep(0)  # type: ignore[assignment]
    try:
        response = asyncio.run(run())
    finally:
        asyncio.sleep = original_sleep  # type: ignore[assignment]

    assert response == ""
