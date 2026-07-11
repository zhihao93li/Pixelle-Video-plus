from pathlib import Path
from typing import Any, Callable

from comfykit.comfyui.runninghub_executor import RunningHubExecutor

ProviderProgressCallback = Callable[[dict[str, Any]], None]


async def execute_workflow_with_provider_progress(
    kit,
    workflow_input: str | Path,
    params: dict[str, Any],
    *,
    source: str,
    provider_progress_callback: ProviderProgressCallback | None = None,
    executor_factory=RunningHubExecutor,
):
    if source != "runninghub" or provider_progress_callback is None:
        return await kit.execute(workflow_input, params)

    workflow_ref = str(workflow_input)
    executor = executor_factory(
        base_url=getattr(kit, "runninghub_url", None),
        api_key=getattr(kit, "runninghub_api_key", None),
        timeout=getattr(kit, "runninghub_timeout", None),
        retry_count=getattr(kit, "runninghub_retry_count", 3),
        instance_type=getattr(kit, "runninghub_instance_type", None),
    )
    client = executor.client
    original_create_task = client.create_task
    original_query_task_status = client.query_task_status

    async def create_task(workflow_id: str, node_info_list=None):
        task_data = await original_create_task(workflow_id, node_info_list)
        task_id = task_data.get("taskId")
        if task_id:
            provider_progress_callback(
                {
                    "provider": "runninghub",
                    "provider_task_id": task_id,
                    "provider_status": "CREATED",
                    "workflow_id": str(workflow_id),
                }
            )
        return task_data

    async def query_task_status(task_id: str):
        status_info = await original_query_task_status(task_id)
        detail = {
            "provider": "runninghub",
            "provider_task_id": task_id,
            "provider_status": status_info.get("status", "UNKNOWN"),
            "workflow_id": workflow_ref,
        }
        status_message = status_info.get("msg")
        if status_message:
            detail["provider_status_message"] = status_message
        provider_progress_callback(detail)
        return status_info

    client.create_task = create_task
    client.query_task_status = query_task_status

    try:
        if Path(workflow_ref).exists():
            return await executor.execute_workflow(workflow_ref, params)
        return await executor.execute_by_id(workflow_ref, params)
    finally:
        client.create_task = original_create_task
        client.query_task_status = original_query_task_status
        await executor.close()
