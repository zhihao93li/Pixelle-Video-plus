"""Business rules for the minimal Pixelle operations loop."""

from __future__ import annotations

import hashlib
import inspect
import json
from collections.abc import Iterable
from pathlib import Path
from typing import Any, Callable

from ops.cheat_workspace import (
    cheat_workspace_status,
    is_remote_workspace_path,
    summarize_cheat_workspace,
)
from ops.models import ExperimentStage, OpsEventType
from ops.store import OpsStore


class OpsError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(f"{code}: {message}")


GenerationRunner = Callable[..., Any]

BLOCKED_GENERATION_DRAFT_MARKERS = (
    "【视频目标】",
    "【内容形式】",
    "【屏幕字幕版】",
    "【发布标题】",
    "【发布正文】",
    "【标签】",
    "【时长】",
    "【安全边界】",
    "【成片结构】",
    "【字幕文案】",
)

PIPELINE_DESCRIPTIONS = {
    "standard": "Default Pixelle generation pipeline.",
    "custom": "Custom generation pipeline for explicit generation parameters.",
    "asset_based": "Generation pipeline that starts from existing source assets.",
}

WRITEBACK_OPERATIONS = {
    "create_content_experiment",
    "lock_content_prediction",
    "submit_generation_draft",
    "record_publish_evidence",
    "record_metrics_snapshot",
    "record_retro_observation",
    "write_project_memory_event",
}


