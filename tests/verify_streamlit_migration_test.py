import json
import subprocess
from pathlib import Path
from types import SimpleNamespace

from scripts.verify_streamlit_migration import (
    ASSET_MONTAGE_TEMPLATE_IDS,
    BROWSER_SMOKE_SCRIPT,
    STREAMLIT_COMPLETION_REQUIRED_CHECKS,
    Check,
    RealGenerationAssetPaths,
    SPECIAL_PIPELINE_TEMPLATE_IDS,
    build_external_e2e_plan,
    build_streamlit_completion_gate,
    build_real_template_input,
    check_capability_matrix,
    classify_batch_blocker,
    classify_task_blocker,
    missing_dict_paths,
    poll_generation_task_result,
    run_existing_generation_task_check,
    run_existing_real_template_check,
    run_local_render_smoke_check,
    run_browser_smoke_check,
    run_management_readiness_check,
    run_provider_readiness_check,
    run_provider_task_status_check,
    run_publish_readiness_check,
    run_real_batch_check,
    run_real_template_check,
    run_real_publish_e2e_check,
    run_real_script_review_check,
    run_script_review_submit_only_check,
    resolve_real_template_ids,
)


class FakeTemplateClient:
    def get(self, path):
        assert path == "/api/generation/templates"
        return FakeTemplateResponse()


class FakeTemplateResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {
            "templates": [
                {"id": "petwoods_xhs_daily_v1", "enabled": True},
                {"id": "petwoods_xhs_static_subtitle_v1", "enabled": True},
                {"id": "pixelle_script_review_v1", "enabled": False},
                {"id": "pixelle_i2v_basic_v1", "enabled": True},
            ]
        }


class FakeJsonResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.text = str(payload)

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)


def complete_settings_config_payload():
    return {
        "llm": {
            "api_key": "",
            "base_url": "https://aihubmix.com/v1",
            "model": "",
        },
        "comfyui": {
            "comfyui_url": "http://127.0.0.1:8188",
            "comfyui_api_key": None,
            "runninghub_api_key": None,
            "runninghub_concurrent_limit": 1,
            "runninghub_instance_type": None,
            "runninghub_timeout": 600,
            "tts": {
                "inference_mode": "local",
                "fish_audio": {
                    "api_key": "",
                    "base_url": "https://api.fish.audio",
                    "model": "s2-pro",
                    "reference_id": None,
                },
            },
        },
        "publish": {
            "buffer": {
                "api_key": "",
                "channels": {
                    "youtube": "",
                    "tiktok": "",
                    "instagram": "",
                    "x": "",
                    "pinterest": "",
                },
            },
            "cos": {
                "region": "",
                "bucket": "",
                "secret_id": "",
                "secret_key": "",
                "public_base_url": "",
                "endpoint_url": None,
            },
        },
    }


def complete_settings_diagnostics_payload():
    return {
        "ok": True,
        "checks": [
            {"id": "llm_config", "ok": True, "message": "ok"},
            {"id": "ffmpeg", "ok": True, "message": "ok"},
            {"id": "runninghub_config", "ok": True, "message": "ok"},
            {"id": "runninghub_timeout", "ok": True, "message": "ok"},
            {"id": "comfyui_config", "ok": True, "message": "ok"},
            {"id": "fish_audio_config", "ok": True, "message": "ok"},
            {"id": "default_image_workflow", "ok": True, "message": "ok"},
            {"id": "default_video_workflow", "ok": True, "message": "ok"},
            {"id": "buffer_publish", "ok": True, "message": "ok"},
            {"id": "cos_publish", "ok": True, "message": "ok"},
        ],
    }


def test_resolve_real_template_ids_defaults_to_daily_only():
    assert resolve_real_template_ids(
        FakeTemplateClient(),
        explicit_template_ids=[],
        run_default=True,
        run_all_enabled=False,
    ) == ["petwoods_xhs_daily_v1"]


def test_resolve_real_template_ids_dedupes_explicit_templates():
    assert resolve_real_template_ids(
        FakeTemplateClient(),
        explicit_template_ids=[
            "pixelle_i2v_basic_v1",
            "pixelle_i2v_basic_v1",
            "petwoods_xhs_daily_v1",
        ],
        run_default=False,
        run_all_enabled=False,
    ) == ["pixelle_i2v_basic_v1", "petwoods_xhs_daily_v1"]


def test_resolve_real_template_ids_can_select_all_enabled_templates():
    assert resolve_real_template_ids(
        FakeTemplateClient(),
        explicit_template_ids=[],
        run_default=False,
        run_all_enabled=True,
        run_special_pipelines=False,
    ) == [
        "petwoods_xhs_daily_v1",
        "petwoods_xhs_static_subtitle_v1",
        "pixelle_i2v_basic_v1",
    ]


def test_resolve_real_template_ids_can_select_special_pipeline_group():
    assert SPECIAL_PIPELINE_TEMPLATE_IDS == [
        "pixelle_i2v_basic_v1",
        "pixelle_action_transfer_basic_v1",
        "pixelle_digital_human_basic_v1",
    ]
    assert resolve_real_template_ids(
        FakeTemplateClient(),
        explicit_template_ids=["petwoods_xhs_daily_v1"],
        run_default=False,
        run_all_enabled=False,
        run_special_pipelines=True,
    ) == [
        "petwoods_xhs_daily_v1",
        "pixelle_i2v_basic_v1",
        "pixelle_action_transfer_basic_v1",
        "pixelle_digital_human_basic_v1",
    ]


def test_resolve_real_template_ids_can_select_asset_montage_group():
    assert ASSET_MONTAGE_TEMPLATE_IDS == [
        "petwoods_xhs_asset_enhanced_v1",
        "petwoods_xhs_real_material_montage_v1",
    ]
    assert resolve_real_template_ids(
        FakeTemplateClient(),
        explicit_template_ids=["petwoods_xhs_asset_enhanced_v1"],
        run_default=False,
        run_all_enabled=False,
        run_special_pipelines=False,
        run_asset_pipelines=True,
    ) == [
        "petwoods_xhs_asset_enhanced_v1",
        "petwoods_xhs_real_material_montage_v1",
    ]


