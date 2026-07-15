from pixelle_video.generation.registry import PipelineRegistry, build_pipeline_registry
from pixelle_video.generation.schemas import (
    InputFieldSpec,
    PipelineInputSpec,
    PipelineManifest,
    PipelineOutputSpec,
    PipelineStageSpec,
)


def _field(
    name: str,
    field_type: str = "string",
    description: str = "",
    default: object | None = None,
) -> InputFieldSpec:
    return InputFieldSpec(
        name=name,
        field_type=field_type,
        description=description,
        default=default,
    )


def _input(
    *,
    description: str,
    required: list[InputFieldSpec],
    optional: list[InputFieldSpec] | None = None,
) -> PipelineInputSpec:
    return PipelineInputSpec(
        description=description,
        required_fields=required,
        optional_fields=optional or [],
    )


def _stage(
    stage_id: str,
    name: str,
    setting_keys: list[str] | None = None,
    *,
    actor: str = "system",
) -> PipelineStageSpec:
    return PipelineStageSpec(
        id=stage_id,
        name=name,
        setting_keys=setting_keys or [],
        actor=actor,
    )


def build_default_pipeline_manifests() -> list[PipelineManifest]:
    return [
        _topic_to_video_manifest(),
        _script_to_video_manifest(),
        _codex_scene_video_manifest(),
        _asset_based_manifest(),
        _topic_to_image_post_manifest(),
        _image_post_manifest(),
        _topic_to_long_form_manifest(),
        _long_form_manifest(),
        _i2v_manifest(),
        _action_transfer_manifest(),
        _digital_human_manifest(),
    ]


def build_default_pipeline_registry() -> PipelineRegistry:
    return build_pipeline_registry(build_default_pipeline_manifests())


def _standard_outputs() -> list[PipelineOutputSpec]:
    return [
        PipelineOutputSpec(kind="video", role="primary_video", description="Final video"),
        PipelineOutputSpec(
            kind="storyboard",
            role="storyboard",
            description="Storyboard and scene metadata",
            required=False,
        ),
    ]


def _video_production_stages() -> list[PipelineStageSpec]:
    return [
        _stage(
            "split_scenes",
            "分镜",
            ["split_template_name", "split_prompt", "split_provider_id", "split_model"],
        ),
        _stage(
            "generate_image_prompts",
            "视觉提示",
            [
                "prompt_prefix",
                "image_prompt_visual_context",
                "image_prompt_generation_rules",
            ],
        ),
        _stage(
            "generate_tts",
            "配音",
            [
                "tts_inference_mode",
                "tts_workflow",
                "tts_voice",
                "tts_speed",
                "ref_audio",
            ],
        ),
        _stage(
            "generate_media",
            "画面",
            [
                "image_provider",
                "image_model",
                "media_workflow",
                "frame_template",
                "template_params",
                "media_width",
                "media_height",
            ],
        ),
        _stage(
            "compose_video",
            "合成",
            ["compose_runtime", "bgm_path", "bgm_volume", "bgm_mode"],
        ),
        _stage("save_artifacts", "保存产物"),
    ]


def _topic_to_video_manifest() -> PipelineManifest:
    return PipelineManifest(
        id="topic_to_video",
        name="主题生成视频",
        description="从主题起草文案，经人工确认后继续生成完整视频。",
        category="general",
        product_family="口播视频",
        input=_input(
            description="提供一个主题，由 Pixelle 起草并等待人工确认。",
            required=[_field("topic", description="Topic or idea to turn into video")],
            optional=[_field("title", description="Optional user-provided title")],
        ),
        stages=[
            _stage(
                "generate_script",
                "写稿",
                [
                    "script_template_name",
                    "script_prompt",
                    "script_provider_id",
                    "script_model",
                    "language_script_models",
                ],
            ),
            _stage("review_script", "确认文案", actor="user"),
            *_video_production_stages(),
        ],
        quick_setting_keys=[
            "frame_template",
            "tts_voice",
            "tts_speed",
            "bgm_path",
        ],
        outputs=_standard_outputs(),
        required_capabilities=["llm", "tts", "media", "ffmpeg", "persistence"],
        launch_surfaces=["react", "agent", "batch"],
    )


