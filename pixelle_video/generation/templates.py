import shutil
from typing import Any, Literal

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
    enabled: bool = True
    migration_status: Literal["ready", "partial", "legacy_only", "planned"] = "ready"
    product_entry: str = "generate"
    streamlit_source: str | None = None
    migration_notes: str = ""
    allowed_user_params: list[str] = Field(default_factory=list)
    passthrough_input_fields: list[str] = Field(default_factory=list)

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
        if not template.enabled:
            raise ProductionTemplateError(
                f"Production template {template.id!r} is not available through the generic "
                f"production-template task endpoint. "
                f"{template.migration_notes or 'Use its dedicated product entry for this flow.'}"
            )
        self._require_capabilities(template, available_capabilities)
        self._require_input(template, input)

        params = dict(template.fixed_params)
        pipeline_input = {
            key: input[key]
            for key in template.input_requirements
            if key in input
        }
        for key in template.passthrough_input_fields:
            if key in input and input[key] not in (None, ""):
                pipeline_input[key] = input[key]
        for key in template.allowed_user_params:
            if key not in input:
                continue
            value = input[key]
            if value is None or value == "":
                continue
            params[key] = value

        compose_runtime = params.get("compose_runtime", "html_ffmpeg")
        quality_profile = params.get("quality_profile", "basic")

        return GenerationRequest(
            pipeline_id=template.pipeline_id,
            entry=template.entry,
            input=pipeline_input,
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

        if "assets" in template.input_requirements:
            assets = input.get("assets")
            if (
                not isinstance(assets, list)
                or not assets
                or any(not isinstance(asset, str) or not asset.strip() for asset in assets)
            ):
                raise ProductionTemplateError(
                    f"Production template {template.id!r} assets must be a list of file paths."
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
                streamlit_source="web/pipelines/standard.py",
                migration_status="ready",
                migration_notes="React 已覆盖 Streamlit standard 已确认文案主路径和高级设置；provider/runtime 固定在模板配置里。",
                allowed_user_params=[
                    "title",
                    "split_mode",
                    "frame_template",
                    "template_params",
                    "media_workflow",
                    "media_width",
                    "media_height",
                    "prompt_prefix",
                    "image_prompt_visual_context",
                    "image_prompt_generation_rules",
                    "bgm_path",
                    "bgm_volume",
                    "bgm_mode",
                    "tts_inference_mode",
                    "tts_workflow",
                    "tts_voice",
                    "tts_speed",
                    "ref_audio",
                ],
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
                id="petwoods_xhs_static_subtitle_v1",
                version="v1",
                display_name="PetWoods 静态字幕短视频 v1",
                description="不依赖外部媒体生成的低成本字幕短视频模板。",
                project="PetWoods",
                channel="xiaohongshu",
                use_case="static_subtitle",
                runtime_label="本地静态合成",
                estimated_turnaround="最快",
                failure_guidance="检查文案、TTS、静态帧模板和 FFmpeg 配置后重试。",
                template_tags=["小红书", "静态字幕", "本地合成", "低成本"],
                input_requirements=["script"],
                quality_tier="daily",
                pipeline_id="standard",
                entry="script",
                required_capabilities=["llm", "tts", "ffmpeg", "persistence"],
                streamlit_source="web/components/style_config.py",
                migration_status="ready",
                migration_notes=(
                    "对应 Streamlit 模板类型 static；固定使用 static_default.html，"
                    "不触发 RunningHub/ComfyUI 媒体生成。"
                ),
                allowed_user_params=[
                    "title",
                    "split_mode",
                    "template_params",
                    "bgm_path",
                    "bgm_volume",
                    "bgm_mode",
                    "tts_inference_mode",
                    "tts_workflow",
                    "tts_voice",
                    "tts_speed",
                    "ref_audio",
                ],
                fixed_params={
                    "mode": "fixed",
                    "split_mode": "paragraph",
                    "frame_template": "1080x1920/static_default.html",
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
                id="petwoods_xhs_topic_to_video_v1",
                version="v1",
                display_name="PetWoods 选题生成短视频 v1",
                description="输入选题或内容方向，由标准 pipeline 生成脚本并制作小红书短视频。",
                project="PetWoods",
                channel="xiaohongshu",
                use_case="topic_to_video",
                runtime_label="标准稳定合成",
                estimated_turnaround="比已有文案稍长",
                failure_guidance="检查选题文本、LLM、TTS、素材生成和 FFmpeg 配置后重试。",
                template_tags=["小红书", "选题", "脚本生成", "字幕视频"],
                input_requirements=["topic"],
                quality_tier="daily",
                pipeline_id="standard",
                entry="topic",
                required_capabilities=["llm", "tts", "media", "ffmpeg", "persistence"],
                streamlit_source="web/pipelines/standard.py",
                migration_status="ready",
                migration_notes="对应 Streamlit standard direct/generate 模式；provider/runtime 固定在模板配置里。",
                allowed_user_params=[
                    "title",
                    "n_scenes",
                    "frame_template",
                    "template_params",
                    "media_workflow",
                    "media_width",
                    "media_height",
                    "prompt_prefix",
                    "image_prompt_visual_context",
                    "image_prompt_generation_rules",
                    "bgm_path",
                    "bgm_volume",
                    "bgm_mode",
                    "tts_inference_mode",
                    "tts_workflow",
                    "tts_voice",
                    "tts_speed",
                    "ref_audio",
                ],
                fixed_params={
                    "mode": "generate",
                    "n_scenes": 5,
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
                streamlit_source="web/pipelines/standard.py",
                migration_status="ready",
                migration_notes="高质量合成模板已接入；HyperFrames 能力由后端 capability 检查决定。",
                allowed_user_params=[
                    "title",
                    "split_mode",
                    "frame_template",
                    "template_params",
                    "media_workflow",
                    "media_width",
                    "media_height",
                    "prompt_prefix",
                    "image_prompt_visual_context",
                    "image_prompt_generation_rules",
                    "bgm_path",
                    "bgm_volume",
                    "bgm_mode",
                    "tts_inference_mode",
                    "tts_workflow",
                    "tts_voice",
                    "tts_speed",
                    "ref_audio",
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
                streamlit_source="web/pipelines/asset_based.py",
                migration_status="ready",
                migration_notes="React 已覆盖素材上传、标题、目标、时长、BGM、声音和语速；source/provider 固定在模板配置里。",
                allowed_user_params=[
                    "bgm_path",
                    "bgm_volume",
                    "bgm_mode",
                    "voice_id",
                    "tts_speed",
                ],
                passthrough_input_fields=["video_title", "intent", "duration"],
                fixed_params={
                    "mode": "asset_based",
                    "source": "runninghub",
                    "frame_template": "1080x1920/asset_default.html",
                    "video_fps": 30,
                    "bgm_volume": 0.18,
                    "bgm_mode": "loop",
                    "compose_runtime": "html_ffmpeg",
                    "quality_profile": "basic",
                    "runninghub_instance_type": "plus",
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
                streamlit_source="web/pipelines/asset_based.py",
                migration_status="ready",
                migration_notes="React 已覆盖真实素材混剪主路径、BGM、声音和语速；复杂 workflow 调试归入模板配置或 legacy/debug。",
                allowed_user_params=[
                    "bgm_path",
                    "bgm_volume",
                    "bgm_mode",
                    "voice_id",
                    "tts_speed",
                ],
                passthrough_input_fields=["video_title", "intent", "duration"],
                fixed_params={
                    "mode": "asset_based",
                    "source": "runninghub",
                    "source_policy": "user_assets_first",
                    "montage_style": "light_real_material",
                    "frame_template": "1080x1920/asset_default.html",
                    "video_fps": 30,
                    "bgm_volume": 0.2,
                    "bgm_mode": "loop",
                    "compose_runtime": "html_ffmpeg",
                    "quality_profile": "basic",
                    "runninghub_instance_type": "plus",
                    "allow_silent": False,
                    "template_params": {
                        "shot_selection": "simple_sequence",
                        "subtitle_density": "medium",
                        "transition": "cut",
                    },
                },
            ),
            ProductionTemplate(
                id="pixelle_i2v_basic_v1",
                version="v1",
                display_name="图片生成视频 I2V v1",
                description="上传图片并输入提示词，生成图片驱动的视频片段。",
                use_case="image_to_video",
                runtime_label="固定 I2V workflow",
                estimated_turnaround="取决于 ComfyUI/RunningHub workflow",
                failure_guidance="检查上传图片、提示词、I2V workflow、RunningHub/ComfyUI 配置和返回视频地址后重试。",
                requires_user_assets=True,
                advanced_controls_hidden=True,
                template_tags=["I2V", "图片生成视频"],
                input_requirements=["assets", "prompt"],
                quality_tier="daily",
                pipeline_id="i2v",
                entry="assets",
                enabled=True,
                migration_status="ready",
                product_entry="image_to_video",
                streamlit_source="web/pipelines/i2v.py",
                migration_notes="React 已可通过统一 generation task 提交；workflow 固定在模板配置里。",
                allowed_user_params=["title", "duration"],
                fixed_params={
                    "workflow_key": "runninghub/i2v_LTX2.json",
                    "quality_profile": "basic",
                    "allow_silent": True,
                },
            ),
            ProductionTemplate(
                id="pixelle_action_transfer_basic_v1",
                version="v1",
                display_name="动作迁移视频 v1",
                description="上传参考动作视频和目标图片，生成动作迁移视频。",
                use_case="action_transfer",
                runtime_label="固定动作迁移 workflow",
                estimated_turnaround="取决于动作视频时长和 workflow",
                failure_guidance="检查参考视频、目标图片、提示词、动作迁移 workflow 和 RunningHub/ComfyUI 配置后重试。",
                requires_user_assets=True,
                advanced_controls_hidden=True,
                template_tags=["动作迁移", "参考视频"],
                input_requirements=["reference_video", "assets", "prompt"],
                quality_tier="daily",
                pipeline_id="action_transfer",
                entry="video",
                enabled=True,
                migration_status="ready",
                product_entry="action_transfer",
                streamlit_source="web/pipelines/action_transfer.py",
                migration_notes="React 已可通过统一 generation task 提交；workflow 固定在模板配置里。",
                allowed_user_params=["title", "duration"],
                fixed_params={
                    "workflow_key": "runninghub/af_scail.json",
                    "quality_profile": "basic",
                    "allow_silent": True,
                },
            ),
            ProductionTemplate(
                id="pixelle_digital_human_basic_v1",
                version="v1",
                display_name="数字人视频 v1",
                description="上传角色图和商品/自定义文案，生成数字人视频。",
                use_case="digital_human",
                runtime_label="固定数字人三段 workflow",
                estimated_turnaround="取决于三段数字人 workflow",
                failure_guidance="检查角色图、商品图/文案、TTS、数字人 workflow 和 RunningHub/ComfyUI 配置后重试。",
                requires_user_assets=True,
                advanced_controls_hidden=True,
                template_tags=["数字人", "角色图"],
                input_requirements=["character_assets"],
                quality_tier="daily",
                pipeline_id="digital_human",
                entry="assets",
                enabled=True,
                migration_status="ready",
                product_entry="digital_human",
                streamlit_source="web/pipelines/digital_human.py",
                migration_notes="React 已可通过统一 generation task 提交；三段 workflow 固定在模板配置里。",
                allowed_user_params=[
                    "title",
                    "mode",
                    "goods_assets",
                    "goods_title",
                    "tts_inference_mode",
                    "tts_voice",
                    "tts_speed",
                    "tts_workflow",
                    "ref_audio",
                ],
                passthrough_input_fields=["script"],
                fixed_params={
                    "mode": "customize",
                    "workflow_paths": {
                        "first_workflow_path": "workflows/runninghub/digital_image.json",
                        "second_workflow_path": "workflows/runninghub/digital_combination.json",
                        "third_workflow_path": "workflows/runninghub/digital_customize.json",
                    },
                    "tts_inference_mode": "local",
                    "tts_voice": "zh-CN-YunjianNeural",
                    "tts_speed": 1.2,
                    "quality_profile": "basic",
                    "allow_silent": True,
                },
            ),
            ProductionTemplate(
                id="pixelle_script_review_v1",
                version="v1",
                display_name="文案审核后生成 v1",
                description="先生成并审核文案草稿，再从确认稿生成视频。",
                use_case="script_review",
                runtime_label="专用审核 API 工作流",
                estimated_turnaround="取决于草稿数量和语言数量",
                failure_guidance="检查选题、LLM、Prompt 模板、每语言 Fish TTS reference_id 和生成配置后重试。",
                template_tags=["文案审核", "多语言", "计划迁移"],
                input_requirements=["topic"],
                quality_tier="daily",
                pipeline_id="standard",
                entry="topic",
                enabled=False,
                migration_status="ready",
                product_entry="script_review",
                streamlit_source="web/components/script_review_workflow.py",
                migration_notes="React 已接入专用 draft API 与审核后生成任务提交；不通过普通 template task 端点提交。",
            ),
            ProductionTemplate(
                id="pixelle_batch_production_v1",
                version="v1",
                display_name="批量生产 v1",
                description="批量提交 topic 或 script，跟踪每条任务状态并支持失败重试。",
                use_case="batch_production",
                runtime_label="专用批量 API 工作流",
                estimated_turnaround="取决于批量条数",
                failure_guidance="检查批量输入、生产模板必填字段和单条任务失败原因后重试。",
                template_tags=["批量生产", "计划迁移"],
                input_requirements=["batch_items"],
                quality_tier="daily",
                pipeline_id="standard",
                entry="topic",
                enabled=False,
                migration_status="ready",
                product_entry="batch",
                streamlit_source="web/components/output_preview.py",
                migration_notes=(
                    "React 已接入持久化 batch API，支持 topic/script 批量提交、共享分镜/拆分、"
                    "BGM、TTS、画面模板、模板参数、媒体 workflow 与真实任务状态跟踪；"
                    "不通过普通 template task 端点提交。"
                ),
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
