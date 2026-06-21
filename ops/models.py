"""Shared models for the minimal Pixelle operations loop."""

from enum import StrEnum


class ExperimentStage(StrEnum):
    DRAFT = "draft"
    PREDICTION_LOCKED = "prediction_locked"
    GENERATION_REQUESTED = "generation_requested"
    GENERATION_COMPLETED = "generation_completed"
    GENERATION_FAILED = "generation_failed"
    PUBLISHED = "published"
    METRICS_RECORDED = "metrics_recorded"
    RETRO_WRITTEN = "retro_written"
    OBSERVATION_WRITTEN = "observation_written"


class OpsEventType(StrEnum):
    PREDICTION_LOCKED = "prediction_locked"
    GENERATION_DRAFTED = "generation_drafted"
    GENERATION_DRAFT_APPROVED = "generation_draft_approved"
    GENERATION_REQUESTED = "generation_requested"
    GENERATION_COMPLETED = "generation_completed"
    GENERATION_FAILED = "generation_failed"
    ASSET_CHECKED = "asset_checked"
    PUBLISH_RECORDED = "publish_recorded"
    METRICS_RECORDED = "metrics_recorded"
    RETRO_WRITTEN = "retro_written"
    MEMORY_WRITTEN = "memory_written"
    OBSERVATION_WRITTEN = "observation_written"
