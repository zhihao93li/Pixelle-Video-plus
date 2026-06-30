from __future__ import annotations

from typing import Any


def build_generation_summary(metadata: dict[str, Any] | None) -> dict[str, Any]:
    source = metadata or {}
    return {
        "production_template": source.get("production_template"),
        "compose_runtime": source.get("compose_runtime"),
        "quality_profile": source.get("quality_profile"),
        "quality_review": summarize_quality_review(source.get("quality_review")),
        "asset_manifest": summarize_asset_manifest(source.get("asset_manifest")),
    }


def summarize_quality_review(quality_review: Any) -> dict[str, Any] | None:
    if not isinstance(quality_review, dict):
        return None
    return {
        "status": quality_review.get("status"),
        "summary": quality_review.get("summary"),
        "failures": _quality_review_failures(quality_review),
    }


def summarize_asset_manifest(asset_manifest: Any) -> dict[str, Any] | None:
    if not isinstance(asset_manifest, dict):
        return None
    assets = asset_manifest.get("assets")
    if not isinstance(assets, list):
        assets = []
    return {
        "asset_count": len(assets),
        "roles": _unique_in_order(
            str(asset.get("role"))
            for asset in assets
            if isinstance(asset, dict) and asset.get("role")
        ),
        "kinds": sorted(
            {
                str(asset.get("kind"))
                for asset in assets
                if isinstance(asset, dict) and asset.get("kind")
            }
        ),
    }


def _quality_review_failures(quality_review: dict[str, Any]) -> list[str]:
    failures = []
    for check in quality_review.get("checks") or []:
        if isinstance(check, dict) and check.get("status") == "failed":
            failures.append(str(check.get("message") or check.get("id") or "Quality check failed."))
    return failures


def _unique_in_order(values) -> list[str]:
    seen = set()
    unique = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        unique.append(value)
    return unique
