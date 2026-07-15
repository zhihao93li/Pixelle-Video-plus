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
API Configuration
"""

import os
from typing import Optional

from pydantic import BaseModel


class APIConfig(BaseModel):
    """API configuration"""
    
    # Server settings
    host: str = "127.0.0.1"
    port: int = 8000
    reload: bool = False
    
    # CORS settings
    cors_enabled: bool = True
    cors_origins: list[str] = [
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:4173",
        "http://localhost:4173",
    ]
    
    # API settings
    api_prefix: str = "/api"
    docs_url: Optional[str] = "/docs"
    redoc_url: Optional[str] = "/redoc"
    openapi_url: Optional[str] = "/openapi.json"


# Global config instance
def _env_list(name: str, default: list[str]) -> list[str]:
    raw = os.environ.get(name, "").strip()
    return [part.strip() for part in raw.split(",") if part.strip()] if raw else default


api_config = APIConfig(
    host=os.environ.get("PIXELLE_API_HOST", "127.0.0.1"),
    cors_origins=_env_list("PIXELLE_CORS_ORIGINS", APIConfig().cors_origins),
)
