#!/usr/bin/env python3
"""Archive the retired Ops SQLite store after the native project store exists.

Run from the repository root:
  uv run python scripts/archive_legacy_ops.py --dry-run
  uv run python scripts/archive_legacy_ops.py --apply
  uv run python scripts/archive_legacy_ops.py --verify
"""

from __future__ import annotations

import argparse
import ast
import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
ARCHIVE_ROOT = DATA / "archive" / "legacy-ops"
LEGACY_FILES = ("ops.db", "ops.db-shm", "ops.db-wal")


def _source_violations() -> list[str]:
    violations: list[str] = []
    for package in ("api", "pixelle_video", "agent_plugin"):
        for path in (ROOT / package).rglob("*.py"):
            source = path.read_text(encoding="utf-8")
            if "ops.db" in source:
                violations.append(f"runtime reference: {path.relative_to(ROOT)}")
            tree = ast.parse(source, filename=str(path))
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom):
                    names = [node.module or ""]
                elif isinstance(node, ast.Import):
                    names = [alias.name for alias in node.names]
                else:
                    continue
                if any(name == "ops" or name.startswith("ops.") for name in names):
                    violations.append(f"Ops import: {path.relative_to(ROOT)}:{node.lineno}")
    return violations


def _preflight() -> list[str]:
    errors = _source_violations()
    if not (ROOT / "agent_plugin" / "server.py").is_file():
        errors.append("agent_plugin/server.py 不存在")
    token_path = Path(
        os.environ.get("PIXELLE_AGENT_TOKEN_FILE", str(DATA / "agent-token"))
    ).expanduser()
    if not os.environ.get("PIXELLE_AGENT_TOKEN", "").strip() and not token_path.is_file():
        errors.append("Agent Token 尚未生成；先启动一次 API")
    projects_path = DATA / "projects.json"
    try:
        projects = json.loads(projects_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        errors.append("data/projects.json 不存在或不可读，不能安全归档旧项目数据")
    else:
        if not projects.get("projects"):
            errors.append("data/projects.json 没有原生项目，不能安全归档旧项目数据")
    return errors


def _latest_archive() -> Path | None:
    candidates = sorted(path for path in ARCHIVE_ROOT.glob("*") if path.is_dir())
    return candidates[-1] if candidates else None


def dry_run() -> int:
    errors = _preflight()
    present = [name for name in LEGACY_FILES if (DATA / name).exists()]
    if errors:
        print("BLOCKED")
        for error in errors:
            print(f"- {error}")
        return 1
    print("READY")
    print(f"legacy_files={present}")
    print(f"archive_root={ARCHIVE_ROOT}")
    return 0


def apply() -> int:
    if dry_run() != 0:
        return 1
    present = [name for name in LEGACY_FILES if (DATA / name).exists()]
    if not present:
        print("NOOP: 原位置没有旧 Ops 数据")
        return verify()
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    destination = ARCHIVE_ROOT / timestamp
    destination.mkdir(parents=True, exist_ok=False)
    for name in present:
        shutil.move(str(DATA / name), destination / name)
    manifest = {
        "archived_at": datetime.now(timezone.utc).isoformat(),
        "files": present,
        "source": "data",
    }
    (destination / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"ARCHIVED: {destination}")
    return verify()


def verify() -> int:
    errors = _preflight()
    remaining = [name for name in LEGACY_FILES if (DATA / name).exists()]
    if remaining:
        errors.append(f"原位置仍有旧文件：{remaining}")
    latest = _latest_archive()
    if latest is None or not (latest / "manifest.json").is_file():
        errors.append("没有找到带 manifest.json 的旧 Ops 归档")
    elif not (latest / "ops.db").is_file():
        errors.append(f"归档不完整：{latest / 'ops.db'} 不存在")
    if errors:
        print("VERIFY_FAILED")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"VERIFIED: {latest}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    if args.apply:
        return apply()
    if args.verify:
        return verify()
    return dry_run()


if __name__ == "__main__":
    raise SystemExit(main())
