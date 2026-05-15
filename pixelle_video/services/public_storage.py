"""
Public media storage for publish workflows.

Cloudflare R2 is S3-compatible, so this service accepts an injected S3 client
for tests and builds a boto3 client from environment variables in production.
"""

import os
from pathlib import Path
from urllib.parse import quote
from uuid import uuid4

import httpx


class PublishConfigurationError(RuntimeError):
    """Raised when publish-related configuration is missing or invalid."""


class PublicMediaStorage:
    """Upload generated videos to a public R2 bucket and return stable URLs."""

    def __init__(
        self,
        *,
        bucket: str,
        public_base_url: str,
        client=None,
        account_id: str | None = None,
        access_key_id: str | None = None,
        secret_access_key: str | None = None,
        endpoint_url: str | None = None,
        http_get=None,
        diagnostic_key_factory=None,
    ):
        self.bucket = bucket.strip()
        self.public_base_url = public_base_url.rstrip("/")
        self.account_id = (account_id or "").strip()
        self.access_key_id = (access_key_id or "").strip()
        self.secret_access_key = (secret_access_key or "").strip()
        self.endpoint_url = endpoint_url or (
            f"https://{self.account_id}.r2.cloudflarestorage.com" if self.account_id else None
        )
        self.http_get = http_get or httpx.get
        self.diagnostic_key_factory = diagnostic_key_factory or (
            lambda: f"pixlle/_diagnostics/{uuid4().hex}.mp4"
        )
        self._client = client

        if not self.bucket:
            raise PublishConfigurationError("R2_BUCKET is required")
        if not self.public_base_url:
            raise PublishConfigurationError("R2_PUBLIC_BASE_URL is required")

    @classmethod
    def from_env(cls) -> "PublicMediaStorage":
        """Create storage from R2 environment variables."""
        return cls(
            bucket=os.getenv("R2_BUCKET", ""),
            public_base_url=os.getenv("R2_PUBLIC_BASE_URL", ""),
            account_id=os.getenv("R2_ACCOUNT_ID", ""),
            access_key_id=os.getenv("R2_ACCESS_KEY_ID", ""),
            secret_access_key=os.getenv("R2_SECRET_ACCESS_KEY", ""),
            endpoint_url=os.getenv("R2_ENDPOINT_URL") or None,
        )

    @classmethod
    def from_config(cls, config: dict | None) -> "PublicMediaStorage":
        """Create storage from persisted publish.r2 configuration."""
        config = config or {}
        return cls(
            bucket=config.get("bucket", ""),
            public_base_url=config.get("public_base_url", ""),
            account_id=config.get("account_id", ""),
            access_key_id=config.get("access_key_id", ""),
            secret_access_key=config.get("secret_access_key", ""),
            endpoint_url=config.get("endpoint_url") or None,
        )

    @property
    def client(self):
        if self._client is None:
            if not self.endpoint_url:
                raise PublishConfigurationError("R2_ACCOUNT_ID or R2_ENDPOINT_URL is required")
            if not self.access_key_id:
                raise PublishConfigurationError("R2_ACCESS_KEY_ID is required")
            if not self.secret_access_key:
                raise PublishConfigurationError("R2_SECRET_ACCESS_KEY is required")

            try:
                import boto3
            except ImportError as exc:
                raise PublishConfigurationError("boto3 is required for Cloudflare R2 uploads") from exc

            self._client = boto3.client(
                "s3",
                endpoint_url=self.endpoint_url,
                aws_access_key_id=self.access_key_id,
                aws_secret_access_key=self.secret_access_key,
                region_name="auto",
            )

        return self._client

    def object_key(self, task_id: str) -> str:
        """Return the fixed R2 object key for a generated task."""
        safe_task_id = task_id.strip().strip("/")
        if not safe_task_id:
            raise ValueError("task_id is required")
        return f"pixlle/{safe_task_id}/final.mp4"

    def public_url_for_key(self, key: str) -> str:
        """Build a public URL while preserving path separators."""
        return f"{self.public_base_url}/{quote(key, safe='/')}"

    def upload_video(self, local_path: str | Path, task_id: str) -> str:
        """
        Upload a local MP4 to R2 and return its public URL.

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
            return True, "R2 bucket is reachable"
        except Exception as exc:
            return False, f"R2 bucket check failed: {exc}"

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
                Body=b"pixlle-r2-diagnostic",
                ContentType="video/mp4",
            )
            response = self.http_get(public_url, timeout=10.0, follow_redirects=True)
            status_code = getattr(response, "status_code", None)
            if status_code != 200:
                text = getattr(response, "text", "")
                return False, f"Public R2 URL returned HTTP {status_code}: {text[:200]}"

            ok = True
            message = f"R2 upload and public read succeeded: {public_url}"
        except Exception as exc:
            message = f"R2 upload/public read check failed: {exc}"
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
