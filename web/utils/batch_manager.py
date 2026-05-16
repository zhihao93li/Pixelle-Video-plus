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
Lightweight batch manager for Streamlit (Simplified YAGNI version)
"""
import traceback
from typing import Any, Callable, Dict, List, Optional

from loguru import logger


def _batch_item_label(item: str, index: int) -> str:
    first_line = (item or "").strip().splitlines()[0] if (item or "").strip() else ""
    if not first_line:
        first_line = f"Task {index}"
    if len(first_line) > 80:
        return f"{first_line[:80]}..."
    return first_line


def _fixed_batch_title_and_body(item: str, index: int) -> tuple[str, str]:
    """Use the first line of a stripped block as title and the rest as script body."""
    text = (item or "").strip()
    if not text:
        fallback = f"Task {index}"
        return fallback, ""

    lines = text.splitlines()
    title = lines[0].strip() or f"Task {index}"
    body = "\n".join(lines[1:]).strip()
    if not body:
        body = text
    return title, body


class SimpleBatchManager:
    """
    Ultra-simple batch manager following YAGNI principle
    
    Design principles:
    1. Supports batch AI topics and batch fixed scripts
    2. Same config for all videos, only input text differs
    3. No CSV, no complex validation, just loop and execute
    """
    
    def __init__(self):
        self.results = []
        self.errors = []
        self.current_index = 0
        self.total_count = 0
    
    def execute_batch(
        self,
        pixelle_video,
        topics: List[str],
        shared_config: Dict[str, Any],
        overall_progress_callback: Optional[Callable] = None,
        task_progress_callback_factory: Optional[Callable] = None
    ) -> Dict[str, Any]:
        """
        Execute batch generation with shared config
        
        Args:
            pixelle_video: PixelleVideoCore instance
            topics: List of topics or fixed scripts (one per video)
            shared_config: Shared configuration for all videos
            overall_progress_callback: Callback for overall progress
            task_progress_callback_factory: Factory function to create per-task callback
        
        Returns:
            {
                "results": [...],
                "errors": [...],
                "total_count": N,
                "success_count": M,
                "failed_count": K
            }
        """
        self.results = []
        self.errors = []
        self.total_count = len(topics)
        
        mode = shared_config.get("mode", "generate")
        logger.info(f"Starting batch generation: {self.total_count} items (mode={mode})")
        
        for idx, item in enumerate(topics, 1):
            self.current_index = idx
            fixed_title = None
            fixed_body = item
            if mode == "fixed":
                fixed_title, fixed_body = _fixed_batch_title_and_body(item, idx)
                item_label = fixed_title
            else:
                item_label = _batch_item_label(item, idx)
            
            # Report overall progress
            if overall_progress_callback:
                overall_progress_callback(
                    current=idx,
                    total=self.total_count,
                    topic=item_label
                )
            
            try:
                logger.info(f"Task {idx}/{self.total_count} started: {item_label}")
                
                # Extract title_prefix from shared_config (not a valid parameter for generate_video)
                title_prefix = shared_config.get("title_prefix")
                
                # Build task params (merge topic with shared config, excluding title_prefix)
                task_params = {
                    "text": fixed_body,
                    "mode": mode,
                }
                
                # Merge shared config, excluding title_prefix and None values
                # Filter out None values to avoid interfering with parameter logic in generate_video
                for key, value in shared_config.items():
                    if key not in ("title_prefix", "mode") and value is not None:
                        task_params[key] = value
                
                # Generate title using title_prefix
                if mode == "generate":
                    if title_prefix:
                        task_params["title"] = f"{title_prefix} - {item_label}"
                    else:
                        # Use topic as title
                        task_params["title"] = item_label
                elif fixed_title:
                    task_params["title"] = fixed_title
                
                # Add per-task progress callback
                if task_progress_callback_factory:
                    task_params["progress_callback"] = task_progress_callback_factory(idx, item_label)
                
                # Execute generation
                from web.utils.async_helpers import run_async
                result = run_async(pixelle_video.generate_video(**task_params))
                
                # Extract task_id from video_path (e.g., output/20251118_173821_f96a/final.mp4)
                from pathlib import Path
                task_id = Path(result.video_path).parent.name
                
                # Record success
                self.results.append({
                    "index": idx,
                    "topic": item_label,
                    "input_text": fixed_body,
                    "task_id": task_id,
                    "video_path": result.video_path,
                    "status": "success"
                })
                
                logger.info(f"Task {idx}/{self.total_count} completed: {result.video_path}")
                
            except Exception as e:
                # Record error but continue
                error_msg = str(e)
                error_trace = traceback.format_exc()
                
                logger.error(f"Task {idx}/{self.total_count} failed: {error_msg}")
                logger.debug(f"Error traceback:\n{error_trace}")
                
                self.errors.append({
                    "index": idx,
                    "topic": item_label,
                    "input_text": fixed_body,
                    "error": error_msg,
                    "traceback": error_trace,
                    "status": "failed"
                })
                
                # Continue to next task
                continue
        
        success_count = len(self.results)
        failed_count = len(self.errors)
        
        logger.info(
            f"Batch generation completed: "
            f"{success_count}/{self.total_count} succeeded, "
            f"{failed_count} failed"
        )
        
        return {
            "results": self.results,
            "errors": self.errors,
            "total_count": self.total_count,
            "success_count": success_count,
            "failed_count": failed_count
        }
