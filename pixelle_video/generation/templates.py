import shutil
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from pixelle_video.generation.schemas import EntryId, GenerationRequest

# 长文骨架的内置中性默认提示词（不带品牌词；含 {script}/{title}/{language}/{word_count} 占位）。
# 与 pipelines/long_form.py 的回落默认保持一致；模板把它写进 fixed_params，用户在配方详情页可编辑。
_LONG_FORM_DEFAULT_PROMPT = (
    "你是一名资深长文写作者。请把下面的确认稿扩写成一篇结构化的 markdown 长文，"
    "适合公众号 / 知乎 / 小红书长文发布。\n\n"
    "要求：\n"
    "- 用 markdown：开头一个抓人的钩子段落；正文用 ## 小标题分成若干小节；结尾给出明确的行动号召（CTA）。\n"
    "- 忠于确认稿的事实与观点，只做展开、举例、过渡与润色，不要编造与原意相悖的内容。\n"
    "- 语言：{language}。目标篇幅：{word_count} 字左右。\n"
    "- 标题（可选，用作一级标题）：{title}\n"
    "- 只输出正文 markdown，不要额外解释。\n\n"
    "确认稿：\n{script}\n"
)


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
    # 代码层退役标记（面向展示）：True 表示已退役的内置预设，只读、不可复活、归入「已退役」分组。
    # 与 ``enabled`` 区分——用户可停用/重启用普通模板（enabled 变化），但退役是代码事实（retired 恒定）。
    retired: bool = False
    migration_status: Literal["ready", "partial", "legacy_only", "planned"] = "ready"
    product_entry: str = "generate"
    streamlit_source: str | None = None
    migration_notes: str = ""
    allowed_user_params: list[str] = Field(default_factory=list)
    passthrough_input_fields: list[str] = Field(default_factory=list)
    is_custom: bool = False

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

    def add_template(self, template: ProductionTemplate) -> bool:
        """Append a template if its id is not already registered.

        Returns True if it was added, False if the id already exists (in which
        case the existing template is kept and the new one is skipped).
        """
        if template.id in self._templates:
            return False
        self._templates[template.id] = template
        self._order.append(template.id)
        return True

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
    registry = _build_builtin_production_template_registry()
    _append_custom_templates(registry)
    _apply_template_overrides(registry)
    _apply_enabled_overrides(registry)
    return registry


def _apply_enabled_overrides(registry: ProductionTemplateRegistry) -> None:
    """套用用户侧的启用/停用开关。

    - ``enabled=False`` → 强制停用（内置骨架与自定义均适用）。
    - ``enabled=True`` → 只对代码里本就启用的模板有效（它们已是 True，无需改动）；
      代码层退役的模板（``enabled=False``）**不复活**，防止诈尸。
    """
    from pixelle_video.generation.template_overrides import load_all_enabled

    for template_id, enabled in load_all_enabled().items():
        try:
            template = registry.get(template_id)
        except ProductionTemplateError:
            continue
        if enabled is False:
            template.enabled = False


def _append_custom_templates(registry: ProductionTemplateRegistry) -> None:
    """Append persisted custom (cloned) templates after the builtin ones.

    id 与内置冲突时保留内置、跳过自定义（``add_template`` 返回 False）。
    """
    from pixelle_video.generation.custom_templates import load_custom_templates

    for template in load_custom_templates():
        registry.add_template(template)


def _apply_template_overrides(registry: ProductionTemplateRegistry) -> None:
    """Merge persisted per-template generation-config overrides into fixed_params."""
    from pixelle_video.generation.template_overrides import load_all_overrides

    for template_id, overrides in load_all_overrides().items():
        try:
            template = registry.get(template_id)
        except ProductionTemplateError:
            continue
        allowed = set(template.allowed_user_params)
        template.fixed_params.update(
            {key: value for key, value in overrides.items() if key in allowed}
        )


