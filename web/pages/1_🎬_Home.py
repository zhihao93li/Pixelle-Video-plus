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
Create Page - Main video generation interface
"""

import sys
from pathlib import Path

# Add project root to sys.path
_script_dir = Path(__file__).resolve().parent
_project_root = _script_dir.parent.parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

import streamlit as st

# Import components
from web.components.header import render_header
from web.components.pipeline_selector import render_pipeline_selector
from web.components.settings import render_config_status_bar
from web.i18n import tr

# Import state management
from web.state.session import get_pixelle_video, init_i18n, init_session_state

# Page config
st.set_page_config(
    page_title="Create - Pixelle-Video",
    page_icon="🎬",
    layout="wide",
    initial_sidebar_state="collapsed",
)


def main():
    """Main UI entry point"""
    # Initialize session state and i18n
    init_session_state()
    init_i18n()
    
    # Render header (title + language selector)
    render_header()
    
    # Initialize Pixelle-Video
    pixelle_video = get_pixelle_video()

    st.markdown(f"### {tr('create.title', fallback='Create Video')}")
    render_config_status_bar()
    
    # ========================================================================
    # Pipeline Selection & Delegation
    # ========================================================================
    from web.pipelines import get_all_pipeline_uis
    
    # Get all registered pipelines
    pipelines = get_all_pipeline_uis()

    selected_pipeline = render_pipeline_selector(pipelines)
    if selected_pipeline is not None:
        selected_pipeline.render(pixelle_video)


if __name__ == "__main__":
    main()
