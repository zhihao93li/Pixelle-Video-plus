"""Schemas for read-only operations API responses."""

from typing import Any

from pydantic import BaseModel, Field


class OpsCurrentResponse(BaseModel):
    project: dict[str, Any] | None = None
    cycle: dict[str, Any] | None = None
    experiment: dict[str, Any] | None = None
    social_accounts: list[dict[str, Any]] = Field(default_factory=list)
    selected_social_account: dict[str, Any] | None = None
    context: dict[str, Any] = Field(default_factory=dict)
    content_items: list[dict[str, Any]] = Field(default_factory=list)
    events: list[dict[str, Any]] = Field(default_factory=list)
    next_action: dict[str, Any]


class OpsExperimentResponse(BaseModel):
    experiment: dict[str, Any]
    content_items: list[dict[str, Any]] = Field(default_factory=list)
    events: list[dict[str, Any]] = Field(default_factory=list)
    next_action: dict[str, Any]