def test_build_real_template_input_covers_enabled_template_shapes(tmp_path):
    image = tmp_path / "cat.jpg"
    image.write_bytes(b"fake-image")
    video = tmp_path / "reference.mp4"
    video.write_bytes(b"fake-video")
    assets = RealGenerationAssetPaths(image=image, reference_video=video)

    assert build_real_template_input("petwoods_xhs_daily_v1", assets)["script"]
    assert build_real_template_input("petwoods_xhs_static_subtitle_v1", assets)["script"]
    assert build_real_template_input("petwoods_xhs_topic_to_video_v1", assets)["topic"]
    assert build_real_template_input("petwoods_xhs_quality_explainer_v1", assets)["script"]

    asset_input = build_real_template_input("petwoods_xhs_asset_enhanced_v1", assets)
    assert asset_input["assets"] == [str(image)]
    assert asset_input["duration"] == 6

    montage_input = build_real_template_input(
        "petwoods_xhs_real_material_montage_v1",
        assets,
    )
    assert montage_input["assets"] == [str(image)]
    assert montage_input["intent"]

    i2v_input = build_real_template_input("pixelle_i2v_basic_v1", assets)
    assert i2v_input["assets"] == [str(image)]
    assert i2v_input["prompt"]

    action_input = build_real_template_input(
        "pixelle_action_transfer_basic_v1",
        assets,
    )
    assert action_input["reference_video"] == str(video)
    assert action_input["assets"] == [str(image)]

    digital_input = build_real_template_input("pixelle_digital_human_basic_v1", assets)
    assert digital_input["character_assets"] == [str(image)]
    assert digital_input["script"]


def test_build_real_template_input_rejects_unregistered_dedicated_template(tmp_path):
    image = tmp_path / "cat.jpg"
    image.write_bytes(b"fake-image")

    try:
        build_real_template_input(
            "pixelle_script_review_v1",
            RealGenerationAssetPaths(image=Path(image)),
        )
    except ValueError as exc:
        assert "Dedicated product entries" in str(exc)
    else:
        raise AssertionError("Expected dedicated template to require dedicated support")


def test_run_real_batch_check_uses_persisted_batch_route():
    class FakeBatchClient:
        def __init__(self):
            self.calls = []

        def post(self, path, json):
            self.calls.append(("POST", path, json))
            assert path == "/api/generation/batches"
            return FakeJsonResponse({"batch_id": "batch-1"})

        def get(self, path):
            self.calls.append(("GET", path, None))
            if path == "/api/generation/batches/batch-1":
                return FakeJsonResponse(
                    {
                        "batch_id": "batch-1",
                        "items": [{"task_id": "task-1", "status": "completed"}],
                    }
                )
            if path == "/api/generation/tasks/task-1/result":
                return FakeJsonResponse({"primary_video": {"path": "/tmp/out.mp4"}})
            raise AssertionError(path)

        def delete(self, path):
            self.calls.append(("DELETE", path, None))
            return FakeJsonResponse({})

    client = FakeBatchClient()

    check = run_real_batch_check(client, timeout_seconds=1, poll_interval=0)

    assert check.ok is True
    assert client.calls[0][0:2] == ("POST", "/api/generation/batches")
    assert client.calls[0][2]["template_id"] == "petwoods_xhs_static_subtitle_v1"
    assert client.calls[0][2]["items"][0]["input"]["script"]
    assert client.calls[0][2]["items"][0]["metadata"]["provider_e2e"] is False


def test_run_local_render_smoke_uses_static_template_override():
    class FakeLocalRenderClient:
        def __init__(self):
            self.calls = []

        def post(self, path, json):
            self.calls.append(("POST", path, json))
            assert path == "/api/generation/templates/petwoods_xhs_static_subtitle_v1/tasks"
            return FakeJsonResponse({"generation_task_id": "task-1"})

        def get(self, path):
            self.calls.append(("GET", path, None))
            if path == "/api/generation/tasks/task-1":
                return FakeJsonResponse({"task_id": "task-1", "status": "completed"})
            if path == "/api/generation/tasks/task-1/result":
                return FakeJsonResponse({"primary_video": {"path": "/tmp/out.mp4"}})
            raise AssertionError(path)

        def delete(self, path):
            self.calls.append(("DELETE", path, None))
            return FakeJsonResponse({})

    client = FakeLocalRenderClient()

    check = run_local_render_smoke_check(client, timeout_seconds=1, poll_interval=0)

    assert check.ok is True
    assert "frame_template" not in client.calls[0][2]["input"]
    assert client.calls[0][2]["metadata"]["provider_e2e"] is False


def test_poll_generation_task_result_can_leave_task_running_on_timeout():
    class FakeRunningClient:
        def __init__(self):
            self.deleted = []
            self.gets = []

        def get(self, path):
            self.gets.append(path)
            return FakeJsonResponse({"task_id": "task-1", "status": "running"})

        def delete(self, path):
            self.deleted.append(path)
            return FakeJsonResponse({})

    client = FakeRunningClient()

    check = poll_generation_task_result(
        client,
        name="long_provider_e2e",
        task_id="task-1",
        timeout_seconds=0.001,
        poll_interval=0.01,
        cancel_on_timeout=False,
    )

    assert check.ok is False
    assert "task left running" in check.detail
    assert check.data["cancelled_on_timeout"] is False
    assert client.gets == ["/api/generation/tasks/task-1"]
    assert client.deleted == []


