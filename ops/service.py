"""Business rules for the minimal Pixelle operations loop."""

from __future__ import annotations

import inspect
from collections.abc import Iterable
from pathlib import Path
from typing import Any, Callable

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
        generation_params = draft["payload"].get("generation_params") or {}
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
        if _has_event(events, OpsEventType.GENERATION_COMPLETED):
            raise OpsError("generation_already_completed", "Generation is already completed for this experiment.")

        payload = generation_event["payload"]
        text = payload["text"]
        pipeline = payload.get("pipeline") or "standard"
        generation_params = payload.get("generation_params") or {}
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
        return {
            "experiment": experiment,
            "content_items": self.store.list_content_items_for_experiment(experiment_id),
            "events": self.store.list_events_for_experiment(experiment_id),
            "next_action": _next_action_for_events(self.store.list_events_for_experiment(experiment_id)),
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


def _require_confirmed_source(source: dict[str, Any]) -> None:
    if source.get("kind") == "codex" and source.get("confirmed_by_user") is not True:
        raise OpsError("source_not_confirmed", "Codex writes require explicit user confirmation.")


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
    if _has_event(events, OpsEventType.GENERATION_COMPLETED):
        raise OpsError("generation_already_completed", "Generation is already completed for this experiment.")

    latest_generation_event = _latest_generation_event(events)
    if latest_generation_event and latest_generation_event["event_type"] == OpsEventType.GENERATION_REQUESTED.value:
        raise OpsError("generation_in_progress", "Generation is already requested and has not completed or failed.")


def _latest_generation_event(events: list[dict[str, Any]]) -> dict[str, Any] | None:
    generation_event_types = {
        OpsEventType.GENERATION_REQUESTED.value,
        OpsEventType.GENERATION_COMPLETED.value,
        OpsEventType.GENERATION_FAILED.value,
    }
    return next((event for event in reversed(events) if event["event_type"] in generation_event_types), None)


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
    draft_markers = _blocked_generation_draft_markers((latest_requested or {}).get("payload", {}).get("text", ""))
    checks = {
        "generation_completed_event_present": _has_event(events, OpsEventType.GENERATION_COMPLETED),
        "asset_reference_present": bool(asset_path),
        "local_file_required": is_local_path,
        "local_file_exists": local_file_exists,
        "local_file_size": local_file_size,
        "duration_seconds": asset_ref.get("duration"),
        "draft_text_clean": not draft_markers,
        "blocked_draft_markers": draft_markers,
    }
    passed = (
        checks["generation_completed_event_present"]
        and checks["asset_reference_present"]
        and checks["draft_text_clean"]
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


def _is_url(value: str) -> bool:
    return value.startswith(("http://", "https://"))


def _has_published_content(events: list[dict[str, Any]], content_item_id: str) -> bool:
    return any(
        event["event_type"] == OpsEventType.PUBLISH_RECORDED.value
        and event.get("content_item_id") == content_item_id
        for event in events
    )


def _has_publish_evidence(evidence: dict[str, Any]) -> bool:
    return any(
        evidence.get(key)
        for key in ("platform_url", "platform_post_id", "buffer_post_id", "platform_response")
    )


def _require_passed_asset_check_before_publish(
    events: list[dict[str, Any]],
    content_item_id: str | None,
) -> None:
    if not _has_event(events, OpsEventType.GENERATION_REQUESTED):
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


def _select_context_action(reason: str) -> dict[str, Any]:
    return {
        "kind": "select_project",
        "blocked": True,
        "reason": reason,
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
    asset_check = _latest_asset_check(events, None)
    if asset_check is None:
        if not _has_event(events, OpsEventType.GENERATION_REQUESTED):
            return {"kind": "record_publish", "blocked": False}
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
