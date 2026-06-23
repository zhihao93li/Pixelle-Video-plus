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
Settings Page - System configuration.
"""

import sys
from pathlib import Path

_script_dir = Path(__file__).resolve().parent
_project_root = _script_dir.parent.parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

import streamlit as st

from web.components.header import render_header
from web.components.settings import render_advanced_settings
from web.i18n import tr
from web.state.session import init_i18n, init_session_state

st.set_page_config(
    page_title="Settings - Pixelle-Video",
    page_icon="⚙️",
    layout="wide",
    initial_sidebar_state="collapsed",
)


def main():
    """Render the settings page."""
    init_session_state()
    init_i18n()

    render_header()
    st.markdown(f"### {tr('settings.page.title', fallback='Settings / Integrations')}")
    st.caption(
        tr(
            "settings.page.description",
            fallback="Configure global LLM, RunningHub, ComfyUI, Fish Audio, COS, and Buffer capabilities shared by Ops and Video.",
        )
    )
    render_advanced_settings(default_expanded=True)


if __name__ == "__main__":
    main()
