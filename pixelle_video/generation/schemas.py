from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

EntryId = Literal["topic", "script", "scenes", "assets", "audio", "video"]


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
