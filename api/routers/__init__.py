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
API Routers
"""

from api.routers.agent import router as agent_router
from api.routers.content_flows import router as content_flows_router
from api.routers.content_items import router as content_items_router
from api.routers.drafting import router as drafting_router
from api.routers.files import router as files_router
from api.routers.frame import router as frame_router
from api.routers.generation import router as generation_router
from api.routers.health import router as health_router
from api.routers.help import router as help_router
from api.routers.history import router as history_router
from api.routers.media import router as media_router
from api.routers.production_tasks import router as production_tasks_router
from api.routers.projects import router as projects_router
from api.routers.publish import router as publish_router
from api.routers.resources import router as resources_router
from api.routers.settings import router as settings_router
from api.routers.tts import router as tts_router

__all__ = [
    "health_router",
    "agent_router",
    "tts_router",
    "media_router",
    "content_items_router",
    "content_flows_router",
    "drafting_router",
    "projects_router",
    "production_tasks_router",
    "files_router",
    "resources_router",
    "frame_router",
    "generation_router",
    "help_router",
    "history_router",
    "publish_router",
    "settings_router",
]
