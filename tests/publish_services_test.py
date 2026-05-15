from pathlib import Path

import pytest

from pixelle_video.services.buffer_publisher import (
    BufferPostResult,
    BufferPublisher,
    BufferPublishError,
)
from pixelle_video.services.persistence import PersistenceService
from pixelle_video.services.public_storage import PublicMediaStorage
from pixelle_video.services.publish_manager import PublishManager


def test_public_media_storage_uploads_video_to_r2_and_returns_public_url(tmp_path):
    video_path = tmp_path / "final.mp4"
    video_path.write_bytes(b"mp4-bytes")
    calls = []

    class FakeS3Client:
        def put_object(self, **kwargs):
            calls.append(
                {
                    "Bucket": kwargs["Bucket"],
                    "Key": kwargs["Key"],
                    "Body": kwargs["Body"].read(),
                    "ContentType": kwargs["ContentType"],
                }
            )

    storage = PublicMediaStorage(
        bucket="pixlle-publish",
        public_base_url="https://media.example.com",
        client=FakeS3Client(),
    )

    public_url = storage.upload_video(video_path, task_id="task-123")

    assert public_url == "https://media.example.com/pixlle/task-123/final.mp4"
    assert calls == [
        {
            "Bucket": "pixlle-publish",
            "Key": "pixlle/task-123/final.mp4",
            "Body": b"mp4-bytes",
            "ContentType": "video/mp4",
        }
    ]


def test_public_media_storage_rejects_missing_video(tmp_path):
    storage = PublicMediaStorage(
        bucket="pixlle-publish",
        public_base_url="https://media.example.com",
        client=object(),
    )

    with pytest.raises(FileNotFoundError):
        storage.upload_video(tmp_path / "missing.mp4", task_id="task-123")


def test_public_media_storage_checks_upload_and_public_read():
    calls = []

    class FakeS3Client:
        def put_object(self, **kwargs):
            calls.append(("put", kwargs["Bucket"], kwargs["Key"], kwargs["Body"]))

        def delete_object(self, **kwargs):
            calls.append(("delete", kwargs["Bucket"], kwargs["Key"]))

    class FakeResponse:
        status_code = 200
        text = ""

    def fake_http_get(url, *, timeout, follow_redirects):
        calls.append(("get", url, timeout, follow_redirects))
        return FakeResponse()

    storage = PublicMediaStorage(
        bucket="pixlle-publish",
        public_base_url="https://media.example.com",
        client=FakeS3Client(),
        http_get=fake_http_get,
        diagnostic_key_factory=lambda: "pixlle/_diagnostics/check.mp4",
    )

    ok, message = storage.check_upload_roundtrip()

    assert ok is True
    assert message.startswith("R2 upload and public read succeeded")
    assert calls == [
        ("put", "pixlle-publish", "pixlle/_diagnostics/check.mp4", b"pixlle-r2-diagnostic"),
        ("get", "https://media.example.com/pixlle/_diagnostics/check.mp4", 10.0, True),
        ("delete", "pixlle-publish", "pixlle/_diagnostics/check.mp4"),
    ]


class FakeBufferResponse:
    status_code = 200
    text = ""

    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


class FakeAsyncClient:
    requests = []
    payload = {}

    def __init__(self, *args, **kwargs):
        self.kwargs = kwargs

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url, *, headers, json):
        self.__class__.requests.append(
            {
                "url": url,
                "headers": headers,
                "json": json,
                "timeout": self.kwargs.get("timeout"),
            }
        )
        return FakeBufferResponse(self.__class__.payload)


@pytest.mark.asyncio
async def test_buffer_publisher_creates_video_post_with_official_asset_shape():
    FakeAsyncClient.requests = []
    FakeAsyncClient.payload = {
        "data": {
            "createPost": {
                "post": {
                    "id": "post-123",
                    "text": "caption",
                    "dueAt": "2026-05-15T12:00:00Z",
                }
            }
        }
    }
    publisher = BufferPublisher(api_key="buffer-key", client_factory=FakeAsyncClient)

    result = await publisher.create_video_post(
        channel_id="channel-youtube",
        text="caption",
        video_url="https://media.example.com/pixlle/task/final.mp4",
    )

    assert result == BufferPostResult(
        post_id="post-123",
        text="caption",
        due_at="2026-05-15T12:00:00Z",
    )
    request = FakeAsyncClient.requests[0]
    assert request["url"] == "https://api.buffer.com"
    assert request["headers"]["Authorization"] == "Bearer buffer-key"
    assert request["headers"]["Content-Type"] == "application/json"
    assert request["json"]["variables"]["input"] == {
        "text": "caption",
        "channelId": "channel-youtube",
        "schedulingType": "automatic",
        "mode": "addToQueue",
        "assets": [
            {
                "video": {
                    "url": "https://media.example.com/pixlle/task/final.mp4",
                }
            }
        ],
    }


