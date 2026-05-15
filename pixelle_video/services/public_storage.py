"""
Public media storage for publish workflows.

Tencent COS is S3-compatible, so this service accepts an injected S3 client
for tests and builds a boto3 client from saved configuration in production.
"""

import os
from pathlib import Path
from urllib.parse import quote
from uuid import uuid4

import httpx


class PublishConfigurationError(RuntimeError):
    """Raised when publish-related configuration is missing or invalid."""


class PublicMediaStorage:
    """Upload generated videos to a public object storage bucket and return stable URLs."""

    def __init__(
        self,
        *,
        bucket: str,
        public_base_url: str,
        client=None,
        provider_name: str = "Tencent COS",
        region: str | None = None,
        access_key_id: str | None = None,
        secret_access_key: str | None = None,
        endpoint_url: str | None = None,
        http_get=None,
        diagnostic_key_factory=None,
        addressing_style: str = "virtual",
    ):
        self.bucket = bucket.strip()
        self.public_base_url = public_base_url.rstrip("/")
        self.provider_name = provider_name
        self.region = (region or "").strip()
        self.access_key_id = (access_key_id or "").strip()
        self.secret_access_key = (secret_access_key or "").strip()
        self.endpoint_url = endpoint_url or self._default_cos_endpoint(self.region)
        self.http_get = http_get or httpx.get
        self.diagnostic_key_factory = diagnostic_key_factory or (
            lambda: f"pixlle/_diagnostics/{uuid4().hex}.mp4"
        )
        self.addressing_style = addressing_style
        self._client = client

        if not self.bucket:
            raise PublishConfigurationError("COS bucket is required")
        if not self.public_base_url:
            raise PublishConfigurationError("COS public base URL is required")

    @staticmethod
    def _default_cos_endpoint(region: str | None) -> str | None:
        region = (region or "").strip()
        if not region:
            return None
        return f"https://cos.{region}.myqcloud.com"

    @property
    def display_name(self) -> str:
        return self.provider_name

    @classmethod
    def from_env(cls) -> "PublicMediaStorage":
        """Create storage from Tencent COS environment variables."""
        return cls(
            bucket=os.getenv("COS_BUCKET", ""),
            public_base_url=os.getenv("COS_PUBLIC_BASE_URL", ""),
            region=os.getenv("COS_REGION", ""),
            access_key_id=os.getenv("COS_SECRET_ID", ""),
            secret_access_key=os.getenv("COS_SECRET_KEY", ""),
            endpoint_url=os.getenv("COS_ENDPOINT_URL") or None,
        )

    @classmethod
    def from_config(cls, config: dict | None) -> "PublicMediaStorage":
        """Create storage from persisted publish.cos configuration."""
        config = config or {}
        return cls(
            bucket=config.get("bucket", ""),
            public_base_url=config.get("public_base_url", ""),
            region=config.get("region", ""),
            access_key_id=config.get("secret_id", "") or config.get("access_key_id", ""),
            secret_access_key=config.get("secret_key", "") or config.get("secret_access_key", ""),
            endpoint_url=config.get("endpoint_url") or None,
        )

    @property
    def client(self):
        if self._client is None:
            if not self.endpoint_url:
                raise PublishConfigurationError("COS region or COS endpoint URL is required")
            if not self.access_key_id:
                raise PublishConfigurationError("COS SecretId is required")
            if not self.secret_access_key:
                raise PublishConfigurationError("COS SecretKey is required")

            try:
                import boto3
                from botocore.config import Config
            except ImportError as exc:
                raise PublishConfigurationError("boto3 is required for Tencent COS uploads") from exc

            self._client = boto3.client(
                "s3",
                endpoint_url=self.endpoint_url,
                aws_access_key_id=self.access_key_id,
                aws_secret_access_key=self.secret_access_key,
                region_name=self.region or "auto",
                config=Config(s3={"addressing_style": self.addressing_style}),
            )

        return self._client

    def object_key(self, task_id: str) -> str:
        """Return the fixed object key for a generated task."""
        safe_task_id = task_id.strip().strip("/")
        if not safe_task_id:
            raise ValueError("task_id is required")
        return f"pixlle/{safe_task_id}/final.mp4"

    def public_url_for_key(self, key: str) -> str:
        """Build a public URL while preserving path separators."""
        return f"{self.public_base_url}/{quote(key, safe='/')}"

    def upload_video(self, local_path: str | Path, task_id: str) -> str:
        """
        Upload a local MP4 and return its public URL.

        The bucket must already be configured for public reads or fronted by a
        public domain. This method does not create buckets or lifecycle rules.
        """
        video_path = Path(local_path)
        if not video_path.exists() or not video_path.is_file():
            raise FileNotFoundError(str(video_path))

        key = self.object_key(task_id)
        with open(video_path, "rb") as body:
            self.client.put_object(
                Bucket=self.bucket,
                Key=key,
                Body=body,
                ContentType="video/mp4",
            )

        return self.public_url_for_key(key)

    def check_bucket_access(self) -> tuple[bool, str]:
        """Run a non-mutating bucket reachability check."""
        try:
            self.client.head_bucket(Bucket=self.bucket)
            return True, f"{self.display_name} bucket is reachable"
        except Exception as exc:
            return False, f"{self.display_name} bucket check failed: {exc}"

    def check_upload_roundtrip(self) -> tuple[bool, str]:
        """Verify upload credentials and anonymous public read with a temporary object."""
        key = self.diagnostic_key_factory()
        public_url = self.public_url_for_key(key)
        ok = False
        message = ""
        cleanup_error = None

        try:
            self.client.put_object(
                Bucket=self.bucket,
                Key=key,
                Body=b"pixlle-cos-diagnostic",
                ContentType="video/mp4",
            )
            response = self.http_get(public_url, timeout=10.0, follow_redirects=True)
            status_code = getattr(response, "status_code", None)
            if status_code != 200:
                text = getattr(response, "text", "")
                return False, f"Public {self.display_name} URL returned HTTP {status_code}: {text[:200]}"

            ok = True
            message = f"{self.display_name} upload and public read succeeded: {public_url}"
        except Exception as exc:
            message = f"{self.display_name} upload/public read check failed: {exc}"
        finally:
            try:
                self.client.delete_object(Bucket=self.bucket, Key=key)
            except Exception as exc:
                cleanup_error = exc

        if ok and cleanup_error:
            message = f"{message}; cleanup failed: {cleanup_error}"
        elif not ok and cleanup_error:
            message = f"{message}; cleanup failed: {cleanup_error}"

        return ok, message