def _build_builtin_production_template_registry() -> ProductionTemplateRegistry:
    return ProductionTemplateRegistry(
        [
            ProductionTemplate(
                id="pipeline_standard_base_v1",
                version="v1",
                display_name="图文口播视频",
                description=(
                    "文案 → 每段生成一张 AI 配图，配上字幕和配音，合成竖版口播视频。"
                    "克隆后可调默认画面、音色等参数。"
                ),
                use_case="standard_base",
                runtime_label="标准稳定合成",
                estimated_turnaround="日常速度",
                failure_guidance="检查文案、TTS、素材生成和 FFmpeg 配置后重试。",
                template_tags=["图文口播", "标准线", "骨架模板"],
                input_requirements=["script"],
                quality_tier="daily",
                pipeline_id="standard",
                entry="script",
                required_capabilities=["llm", "tts", "media", "ffmpeg", "persistence"],
                migration_status="ready",
                migration_notes=(
                    "标准线（standard）的中性骨架模板，参数取自 daily 去品牌化；"
                    "克隆后自定义默认参数。"
                ),
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
                    "compose_runtime",
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
                id="pipeline_asset_based_base_v1",
                version="v1",
                display_name="素材增强视频",
                description=(
                    "上传图片/视频素材，AI 组织成带字幕配音的完整短片。"
                    "克隆后可调默认合成参数。"
                ),
                use_case="asset_based_base",
                runtime_label="素材包装合成",
                estimated_turnaround="取决于素材数量",
                failure_guidance="检查上传素材路径、素材格式和 FFmpeg 配置后重试。",
                requires_user_assets=True,
                template_tags=["素材增强", "素材线", "骨架模板"],
                input_requirements=["assets"],
                quality_tier="daily",
                pipeline_id="asset_based",
                entry="assets",
                required_capabilities=["ffmpeg", "persistence"],
                migration_status="ready",
                migration_notes=(
                    "素材线（asset_based）的中性骨架模板，参数取自素材增强去品牌化；"
                    "克隆后自定义默认参数。"
                ),
                allowed_user_params=[
                    "bgm_path",
                    "bgm_volume",
                    "bgm_mode",
                    "voice_id",
                    "tts_speed",
                    "compose_runtime",
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
                id="pipeline_image_post_base_v1",
                version="v1",
                display_name="小红书图文帖",
                description=(
                    "文案 → 封面 + 每段一页配图的图集，直接发小红书图文。"
                    "克隆后可调默认版式、画面等参数。"
                ),
                use_case="image_post_base",
                runtime_label="图集渲染",
                estimated_turnaround="比视频快",
                failure_guidance="检查文案、画面生成和版式模板配置后重试。",
                template_tags=["图文帖", "图文线", "骨架模板"],
                input_requirements=["script"],
                quality_tier="daily",
                pipeline_id="image_post",
                entry="script",
                required_capabilities=["llm", "media", "persistence"],
                migration_status="ready",
                migration_notes=(
                    "图文线（image_post）的中性骨架模板；无 TTS、无视频合成，"
                    "确认稿行=页出图集。克隆后自定义默认参数。"
                ),
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
                    "source",
                ],
                fixed_params={
                    "mode": "fixed",
                    "split_mode": "line",
                    "frame_template": "1080x1440/image_post_default.html",
                    "media_width": 1024,
                    "media_height": 1024,
                    "quality_profile": "basic",
                },
            ),
            ProductionTemplate(
                id="pipeline_long_form_base_v1",
                version="v1",
                display_name="长文",
                description=(
                    "确认稿 → 扩写成结构化长文（markdown），适合公众号 / 知乎 / 小红书长文。"
                    "克隆后可调长文提示词、目标字数与写作模型。"
                ),
                use_case="long_form_base",
                runtime_label="LLM 扩写",
                estimated_turnaround="最快（纯文字）",
                failure_guidance="检查确认稿、长文提示词与写作模型配置后重试。",
                template_tags=["长文", "长文线", "骨架模板"],
                input_requirements=["script"],
                quality_tier="daily",
                pipeline_id="long_form",
                entry="script",
                required_capabilities=["llm", "persistence"],
                migration_status="ready",
                migration_notes=(
                    "长文线（long_form）的中性骨架模板；LLM-only，无配图/TTS/合成，"
                    "确认稿下游扩写成 markdown。克隆后自定义长文风格。"
                ),
                allowed_user_params=[
                    "title",
                    "long_form_prompt",
                    "word_count",
                    "llm_model",
                ],
                fixed_params={
                    "mode": "fixed",
                    "word_count": 1800,
                    "long_form_prompt": _LONG_FORM_DEFAULT_PROMPT,
                },
            ),
            ProductionTemplate(
                id="petwoods_xhs_daily_v1",
                version="v1",
                display_name="PetWoods 小红书日常短视频",
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
                enabled=False,
                migration_status="ready",
                migration_notes="已退役（PetWoods 预设，品牌进配方名）。替代：图文口播视频（pipeline_standard_base_v1），克隆后自定义。",
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
                display_name="PetWoods 静态字幕短视频",
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
                enabled=False,
                migration_status="ready",
                migration_notes=(
                    "已退役（PetWoods 预设）。替代：迁移生成的自定义模板"
                    "「静态字幕快出」（migrated_static_subtitle_v1），或克隆图文口播视频。"
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
                display_name="PetWoods 选题生成短视频",
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
                enabled=False,
                migration_status="ready",
                migration_notes="已退役（PetWoods 预设）。替代：图文口播视频（pipeline_standard_base_v1，输入选题也支持），克隆后自定义。",
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
                display_name="PetWoods 高质量解释视频",
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
                enabled=False,
                migration_status="ready",
                migration_notes="已退役（PetWoods 预设）。替代：克隆图文口播视频（pipeline_standard_base_v1），在默认配置里改 compose_runtime=hyperframes。",
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
                display_name="PetWoods 素材增强短视频",
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
                enabled=False,
                migration_status="ready",
                migration_notes="已退役（PetWoods 预设）。替代：素材增强视频（pipeline_asset_based_base_v1），克隆后自定义。",
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
                display_name="PetWoods 真实素材混剪短视频",
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
                enabled=False,
                migration_status="ready",
                migration_notes="已退役（PetWoods 预设）。替代：素材增强视频（pipeline_asset_based_base_v1），克隆后自定义混剪参数。",
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
                display_name="图片生成视频 I2V",
                description="上传图片并输入提示词，生成图片驱动的视频片段。这是 I2V 管线的基础模板，可克隆后调整默认参数。",
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
                allowed_user_params=[
                    "source", "title", "duration", "workflow_key"],
                fixed_params={
                    "workflow_key": "runninghub/i2v_LTX2.json",
                    "quality_profile": "basic",
                    "allow_silent": True,
                },
            ),
            ProductionTemplate(
                id="pixelle_action_transfer_basic_v1",
                version="v1",
                display_name="动作迁移视频",
                description="上传参考动作视频和目标图片，生成动作迁移视频。这是动作迁移管线的基础模板，可克隆后调整默认参数。",
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
                allowed_user_params=["title", "duration", "workflow_key"],
                fixed_params={
                    "workflow_key": "runninghub/af_scail.json",
                    "quality_profile": "basic",
                    "allow_silent": True,
                },
            ),
            ProductionTemplate(
                id="pixelle_digital_human_basic_v1",
                version="v1",
                display_name="数字人视频",
                description="上传角色图和商品/自定义文案，生成数字人视频。这是数字人管线的基础模板，可克隆后调整默认参数。",
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
                    "workflow_key",
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
                display_name="多语言审核出片",
                description="AI 起草多语言文案，人工审核后批量出片",
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
        ],
        defaults={("PetWoods", "xiaohongshu"): "pipeline_standard_base_v1"},
    )


def code_level_enabled(template_id: str) -> bool | None:
    """内置模板在代码里的 enabled 值；不是内置模板则返回 None（自定义/未知）。

    用于判断某模板是否"代码层退役"，从而禁止用户开关将其复活。
    """
    registry = _build_builtin_production_template_registry()
    try:
        return registry.get(template_id).enabled
    except ProductionTemplateError:
        return None


def code_level_enabled_map() -> dict[str, bool]:
    """一次性构建内置注册表并返回 {id: 代码层 enabled}，避免逐个查询重复构建。"""
    return {
        template.id: template.enabled
        for template in _build_builtin_production_template_registry().list()
    }


def annotate_retired(templates: list[ProductionTemplate]) -> None:
    """就地标注展示用 ``retired``：代码层停用的 generate 预设 = 已退役（只读、不可复活）。

    用户停用普通模板只会改 ``enabled``，其代码层 enabled 仍为 True → 不算退役。
    """
    builtin_enabled = code_level_enabled_map()
    for template in templates:
        template.retired = (
            builtin_enabled.get(template.id) is False
            and template.product_entry == "generate"
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
