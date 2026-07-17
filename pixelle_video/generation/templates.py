import shutil
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from pixelle_video.generation.schemas import GenerationRequest

# 长文骨架的内置中性默认提示词（不带品牌词；含 {script}/{title}/{language}/{word_count} 占位）。
# 与 pipelines/long_form.py 的回落默认保持一致；模板把它写进 fixed_params，用户在模板详情页可编辑。
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


DEFAULT_SCRIPT_TEMPLATE = "Short Oral Script"
DEFAULT_SPLIT_TEMPLATE = "Copy-Safe Scene Split"
SCRIPT_SETTING_DEFAULTS: dict[str, Any] = {
    "script_template_name": DEFAULT_SCRIPT_TEMPLATE,
    "script_provider_id": "",
    "script_model": "",
    "language_script_models": {},
}
SPLIT_SETTING_DEFAULTS: dict[str, Any] = {
    "split_template_name": DEFAULT_SPLIT_TEMPLATE,
    "split_provider_id": "",
    "split_model": "",
}


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
    fixed_params: dict[str, Any] = Field(default_factory=dict)
    required_capabilities: list[str] = Field(default_factory=list)
    user_selectable_runtime: bool = False
    user_selectable_providers: list[str] = Field(default_factory=list)
    enabled: bool = True
    allowed_user_params: list[str] = Field(default_factory=list)
    passthrough_input_fields: list[str] = Field(default_factory=list)
    is_custom: bool = False
    access_scope: Literal["public", "agent"] = "public"

    def identity_metadata(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "version": self.version,
            "name": self.display_name,
            "pipeline_id": self.pipeline_id,
            "quality_tier": self.quality_tier,
        }