def test_poll_generation_task_result_cancels_by_default_on_timeout():
    class FakeRunningClient:
        def __init__(self):
            self.deleted = []

        def get(self, path):
            return FakeJsonResponse({"task_id": "task-1", "status": "running"})

        def delete(self, path):
            self.deleted.append(path)
            return FakeJsonResponse({})

    client = FakeRunningClient()

    check = poll_generation_task_result(
        client,
        name="short_smoke",
        task_id="task-1",
        timeout_seconds=0.001,
        poll_interval=0.01,
    )

    assert check.ok is False
    assert "task cancelled" in check.detail
    assert check.data["cancelled_on_timeout"] is True
    assert client.deleted == ["/api/generation/tasks/task-1"]


def test_run_existing_generation_task_check_never_cancels_existing_task():
    class FakeExistingTaskClient:
        def __init__(self):
            self.deleted = []

        def get(self, path):
            assert path == "/api/generation/tasks/task-1"
            return FakeJsonResponse({"task_id": "task-1", "status": "running"})

        def delete(self, path):
            self.deleted.append(path)
            return FakeJsonResponse({})

    client = FakeExistingTaskClient()

    check = run_existing_generation_task_check(
        client,
        task_id="task-1",
        timeout_seconds=0.001,
        poll_interval=0.01,
    )

    assert check.ok is False
    assert check.name == "existing_generation_task"
    assert "task left running" in check.detail
    assert client.deleted == []


def test_run_existing_generation_task_check_rejects_blank_task_id():
    class FakeExistingTaskClient:
        def get(self, path):
            raise AssertionError(path)

    check = run_existing_generation_task_check(
        FakeExistingTaskClient(),
        task_id=" ",
        timeout_seconds=1,
        poll_interval=0,
    )

    assert check.ok is False
    assert check.detail == "no generation task id provided"


def test_run_existing_real_template_check_counts_as_template_e2e_without_cancel():
    class FakeExistingRealTemplateClient:
        def __init__(self):
            self.deleted = []

        def get(self, path):
            if path == "/api/generation/tasks/task-1":
                return FakeJsonResponse({"task_id": "task-1", "status": "completed"})
            if path == "/api/generation/tasks/task-1/result":
                return FakeJsonResponse({"primary_video": {"path": "/tmp/out.mp4"}})
            raise AssertionError(path)

        def delete(self, path):
            self.deleted.append(path)
            return FakeJsonResponse({})

    client = FakeExistingRealTemplateClient()

    check = run_existing_real_template_check(
        client,
        spec="petwoods_xhs_daily_v1:task-1",
        timeout_seconds=1,
        poll_interval=0,
    )

    assert check.ok is True
    assert check.name == "real_generation_petwoods_xhs_daily_v1"
    assert check.data["template_id"] == "petwoods_xhs_daily_v1"
    assert check.data["resumed_existing_task"] is True
    assert check.data["task_id"] == "task-1"
    assert client.deleted == []


def test_run_existing_real_template_check_rejects_malformed_spec():
    class FakeExistingRealTemplateClient:
        def get(self, path):
            raise AssertionError(path)

    check = run_existing_real_template_check(
        FakeExistingRealTemplateClient(),
        spec="task-1",
        timeout_seconds=1,
        poll_interval=0,
    )

    assert check.ok is False
    assert check.name == "existing_real_template"
    assert check.detail == "expected TEMPLATE_ID:TASK_ID"


def test_run_existing_real_template_check_rejects_dedicated_entries():
    class FakeExistingRealTemplateClient:
        def get(self, path):
            raise AssertionError(path)

    check = run_existing_real_template_check(
        FakeExistingRealTemplateClient(),
        spec="pixelle_script_review_v1:task-1",
        timeout_seconds=1,
        poll_interval=0,
    )

    assert check.ok is False
    assert check.name == "real_generation_pixelle_script_review_v1"
    assert "dedicated batch/script-review entries" in check.detail


def test_run_real_template_check_timeout_includes_resume_command(tmp_path):
    class FakeRealTemplateClient:
        def __init__(self):
            self.deleted = []

        def post(self, path, json):
            assert path == "/api/generation/templates/petwoods_xhs_static_subtitle_v1/tasks"
            return FakeJsonResponse({"generation_task_id": "task-1"})

        def get(self, path):
            assert path == "/api/generation/tasks/task-1"
            return FakeJsonResponse(
                {
                    "task_id": "task-1",
                    "status": "running",
                    "progress": {
                        "stage": "frame_step",
                        "detail": {"action": "media", "provider_status": "QUEUED"},
                    },
                }
            )

        def delete(self, path):
            self.deleted.append(path)
            return FakeJsonResponse({})

    image = tmp_path / "cat.jpg"
    image.write_bytes(b"fake-image")
    client = FakeRealTemplateClient()

    check = run_real_template_check(
        client,
        template_id="petwoods_xhs_static_subtitle_v1",
        asset_paths=RealGenerationAssetPaths(image=image),
        timeout_seconds=0.001,
        poll_interval=0.01,
        cancel_on_timeout=False,
    )

    assert check.ok is False
    assert "task left running" in check.detail
    assert check.data["resume_command"] == (
        "uv run python scripts/verify_streamlit_migration.py "
        "--existing-real-template petwoods_xhs_static_subtitle_v1:task-1 "
        "--timeout 0.001 --poll-interval 0.01"
    )
    assert client.deleted == []


def test_classify_task_blocker_distinguishes_provider_success_from_queue():
    task = {
        "progress": {
            "stage": "frame_step",
            "detail": {
                "action": "media",
                "provider_task_id": "rh-task-1",
                "provider_status": "SUCCESS",
            },
        }
    }

    assert classify_task_blocker(task) == "local_result_continuation_or_composition"


