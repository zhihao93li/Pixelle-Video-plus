"""Architecture guards for the production backend boundary."""

import ast
from pathlib import Path


def test_production_backend_does_not_import_legacy_web_ui():
    project_root = Path(__file__).resolve().parents[1]
    violations: list[str] = []

    for package in ("api", "pixelle_video", "agent_plugin"):
        source_root = project_root / package
        for path in source_root.rglob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom):
                    module = node.module or ""
                    imports_web = module == "web" or module.startswith("web.")
                elif isinstance(node, ast.Import):
                    imports_web = any(
                        alias.name == "web" or alias.name.startswith("web.")
                        for alias in node.names
                    )
                else:
                    continue

                if imports_web:
                    relative_path = path.relative_to(project_root)
                    violations.append(f"{relative_path}:{node.lineno}")

    assert violations == [], "production backend imports legacy web UI: " + ", ".join(
        violations
    )
