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