class OpsService:
    def __init__(
        self,
        store: OpsStore | None = None,
        generation_runner: GenerationRunner | None = None,
        available_pipelines: Iterable[str] | None = None,
    ):
        self.store = store or OpsStore()
        self.store.init_db()
        self.generation_runner = generation_runner
        self.available_pipelines = tuple(dict.fromkeys(available_pipelines)) if available_pipelines is not None else None

    def create_project(
        self,
        *,
        name: str,
        product: str,
        channel: str,
        source: dict[str, Any],
        description: str | None = None,
    ) -> dict[str, Any]:
        _require_confirmed_source(source)
        return self.store.create_project(
            name=name,
            product=product,
            channel=channel,
            description=description,
            source=source,
        )

    def list_projects(self) -> dict[str, Any]:
        projects = []
        for project in self.store.list_projects():
            projects.append(
                {
                    **project,
                    "channel_accounts": self.store.list_channel_accounts(project_id=project["id"]),
                    "social_accounts": self.store.list_channel_accounts(project_id=project["id"]),
                }
            )
        return {
            "status": "ok",
            "projects": projects,
            "next_action": {
                "kind": "select_project" if projects else "create_project",
                "blocked": False,
            },
        }

    def list_project_cycles(self, project_id: str) -> dict[str, Any]:
        project = self.store.get_project(project_id)
        if not project:
            raise OpsError("project_not_found", "Project cycles require an existing project.")

        cycles = []
        for cycle in self.store.list_cycles_for_project(project_id):
            experiment_views = []
            for experiment in self.store.list_experiments_for_cycle(cycle["id"]):
                events = self.store.list_events_for_experiment(experiment["id"])
                experiment_views.append(
                    _with_current_content_item({
                        "experiment": experiment,
                        "content_items": self.store.list_content_items_for_experiment(experiment["id"]),
                        "events": events,
                        "next_action": _next_action_for_events(events),
                    })
                )
            cycles.append(
                {
                    "cycle": cycle,
                    "experiments": experiment_views,
                    "next_action": experiment_views[0]["next_action"]
                    if experiment_views
                    else {"kind": "create_experiment", "blocked": False},
                }
            )

        return {
            "status": "ok",
            "project": project,
            "cycles": cycles,
            "next_action": cycles[0]["next_action"] if cycles else {"kind": "create_cycle", "blocked": False},
        }

    def create_channel_account(
        self,
        *,
        project_id: str,
        platform: str,
        account_name: str,
        source: dict[str, Any],
        account_handle: str | None = None,
        external_account_id: str | None = None,
        status: str = "configured",
        credential_ref: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        _require_confirmed_source(source)
        if not self.store.get_project(project_id):
            raise OpsError("project_not_found", "Channel account requires an existing project.")
        _reject_plaintext_credential_ref(credential_ref or {})
        return self.store.create_channel_account(
            project_id=project_id,
            platform=platform,
            account_name=account_name,
            account_handle=account_handle,
            external_account_id=external_account_id,
            status=status,
            credential_ref=credential_ref,
            source=source,
        )

    def create_social_account(self, **kwargs: Any) -> dict[str, Any]:
        return self.create_channel_account(**kwargs)

    def update_channel_account(
        self,
        *,
        channel_account_id: str,
        platform: str,
        account_name: str,
        source: dict[str, Any],
        account_handle: str | None = None,
        external_account_id: str | None = None,
        status: str = "configured",
        credential_ref: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        _require_confirmed_source(source)
        account = self.store.get_channel_account(channel_account_id)
        if not account:
            raise OpsError("channel_account_not_found", "Channel account update requires an existing account.")
        _reject_plaintext_credential_ref(credential_ref or {})
        updated = self.store.update_channel_account(
            channel_account_id=channel_account_id,
            platform=platform,
            account_name=account_name,
            account_handle=account_handle,
            external_account_id=external_account_id,
            status=status,
            credential_ref=credential_ref,
            source=source,
        )
        if updated is None:
            raise OpsError("channel_account_not_found", "Channel account update requires an existing account.")
        return updated

    def set_project_cheat_workspace(
        self,
        *,
        project_id: str,
        workspace_path: str,
        source: dict[str, Any],
    ) -> dict[str, Any]:
        _require_confirmed_source(source)
        if not self.store.get_project(project_id):
            raise OpsError("project_not_found", "Cheat workspace binding requires an existing project.")
        if is_remote_workspace_path(workspace_path):
            raise OpsError(
                "cheat_workspace_path_must_be_local",
                "Cheat workspace path must be a local filesystem path, not a URL.",
            )
        summary = summarize_cheat_workspace(workspace_path)
        binding = self.store.upsert_project_cheat_workspace(
            project_id=project_id,
            workspace_path=summary["workspace_path"],
            status=cheat_workspace_status(summary),
            state_schema_version=summary.get("state_schema_version"),
            health_issues=summary.get("health_issues", []),
            source=source,
        )
        return {
            "status": "ok",
            "cheat_workspace": binding,
            "summary": summary,
            "next_action": {"kind": "view_cheat_workspace_summary", "blocked": False},
        }

    def get_project_cheat_workspace(self, project_id: str) -> dict[str, Any]:
        if not self.store.get_project(project_id):
            raise OpsError("project_not_found", "Cheat workspace binding requires an existing project.")
        binding = self.store.get_project_cheat_workspace(project_id)
        if binding is None:
            return {
                "status": "ok",
                "cheat_workspace": {
                    "project_id": project_id,
                    "workspace_path": None,
                    "status": "not_configured",
                    "state_schema_version": None,
                    "health_issues": [],
                },
                "next_action": {"kind": "bind_cheat_workspace", "blocked": False},
            }
        return {
            "status": "ok",
            "cheat_workspace": binding,
            "next_action": {"kind": "view_cheat_workspace_summary", "blocked": False},
        }

    def get_cheat_workspace_summary(self, project_id: str) -> dict[str, Any]:
        binding_view = self.get_project_cheat_workspace(project_id)
        binding = binding_view["cheat_workspace"]
        if binding["status"] == "not_configured":
            return {
                "status": "ok",
                "cheat_workspace": binding,
                "summary": None,
                "next_action": {"kind": "bind_cheat_workspace", "blocked": False},
            }
        summary = summarize_cheat_workspace(binding["workspace_path"])
        status = cheat_workspace_status(summary)
        binding = {
            **binding,
            "status": status,
            "state_schema_version": summary.get("state_schema_version"),
            "health_issues": summary.get("health_issues", []),
        }
        return {
            "status": "ok",
            "cheat_workspace": binding,
            "summary": summary,
            "next_action": {"kind": "use_codex_with_cheat_context", "blocked": False},
        }

    def create_cycle(
        self,
        *,
        project_id: str,
        name: str,
        goal: str,
        source: dict[str, Any],
        starts_on: str | None = None,
        ends_on: str | None = None,
    ) -> dict[str, Any]:
        _require_confirmed_source(source)
        if not self.store.get_project(project_id):
            raise OpsError("project_not_found", "Operation cycle requires an existing project.")
        return self.store.create_cycle(
            project_id=project_id,
            name=name,
            goal=goal,
            starts_on=starts_on,
            ends_on=ends_on,
            source=source,
        )

    def create_experiment(
        self,
        *,
        project_id: str,
        cycle_id: str,
        title: str,
        hypothesis: str,
        source: dict[str, Any],
    ) -> dict[str, Any]:
        _require_confirmed_source(source)
        project = self.store.get_project(project_id)
        if not project:
            raise OpsError("project_not_found", "Content experiment requires an existing project.")
        cycle = self.store.get_cycle(cycle_id)
        if not cycle:
            raise OpsError("cycle_not_found", "Content experiment requires an existing cycle.")
        if cycle["project_id"] != project_id:
            raise OpsError("cycle_project_mismatch", "Operation cycle must belong to the project.")
        return self.store.create_experiment(
            project_id=project_id,
            cycle_id=cycle_id,
            title=title,
            hypothesis=hypothesis,
            source=source,
        )

    def lock_prediction(
        self,
        *,
        experiment_id: str,
        prediction: dict[str, Any],
        source: dict[str, Any],
    ) -> dict[str, Any]:
        _require_confirmed_source(source)
        experiment = self._get_experiment_or_raise(experiment_id)
        events = self.store.list_events_for_experiment(experiment_id)
        if _has_event(events, OpsEventType.PUBLISH_RECORDED, OpsEventType.METRICS_RECORDED):
            raise OpsError("prediction_window_closed", "Cannot lock prediction after publish or metrics evidence.")
        event = self.store.append_event(
            project_id=experiment["project_id"],
            cycle_id=experiment["cycle_id"],
            experiment_id=experiment_id,
            event_type=OpsEventType.PREDICTION_LOCKED.value,
            payload={"prediction": prediction},
            source=source,
        )
        self.store.update_experiment_stage(experiment_id, ExperimentStage.PREDICTION_LOCKED.value)
        return _transition("prediction_locked", event, "submit_generation_draft")

    def submit_generation_draft(
        self,
        *,
        experiment_id: str,
        text: str,
        source: dict[str, Any],
        pipeline: str = "standard",
        title: str | None = None,
        generation_params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        _require_confirmed_source(source)
        experiment = self._get_experiment_or_raise(experiment_id)
        events = self.store.list_events_for_experiment(experiment_id)
        if not _has_event(events, OpsEventType.PREDICTION_LOCKED):
            raise OpsError("prediction_required", "Generation draft requires a locked prediction.")
        _require_clean_generation_draft_text(text)
        event = self.store.append_event(
            project_id=experiment["project_id"],
            cycle_id=experiment["cycle_id"],
            experiment_id=experiment_id,
            event_type=OpsEventType.GENERATION_DRAFTED.value,
            payload={
                "text": text,
                "pipeline": pipeline,
                "title": title,
                "generation_params": generation_params or {},
            },
            source=source,
        )
        return _transition("generation_drafted", event, "approve_generation_draft")

    def approve_generation_draft(
        self,
        *,
        experiment_id: str,
        draft_id: str,
        source: dict[str, Any],
    ) -> dict[str, Any]:
        _require_confirmed_source(source)
        experiment = self._get_experiment_or_raise(experiment_id)
        events = self.store.list_events_for_experiment(experiment_id)
        draft = _find_event(events, draft_id, OpsEventType.GENERATION_DRAFTED)
        if draft is None:
            raise OpsError("generation_draft_not_found", "Approved generation draft must reference an existing draft.")
        event = self.store.append_event(
            project_id=experiment["project_id"],
            cycle_id=experiment["cycle_id"],
            experiment_id=experiment_id,
            event_type=OpsEventType.GENERATION_DRAFT_APPROVED.value,
            payload={"draft_id": draft_id},
            source=source,
        )
        return _transition("generation_draft_approved", event, "request_generation")

    async def request_generation(
        self,
        *,
        experiment_id: str,
        source: dict[str, Any],
        approved_draft_id: str | None = None,
        kind: str = "video",
        wait_for_completion: bool = True,
    ) -> dict[str, Any]:
        _require_confirmed_source(source)
        experiment = self._get_experiment_or_raise(experiment_id)
        events = self.store.list_events_for_experiment(experiment_id)
        if not _has_event(events, OpsEventType.PREDICTION_LOCKED):
            raise OpsError("prediction_required", "Content generation requires a locked prediction.")
        _require_generation_request_window(events)
        draft = _approved_draft_for_generation(events, approved_draft_id)
        if draft is None:
            raise OpsError("approved_draft_required", "Content generation requires an approved generation draft.")
        text = draft["payload"]["text"]
        pipeline = draft["payload"].get("pipeline") or "standard"
        title = draft["payload"].get("title")
        generation_params = _generation_params_for_approved_draft(
            pipeline=pipeline,
            title=title,
            generation_params=draft["payload"].get("generation_params") or {},
        )
        await self._require_known_pipeline(pipeline)

        operation_context = {
            "project_id": experiment["project_id"],
            "cycle_id": experiment["cycle_id"],
            "experiment_id": experiment_id,
        }
        event = self.store.append_event(
            project_id=experiment["project_id"],
            cycle_id=experiment["cycle_id"],
            experiment_id=experiment_id,
            event_type=OpsEventType.GENERATION_REQUESTED.value,
            payload={
                "text": text,
                "pipeline": pipeline,
                "approved_draft_id": approved_draft_id,
                "draft_id": draft["id"],
                "title": title,
                "operation_context": operation_context,
                "generation_params": generation_params,
            },
            source=source,
        )
        self.store.update_experiment_stage(experiment_id, ExperimentStage.GENERATION_REQUESTED.value)

        if not wait_for_completion:
            return {
                **_transition("generation_requested", event, "check_generation_status"),
                "generation": {
                    "status": "running",
                    "event_id": event["id"],
                    "experiment_id": experiment_id,
                },
            }

        return await self.complete_generation_request(
            experiment_id=experiment_id,
            generation_event_id=event["id"],
            source=source,
            kind=kind,
        )

    async def complete_generation_request(
        self,
        *,
        experiment_id: str,
        generation_event_id: str,
        source: dict[str, Any],
        kind: str = "video",
    ) -> dict[str, Any]:
        _require_confirmed_source(source)
        experiment = self._get_experiment_or_raise(experiment_id)
        events = self.store.list_events_for_experiment(experiment_id)
        generation_event = _find_event(events, generation_event_id, OpsEventType.GENERATION_REQUESTED)
        if generation_event is None:
            raise OpsError("generation_request_not_found", "Generation completion requires an existing generation request.")
        if _generation_request_already_completed(events, generation_event_id):
            raise OpsError("generation_already_completed", "Generation is already completed for this experiment.")

        payload = generation_event["payload"]
        text = payload["text"]
        pipeline = payload.get("pipeline") or "standard"
        generation_params = _generation_params_for_approved_draft(
            pipeline=pipeline,
            title=payload.get("title"),
            generation_params=payload.get("generation_params") or {},
        )
        operation_context = payload.get("operation_context") or {
            "project_id": experiment["project_id"],
            "cycle_id": experiment["cycle_id"],
            "experiment_id": experiment_id,
        }

        try:
            asset_ref = await self._run_generation(
                text=text,
                pipeline=pipeline,
                operation_context=operation_context,
                **generation_params,
            )
        except Exception as exc:
            self.store.append_event(
                project_id=experiment["project_id"],
                cycle_id=experiment["cycle_id"],
                experiment_id=experiment_id,
                event_type=OpsEventType.GENERATION_FAILED.value,
                payload={
                    "error_type": type(exc).__name__,
                    "error_message": str(exc),
                    "operation_context": operation_context,
                },
                source=source,
            )
            self.store.update_experiment_stage(experiment_id, ExperimentStage.GENERATION_FAILED.value)
            raise OpsError("generation_failed", str(exc)) from exc

        content_item = self.store.create_content_item(
            project_id=experiment["project_id"],
            cycle_id=experiment["cycle_id"],
            experiment_id=experiment_id,
            kind=kind,
            title=payload.get("title") or experiment["title"],
            status="generated",
            asset_ref=asset_ref,
        )
        event = self.store.append_event(
            project_id=experiment["project_id"],
            cycle_id=experiment["cycle_id"],
            experiment_id=experiment_id,
            content_item_id=content_item["id"],
            event_type=OpsEventType.GENERATION_COMPLETED.value,
            payload={"asset_ref": asset_ref},
            source=source,
        )
        self.store.update_experiment_stage(experiment_id, ExperimentStage.GENERATION_COMPLETED.value)
        return {
            **_transition("generation_completed", event, "check_generation_asset"),
            "content_item": content_item,
        }

    def get_generation_status(self, experiment_id: str) -> dict[str, Any]:
        self._get_experiment_or_raise(experiment_id)
        events = self.store.list_events_for_experiment(experiment_id)
        content_items = self.store.list_content_items_for_experiment(experiment_id)
        latest_generation_event = _latest_generation_event(events)
        if latest_generation_event is None:
            return {
                "status": "not_requested",
                "experiment_id": experiment_id,
                "next_action": _next_action_for_events(events),
            }
        if latest_generation_event["event_type"] == OpsEventType.GENERATION_COMPLETED.value:
            content_item = _content_item_for_event(content_items, latest_generation_event)
            return {
                "status": "completed",
                "experiment_id": experiment_id,
                "event": latest_generation_event,
                "content_item": content_item,
                "asset_check": _latest_asset_check(events, content_item["id"] if content_item else None),
                "next_action": _next_action_for_events(events),
            }
        if latest_generation_event["event_type"] == OpsEventType.GENERATION_FAILED.value:
            return {
                "status": "failed",
                "experiment_id": experiment_id,
                "event": latest_generation_event,
                "error": latest_generation_event["payload"],
                "next_action": _next_action_for_events(events),
            }
        return {
            "status": "running",
            "experiment_id": experiment_id,
            "event": latest_generation_event,
            "next_action": {"kind": "check_generation_status", "blocked": False},
        }

    def check_generation_asset(
        self,
        *,
        experiment_id: str,
        source: dict[str, Any],
        content_item_id: str | None = None,
    ) -> dict[str, Any]:
        _require_confirmed_source(source)
        experiment = self._get_experiment_or_raise(experiment_id)
        events = self.store.list_events_for_experiment(experiment_id)
        if not _has_event(events, OpsEventType.GENERATION_COMPLETED):
            raise OpsError("generation_required", "Asset check requires a completed generation.")
        content_items = self.store.list_content_items_for_experiment(experiment_id)
        content_item = _select_content_item(content_items, content_item_id)
        if content_item is None:
            raise OpsError("content_item_not_found", "Asset check requires a generated content item.")

        payload = _build_asset_check_payload(events, content_item)
        event = self.store.append_event(
            project_id=experiment["project_id"],
            cycle_id=experiment["cycle_id"],
            experiment_id=experiment_id,
            content_item_id=content_item["id"],
            event_type=OpsEventType.ASSET_CHECKED.value,
            payload=payload,
            source=source,
        )
        next_action = (
            {"kind": "record_publish", "blocked": False}
            if payload["status"] == "passed"
            else {"kind": "resolve_asset_issue", "blocked": True, "reason": "asset_check_failed"}
        )
        return {
            "status": "ok",
            "entity": {"kind": "ops_event", "id": event["id"], "stage": "asset_checked"},
            "event": event,
            "asset_check": payload,
            "next_action": next_action,
        }

    def record_publish(
        self,
        *,
        experiment_id: str,
        evidence: dict[str, Any],
        source: dict[str, Any],
        content_item_id: str | None = None,
        channel_account_id: str | None = None,
        account_id: str | None = None,
    ) -> dict[str, Any]:
        _require_confirmed_source(source)
        experiment = self._get_experiment_or_raise(experiment_id)
        effective_account_id = channel_account_id or account_id
        channel_account = None
        if effective_account_id:
            channel_account = self.store.get_channel_account(effective_account_id)
            if not channel_account:
                raise OpsError("channel_account_not_found", "Publish record must reference an existing channel account.")
            if channel_account["project_id"] != experiment["project_id"]:
                raise OpsError(
                    "channel_account_project_mismatch",
                    "Publish channel account must belong to the same project as the experiment.",
                )
        if content_item_id:
            self._require_content_item_for_experiment(experiment_id, content_item_id)
        if not _has_publish_evidence(evidence):
            raise OpsError("publish_evidence_required", "Publish evidence requires a URL, post id, Buffer id, or API response.")
        events = self.store.list_events_for_experiment(experiment_id)
        _require_passed_asset_check_before_publish(events, content_item_id)
        payload = {"evidence": evidence}
        if channel_account:
            payload["channel_account_id"] = channel_account["id"]
            payload["publication"] = {
                "content_item_id": content_item_id,
                "channel_account_id": channel_account["id"],
                "platform": channel_account["platform"],
                "account_name": channel_account["account_name"],
                "account_handle": channel_account.get("account_handle"),
            }
        event = self.store.append_event(
            project_id=experiment["project_id"],
            cycle_id=experiment["cycle_id"],
            experiment_id=experiment_id,
            content_item_id=content_item_id,
            event_type=OpsEventType.PUBLISH_RECORDED.value,
            payload=payload,
            source=source,
        )
        self.store.update_experiment_stage(experiment_id, ExperimentStage.PUBLISHED.value)
        return _transition("publish_recorded", event, "record_metrics")

    def record_metrics(
        self,
        *,
        experiment_id: str,
        metrics: dict[str, Any],
        source: dict[str, Any],
        content_item_id: str | None = None,
    ) -> dict[str, Any]:
        _require_confirmed_source(source)
        experiment = self._get_experiment_or_raise(experiment_id)
        events = self.store.list_events_for_experiment(experiment_id)
        if not _has_event(events, OpsEventType.PUBLISH_RECORDED):
            raise OpsError("publish_required", "Metrics require publish evidence first.")
        if not content_item_id or not _has_published_content(events, content_item_id):
            raise OpsError(
                "published_content_required",
                "Metrics must reference the content item that has publish evidence.",
            )
        self._require_content_item_for_experiment(experiment_id, content_item_id)
        publish_event = _publish_event_for_content(events, content_item_id)
        if publish_event and _is_mock_evidence(publish_event["payload"].get("evidence", {})):
            if not _is_mock_evidence(metrics):
                raise OpsError(
                    "mock_metrics_label_required",
                    "Mock metrics require mock=true and a non-empty mock_label.",
                )
        event = self.store.append_event(
            project_id=experiment["project_id"],
            cycle_id=experiment["cycle_id"],
            experiment_id=experiment_id,
            content_item_id=content_item_id,
            event_type=OpsEventType.METRICS_RECORDED.value,
            payload={"metrics": metrics},
            source=source,
        )
        self.store.update_experiment_stage(experiment_id, ExperimentStage.METRICS_RECORDED.value)
        return _transition("metrics_recorded", event, "write_retro")

    def write_retro(
        self,
        *,
        experiment_id: str,
        retro: dict[str, Any],
        source: dict[str, Any],
    ) -> dict[str, Any]:
        _require_confirmed_source(source)
        experiment = self._get_experiment_or_raise(experiment_id)
        events = self.store.list_events_for_experiment(experiment_id)
        if _has_event(events, OpsEventType.PREDICTION_LOCKED):
            event_type = OpsEventType.RETRO_WRITTEN
            stage = ExperimentStage.RETRO_WRITTEN
        else:
            event_type = OpsEventType.OBSERVATION_WRITTEN
            stage = ExperimentStage.OBSERVATION_WRITTEN
        event = self.store.append_event(
            project_id=experiment["project_id"],
            cycle_id=experiment["cycle_id"],
            experiment_id=experiment_id,
            event_type=event_type.value,
            payload={"retro": retro},
            source=source,
        )
        self.store.update_experiment_stage(experiment_id, stage.value)
        return _transition(event_type.value, event, "write_memory")

    def write_memory(
        self,
        *,
        experiment_id: str,
        memory: dict[str, Any],
        source: dict[str, Any],
    ) -> dict[str, Any]:
        _require_confirmed_source(source)
        experiment = self._get_experiment_or_raise(experiment_id)
        event = self.store.append_event(
            project_id=experiment["project_id"],
            cycle_id=experiment["cycle_id"],
            experiment_id=experiment_id,
            event_type=OpsEventType.MEMORY_WRITTEN.value,
            payload={"memory": memory},
            source=source,
        )
        return _transition("memory_written", event, "done")

    def current_view(
        self,
        *,
        project_id: str | None = None,
        channel_account_id: str | None = None,
        account_id: str | None = None,
    ) -> dict[str, Any]:
        if project_id and not self.store.get_project(project_id):
            raise OpsError("project_not_found", "Current view project filter must reference an existing project.")
        effective_account_id = channel_account_id or account_id
        if effective_account_id and not self.store.get_channel_account(effective_account_id):
            raise OpsError(
                "channel_account_not_found",
                "Current view account filter must reference an existing channel account.",
            )
        view = self.store.get_current_view(
            project_id=project_id,
            channel_account_id=channel_account_id,
            account_id=account_id,
        )
        _with_current_content_item(view)
        if not project_id and not effective_account_id and len(self.store.list_projects()) > 1:
            view["next_action"] = _select_context_action("multiple_projects")
            return view
        if not effective_account_id and len(view["channel_accounts"]) > 1:
            view["next_action"] = _select_context_action("multiple_accounts")
            return view
        view["next_action"] = _next_action_for_view(view)
        return view

    def get_experiment_view(self, experiment_id: str) -> dict[str, Any]:
        experiment = self._get_experiment_or_raise(experiment_id)
        events = self.store.list_events_for_experiment(experiment_id)
        return _with_current_content_item(
            {
                "experiment": experiment,
                "content_items": self.store.list_content_items_for_experiment(experiment_id),
                "events": events,
                "next_action": _next_action_for_events(events),
            }
        )

    def get_context_export(
        self,
        *,
        project_id: str | None = None,
        channel_account_id: str | None = None,
        account_id: str | None = None,
    ) -> dict[str, Any]:
        view = self.current_view(
            project_id=project_id,
            channel_account_id=channel_account_id,
            account_id=account_id,
        )
        project = view.get("project")
        cheat_summary = None
        cheat_status = "not_configured"
        if project:
            cheat_view = self.get_cheat_workspace_summary(project["id"])
            cheat_status = cheat_view["cheat_workspace"]["status"]
            cheat_summary = cheat_view["summary"]
        events = view.get("events", [])
        return {
            "status": "ok",
            "context_export": {
                "project": project,
                "channel_account": view.get("selected_channel_account"),
                "current_cycle": view.get("cycle"),
                "current_experiment": view.get("experiment"),
                "next_action": view.get("next_action"),
                "recent_ops_events": events[-10:],
                "content_items": view.get("content_items", []),
                "content_item": view.get("content_item"),
                "asset_check": view.get("asset_check"),
                "project_memory_summary": _project_memory_summary(events),
                "cheat_workspace_summary": cheat_summary,
                "sync_status": {
                    "cheat_workspace": cheat_status,
                },
            },
            "next_action": view.get("next_action"),
        }

    def submit_writeback_draft(
        self,
        *,
        operation: str,
        target: dict[str, Any],
        payload: dict[str, Any],
        source: dict[str, Any],
    ) -> dict[str, Any]:
        _require_confirmed_source(source)
        if operation not in WRITEBACK_OPERATIONS:
            raise OpsError("unsupported_writeback_operation", f"Unsupported writeback operation: {operation}.")
        tracked_source = _source_with_fingerprint(source)
        draft = self.store.create_writeback_draft(
            operation=operation,
            target=target,
            payload=payload,
            source=tracked_source,
        )
        return {
            "status": "ok",
            "draft": draft,
            "next_action": {"kind": "validate_writeback_draft", "blocked": False},
        }

    def validate_writeback_draft(self, draft_id: str) -> dict[str, Any]:
        draft = self._get_writeback_draft_or_raise(draft_id)
        try:
            self._validate_writeback_payload(draft)
        except OpsError as exc:
            validation_result = {"status": "error", "error": {"code": exc.code, "message": exc.message}}
            updated = self.store.update_writeback_draft(
                draft_id=draft_id,
                status="validation_failed",
                validation_result=validation_result,
            )
            return {
                "status": "ok",
                "draft": updated,
                "next_action": {"kind": "revise_writeback_draft", "blocked": True, "reason": exc.code},
            }
        validation_result = {"status": "ok"}
        updated = self.store.update_writeback_draft(
            draft_id=draft_id,
            status="validation_passed",
            validation_result=validation_result,
        )
        return {
            "status": "ok",
            "draft": updated,
            "next_action": {"kind": "apply_writeback_draft", "blocked": False},
        }

    def apply_writeback_draft(
        self,
        draft_id: str,
        *,
        source: dict[str, Any],
    ) -> dict[str, Any]:
        _require_confirmed_source(source)
        draft = self._get_writeback_draft_or_raise(draft_id)
        if draft["status"] == "applied":
            return {
                "status": "ok",
                "draft": draft,
                "applied_result": draft.get("applied_result", {}),
                "next_action": {"kind": "already_applied", "blocked": False},
            }
        if draft["status"] != "validation_passed":
            raise OpsError(
                "writeback_draft_not_validated",
                "Writeback draft must pass validation before apply.",
            )
        # Revalidate immediately before applying so stale source or target changes cannot slip through.
        try:
            self._validate_writeback_payload(draft)
        except OpsError as exc:
            self.store.update_writeback_draft(
                draft_id=draft_id,
                status="validation_failed",
                validation_result={"status": "error", "error": {"code": exc.code, "message": exc.message}},
            )
            raise
        apply_source = {
            **draft["source"],
            **source,
            "draft_id": draft_id,
        }
        if draft["operation"] == "create_content_experiment":
            experiment = self.create_experiment(
                project_id=draft["target"]["project_id"],
                cycle_id=draft["target"]["cycle_id"],
                title=draft["payload"]["title"].strip(),
                hypothesis=draft["payload"]["hypothesis"].strip(),
                source=apply_source,
            )
            result = {
                "entity": {"kind": "content_experiment", **experiment},
                "next_action": {"kind": "lock_prediction", "blocked": False},
            }
        elif draft["operation"] == "lock_content_prediction":
            result = self.lock_prediction(
                experiment_id=draft["target"]["experiment_id"],
                prediction=draft["payload"]["prediction"],
                source=apply_source,
            )
        elif draft["operation"] == "submit_generation_draft":
            result = self.submit_generation_draft(
                experiment_id=draft["target"]["experiment_id"],
                text=draft["payload"]["text"],
                source=apply_source,
                pipeline=draft["payload"].get("pipeline", "standard"),
                title=draft["payload"].get("title"),
                generation_params=draft["payload"].get("generation_params"),
            )
        elif draft["operation"] == "record_publish_evidence":
            result = self.record_publish(
                experiment_id=draft["target"]["experiment_id"],
                content_item_id=draft["target"].get("content_item_id"),
                channel_account_id=draft["target"].get("channel_account_id"),
                account_id=draft["target"].get("account_id"),
                evidence=draft["payload"]["evidence"],
                source=apply_source,
            )
        elif draft["operation"] == "record_metrics_snapshot":
            result = self.record_metrics(
                experiment_id=draft["target"]["experiment_id"],
                content_item_id=draft["target"].get("content_item_id"),
                metrics=draft["payload"]["metrics"],
                source=apply_source,
            )
        elif draft["operation"] == "record_retro_observation":
            result = self.write_retro(
                experiment_id=draft["target"]["experiment_id"],
                retro=draft["payload"]["retro"],
                source=apply_source,
            )
        elif draft["operation"] == "write_project_memory_event":
            result = self.write_memory(
                experiment_id=draft["target"]["experiment_id"],
                memory=draft["payload"]["memory"],
                source=apply_source,
            )
        else:
            raise OpsError(
                "unsupported_writeback_operation",
                f"Unsupported writeback operation: {draft['operation']}.",
            )
        applied_result = {
            "status": "ok",
            "entity": result.get("entity"),
            "event_id": result.get("event", {}).get("id"),
        }
        updated = self.store.update_writeback_draft(
            draft_id=draft_id,
            status="applied",
            applied_result=applied_result,
        )
        return {
            "status": "ok",
            "draft": updated,
            "applied_result": result,
            "next_action": result.get("next_action"),
        }

    def reject_writeback_draft(
        self,
        draft_id: str,
        *,
        reason: str,
        source: dict[str, Any],
    ) -> dict[str, Any]:
        _require_confirmed_source(source)
        draft = self._get_writeback_draft_or_raise(draft_id)
        if draft["status"] == "applied":
            raise OpsError("writeback_draft_already_applied", "Applied writeback drafts cannot be rejected.")
        validation_result = {
            **(draft.get("validation_result") or {}),
            "rejection_reason": reason,
            "rejected_by": source.get("kind"),
        }
        updated = self.store.update_writeback_draft(
            draft_id=draft_id,
            status="rejected",
            validation_result=validation_result,
        )
        return {
            "status": "ok",
            "draft": updated,
            "next_action": {"kind": "done", "blocked": False},
        }

    async def list_generation_pipelines(self) -> dict[str, Any]:
        pipelines = await self._list_available_pipelines()
        if pipelines is None:
            raise OpsError("pipelines_unavailable", "Generation pipelines are not available from this service instance.")
        pipeline_names = list(pipelines)
        default_pipeline = "standard" if "standard" in pipeline_names else (pipeline_names[0] if pipeline_names else None)
        return {
            "status": "ok",
            "pipeline_names": pipeline_names,
            "default_pipeline": default_pipeline,
            "pipelines": [
                {
                    "name": name,
                    "recommended": name == default_pipeline,
                    "description": PIPELINE_DESCRIPTIONS.get(name, "Registered Pixelle generation pipeline."),
                }
                for name in pipeline_names
            ],
            "next_action": {"kind": "select_generation_pipeline", "blocked": False},
        }

    async def _require_known_pipeline(self, pipeline: str) -> None:
        available_pipelines = await self._list_available_pipelines()
        if available_pipelines is None or pipeline in available_pipelines:
            return
        available = ", ".join(available_pipelines)
        raise OpsError(
            "unknown_generation_pipeline",
            f"Unknown pipeline: {pipeline!r}. Available pipelines: {available}.",
        )

    async def _list_available_pipelines(self) -> tuple[str, ...] | None:
        if self.available_pipelines is not None:
            return self.available_pipelines
        if self.generation_runner is not None:
            return None

        from pixelle_video import pixelle_video

        if not pixelle_video.generate_video:
            await pixelle_video.initialize()
        return tuple(pixelle_video.pipelines.keys())

    async def _run_generation(self, **kwargs: Any) -> dict[str, Any]:
        if self.generation_runner is None:
            from pixelle_video import pixelle_video

            if not pixelle_video.generate_video:
                await pixelle_video.initialize()
            result = pixelle_video.generate_video(**kwargs)
        else:
            result = self.generation_runner(**kwargs)
        if inspect.isawaitable(result):
            result = await result
        return _normalize_asset_ref(result)

    def _get_experiment_or_raise(self, experiment_id: str) -> dict[str, Any]:
        experiment = self.store.get_experiment(experiment_id)
        if not experiment:
            raise OpsError("experiment_not_found", "Content experiment was not found.")
        return experiment

    def _get_writeback_draft_or_raise(self, draft_id: str) -> dict[str, Any]:
        draft = self.store.get_writeback_draft(draft_id)
        if not draft:
            raise OpsError("writeback_draft_not_found", "Writeback draft was not found.")
        return draft

    def _require_content_item_for_experiment(self, experiment_id: str, content_item_id: str) -> dict[str, Any]:
        content_item = next(
            (
                item
                for item in self.store.list_content_items_for_experiment(experiment_id)
                if item["id"] == content_item_id
            ),
            None,
        )
        if content_item is None:
            raise OpsError(
                "content_item_not_found",
                "Content item must exist and belong to the target experiment.",
            )
        return content_item

    def _validate_writeback_payload(self, draft: dict[str, Any]) -> None:
        target = draft.get("target", {})
        payload = draft.get("payload", {})
        operation = draft.get("operation")
        if operation == "create_content_experiment":
            self._validate_create_content_experiment_writeback(target, payload)
            _require_source_fingerprint_synced(draft.get("source", {}))
            return

        experiment_id = target.get("experiment_id")
        if not experiment_id:
            raise OpsError("writeback_target_required", "Writeback draft requires target.experiment_id.")
        self._get_experiment_or_raise(experiment_id)
        _require_source_fingerprint_synced(draft.get("source", {}))
        events = self.store.list_events_for_experiment(experiment_id)
        if operation == "lock_content_prediction":
            if not isinstance(payload.get("prediction"), dict) or not payload["prediction"]:
                raise OpsError("prediction_required", "Prediction writeback requires a prediction payload.")
            if _has_event(events, OpsEventType.PUBLISH_RECORDED, OpsEventType.METRICS_RECORDED):
                raise OpsError("prediction_window_closed", "Cannot lock prediction after publish or metrics evidence.")
            return
        if operation == "submit_generation_draft":
            if not _has_event(events, OpsEventType.PREDICTION_LOCKED):
                raise OpsError("prediction_required", "Generation draft requires a locked prediction.")
            text = payload.get("text")
            if not isinstance(text, str):
                raise OpsError("generation_draft_invalid", "Generation draft text must be a string.")
            _require_clean_generation_draft_text(text)
            return
        if operation == "record_publish_evidence":
            evidence = payload.get("evidence")
            if not isinstance(evidence, dict) or not _has_publish_evidence(evidence):
                raise OpsError(
                    "publish_evidence_required",
                    "Publish writeback requires URL, post id, Buffer id, API response, or explicit mock evidence.",
                )
            content_item_id = target.get("content_item_id")
            if content_item_id:
                self._require_content_item_for_experiment(experiment_id, content_item_id)
            return
        if operation == "record_metrics_snapshot":
            metrics = payload.get("metrics")
            if not isinstance(metrics, dict) or not metrics:
                raise OpsError("metrics_required", "Metrics writeback requires a metrics payload.")
            if not _has_event(events, OpsEventType.PUBLISH_RECORDED):
                raise OpsError("publish_required", "Metrics writeback requires publish evidence first.")
            content_item_id = target.get("content_item_id")
            if not content_item_id or not _has_published_content(events, content_item_id):
                raise OpsError(
                    "published_content_required",
                    "Metrics writeback must reference the published content item.",
                )
            self._require_content_item_for_experiment(experiment_id, content_item_id)
            publish_event = _publish_event_for_content(events, content_item_id)
            if publish_event and _is_mock_evidence(publish_event["payload"].get("evidence", {})):
                if not _is_mock_evidence(metrics):
                    raise OpsError(
                        "mock_metrics_label_required",
                        "Mock publish evidence requires mock metrics to carry mock=true and mock_label.",
                    )
            return
        if operation == "record_retro_observation":
            retro = payload.get("retro")
            if not isinstance(retro, dict) or not retro:
                raise OpsError("retro_required", "Retro writeback requires a retro payload.")
            if not _has_event(events, OpsEventType.METRICS_RECORDED):
                raise OpsError("metrics_required", "Retro writeback requires metrics evidence first.")
            return
        if operation == "write_project_memory_event":
            memory = payload.get("memory")
            if not isinstance(memory, dict) or not memory:
                raise OpsError("memory_required", "Memory writeback requires a memory payload.")
            if not _has_event(events, OpsEventType.RETRO_WRITTEN, OpsEventType.OBSERVATION_WRITTEN):
                raise OpsError("retro_required", "Memory writeback requires a retro or observation first.")
            return
        raise OpsError("unsupported_writeback_operation", f"Unsupported writeback operation: {operation}.")

    def _validate_create_content_experiment_writeback(
        self,
        target: dict[str, Any],
        payload: dict[str, Any],
    ) -> None:
        project_id = target.get("project_id")
        cycle_id = target.get("cycle_id")
        if not project_id or not cycle_id:
            raise OpsError(
                "create_experiment_target_required",
                "Create experiment writeback requires target.project_id and target.cycle_id.",
            )
        if not self.store.get_project(project_id):
            raise OpsError("project_not_found", "Content experiment requires an existing project.")
        cycle = self.store.get_cycle(cycle_id)
        if not cycle:
            raise OpsError("cycle_not_found", "Content experiment requires an existing cycle.")
        if cycle["project_id"] != project_id:
            raise OpsError("cycle_project_mismatch", "Operation cycle must belong to the project.")
        title = payload.get("title")
        hypothesis = payload.get("hypothesis")
        if not isinstance(title, str) or not title.strip():
            raise OpsError("experiment_title_required", "Create experiment writeback requires payload.title.")
        if not isinstance(hypothesis, str) or not hypothesis.strip():
            raise OpsError(
                "experiment_hypothesis_required",
                "Create experiment writeback requires payload.hypothesis.",
            )


def _require_confirmed_source(source: dict[str, Any]) -> None:
    if source.get("kind") == "codex" and source.get("confirmed_by_user") is not True:
        raise OpsError("source_not_confirmed", "Codex writes require explicit user confirmation.")


def _source_with_fingerprint(source: dict[str, Any]) -> dict[str, Any]:
    if not source.get("workspace_path") or not source.get("source_file"):
        return source
    return {
        **source,
        **_source_fingerprint(source),
    }


def _require_source_fingerprint_synced(source: dict[str, Any]) -> None:
    if not source.get("workspace_path") or not source.get("source_file"):
        return
    current = _source_fingerprint(source)
    if current.get("source_status") == "source_untracked_remote":
        return
    if current.get("source_status") == "source_missing":
        raise OpsError("source_missing", "Writeback source file is missing.")
    if current.get("source_status") == "source_unreadable":
        raise OpsError("source_unreadable", "Writeback source file cannot be read.")
    expected_hash = source.get("source_hash")
    if not expected_hash:
        raise OpsError("source_hash_required", "Writeback source tracking requires source_hash.")
    if expected_hash != current.get("source_hash"):
        raise OpsError("source_hash_changed", "Writeback source file changed after the draft was created.")


def _source_fingerprint(source: dict[str, Any]) -> dict[str, Any]:
    source_path = _resolve_source_path(source)
    if source_path is None:
        return {"source_status": "source_untracked_remote"}
    if not source_path.is_file():
        return {"source_status": "source_missing"}
    try:
        data = source_path.read_bytes()
        stat = source_path.stat()
    except OSError:
        return {"source_status": "source_unreadable"}
    digest = hashlib.sha256(data).hexdigest()
    return {
        "source_status": "source_synced",
        "source_hash": f"sha256:{digest}",
        "source_mtime": stat.st_mtime,
    }


def _resolve_source_path(source: dict[str, Any]) -> Path | None:
    workspace_path = str(source.get("workspace_path") or "")
    source_file = str(source.get("source_file") or "")
    if is_remote_workspace_path(workspace_path) or is_remote_workspace_path(source_file):
        return None
    path = Path(source_file).expanduser()
    if path.is_absolute():
        return path
    return Path(workspace_path).expanduser() / path


def _reject_plaintext_credential_ref(credential_ref: dict[str, Any]) -> None:
    blocked_names = ("password", "secret", "token", "api_key", "apikey", "access_key", "private_key")
    for key, value in credential_ref.items():
        normalized_key = str(key).lower().replace("-", "_")
        if any(blocked_name in normalized_key for blocked_name in blocked_names) and value:
            raise OpsError(
                "credential_ref_must_be_reference",
                "Credential reference must point to a secret manager entry; do not store plaintext credentials.",
            )


def _has_event(events: list[dict[str, Any]], *event_types: OpsEventType) -> bool:
    values = {event_type.value for event_type in event_types}
    return any(event["event_type"] in values for event in events)


def _require_clean_generation_draft_text(text: str) -> None:
    if not text.strip():
        raise OpsError("generation_draft_invalid", "Generation draft text cannot be empty.")

    found = _blocked_generation_draft_markers(text)
    if found:
        markers = ", ".join(found)
        raise OpsError(
            "generation_draft_invalid",
            f"Generation draft text must be the final script/subtitles only. Remove wrapper sections: {markers}.",
        )


def _require_generation_request_window(events: list[dict[str, Any]]) -> None:
    latest_generation_event = _latest_generation_event(events)
    if latest_generation_event and latest_generation_event["event_type"] == OpsEventType.GENERATION_COMPLETED.value:
        latest_check = _latest_asset_check(events, latest_generation_event.get("content_item_id"))
        if latest_check and latest_check["payload"].get("status") == "failed":
            return
        raise OpsError("generation_already_completed", "Generation is already completed for this experiment.")

    if latest_generation_event and latest_generation_event["event_type"] == OpsEventType.GENERATION_REQUESTED.value:
        raise OpsError("generation_in_progress", "Generation is already requested and has not completed or failed.")


def _generation_request_already_completed(events: list[dict[str, Any]], generation_event_id: str) -> bool:
    seen_request = False
    for event in events:
        if event["id"] == generation_event_id:
            seen_request = True
            continue
        if seen_request and event["event_type"] == OpsEventType.GENERATION_COMPLETED.value:
            return True
    return False


def _latest_generation_event(events: list[dict[str, Any]]) -> dict[str, Any] | None:
    generation_event_types = {
        OpsEventType.GENERATION_REQUESTED.value,
        OpsEventType.GENERATION_COMPLETED.value,
        OpsEventType.GENERATION_FAILED.value,
    }
    return next((event for event in reversed(events) if event["event_type"] in generation_event_types), None)


def _latest_generation_completed_event(events: list[dict[str, Any]]) -> dict[str, Any] | None:
    return next(
        (
            event
            for event in reversed(events)
            if event["event_type"] == OpsEventType.GENERATION_COMPLETED.value
        ),
        None,
    )


def _blocked_generation_draft_markers(text: str) -> list[str]:
    return [marker for marker in BLOCKED_GENERATION_DRAFT_MARKERS if marker in text]


def _find_event(
    events: list[dict[str, Any]],
    event_id: str,
    event_type: OpsEventType,
) -> dict[str, Any] | None:
    return next(
        (
            event
            for event in events
            if event["id"] == event_id and event["event_type"] == event_type.value
        ),
        None,
    )


def _approved_draft_for_generation(
    events: list[dict[str, Any]],
    approved_draft_id: str | None,
) -> dict[str, Any] | None:
    if not approved_draft_id:
        return None
    approval = _find_event(events, approved_draft_id, OpsEventType.GENERATION_DRAFT_APPROVED)
    if approval is None:
        return None
    draft_id = approval["payload"].get("draft_id")
    if not draft_id:
        return None
    return _find_event(events, draft_id, OpsEventType.GENERATION_DRAFTED)


def _normalize_asset_ref(result: Any) -> dict[str, Any]:
    asset_fields = ("path", "video_path", "url", "asset_url", "output_path")
    metadata_fields = ("duration", "file_size", "media_type", "task_id")
    if isinstance(result, dict):
        asset_ref = {
            key: result[key]
            for key in (*asset_fields, *metadata_fields)
            if result.get(key) is not None
        }
    else:
        asset_ref = {
            key: getattr(result, key)
            for key in (*asset_fields, *metadata_fields)
            if getattr(result, key, None) is not None
        }
    if not any(asset_ref.get(key) for key in asset_fields):
        raise OpsError("invalid_generation_result", "Generation completed without an asset reference.")
    return asset_ref


def _generation_params_for_approved_draft(
    *,
    pipeline: str,
    title: str | None,
    generation_params: dict[str, Any],
) -> dict[str, Any]:
    params = dict(generation_params)
    if pipeline == "standard":
        params["mode"] = "fixed"
        params.setdefault("split_mode", "paragraph")
        if title and "title" not in params:
            params["title"] = title
    return params


def _select_content_item(
    content_items: list[dict[str, Any]],
    content_item_id: str | None,
) -> dict[str, Any] | None:
    if content_item_id:
        return next((item for item in content_items if item["id"] == content_item_id), None)
    return content_items[-1] if content_items else None


def _content_item_for_event(
    content_items: list[dict[str, Any]],
    event: dict[str, Any],
) -> dict[str, Any] | None:
    return _select_content_item(content_items, event.get("content_item_id"))


def _current_content_item_for_events(
    content_items: list[dict[str, Any]],
    events: list[dict[str, Any]],
) -> dict[str, Any] | None:
    latest_completed = _latest_generation_completed_event(events)
    if latest_completed is not None:
        return _content_item_for_event(content_items, latest_completed)
    return content_items[-1] if content_items else None


def _latest_asset_check(
    events: list[dict[str, Any]],
    content_item_id: str | None,
) -> dict[str, Any] | None:
    return next(
        (
            event
            for event in reversed(events)
            if event["event_type"] == OpsEventType.ASSET_CHECKED.value
            and (content_item_id is None or event.get("content_item_id") == content_item_id)
        ),
        None,
    )


def _build_asset_check_payload(
    events: list[dict[str, Any]],
    content_item: dict[str, Any],
) -> dict[str, Any]:
    asset_ref = content_item.get("asset_ref") or {}
    asset_path = _asset_path_from_ref(asset_ref)
    is_local_path = bool(asset_path and not _is_url(asset_path))
    local_file_exists = False
    local_file_size = None
    if is_local_path:
        path = Path(asset_path)
        local_file_exists = path.is_file()
        if local_file_exists:
            local_file_size = path.stat().st_size

    latest_requested = next(
        (
            event
            for event in reversed(events)
            if event["event_type"] == OpsEventType.GENERATION_REQUESTED.value
        ),
        None,
    )
    requested_text = (latest_requested or {}).get("payload", {}).get("text", "")
    draft_markers = _blocked_generation_draft_markers(requested_text)
    storyboard_check = _storyboard_text_check(asset_path, requested_text)
    checks = {
        "generation_completed_event_present": _has_event(events, OpsEventType.GENERATION_COMPLETED),
        "asset_reference_present": bool(asset_path),
        "local_file_required": is_local_path,
        "local_file_exists": local_file_exists,
        "local_file_size": local_file_size,
        "duration_seconds": asset_ref.get("duration"),
        "draft_text_clean": not draft_markers,
        "blocked_draft_markers": draft_markers,
        **storyboard_check,
    }
    passed = (
        checks["generation_completed_event_present"]
        and checks["asset_reference_present"]
        and checks["draft_text_clean"]
        and checks["storyboard_text_matches_draft"] is not False
        and (not checks["local_file_required"] or (checks["local_file_exists"] and (local_file_size or 0) > 0))
    )
    return {
        "status": "passed" if passed else "failed",
        "content_item_id": content_item["id"],
        "asset_ref": asset_ref,
        "asset_path": asset_path,
        "checks": checks,
    }


def _asset_path_from_ref(asset_ref: dict[str, Any]) -> str | None:
    for key in ("video_path", "path", "output_path", "url", "asset_url"):
        value = asset_ref.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return None


def _storyboard_text_check(asset_path: str | None, requested_text: str) -> dict[str, Any]:
    default = {
        "storyboard_text_available": False,
        "storyboard_text_matches_draft": None,
    }
    if not asset_path or _is_url(asset_path) or not requested_text:
        return default

    storyboard_path = Path(asset_path).parent / "storyboard.json"
    if not storyboard_path.is_file():
        return default

    try:
        storyboard = json.loads(storyboard_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {
            "storyboard_text_available": True,
            "storyboard_text_matches_draft": False,
        }

    frames = storyboard.get("frames") if isinstance(storyboard, dict) else None
    if not isinstance(frames, list):
        return {
            "storyboard_text_available": True,
            "storyboard_text_matches_draft": False,
        }

    narrations = [
        str(frame.get("narration", "")).strip()
        for frame in frames
        if isinstance(frame, dict) and str(frame.get("narration", "")).strip()
    ]
    storyboard_text = "\n\n".join(narrations)
    return {
        "storyboard_text_available": True,
        "storyboard_text_matches_draft": _normalize_text_for_asset_check(storyboard_text)
        == _normalize_text_for_asset_check(requested_text),
    }


def _normalize_text_for_asset_check(text: str) -> str:
    return "".join(str(text).split())


def _is_url(value: str) -> bool:
    return value.startswith(("http://", "https://"))


def _has_published_content(events: list[dict[str, Any]], content_item_id: str) -> bool:
    return any(
        event["event_type"] == OpsEventType.PUBLISH_RECORDED.value
        and event.get("content_item_id") == content_item_id
        for event in events
    )


def _has_publish_evidence(evidence: dict[str, Any]) -> bool:
    has_real_evidence = any(
        evidence.get(key)
        for key in ("platform_url", "platform_post_id", "buffer_post_id", "platform_response")
    )
    return has_real_evidence or _is_mock_evidence(evidence)


def _is_mock_evidence(payload: dict[str, Any]) -> bool:
    return payload.get("mock") is True and bool(str(payload.get("mock_label", "")).strip())


def _publish_event_for_content(events: list[dict[str, Any]], content_item_id: str) -> dict[str, Any] | None:
    for event in reversed(events):
        if (
            event["event_type"] == OpsEventType.PUBLISH_RECORDED.value
            and event.get("content_item_id") == content_item_id
        ):
            return event
    return None


def _require_passed_asset_check_before_publish(
    events: list[dict[str, Any]],
    content_item_id: str | None,
) -> None:
    if not _has_event(events, OpsEventType.GENERATION_REQUESTED, OpsEventType.GENERATION_COMPLETED):
        return
    asset_check = _latest_asset_check(events, content_item_id)
    if asset_check is None:
        raise OpsError("asset_check_required", "Publish requires a passed generation asset check.")
    if asset_check["payload"].get("status") != "passed":
        raise OpsError("asset_check_failed", "Publish requires a passed generation asset check.")


def _transition(status: str, event: dict[str, Any], next_kind: str) -> dict[str, Any]:
    return {
        "status": "ok",
        "entity": {"kind": "ops_event", "id": event["id"], "stage": status},
        "event": event,
        "next_action": {"kind": next_kind, "blocked": False},
    }


def _next_action_for_view(view: dict[str, Any]) -> dict[str, Any]:
    if not view.get("project"):
        return {"kind": "create_project", "blocked": False}
    if not view.get("cycle"):
        return {"kind": "create_cycle", "blocked": False}
    if not view.get("experiment"):
        return {"kind": "create_experiment", "blocked": False}
    return _next_action_for_events(view["events"])


def _with_current_content_item(view: dict[str, Any]) -> dict[str, Any]:
    events = view.get("events") or []
    content_items = view.get("content_items") or []
    content_item = _current_content_item_for_events(content_items, events)
    content_item_id = content_item["id"] if content_item else None
    view["content_item"] = content_item
    view["asset_check"] = _latest_asset_check(events, content_item_id) if content_item_id else None
    return view


def _select_context_action(reason: str) -> dict[str, Any]:
    kind = "select_channel_account" if reason == "multiple_accounts" else "select_project"
    return {
        "kind": kind,
        "blocked": True,
        "reason": reason,
    }


def _project_memory_summary(events: list[dict[str, Any]]) -> dict[str, Any]:
    memory_events = [
        event
        for event in events
        if event.get("event_type") == OpsEventType.MEMORY_WRITTEN.value
    ]
    return {
        "count": len(memory_events),
        "latest": memory_events[-1]["payload"].get("memory") if memory_events else None,
        "latest_event_id": memory_events[-1]["id"] if memory_events else None,
    }


def _next_action_for_events(events: list[dict[str, Any]]) -> dict[str, Any]:
    if not _has_event(events, OpsEventType.PREDICTION_LOCKED):
        return {"kind": "lock_prediction", "blocked": False}
    if _has_event(events, OpsEventType.GENERATION_COMPLETED):
        return _next_action_after_generation_completed(events)
    if not _has_event(events, OpsEventType.GENERATION_DRAFTED):
        return {"kind": "submit_generation_draft", "blocked": False}
    if not _has_event(events, OpsEventType.GENERATION_DRAFT_APPROVED):
        return {"kind": "approve_generation_draft", "blocked": False}
    if not _has_event(events, OpsEventType.GENERATION_COMPLETED):
        return {"kind": "request_generation", "blocked": False}
    if not _has_event(events, OpsEventType.PUBLISH_RECORDED):
        return {"kind": "record_publish", "blocked": False}
    if not _has_event(events, OpsEventType.METRICS_RECORDED):
        return {"kind": "record_metrics", "blocked": False}
    if not _has_event(events, OpsEventType.RETRO_WRITTEN, OpsEventType.OBSERVATION_WRITTEN):
        return {"kind": "write_retro", "blocked": False}
    if not _has_event(events, OpsEventType.MEMORY_WRITTEN):
        return {"kind": "write_memory", "blocked": False}
    return {"kind": "done", "blocked": False}


def _next_action_after_generation_completed(events: list[dict[str, Any]]) -> dict[str, Any]:
    latest_generation = _latest_generation_completed_event(events)
    content_item_id = latest_generation.get("content_item_id") if latest_generation else None
    asset_check = _latest_asset_check(events, content_item_id)
    if asset_check is None:
        return {"kind": "check_generation_asset", "blocked": False}
    if asset_check["payload"].get("status") != "passed":
        return {"kind": "resolve_asset_issue", "blocked": True, "reason": "asset_check_failed"}
    if not _has_event(events, OpsEventType.PUBLISH_RECORDED):
        return {"kind": "record_publish", "blocked": False}
    if not _has_event(events, OpsEventType.METRICS_RECORDED):
        return {"kind": "record_metrics", "blocked": False}
    if not _has_event(events, OpsEventType.RETRO_WRITTEN, OpsEventType.OBSERVATION_WRITTEN):
        return {"kind": "write_retro", "blocked": False}
    if not _has_event(events, OpsEventType.MEMORY_WRITTEN):
        return {"kind": "write_memory", "blocked": False}
    return {"kind": "done", "blocked": False}
