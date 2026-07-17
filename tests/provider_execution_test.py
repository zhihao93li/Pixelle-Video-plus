import asyncio
from types import SimpleNamespace

import pytest

from pixelle_video.config.schema import ComfyUIConfig
from pixelle_video.services.provider_execution import (
    RunningHubExecutionQueue,
    execute_workflow_with_provider_progress,
    get_process_runninghub_queue,
)


class FakeRunningHubClient:
    async def create_task(self, workflow_id, node_info_list=None):
        return {"taskId": "rh-task-1"}

    async def query_task_status(self, task_id):
        return {"status": "QUEUED", "msg": "waiting for GPU", "code": 0}


class FakeRunningHubExecutor:
    def __init__(self):
        self.client = FakeRunningHubClient()
        self.closed = False

    async def execute_by_id(self, workflow_id, params):
        task = await self.client.create_task(workflow_id, None)
        await self.client.query_task_status(task["taskId"])
        return SimpleNamespace(
            status="completed", prompt_id=task["taskId"], images=["https://example.com/image.png"]
        )

    async def close(self):
        self.closed = True


def test_runninghub_defaults_to_official_cn_api_endpoint():
    assert ComfyUIConfig().runninghub_url == "https://www.runninghub.cn"


def test_runninghub_queue_is_shared_by_every_core_in_the_process():
    first = get_process_runninghub_queue(lambda: 1)
    second = get_process_runninghub_queue(lambda: 2)

    assert first is second


@pytest.mark.asyncio
async def test_runninghub_execution_reports_external_task_id_and_status():
    events = []
    executor = FakeRunningHubExecutor()
    kit = SimpleNamespace(
        runninghub_url="https://www.runninghub.cn",
        runninghub_api_key="secret",
        runninghub_timeout=600,
        runninghub_retry_count=3,
        runninghub_instance_type="plus",
    )

    result = await execute_workflow_with_provider_progress(
        kit,
        "123456",
        {"prompt": "cat"},
        source="runninghub",
        provider_progress_callback=events.append,
        executor_factory=lambda **kwargs: executor,
    )

    assert result.status == "completed"
    assert executor.closed is True
    assert events == [
        {
            "provider": "runninghub",
            "provider_task_id": "rh-task-1",
            "provider_status": "CREATED",
            "workflow_id": "123456",
            "runninghub_timeout": 600,
        },
        {
            "provider": "runninghub",
            "provider_task_id": "rh-task-1",
            "provider_status": "QUEUED",
            "provider_status_message": "waiting for GPU",
            "workflow_id": "123456",
            "runninghub_timeout": 600,
        },
    ]


@pytest.mark.asyncio
async def test_runninghub_queue_limits_all_workflows_in_the_process():
    active = 0
    max_active = 0
    completed = []

    class SlowKit:
        async def execute(self, workflow_input, params):
            nonlocal active, max_active
            active += 1
            max_active = max(max_active, active)
            await asyncio.sleep(0.01)
            completed.append(params["index"])
            active -= 1
            return SimpleNamespace(status="completed")

    queue = RunningHubExecutionQueue(lambda: 1)
    await asyncio.gather(
        *[
            execute_workflow_with_provider_progress(
                SlowKit(),
                "123456",
                {"index": index},
                source="runninghub",
                runninghub_queue=queue,
            )
            for index in range(4)
        ]
    )

    assert max_active == 1
    assert completed == [0, 1, 2, 3]


@pytest.mark.asyncio
async def test_runninghub_queue_reports_actual_runtime_timeout():
    events = []
    queue = RunningHubExecutionQueue(lambda: 1)
    executor = FakeRunningHubExecutor()
    kit = SimpleNamespace(
        runninghub_url="https://www.runninghub.cn",
        runninghub_api_key="secret",
        runninghub_timeout=1200,
        runninghub_retry_count=3,
        runninghub_instance_type=None,
    )

    await execute_workflow_with_provider_progress(
        kit,
        "123456",
        {"prompt": "cat"},
        source="runninghub",
        provider_progress_callback=events.append,
        runninghub_queue=queue,
        executor_factory=lambda **kwargs: executor,
    )

    assert events[0]["provider_status"] == "LOCAL_QUEUED"
    assert events[0]["runninghub_timeout"] == 1200
    assert events[1]["provider_status"] == "SUBMITTING"
    assert events[1]["local_concurrency_limit"] == 1
