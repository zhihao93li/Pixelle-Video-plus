#!/usr/bin/env bash
set -euo pipefail

echo "[devcontainer] Running postCreate tasks..."

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

# ============================================================================
# System Dependencies Installation
# ============================================================================

export DEBIAN_FRONTEND=noninteractive

# Remove problematic Yarn repository if it exists
echo "[devcontainer] Removing problematic repositories..."
sudo rm -f /etc/apt/sources.list.d/yarn.sources 2>/dev/null || true
sudo rm -f /etc/apt/sources.list.d/yarn.list 2>/dev/null || true

# Update package lists
echo "[devcontainer] Updating package lists..."
sudo apt-get update -y

# Install system packages needed by the project
echo "[devcontainer] Installing system packages..."
sudo apt-get install -y --no-install-recommends \
  ffmpeg \
  fontconfig \
  fonts-liberation \
  fonts-noto-cjk \
  wget \
  xdg-utils \
  ca-certificates

# Verify installation
echo "[devcontainer] Verifying system packages..."
echo "[devcontainer] Chinese fonts (sample):"
fc-list :lang=zh | head -n 10 || true

# ============================================================================
# Python Dependencies Installation
# ============================================================================

# Install uv package manager
echo "[devcontainer] Installing uv package manager..."
pip install uv --quiet

# Install Python dependencies with uv
echo "[devcontainer] Installing Python dependencies with uv..."
uv sync --frozen

# Build the production React console served by FastAPI.
echo "[devcontainer] Installing and building the React console..."
(
  cd apps/console
  npm ci
  npm run build
)

# Install Playwright browser (Chromium for HTML template rendering)
echo "[devcontainer] Installing Playwright Chromium browser..."
uv run playwright install --with-deps chromium

echo "[devcontainer] postCreate complete. React + FastAPI will start via postStart.sh"