def _script_to_video_manifest() -> PipelineManifest:
    return PipelineManifest(
        id="script_to_video",
        name="文案生成视频",
        description="从已经准备好的完整文案生成视频，不再经过写稿。",
        category="general",
        product_family="口播视频",
        input=_input(
            description="提供可直接用于生产的完整文案。",
            required=[_field("script", description="Confirmed narration script")],
            optional=[_field("title", description="Optional user-provided title")],
        ),
        stages=_video_production_stages(),
        quick_setting_keys=[
            "frame_template",
            "tts_voice",
            "tts_speed",
            "bgm_path",
        ],
        outputs=_standard_outputs(),
        required_capabilities=["llm", "tts", "media", "ffmpeg", "persistence"],
        launch_surfaces=["react", "agent", "batch"],
    )


def _codex_scene_video_manifest() -> PipelineManifest:
    return PipelineManifest(
        id="codex_scene_video",
        name="Agent 配图视频",
        description="将用户确认的分镜和 Agent 生成图片合成为视频。",
        category="agent",
        product_family="Agent 创作",
        access_scope="agent",
        launch_surfaces=["agent"],
        input=_input(
            description="一到二十个已确认、图片齐全的分镜。",
            required=[
                _field(
                    "scenes",
                    "array",
                    "Confirmed scenes containing scene_id, narration, image_prompt, image_path, and optional duration",
                )
            ],
            optional=[_field("title", description="Optional video title")],
        ),
        stages=[
            _stage("plan_scenes", "Agent 规划分镜", actor="agent"),
            _stage("review_scenes", "确认分镜", actor="user"),
            _stage(
                "generate_agent_images",
                "Agent 生成图片",
                [
                    "prompt_prefix",
                    "image_prompt_visual_context",
                    "image_prompt_generation_rules",
                ],
                actor="agent",
            ),
            _stage("validate_scenes", "校验已确认分镜"),
            _stage(
                "generate_tts",
                "配音",
                ["tts_inference_mode", "tts_workflow", "tts_voice", "tts_speed", "ref_audio"],
            ),
            _stage(
                "compose_video",
                "合成",
                [
                    "frame_template",
                    "template_params",
                    "compose_runtime",
                    "bgm_path",
                    "bgm_volume",
                    "bgm_mode",
                ],
            ),
            _stage("save_artifacts", "保存产物"),
        ],
        quick_setting_keys=[
            "frame_template",
            "tts_voice",
            "tts_speed",
            "bgm_path",
        ],
        outputs=_standard_outputs(),
        required_capabilities=["tts", "ffmpeg", "persistence"],
    )


def _asset_based_manifest() -> PipelineManifest:
    return PipelineManifest(
        id="asset_based",
        name="素材生成视频",
        description="分析用户上传的图片或视频素材并生成营销视频。",
        category="asset_based",
        product_family="素材创作",
        input=_input(
            description="提供图片或视频素材。",
            required=[_field("assets", "array", "Image or video file paths")],
            optional=[
                _field("video_title", description="Video title"),
                _field("intent", description="Marketing or creative intent"),
                _field("duration", "integer", "Target duration in seconds", 30),
                _field("source", description="Analysis workflow source", default="runninghub"),
            ],
        ),
        stages=[
            _stage("analyze_assets", "分析素材", ["source"]),
            _stage("generate_script", "生成文案"),
            _stage("match_assets", "匹配素材"),
            _stage("generate_tts", "配音", ["voice_id", "tts_speed"]),
            _stage(
                "compose_video",
                "合成",
                ["compose_runtime", "bgm_path", "bgm_volume", "bgm_mode"],
            ),
            _stage("save_artifacts", "保存产物"),
        ],
        quick_setting_keys=["voice_id", "tts_speed", "bgm_path"],
        outputs=_standard_outputs(),
        required_capabilities=[
            "llm",
            "tts",
            "image_analysis",
            "video_analysis",
            "ffmpeg",
            "persistence",
        ],
        launch_surfaces=["react", "batch"],
    )


