"""
Buffer GraphQL publishing client.
"""

import os
from dataclasses import dataclass
from typing import Any

import httpx

from pixelle_video.services.public_storage import PublishConfigurationError


class BufferPublishError(RuntimeError):
    """Raised when Buffer rejects a publish request."""


@dataclass(frozen=True)
class BufferPostResult:
    """Normalized Buffer post response."""

    post_id: str
    text: str | None = None
    due_at: str | None = None


class BufferPublisher:
    """Small wrapper around Buffer's GraphQL API."""

    CREATE_VIDEO_POST_MUTATION = """
    mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess {
          post {
            id
            text
            dueAt
          }
        }
        ... on MutationError {
          message
        }
      }
    }
    """

    GET_CHANNEL_QUERY = """
    query GetChannel($input: ChannelInput!) {
      channel(input: $input) {
        id
        name
        displayName
        service
        isQueuePaused
      }
    }
    """

    def __init__(
        self,
        *,
        api_key: str,
        endpoint: str = "https://api.buffer.com",
        client_factory=httpx.AsyncClient,
        timeout: float = 30.0,
    ):
        self.api_key = api_key.strip()
        self.endpoint = endpoint
        self.client_factory = client_factory
        self.timeout = timeout

        if not self.api_key:
            raise PublishConfigurationError("BUFFER_API_KEY is required")

    @classmethod
    def from_env(cls) -> "BufferPublisher":
        """Create a Buffer publisher from environment variables."""
        return cls(api_key=os.getenv("BUFFER_API_KEY", ""))

    @classmethod
    def from_config(cls, config: dict | None) -> "BufferPublisher":
        """Create a Buffer publisher from persisted publish.buffer configuration."""
        config = config or {}
        return cls(api_key=config.get("api_key", ""))

    async def _graphql(self, query: str, variables: dict[str, Any] | None = None) -> dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {"query": query, "variables": variables or {}}

        try:
            async with self.client_factory(timeout=self.timeout) as client:
                response = await client.post(self.endpoint, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()
        except httpx.HTTPStatusError as exc:
            body = exc.response.text if exc.response is not None else str(exc)
            raise BufferPublishError(f"Buffer HTTP error: {body}") from exc
        except httpx.HTTPError as exc:
            raise BufferPublishError(f"Buffer request failed: {exc}") from exc
        except ValueError as exc:
            raise BufferPublishError("Buffer returned invalid JSON") from exc

        if data.get("errors"):
            messages = [err.get("message", str(err)) for err in data["errors"]]
            raise BufferPublishError("; ".join(messages))

        return data.get("data") or {}

    async def create_video_post(
        self,
        *,
        channel_id: str,
        text: str,
        video_url: str,
        due_at: str | None = None,
    ) -> BufferPostResult:
        """Create a Buffer video post for a single connected channel."""
        post_input: dict[str, Any] = {
            "text": text,
            "channelId": channel_id,
            "schedulingType": "automatic",
            "mode": "addToQueue",
            "assets": [{"video": {"url": video_url}}],
        }

        if due_at:
            post_input["mode"] = "customScheduled"
            post_input["dueAt"] = due_at

        data = await self._graphql(
            self.CREATE_VIDEO_POST_MUTATION,
            variables={"input": post_input},
        )
        payload = data.get("createPost") or {}

        if payload.get("message"):
            raise BufferPublishError(payload["message"])

        post = payload.get("post")
        if not post or not post.get("id"):
            raise BufferPublishError("Buffer response did not include a post id")

        return BufferPostResult(
            post_id=post["id"],
            text=post.get("text"),
            due_at=post.get("dueAt"),
        )

    async def get_channel(self, channel_id: str) -> dict[str, Any]:
        """Fetch one Buffer channel as a read-only diagnostics check."""
        data = await self._graphql(
            self.GET_CHANNEL_QUERY,
            variables={"input": {"id": channel_id}},
        )
        channel = data.get("channel")
        if not channel:
            raise BufferPublishError(f"Buffer channel not found: {channel_id}")
        return channel
