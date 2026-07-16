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
Configuration schema with Pydantic models

Single source of truth for all configuration defaults and validation.
"""

from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

AIHUBMIX_BASE_URL = "https://aihubmix.com/v1"

LLMProviderType = Literal[
    "aihubmix",
    "openai",
    "deepseek",
    "minimax",
    "kimi",
    "anthropic",
    "xai",
    "aliyun_bailian",
    "volcengine_ark",
    "custom_openai",
]

# The backend owns the supported connection presets. The console reads this
# catalog at runtime instead of maintaining a second, easily stale list.
LLM_PROVIDER_PRESETS: dict[LLMProviderType, dict[str, str]] = {
    "aihubmix": {
        "label": "AiHubMix",
        "base_url": AIHUBMIX_BASE_URL,
    },
    "openai": {
        "label": "OpenAI",
        "base_url": "https://api.openai.com/v1",
    },
    "deepseek": {
        "label": "DeepSeek",
        "base_url": "https://api.deepseek.com",
    },
    "minimax": {
        "label": "MiniMax",
        "base_url": "https://api.minimaxi.com/v1",
    },
    "kimi": {
        "label": "Kimi / Moonshot AI",
        "base_url": "https://api.moonshot.cn/v1",
    },
    "anthropic": {
        "label": "Anthropic / Claude",
        "base_url": "https://api.anthropic.com/v1/",
    },
    "xai": {
        "label": "xAI / Grok",
        "base_url": "https://api.x.ai/v1",
    },
    "aliyun_bailian": {
        "label": "阿里百炼",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
    "volcengine_ark": {
        "label": "火山方舟",
        "base_url": "https://ark.cn-beijing.volces.com/api/v3",
    },
    "custom_openai": {
        "label": "自定义 OpenAI 兼容服务",
        "base_url": "",
    },
}


class LLMProviderConfig(BaseModel):
    """One real LLM connection, with its own credentials and request path."""

    name: str = ""
    provider_type: LLMProviderType = "custom_openai"
    enabled: bool = True
    api_key: str = ""
    base_url: str = ""
    default_model: str = ""


class LLMConfig(BaseModel):
    """LLM connections plus legacy fields retained for config migration."""

    api_key: str = Field(default="", description="LLM API Key")
    base_url: str = Field(default=AIHUBMIX_BASE_URL, description="LLM API Base URL")
    model: str = Field(default="", description="LLM Model Name")
    default_provider_id: str = ""
    providers: dict[str, LLMProviderConfig] = Field(default_factory=dict)

    @model_validator(mode="after")
    def migrate_legacy_connection(self):
        if not self.providers and (self.api_key or self.model):
            self.providers["aihubmix"] = LLMProviderConfig(
                name="AiHubMix",
                provider_type="aihubmix",
                enabled=True,
                api_key=self.api_key,
                base_url=self.base_url or AIHUBMIX_BASE_URL,
                default_model=self.model,
            )
            self.default_provider_id = "aihubmix"
        elif self.providers and self.default_provider_id not in self.providers:
            self.default_provider_id = next(iter(self.providers))
        return self

    def active_provider(self, provider_id: str | None = None) -> tuple[str, LLMProviderConfig]:
        selected_id = provider_id or self.default_provider_id
        provider = self.providers.get(selected_id)
        if provider is None:
            raise ValueError(f"LLM 服务不存在：{selected_id or '未设置'}")
        if not provider.enabled:
            raise ValueError(f"LLM 服务未启用：{provider.name or selected_id}")
        if not provider.api_key.strip() or not provider.base_url.strip():
            raise ValueError(f"LLM 服务配置不完整：{provider.name or selected_id}")
        return selected_id, provider


class TTSLocalConfig(BaseModel):
    """Microsoft Edge online TTS configuration."""

    voice: str = Field(default="zh-CN-YunjianNeural", description="Edge TTS voice ID")
    speed: float = Field(
        default=1.2, ge=0.5, le=2.0, description="Speech speed multiplier (0.5-2.0)"
    )


class TTSComfyUIConfig(BaseModel):
    """ComfyUI TTS configuration"""

    default_workflow: Optional[str] = Field(
        default=None, description="Default TTS workflow (optional)"
    )


class TTSFishAudioConfig(BaseModel):
    """Fish Audio TTS configuration"""

    api_key: str = Field(
        default="", description="Fish Audio API key. If empty, FISH_API_KEY env var is used."
    )
    base_url: str = Field(default="https://api.fish.audio", description="Fish Audio API base URL")
    model: Literal["s1", "s2-pro"] = Field(default="s2-pro", description="Fish Audio TTS model")
    reference_id: Optional[str] = Field(
        default=None, description="Default Fish Audio voice model ID"
    )
    speed: float = Field(default=1.0, ge=0.5, le=2.0, description="Speaking rate multiplier")
    volume: float = Field(default=0.0, description="Volume adjustment in dB")
    normalize_loudness: bool = Field(default=True, description="Normalize output loudness")
    temperature: float = Field(default=0.7, ge=0.0, le=1.0, description="Controls expressiveness")
    top_p: float = Field(
        default=0.7, ge=0.0, le=1.0, description="Controls diversity via nucleus sampling"
    )
    chunk_length: int = Field(
        default=300, ge=100, le=300, description="Text segment size for processing"
    )
    normalize: bool = Field(default=True, description="Normalize text before synthesis")
    format: Literal["wav", "pcm", "mp3", "opus"] = Field(
        default="mp3", description="Output audio format"
    )
    sample_rate: Optional[int] = Field(default=None, description="Optional output sample rate")
    mp3_bitrate: Literal[64, 128, 192] = Field(default=128, description="MP3 bitrate in kbps")
    opus_bitrate: Literal[-1000, 24000, 32000, 48000, 64000] = Field(
        default=-1000, description="Opus bitrate in bps"
    )
    latency: Literal["low", "normal", "balanced"] = Field(
        default="normal", description="Latency-quality trade-off"
    )
    max_new_tokens: int = Field(default=1024, description="Maximum audio tokens per chunk")
    repetition_penalty: float = Field(
        default=1.2, description="Penalty for repeated audio patterns"
    )
    min_chunk_length: int = Field(
        default=50, ge=0, le=100, description="Minimum characters before chunk split"
    )
    condition_on_previous_chunks: bool = Field(
        default=True, description="Use previous chunks as voice context"
    )
    early_stop_threshold: float = Field(
        default=1.0, ge=0.0, le=1.0, description="Early stopping threshold"
    )
    timeout: float = Field(default=120.0, gt=0.0, description="HTTP request timeout in seconds")


class TTSSubConfig(BaseModel):
    """TTS-specific configuration (under comfyui.tts)"""

    inference_mode: Literal["local", "comfyui", "fish"] = Field(
        default="local", description="TTS inference mode: 'local', 'comfyui', or 'fish'"
    )
    local: TTSLocalConfig = Field(
        default_factory=TTSLocalConfig, description="Microsoft Edge online TTS configuration"
    )
    comfyui: TTSComfyUIConfig = Field(
        default_factory=TTSComfyUIConfig, description="ComfyUI TTS configuration"
    )
    fish_audio: TTSFishAudioConfig = Field(
        default_factory=TTSFishAudioConfig, description="Fish Audio TTS configuration"
    )

class ImageSubConfig(BaseModel):
    """Image-specific configuration (under comfyui.image)"""

    default_workflow: Optional[str] = Field(
        default=None, description="Default image workflow (optional)"
    )
    prompt_prefix: str = Field(
        default="Minimalist black-and-white matchstick figure style illustration, clean lines, simple sketch style",
        description="Prompt prefix for all image generation",
    )


class VideoSubConfig(BaseModel):
    """Video-specific configuration (under comfyui.video)"""

    default_workflow: Optional[str] = Field(
        default=None, description="Default video workflow (optional)"
    )
    prompt_prefix: str = Field(
        default="Minimalist black-and-white matchstick figure style illustration, clean lines, simple sketch style",
        description="Prompt prefix for all video generation",
    )


class ComfyUIConfig(BaseModel):
    """ComfyUI configuration (includes global settings and service-specific configs)"""

    comfyui_url: str = Field(default="http://127.0.0.1:8188", description="ComfyUI Server URL")
    comfyui_api_key: Optional[str] = Field(default=None, description="ComfyUI API Key (optional)")
    runninghub_url: str = Field(
        default="https://www.runninghub.cn",
        description="RunningHub API base URL",
    )
    runninghub_api_key: Optional[str] = Field(
        default=None, description="RunningHub API Key (optional)"
    )
    runninghub_concurrent_limit: int = Field(
        default=1, ge=1, le=10, description="RunningHub concurrent execution limit (1-10)"
    )
    runninghub_instance_type: Optional[str] = Field(
        default=None, description="RunningHub instance type (optional, set to 'plus' for 48GB VRAM)"
    )
    runninghub_timeout: Optional[int] = Field(
        default=600, ge=30, description="RunningHub task timeout in seconds"
    )
    tts: TTSSubConfig = Field(
        default_factory=TTSSubConfig, description="TTS-specific configuration"
    )
    image: ImageSubConfig = Field(
        default_factory=ImageSubConfig, description="Image-specific configuration"
    )
    video: VideoSubConfig = Field(
        default_factory=VideoSubConfig, description="Video-specific configuration"
    )


class CloudImageProviderConfig(BaseModel):
    """Shared configuration for direct cloud image providers."""

    enabled: bool = False
    api_key: str = ""
    base_url: str = ""
    default_model: str = ""
    timeout: int = Field(default=300, ge=30, le=1800)
    concurrency_limit: int = Field(default=2, ge=1, le=10)


class AliyunBailianImageConfig(CloudImageProviderConfig):
    region: Literal["cn-beijing", "ap-southeast-1"] = "cn-beijing"
    workspace_id: str = ""
    default_model: str = "qwen-image-2.0"


class VolcengineArkImageConfig(CloudImageProviderConfig):
    base_url: str = "https://ark.cn-beijing.volces.com/api/v3"
    default_model: str = "doubao-seedream-5-0-lite"


class ImageGenerationConfig(BaseModel):
    """Direct image-generation providers; workflows remain under comfyui."""

    default_provider: Literal["comfy_workflow", "aliyun_bailian", "volcengine_ark"] = (
        "comfy_workflow"
    )
    aliyun_bailian: AliyunBailianImageConfig = Field(default_factory=AliyunBailianImageConfig)
    volcengine_ark: VolcengineArkImageConfig = Field(default_factory=VolcengineArkImageConfig)


class TemplateConfig(BaseModel):
    """Template configuration"""

    default_template: str = Field(
        default="1080x1920/image_default.html", description="Default frame template path"
    )


class BufferChannelsConfig(BaseModel):
    """Buffer channel IDs for each publish target."""

    tiktok: str = Field(default="", description="Buffer TikTok channel ID")
    youtube: str = Field(default="", description="Buffer YouTube channel ID")
    instagram: str = Field(default="", description="Buffer Instagram channel ID")
    x: str = Field(default="", description="Buffer X channel ID")
    pinterest: str = Field(default="", description="Buffer Pinterest channel ID")


class BufferPublishConfig(BaseModel):
    """Buffer publishing configuration."""

    api_key: str = Field(default="", description="Buffer API key")
    channels: BufferChannelsConfig = Field(default_factory=BufferChannelsConfig)


class COSPublishConfig(BaseModel):
    """Tencent Cloud COS public media storage configuration."""

    region: str = Field(default="", description="Tencent COS region, e.g. ap-hongkong")
    bucket: str = Field(
        default="", description="Tencent COS bucket name in BucketName-APPID format"
    )
    secret_id: str = Field(default="", description="Tencent Cloud SecretId")
    secret_key: str = Field(default="", description="Tencent Cloud SecretKey")
    public_base_url: str = Field(default="", description="Public base URL for COS objects")
    endpoint_url: Optional[str] = Field(
        default=None, description="Optional COS S3-compatible endpoint"
    )


class PublishConfig(BaseModel):
    """Publishing configuration for Buffer and public media storage."""

    buffer: BufferPublishConfig = Field(default_factory=BufferPublishConfig)
    cos: COSPublishConfig = Field(default_factory=COSPublishConfig)


class PixelleVideoConfig(BaseModel):
    """Pixelle-Video main configuration"""

    project_name: str = Field(default="Pixelle-Video", description="Project name")
    llm: LLMConfig = Field(default_factory=LLMConfig)
    comfyui: ComfyUIConfig = Field(default_factory=ComfyUIConfig)
    image_generation: ImageGenerationConfig = Field(default_factory=ImageGenerationConfig)
    template: TemplateConfig = Field(default_factory=TemplateConfig)
    publish: PublishConfig = Field(default_factory=PublishConfig)

    def is_llm_configured(self) -> bool:
        """Check if LLM is properly configured"""
        try:
            _, provider = self.llm.active_provider()
        except ValueError:
            return False
        return bool(provider.default_model.strip())

    def validate_required(self) -> bool:
        """Validate required configuration"""
        return self.is_llm_configured()

    def to_dict(self) -> dict:
        """Convert the validated configuration to a plain dictionary."""
        return self.model_dump()
