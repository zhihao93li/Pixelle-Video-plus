from types import SimpleNamespace

import pytest

from pixelle_video.pipelines.workflow_video import ActionTransferPipeline


class FakeCore:
    llm = None
    tts = None
    media = None
    video = None
    persistence = None

    async def _get_or_create_comfykit(self):
        return SimpleNamespace()


@pytest.mark.asyncio
async def test_action_transfer_uses_reference_video_duration_when_not_provided(
    monkeypatch, tmp_path
):
    pipeline = ActionTransferPipeline(FakeCore())
    reference_video = tmp_path / "reference.mp4"
    target_image = tmp_path / "target.png"
    workflow_path = tmp_path / "workflow.json"
    generated_video = tmp_path / "generated.mp4"
    reference_video.write_bytes(b"reference")
    target_image.write_bytes(b"target")
    workflow_path.write_text('{"source": "runninghub", "workflow_id": "workflow-1"}')
    generated_video.write_bytes(b"video")
    captured_params = {}

    monkeypatch.setattr(
        pipeline,
        "_workflow_path",
        lambda workflow_key: workflow_path,
    )
    monkeypatch.setattr(
        pipeline,
        "_probe_video_seconds",
        lambda video_path: 18,
    )

    async def fake_execute_workflow(workflow, params, **kwargs):
        captured_params.update(params)
        return SimpleNamespace(videos=[str(generated_video)])

    monkeypatch.setattr(pipeline, "_execute_workflow", fake_execute_workflow)

    result = await pipeline(
        reference_video=str(reference_video),
        assets=[str(target_image)],
        prompt="transfer this action",
        duration=0,
    )

    assert captured_params["second"] == 18
    assert result.duration == 18


@pytest.mark.asyncio
async def test_workflow_video_reports_runninghub_provider_task_status(
    monkeypatch,
    tmp_path,
):
    pipeline = ActionTransferPipeline(FakeCore())
    workflow_path = tmp_path / "workflow.json"
    workflow_path.write_text('{"source": "runninghub", "workflow_id": "workflow-1"}')
    events = []

    async def fake_execute_with_provider_progress(
        kit,
        workflow_input,
        params,
        *,
        source,
        provider_progress_callback,
    ):
        assert workflow_input == "workflow-1"
        assert source == "runninghub"
        provider_progress_callback(
            {
                "provider": "runninghub",
                "provider_task_id": "rh-task-1",
                "provider_status": "QUEUED",
                "workflow_id": "workflow-1",
            }
        )
        return SimpleNamespace(videos=["output/generated.mp4"])

    monkeypatch.setattr(
        "pixelle_video.pipelines.workflow_video.execute_workflow_with_provider_progress",
        fake_execute_with_provider_progress,
    )

    result = await pipeline._execute_workflow(
        workflow_path,
        {"prompt": "transfer"},
        progress_callback=events.append,
        progress=0.4,
    )

    assert result.videos == ["output/generated.mp4"]
    assert events[-1].event_type == "execute_workflow"
    assert events[-1].progress == 0.4
    assert events[-1].detail == {
        "provider": "runninghub",
        "workflow": str(workflow_path),
        "provider_task_id": "rh-task-1",
        "provider_status": "QUEUED",
        "workflow_id": "workflow-1",
    }


def test_workflow_video_raises_provider_error_before_missing_video_message():
    pipeline = ActionTransferPipeline(FakeCore())

    with pytest.raises(ValueError, match="Workflow execution failed: provider failed"):
        pipeline._first_video(
            SimpleNamespace(
                status="error",
                msg="provider failed",
                videos=[],
            )
        )
