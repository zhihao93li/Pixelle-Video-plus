#!/usr/bin/env bash
# Build and start the production React console with its FastAPI backend.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"

echo "🚀 Building Pixelle React Console..."
echo ""

(cd apps/console && npm run build)

echo "🌐 Starting Pixelle at http://127.0.0.1:8000/#/board"
uv run uvicorn api.app:app --host 127.0.0.1 --port 8000
