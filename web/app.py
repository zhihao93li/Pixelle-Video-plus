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
Pixelle-Video Web UI - Main Entry Point

This is the entry point for the Streamlit multi-page application.
Uses st.navigation to define pages and set the default page to Home.
"""

import sys
from pathlib import Path

# Add project root to sys.path for module imports
_script_dir = Path(__file__).resolve().parent
_project_root = _script_dir.parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

import streamlit as st

from web.i18n import tr
from web.state.session import init_i18n, init_session_state

# Setup page config (must be first Streamlit command)
st.set_page_config(
    page_title="Pixelle-Video - AI Video Generator",
    page_icon="🎬",
    layout="wide",
    initial_sidebar_state="collapsed",
)


def main():
    """Main entry point with navigation"""
    init_session_state()
    init_i18n()

    st.warning(
        "Legacy interface: Streamlit is frozen and will be removed after compatibility "
        "acceptance. Use the React console for normal work, and do not edit settings in "
        "both interfaces at the same time.",
        icon="⚠️",
    )

    # Define pages using st.Page
    create_page = st.Page(
        "pages/1_🎬_Home.py",
        title=tr("nav.create", fallback="Create"),
        icon="🎬",
        default=True
    )
    
    history_page = st.Page(
        "pages/2_📚_History.py",
        title=tr("nav.history", fallback="History"),
        icon="📚"
    )

    settings_page = st.Page(
        "pages/3_⚙️_Settings.py",
        title=tr("nav.settings", fallback="Settings"),
        icon="⚙️"
    )

    help_page = st.Page(
        "pages/4_❓_Help.py",
        title=tr("nav.help", fallback="Help"),
        icon="❓"
    )
    
    # Set up navigation and run
    pg = st.navigation([create_page, history_page, settings_page, help_page])
    pg.run()


if __name__ == "__main__":
    main()
