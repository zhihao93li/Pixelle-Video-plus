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


def test_generation_draft_rejects_instruction_wrappers(service):
    _, _, experiment = _seed_experiment(service)
    service.lock_prediction(
        experiment_id=experiment["id"],
        prediction={"expected_metric": "completion_rate"},
        source=_source(),
    )

    with pytest.raises(OpsError, match="generation_draft_invalid"):
        service.submit_generation_draft(
            experiment_id=experiment["id"],
            text=(
                "【视频目标】生成一条适合小红书的短视频。\n"
                "【屏幕字幕版】\n"
                "母猫打滚就是想配了吗？\n还真不是。"
            ),
            source=_source(),
        )


def test_legacy_generated_experiment_next_action_records_publish(service):
    project, cycle, experiment = _seed_experiment(service)
    service.lock_prediction(
        experiment_id=experiment["id"],
        prediction={"expected_metric": "completion_rate"},
        source=_source(),
    )
    content_item = service.store.create_content_item(
        project_id=project["id"],
        cycle_id=cycle["id"],
        experiment_id=experiment["id"],
        kind="video",
        title="Legacy generated video",
        status="generated",
        asset_ref={"video_path": "output/legacy/final.mp4"},
    )
    service.store.append_event(
        project_id=project["id"],
        cycle_id=cycle["id"],
        experiment_id=experiment["id"],
        content_item_id=content_item["id"],
        event_type="generation_completed",
        payload={"asset_ref": {"video_path": "output/legacy/final.mp4"}},
        source=_source(),
    )
    service.store.update_experiment_stage(experiment["id"], "generation_completed")

    view = service.get_experiment_view(experiment["id"])

    assert view["next_action"]["kind"] == "record_publish"


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
            source=_source(),
        )


@pytest.mark.asyncio
async def test_unknown_generation_pipeline_is_rejected_before_request_event(tmp_path):
    async def fake_generation_runner(**kwargs):
        raise AssertionError("generation runner should not be called for an unknown pipeline")

    store = OpsStore(tmp_path / "ops.db")
    store.init_db()
    service = OpsService(
        store,
        generation_runner=fake_generation_runner,
        available_pipelines=("standard", "custom", "asset_based"),
    )
    _, _, experiment = _seed_experiment(service)
    service.lock_prediction(
        experiment_id=experiment["id"],
        prediction={"expected_metric": "save_rate"},
        source=_source(),
    )
    draft = service.submit_generation_draft(
        experiment_id=experiment["id"],
        text="Generate a video",
        pipeline="xhs_short_video_v1",
        source=_source(),
    )
    approval = service.approve_generation_draft(
        experiment_id=experiment["id"],
        draft_id=draft["event"]["id"],
        source=_source(),
    )

    with pytest.raises(OpsError, match="unknown_generation_pipeline"):
        await service.request_generation(
            experiment_id=experiment["id"],
            approved_draft_id=approval["event"]["id"],
            source=_source(),
        )

    event_types = [event["event_type"] for event in store.list_events_for_experiment(experiment["id"])]

    assert event_types == ["prediction_locked", "generation_drafted", "generation_draft_approved"]
    assert store.get_experiment(experiment["id"])["stage"] == "prediction_locked"
    assert store.list_content_items_for_experiment(experiment["id"]) == []


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
    draft = service.submit_generation_draft(
        experiment_id=experiment["id"],
        text="Generate a video",
        source=_source(),
    )
    approval = service.approve_generation_draft(
        experiment_id=experiment["id"],
        draft_id=draft["event"]["id"],
        source=_source(),
    )
    result = await service.request_generation(
        experiment_id=experiment["id"],
        approved_draft_id=approval["event"]["id"],
        source=_source(),
    )

    events = store.list_events_for_experiment(experiment["id"])
    event_types = [event["event_type"] for event in events]

    assert result["content_item"]["status"] == "generated"
    assert result["next_action"]["kind"] == "check_generation_asset"
    assert "generation_drafted" in event_types
    assert "generation_draft_approved" in event_types
    assert "generation_requested" in event_types
    assert "generation_completed" in event_types