def test_run_real_script_review_check_uses_dedicated_draft_and_submit_routes():
    class FakeScriptReviewClient:
        def __init__(self):
            self.calls = []

        def post(self, path, json):
            self.calls.append(("POST", path, json))
            if path == "/api/generation/script-review/draft-sets":
                return FakeJsonResponse(
                    {
                        "draft_set_id": "draft-set-1",
                        "status": "drafted",
                        "drafts": [
                            {
                                "topic": "Cat hydration",
                                "selected_for_generation": True,
                                "language_drafts": {
                                    "Chinese": {
                                        "title": "猫咪喝水",
                                        "script": "猫咪喝水很重要。",
                                        "narrations": ["猫咪喝水很重要。"],
                                    }
                                },
                                "selected_languages": ["Chinese"],
                            }
                        ],
                    }
                )
            if path == "/api/generation/script-review/draft-sets/draft-set-1/tasks":
                return FakeJsonResponse({"batch": {"batch_id": "batch-1"}})
            raise AssertionError(path)

        def get(self, path):
            self.calls.append(("GET", path, None))
            if path == "/api/generation/batches/batch-1":
                return FakeJsonResponse(
                    {
                        "batch_id": "batch-1",
                        "items": [{"task_id": "task-1", "status": "completed"}],
                    }
                )
            if path == "/api/generation/tasks/task-1/result":
                return FakeJsonResponse({"artifacts": [{"path": "/tmp/out.mp4"}]})
            raise AssertionError(path)

        def delete(self, path):
            self.calls.append(("DELETE", path, None))
            return FakeJsonResponse({})

    client = FakeScriptReviewClient()

    check = run_real_script_review_check(client, timeout_seconds=1, poll_interval=0)

    assert check.ok is True
    assert client.calls[0][0:2] == (
        "POST",
        "/api/generation/script-review/draft-sets",
    )
    assert client.calls[1][0:2] == (
        "POST",
        "/api/generation/script-review/draft-sets/draft-set-1/tasks",
    )
    assert (
        client.calls[1][2]["base_params"]["frame_template"]
        == "1080x1920/static_default.html"
    )


def test_run_script_review_submit_only_uses_existing_draft_without_creating_llm_draft():
    class FakeScriptReviewSubmitOnlyClient:
        def __init__(self):
            self.calls = []

        def get(self, path):
            self.calls.append(("GET", path, None))
            if path == "/api/generation/script-review/draft-sets/draft-set-1":
                return FakeJsonResponse(
                    {
                        "draft_set_id": "draft-set-1",
                        "status": "submitted",
                        "drafts": [
                            {
                                "topic": "Cat hydration",
                                "selected_for_generation": True,
                                "language_drafts": {
                                    "Chinese": {
                                        "title": "猫咪喝水",
                                        "script": "猫咪喝水很重要。",
                                        "narrations": ["猫咪喝水很重要。"],
                                    }
                                },
                                "selected_languages": ["Chinese"],
                            }
                        ],
                    }
                )
            if path == "/api/generation/batches/batch-1":
                return FakeJsonResponse(
                    {
                        "batch_id": "batch-1",
                        "items": [{"task_id": "task-1", "status": "completed"}],
                    }
                )
            if path == "/api/generation/tasks/task-1/result":
                return FakeJsonResponse({"primary_video": {"path": "/tmp/out.mp4"}})
            raise AssertionError(path)

        def post(self, path, json):
            self.calls.append(("POST", path, json))
            if path == "/api/generation/script-review/draft-sets/draft-set-1/tasks":
                return FakeJsonResponse({"batch": {"batch_id": "batch-1"}})
            raise AssertionError(path)

        def delete(self, path):
            self.calls.append(("DELETE", path, None))
            return FakeJsonResponse({})

    client = FakeScriptReviewSubmitOnlyClient()

    check = run_script_review_submit_only_check(
        client,
        draft_set_id="draft-set-1",
        timeout_seconds=1,
        poll_interval=0,
    )

    assert check.ok is True
    assert client.calls[0][0:2] == (
        "GET",
        "/api/generation/script-review/draft-sets/draft-set-1",
    )
    assert client.calls[1][0:2] == (
        "POST",
        "/api/generation/script-review/draft-sets/draft-set-1/tasks",
    )
    assert client.calls[1][2]["base_params"]["frame_template"] == "1080x1920/static_default.html"
    assert client.calls[1][2]["metadata"]["llm_draft_e2e"] is False


def test_run_script_review_submit_only_fails_when_no_existing_drafts():
    class FakeEmptyDraftClient:
        def get(self, path):
            assert path == "/api/generation/script-review/draft-sets"
            return FakeJsonResponse({"draft_sets": []})

    check = run_script_review_submit_only_check(
        FakeEmptyDraftClient(),
        draft_set_id=None,
        timeout_seconds=1,
        poll_interval=0,
    )

    assert check.ok is False
    assert check.detail == "no existing script-review draft set with drafts"
    assert check.data["draft_sets_count"] == 0


