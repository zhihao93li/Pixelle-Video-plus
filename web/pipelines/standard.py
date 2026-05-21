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
Standard Pipeline UI

Implements the classic 3-column layout for the Standard Pipeline.
"""

from typing import Any

import streamlit as st

# Import components
from web.components.content_input import (
    render_bgm_section,
    render_content_input,
    render_version_info,
)
from web.components.output_preview import render_output_preview
from web.components.script_review_workflow import (
    render_script_review_generation,
    render_script_review_input,
    render_script_review_tts_settings,
)
from web.components.style_config import render_style_config
from web.i18n import tr
from web.pipelines.base import PipelineUI, register_pipeline_ui


class StandardPipelineUI(PipelineUI):
    """
    UI for the Standard Video Generation Pipeline.
    Implements the classic 3-column layout.
    """
    name = "quick_create"
    icon = "⚡"
    
    @property
    def display_name(self):
        return tr("pipeline.quick_create.name")
    
    @property
    def description(self):
        return tr("pipeline.quick_create.description")
    
    def render(self, pixelle_video: Any):
        creation_mode = st.radio(
            tr("script_review.workflow.label", fallback="Quick Create Workflow"),
            options=["direct", "script_review"],
            format_func=lambda value: tr(
                "script_review.workflow.direct" if value == "direct" else "script_review.workflow.review",
                fallback="Direct Video Generation" if value == "direct" else "Script Review Creation",
            ),
            horizontal=True,
            key="quick_create_workflow_mode",
        )

        if creation_mode == "script_review":
            self.render_script_review(pixelle_video)
            return

        st.markdown(f"#### {tr('create.step.content', fallback='1. Content')}")
        content_params = render_content_input()
        bgm_params = render_bgm_section()

        st.markdown(f"#### {tr('create.step.style', fallback='2. Output Style')}")
        style_params = render_style_config(pixelle_video)

        st.markdown(f"#### {tr('create.step.generate', fallback='3. Generate and Preview')}")
        video_params = {
            "pipeline": self.name,
            **content_params,
            **bgm_params,
            **style_params
        }
        render_output_preview(pixelle_video, video_params)
        render_version_info()

    def render_script_review(self, pixelle_video: Any):
        st.markdown(f"#### {tr('create.step.content', fallback='1. Content')}")
        render_script_review_input(pixelle_video)

        st.markdown(f"#### {tr('script_review.tts_step', fallback='Voice by Language')}")
        render_script_review_tts_settings()

        bgm_params = render_bgm_section(key_prefix="review_")

        st.markdown(f"#### {tr('create.step.style', fallback='2. Output Style')}")
        st.info(tr(
            "script_review.per_language_tts_notice",
            fallback="This multilingual flow uses per-language Fish TTS settings in the generation step.",
        ))
        style_params = render_style_config(pixelle_video, include_tts=False)

        st.markdown(f"#### {tr('create.step.generate', fallback='3. Generate and Preview')}")
        video_params = {
            "pipeline": self.name,
            **bgm_params,
            **style_params,
        }
        render_script_review_generation(pixelle_video, video_params)
        render_version_info()


# Register self
register_pipeline_ui(StandardPipelineUI)