@pytest.mark.asyncio
async def test_request_generation_can_start_without_waiting_for_completion(tmp_path):
    async def fake_generation_runner(**kwargs):
        raise AssertionError("generation runner should not be called when wait_for_completion is false")

    store = OpsStore(tmp_path / "ops.db")
    store.init_db()
    service = OpsService(store, generation_runner=fake_generation_runner)
    _, _, experiment = _seed_experiment(service)
    service.lock_prediction(
        experiment_id=experiment["id"],
        prediction={"expected_metric": "save_rate"},
        source=_source(),
    )
    draft = service.submit_generation_draft(
        experiment_id=experiment["id"],
        text="Generate a video",
        source=_source(),
    )
    approval = service.approve_generation_draft(
        experiment_id=experiment["id"],
        draft_id=draft["event"]["id"],
        source=_source(),
    )

    result = await service.request_generation(
        experiment_id=experiment["id"],
        approved_draft_id=approval["event"]["id"],
        source=_source(),
        wait_for_completion=False,
    )
    status = service.get_generation_status(experiment["id"])

    assert result["entity"]["stage"] == "generation_requested"
    assert result["next_action"]["kind"] == "check_generation_status"
    assert status["status"] == "running"
    assert status["next_action"]["kind"] == "check_generation_status"
    assert store.list_content_items_for_experiment(experiment["id"]) == []


@pytest.mark.asyncio
async def test_complete_generation_request_records_asset_and_status(tmp_path):
    async def fake_generation_runner(**kwargs):
        return {"video_path": "output/petwoods.mp4", "duration": 12.5, "file_size": 2048}

    store = OpsStore(tmp_path / "ops.db")
    store.init_db()
    service = OpsService(store, generation_runner=fake_generation_runner)
    _, _, experiment = _seed_experiment(service)
    service.lock_prediction(
        experiment_id=experiment["id"],
        prediction={"expected_metric": "save_rate"},
        source=_source(),
    )
    draft = service.submit_generation_draft(
        experiment_id=experiment["id"],
        text="Generate a video",
        source=_source(),
    )
    approval = service.approve_generation_draft(
        experiment_id=experiment["id"],
        draft_id=draft["event"]["id"],
        source=_source(),
    )
    requested = await service.request_generation(
        experiment_id=experiment["id"],
        approved_draft_id=approval["event"]["id"],
        source=_source(),
        wait_for_completion=False,
    )

    completed = await service.complete_generation_request(
        experiment_id=experiment["id"],
        generation_event_id=requested["event"]["id"],
        source=_source(),
    )
    status = service.get_generation_status(experiment["id"])

    assert completed["content_item"]["asset_ref"]["video_path"] == "output/petwoods.mp4"
    assert completed["next_action"]["kind"] == "check_generation_asset"
    assert status["status"] == "completed"
    assert status["content_item"]["id"] == completed["content_item"]["id"]


@pytest.mark.asyncio
async def test_check_generation_asset_records_passed_result(tmp_path):
    video_path = tmp_path / "final.mp4"
    video_path.write_bytes(b"fake video bytes")

    async def fake_generation_runner(**kwargs):
        return {"video_path": str(video_path), "duration": 12.5, "file_size": video_path.stat().st_size}

    store = OpsStore(tmp_path / "ops.db")
    store.init_db()
    service = OpsService(store, generation_runner=fake_generation_runner)
    _, _, experiment = _seed_experiment(service)
    service.lock_prediction(
        experiment_id=experiment["id"],
        prediction={"expected_metric": "save_rate"},
        source=_source(),
    )
    draft = service.submit_generation_draft(
        experiment_id=experiment["id"],
        text="Generate a video",
        source=_source(),
    )
    approval = service.approve_generation_draft(
        experiment_id=experiment["id"],
        draft_id=draft["event"]["id"],
        source=_source(),
    )
    generation = await service.request_generation(
        experiment_id=experiment["id"],
        approved_draft_id=approval["event"]["id"],
        source=_source(),
    )

    result = service.check_generation_asset(
        experiment_id=experiment["id"],
        content_item_id=generation["content_item"]["id"],
        source=_source(),
    )
    view = service.get_experiment_view(experiment["id"])

    assert result["event"]["event_type"] == "asset_checked"
    assert result["event"]["payload"]["status"] == "passed"
    assert result["event"]["payload"]["checks"]["local_file_exists"] is True
    assert result["event"]["payload"]["checks"]["draft_text_clean"] is True
    assert result["next_action"]["kind"] == "record_publish"
    assert view["next_action"]["kind"] == "record_publish"