def test_run_provider_readiness_checks_diagnostics_templates_and_workflows(monkeypatch):
    class FakeProviderClient:
        def __init__(self):
            self.calls = []

        def get(self, path):
            self.calls.append(("GET", path))
            if path == "/api/settings/diagnostics":
                return FakeJsonResponse(
                    {
                        "checks": [
                            {"id": "llm_config", "ok": True, "message": "ok"},
                            {"id": "ffmpeg", "ok": True, "message": "ok"},
                            {"id": "runninghub_config", "ok": True, "message": "ok"},
                            {"id": "runninghub_timeout", "ok": True, "message": "600"},
                            {"id": "default_image_workflow", "ok": True, "message": "image"},
                            {"id": "default_video_workflow", "ok": True, "message": "video"},
                        ]
                    }
                )
            if path == "/api/generation/templates":
                return FakeJsonResponse(
                    {
                        "templates": [
                            {
                                "id": "petwoods_xhs_daily_v1",
                                "fixed_params": {},
                            },
                            {
                                "id": "petwoods_xhs_topic_to_video_v1",
                                "fixed_params": {},
                            },
                            {
                                "id": "petwoods_xhs_quality_explainer_v1",
                                "fixed_params": {},
                            },
                            {
                                "id": "petwoods_xhs_asset_enhanced_v1",
                                "fixed_params": {},
                            },
                            {
                                "id": "petwoods_xhs_real_material_montage_v1",
                                "fixed_params": {},
                            },
                            {
                                "id": "pixelle_i2v_basic_v1",
                                "fixed_params": {"workflow_key": "runninghub/i2v_LTX2.json"},
                            },
                            {
                                "id": "pixelle_action_transfer_basic_v1",
                                "fixed_params": {"workflow_key": "runninghub/af_scail.json"},
                            },
                            {
                                "id": "pixelle_digital_human_basic_v1",
                                "fixed_params": {
                                    "workflow_paths": {
                                        "first_workflow_path": "workflows/runninghub/digital_image.json"
                                    }
                                },
                            },
                        ]
                    }
                )
            if path == "/api/resources/workflows/media":
                return FakeJsonResponse({"workflows": [{"key": "runninghub/i2v_LTX2.json"}]})
            raise AssertionError(path)

    def fake_exists(path):
        return str(path) in {
            "workflows/runninghub/i2v_LTX2.json",
            "workflows/runninghub/af_scail.json",
            "workflows/runninghub/digital_image.json",
        }

    monkeypatch.setattr("scripts.verify_streamlit_migration.Path.exists", fake_exists)

    client = FakeProviderClient()
    check = run_provider_readiness_check(client)

    assert check.ok is True
    assert check.detail == "provider readiness passed"
    assert client.calls == [
        ("GET", "/api/settings/diagnostics"),
        ("GET", "/api/generation/templates"),
        ("GET", "/api/resources/workflows/media"),
    ]
    assert check.data["workflow_checks"][0] == {
        "ref": "runninghub/i2v_LTX2.json",
        "file_exists": True,
        "listed_by_media_resources": True,
    }
    assert check.data["workflow_checks"][1]["listed_by_media_resources"] is False


def test_run_provider_readiness_reports_failed_diagnostics_and_missing_workflow(monkeypatch):
    class FakeBrokenProviderClient:
        def get(self, path):
            if path == "/api/settings/diagnostics":
                return FakeJsonResponse(
                    {
                        "checks": [
                            {"id": "llm_config", "ok": False, "message": "missing"},
                            {"id": "ffmpeg", "ok": True, "message": "ok"},
                        ]
                    }
                )
            if path == "/api/generation/templates":
                return FakeJsonResponse(
                    {
                        "templates": [
                            {
                                "id": "pixelle_i2v_basic_v1",
                                "fixed_params": {"workflow_key": "runninghub/i2v_LTX2.json"},
                            }
                        ]
                    }
                )
            if path == "/api/resources/workflows/media":
                return FakeJsonResponse({"workflows": []})
            raise AssertionError(path)

    monkeypatch.setattr(
        "scripts.verify_streamlit_migration.Path.exists",
        lambda path: False,
    )

    check = run_provider_readiness_check(FakeBrokenProviderClient())

    assert check.ok is False
    assert "diagnostics=" in check.detail
    assert "workflow_files=runninghub/i2v_LTX2.json" in check.detail
    assert check.data["failed_diagnostics"][0]["id"] == "llm_config"
    assert check.data["missing_workflow_files"] == ["runninghub/i2v_LTX2.json"]


def test_run_provider_task_status_requires_task_ids():
    check = run_provider_task_status_check(provider_task_ids=[])

    assert check.ok is False
    assert check.detail == "no provider task ids provided"
    assert check.data == {"provider": "runninghub", "tasks": []}


def test_run_provider_task_status_queries_existing_runninghub_tasks_only():
    calls = []

    class FakeRunningHubClient:
        async def query_task_status(self, task_id):
            calls.append(("query_task_status", task_id))
            return {"status": "QUEUED", "msg": "waiting for GPU", "taskId": task_id}

        async def create_task(self, workflow_id, node_info_list=None):
            calls.append(("create_task", workflow_id))
            raise AssertionError("status check must not create provider tasks")

    class FakeRunningHubExecutor:
        def __init__(self, api_key, timeout=None, instance_type=None):
            calls.append(("executor_init", bool(api_key), timeout, instance_type))
            self.client = FakeRunningHubClient()

        async def close(self):
            calls.append(("close",))

    def fake_config_manager_factory():
        return SimpleNamespace(
            config=SimpleNamespace(
                comfyui=SimpleNamespace(
                    runninghub_api_key="configured",
                    runninghub_timeout=600,
                    runninghub_instance_type="plus",
                )
            )
        )

    check = run_provider_task_status_check(
        provider_task_ids=["rh-task-1"],
        executor_factory=FakeRunningHubExecutor,
        config_manager_factory=fake_config_manager_factory,
    )

    assert check.ok is True
    assert check.detail == "provider task status query passed"
    assert calls == [
        ("executor_init", True, 600, "plus"),
        ("query_task_status", "rh-task-1"),
        ("close",),
    ]
    assert check.data["tasks"][0]["provider_task_id"] == "rh-task-1"
    assert check.data["tasks"][0]["status"] == "QUEUED"
    assert check.data["tasks"][0]["message"] == "waiting for GPU"


def test_run_provider_task_status_reports_missing_runninghub_key():
    def fake_config_manager_factory():
        return SimpleNamespace(
            config=SimpleNamespace(
                comfyui=SimpleNamespace(
                    runninghub_api_key="",
                    runninghub_timeout=600,
                    runninghub_instance_type=None,
                )
            )
        )

    check = run_provider_task_status_check(
        provider_task_ids=["rh-task-1"],
        config_manager_factory=fake_config_manager_factory,
    )

    assert check.ok is False
    assert check.detail == "RunningHub API key is not configured"
    assert check.data == {"provider": "runninghub", "tasks": ["rh-task-1"]}


