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

    YOUTUBE_DEFAULT_CATEGORY_ID = "22"  # People & Blogs

    SUPPORTED_CHANNEL_SERVICES = {
        "instagram": "instagram",
        "instagram-business": "instagram",
        "instagram-personal": "instagram",
        "pinterest": "pinterest",
        "youtube": "youtube",
        "youtube-shorts": "youtube",
        "tiktok": "tiktok",
        "twitter": "x",
        "x": "x",
    }

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

    GET_ORGANIZATIONS_QUERY = """
    query GetOrganizations {
      account {
        organizations {
          id
          name
        }
      }
    }
    """

    LIST_CHANNELS_QUERY = """
    query GetChannels($input: ChannelsInput!) {
      channels(input: $input) {
        id
        name
        displayName
        service
        isQueuePaused
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

    async def list_organizations(self) -> list[dict[str, Any]]:
        """List organizations available to the configured Buffer API key."""
        data = await self._graphql(self.GET_ORGANIZATIONS_QUERY)
        account = data.get("account") or {}
        organizations = account.get("organizations") or []
        return [org for org in organizations if isinstance(org, dict)]

    async def list_channels(self, organization_id: str | None = None) -> list[dict[str, Any]]:
        """List Buffer channels for an organization, defaulting to the first account organization."""
        resolved_organization_id = (organization_id or "").strip()
        if not resolved_organization_id:
            organizations = await self.list_organizations()
            if not organizations:
                raise BufferPublishError("Buffer account has no organizations")
            resolved_organization_id = str(organizations[0].get("id") or "").strip()
            if not resolved_organization_id:
                raise BufferPublishError("Buffer organization id is missing")

        data = await self._graphql(
            self.LIST_CHANNELS_QUERY,
            variables={"input": {"organizationId": resolved_organization_id}},
        )
        channels = data.get("channels") or []
        return [channel for channel in channels if isinstance(channel, dict)]

    @classmethod
    def supported_channel_ids_from_channels(cls, channels: list[dict[str, Any]]) -> dict[str, str]:
        """Return Pixlle-supported platform channel IDs from Buffer channel payloads."""
        supported: dict[str, str] = {}
        for channel in channels:
            channel_id = str(channel.get("id") or "").strip()
            service = str(channel.get("service") or "").strip().lower().replace("_", "-")
            platform = cls.SUPPORTED_CHANNEL_SERVICES.get(service)
            if not channel_id or not platform or platform in supported:
                continue
            supported[platform] = channel_id
        return supported

    async def create_video_post(
        self,
        *,
        channel_id: str,
        text: str,
        video_url: str,
        title: str | None = None,
        platform: str | None = None,
        due_at: str | None = None,
    ) -> BufferPostResult:
        """Create a Buffer video post for a single connected channel."""
        clean_title = (title or "").strip()
        video_asset: dict[str, Any] = {"url": video_url}
        if clean_title:
            video_asset["metadata"] = {"title": clean_title}

        post_input: dict[str, Any] = {
            "text": text,
            "channelId": channel_id,
            "schedulingType": "automatic",
            "mode": "addToQueue",
            "assets": [{"video": video_asset}],
        }

        if clean_title and (platform or "").strip().lower() == "youtube":
            post_input["metadata"] = {
                "youtube": {
                    "title": clean_title,
                    "categoryId": self.YOUTUBE_DEFAULT_CATEGORY_ID,
                }
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
