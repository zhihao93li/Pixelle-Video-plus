import json
from pathlib import Path
from typing import Any

from pixelle_video.utils.os_util import get_data_path

RUNNINGHUB_SOURCE = "runninghub"
WORKFLOW_KIND_PREFIXES = {
    "image": "image",
    "video": "video",
    "tts": "tts",
}


def _get_runninghub_workflows_dir(base_dir: Path | str | None = None) -> Path:
    if base_dir is not None:
        return Path(base_dir)
    return Path(get_data_path("workflows", RUNNINGHUB_SOURCE))


def _normalize_kind(kind: str) -> str:
    normalized = kind.strip().lower()
    if normalized not in WORKFLOW_KIND_PREFIXES:
        valid = ", ".join(sorted(WORKFLOW_KIND_PREFIXES))
        raise ValueError(f"Invalid workflow kind '{kind}'. Expected one of: {valid}")
    return normalized


def _slugify_workflow_name(name: str) -> str:
    slug_parts = []
    previous_was_separator = False
    for char in name.strip().lower():
        if char.isalnum():
            slug_parts.append(char)
            previous_was_separator = False
        elif not previous_was_separator:
            slug_parts.append("_")
            previous_was_separator = True

    slug = "".join(slug_parts).strip("_")
    if not slug:
        raise ValueError("Workflow name is required")
    return slug


def build_runninghub_workflow_filename(kind: str, name: str) -> str:
    """Build the filename used by the existing workflow scanners."""
    normalized_kind = _normalize_kind(kind)
    slug = _slugify_workflow_name(name)

    for prefix in WORKFLOW_KIND_PREFIXES.values():
        if slug.startswith(f"{prefix}_"):
            slug = slug[len(prefix) + 1 :]
            break

    return f"{WORKFLOW_KIND_PREFIXES[normalized_kind]}_{slug}.json"


def _validate_workflow_id(workflow_id: str) -> str:
    normalized = workflow_id.strip()
    if not normalized.isdigit():
        raise ValueError("RunningHub workflow_id must be numeric")
    return normalized


def create_runninghub_workflow_file(
    *,
    kind: str,
    name: str,
    workflow_id: str,
    overwrite: bool = False,
    base_dir: Path | str | None = None,
) -> dict[str, str]:
    """Create a local RunningHub wrapper workflow file."""
    filename = build_runninghub_workflow_filename(kind, name)
    normalized_workflow_id = _validate_workflow_id(workflow_id)

    workflows_dir = _get_runninghub_workflows_dir(base_dir)
    workflows_dir.mkdir(parents=True, exist_ok=True)
    target = workflows_dir / filename

    if target.exists() and not overwrite:
        raise FileExistsError(str(target))

    target.write_text(
        json.dumps(
            {
                "source": RUNNINGHUB_SOURCE,
                "workflow_id": normalized_workflow_id,
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )

    return {
        "filename": filename,
        "key": f"{RUNNINGHUB_SOURCE}/{filename}",
        "path": str(target),
        "workflow_id": normalized_workflow_id,
    }


def _read_runninghub_wrapper(path: Path) -> dict[str, Any] | None:
    try:
        content = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None

    workflow_id = str(content.get("workflow_id") or "").strip()
    if content.get("source") != RUNNINGHUB_SOURCE or not workflow_id:
        return None

    return {
        "filename": path.name,
        "key": f"{RUNNINGHUB_SOURCE}/{path.name}",
        "path": str(path),
        "workflow_id": workflow_id,
    }


def list_custom_runninghub_workflows(base_dir: Path | str | None = None) -> list[dict[str, str]]:
    workflows_dir = _get_runninghub_workflows_dir(base_dir)
    if not workflows_dir.exists():
        return []

    workflows = []
    for path in sorted(workflows_dir.glob("*.json")):
        workflow = _read_runninghub_wrapper(path)
        if workflow is not None:
            workflows.append(workflow)

    return workflows
