"""Read-only cheat-on-content workspace summary helpers."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def summarize_cheat_workspace(workspace_path: str) -> dict[str, Any]:
    path = Path(workspace_path).expanduser()
    summary = _empty_summary(str(path))

    if not path.exists():
        summary["health_issues"].append(
            {"code": "workspace_missing", "message": "Cheat workspace path does not exist."}
        )
        return summary
    if not path.is_dir():
        summary["health_issues"].append(
            {"code": "invalid_workspace", "message": "Cheat workspace path must be a directory."}
        )
        return summary

    state_path = path / ".cheat-state.json"
    state: dict[str, Any] = {}
    if not state_path.exists():
        summary["health_issues"].append(
            {"code": "state_missing", "message": ".cheat-state.json is missing."}
        )
    else:
        try:
            raw_state = json.loads(state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            summary["health_issues"].append(
                {"code": "state_unreadable", "message": ".cheat-state.json is not readable JSON."}
            )
        else:
            if isinstance(raw_state, dict):
                state = raw_state
            else:
                summary["health_issues"].append(
                    {"code": "state_invalid", "message": ".cheat-state.json must contain a JSON object."}
                )

    summary.update(_safe_state_fields(state))
    summary["benchmark_status"] = _presence(path / "benchmark.md")
    summary["candidate_count"] = _candidate_count(path / "candidates.md")
    summary["prediction_count"] = _markdown_count(path / "predictions")
    summary["audience_status"] = _presence(path / "audience.md")
    summary["rubric_memo_status"] = _presence(path / "rubric-memo.md")
    return summary


def cheat_workspace_status(summary: dict[str, Any]) -> str:
    issue_codes = {issue.get("code") for issue in summary.get("health_issues", [])}
    if "workspace_missing" in issue_codes:
        return "missing"
    if "invalid_workspace" in issue_codes:
        return "invalid_workspace"
    if issue_codes & {"state_missing", "state_unreadable", "state_invalid"}:
        return "schema_mismatch"
    return "valid"


def is_remote_workspace_path(workspace_path: str) -> bool:
    return "://" in workspace_path


def _empty_summary(workspace_path: str) -> dict[str, Any]:
    return {
        "workspace_path": workspace_path,
        "state_schema_version": None,
        "skill_version": None,
        "content_form": None,
        "rubric_version": None,
        "calibration_samples": 0,
        "confidence": None,
        "benchmark_status": "missing",
        "candidate_count": 0,
        "prediction_count": 0,
        "pending_retro_count": 0,
        "buffer_count": 0,
        "buffer_status": "unknown",
        "audience_status": "missing",
        "rubric_memo_status": "missing",
        "latest_published_at": None,
        "latest_retro_at": None,
        "latest_bump_at": None,
        "health_issues": [],
    }


def _safe_state_fields(state: dict[str, Any]) -> dict[str, Any]:
    buffer = state.get("buffer") if isinstance(state.get("buffer"), dict) else {}
    pending_retros = state.get("pending_retros")
    return {
        "state_schema_version": _first_present(state, "state_schema_version", "schema_version"),
        "skill_version": state.get("skill_version"),
        "content_form": state.get("content_form"),
        "rubric_version": state.get("rubric_version"),
        "calibration_samples": int(state.get("calibration_samples") or 0),
        "confidence": state.get("confidence"),
        "pending_retro_count": len(pending_retros) if isinstance(pending_retros, list) else int(state.get("pending_retro_count") or 0),
        "buffer_count": int(buffer.get("count") or state.get("buffer_count") or 0),
        "buffer_status": buffer.get("status") or state.get("buffer_status") or "unknown",
        "latest_published_at": state.get("latest_published_at"),
        "latest_retro_at": state.get("latest_retro_at"),
        "latest_bump_at": state.get("latest_bump_at"),
    }


def _first_present(value: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if value.get(key) is not None:
            return value[key]
    return None


def _presence(path: Path) -> str:
    return "present" if path.is_file() else "missing"


def _candidate_count(path: Path) -> int:
    if not path.is_file():
        return 0
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return 0
    bullet_count = sum(1 for line in lines if line.lstrip().startswith(("- ", "* ")))
    if bullet_count:
        return bullet_count
    return sum(1 for line in lines if line.strip() and not line.lstrip().startswith("#"))


def _markdown_count(path: Path) -> int:
    if not path.is_dir():
        return 0
    return len([item for item in path.iterdir() if item.is_file() and item.suffix == ".md"])

