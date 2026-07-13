from concurrent.futures import ThreadPoolExecutor

import pytest

import pixelle_video.content.operations as operations
import pixelle_video.content.store as content_store
import pixelle_video.generation.task_store as task_store
from pixelle_video.content.models import new_content_item
from pixelle_video.generation.schemas import (
    GenerationProgress,
    GenerationRequest,
    GenerationTask,
)


@pytest.fixture(autouse=True)
def isolated_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(content_store, "CONTENT_ITEMS_DIR", tmp_path / "items")
    monkeypatch.setattr(operations, "CONTENT_FLOW_OPERATION_DIR", tmp_path / "operations")
    monkeypatch.setattr(task_store, "GENERATION_TASK_DIR", tmp_path / "tasks")


def test_recovery_completes_persisted_draft_and_rolls_back_empty_draft():
    recovered_item = new_content_item(title="有结果")
    recovered_item.status = "pending_review"
    recovered_item.links["draft_set_id"] = "draft-set-1"
    content_store.save_item(recovered_item)
    recovered, _ = operations.begin_operation(
        request_id="draft-recovered",
        payload_hash="hash-1",
        operation="draft",
        item_id=recovered_item.item_id,
        prior_status="idea",
    )
    recovered.draft_set_id = "draft-set-1"
    recovered.phase = "external_completed"
    operations.save_operation(recovered)

    empty_item = new_content_item(title="无结果")
    empty_item.status = "drafting"
    content_store.save_item(empty_item)
    empty, _ = operations.begin_operation(
        request_id="draft-empty",
        payload_hash="hash-2",
        operation="draft",
        item_id=empty_item.item_id,
        prior_status="idea",
    )

    operations.recover_running_operations()

    assert operations.load_operation(recovered.operation_id).status == "completed"
    assert operations.load_operation(empty.operation_id).status == "failed"
    assert content_store.load_item(empty_item.item_id).status == "idea"


def test_recovery_links_existing_production_task_without_resubmission():
    item = new_content_item(title="重产")
    item.status = "produced"
    content_store.save_item(item)
    operation, _ = operations.begin_operation(
        request_id="produce-recover",
        payload_hash="hash-3",
        operation="produce",
        item_id=item.item_id,
        prior_status="produced",
    )
    task = GenerationTask(
        task_id="task-existing",
        pipeline_id="standard",
        entry="script",
        request=GenerationRequest(pipeline_id="standard", entry="script", input={"script": "x"}),
        progress=GenerationProgress(stage="queued"),
    )
    task_store.save_generation_task(task)
    operation.task_ids = [task.task_id]
    operation.batch_id = "batch-existing"
    operation.phase = "task_created"
    operations.save_operation(operation)

    operations.recover_running_operations()

    current = content_store.load_item(item.item_id)
    assert current.status == "producing"
    assert current.links["task_ids"] == ["task-existing"]
    assert current.links["batch_ids"] == ["batch-existing"]
    assert current.automation["production_prior_status"] == "produced"
    assert operations.load_operation(operation.operation_id).status == "completed"


def test_request_id_conflict_and_same_payload_idempotency():
    first, created = operations.begin_operation(
        request_id="stable-id",
        payload_hash="same",
        operation="topics",
        item_id="topics:stable-id",
        prior_status="idea",
    )
    repeated, repeated_created = operations.begin_operation(
        request_id="stable-id",
        payload_hash="same",
        operation="topics",
        item_id="topics:stable-id",
        prior_status="idea",
    )
    assert created is True
    assert repeated_created is False
    assert repeated.operation_id == first.operation_id
    with pytest.raises(FileExistsError):
        operations.begin_operation(
            request_id="stable-id",
            payload_hash="different",
            operation="topics",
            item_id="topics:stable-id",
            prior_status="idea",
        )


def test_concurrent_same_request_has_one_executor():
    def begin():
        return operations.begin_operation(
            request_id="concurrent-id",
            payload_hash="same",
            operation="topics",
            item_id="topics:concurrent-id",
            prior_status="idea",
        )

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: begin(), range(8)))

    assert sum(1 for _, created in results if created) == 1
    assert len({record.operation_id for record, _ in results}) == 1
