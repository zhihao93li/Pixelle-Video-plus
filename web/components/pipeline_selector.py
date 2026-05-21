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
Pipeline selector for the creation page.
"""

from typing import Any

import streamlit as st

from web.i18n import tr

PIPELINE_ORDER = [
    "quick_create",
    "custom_media",
    "digital_human",
    "image_to_video",
    "action_transfer",
]


def _ordered_pipeline_names(pipelines: list[Any]) -> list[str]:
    names = [pipeline.name for pipeline in pipelines]
    ordered = [name for name in PIPELINE_ORDER if name in names]
    ordered.extend(name for name in names if name not in ordered)
    return ordered


def render_pipeline_selector(pipelines: list[Any]) -> Any | None:
    """Render a single-choice selector and return the selected pipeline."""
    if not pipelines:
        st.error(tr("create.pipeline.empty", fallback="No creation modes are available."))
        return None

    pipeline_by_name = {pipeline.name: pipeline for pipeline in pipelines}
    ordered_names = _ordered_pipeline_names(pipelines)
    default_index = ordered_names.index("quick_create") if "quick_create" in ordered_names else 0

    selected_name = st.radio(
        tr("create.pipeline.label", fallback="Choose creation type"),
        options=ordered_names,
        index=default_index,
        horizontal=True,
        format_func=lambda name: f"{pipeline_by_name[name].icon} {pipeline_by_name[name].display_name}",
        key="create_pipeline_selector",
    )

    selected_pipeline = pipeline_by_name[selected_name]
    if selected_pipeline.description:
        st.caption(selected_pipeline.description)

    return selected_pipeline
