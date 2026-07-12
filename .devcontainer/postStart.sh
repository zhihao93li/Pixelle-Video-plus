#!/usr/bin/env bash
set -euo pipefail

echo "[devcontainer] postStart: launching the Pixelle React + FastAPI service..."
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

export UV_LINK_MODE=copy

# Start the unified service in background so the forwarded port is ready.
pkill -f 'uvicorn api.app:app.*--port 8000' 2>/dev/null || true
nohup uv run uvicorn api.app:app --host 0.0.0.0 --port 8000 > /tmp/pixelle_api.log 2>&1 &
APP_PID=$!
echo "[devcontainer] Pixelle started with PID $APP_PID (logs: /tmp/pixelle_api.log)"

# Require both the API and the built console to become observable.
READY=false
for _ in {1..40}; do
    if curl -fsS http://127.0.0.1:8000/health >/dev/null 2>&1 && \
       curl -fsS http://127.0.0.1:8000/ | grep -q '<div id="root"></div>'; then
        READY=true
        break
    fi
    if ! ps -p $APP_PID >/dev/null 2>&1; then
        break
    fi
    sleep 0.5
done

if [ "$READY" != "true" ]; then
    echo "[devcontainer] Pixelle failed to expose both API and React console."
    tail -n 80 /tmp/pixelle_api.log || true
    exit 1
fi

echo ""
echo "✅ Pixelle React Console is ready on port 8000"
echo ""

echo "Common commands:"
echo "1. View logs:"
echo "   tail -f /tmp/pixelle_api.log"
echo "2. Stop service:"
echo "   pkill -f 'uvicorn api.app:app'"
echo "3. Restart service:"
echo "   pkill -f 'uvicorn api.app:app'; nohup uv run uvicorn api.app:app --host 0.0.0.0 --port 8000 > /tmp/pixelle_api.log 2>&1 &"
echo "4. Check port usage:"
echo "   lsof -i:8000"
echo "5. View processes:"
echo "   ps aux | grep uvicorn"
echo ""
echo "For more help, see README or run 'ps aux | grep uvicorn'."
