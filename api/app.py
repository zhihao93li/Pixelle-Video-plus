# Copyright (C) 2025 AIDC-AI
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#     http://www.apache.org/licenses/LICENSE-2.0
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""
Pixelle-Video FastAPI Application

Main FastAPI app with all routers and middleware.

Run this script to start the FastAPI server:
    uv run python api/app.py
    
Or with custom settings:
    uv run python api/app.py --host 0.0.0.0 --port 8080 --reload
"""

import argparse
import sys
from contextlib import asynccontextmanager
from pathlib import Path

# Add project root to sys.path for module imports
# This ensures imports work correctly in both development and packaged environments
_script_dir = Path(__file__).resolve().parent
_project_root = _script_dir.parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger

from api.config import api_config
from api.console import resolve_console_dist
from api.dependencies import shutdown_pixelle_video
from api.routers import (
    agent_router,
    content_flows_router,
    content_items_router,
    content_router,
    drafting_router,
    files_router,
    frame_router,
    generation_router,
    health_router,
    help_router,
    history_router,
    image_router,
    llm_router,
    media_router,
    projects_router,
    publish_router,
    resources_router,
    settings_router,
    tasks_router,
    tts_router,
    video_router,
)
from api.security import ensure_agent_token
from api.tasks import task_manager
from pixelle_video.content.operations import recover_running_operations


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan manager
    
    Handles startup and shutdown events.
    """
    # Startup
    logger.info("🚀 Starting Pixelle-Video API...")
    ensure_agent_token()
    recover_running_operations()
    if api_config.host not in {"127.0.0.1", "localhost", "::1"}:
        logger.warning(
            "Pixelle API 正监听非本机地址；普通用户接口无登录认证，局域网内任何设备都可能操作。"
        )
    await task_manager.start()
    logger.info("✅ Pixelle-Video API started successfully\n")
    
    yield
    
    # Shutdown
    logger.info("🛑 Shutting down Pixelle-Video API...")
    await task_manager.stop()
    await shutdown_pixelle_video()
    logger.info("✅ Pixelle-Video API shutdown complete")


# Create FastAPI app
app = FastAPI(
    title="Pixelle-Video API",
    description="""
    ## Pixelle content production API

    The production contract is project-scoped and recipe-driven. It supports
    video, image-set, and text artifacts, plus persisted single and batch tasks.

    ### Getting started
    1. Check health: `GET /health`
    2. Read projects: `GET /api/projects`
    3. Read recipes: `GET /api/generation/templates`
    4. Submit a task: `POST /api/generation/templates/{template_id}/tasks`
    5. Track it: `GET /api/generation/tasks/{task_id}`
    """,
    version="0.1.0",
    docs_url=api_config.docs_url,
    redoc_url=api_config.redoc_url,
    openapi_url=api_config.openapi_url,
    lifespan=lifespan,
)

# Add CORS middleware
if api_config.cors_enabled:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=api_config.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    logger.info(f"CORS enabled for origins: {api_config.cors_origins}")

# Include routers
# Health check (no prefix)
app.include_router(health_router)
app.include_router(agent_router, prefix=api_config.api_prefix)

# API routers (with /api prefix)
app.include_router(llm_router, prefix=api_config.api_prefix)
app.include_router(tts_router, prefix=api_config.api_prefix)
app.include_router(image_router, prefix=api_config.api_prefix)
app.include_router(media_router, prefix=api_config.api_prefix)
app.include_router(content_router, prefix=api_config.api_prefix)
app.include_router(content_items_router, prefix=api_config.api_prefix)
app.include_router(content_flows_router, prefix=api_config.api_prefix)
app.include_router(drafting_router, prefix=api_config.api_prefix)
app.include_router(projects_router, prefix=api_config.api_prefix)
app.include_router(video_router, prefix=api_config.api_prefix)
app.include_router(tasks_router, prefix=api_config.api_prefix)
app.include_router(files_router, prefix=api_config.api_prefix)
app.include_router(resources_router, prefix=api_config.api_prefix)
app.include_router(frame_router, prefix=api_config.api_prefix)
app.include_router(generation_router, prefix=api_config.api_prefix)
app.include_router(help_router, prefix=api_config.api_prefix)
app.include_router(history_router, prefix=api_config.api_prefix)
app.include_router(publish_router, prefix=api_config.api_prefix)
app.include_router(settings_router, prefix=api_config.api_prefix)


_console_dist = resolve_console_dist(_project_root)
if _console_dist is not None:
    app.mount(
        "/assets",
        StaticFiles(directory=_console_dist / "assets"),
        name="console-assets",
    )


@app.get(f"{api_config.api_prefix}/info")
async def api_info():
    """Return service discovery information without occupying the UI root."""
    return {
        "service": "Pixelle-Video API",
        "version": "0.1.0",
        "docs": api_config.docs_url,
        "health": "/health",
        "api": {
            "llm": f"{api_config.api_prefix}/llm",
            "tts": f"{api_config.api_prefix}/tts",
            "image": f"{api_config.api_prefix}/image",
            "media": f"{api_config.api_prefix}/media",
            "content": f"{api_config.api_prefix}/content",
            "video": f"{api_config.api_prefix}/video",
            "tasks": f"{api_config.api_prefix}/tasks",
            "files": f"{api_config.api_prefix}/files",
            "resources": f"{api_config.api_prefix}/resources",
            "frame": f"{api_config.api_prefix}/frame",
            "generation": f"{api_config.api_prefix}/generation",
            "help": f"{api_config.api_prefix}/help",
            "history": f"{api_config.api_prefix}/history",
            "publish": f"{api_config.api_prefix}/publish",
        },
    }


@app.get("/", include_in_schema=False)
async def root():
    """Serve the production React console from the same process as the API."""
    if _console_dist is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "React console build is missing. Run `npm ci && npm run build` "
                "inside apps/console before starting the production service."
            ),
        )
    return FileResponse(_console_dist / "index.html", media_type="text/html")


if __name__ == "__main__":
    import uvicorn
    
    # Parse command line arguments
    parser = argparse.ArgumentParser(description="Start Pixelle-Video API Server")
    parser.add_argument("--host", default=api_config.host, help="Host to bind to")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind to")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload")
    
    args = parser.parse_args()
    if args.host not in {"127.0.0.1", "localhost", "::1"}:
        logger.warning(
            "Pixelle API 将监听非本机地址；普通用户接口无登录认证，局域网内任何设备都可能操作。"
        )
    
    # Print startup banner
    print(f"""
╔══════════════════════════════════════════════════════════════╗
║                    Pixelle-Video API Server                      ║
╚══════════════════════════════════════════════════════════════╝

Starting server at http://{args.host}:{args.port}
API Docs: http://{args.host}:{args.port}/docs
ReDoc: http://{args.host}:{args.port}/redoc

Press Ctrl+C to stop the server
""")
    
    # Start server
    uvicorn.run(
        "api.app:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )
