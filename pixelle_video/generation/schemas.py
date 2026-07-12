from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

EntryId = Literal["topic", "script", "scenes", "assets", "audio", "video"]
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


class PipelineEntrySpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: EntryId
    name: str
    description: str = ""
    required_fields: list[InputFieldSpec] = Field(default_factory=list)
    optional_fields: list[InputFieldSpec] = Field(default_factory=list)
    start_stage: str
    skipped_stages: list[str] = Field(default_factory=list)


class PipelineStageSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    description: str = ""


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
    entries: list[PipelineEntrySpec]
    stages: list[PipelineStageSpec]
    outputs: list[PipelineOutputSpec]
    required_capabilities: list[str] = Field(default_factory=list)
    default_entry: EntryId | None = None
    access_scope: Literal["public", "codex"] = "public"

    @model_validator(mode="after")
    def validate_entries(self):
        entry_ids = [entry.id for entry in self.entries]
        if len(entry_ids) != len(set(entry_ids)):
            raise ValueError(f"Pipeline manifest {self.id!r} has duplicate entry ids")
        if self.default_entry and self.default_entry not in entry_ids:
            raise ValueError(
                f"Pipeline manifest {self.id!r} default_entry {self.default_entry!r} "
                "is not declared in entries"
            )
        return self

    def entry(self, entry_id: EntryId) -> PipelineEntrySpec:
        for entry in self.entries:
            if entry.id == entry_id:
                return entry
        raise KeyError(f"Pipeline {self.id!r} does not support entry {entry_id!r}")


class GenerationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pipeline_id: str
    entry: EntryId
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
    entry: EntryId
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
    entry: EntryId
    status: GenerationStatus = "pending"
    progress: GenerationProgress
    request: GenerationRequest
    result: GenerationResult | None = None
    error: GenerationError | None = None
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