class ProductionTemplateRegistry:
    def __init__(
        self,
        templates: list[ProductionTemplate],
        *,
        initial_template_id: str | None = None,
    ):
        self._templates = {template.id: template for template in templates}
        self._order = [template.id for template in templates]
        self._initial_template_id = initial_template_id

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

    def initial_template_id(self) -> str | None:
        """Return the global first-use suggestion, independent of content space."""
        return self._initial_template_id

    def compile_request(
        self,
        template_id: str,
        *,
        input: dict[str, Any],
        metadata: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
        available_capabilities: set[str] | None = None,
        surface: Literal["public", "agent"] = "public",
    ) -> GenerationRequest:
        template = self.get(template_id)
        self.require_access(template, surface=surface)
        if not template.enabled:
            raise ProductionTemplateError(
                f"Production template {template.id!r} is not available through the generic "
                f"production-template task endpoint. "
                f"{template.failure_guidance}"
            )
        self._require_capabilities(template, available_capabilities)
        self._require_input(template, input)

        params = dict(template.fixed_params)
        pipeline_input = {key: input[key] for key in template.input_requirements if key in input}
        for key in template.passthrough_input_fields:
            if key in input and input[key] not in (None, ""):
                pipeline_input[key] = input[key]
        for key in template.allowed_user_params:
            if key not in input:
                continue
            value = input[key]
            # Per-run override contract: omitted means inherit the recipe;
            # explicit null removes an inherited value and lets the runtime use
            # its own default. Empty strings mean "not provided".
            if value is None:
                params.pop(key, None)
                continue
            if value == "":
                continue
            params[key] = value

        compose_runtime = params.get("compose_runtime", "html_ffmpeg")
        quality_profile = params.get("quality_profile", "basic")

        return GenerationRequest(
            pipeline_id=template.pipeline_id,
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

    @staticmethod
    def require_access(
        template: ProductionTemplate,
        *,
        surface: Literal["public", "agent"],
    ) -> None:
        if template.access_scope == "agent" and surface != "agent":
            raise ProductionTemplateError(
                f"Production template {template.id!r} is only available through an Agent."
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
        missing = [key for key in template.input_requirements if not input.get(key)]
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
    registry = build_builtin_production_template_registry()
    _append_custom_templates(registry)
    _apply_template_overrides(registry)
    _apply_enabled_overrides(registry)
    return registry


def build_base_production_template_registry() -> ProductionTemplateRegistry:
    """Build recipe defaults before persisted per-recipe overrides are applied."""
    registry = build_builtin_production_template_registry()
    _append_custom_templates(registry)
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


def build_builtin_production_template_registry() -> ProductionTemplateRegistry:
    """Build the deterministic code-level template catalog.

    Unlike the default registry, this excludes local custom templates and
    persisted overrides, so it is safe to use for generated repository
    contracts and CI drift checks.
    """
    return ProductionTemplateRegistry(
        [
            ProductionTemplate(
                id="pipeline_topic_to_video_base_v1",
                version="v1",
                display_name="主题起稿口播视频",
                description="输入一个主题，先生成可确认文案，再继续制作图文口播视频。",
                use_case="topic_to_video_base",
                runtime_label="人工确认后继续生产",
                estimated_turnaround="比已有文案稍长",
                failure_guidance="检查写稿模型、Prompt、TTS、画面生成和 FFmpeg 配置后重试。",
                template_tags=["图文口播", "主题起稿", "人工确认", "骨架模板"],
                input_requirements=["topic"],
                quality_tier="daily",
                pipeline_id="topic_to_video",
                required_capabilities=["llm", "tts", "media", "ffmpeg", "persistence"],
                allowed_user_params=[
                    "title",
                    "script_template_name",
                    "script_prompt",
                    "script_provider_id",
                    "script_model",
                    "language_script_models",
                    "split_template_name",
                    "split_prompt",
                    "split_provider_id",
                    "split_model",
                    "frame_template",
                    "template_params",
                    "media_workflow",
                    "image_provider",
                    "image_model",
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
                    **SCRIPT_SETTING_DEFAULTS,
                    **SPLIT_SETTING_DEFAULTS,
                    "frame_template": "1080x1920/image_default.html",
                    "video_fps": 30,
                    "bgm_volume": 0.2,
                    "bgm_mode": "loop",
                    "compose_runtime": "html_ffmpeg",
                    "quality_profile": "basic",
                    "allow_silent": False,
                },
            ),
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
                pipeline_id="script_to_video",
                required_capabilities=["llm", "tts", "media", "ffmpeg", "persistence"],
                allowed_user_params=[
                    "title",
                    "split_template_name",
                    "split_prompt",
                    "split_provider_id",
                    "split_model",
                    "frame_template",
                    "template_params",
                    "media_workflow",
                    "image_provider",
                    "image_model",
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
                    **SPLIT_SETTING_DEFAULTS,
                    "frame_template": "1080x1920/image_default.html",
                    "video_fps": 30,
                    "bgm_volume": 0.2,
                    "bgm_mode": "loop",
                    "compose_runtime": "html_ffmpeg",
                    "quality_profile": "basic",
                    "allow_silent": False,
                },
            ),
            ProductionTemplate(
                id="pipeline_line_script_to_video_base_v1",
                version="v1",
                display_name="逐行分镜口播视频",
                description=(
                    "每个非空行固定作为一个分镜，不再由 AI 重新拆分；"
                    "后续继续生成配图、配音、字幕并合成口播视频。"
                ),
                use_case="line_script_to_video_base",
                runtime_label="逐行直出分镜",
                estimated_turnaround="日常速度",
                failure_guidance="检查逐行分镜文案、TTS、素材生成和 FFmpeg 配置后重试。",
                template_tags=["图文口播", "逐行分镜", "骨架模板"],
                input_requirements=["script"],
                quality_tier="daily",
                pipeline_id="line_script_to_video",
                required_capabilities=["llm", "tts", "media", "ffmpeg", "persistence"],
                allowed_user_params=[
                    "title",
                    "frame_template",
                    "template_params",
                    "media_workflow",
                    "image_provider",
                    "image_model",
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
                    "frame_template": "1080x1920/image_default.html",
                    "video_fps": 30,
                    "bgm_volume": 0.2,
                    "bgm_mode": "loop",
                    "compose_runtime": "html_ffmpeg",
                    "quality_profile": "basic",
                    "allow_silent": False,
                },
            ),
            ProductionTemplate(
                id="codex_image_story_v1",
                version="v1",
                display_name="Agent \u914d\u56fe\u53e3\u64ad\u89c6\u9891",
                description=(
                    "Agent \u6839\u636e\u7528\u6237\u786e\u8ba4\u7684\u5206\u955c\u751f\u6210\u56fe\u7247\uff0cPixelle \u8d1f\u8d23\u914d\u97f3\u3001\u5b57\u5e55\u548c\u89c6\u9891\u5408\u6210\u3002"
                ),
                use_case="codex_image_story",
                runtime_label="Agent \u56fe\u7247\u4ea4\u63a5\u5408\u6210",
                estimated_turnaround="\u53d6\u51b3\u4e8e\u5206\u955c\u6570\u91cf\u548c\u914d\u97f3\u65f6\u957f",
                failure_guidance="\u68c0\u67e5\u5206\u955c\u56fe\u7247\u3001TTS \u548c FFmpeg \u914d\u7f6e\u540e\u91cd\u8bd5\u3002",
                requires_user_assets=True,
                template_tags=["Agent", "\u5206\u955c", "\u914d\u56fe\u53e3\u64ad"],
                input_requirements=["scenes"],
                quality_tier="daily",
                pipeline_id="codex_scene_video",
                access_scope="agent",
                required_capabilities=["tts", "ffmpeg", "persistence"],
                allowed_user_params=[
                    "title",
                    "frame_template",
                    "template_params",
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
                    "frame_template": "1080x1920/image_default.html",
                    "tts_speed": 1.0,
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
                    "上传图片/视频素材，AI 组织成带字幕配音的完整短片。克隆后可调默认合成参数。"
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
                required_capabilities=["ffmpeg", "persistence"],
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
                id="pipeline_topic_to_image_post_base_v1",
                version="v1",
                display_name="主题生成小红书图文",
                description="主题 → 图文文案确认 → 分页确认 → 图集。",
                use_case="topic_to_image_post_base",
                runtime_label="图文写作与图集渲染",
                estimated_turnaround="需两次人工确认",
                failure_guidance="检查写稿模型、分页模型、画面生成和版式配置后重试。",
                template_tags=["主题", "图文帖", "骨架模板"],
                input_requirements=["topic"],
                quality_tier="daily",
                pipeline_id="topic_to_image_post",
                required_capabilities=["llm", "media", "persistence"],
                allowed_user_params=[
                    "title",
                    "script_template_name",
                    "script_prompt",
                    "script_provider_id",
                    "script_model",
                    "language_script_models",
                    "split_template_name",
                    "split_prompt",
                    "split_provider_id",
                    "split_model",
                    "frame_template",
                    "template_params",
                    "media_workflow",
                    "image_provider",
                    "image_model",
                    "media_width",
                    "media_height",
                    "prompt_prefix",
                    "image_prompt_visual_context",
                    "image_prompt_generation_rules",
                    "source",
                ],
                fixed_params={
                    "script_template_name": DEFAULT_SCRIPT_TEMPLATE,
                    "split_template_name": DEFAULT_SPLIT_TEMPLATE,
                    "split_mode": "line",
                    "frame_template": "1080x1440/image_post_default.html",
                    "media_width": 1024,
                    "media_height": 1024,
                    "quality_profile": "basic",
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
                required_capabilities=["llm", "media", "persistence"],
                allowed_user_params=[
                    "title",
                    "split_mode",
                    "frame_template",
                    "template_params",
                    "media_workflow",
                    "image_provider",
                    "image_model",
                    "media_width",
                    "media_height",
                    "prompt_prefix",
                    "image_prompt_visual_context",
                    "image_prompt_generation_rules",
                    "source",
                ],
                fixed_params={
                    "split_mode": "line",
                    "frame_template": "1080x1440/image_post_default.html",
                    "media_width": 1024,
                    "media_height": 1024,
                    "quality_profile": "basic",
                },
            ),
            ProductionTemplate(
                id="pipeline_topic_to_long_form_base_v1",
                version="v1",
                display_name="主题生成长文",
                description="主题或写作方向 → 结构化长文；长文本身就是最终产物，不设中间确认。",
                use_case="topic_to_long_form_base",
                runtime_label="LLM 长文写作",
                estimated_turnaround="最快（纯文字）",
                failure_guidance="检查主题、长文提示词与写作模型配置后重试。",
                template_tags=["主题", "长文", "骨架模板"],
                input_requirements=["topic"],
                quality_tier="daily",
                pipeline_id="topic_to_long_form",
                required_capabilities=["llm", "persistence"],
                allowed_user_params=[
                    "title",
                    "long_form_prompt",
                    "word_count",
                    "llm_provider_id",
                    "llm_model",
                ],
                fixed_params={
                    "word_count": 1800,
                    "long_form_prompt": _LONG_FORM_DEFAULT_PROMPT,
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
                required_capabilities=["llm", "persistence"],
                allowed_user_params=[
                    "title",
                    "long_form_prompt",
                    "word_count",
                    "llm_provider_id",
                    "llm_model",
                ],
                fixed_params={
                    "word_count": 1800,
                    "long_form_prompt": _LONG_FORM_DEFAULT_PROMPT,
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
                enabled=True,
                allowed_user_params=["source", "title", "duration", "workflow_key"],
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
                enabled=True,
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
                enabled=True,
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
                    "tts_speed": 1.2,
                    "quality_profile": "basic",
                    "allow_silent": True,
                },
            ),
        ],
        initial_template_id="pipeline_standard_base_v1",
    )


def code_level_enabled(template_id: str) -> bool | None:
    """内置模板在代码里的 enabled 值；不是内置模板则返回 None（自定义/未知）。

    用于判断某模板是否"代码层退役"，从而禁止用户开关将其复活。
    """
    registry = build_builtin_production_template_registry()
    try:
        return registry.get(template_id).enabled
    except ProductionTemplateError:
        return None


def detect_available_generation_capabilities() -> set[str]:
    capabilities = {"llm", "tts", "media", "persistence"}
    if shutil.which("ffmpeg") and shutil.which("ffprobe"):
        capabilities.add("ffmpeg")
    if shutil.which("npx"):
        capabilities.add("hyperframes")
    return capabilities