def test_run_publish_readiness_check_uses_non_mutating_publish_check_route():
    class FakePublishReadinessClient:
        def __init__(self):
            self.calls = []

        def get(self, path):
            self.calls.append(("GET", path, None))
            if path == "/api/publish/platforms":
                return FakeJsonResponse({"platforms": [{"id": "youtube", "label": "YouTube"}]})
            if path == "/api/publish/timezones":
                return FakeJsonResponse(
                    {"default_timezone": "Asia/Shanghai", "timezones": ["Asia/Shanghai"]}
                )
            raise AssertionError(path)

        def post(self, path, json):
            self.calls.append(("POST", path, json))
            assert path == "/api/publish/check"
            return FakeJsonResponse(
                {
                    "checks": [
                        {
                            "name": "Buffer youtube",
                            "ok": True,
                            "message": "Channel reachable",
                        }
                    ]
                }
            )

    client = FakePublishReadinessClient()

    check = run_publish_readiness_check(
        client,
        platforms=["youtube"],
    )

    assert check.ok is True
    assert client.calls == [
        ("GET", "/api/publish/platforms", None),
        ("GET", "/api/publish/timezones", None),
        ("POST", "/api/publish/check", {"platforms": ["youtube"]}),
    ]


def test_run_publish_readiness_check_fails_when_any_check_fails():
    class FakePublishReadinessClient:
        def get(self, path):
            return FakeJsonResponse({})

        def post(self, path, json):
            return FakeJsonResponse(
                {
                    "checks": [
                        {"name": "Tencent COS", "ok": True, "message": "ok"},
                        {
                            "name": "Buffer youtube",
                            "ok": False,
                            "message": "channel missing",
                        },
                    ]
                }
            )

    check = run_publish_readiness_check(
        FakePublishReadinessClient(),
        platforms=["youtube"],
    )

    assert check.ok is False
    assert check.detail == "publish readiness failed: Buffer youtube"
    assert check.data["failed_checks"] == [
        {
            "name": "Buffer youtube",
            "ok": False,
            "message": "channel missing",
        }
    ]


def test_run_real_publish_e2e_requires_explicit_confirmation():
    class FakePublishClient:
        def __init__(self):
            self.calls = []

        def get(self, path):
            self.calls.append(("GET", path, None))
            raise AssertionError(path)

        def post(self, path, json):
            self.calls.append(("POST", path, json))
            raise AssertionError(path)

    client = FakePublishClient()

    check = run_real_publish_e2e_check(
        client,
        platforms=["x"],
        confirmed=False,
        task_id="task-1",
        caption="caption",
        title="title",
        due_at=None,
        timeout_seconds=1,
        poll_interval=0,
    )

    assert check.ok is False
    assert check.detail == "real publish E2E requires --confirm-real-publish"
    assert check.data["publish_endpoint_called"] is False
    assert client.calls == []


def test_run_real_publish_e2e_checks_readiness_then_publishes_completed_task():
    class FakePublishClient:
        def __init__(self):
            self.calls = []

        def get(self, path):
            self.calls.append(("GET", path, None))
            if path == "/api/publish/platforms":
                return FakeJsonResponse({"platforms": [{"id": "x", "label": "X"}]})
            if path == "/api/publish/timezones":
                return FakeJsonResponse(
                    {"default_timezone": "Asia/Shanghai", "timezones": ["Asia/Shanghai"]}
                )
            if path == "/api/publish/tasks/task-1/record":
                return FakeJsonResponse(
                    {
                        "task_id": "task-1",
                        "record": {
                            "public_video_url": "https://cdn.example/video.mp4",
                            "jobs": [
                                {
                                    "platform": "x",
                                    "status": "scheduled",
                                    "buffer_post_id": "post-1",
                                }
                            ],
                        },
                    }
                )
            raise AssertionError(path)

        def post(self, path, json):
            self.calls.append(("POST", path, json))
            if path == "/api/publish/check":
                return FakeJsonResponse(
                    {
                        "checks": [
                            {"name": "Tencent COS", "ok": True, "message": "ok"},
                            {"name": "Buffer x", "ok": True, "message": "Channel reachable"},
                        ]
                    }
                )
            if path == "/api/publish/tasks/task-1":
                assert json == {
                    "platforms": ["x"],
                    "caption": "caption",
                    "title": "title",
                    "due_at": None,
                }
                return FakeJsonResponse(
                    {
                        "task_id": "task-1",
                        "record": {
                            "public_video_url": "https://cdn.example/video.mp4",
                            "jobs": [
                                {
                                    "platform": "x",
                                    "status": "scheduled",
                                    "buffer_post_id": "post-1",
                                }
                            ],
                        },
                    }
                )
            raise AssertionError(path)

    client = FakePublishClient()

    check = run_real_publish_e2e_check(
        client,
        platforms=["x"],
        confirmed=True,
        task_id="task-1",
        caption="caption",
        title="title",
        due_at=None,
        timeout_seconds=1,
        poll_interval=0,
    )

    assert check.ok is True
    assert check.detail == "real publish E2E passed"
    assert client.calls == [
        ("GET", "/api/publish/platforms", None),
        ("GET", "/api/publish/timezones", None),
        ("POST", "/api/publish/check", {"platforms": ["x"]}),
        (
            "POST",
            "/api/publish/tasks/task-1",
            {
                "platforms": ["x"],
                "caption": "caption",
                "title": "title",
                "due_at": None,
            },
        ),
        ("GET", "/api/publish/tasks/task-1/record", None),
    ]
    assert check.data["selected_jobs"][0]["buffer_post_id"] == "post-1"


