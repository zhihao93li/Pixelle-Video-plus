import asyncio
from collections import deque
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Callable

from comfykit.comfyui.runninghub_executor import RunningHubExecutor

ProviderProgressCallback = Callable[[dict[str, Any]], None]


class RunningHubExecutionQueue:
    """Process-wide FIFO gate for every RunningHub workflow submission.

    RunningHub account concurrency is shared across production tasks. A
    pipeline-local semaphore cannot enforce that contract when multiple videos
    or batch items are running at the same time, so the gate lives at the
    provider boundary instead.
    """

    def __init__(self, limit_getter: Callable[[], int]):
        self._limit_getter = limit_getter
        self._condition = asyncio.Condition()
        self._waiters: deque[object] = deque()
        self._active = 0

    def _limit(self) -> int:
        try:
            return max(1, int(self._limit_getter()))
        except (TypeError, ValueError):
            return 1

    @asynccontextmanager
    async def slot(self, progress_callback: ProviderProgressCallback | None = None):
        token = object()
        acquired = False
        async with self._condition:
            self._waiters.append(token)
            self._report(progress_callback, "LOCAL_QUEUED", token)
            try:
                while self._waiters[0] is not token or self._active >= self._limit():
                    await self._condition.wait()
                self._waiters.popleft()
                self._active += 1
                acquired = True
            except BaseException:
                if token in self._waiters:
                    self._waiters.remove(token)
                    self._condition.notify_all()
                raise

        self._report(progress_callback, "SUBMITTING", token)
        try:
            yield
        finally:
            if acquired:
                async with self._condition:
                    self._active -= 1
                    self._condition.notify_all()

    def _report(
        self,
        progress_callback: ProviderProgressCallback | None,
        status: str,
        token: object,
    ) -> None:
        if progress_callback is None:
            return
        try:
            position = list(self._waiters).index(token) + 1
        except ValueError:
            position = 0
        try:
            progress_callback(
                {
                    "provider": "runninghub",
                    "provider_status": status,
                    "local_queue_position": position,
                    "local_queue_waiting": len(self._waiters),
                    "local_queue_active": self._active,
                    "local_concurrency_limit": self._limit(),
                }
            )
        except Exception:
            # Progress reporting must never leak a provider slot or block work.
            return


_process_runninghub_queue: RunningHubExecutionQueue | None = None


def get_process_runninghub_queue(
    limit_getter: Callable[[], int],
) -> RunningHubExecutionQueue:
    """Return the one RunningHub gate shared by every core in this process."""

    global _process_runninghub_queue
    if _process_runninghub_queue is None:
        _process_runninghub_queue = RunningHubExecutionQueue(limit_getter)
    return _process_runninghub_queue


async def execute_workflow_with_provider_progress(
    kit,
    workflow_input: str | Path,
    params: dict[str, Any],
    *,
    source: str,
    provider_progress_callback: ProviderProgressCallback | None = None,
    runninghub_queue: RunningHubExecutionQueue | None = None,
    executor_factory=RunningHubExecutor,
):
    if source != "runninghub":
        return await kit.execute(workflow_input, params)

    def report_provider(detail: dict[str, Any]) -> None:
        if provider_progress_callback is None:
            return
        provider_progress_callback(
            {
                **detail,
                "runninghub_timeout": getattr(kit, "runninghub_timeout", None),
            }
        )

    async def execute_runninghub():
        if provider_progress_callback is None:
            return await kit.execute(workflow_input, params)

        return await _execute_runninghub_with_progress(
            kit,
            workflow_input,
            params,
            provider_progress_callback=report_provider,
            executor_factory=executor_factory,
        )

    if runninghub_queue is None:
        return await execute_runninghub()

    async with runninghub_queue.slot(report_provider):
        return await execute_runninghub()


async def _execute_runninghub_with_progress(
    kit,
    workflow_input: str | Path,
    params: dict[str, Any],
    *,
    provider_progress_callback: ProviderProgressCallback,
    executor_factory=RunningHubExecutor,
):
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
