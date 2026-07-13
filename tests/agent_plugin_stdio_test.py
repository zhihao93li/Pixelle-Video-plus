import os
import socket
import subprocess
import sys
import time

import httpx
import pytest
from fastmcp import Client
from fastmcp.client.transports import StdioTransport


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@pytest.mark.asyncio
async def test_agent_plugin_stdio_initializes_lists_tools_and_reads_capabilities(tmp_path):
    port = _free_port()
    token = "stdio-test-token-with-more-than-thirty-two-bytes"
    env = {
        **os.environ,
        "PIXELLE_VIDEO_ROOT": str(tmp_path),
        "PIXELLE_AGENT_TOKEN": token,
        "PIXELLE_API_BASE": f"http://127.0.0.1:{port}/api",
    }
    api_log = tmp_path / "api.log"
    with api_log.open("w", encoding="utf-8") as log:
        process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "api.app:app",
                "--host",
                "127.0.0.1",
                "--port",
                str(port),
            ],
            cwd=os.getcwd(),
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
        )
        try:
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                try:
                    if httpx.get(f"http://127.0.0.1:{port}/health", timeout=0.5).is_success:
                        break
                except httpx.HTTPError:
                    time.sleep(0.1)
            else:
                pytest.fail(f"API failed to start: {api_log.read_text(encoding='utf-8')}")

            transport = StdioTransport(
                command=sys.executable,
                args=["-m", "agent_plugin.server"],
                cwd=os.getcwd(),
                env=env,
            )
            async with Client(transport) as client:
                tools = await client.list_tools()
                result = await client.call_tool("get_capabilities")
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)

    names = {tool.name for tool in tools}
    assert "get_capabilities" in names
    assert "submit_scene_manifest" in names
    assert "confirm_item" not in names
    assert result.data["authenticated"] is True
    assert result.data["tool_surface_version"] == "1.0"
