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
Content input components for web UI (left column)
"""

import re
from pathlib import Path
from typing import Any

import streamlit as st

from web.i18n import tr
from web.utils.async_helpers import get_project_version

BGM_AUDIO_EXTENSIONS = ('.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg')
BGM_UPLOAD_TYPES = [ext.lstrip(".") for ext in BGM_AUDIO_EXTENSIONS]


def parse_batch_text_input(text_input: str, mode: str) -> list[str]:
    """Parse batch text input into one item per video."""
    text = (text_input or "").strip()
    if not text:
        return []

    if mode == "fixed":
        return [
            block.strip()
            for block in re.split(r"(?m)^\s*---+\s*$", text)
            if block.strip()
        ]

    return [
        line.strip()
        for line in text.split("\n")
        if line.strip()
    ]


def _safe_bgm_filename(filename: str) -> str:
    raw_name = (filename or "").replace("\\", "/")
    name = Path(raw_name).name.strip()
    suffix = Path(name).suffix.lower()

    if suffix not in BGM_AUDIO_EXTENSIONS:
        allowed = ", ".join(BGM_AUDIO_EXTENSIONS)
        raise ValueError(f"Unsupported BGM file type: {suffix or 'missing extension'}; allowed: {allowed}")

    stem = Path(name).stem.strip()
    safe_stem = re.sub(r"[^\w.-]+", "_", stem, flags=re.UNICODE).strip("._-")
    if not safe_stem:
        safe_stem = "bgm"

    return f"{safe_stem}{suffix}"


def save_uploaded_bgm_file(uploaded_file: Any, target_dir: Path | str | None = None) -> str:
    """Persist an uploaded BGM file into the custom BGM directory."""
    from pixelle_video.utils.os_util import get_data_path

    saved_name = _safe_bgm_filename(getattr(uploaded_file, "name", ""))
    bgm_dir = Path(target_dir) if target_dir is not None else Path(get_data_path("bgm"))
    bgm_dir.mkdir(parents=True, exist_ok=True)

    target_path = bgm_dir / saved_name
    target_path.write_bytes(bytes(uploaded_file.getbuffer()))
    return saved_name


def render_content_input():
    """Render content input section (left column) with batch support"""
    with st.container(border=True):
        st.markdown(f"**{tr('section.content_input')}**")
        
        # ====================================================================
        # Step 1: Batch mode toggle (highest priority)
        # ====================================================================
        batch_mode = st.checkbox(
            tr("batch.mode_label"),
            value=False,
            help=tr("batch.mode_help")
        )
        
        if not batch_mode:
            # ================================================================
            # Single task mode (original logic, unchanged)
            # ================================================================
            # Processing mode selection
            mode = st.radio(
                "Processing Mode",
                ["generate", "fixed"],
                horizontal=True,
                format_func=lambda x: tr(f"mode.{x}"),
                label_visibility="collapsed"
            )
            
            # Text input (unified for both modes)
            text_placeholder = tr("input.topic_placeholder") if mode == "generate" else tr("input.content_placeholder")
            text_height = 120 if mode == "generate" else 200
            text_help = tr("input.text_help_generate") if mode == "generate" else tr("input.text_help_fixed")
            
            text = st.text_area(
                tr("input.text"),
                placeholder=text_placeholder,
                height=text_height,
                help=text_help
            )
            
            # Split mode selector (only show in fixed mode)
            if mode == "fixed":
                split_mode_options = {
                    "paragraph": tr("split.mode_paragraph"),
                    "line": tr("split.mode_line"),
                    "sentence": tr("split.mode_sentence"),
                }
                split_mode = st.selectbox(
                    tr("split.mode_label"),
                    options=list(split_mode_options.keys()),
                    format_func=lambda x: split_mode_options[x],
                    index=0,  # Default to paragraph mode
                    help=tr("split.mode_help")
                )
            else:
                split_mode = "paragraph"  # Default for generate mode (not used)
            
            # Title input (optional for both modes)
            title = st.text_input(
                tr("input.title"),
                placeholder=tr("input.title_placeholder"),
                help=tr("input.title_help")
            )
            
            # Number of scenes (only show in generate mode)
            if mode == "generate":
                n_scenes = st.slider(
                    tr("video.frames"),
                    min_value=3,
                    max_value=30,
                    value=5,
                    help=tr("video.frames_help"),
                    label_visibility="collapsed"
                )
                st.caption(tr("video.frames_label", n=n_scenes))
            else:
                # Fixed mode: n_scenes is ignored, set default value
                n_scenes = 5
                st.info(tr("video.frames_fixed_mode_hint"))
            
            return {
                "batch_mode": False,
                "mode": mode,
                "text": text,
                "title": title,
                "n_scenes": n_scenes,
                "split_mode": split_mode
            }
        
        else:
            # ================================================================
            # Batch mode
            # ================================================================
            st.markdown(f"**{tr('batch.section_title')}**")

            batch_content_mode = st.radio(
                tr("batch.content_mode_label"),
                ["generate", "fixed"],
                horizontal=True,
                format_func=lambda x: tr(f"mode.{x}"),
                help=tr("batch.content_mode_help")
            )
            
            # Batch rules info
            if batch_content_mode == "fixed":
                st.info(f"""
