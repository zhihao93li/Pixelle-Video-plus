from ops.store import OpsStore


def _source():
    return {"kind": "codex", "confirmed_by_user": True, "skill": "cheat-on-content"}


def test_store_initializes_entities_events_and_current_view(tmp_path):
    store = OpsStore(tmp_path / "ops.db")
    store.init_db()

    project = store.create_project(
        name="PetWoods",
        product="PetWoods",
        channel="xiaohongshu",
        description="Test operating project",
        source=_source(),
    )
    cycle = store.create_cycle(
        project_id=project["id"],
        name="Launch week",
        goal="Validate demand",
        source=_source(),
    )
    experiment = store.create_experiment(
        project_id=project["id"],
        cycle_id=cycle["id"],
        title="Hook test",
        hypothesis="A specific pain hook will outperform generic cuteness.",
        source=_source(),
    )
    item = store.create_content_item(
        project_id=project["id"],
        cycle_id=cycle["id"],
        experiment_id=experiment["id"],
        kind="video",
        title="PetWoods hook video",
        status="generated",
        asset_ref={"path": "output/video.mp4"},
    )
    event = store.append_event(
        project_id=project["id"],
        cycle_id=cycle["id"],
        experiment_id=experiment["id"],
        content_item_id=item["id"],
        event_type="generation_completed",
        payload={"asset_ref": {"path": "output/video.mp4"}},
        source=_source(),
    )

    events = store.list_events_for_experiment(experiment["id"])
    view = store.get_current_view()

    assert event["id"]
    assert [row["event_type"] for row in events] == ["generation_completed"]
    assert view["project"]["name"] == "PetWoods"
    assert view["cycle"]["name"] == "Launch week"
    assert view["experiment"]["title"] == "Hook test"
    assert view["content_items"][0]["asset_ref"]["path"] == "output/video.mp4"


def test_store_supports_channel_accounts_and_explicit_current_context(tmp_path):
    store = OpsStore(tmp_path / "ops.db")
    store.init_db()

    petwoods = store.create_project(
        name="PetWoods",
        product="PetWoods",
        channel="xiaohongshu",
        source=_source(),
    )
    pet_cycle = store.create_cycle(
        project_id=petwoods["id"],
        name="Pet cycle",
        goal="Grow cat breeding content",
        source=_source(),
    )
    pet_experiment = store.create_experiment(
        project_id=petwoods["id"],
        cycle_id=pet_cycle["id"],
        title="Cat hook",
        hypothesis="Cat hook wins.",
        source=_source(),
    )
    pet_account = store.create_channel_account(
        project_id=petwoods["id"],
        platform="xiaohongshu",
        account_name="PetWoods 宠物森友会",
        source=_source(),
        account_handle="petwoods",
        external_account_id="xhs-petwoods",
        status="connected",
        credential_ref={"provider": "manual"},
    )

    other = store.create_project(
        name="Other Brand",
        product="Other",
        channel="xiaohongshu",
        source=_source(),
    )
    other_cycle = store.create_cycle(
        project_id=other["id"],
        name="Other cycle",
        goal="Avoid mixed context",
        source=_source(),
    )
    store.create_experiment(
        project_id=other["id"],
        cycle_id=other_cycle["id"],
        title="Other hook",
        hypothesis="Other hook wins.",
        source=_source(),
    )

    projects = store.list_projects()
    accounts = store.list_channel_accounts(project_id=petwoods["id"])
    default_view = store.get_current_view()
    pet_view = store.get_current_view(project_id=petwoods["id"])
    account_view = store.get_current_view(channel_account_id=pet_account["id"])

    assert [project["name"] for project in projects] == ["PetWoods", "Other Brand"]
    assert accounts[0]["account_handle"] == "petwoods"
    assert accounts[0]["credential_ref"] == {"provider": "manual"}
    assert default_view["project"]["name"] == "Other Brand"
    assert default_view["context"]["selection"] == "latest_project"
    assert pet_view["project"]["id"] == petwoods["id"]
    assert pet_view["experiment"]["id"] == pet_experiment["id"]
    assert pet_view["channel_accounts"][0]["id"] == pet_account["id"]
    assert pet_view["context"]["selection"] == "explicit_project"
    assert account_view["project"]["id"] == petwoods["id"]
    assert account_view["context"]["channel_account_id"] == pet_account["id"]
    assert account_view["context"]["selection"] == "explicit_channel_account"
