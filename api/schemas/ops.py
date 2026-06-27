"""Schemas for read-only operations API responses."""

from typing import Any

from pydantic import BaseModel, Field


class OpsCurrentResponse(BaseModel):
    project: dict[str, Any] | None = None
    cycle: dict[str, Any] | None = None
    experiment: dict[str, Any] | None = None
    channel_accounts: list[dict[str, Any]] = Field(default_factory=list)
    selected_channel_account: dict[str, Any] | None = None
    social_accounts: list[dict[str, Any]] = Field(default_factory=list)
    selected_social_account: dict[str, Any] | None = None
    context: dict[str, Any] = Field(default_factory=dict)
    content_items: list[dict[str, Any]] = Field(default_factory=list)
    content_item: dict[str, Any] | None = None
    asset_check: dict[str, Any] | None = None
    events: list[dict[str, Any]] = Field(default_factory=list)
    next_action: dict[str, Any]


class OpsExperimentResponse(BaseModel):
    experiment: dict[str, Any]
    content_items: list[dict[str, Any]] = Field(default_factory=list)
    content_item: dict[str, Any] | None = None
    asset_check: dict[str, Any] | None = None
    events: list[dict[str, Any]] = Field(default_factory=list)
    next_action: dict[str, Any]


class OpsProjectsResponse(BaseModel):
    status: str
    projects: list[dict[str, Any]] = Field(default_factory=list)
    next_action: dict[str, Any]


class OpsProjectCyclesResponse(BaseModel):
    status: str
    project: dict[str, Any]
    cycles: list[dict[str, Any]] = Field(default_factory=list)
    next_action: dict[str, Any]


class OpsIntegrationsResponse(BaseModel):
    status: str
    config_source: dict[str, Any]
    integrations: list[dict[str, Any]] = Field(default_factory=list)
    capabilities: dict[str, Any]
    next_action: dict[str, Any]


class OpsCheatWorkspaceBindRequest(BaseModel):
    workspace_path: str


class OpsCheatWorkspaceResponse(BaseModel):
    status: str
    cheat_workspace: dict[str, Any]
    summary: dict[str, Any] | None = None
    next_action: dict[str, Any]


class OpsContextExportResponse(BaseModel):
    status: str
    context_export: dict[str, Any]
    next_action: dict[str, Any] | None = None


class OpsWritebackDraftResponse(BaseModel):
    status: str
    draft: dict[str, Any]
    applied_result: dict[str, Any] | None = None
    next_action: dict[str, Any] | None = None


class OpsWritebackDraftsResponse(BaseModel):
    status: str
    drafts: list[dict[str, Any]] = Field(default_factory=list)
    next_action: dict[str, Any] | None = None


class OpsChannelAccountCreateRequest(BaseModel):
    platform: str
    account_name: str
    account_handle: str | None = None
    external_account_id: str | None = None
    status: str = "configured"
    credential_ref: dict[str, Any] = Field(default_factory=dict)
    buffer_channel_id: str | None = None


class OpsChannelAccountUpdateRequest(OpsChannelAccountCreateRequest):
    pass


class OpsChannelAccountCreateResponse(BaseModel):
    status: str
    channel_account: dict[str, Any]
    next_action: dict[str, Any]


class OpsChannelAccountUpdateResponse(OpsChannelAccountCreateResponse):
    pass
