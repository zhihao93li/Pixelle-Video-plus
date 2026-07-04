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
Media generation API schemas
"""

from typing import Literal, Optional

from pydantic import BaseModel, Field


class MediaGenerateRequest(BaseModel):
    """Generate an image or video preview through the shared media service."""

    prompt: str = Field(..., min_length=1, description="Image/video generation prompt")
    workflow: Optional[str] = Field(
        None,
        description="Media workflow key, e.g. runninghub/image_flux.json",
    )
    media_type: Literal["image", "video"] = Field(
        "image",
        description="Expected output type for the workflow.",
    )
    width: int = Field(1024, ge=64, le=4096, description="Media width")
    height: int = Field(1024, ge=64, le=4096, description="Media height")
    duration: Optional[float] = Field(
        None,
        gt=0,
        le=120,
        description="Optional target duration for video workflows.",
    )
    negative_prompt: Optional[str] = Field(None, description="Optional negative prompt")
    seed: Optional[int] = Field(None, description="Optional random seed")

    class Config:
        json_schema_extra = {
            "example": {
                "prompt": "warm natural light, a dog drinking water at home",
                "workflow": "runninghub/image_flux.json",
                "media_type": "image",
                "width": 1080,
                "height": 1440,
            }
        }


class MediaGenerateResponse(BaseModel):
    """Media generation response."""

    success: bool = True
    message: str = "Success"
    media_type: Literal["image", "video"]
    media_path: str = Field(..., description="Path or URL to generated media")
    duration: Optional[float] = Field(
        None,
        description="Generated video duration in seconds, if available.",
    )
