import json
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


def test_generated_experiment_next_action_requires_asset_check(service):
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

    assert view["next_action"]["kind"] == "check_generation_asset"

    with pytest.raises(OpsError, match="asset_check_required"):
        service.record_publish(
            experiment_id=experiment["id"],
            content_item_id=content_item["id"],
            evidence={"platform_url": "https://example.com/post/legacy"},
            source=_source(),
        )


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


def test_channel_account_update_is_configuration_only(service):
    project, _, experiment = _seed_experiment(service)
    account = service.create_channel_account(
        project_id=project["id"],
        platform="xiaohongshu",
        account_name="PetWoods XHS",
        account_handle="petwoods",
        status="configured",
        credential_ref={"provider": "manual", "key": "pixelle/petwoods/xhs"},
        source={"kind": "ui", "surface": "test", "confirmed_by_user": True},
    )

    updated = service.update_channel_account(
        channel_account_id=account["id"],
        platform="douyin",
        account_name="PetWoods Douyin",
        account_handle="petwoods_dy",
        external_account_id="dy-petwoods",
        status="connected",
        credential_ref={"provider": "manual", "key": "pixelle/petwoods/douyin"},
        source={"kind": "ui", "surface": "test", "confirmed_by_user": True},
    )

    assert updated["id"] == account["id"]
    assert updated["platform"] == "douyin"
    assert updated["account_name"] == "PetWoods Douyin"
    assert updated["account_handle"] == "petwoods_dy"
    assert updated["external_account_id"] == "dy-petwoods"
    assert updated["status"] == "connected"
    assert updated["credential_ref"]["key"] == "pixelle/petwoods/douyin"
    assert updated["source"]["kind"] == "ui"
    assert service.store.get_experiment(experiment["id"])["stage"] == experiment["stage"]


def test_channel_account_credential_ref_rejects_plaintext_secret_fields(service):
    project, _, _ = _seed_experiment(service)

    with pytest.raises(OpsError, match="credential_ref_must_be_reference"):
        service.create_channel_account(
            project_id=project["id"],
            platform="xiaohongshu",
            account_name="PetWoods XHS",
            credential_ref={"access_token": "plaintext"},
            source={"kind": "ui", "surface": "test", "confirmed_by_user": True},
        )


def test_service_lists_projects_and_blocks_ambiguous_multi_project_current(service):
    petwoods, pet_cycle, _ = _seed_experiment(service)
    account = service.create_channel_account(
        project_id=petwoods["id"],
        platform="xiaohongshu",
        account_name="PetWoods 宠物森友会",
        source=_source(),
        account_handle="petwoods",
        status="connected",
    )
    other = service.create_project(
        name="Other Brand",
        product="Other",
        channel="xiaohongshu",
        source=_source(),
    )
    other_cycle = service.create_cycle(
        project_id=other["id"],
        name="Other cycle",
        goal="Avoid mixed context",
        source=_source(),
    )
    service.create_experiment(
        project_id=other["id"],
        cycle_id=other_cycle["id"],
        title="Other hook",
        hypothesis="Other hook wins.",
        source=_source(),
    )

    projects = service.list_projects()
    ambiguous = service.current_view()
    selected_project = service.current_view(project_id=petwoods["id"])
    selected_account = service.current_view(channel_account_id=account["id"])

    assert projects["status"] == "ok"
    assert [project["name"] for project in projects["projects"]] == ["PetWoods", "Other Brand"]
    assert projects["projects"][0]["channel_accounts"][0]["account_handle"] == "petwoods"
    assert ambiguous["next_action"] == {
        "kind": "select_project",
        "blocked": True,
        "reason": "multiple_projects",
    }
    assert selected_project["next_action"]["kind"] == "lock_prediction"
    assert selected_project["project"]["id"] == petwoods["id"]
    assert selected_project["cycle"]["id"] == pet_cycle["id"]
    assert selected_account["project"]["id"] == petwoods["id"]
    assert selected_account["context"]["channel_account_id"] == account["id"]


def test_service_blocks_ambiguous_multi_account_current(service):
    petwoods, _, _ = _seed_experiment(service)
    first = service.create_channel_account(
        project_id=petwoods["id"],
        platform="xiaohongshu",
        account_name="PetWoods XHS",
        source=_source(),
        account_handle="petwoods-xhs",
    )
    service.create_channel_account(
        project_id=petwoods["id"],
        platform="douyin",
        account_name="PetWoods Douyin",
        source=_source(),
        account_handle="petwoods-dy",
    )

    ambiguous_default = service.current_view()
    ambiguous_project = service.current_view(project_id=petwoods["id"])
    selected_account = service.current_view(channel_account_id=first["id"])

    assert ambiguous_default["next_action"] == {
        "kind": "select_channel_account",
        "blocked": True,
        "reason": "multiple_accounts",
    }
    assert ambiguous_project["next_action"] == {
        "kind": "select_channel_account",
        "blocked": True,
        "reason": "multiple_accounts",
    }
    assert selected_account["next_action"]["kind"] == "lock_prediction"
    assert selected_account["context"]["channel_account_id"] == first["id"]