def test_run_management_readiness_check_validates_read_only_management_shapes():
    class FakeManagementClient:
        def __init__(self):
            self.calls = []

        def get(self, path):
            self.calls.append(("GET", path))
            if path == "/api/history/tasks?page=1&page_size=1":
                return FakeJsonResponse(
                    {
                        "tasks": [],
                        "total": 0,
                        "page": 1,
                        "page_size": 1,
                    }
                )
            if path == "/api/history/statistics":
                return FakeJsonResponse({"total_tasks": 0, "completed": 0, "failed": 0})
            if path == "/api/settings/config":
                return FakeJsonResponse(
                    {"configured": True, "config": complete_settings_config_payload()}
                )
            if path == "/api/settings/diagnostics":
                return FakeJsonResponse(complete_settings_diagnostics_payload())
            if path == "/api/resources/bgm":
                return FakeJsonResponse({"bgm_files": []})
            if path == "/api/resources/templates":
                return FakeJsonResponse(
                    {
                        "templates": [
                            {"key": "1080x1920/image_default.html", "width": 1080}
                        ]
                    }
                )
            if path == "/api/resources/workflows/media":
                return FakeJsonResponse(
                    {
                        "workflows": [
                            {
                                "key": "runninghub/image_flux.json",
                                "source": "runninghub",
                            }
                        ]
                    }
                )
            if path == "/api/resources/workflows/tts":
                return FakeJsonResponse({"workflows": []})
            if path == "/api/help/faq?language=zh_CN":
                return FakeJsonResponse(
                    {
                        "language": "zh_CN",
                        "content": "帮助内容",
                        "sections": [{"question": "如何生成？", "answer": "输入文案。"}],
                    }
                )
            raise AssertionError(path)

    client = FakeManagementClient()

    check = run_management_readiness_check(client)

    assert check.ok is True
    assert check.detail == "management readiness passed"
    assert client.calls == [
        ("GET", "/api/history/tasks?page=1&page_size=1"),
        ("GET", "/api/history/statistics"),
        ("GET", "/api/settings/config"),
        ("GET", "/api/settings/diagnostics"),
        ("GET", "/api/resources/bgm"),
        ("GET", "/api/resources/templates"),
        ("GET", "/api/resources/workflows/media"),
        ("GET", "/api/resources/workflows/tts"),
        ("GET", "/api/help/faq?language=zh_CN"),
    ]


def test_run_management_readiness_check_reports_missing_management_shape():
    class FakeBrokenManagementClient:
        def get(self, path):
            if path == "/api/history/tasks?page=1&page_size=1":
                return FakeJsonResponse({"tasks": []})
            if path == "/api/history/statistics":
                return FakeJsonResponse({"total_tasks": 0})
            if path == "/api/settings/config":
                return FakeJsonResponse({"configured": True, "config": {}})
            if path == "/api/settings/diagnostics":
                return FakeJsonResponse({"ok": True, "checks": []})
            if path == "/api/resources/bgm":
                return FakeJsonResponse({"bgm_files": []})
            if path == "/api/resources/templates":
                return FakeJsonResponse({"templates": []})
            if path == "/api/resources/workflows/media":
                return FakeJsonResponse({"workflows": []})
            if path == "/api/resources/workflows/tts":
                return FakeJsonResponse({"workflows": []})
            if path == "/api/help/faq?language=zh_CN":
                return FakeJsonResponse(
                    {"language": "zh_CN", "content": "帮助内容", "sections": []}
                )
            raise AssertionError(path)

    check = run_management_readiness_check(FakeBrokenManagementClient())

    assert check.ok is False
    assert check.detail == (
        "management readiness failed: history_tasks, settings_config, settings_diagnostics"
    )
    assert check.data["failed_checks"][0]["name"] == "history_tasks"


def test_missing_dict_paths_reports_settings_field_gaps():
    config = complete_settings_config_payload()
    del config["publish"]["cos"]["endpoint_url"]
    del config["comfyui"]["tts"]["fish_audio"]["reference_id"]

    assert missing_dict_paths(
        config,
        [
            "publish.cos.endpoint_url",
            "publish.cos.public_base_url",
            "comfyui.tts.fish_audio.reference_id",
        ],
    ) == [
        "publish.cos.endpoint_url",
        "comfyui.tts.fish_audio.reference_id",
    ]


def test_capability_matrix_covers_streamlit_scope_and_gate_checks():
    check = check_capability_matrix()

    assert check.ok is True
    assert check.name == "capability_matrix"
    assert check.detail == "capability matrix covers Streamlit migration scope"
    assert check.data["capabilities_count"] >= 19
    assert "petwoods_xhs_daily_v1" in check.data["template_ids"]
    assert "pixelle_script_review_v1" in check.data["template_ids"]
    assert "real_generation_petwoods_xhs_daily_v1" in check.data["covered_checks"]
    assert "real_publish_e2e" in check.data["external_checks"]
    assert check.data["missing_required_checks"] == []
    assert check.data["missing_external_plan_checks"] == []


def test_run_browser_smoke_check_executes_playwright_script(monkeypatch):
    calls = []

    monkeypatch.setattr(
        "scripts.verify_streamlit_migration.shutil.which",
        lambda name: "/usr/bin/node" if name == "node" else None,
    )

    def fake_run(cmd, cwd, env, text, capture_output, timeout, check):
        calls.append(
            {
                "cmd": cmd,
                "cwd": cwd,
                "frontend_url": env["PIXELLE_FRONTEND_URL"],
                "timeout": timeout,
                "check": check,
                "text": text,
                "capture_output": capture_output,
            }
        )
        return subprocess.CompletedProcess(
            cmd,
            0,
            stdout=json.dumps(
                {
                    "ok": True,
                    "url": env["PIXELLE_FRONTEND_URL"],
                    "checked": ["Pixelle 生产模板", "历史记录"],
                    "errors": [],
                    "consoleErrors": [],
                    "pageErrors": [],
                }
            ),
            stderr="",
        )

    monkeypatch.setattr(
        "scripts.verify_streamlit_migration.subprocess.run",
        fake_run,
    )

    check = run_browser_smoke_check("http://127.0.0.1:5173", timeout_seconds=9)

    assert check.ok is True
    assert check.name == "browser_smoke"
    assert calls[0]["cmd"][:2] == ["/usr/bin/node", "--input-type=module"]
    assert calls[0]["cwd"] == Path("apps/production-template-demo")
    assert calls[0]["frontend_url"] == "http://127.0.0.1:5173"
    assert calls[0]["timeout"] == 9
    assert calls[0]["check"] is False
    assert calls[0]["text"] is True
    assert calls[0]["capture_output"] is True


