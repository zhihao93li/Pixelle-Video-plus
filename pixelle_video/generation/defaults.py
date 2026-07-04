from pixelle_video.generation.registry import PipelineRegistry, build_pipeline_registry
from pixelle_video.generation.schemas import (
    InputFieldSpec,
    PipelineEntrySpec,
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


def build_default_pipeline_manifests() -> list[PipelineManifest]:
    return [
        _standard_manifest(),
        _custom_manifest(),
        _asset_based_manifest(),
        _i2v_manifest(),
        _action_transfer_manifest(),
        _digital_human_manifest(),
    ]


def build_default_pipeline_registry() -> PipelineRegistry:
    return build_pipeline_registry(build_default_pipeline_manifests())


def _standard_stages() -> list[PipelineStageSpec]:
    return [
        PipelineStageSpec(id="generate_script", name="Generate Script"),
        PipelineStageSpec(id="split_scenes", name="Split Scenes"),
        PipelineStageSpec(id="generate_image_prompts", name="Generate Image Prompts"),
        PipelineStageSpec(id="generate_tts", name="Generate TTS"),
        PipelineStageSpec(id="generate_media", name="Generate Media"),
        PipelineStageSpec(id="compose_video", name="Compose Video"),
        PipelineStageSpec(id="save_artifacts", name="Save Artifacts"),
    ]


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


def _standard_manifest() -> PipelineManifest:
    return PipelineManifest(
        id="standard",
        name="Standard Video Generation",
        description="General-purpose video pipeline for topic-to-video or script-to-video flows.",
        category="general",
        default_entry="topic",
        required_capabilities=["llm", "tts", "media", "ffmpeg", "persistence"],
        entries=[
            PipelineEntrySpec(
                id="topic",
                name="Topic",
                description="Generate narrations from a topic, then produce the video.",
                required_fields=[_field("topic", description="Topic or idea to turn into video")],
                optional_fields=[
                    _field("n_scenes", "integer", "Target scene count", 5),
                    _field("title", description="Optional user-provided title"),
                    _field("frame_template", description="Frame template path"),
                    _field("tts_voice", description="TTS voice identifier"),
                ],
                start_stage="generate_script",
            ),
            PipelineEntrySpec(
                id="script",
                name="Script",
                description="Use a confirmed script and split it into scenes for video production.",
                required_fields=[_field("script", description="Confirmed narration script")],
                optional_fields=[
                    _field("title", description="Optional user-provided title"),
                    _field("split_mode", description="Script splitting mode", default="paragraph"),
                    _field("frame_template", description="Frame template path"),
                    _field("tts_voice", description="TTS voice identifier"),
                ],
                start_stage="split_scenes",
                skipped_stages=["generate_script"],
            ),
        ],
        stages=_standard_stages(),
        outputs=_standard_outputs(),
    )


def _custom_manifest() -> PipelineManifest:
    return PipelineManifest(
        id="custom",
        name="Custom Template Pipeline",
        description="Template-oriented script pipeline for project-specific video logic.",
        category="custom",
        default_entry="script",
        required_capabilities=["llm", "tts", "media", "ffmpeg", "persistence"],
        entries=[
            PipelineEntrySpec(
                id="script",
                name="Script",
                description="Use a script as the source content for custom video production.",
                required_fields=[_field("script", description="Script text")],
                optional_fields=[
                    _field("custom_param_example", description="Custom pipeline parameter"),
                    _field("frame_template", description="Frame template path"),
                    _field("tts_voice", description="TTS voice identifier"),
                    _field("bgm_path", description="Background music file path"),
                ],
                start_stage="process_content",
                skipped_stages=["generate_script"],
            )
        ],
        stages=[
            PipelineStageSpec(id="process_content", name="Process Content"),
            PipelineStageSpec(id="generate_title", name="Generate Title"),
            PipelineStageSpec(id="generate_image_prompts", name="Generate Image Prompts"),
            PipelineStageSpec(id="generate_tts", name="Generate TTS"),
            PipelineStageSpec(id="generate_media", name="Generate Media"),
            PipelineStageSpec(id="compose_video", name="Compose Video"),
            PipelineStageSpec(id="save_artifacts", name="Save Artifacts"),
        ],
        outputs=_standard_outputs(),
    )


def _asset_based_manifest() -> PipelineManifest:
    return PipelineManifest(
        id="asset_based",
        name="Asset-Based Video Pipeline",
        description="Marketing video pipeline that starts from user-provided image or video assets.",
        category="asset_based",
        default_entry="assets",
        required_capabilities=[
            "llm",
            "tts",
            "image_analysis",
            "video_analysis",
            "ffmpeg",
            "persistence",
        ],
        entries=[
            PipelineEntrySpec(
                id="assets",
                name="Assets",
                description="Use provided images or videos as the source material.",
                required_fields=[_field("assets", "array", "Image or video file paths")],
                optional_fields=[
                    _field("video_title", description="Video title"),
                    _field("intent", description="Marketing or creative intent"),
                    _field("duration", "integer", "Target duration in seconds", 30),
                    _field("source", description="Analysis workflow source", default="runninghub"),
                    _field("bgm_path", description="Background music file path"),
                ],
                start_stage="analyze_assets",
            )
        ],
        stages=[
            PipelineStageSpec(id="analyze_assets", name="Analyze Assets"),
            PipelineStageSpec(id="generate_script", name="Generate Script"),
            PipelineStageSpec(id="match_assets", name="Match Assets"),
            PipelineStageSpec(id="generate_tts", name="Generate TTS"),
            PipelineStageSpec(id="compose_video", name="Compose Video"),
            PipelineStageSpec(id="save_artifacts", name="Save Artifacts"),
        ],
        outputs=_standard_outputs(),
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
        name="Image-to-Video Pipeline",
        description="Workflow-driven video generation from an uploaded image and prompt.",
        category="workflow_video",
        default_entry="assets",
        required_capabilities=["media", "persistence"],
        entries=[
            PipelineEntrySpec(
                id="assets",
                name="Image and Prompt",
                description="Use an uploaded image and prompt to generate a video clip.",
                required_fields=[
                    _field("assets", "array", "Image file paths"),
                    _field("prompt", description="Image-to-video prompt"),
                ],
                optional_fields=[
                    _field("title", description="Optional video title"),
                    _field("workflow_key", description="Fixed workflow key"),
                ],
                start_stage="execute_workflow",
            )
        ],
        stages=[
            PipelineStageSpec(id="execute_workflow", name="Execute Workflow"),
            PipelineStageSpec(id="download_video", name="Save Video"),
            PipelineStageSpec(id="save_artifacts", name="Save Artifacts"),
        ],
        outputs=_workflow_video_outputs(),
    )


def _action_transfer_manifest() -> PipelineManifest:
    return PipelineManifest(
        id="action_transfer",
        name="Action Transfer Pipeline",
        description="Workflow-driven video generation from a reference video, target image, and prompt.",
        category="workflow_video",
        default_entry="video",
        required_capabilities=["media", "persistence"],
        entries=[
            PipelineEntrySpec(
                id="video",
                name="Reference Video and Target Image",
                description="Transfer action from a reference video to a target image.",
                required_fields=[
                    _field("reference_video", description="Reference action video path"),
                    _field("assets", "array", "Target image file paths"),
                    _field("prompt", description="Action transfer prompt"),
                ],
                optional_fields=[
                    _field("duration", "integer", "Target duration in seconds"),
                    _field("workflow_key", description="Fixed workflow key"),
                ],
                start_stage="execute_workflow",
            )
        ],
        stages=[
            PipelineStageSpec(id="execute_workflow", name="Execute Workflow"),
            PipelineStageSpec(id="download_video", name="Save Video"),
            PipelineStageSpec(id="save_artifacts", name="Save Artifacts"),
        ],
        outputs=_workflow_video_outputs(),
    )


def _digital_human_manifest() -> PipelineManifest:
    return PipelineManifest(
        id="digital_human",
        name="Digital Human Pipeline",
        description="Workflow-driven presenter video generation from character imagery and copy.",
        category="workflow_video",
        default_entry="assets",
        required_capabilities=["tts", "media", "persistence"],
        entries=[
            PipelineEntrySpec(
                id="assets",
                name="Character Assets and Script",
                description="Generate a presenter video from character image, product assets, and script.",
                required_fields=[
                    _field("character_assets", "array", "Character image file paths"),
                ],
                optional_fields=[
                    _field("script", description="Presenter script or product copy"),
                    _field("goods_assets", "array", "Product image file paths"),
                    _field("goods_title", description="Product title"),
                    _field("mode", description="digital or customize", default="customize"),
                    _field("workflow_paths", "object", "Fixed workflow paths"),
                    _field("tts_voice", description="TTS voice or Fish reference id"),
                ],
                start_stage="generate_tts",
            )
        ],
        stages=[
            PipelineStageSpec(id="compose_image", name="Compose Presenter Image"),
            PipelineStageSpec(id="generate_tts", name="Generate TTS"),
            PipelineStageSpec(id="execute_workflow", name="Execute Workflow"),
            PipelineStageSpec(id="download_video", name="Save Video"),
            PipelineStageSpec(id="save_artifacts", name="Save Artifacts"),
        ],
        outputs=_workflow_video_outputs(),
    )
