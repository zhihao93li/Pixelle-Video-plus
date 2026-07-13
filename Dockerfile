# Pixelle-Video Docker Image
# Build the React console once, then serve it from the Python application image.

FROM node:22-alpine AS console-builder

ARG USE_CN_MIRROR=false
WORKDIR /console

COPY apps/console/package.json apps/console/package-lock.json ./
RUN if [ "$USE_CN_MIRROR" = "true" ]; then \
        npm config set registry https://registry.npmmirror.com; \
    fi && \
    npm ci

COPY apps/console ./
RUN npm run build && \
    test -f dist/index.html && \
    test -d dist/assets

FROM python:3.11-slim

# Build arguments for mirror configuration
# USE_CN_MIRROR: whether to use China mirrors (true/false)
ARG USE_CN_MIRROR=false

# Set working directory
WORKDIR /app

# Replace apt sources with China mirrors if needed
# Debian 12 uses DEB822 format in /etc/apt/sources.list.d/debian.sources
RUN if [ "$USE_CN_MIRROR" = "true" ]; then \
    sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources && \
    sed -i 's|security.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources; \
    fi

# Install system dependencies
# - curl: for health checks and downloads
# - ffmpeg: for video/audio processing
# - fonts-noto-cjk: for CJK character support
RUN apt-get update && apt-get install -y \
    curl \
    ffmpeg \
    fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

# Install uv package manager
# For China: use pip to install uv from mirror (faster and more stable)
# For International: use official installer script
RUN if [ "$USE_CN_MIRROR" = "true" ]; then \
        pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple/ uv; \
    else \
        curl -LsSf https://astral.sh/uv/install.sh | sh; \
    fi
ENV PATH="/root/.local/bin:$PATH"
RUN uv --version

# Copy dependency files and source code for building
# Note: pixelle_video is needed for hatchling to build the package
COPY pyproject.toml uv.lock README.md ./
COPY pixelle_video ./pixelle_video

# Create virtual environment and install dependencies
# Use -i flag to specify mirror when USE_CN_MIRROR=true
RUN export UV_HTTP_TIMEOUT=300 && \
    uv venv && \
    if [ "$USE_CN_MIRROR" = "true" ]; then \
        uv pip install -e . -i https://pypi.tuna.tsinghua.edu.cn/simple; \
    else \
        uv pip install -e .; \
    fi && \
    uv run playwright install --with-deps chromium

# Copy rest of application code
COPY api ./api
COPY agent_plugin ./agent_plugin
COPY --from=console-builder /console/dist ./apps/console/dist
COPY bgm ./bgm
COPY templates ./templates
COPY workflows ./workflows
COPY resources ./resources
COPY data/prompt_templates/script/bazi_storyboard_oral_script.md ./data/prompt_templates/script/bazi_storyboard_oral_script.md
COPY data/prompt_templates/script/bazi_storyboard_oral_script_english.md ./data/prompt_templates/script/bazi_storyboard_oral_script_english.md
COPY docs/images ./docs/images
COPY docs/en/faq.md ./docs/en/faq.md
COPY docs/zh/faq.md ./docs/zh/faq.md

# Create output, data and temp directories
RUN mkdir -p /app/output /app/data /app/temp

# Port 8000 serves both the React console and the API.
EXPOSE 8000

# Default command (can be overridden in docker-compose)
CMD ["uv", "run", "python", "api/app.py"]
