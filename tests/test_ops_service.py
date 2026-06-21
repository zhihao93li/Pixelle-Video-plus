from types import SimpleNamespace

import pytest

from ops.service import OpsError, OpsService
from ops.store import OpsStore


def _source(confirmed=True):
    return {"kind": "codex", "confirmed_by_user": confirmed, "skill": "cheat-on-content"}


@pytest.fixture
def service(tmp_path):
    store = OpsStore(tmp_path / "ops.db")
    store.init_db()
    return OpsService(store)


def _seed_experiment(service):
    project = service.create_project(
        name="PetWoods",
        product="PetWoods",
        channel="xiaohongshu",
        source=_source(),
    )
    cycle = service.create_cycle(
        project_id=project["id"],
        name="Launch week",
        goal="Validate demand",
        source=_source(),
    )
    experiment = service.create_experiment(
        project_id=project["id"],
        cycle_id=cycle["id"],
        title="Hook test",
        hypothesis="Specific pain hook wins.",
        source=_source(),
    )
    return project, cycle, experiment


def test_create_cycle_requires_existing_project(service):
    with pytest.raises(OpsError, match="project_not_found"):
        service.create_cycle(
            project_id="missing",
            name="Launch week",
            goal="Validate demand",
            source=_source(),
        )


def test_codex_writes_require_user_confirmation(service):
    with pytest.raises(OpsError, match="source_not_confirmed"):
        service.create_project(
            name="PetWoods",
            product="PetWoods",
            channel="xiaohongshu",
            source=_source(confirmed=False),
        )


@pytest.mark.asyncio
async def test_generation_requires_locked_prediction(service):
    _, _, experiment = _seed_experiment(service)

    with pytest.raises(OpsError, match="prediction_required"):
        await service.request_generation(
            experiment_id=experiment["id"],
            text="Generate a video",
            source=_source(),
        )


@pytest.mark.asyncio
async def test_request_generation_records_context_and_completed_item(tmp_path):
    async def fake_generation_runner(**kwargs):
        return {"path": "output/petwoods.mp4", "input_text": kwargs["text"]}

    store = OpsStore(tmp_path / "ops.db")
    store.init_db()
    service = OpsService(store, generation_runner=fake_generation_runner)
    _, _, experiment = _seed_experiment(service)

    service.lock_prediction(
        experiment_id=experiment["id"],
        prediction={"expected_metric": "save_rate", "expected_direction": "up"},
        source=_source(),
    )
    result = await service.request_generation(
        experiment_id=experiment["id"],
        text="Generate a video",
        source=_source(),
    )

    events = store.list_events_for_experiment(experiment["id"])
    event_types = [event["event_type"] for event in events]

    assert result["content_item"]["status"] == "generated"
    assert result["next_action"]["kind"] == "record_publish"
    assert "generation_requested" in event_types
    assert "generation_completed" in event_types


@pytest.mark.asyncio
async def test_generation_failure_records_event_without_content_item(tmp_path):
    async def failing_generation_runner(**kwargs):
        raise RuntimeError("tts unavailable")

    store = OpsStore(tmp_path / "ops.db")
    store.init_db()
    service = OpsService(store, generation_runner=failing_generation_runner)
    _, _, experiment = _seed_experiment(service)
    service.lock_prediction(
        experiment_id=experiment["id"],
        prediction={"expected_metric": "save_rate"},
        source=_source(),
    )

    with pytest.raises(OpsError, match="generation_failed"):
        await service.request_generation(
            experiment_id=experiment["id"],
            text="Generate a video",
            source=_source(),
        )

    events = store.list_events_for_experiment(experiment["id"])

    assert [event["event_type"] for event in events][-1] == "generation_failed"
    assert store.list_content_items_for_experiment(experiment["id"]) == []


@pytest.mark.asyncio
async def test_invalid_generation_result_is_not_treated_as_success(tmp_path):
    async def invalid_generation_runner(**kwargs):
        return None

    store = OpsStore(tmp_path / "ops.db")
    store.init_db()
    service = OpsService(store, generation_runner=invalid_generation_runner)
    _, _, experiment = _seed_experiment(service)
    service.lock_prediction(
        experiment_id=experiment["id"],
        prediction={"expected_metric": "save_rate"},
        source=_source(),
    )

    with pytest.raises(OpsError, match="generation_failed"):
        await service.request_generation(
            experiment_id=experiment["id"],
            text="Generate a video",
            source=_source(),
        )

    events = store.list_events_for_experiment(experiment["id"])

    assert events[-1]["payload"]["error_type"] == "OpsError"
    assert store.list_content_items_for_experiment(experiment["id"]) == []


@pytest.mark.asyncio
async def test_video_generation_result_like_object_is_normalized(tmp_path):
    async def object_generation_runner(**kwargs):
        return SimpleNamespace(video_path="output/final.mp4", duration=12.5, file_size=2048)

    store = OpsStore(tmp_path / "ops.db")
    store.init_db()
    service = OpsService(store, generation_runner=object_generation_runner)
    _, _, experiment = _seed_experiment(service)
    service.lock_prediction(
        experiment_id=experiment["id"],
        prediction={"expected_metric": "save_rate"},
        source=_source(),
    )

    result = await service.request_generation(
        experiment_id=experiment["id"],
        text="Generate a video",
        source=_source(),
    )

    assert result["content_item"]["asset_ref"] == {
        "video_path": "output/final.mp4",
        "duration": 12.5,
        "file_size": 2048,
    }


def test_publish_requires_real_evidence(service):
    _, _, experiment = _seed_experiment(service)

    with pytest.raises(OpsError, match="publish_evidence_required"):
        service.record_publish(
            experiment_id=experiment["id"],
            evidence={"confirmation_note": "I published it"},
            source=_source(),
        )


def test_metrics_require_published_content(service):
    _, _, experiment = _seed_experiment(service)

    with pytest.raises(OpsError, match="publish_required"):
        service.record_metrics(
            experiment_id=experiment["id"],
            metrics={"views": 100},
            source=_source(),
        )


@pytest.mark.asyncio
async def test_metrics_must_reference_the_published_content_item(tmp_path):
    async def fake_generation_runner(**kwargs):
        return {"path": "output/petwoods.mp4"}

    store = OpsStore(tmp_path / "ops.db")
    store.init_db()
    service = OpsService(store, generation_runner=fake_generation_runner)
    _, _, experiment = _seed_experiment(service)
    service.lock_prediction(
        experiment_id=experiment["id"],
        prediction={"expected_metric": "save_rate"},
        source=_source(),
    )
    generation = await service.request_generation(
        experiment_id=experiment["id"],
        text="Generate a video",
        source=_source(),
    )
    service.record_publish(
        experiment_id=experiment["id"],
        content_item_id=generation["content_item"]["id"],
        evidence={"platform_url": "https://example.com/post/1"},
        source=_source(),
    )

    with pytest.raises(OpsError, match="published_content_required"):
        service.record_metrics(
            experiment_id=experiment["id"],
            content_item_id="item_missing",
            metrics={"views": 100},
            source=_source(),
        )

    result = service.record_metrics(
        experiment_id=experiment["id"],
        content_item_id=generation["content_item"]["id"],
        metrics={"views": 100},
        source=_source(),
    )

    assert result["event"]["content_item_id"] == generation["content_item"]["id"]


def test_retro_without_prediction_is_observation(service):
    _, _, experiment = _seed_experiment(service)

    result = service.write_retro(
        experiment_id=experiment["id"],
        retro={"summary": "Interesting comment pattern."},
        source=_source(),
    )

    assert result["event"]["event_type"] == "observation_written"