@pytest.mark.asyncio
async def test_generation_requires_an_approved_draft(tmp_path):
    async def fake_generation_runner(**kwargs):
        raise AssertionError("generation runner should not be called before draft approval")

    store = OpsStore(tmp_path / "ops.db")
    store.init_db()
    service = OpsService(store, generation_runner=fake_generation_runner)
    _, _, experiment = _seed_experiment(service)
    service.lock_prediction(
        experiment_id=experiment["id"],
        prediction={"expected_metric": "save_rate"},
        source=_source(),
    )
    draft = service.submit_generation_draft(
        experiment_id=experiment["id"],
        text="Generate a video",
        source=_source(),
    )

    with pytest.raises(OpsError, match="approved_draft_required"):
        await service.request_generation(
            experiment_id=experiment["id"],
            source=_source(),
        )
    with pytest.raises(OpsError, match="approved_draft_required"):
        await service.request_generation(
            experiment_id=experiment["id"],
            approved_draft_id=draft["event"]["id"],
            source=_source(),
        )

    event_types = [event["event_type"] for event in store.list_events_for_experiment(experiment["id"])]

    assert event_types == ["prediction_locked", "generation_drafted"]
    assert store.list_content_items_for_experiment(experiment["id"]) == []


@pytest.mark.asyncio
async def test_generation_request_blocks_duplicate_in_progress_event(tmp_path):
    async def fake_generation_runner(**kwargs):
        raise AssertionError("generation runner should not be called while generation is already in progress")

    store = OpsStore(tmp_path / "ops.db")
    store.init_db()
    service = OpsService(store, generation_runner=fake_generation_runner)
    project, cycle, experiment = _seed_experiment(service)
    service.lock_prediction(
        experiment_id=experiment["id"],
        prediction={"expected_metric": "save_rate"},
        source=_source(),
    )
    draft = service.submit_generation_draft(
        experiment_id=experiment["id"],
        text="母猫打滚就是想配了吗？\n还真不是。",
        source=_source(),
    )
    approval = service.approve_generation_draft(
        experiment_id=experiment["id"],
        draft_id=draft["event"]["id"],
        source=_source(),
    )
    store.append_event(
        project_id=project["id"],
        cycle_id=cycle["id"],
        experiment_id=experiment["id"],
        event_type="generation_requested",
        payload={"text": "already running"},
        source=_source(),
    )

    with pytest.raises(OpsError, match="generation_in_progress"):
        await service.request_generation(
            experiment_id=experiment["id"],
            approved_draft_id=approval["event"]["id"],
            source=_source(),
        )


