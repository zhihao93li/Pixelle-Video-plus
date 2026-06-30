import shutil
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from pixelle_video.generation.schemas import EntryId, GenerationRequest


class ProductionTemplateError(ValueError):
    pass


class ProductionTemplate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    version: str
    display_name: str
    description: str
    project: str | None = None
    channel: str | None = None
    quality_tier: str
    pipeline_id: str
    entry: EntryId
    fixed_params: dict[str, Any] = Field(default_factory=dict)
    required_capabilities: list[str] = Field(default_factory=list)
    user_selectable_runtime: bool = False
    user_selectable_providers: list[str] = Field(default_factory=list)

    def identity_metadata(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "version": self.version,
            "name": self.display_name,
            "quality_tier": self.quality_tier,
        }


class ProductionTemplateRegistry:
    def __init__(
        self,
        templates: list[ProductionTemplate],
        *,
        defaults: dict[tuple[str, str], str] | None = None,
    ):
        self._templates = {template.id: template for template in templates}
        self._order = [template.id for template in templates]
        self._defaults = {
            (_normalize_key(project), _normalize_key(channel)): template_id
            for (project, channel), template_id in (defaults or {}).items()
        }

    def list(self) -> list[ProductionTemplate]:
        return [self._templates[template_id] for template_id in self._order]

    def get(self, template_id: str | None) -> ProductionTemplate:
        if not template_id:
            raise ProductionTemplateError("Production template id is required.")
        try:
            return self._templates[template_id]
        except KeyError:
            raise ProductionTemplateError(f"Unknown production template: {template_id}") from None

    def default_template_id(self, *, project: str, channel: str) -> str | None:
        return self._defaults.get((_normalize_key(project), _normalize_key(channel)))

    def compile_request(
        self,
        template_id: str,
        *,
        input: dict[str, Any],
        metadata: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
        available_capabilities: set[str] | None = None,
    ) -> GenerationRequest:
        template = self.get(template_id)
        self._require_capabilities(template, available_capabilities)

        params = dict(template.fixed_params)
        compose_runtime = params.get("compose_runtime", "html_ffmpeg")
        quality_profile = params.get("quality_profile", "basic")

        return GenerationRequest(
            pipeline_id=template.pipeline_id,
            entry=template.entry,
            input=input,
            params=params,
            metadata={
                **(metadata or {}),
                "production_template": template.identity_metadata(),
                "compose_runtime": compose_runtime,
                "quality_profile": quality_profile,
            },
            idempotency_key=idempotency_key,
        )

    def _require_capabilities(
        self,
        template: ProductionTemplate,
        available_capabilities: set[str] | None,
    ) -> None:
        if available_capabilities is None:
            return
        missing = [
            capability
            for capability in template.required_capabilities
            if capability not in available_capabilities
        ]
        if missing:
            missing_text = ", ".join(missing)
            raise ProductionTemplateError(
                f"Production template {template.id!r} requires unavailable capabilities: {missing_text}"
            )


def build_default_production_template_registry() -> ProductionTemplateRegistry:
    return ProductionTemplateRegistry(
        [
            ProductionTemplate(
                id="petwoods_xhs_daily_v1",
                version="v1",
                display_name="PetWoods 小红书日常短视频 v1",
                description="日常稳定产出的 PetWoods 小红书短视频模板。",
                project="PetWoods",
                channel="xiaohongshu",
                quality_tier="daily",
                pipeline_id="standard",
                entry="script",
                required_capabilities=["llm", "tts", "media", "ffmpeg", "persistence"],
                fixed_params={
                    "mode": "fixed",
                    "split_mode": "paragraph",
                    "frame_template": "1080x1920/image_default.html",
                    "tts_inference_mode": "local",
                    "tts_voice": "zh-CN-YunjianNeural",
                    "video_fps": 30,
                    "bgm_volume": 0.2,
                    "bgm_mode": "loop",
                    "compose_runtime": "html_ffmpeg",
                    "quality_profile": "basic",
                    "allow_silent": False,
                },
            ),
            ProductionTemplate(
                id="petwoods_xhs_quality_explainer_v1",
                version="v1",
                display_name="PetWoods 高质量解释视频 v1",
                description="用于重点内容的高质量动效解释视频模板。",
                project="PetWoods",
                channel="xiaohongshu",
                quality_tier="high_quality",
                pipeline_id="standard",
                entry="script",
                required_capabilities=[
                    "llm",
                    "tts",
                    "media",
                    "ffmpeg",
                    "persistence",
                    "hyperframes",
                ],
                fixed_params={
                    "mode": "fixed",
                    "split_mode": "paragraph",
                    "frame_template": "1080x1920/image_default.html",
                    "tts_inference_mode": "local",
                    "tts_voice": "zh-CN-YunjianNeural",
                    "video_fps": 30,
                    "bgm_volume": 0.18,
                    "bgm_mode": "loop",
                    "compose_runtime": "hyperframes",
                    "quality_profile": "strict",
                    "allow_silent": False,
                    "template_params": {
                        "motion_style": "kinetic_explainer",
                        "subtitle_density": "high",
                    },
                },
            ),
        ],
        defaults={("PetWoods", "xiaohongshu"): "petwoods_xhs_daily_v1"},
    )


def detect_available_generation_capabilities() -> set[str]:
    capabilities = {"llm", "tts", "media", "persistence"}
    if shutil.which("ffmpeg") and shutil.which("ffprobe"):
        capabilities.add("ffmpeg")
    if shutil.which("npx"):
        capabilities.add("hyperframes")
    return capabilities


def _normalize_key(value: str) -> str:
    return value.strip().lower()