**{tr('batch.rules_title')}**
- ✅ {tr('batch.rule_fixed_1')}
- ✅ {tr('batch.rule_fixed_2')}
- ✅ {tr('batch.rule_3')}
            """)
            else:
                st.info(f"""
**{tr('batch.rules_title')}**
- ✅ {tr('batch.rule_generate_1')}
- ✅ {tr('batch.rule_generate_2')}
- ✅ {tr('batch.rule_3')}
            """)
            
            input_label = (
                tr("batch.scripts_label")
                if batch_content_mode == "fixed"
                else tr("batch.topics_label")
            )
            input_placeholder = (
                tr("batch.scripts_placeholder")
                if batch_content_mode == "fixed"
                else tr("batch.topics_placeholder")
            )
            input_help = (
                tr("batch.scripts_help")
                if batch_content_mode == "fixed"
                else tr("batch.topics_help")
            )

            # Batch content input
            text_input = st.text_area(
                input_label,
                height=300,
                placeholder=input_placeholder,
                help=input_help
            )
            
            batch_items = parse_batch_text_input(text_input, batch_content_mode)

            if text_input:
                if batch_items:
                    # Check count limit
                    if len(batch_items) > 100:
                        st.error(tr("batch.count_error", count=len(batch_items)))
                        batch_items = []
                    else:
                        st.success(tr("batch.count_success", count=len(batch_items)))
                        
                        # Preview batch item list
                        with st.expander(tr("batch.preview_title"), expanded=False):
                            for i, item in enumerate(batch_items, 1):
                                preview_text = item.splitlines()[0] if item.splitlines() else item
                                if len(preview_text) > 80:
                                    preview_text = f"{preview_text[:80]}..."
                                st.markdown(f"`{i}.` {preview_text}")
                else:
                    batch_items = []
            
            st.markdown("---")
            
            # Title prefix (optional)
            if batch_content_mode == "fixed":
                title_prefix = ""
                st.caption(tr("batch.fixed_title_hint"))
            else:
                title_prefix = st.text_input(
                    tr("batch.title_prefix_label"),
                    placeholder=tr("batch.title_prefix_placeholder"),
                    help=tr("batch.title_prefix_help")
                )
            
            if batch_content_mode == "fixed":
                split_mode_options = {
                    "paragraph": tr("split.mode_paragraph"),
                    "line": tr("split.mode_line"),
                    "sentence": tr("split.mode_sentence"),
                }
                split_mode = st.selectbox(
                    tr("split.mode_label"),
                    options=list(split_mode_options.keys()),
                    format_func=lambda x: split_mode_options[x],
                    index=0,
                    help=tr("split.mode_help")
                )
                n_scenes = 5
                st.info(tr("video.frames_fixed_mode_hint"))
            else:
                split_mode = "paragraph"

                # Number of scenes (unified for all videos)
                n_scenes = st.slider(
                    tr("batch.n_scenes_label"),
                    min_value=3,
                    max_value=30,
                    value=5,
                    help=tr("batch.n_scenes_help")
                )
                st.caption(tr("batch.n_scenes_caption", n=n_scenes))
            
            # Config info
            st.info(f"📌 {tr('batch.config_info')}")
            
            return {
                "batch_mode": True,
                "topics": batch_items,
                "mode": batch_content_mode,
                "title_prefix": title_prefix,
                "n_scenes": n_scenes,
                "split_mode": split_mode,
            }


def render_bgm_section(key_prefix=""):
    """Render BGM selection section"""
    with st.container(border=True):
        st.markdown(f"**{tr('section.bgm')}**")
        
        with st.expander(tr("help.feature_description"), expanded=False):
            st.markdown(f"**{tr('help.what')}**")
            st.markdown(tr("bgm.what"))
            st.markdown(f"**{tr('help.how')}**")
            st.markdown(tr("bgm.how"))
        
        # Dynamically scan bgm folder for music files (merged from bgm/ and data/bgm/)
        from pixelle_video.utils.os_util import list_resource_files
        
        try:
            all_files = list_resource_files("bgm")
            # Filter to audio files only
            bgm_files = sorted([f for f in all_files if f.lower().endswith(BGM_AUDIO_EXTENSIONS)])
        except Exception as e:
            st.warning(f"Failed to load BGM files: {e}")
            bgm_files = []

        selector_key = f"{key_prefix}bgm_selector"
        upload_state_key = f"{key_prefix}last_uploaded_bgm"
        uploaded_bgm = st.file_uploader(
            tr("bgm.upload"),
            type=BGM_UPLOAD_TYPES,
            accept_multiple_files=False,
            key=f"{key_prefix}bgm_uploader",
            help=tr("bgm.upload_help")
        )
        st.caption(tr("bgm.upload_hint"))

        if uploaded_bgm is not None:
            upload_signature = f"{uploaded_bgm.name}:{getattr(uploaded_bgm, 'size', '')}"
            try:
                saved_bgm_name = _safe_bgm_filename(uploaded_bgm.name)
                if st.session_state.get(upload_state_key) != upload_signature:
                    saved_bgm_name = save_uploaded_bgm_file(uploaded_bgm)
                    st.session_state[upload_state_key] = upload_signature
                    st.session_state[selector_key] = saved_bgm_name
                    st.success(tr("bgm.upload_success", file=saved_bgm_name))

                bgm_files = sorted(set(bgm_files + [saved_bgm_name]))
            except Exception as e:
                st.error(tr("bgm.upload_error", error=str(e)))
        
        # Add special "None" option
        bgm_options = [tr("bgm.none")] + bgm_files
        
        # Default to "default.mp3" if exists, otherwise first option
        default_index = 0
        if "default.mp3" in bgm_files:
            default_index = bgm_options.index("default.mp3")
        
        bgm_choice = st.selectbox(
            "BGM",
            bgm_options,
            index=default_index,
            label_visibility="collapsed",
            key=selector_key
        )
        
        # BGM volume slider (only show when BGM is selected)
        if bgm_choice != tr("bgm.none"):
            bgm_volume = st.slider(
                tr("bgm.volume"),
                min_value=0.0,
                max_value=0.5,
                value=0.2,
                step=0.01,
                format="%.2f",
                key=f"{key_prefix}bgm_volume_slider",
                help=tr("bgm.volume_help")
            )
        else:
            bgm_volume = 0.2  # Default value when no BGM selected
        
        # BGM preview button (only if BGM is not "None")
        if bgm_choice != tr("bgm.none"):
            if st.button(tr("bgm.preview"), key=f"{key_prefix}preview_bgm", use_container_width=True):
                from pixelle_video.utils.os_util import get_resource_path, resource_exists
                try:
                    if resource_exists("bgm", bgm_choice):
                        bgm_file_path = get_resource_path("bgm", bgm_choice)
                        st.audio(bgm_file_path)
                    else:
                        st.error(tr("bgm.preview_failed", file=bgm_choice))
                except Exception as e:
                    st.error(f"{tr('bgm.preview_failed', file=bgm_choice)}: {e}")
        
        # Use full filename for bgm_path (including extension)
        bgm_path = None if bgm_choice == tr("bgm.none") else bgm_choice
    
    return {
        "bgm_path": bgm_path,
        "bgm_volume": bgm_volume
    }


def render_version_info():
    """Render version info and GitHub link"""
    with st.container(border=True):
        st.markdown(f"**{tr('version.title')}**")
        version = get_project_version()
        github_url = "https://github.com/AIDC-AI/Pixelle-Video"
        
        # Version and GitHub link in one line
        github_url = "https://github.com/AIDC-AI/Pixelle-Video"
        badge_url = "https://img.shields.io/github/stars/AIDC-AI/Pixelle-Video"

        st.markdown(
            f'{tr("version.current")}: `{version}` &nbsp;&nbsp; '
            f'<a href="{github_url}" target="_blank">'
            f'<img src="{badge_url}" alt="GitHub stars" style="vertical-align: middle;">'
            f'</a>',
            unsafe_allow_html=True)
