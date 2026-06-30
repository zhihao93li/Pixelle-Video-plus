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
    use_case: str
    runtime_label: str
    estimated_turnaround: str
    failure_guidance: str
    requires_user_assets: bool = False
    advanced_controls_hidden: bool = True
    template_tags: list[str] = Field(default_factory=list)
    input_requirements: list[str] = Field(default_factory=list)
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
        self._require_input(template, input)

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

    def _require_input(self, template: ProductionTemplate, input: dict[str, Any]) -> None:
        missing = [
            key
            for key in template.input_requirements
            if not input.get(key)
        ]
        if missing:
            missing_text = ", ".join(missing)
            raise ProductionTemplateError(
                f"Production template {template.id!r} requires input fields: {missing_text}"
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
                use_case="daily",
                runtime_label="标准稳定合成",
                estimated_turnaround="日常速度",
                failure_guidance="检查文案、TTS、素材生成和 FFmpeg 配置后重试。",
                template_tags=["小红书", "日常", "字幕视频"],
                input_requirements=["script"],
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
                use_case="high_quality",
                runtime_label="高质量动效合成",
                estimated_turnaround="渲染耗时更长",
                failure_guidance="检查 HyperFrames 渲染环境、Node/npx 依赖和素材路径后重试。",
                template_tags=["小红书", "高质量", "解释视频", "强动效"],
                input_requirements=["script"],
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
            ProductionTemplate(
                id="petwoods_xhs_asset_enhanced_v1",
                version="v1",
                display_name="PetWoods 素材增强短视频 v1",
                description="用已有图片或视频素材包装成适合小红书发布的短视频。",
                project="PetWoods",
                channel="xiaohongshu",
                use_case="asset_enhanced",
                runtime_label="素材包装合成",
                estimated_turnaround="取决于素材数量",
                failure_guidance="检查上传素材路径、素材格式和 FFmpeg 配置后重试。",
                requires_user_assets=True,
                template_tags=["小红书", "用户素材", "素材包装"],
                input_requirements=["assets"],
                quality_tier="daily",
                pipeline_id="asset_based",
                entry="assets",
                required_capabilities=["ffmpeg", "persistence"],
                fixed_params={
                    "mode": "asset_based",
                    "frame_template": "1080x1920/asset_default.html",
                    "video_fps": 30,
                    "bgm_volume": 0.18,
                    "bgm_mode": "loop",
                    "compose_runtime": "html_ffmpeg",
                    "quality_profile": "basic",
                    "allow_silent": False,
                    "template_params": {
                        "layout": "asset_first",
                        "subtitle_density": "medium",
                    },
                },
            ),
            ProductionTemplate(
                id="petwoods_xhs_real_material_montage_v1",
                version="v1",
                display_name="PetWoods 真实素材混剪短视频 v1",
                description="轻量真实素材 montage 模板，适合宠物场景、生活方式和科普氛围短片。",
                project="PetWoods",
                channel="xiaohongshu",
                use_case="real_material_montage",
                runtime_label="轻量素材混剪",
                estimated_turnaround="取决于素材数量",
                failure_guidance="检查用户素材、素材时长、字幕文本和 FFmpeg 配置后重试。",
                requires_user_assets=True,
                template_tags=["小红书", "真实素材", "混剪", "轻量 montage"],
                input_requirements=["assets"],
                quality_tier="daily",
                pipeline_id="asset_based",
                entry="assets",
                required_capabilities=["ffmpeg", "persistence"],
                fixed_params={
                    "mode": "asset_based",
                    "source_policy": "user_assets_first",
                    "montage_style": "light_real_material",
                    "frame_template": "1080x1920/asset_default.html",
                    "video_fps": 30,
                    "bgm_volume": 0.2,
                    "bgm_mode": "loop",
                    "compose_runtime": "html_ffmpeg",
                    "quality_profile": "basic",
                    "allow_silent": False,
                    "template_params": {
                        "shot_selection": "simple_sequence",
                        "subtitle_density": "medium",
                        "transition": "cut",
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