@pytest.mark.asyncio
async def test_generation_request_blocks_completed_experiment(tmp_path):
    async def fake_generation_runner(**kwargs):
        raise AssertionError("generation runner should not be called after generation completed")

    store = OpsStore(tmp_path / "ops.db")
    store.init_db()
    service = OpsService(store, generation_runner=fake_generation_runner)
    project, cycle, experiment = _seed_experiment(service)
    service.lock_prediction(
        experiment_id=experiment["id"],
        prediction={"expected_metric": "save_rate"},
        source=_source(),
    )
    draft = service.submit_generation_draft(
        experiment_id=experiment["id"],
        text="母猫打滚就是想配了吗？\n还真不是。",
        source=_source(),
    )
    approval = service.approve_generation_draft(
        experiment_id=experiment["id"],
        draft_id=draft["event"]["id"],
        source=_source(),
    )
    store.append_event(
        project_id=project["id"],
        cycle_id=cycle["id"],
        experiment_id=experiment["id"],
        event_type="generation_completed",
        payload={"asset_ref": {"video_path": "output/final.mp4"}},
        source=_source(),
    )

    with pytest.raises(OpsError, match="generation_already_completed"):
        await service.request_generation(
            experiment_id=experiment["id"],
            approved_draft_id=approval["event"]["id"],
            source=_source(),
        )


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
    draft = service.submit_generation_draft(
        experiment_id=experiment["id"],
        text="Generate a video",
        source=_source(),
    )
    approval = service.approve_generation_draft(
        experiment_id=experiment["id"],
        draft_id=draft["event"]["id"],
        source=_source(),
    )

    with pytest.raises(OpsError, match="generation_failed"):
        await service.request_generation(
            experiment_id=experiment["id"],
            approved_draft_id=approval["event"]["id"],
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
    draft = service.submit_generation_draft(
        experiment_id=experiment["id"],
        text="Generate a video",
        source=_source(),
    )
    approval = service.approve_generation_draft(
        experiment_id=experiment["id"],
        draft_id=draft["event"]["id"],
        source=_source(),
    )

    with pytest.raises(OpsError, match="generation_failed"):
        await service.request_generation(
            experiment_id=experiment["id"],
            approved_draft_id=approval["event"]["id"],
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
    draft = service.submit_generation_draft(
        experiment_id=experiment["id"],
        text="Generate a video",
        source=_source(),
    )
    approval = service.approve_generation_draft(
        experiment_id=experiment["id"],
        draft_id=draft["event"]["id"],
        source=_source(),
    )

    result = await service.request_generation(
        experiment_id=experiment["id"],
        approved_draft_id=approval["event"]["id"],
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


@pytest.mark.asyncio
async def test_publish_requires_passed_asset_check_for_new_generation(tmp_path):
    video_path = tmp_path / "final.mp4"
    video_path.write_bytes(b"fake video bytes")

    async def fake_generation_runner(**kwargs):
        return {"path": str(video_path), "file_size": video_path.stat().st_size}

    store = OpsStore(tmp_path / "ops.db")
    store.init_db()
    service = OpsService(store, generation_runner=fake_generation_runner)
    _, _, experiment = _seed_experiment(service)
    service.lock_prediction(
        experiment_id=experiment["id"],
        prediction={"expected_metric": "save_rate"},
        source=_source(),
    )
    draft = service.submit_generation_draft(
        experiment_id=experiment["id"],
        text="Generate a video",
        source=_source(),
    )
    approval = service.approve_generation_draft(
        experiment_id=experiment["id"],
        draft_id=draft["event"]["id"],
        source=_source(),
    )
    generation = await service.request_generation(
        experiment_id=experiment["id"],
        approved_draft_id=approval["event"]["id"],
        source=_source(),
    )

    with pytest.raises(OpsError, match="asset_check_required"):
        service.record_publish(
            experiment_id=experiment["id"],
            content_item_id=generation["content_item"]["id"],
            evidence={"platform_url": "https://example.com/post/1"},
            source=_source(),
        )

    service.check_generation_asset(
        experiment_id=experiment["id"],
        content_item_id=generation["content_item"]["id"],
        source=_source(),
    )
    result = service.record_publish(
        experiment_id=experiment["id"],
        content_item_id=generation["content_item"]["id"],
        evidence={"platform_url": "https://example.com/post/1"},
        source=_source(),
    )

    assert result["next_action"]["kind"] == "record_metrics"


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
    video_path = tmp_path / "petwoods.mp4"

    async def fake_generation_runner(**kwargs):
        video_path.write_bytes(b"fake video bytes")
        return {"path": str(video_path), "file_size": video_path.stat().st_size}

    store = OpsStore(tmp_path / "ops.db")
    store.init_db()
    service = OpsService(store, generation_runner=fake_generation_runner)
    _, _, experiment = _seed_experiment(service)
    service.lock_prediction(
        experiment_id=experiment["id"],
        prediction={"expected_metric": "save_rate"},
        source=_source(),
    )
    draft = service.submit_generation_draft(
        experiment_id=experiment["id"],
        text="Generate a video",
        source=_source(),
    )
    approval = service.approve_generation_draft(
        experiment_id=experiment["id"],
        draft_id=draft["event"]["id"],
        source=_source(),
    )
    generation = await service.request_generation(
        experiment_id=experiment["id"],
        approved_draft_id=approval["event"]["id"],
        source=_source(),
    )
    service.check_generation_asset(
        experiment_id=experiment["id"],
        content_item_id=generation["content_item"]["id"],
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