@pytest.mark.asyncio
async def test_buffer_publisher_raises_mutation_error_message():
    FakeAsyncClient.requests = []
    FakeAsyncClient.payload = {
        "data": {
            "createPost": {
                "message": "channel does not accept this video",
            }
        }
    }
    publisher = BufferPublisher(api_key="buffer-key", client_factory=FakeAsyncClient)

    with pytest.raises(BufferPublishError, match="channel does not accept this video"):
        await publisher.create_video_post(
            channel_id="channel-tiktok",
            text="caption",
            video_url="https://media.example.com/pixlle/task/final.mp4",
        )


@pytest.mark.asyncio
async def test_publish_manager_records_each_platform_independently(tmp_path):
    persistence = PersistenceService(output_dir=str(tmp_path))
    task_id = "20260515_test"
    task_dir = tmp_path / task_id
    task_dir.mkdir()
    video_path = task_dir / "final.mp4"
    video_path.write_bytes(b"mp4")
    await persistence.save_task_metadata(
        task_id,
        {
            "task_id": task_id,
            "created_at": "2026-05-15T10:00:00",
            "completed_at": "2026-05-15T10:05:00",
            "status": "completed",
            "input": {"title": "My video"},
            "result": {"video_path": str(video_path)},
        },
    )

    class FakeStorage:
        def upload_video(self, local_path, task_id):
            assert Path(local_path) == video_path
            return f"https://media.example.com/pixlle/{task_id}/final.mp4"

    class FakePublisher:
        async def create_video_post(self, *, channel_id, text, video_url, due_at=None):
            if channel_id == "channel-x":
                raise BufferPublishError("x rejected the video")
            return BufferPostResult(post_id="post-youtube", text=text, due_at=due_at)

    manager = PublishManager(
        persistence=persistence,
        storage=FakeStorage(),
        publisher=FakePublisher(),
        channel_ids={"youtube": "channel-youtube", "x": "channel-x"},
    )

    record = await manager.publish_task(
        task_id=task_id,
        platforms=["youtube", "x"],
        caption="caption",
    )

    assert record["public_video_url"] == f"https://media.example.com/pixlle/{task_id}/final.mp4"
    assert record["jobs"][0]["platform"] == "youtube"
    assert record["jobs"][0]["status"] == "scheduled"
    assert record["jobs"][0]["buffer_post_id"] == "post-youtube"
    assert record["jobs"][1]["platform"] == "x"
    assert record["jobs"][1]["status"] == "failed"
    assert record["jobs"][1]["error"] == "x rejected the video"
    assert (task_dir / "publish.json").exists()


@pytest.mark.asyncio
async def test_publish_manager_records_r2_upload_failure_per_platform(tmp_path):
    persistence = PersistenceService(output_dir=str(tmp_path))
    task_id = "20260515_r2_failure"
    task_dir = tmp_path / task_id
    task_dir.mkdir()
    video_path = task_dir / "final.mp4"
    video_path.write_bytes(b"mp4")
    await persistence.save_task_metadata(
        task_id,
        {
            "task_id": task_id,
            "created_at": "2026-05-15T10:00:00",
            "completed_at": "2026-05-15T10:05:00",
            "status": "completed",
            "input": {"title": "My video"},
            "result": {"video_path": str(video_path)},
        },
    )

    class FailingStorage:
        def upload_video(self, local_path, task_id):
            raise RuntimeError("invalid R2 credentials")

    manager = PublishManager(
        persistence=persistence,
        storage=FailingStorage(),
        publisher=object(),
        channel_ids={"youtube": "channel-youtube", "x": "channel-x"},
    )

    record = await manager.publish_task(
        task_id=task_id,
        platforms=["youtube", "x"],
        caption="caption",
    )

    assert record["public_video_url"] is None
    assert [job["platform"] for job in record["jobs"]] == ["youtube", "x"]
    assert {job["status"] for job in record["jobs"]} == {"failed"}
    assert all(job["error"] == "R2 upload failed: invalid R2 credentials" for job in record["jobs"])
    assert (task_dir / "publish.json").exists()