def test_channel_account_requires_existing_project(service):
    with pytest.raises(OpsError, match="project_not_found"):
        service.create_channel_account(
            project_id="missing",
            platform="xiaohongshu",
            account_name="Missing",
            source=_source(),
        )


def test_legacy_social_account_methods_remain_compatible(service):
    project, _, _ = _seed_experiment(service)

    account = service.create_social_account(
        project_id=project["id"],
        platform="xiaohongshu",
        account_name="PetWoods legacy alias",
        source=_source(),
    )
    selected = service.current_view(account_id=account["id"])

    assert account["platform"] == "xiaohongshu"
    assert selected["context"]["channel_account_id"] == account["id"]


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
async def test_list_generation_pipelines_returns_selectable_options(tmp_path):
    store = OpsStore(tmp_path / "ops.db")
    store.init_db()
    service = OpsService(
        store,
        available_pipelines=("standard", "custom", "asset_based"),
    )

    result = await service.list_generation_pipelines()

    assert result["status"] == "ok"
    assert result["pipeline_names"] == ["standard", "custom", "asset_based"]
    assert result["default_pipeline"] == "standard"
    assert result["pipelines"][0] == {
        "name": "standard",
        "recommended": True,
        "description": "Default Pixelle generation pipeline.",
    }
    assert result["next_action"]["kind"] == "select_generation_pipeline"


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
async def test_request_generation_uses_approved_draft_as_fixed_script(tmp_path):
    captured_kwargs = {}

    async def fake_generation_runner(**kwargs):
        captured_kwargs.update(kwargs)
        return {"path": "output/petwoods.mp4", "input_text": kwargs["text"]}

    store = OpsStore(tmp_path / "ops.db")
    store.init_db()
    service = OpsService(store, generation_runner=fake_generation_runner)
    _, _, experiment = _seed_experiment(service)
    approved_text = "同一窝小猫，\n可能不是一个爹吗？\n\n答案是：\n真的有可能。"

    service.lock_prediction(
        experiment_id=experiment["id"],
        prediction={"expected_metric": "save_rate"},
        source=_source(),
    )
    draft = service.submit_generation_draft(
        experiment_id=experiment["id"],
        text=approved_text,
        source=_source(),
        pipeline="standard",
    )
    approval = service.approve_generation_draft(
        experiment_id=experiment["id"],
        draft_id=draft["event"]["id"],
        source=_source(),
    )

    await service.request_generation(
        experiment_id=experiment["id"],
        approved_draft_id=approval["event"]["id"],
        source=_source(),
    )

    requested_event = next(
        event
        for event in store.list_events_for_experiment(experiment["id"])
        if event["event_type"] == "generation_requested"
    )
    assert captured_kwargs["text"] == approved_text
    assert captured_kwargs["mode"] == "fixed"
    assert captured_kwargs["split_mode"] == "paragraph"
    assert requested_event["payload"]["generation_params"]["mode"] == "fixed"
    assert requested_event["payload"]["generation_params"]["split_mode"] == "paragraph"


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
async def test_check_generation_asset_fails_when_storyboard_rewrites_approved_text(tmp_path):
    task_dir = tmp_path / "task"
    task_dir.mkdir()
    video_path = task_dir / "final.mp4"
    video_path.write_bytes(b"fake video bytes")
    (task_dir / "storyboard.json").write_text(
        json.dumps(
            {
                "frames": [
                    {"narration": "一窝小猫可能多个爸爸，这是正常现象"},
                    {"narration": "靠肉眼无法判断亲缘，需要检测"},
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    async def fake_generation_runner(**kwargs):
        return {"video_path": str(video_path), "duration": 12.5, "file_size": video_path.stat().st_size}

    store = OpsStore(tmp_path / "ops.db")
    store.init_db()
    service = OpsService(store, generation_runner=fake_generation_runner)
    _, _, experiment = _seed_experiment(service)
    approved_text = "同一窝小猫，\n可能不是一个爹吗？\n\n答案是：\n真的有可能。"
    service.lock_prediction(
        experiment_id=experiment["id"],
        prediction={"expected_metric": "save_rate"},
        source=_source(),
    )
    draft = service.submit_generation_draft(
        experiment_id=experiment["id"],
        text=approved_text,
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

    assert result["event"]["payload"]["status"] == "failed"
    assert result["event"]["payload"]["checks"]["storyboard_text_matches_draft"] is False
    assert result["next_action"]["kind"] == "resolve_asset_issue"


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
async def test_generation_request_allows_retry_after_failed_asset_check(tmp_path):
    attempts = []

    async def fake_generation_runner(**kwargs):
        attempts.append(kwargs)
        video_path = tmp_path / f"retry-{len(attempts)}.mp4"
        video_path.write_bytes(b"fake video bytes")
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
        text="母猫打滚就是想配了吗？\n\n还真不是。",
        source=_source(),
    )
    approval = service.approve_generation_draft(
        experiment_id=experiment["id"],
        draft_id=draft["event"]["id"],
        source=_source(),
    )
    first = await service.request_generation(
        experiment_id=experiment["id"],
        approved_draft_id=approval["event"]["id"],
        source=_source(),
    )
    store.append_event(
        project_id=experiment["project_id"],
        cycle_id=experiment["cycle_id"],
        experiment_id=experiment["id"],
        content_item_id=first["content_item"]["id"],
        event_type="asset_checked",
        payload={"status": "failed", "checks": {"storyboard_text_matches_draft": False}},
        source=_source(),
    )

    second = await service.request_generation(
        experiment_id=experiment["id"],
        approved_draft_id=approval["event"]["id"],
        source=_source(),
    )

    assert len(attempts) == 2
    assert second["content_item"]["id"] != first["content_item"]["id"]
    assert second["next_action"]["kind"] == "check_generation_asset"


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


def test_mock_publish_requires_explicit_mock_label(service):
    _, _, experiment = _seed_experiment(service)

    with pytest.raises(OpsError, match="publish_evidence_required"):
        service.record_publish(
            experiment_id=experiment["id"],
            evidence={"mock": True},
            source=_source(),
        )

    result = service.record_publish(
        experiment_id=experiment["id"],
        evidence={
            "mock": True,
            "mock_label": "P0 closeout smoke publish",
        },
        source=_source(),
    )

    assert result["event"]["payload"]["evidence"]["mock"] is True
    assert result["event"]["payload"]["evidence"]["mock_label"] == "P0 closeout smoke publish"
    assert result["next_action"]["kind"] == "record_metrics"


def test_publish_record_can_target_a_channel_account(service):
    project, _, experiment = _seed_experiment(service)
    account = service.create_channel_account(
        project_id=project["id"],
        platform="youtube",
        account_name="PetWoods YouTube",
        source=_source(),
    )

    result = service.record_publish(
        experiment_id=experiment["id"],
        channel_account_id=account["id"],
        evidence={"platform_url": "https://youtube.com/watch?v=petwoods"},
        source=_source(),
    )

    assert result["event"]["payload"]["channel_account_id"] == account["id"]
    assert result["event"]["payload"]["publication"]["channel_account_id"] == account["id"]


def test_publish_record_rejects_channel_account_from_another_project(service):
    _, _, experiment = _seed_experiment(service)
    other = service.create_project(
        name="Other Brand",
        product="Other",
        channel="youtube",
        source=_source(),
    )
    account = service.create_channel_account(
        project_id=other["id"],
        platform="youtube",
        account_name="Other YouTube",
        source=_source(),
    )

    with pytest.raises(OpsError, match="channel_account_project_mismatch"):
        service.record_publish(
            experiment_id=experiment["id"],
            channel_account_id=account["id"],
            evidence={"platform_url": "https://youtube.com/watch?v=other"},
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


def test_mock_publish_requires_mock_metrics_label(service):
    project, cycle, experiment = _seed_experiment(service)
    content_item = service.store.create_content_item(
        project_id=project["id"],
        cycle_id=cycle["id"],
        experiment_id=experiment["id"],
        kind="video",
        title="P0 mock content",
        status="generated",
        asset_ref={"video_path": "mock://p0-closeout"},
    )
    service.record_publish(
        experiment_id=experiment["id"],
        content_item_id=content_item["id"],
        evidence={
            "mock": True,
            "mock_label": "P0 closeout smoke publish",
        },
        source=_source(),
    )

    with pytest.raises(OpsError, match="mock_metrics_label_required"):
        service.record_metrics(
            experiment_id=experiment["id"],
            content_item_id=content_item["id"],
            metrics={"views": 100},
            source=_source(),
        )

    result = service.record_metrics(
        experiment_id=experiment["id"],
        content_item_id=content_item["id"],
        metrics={
            "mock": True,
            "mock_label": "P0 closeout smoke metrics",
            "views": 100,
        },
        source=_source(),
    )

    assert result["event"]["payload"]["metrics"]["mock"] is True
    assert result["next_action"]["kind"] == "write_retro"


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