def test_run_browser_smoke_check_reports_playwright_failures(monkeypatch):
    monkeypatch.setattr(
        "scripts.verify_streamlit_migration.shutil.which",
        lambda name: "/usr/bin/node" if name == "node" else None,
    )

    def fake_run(cmd, cwd, env, text, capture_output, timeout, check):
        return subprocess.CompletedProcess(
            cmd,
            1,
            stdout=json.dumps(
                {
                    "ok": False,
                    "errors": ["missing visible text: 历史记录"],
                    "checked": ["Pixelle 生产模板"],
                    "consoleErrors": [],
                    "pageErrors": [],
                }
            ),
            stderr="",
        )

    monkeypatch.setattr(
        "scripts.verify_streamlit_migration.subprocess.run",
        fake_run,
    )

    check = run_browser_smoke_check("http://127.0.0.1:5173")

    assert check.ok is False
    assert check.detail == "browser smoke failed: missing visible text: 历史记录"
    assert check.data["errors"] == ["missing visible text: 历史记录"]


def test_browser_smoke_script_checks_streamlit_replacement_controls():
    required_texts = [
        "视频文案",
        "创建真实生成任务",
        "真实任务状态",
        "刷新历史记录",
        "视频详情",
        "真实 Buffer 发布链路",
        "选题",
        "脚本 Prompt",
        "提交生成视频",
        "图片生成视频",
        "动作迁移视频",
        "数字人视频",
        "批量选题",
        "批量文案",
        "创建批量任务",
        "批次状态",
        "React 可提交",
        "Legacy only",
        "AiHubMix API Key",
        "RunningHub API Key",
        "Buffer API Key",
        "COS Region",
        "旧 Streamlit Help 页 FAQ",
    ]

    for text in required_texts:
        assert text in BROWSER_SMOKE_SCRIPT


def test_external_e2e_plan_lists_ordered_confirmation_steps():
    check = build_external_e2e_plan()

    assert check.ok is True
    assert check.name == "external_e2e_plan"
    assert check.detail == "external E2E plan generated; no side effects executed"
    assert len(check.data["steps"]) == 10
    assert check.data["steps"][0]["check"] == "real_generation_petwoods_xhs_daily_v1"
    assert check.data["steps"][-1]["check"] == "real_publish_e2e"
    assert check.data["recommended_first_command"] == (
        "uv run python scripts/verify_streamlit_migration.py "
        "--real-template petwoods_xhs_daily_v1 --no-cancel-on-timeout --timeout 900"
    )
    assert all(step["requires_confirmation"] for step in check.data["steps"])
    assert "provider_generation" in check.data["steps"][0]["effects"]
    assert "buffer_post" in check.data["steps"][-1]["effects"]
    assert (
        "reported --existing-real-template"
        in check.data["steps"][0]["resume_strategy"]
    )
    assert check.data["steps"][-1]["resume_strategy"] is None


def test_streamlit_completion_gate_requires_all_e2e_and_browser_evidence():
    gate = build_streamlit_completion_gate(
        [
            Check("template_inventory", True),
            Check("route_contract", True),
            Check("management_readiness", True),
            Check("real_generation_petwoods_xhs_daily_v1", False),
        ]
    )

    assert gate.ok is False
    assert "streamlit replacement gate failed" in gate.detail
    assert "real_generation_petwoods_xhs_daily_v1" in gate.data["failed"]
    assert "browser_smoke" in gate.data["missing"]
    assert "provider_readiness" in gate.data["missing"]
    assert "real_publish_e2e" in gate.data["missing"]
    assert gate.data["capability_summary"]["total"] >= 20
    assert gate.data["capability_summary"]["incomplete"] > 0
    standard_gap = next(
        gap
        for gap in gate.data["capability_gaps"]
        if gap["id"] == "standard_script"
    )
    assert standard_gap["capability"] == "已有文案生成视频"
    assert standard_gap["react_surface"] == "生成视频"
    assert standard_gap["requires_external_e2e"] is True
    assert "provider_readiness" in standard_gap["missing_evidence"]
    assert "real_generation_petwoods_xhs_daily_v1" in standard_gap["failed_evidence"]
    assert {
        "check": "browser_smoke",
        "status": "missing",
        "capability": "React 主入口浏览器可用性",
        "phase": "P2",
        "command": "uv run python scripts/verify_streamlit_migration.py --browser-smoke",
        "requires_confirmation": False,
    } in gate.data["missing_details"]
    failed_daily = next(
        gap
        for gap in gate.data["failed_details"]
        if gap["check"] == "real_generation_petwoods_xhs_daily_v1"
    )
    assert failed_daily["capability"] == "标准视频生成：已有文案到视频"
    assert failed_daily["phase"] == "P1"
    assert failed_daily["requires_confirmation"] is True
    assert "detail" not in failed_daily
    assert any(
        gap["check"] == "real_publish_e2e"
        for gap in gate.data["requires_confirmation"]
    )


def test_streamlit_completion_gate_passes_only_when_required_checks_pass():
    gate = build_streamlit_completion_gate(
        [Check(name, True) for name in STREAMLIT_COMPLETION_REQUIRED_CHECKS]
    )

    assert gate.ok is True
    assert gate.detail == "streamlit replacement gate passed"
    assert gate.data["missing"] == []
    assert gate.data["failed"] == []
    assert gate.data["missing_details"] == []
    assert gate.data["failed_details"] == []
    assert gate.data["requires_confirmation"] == []


def test_classify_task_blocker_identifies_media_provider_queue():
    assert (
        classify_task_blocker(
            {
                "progress": {
                    "stage": "frame_step",
                    "detail": {"action": "media", "step": 2},
                }
            }
        )
        == "provider_runtime_queue_or_timeout"
    )


def test_classify_batch_blocker_uses_running_item_progress():
    assert (
        classify_batch_blocker(
            {
                "items": [
                    {
                        "status": "running",
                        "progress": {
                            "stage": "frame_step",
                            "detail": {"action": "media"},
                        },
                    }
                ]
            }
        )
        == "provider_runtime_queue_or_timeout"
    )
