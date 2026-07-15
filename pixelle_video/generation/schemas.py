from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

GenerationStatus = Literal[
    "pending",
    "running",
    "completed",
    "failed",
    "cancelled",
    "interrupted",
]
GenerationErrorLayer = Literal[
    "input",
    "config",
    "credentials",
    "network",
    "api_contract",
    "permissions",
    "persistence",
    "runtime",
    "product_assumption",
]


class InputFieldSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    field_type: str = "string"
    description: str = ""
    default: object | None = None


class PipelineInputSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: str = ""
    required_fields: list[InputFieldSpec] = Field(default_factory=list)
    optional_fields: list[InputFieldSpec] = Field(default_factory=list)


class PipelineStageSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    description: str = ""
    setting_keys: list[str] = Field(default_factory=list)
    actor: Literal["system", "user", "agent"] = "system"


class PipelineOutputSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["video", "audio", "image", "storyboard", "subtitle", "metadata"]
    role: str
    description: str = ""
    required: bool = True


class PipelineManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    description: str
    category: str
    input: PipelineInputSpec
    stages: list[PipelineStageSpec]
    quick_setting_keys: list[str] = Field(default_factory=list)
    outputs: list[PipelineOutputSpec]
    required_capabilities: list[str] = Field(default_factory=list)
    access_scope: Literal["public", "agent"] = "public"
    launch_surfaces: list[Literal["react", "agent", "batch"]] = Field(
        default_factory=lambda: ["react"]
    )
    product_family: str = "other"

    @model_validator(mode="after")
    def validate_contract(self):
        field_names = [
            field.name for field in self.input.required_fields + self.input.optional_fields
        ]
        if len(field_names) != len(set(field_names)):
            raise ValueError(f"Pipeline manifest {self.id!r} has duplicate input fields")
        stage_ids = [stage.id for stage in self.stages]
        if not stage_ids:
            raise ValueError(f"Pipeline manifest {self.id!r} must declare at least one stage")
        if len(stage_ids) != len(set(stage_ids)):
            raise ValueError(f"Pipeline manifest {self.id!r} has duplicate stage ids")
        if len(self.quick_setting_keys) != len(set(self.quick_setting_keys)):
            raise ValueError(f"Pipeline manifest {self.id!r} has duplicate quick setting keys")
        stage_setting_keys = {key for stage in self.stages for key in stage.setting_keys}
        unknown_quick_keys = [
            key for key in self.quick_setting_keys if key not in stage_setting_keys
        ]
        if unknown_quick_keys:
            raise ValueError(
                f"Pipeline manifest {self.id!r} declares quick settings outside its "
                f"stage contract: {', '.join(unknown_quick_keys)}"
            )
        if self.access_scope == "agent" and "react" in self.launch_surfaces:
            raise ValueError(f"Agent-only pipeline {self.id!r} cannot be launched from React")
        return self


class GenerationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pipeline_id: str
    input: dict[str, Any]
    params: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str | None = None


class GenerationProgress(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stage: str
    percentage: float = 0.0
    message: str = ""
    current: int | None = None
    total: int | None = None
    detail: dict[str, Any] = Field(default_factory=dict)


class GenerationArtifact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["video", "audio", "image", "storyboard", "subtitle", "metadata"]
    path: str
    url: str | None = None
    media_type: str | None = None
    role: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class GenerationResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: str
    pipeline_id: str
    status: Literal["completed"] = "completed"
    # 产物形态：video（默认，向后兼容——旧数据无此字段即按 video 处理）/ image_set（图文帖图集）/ text（长文）
    artifact_type: Literal["video", "image_set", "text"] = "video"
    artifacts: list[GenerationArtifact]
    # 图集产物没有主视频；读 primary_video 的地方必须按 artifact_type 分支，勿假设非空
    primary_video: GenerationArtifact | None = None
    duration: float | None = None
    file_size: int | None = None
    storyboard_path: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class GenerationError(BaseModel):
    model_config = ConfigDict(extra="forbid")

    layer: GenerationErrorLayer
    message: str
    exception_type: str | None = None
    detail: dict[str, Any] = Field(default_factory=dict)


class GenerationTask(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: str
    pipeline_id: str
    status: GenerationStatus = "pending"
    progress: GenerationProgress
    request: GenerationRequest
    result: GenerationResult | None = None
    error: GenerationError | None = None
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