def _image_post_manifest() -> PipelineManifest:
    return PipelineManifest(
        id="image_post",
        name="图文图集",
        description="把确认稿排成封面和逐页图片。",
        category="image_post",
        product_family="图文内容",
        input=_input(
            description="提供按页拆分的完整文案。",
            required=[_field("script", description="Confirmed script (one line per page)")],
            optional=[
                _field("title", description="Optional cover title"),
                _field("split_mode", description="Pagination mode", default="line"),
            ],
        ),
        stages=[
            _stage("paginate", "分页", ["split_mode"]),
            _stage(
                "generate_image_prompts",
                "视觉提示",
                [
                    "prompt_prefix",
                    "image_prompt_visual_context",
                    "image_prompt_generation_rules",
                ],
            ),
            _stage(
                "generate_media",
                "每页配图",
                ["image_provider", "image_model", "media_workflow", "source"],
            ),
            _stage(
                "compose_pages",
                "版式成图",
                ["frame_template", "template_params", "media_width", "media_height"],
            ),
            _stage("save_artifacts", "保存产物"),
        ],
        quick_setting_keys=["frame_template", "image_provider", "image_model"],
        outputs=[
            PipelineOutputSpec(kind="image", role="cover", description="Cover image"),
            PipelineOutputSpec(kind="image", role="page", description="Per-scene page image"),
            PipelineOutputSpec(
                kind="metadata",
                role="caption",
                description="Publish caption text",
                required=False,
            ),
        ],
        required_capabilities=["llm", "media", "persistence"],
        launch_surfaces=["react", "agent", "batch"],
    )


def _topic_to_image_post_manifest() -> PipelineManifest:
    return PipelineManifest(
        id="topic_to_image_post",
        name="主题生成图文",
        description="从主题生成图文文案，确认后分页，再确认分页并生成图集。",
        category="image_post",
        product_family="图文内容",
        input=_input(
            description="提供一个图文主题或创作方向。",
            required=[_field("topic", description="Topic or idea for the image post")],
            optional=[_field("title", description="Optional cover title")],
        ),
        stages=[
            _stage(
                "generate_script",
                "写图文文案",
                [
                    "script_template_name",
                    "script_prompt",
                    "script_provider_id",
                    "script_model",
                    "language_script_models",
                ],
            ),
            _stage("review_script", "确认图文文案", actor="user"),
            _stage(
                "paginate",
                "分页",
                ["split_template_name", "split_prompt", "split_provider_id", "split_model"],
            ),
            _stage("review_pages", "确认分页", actor="user"),
            _stage(
                "generate_image_prompts",
                "视觉提示",
                [
                    "prompt_prefix",
                    "image_prompt_visual_context",
                    "image_prompt_generation_rules",
                ],
            ),
            _stage(
                "generate_media",
                "每页配图",
                ["image_provider", "image_model", "media_workflow", "source"],
            ),
            _stage(
                "compose_pages",
                "版式成图",
                ["frame_template", "template_params", "media_width", "media_height"],
            ),
            _stage("save_artifacts", "保存产物"),
        ],
        quick_setting_keys=["frame_template", "image_provider", "image_model"],
        outputs=[
            PipelineOutputSpec(kind="image", role="cover", description="Cover image"),
            PipelineOutputSpec(kind="image", role="page", description="Per-scene page image"),
            PipelineOutputSpec(
                kind="metadata",
                role="caption",
                description="Publish caption text",
                required=False,
            ),
        ],
        required_capabilities=["llm", "media", "persistence"],
        launch_surfaces=["react", "agent", "batch"],
    )


def _long_form_manifest() -> PipelineManifest:
    return PipelineManifest(
        id="long_form",
        name="长文",
        description="把确认稿扩写成结构化长文。",
        category="long_form",
        product_family="图文内容",
        input=_input(
            description="提供用于扩写的完整文案。",
            required=[_field("script", description="Confirmed script to expand")],
            optional=[
                _field("title", description="Optional article title"),
                _field("language", description="Target language"),
            ],
        ),
        stages=[
            _stage(
                "write_article",
                "长文改写",
                ["long_form_prompt", "word_count", "llm_provider_id", "llm_model"],
            ),
            _stage("save_artifacts", "保存产物"),
        ],
        quick_setting_keys=["word_count", "llm_model"],
        outputs=[
            PipelineOutputSpec(
                kind="metadata",
                role="article",
                description="Long-form markdown article",
            )
        ],
        required_capabilities=["llm", "persistence"],
        launch_surfaces=["react", "agent", "batch"],
    )


