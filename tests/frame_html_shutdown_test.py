import pytest

from pixelle_video.services.frame_html import HTMLFrameGenerator


class _ClosedBrowser:
    async def close(self):
        raise RuntimeError("transport already closed")


class _PlaywrightDriver:
    def __init__(self):
        self.stopped = False

    async def stop(self):
        self.stopped = True


@pytest.mark.asyncio
async def test_close_browser_is_idempotent_when_browser_transport_already_closed():
    driver = _PlaywrightDriver()
    HTMLFrameGenerator._browser = _ClosedBrowser()
    HTMLFrameGenerator._playwright = driver
    HTMLFrameGenerator._browser_loop = object()

    await HTMLFrameGenerator.close_browser()
    await HTMLFrameGenerator.close_browser()

    assert driver.stopped is True
    assert HTMLFrameGenerator._browser is None
    assert HTMLFrameGenerator._playwright is None
    assert HTMLFrameGenerator._browser_loop is None
