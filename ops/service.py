"""Business rules for the minimal Pixelle operations loop."""

from __future__ import annotations

import inspect
from typing import Any, Callable

from ops.models import ExperimentStage, OpsEventType
from ops.store import OpsStore


class OpsError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(f"{code}: {message}")


GenerationRunner = Callable[..., Any]


class OpsService:
    def __init__(self, store: OpsStore | None = None, generation_runner: GenerationRunner | None = None):
        self.store = store or OpsStore()
        self.store.init_db()
        self.generation_runner = generation_runner

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
        return _transition("prediction_locked", event, "request_generation")

    async def request_generation(
        self,
        *,
        experiment_id: str,
        text: str,
        source: dict[str, Any],
        pipeline: str = "standard",
        kind: str = "video",
        title: str | None = None,
        generation_params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        _require_confirmed_source(source)
        experiment = self._get_experiment_or_raise(experiment_id)
        events = self.store.list_events_for_experiment(experiment_id)
        if not _has_event(events, OpsEventType.PREDICTION_LOCKED):
            raise OpsError("prediction_required", "Content generation requires a locked prediction.")

        operation_context = {
            "project_id": experiment["project_id"],
            "cycle_id": experiment["cycle_id"],
            "experiment_id": experiment_id,
        }
        self.store.append_event(
            project_id=experiment["project_id"],
            cycle_id=experiment["cycle_id"],
            experiment_id=experiment_id,
            event_type=OpsEventType.GENERATION_REQUESTED.value,
            payload={
                "text": text,
                "pipeline": pipeline,
                "operation_context": operation_context,
                "generation_params": generation_params or {},
            },
            source=source,
        )
        self.store.update_experiment_stage(experiment_id, ExperimentStage.GENERATION_REQUESTED.value)

        try:
            asset_ref = await self._run_generation(
                text=text,
                pipeline=pipeline,
                operation_context=operation_context,
                **(generation_params or {}),
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
            title=title or experiment["title"],
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
            **_transition("generation_completed", event, "record_publish"),
            "content_item": content_item,
        }

    def record_publish(
        self,
        *,
        experiment_id: str,
        evidence: dict[str, Any],
        source: dict[str, Any],
        content_item_id: str | None = None,
    ) -> dict[str, Any]:
        _require_confirmed_source(source)
        experiment = self._get_experiment_or_raise(experiment_id)
        if not _has_publish_evidence(evidence):
            raise OpsError("publish_evidence_required", "Publish evidence requires a URL, post id, Buffer id, or API response.")
        event = self.store.append_event(
            project_id=experiment["project_id"],
            cycle_id=experiment["cycle_id"],
            experiment_id=experiment_id,
            content_item_id=content_item_id,
            event_type=OpsEventType.PUBLISH_RECORDED.value,
            payload={"evidence": evidence},
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

    def current_view(self) -> dict[str, Any]:
        view = self.store.get_current_view()
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


def _next_action_for_events(events: list[dict[str, Any]]) -> dict[str, Any]:
    if not _has_event(events, OpsEventType.PREDICTION_LOCKED):
        return {"kind": "lock_prediction", "blocked": False}
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