def _topic_to_long_form_manifest() -> PipelineManifest:
    return PipelineManifest(
        id="topic_to_long_form",
        name="主题生成长文",
        description="从主题直接生成结构化长文，产出后由用户检查。",
        category="long_form",
        product_family="图文内容",
        input=_input(
            description="提供一个长文主题或写作方向。",
            required=[_field("topic", description="Topic or writing direction")],
            optional=[
                _field("title", description="Optional article title"),
                _field("language", description="Target language"),
            ],
        ),
        stages=[
            _stage(
                "write_article",
                "生成长文",
                ["long_form_prompt", "word_count", "llm_provider_id", "llm_model"],
            ),
            _stage("save_artifacts", "保存产物"),
        ],
        quick_setting_keys=["word_count", "llm_model"],
        outputs=[
            PipelineOutputSpec(
                kind="metadata",
                role="article",
                description="Long-form markdown article",
            )
        ],
        required_capabilities=["llm", "persistence"],
        launch_surfaces=["react", "agent", "batch"],
    )


def _workflow_video_outputs() -> list[PipelineOutputSpec]:
    return [
        PipelineOutputSpec(kind="video", role="primary_video", description="Final workflow video"),
        PipelineOutputSpec(
            kind="metadata",
            role="workflow_metadata",
            description="Workflow execution metadata",
            required=False,
        ),
    ]


def _i2v_manifest() -> PipelineManifest:
    return PipelineManifest(
        id="i2v",
        name="图片生成视频",
        description="从一张图片和运动提示词生成视频片段。",
        category="workflow_video",
        product_family="素材创作",
        input=_input(
            description="提供图片和运动提示词。",
            required=[
                _field("assets", "array", "Image file paths"),
                _field("prompt", description="Image-to-video prompt"),
            ],
            optional=[_field("title", description="Optional video title")],
        ),
        stages=[
            _stage("execute_workflow", "生成视频", ["workflow_key", "source"]),
            _stage("download_video", "保存视频"),
            _stage("save_artifacts", "保存产物"),
        ],
        outputs=_workflow_video_outputs(),
        required_capabilities=["media", "persistence"],
        launch_surfaces=["react"],
    )


def _action_transfer_manifest() -> PipelineManifest:
    return PipelineManifest(
        id="action_transfer",
        name="动作迁移",
        description="把参考视频中的动作迁移到目标人物图。",
        category="workflow_video",
        product_family="素材创作",
        input=_input(
            description="提供参考视频、目标人物图和提示词。",
            required=[
                _field("reference_video", description="Reference action video path"),
                _field("assets", "array", "Target image file paths"),
                _field("prompt", description="Action transfer prompt"),
            ],
            optional=[_field("duration", "integer", "Target duration in seconds")],
        ),
        stages=[
            _stage("execute_workflow", "迁移动作", ["workflow_key", "source"]),
            _stage("download_video", "保存视频"),
            _stage("save_artifacts", "保存产物"),
        ],
        outputs=_workflow_video_outputs(),
        required_capabilities=["media", "persistence"],
        launch_surfaces=["react"],
    )


def _digital_human_manifest() -> PipelineManifest:
    return PipelineManifest(
        id="digital_human",
        name="数字人口播",
        description="从人物形象和口播文案生成数字人视频。",
        category="workflow_video",
        product_family="素材创作",
        input=_input(
            description="提供人物形象和口播内容。",
            required=[_field("character_assets", "array", "Character image file paths")],
            optional=[
                _field("script", description="Presenter script or product copy"),
                _field("goods_assets", "array", "Product image file paths"),
                _field("goods_title", description="Product title"),
                _field("mode", description="digital or customize", default="customize"),
            ],
        ),
        stages=[
            _stage("compose_image", "合成人物画面"),
            _stage(
                "generate_tts",
                "配音",
                ["tts_inference_mode", "tts_workflow", "tts_voice", "tts_speed"],
            ),
            _stage("execute_workflow", "生成数字人", ["workflow_key"]),
            _stage("download_video", "保存视频"),
            _stage("save_artifacts", "保存产物"),
        ],
        quick_setting_keys=["tts_voice", "tts_speed"],
        outputs=_workflow_video_outputs(),
        required_capabilities=["tts", "media", "persistence"],
        launch_surfaces=["react"],
    )
