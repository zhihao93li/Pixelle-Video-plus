"""Build platform publish packages from approved Pixelle Ops content."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


class PublishService:
    """Render a stable, copyable publish package without touching platforms."""

    def build_package(
        self,
        *,
        experiment_view: dict[str, Any],
        channel_account: dict[str, Any],
    ) -> dict[str, Any]:
        experiment = experiment_view["experiment"]
        content_item = _select_content_item(experiment_view)
        asset_check = _select_asset_check(experiment_view, content_item.get("id"))
        draft = _select_approved_draft(experiment_view.get("events", []))
        title = _clean_text(draft.get("payload", {}).get("title")) or _clean_text(content_item.get("title")) or experiment["title"]
        body = _clean_text(draft.get("payload", {}).get("text"))
        tags = _extract_tags(draft.get("payload", {}))
        asset_ref = content_item.get("asset_ref") or {}
        asset_path = _asset_path(asset_ref)
        asset_hash = _asset_hash(asset_path, asset_ref)
        approved_text_hash = _hash_json({"title": title, "body": body, "tags": tags})
        platform = channel_account["platform"]
        content_type = _content_type(content_item)
        copy_blocks = _copy_blocks(
            title=title,
            body=body,
            tags=tags,
            asset_path=asset_path,
            platform=platform,
            account_name=channel_account["account_name"],
        )
        checklist = _checklist(
            channel_account=channel_account,
            asset_check=asset_check,
            title=title,
            body=body,
            tags=tags,
            asset_path=asset_path,
        )
        package_hash = _hash_json(
            {
                "project_id": experiment["project_id"],
                "cycle_id": experiment["cycle_id"],
                "experiment_id": experiment["id"],
                "content_item_id": content_item["id"],
                "channel_account_id": channel_account["id"],
                "platform": platform,
                "content_type": content_type,
                "title": title,
                "body": body,
                "tags": tags,
                "asset_hash": asset_hash,
                "approved_text_hash": approved_text_hash,
            }
        )
        package_id = f"pkg_{package_hash[:12]}"
        asset_handoff = {
            "path": asset_path,
            "file_name": Path(asset_path).name if asset_path else "",
            "duration": asset_ref.get("duration") or asset_check.get("payload", {}).get("checks", {}).get("duration_seconds"),
            "file_size": asset_ref.get("file_size") or asset_check.get("payload", {}).get("checks", {}).get("local_file_size"),
            "asset_hash": asset_hash,
            "asset_url": content_item.get("asset_url"),
            "media_type": content_item.get("asset_media_type") or content_type,
            "preview_available": content_item.get("asset_preview_available") is True,
        }
        return {
            "id": package_id,
            "project_id": experiment["project_id"],
            "cycle_id": experiment["cycle_id"],
            "experiment_id": experiment["id"],
            "content_item_id": content_item["id"],
            "channel_account_id": channel_account["id"],
            "platform": platform,
            "account_name": channel_account["account_name"],
            "account_handle": channel_account.get("account_handle"),
            "content_type": content_type,
            "status": "ready" if _is_package_ready(checklist) else "draft",
            "title": title,
            "body": body,
            "tags": tags,
            "platform_fields": _platform_fields(title=title, body=body, tags=tags, platform=platform),
            "copy_blocks": copy_blocks,
            "checklist": checklist,
            "asset_handoff": asset_handoff,
            "approved_draft_id": draft.get("id"),
            "approved_text_hash": approved_text_hash,
            "asset_hash": asset_hash,
            "package_hash": package_hash,
        }


def _select_content_item(experiment_view: dict[str, Any]) -> dict[str, Any]:
    content_item = experiment_view.get("content_item")
    if isinstance(content_item, dict) and content_item:
        return content_item
    items = experiment_view.get("content_items") or []
    if items:
        return items[-1]
    raise ValueError("Publish package requires a content item.")


def _select_asset_check(experiment_view: dict[str, Any], content_item_id: str | None) -> dict[str, Any]:
    asset_check = experiment_view.get("asset_check")
    if isinstance(asset_check, dict) and asset_check:
        return asset_check
    for event in reversed(experiment_view.get("events", [])):
        if event.get("event_type") == "asset_checked" and (
            not content_item_id or event.get("content_item_id") == content_item_id
        ):
            return event
    return {}


def _select_approved_draft(events: list[dict[str, Any]]) -> dict[str, Any]:
    approval = _latest_event(events, "generation_draft_approved")
    if approval:
        draft_id = _clean_text(approval.get("payload", {}).get("draft_id"))
        if draft_id:
            for event in events:
                if event.get("id") == draft_id:
                    return event
    return _latest_event(events, "generation_drafted") or _latest_event(events, "generation_requested") or {}


def _latest_event(events: list[dict[str, Any]], event_type: str) -> dict[str, Any] | None:
    for event in reversed(events):
        if event.get("event_type") == event_type:
            return event
    return None


def _extract_tags(payload: dict[str, Any]) -> list[str]:
    values = payload.get("tags") or payload.get("hashtags") or payload.get("publish_tags")
    params = payload.get("generation_params") or {}
    if not values and isinstance(params, dict):
        values = params.get("tags") or params.get("hashtags") or params.get("publish_tags")
    if isinstance(values, str):
        raw_items = values.replace(",", " ").split()
    elif isinstance(values, list):
        raw_items = [str(item) for item in values]
    else:
        raw_items = []
    tags = []
    for item in raw_items:
        tag = item.strip()
        if not tag:
            continue
        tags.append(tag if tag.startswith("#") else f"#{tag}")
    return tags


def _copy_blocks(
    *,
    title: str,
    body: str,
    tags: list[str],
    asset_path: str,
    platform: str,
    account_name: str,
) -> list[dict[str, Any]]:
    tags_text = " ".join(tags)
    package_markdown = "\n\n".join(
        [
            f"平台：{platform}",
            f"账号：{account_name}",
            f"标题：{title}",
            f"正文：\n{body}",
            f"标签：{tags_text or '未配置'}",
            f"资产：{asset_path or '未找到资产路径'}",
        ]
    )
    return [
        {"key": "title", "label": "发布标题", "value": title, "kind": "text", "required": True},
        {"key": "body", "label": "发布正文", "value": body, "kind": "long_text", "required": True},
        {"key": "tags", "label": "标签", "value": tags_text, "kind": "text", "required": False},
        {
            "key": "full_package_markdown",
            "label": "完整发布包",
            "value": package_markdown,
            "kind": "long_text",
            "required": True,
        },
        {"key": "asset_path", "label": "资产文件", "value": asset_path, "kind": "path", "required": True},
    ]


def _checklist(
    *,
    channel_account: dict[str, Any],
    asset_check: dict[str, Any],
    title: str,
    body: str,
    tags: list[str],
    asset_path: str,
) -> list[dict[str, str]]:
    asset_status = asset_check.get("payload", {}).get("status")
    return [
        {
            "key": "account_confirmed",
            "label": "账号已确认",
            "status": "passed" if channel_account.get("id") else "missing",
            "detail": channel_account.get("account_name") or "未选择平台账号",
        },
        {
            "key": "asset_checked",
            "label": "资产已检查",
            "status": "passed" if asset_status == "passed" else "missing",
            "detail": f"asset check: {asset_status or 'missing'}",
        },
        {
            "key": "asset_ready",
            "label": "资产可交付",
            "status": "passed" if asset_path else "missing",
            "detail": asset_path or "未找到资产路径",
        },
        {"key": "title_ready", "label": "标题已准备", "status": "passed" if title else "missing", "detail": title or "缺标题"},
        {"key": "body_ready", "label": "正文已准备", "status": "passed" if body else "missing", "detail": "已准备" if body else "缺正文"},
        {
            "key": "tags_ready",
            "label": "标签已准备",
            "status": "passed" if tags else "warning",
            "detail": " ".join(tags) if tags else "未配置标签",
        },
        {"key": "cover_ready", "label": "封面待确认", "status": "warning", "detail": "当前未绑定独立封面资产"},
    ]


def _platform_fields(*, title: str, body: str, tags: list[str], platform: str) -> dict[str, Any]:
    return {
        "platform": platform,
        "title": title,
        "body": body,
        "tags": tags,
    }


def _is_package_ready(checklist: list[dict[str, str]]) -> bool:
    required_keys = {"account_confirmed", "asset_checked", "asset_ready", "title_ready", "body_ready"}
    required_items = [item for item in checklist if item["key"] in required_keys]
    return all(item["status"] == "passed" for item in required_items)


def _content_type(content_item: dict[str, Any]) -> str:
    kind = _clean_text(content_item.get("kind"))
    return "video" if kind == "video" else kind or "unknown"


def _asset_path(asset_ref: dict[str, Any]) -> str:
    for key in ("video_path", "path", "output_path", "asset_url", "url", "uri"):
        value = _clean_text(asset_ref.get(key))
        if value:
            return value
    return ""


def _asset_hash(asset_path: str, asset_ref: dict[str, Any]) -> str:
    if asset_path:
        path = Path(asset_path).expanduser()
        if path.is_file():
            digest = hashlib.sha256()
            with path.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    digest.update(chunk)
            return digest.hexdigest()
    return _hash_json(asset_ref)


def _hash_json(value: dict[str, Any]) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _clean_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()
