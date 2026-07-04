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
Media generation endpoints
"""

from fastapi import APIRouter, HTTPException
from loguru import logger

from api.dependencies import PixelleVideoDep
from api.schemas.media import MediaGenerateRequest, MediaGenerateResponse

router = APIRouter(prefix="/media", tags=["Basic Services"])


@router.post("/generate", response_model=MediaGenerateResponse)
async def media_generate(
    request: MediaGenerateRequest,
    pixelle_video: PixelleVideoDep,
):
    """
    Generate image or video media through the shared media workflow service.

    This is the FastAPI boundary for the old Streamlit style preview flow:
    React calls this endpoint instead of invoking pixelle_video.media directly.
    """
    try:
        logger.info(
            "Media generation request: type={} workflow={} prompt={}...",
            request.media_type,
            request.workflow or "default",
            request.prompt[:50],
        )
        media_result = await pixelle_video.media(
            prompt=request.prompt,
            workflow=request.workflow,
            media_type=request.media_type,
            width=request.width,
            height=request.height,
            duration=request.duration,
            negative_prompt=request.negative_prompt,
            seed=request.seed,
        )

        return MediaGenerateResponse(
            media_type=media_result.media_type,
            media_path=media_result.url,
            duration=media_result.duration,
        )
    except Exception as exc:
        logger.error(f"Media generation error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
