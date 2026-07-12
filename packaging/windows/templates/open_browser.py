"""Open the packaged Pixelle console only after its API reports healthy."""

import time
import urllib.error
import urllib.request
import webbrowser

HEALTH_URL = "http://127.0.0.1:8000/health"
CONSOLE_ROOT_URL = "http://127.0.0.1:8000/"
CONSOLE_URL = "http://127.0.0.1:8000/#/board"

for _ in range(60):
    try:
        with urllib.request.urlopen(HEALTH_URL, timeout=1) as response:
            api_ready = response.status == 200
        with urllib.request.urlopen(CONSOLE_ROOT_URL, timeout=1) as response:
            console_ready = (
                response.status == 200 and b'<div id="root"></div>' in response.read()
            )
            if api_ready and console_ready:
                webbrowser.open(CONSOLE_URL)
                break
    except (OSError, urllib.error.URLError):
        pass
    time.sleep(0.5)
