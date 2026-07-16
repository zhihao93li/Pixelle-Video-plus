from types import SimpleNamespace

import pytest

from pixelle_video.services.provider_execution import (
    execute_workflow_with_provider_progress,
)
from pixelle_video.config.schema import ComfyUIConfig


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
        return SimpleNamespace(status="completed", prompt_id=task["taskId"], images=["https://example.com/image.png"])

    async def close(self):
        self.closed = True


def test_runninghub_defaults_to_official_cn_api_endpoint():
    assert ComfyUIConfig().runninghub_url == "https://www.runninghub.cn"


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
        },
        {
            "provider": "runninghub",
            "provider_task_id": "rh-task-1",
            "provider_status": "QUEUED",
            "provider_status_message": "waiting for GPU",
            "workflow_id": "123456",
        },
    ]
