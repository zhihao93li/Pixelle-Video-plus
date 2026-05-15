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
Configuration Manager - Singleton pattern

Provides unified access to configuration with automatic validation.
"""
from pathlib import Path
from typing import Any, Optional

from loguru import logger

from .loader import load_config_dict, save_config_dict
from .schema import PixelleVideoConfig


class ConfigManager:
    """
    Configuration Manager (Singleton)
    
    Provides unified access to configuration with automatic validation.
    """
    _instance: Optional['ConfigManager'] = None
    
    def __new__(cls, config_path: str = "config.yaml"):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    def __init__(self, config_path: str = "config.yaml"):
        # Only initialize once
        if hasattr(self, '_initialized'):
            return
        
        self.config_path = Path(config_path)
        self.config: PixelleVideoConfig = self._load()
        self._initialized = True
    
    def _load(self) -> PixelleVideoConfig:
        """Load configuration from file"""
        data = load_config_dict(str(self.config_path))
        config = PixelleVideoConfig(**data)
        
        # Validate template path exists
        self._validate_template(config.template.default_template)
        
        return config
    
    def _validate_template(self, template_path: str):
        """Validate that the configured template exists"""
        from pixelle_video.utils.template_util import resolve_template_path
        
        try:
            # Try to resolve the template path
            resolved_path = resolve_template_path(template_path)
            logger.debug(f"Template validation passed: {template_path} -> {resolved_path}")
        except FileNotFoundError as e:
            logger.warning(
                f"Configured default template '{template_path}' not found. "
                f"Will fall back to '1080x1920/default.html' if needed. Error: {e}"
            )
    
    def reload(self):
        """Reload configuration from file"""
        self.config = self._load()
        logger.info("Configuration reloaded")
    
    def save(self):
        """Save current configuration to file"""
        save_config_dict(self.config.to_dict(), str(self.config_path))
    
    def update(self, updates: dict):
        """
        Update configuration with new values
        
        Args:
            updates: Dictionary of updates (e.g., {"llm": {"api_key": "xxx"}})
        """
        current = self.config.to_dict()
        
        # Deep merge
        def deep_merge(base: dict, updates: dict) -> dict:
            for key, value in updates.items():
                if key in base and isinstance(base[key], dict) and isinstance(value, dict):
                    deep_merge(base[key], value)
                else:
                    base[key] = value
            return base
        
        merged = deep_merge(current, updates)
        self.config = PixelleVideoConfig(**merged)
    
    def get(self, key: str, default: Any = None) -> Any:
        """Dict-like access (for backward compatibility)"""
        return self.config.to_dict().get(key, default)
    
    def validate(self) -> bool:
        """Validate configuration completeness"""
        return self.config.validate_required()
    
    def get_llm_config(self) -> dict:
        """Get LLM configuration as dict"""
        return {
            "api_key": self.config.llm.api_key,
            "base_url": self.config.llm.base_url,
            "model": self.config.llm.model,
        }
    
    def set_llm_config(self, api_key: str, base_url: str, model: str):
        """Set LLM configuration"""
        self.update({
            "llm": {
                "api_key": api_key,
                "base_url": base_url,
                "model": model,
            }
        })
    
    def get_comfyui_config(self) -> dict:
        """Get ComfyUI configuration as dict"""
        return {
            "comfyui_url": self.config.comfyui.comfyui_url,
            "comfyui_api_key": self.config.comfyui.comfyui_api_key,
            "runninghub_api_key": self.config.comfyui.runninghub_api_key,
            "runninghub_concurrent_limit": self.config.comfyui.runninghub_concurrent_limit,
            "runninghub_instance_type": self.config.comfyui.runninghub_instance_type,
            "tts": {
                "inference_mode": self.config.comfyui.tts.inference_mode,
                "local": self.config.comfyui.tts.local.model_dump(),
                "comfyui": self.config.comfyui.tts.comfyui.model_dump(),
                "fish_audio": self.config.comfyui.tts.fish_audio.model_dump(),
                "default_workflow": self.config.comfyui.tts.default_workflow,
            },
            "image": {
                "default_workflow": self.config.comfyui.image.default_workflow,
                "prompt_prefix": self.config.comfyui.image.prompt_prefix,
            },
            "video": {
                "default_workflow": self.config.comfyui.video.default_workflow,
                "prompt_prefix": self.config.comfyui.video.prompt_prefix,
            }
        }
    
    def set_comfyui_config(
        self,
        comfyui_url: Optional[str] = None,
        comfyui_api_key: Optional[str] = None,
        runninghub_api_key: Optional[str] = None,
        runninghub_concurrent_limit: Optional[int] = None,
        runninghub_instance_type: Optional[str] = None
    ):
        """Set ComfyUI global configuration"""
        updates = {}
        if comfyui_url is not None:
            updates["comfyui_url"] = comfyui_url
        if comfyui_api_key is not None:
            updates["comfyui_api_key"] = comfyui_api_key
        if runninghub_api_key is not None:
            updates["runninghub_api_key"] = runninghub_api_key
        if runninghub_concurrent_limit is not None:
            updates["runninghub_concurrent_limit"] = runninghub_concurrent_limit
        if runninghub_instance_type is not None:
            # Empty string means disable (treat as None for storage)
            updates["runninghub_instance_type"] = runninghub_instance_type if runninghub_instance_type else None
        
        if updates:
            self.update({"comfyui": updates})

    def set_tts_fish_audio_config(
        self,
        api_key: Optional[str] = None,
        reference_id: Optional[str] = None,
        model: Optional[str] = None,
        base_url: Optional[str] = None,
    ):
        """Set Fish Audio TTS configuration"""
        updates = {}
        if api_key is not None:
            updates["api_key"] = api_key
        if reference_id is not None:
            updates["reference_id"] = reference_id if reference_id else None
        if model is not None:
            updates["model"] = model
        if base_url is not None:
            updates["base_url"] = base_url if base_url else "https://api.fish.audio"

        if updates:
            self.update({"comfyui": {"tts": {"fish_audio": updates}}})

    def get_publish_config(self) -> dict:
        """Get publish configuration as dict."""
        return self.config.publish.model_dump()

    def set_publish_config(
        self,
        buffer_api_key: Optional[str] = None,
        buffer_channel_tiktok: Optional[str] = None,
        buffer_channel_youtube: Optional[str] = None,
        buffer_channel_x: Optional[str] = None,
        r2_account_id: Optional[str] = None,
        r2_bucket: Optional[str] = None,
        r2_access_key_id: Optional[str] = None,
        r2_secret_access_key: Optional[str] = None,
        r2_public_base_url: Optional[str] = None,
        r2_endpoint_url: Optional[str] = None,
    ):
        """Set Buffer and Cloudflare R2 publish configuration."""
        buffer_updates = {}
        channel_updates = {}
        r2_updates = {}

        if buffer_api_key is not None:
            buffer_updates["api_key"] = buffer_api_key
        if buffer_channel_tiktok is not None:
            channel_updates["tiktok"] = buffer_channel_tiktok
        if buffer_channel_youtube is not None:
            channel_updates["youtube"] = buffer_channel_youtube
        if buffer_channel_x is not None:
            channel_updates["x"] = buffer_channel_x

        if r2_account_id is not None:
            r2_updates["account_id"] = r2_account_id
        if r2_bucket is not None:
            r2_updates["bucket"] = r2_bucket
        if r2_access_key_id is not None:
            r2_updates["access_key_id"] = r2_access_key_id
        if r2_secret_access_key is not None:
            r2_updates["secret_access_key"] = r2_secret_access_key
        if r2_public_base_url is not None:
            r2_updates["public_base_url"] = r2_public_base_url.rstrip("/")
        if r2_endpoint_url is not None:
            r2_updates["endpoint_url"] = r2_endpoint_url or None

        if channel_updates:
            buffer_updates["channels"] = channel_updates

        updates = {}
        if buffer_updates:
            updates["buffer"] = buffer_updates
        if r2_updates:
            updates["r2"] = r2_updates

        if updates:
            self.update({"publish": updates})
