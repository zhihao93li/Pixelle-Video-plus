#!/usr/bin/env python3
"""Generate the repository-level Pixelle system contract from executable code."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, get_args

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pixelle_video.content.production_tasks import (  # noqa: E402
    ProductionTask,
    ProductionTaskState,
)
from pixelle_video.content.projects import Project  # noqa: E402
from pixelle_video.generation.defaults import (  # noqa: E402
    build_default_pipeline_manifests,
)
from pixelle_video.generation.schemas import (  # noqa: E402
    GenerationResult,
    GenerationStatus,
)
from pixelle_video.generation.template_overrides import (  # noqa: E402
    OVERRIDABLE_PARAMS,
)
from pixelle_video.generation.templates import (  # noqa: E402
    build_builtin_production_template_registry,
)

JSON_PATH = ROOT / "docs/generated/system-contract.json"
MARKDOWN_PATH = ROOT / "docs/generated/system-contract.md"


def _type_names(expected: type | tuple[type, ...]) -> list[str]:
    candidates = expected if isinstance(expected, tuple) else (expected,)
    return sorted(candidate.__name__ for candidate in candidates)


def build_contract() -> dict[str, Any]:
    manifests = build_default_pipeline_manifests()
    templates = build_builtin_production_template_registry().list()
    manifest_ids = {manifest.id for manifest in manifests}
    orphaned = sorted(
        template.id for template in templates if template.pipeline_id not in manifest_ids
    )
    if orphaned:
        raise ValueError(f"Templates reference unknown pipelines: {', '.join(orphaned)}")

    return {
        "schema_version": 1,
        "generated_from": [
            "pixelle_video/generation/defaults.py",
            "pixelle_video/generation/schemas.py",
            "pixelle_video/generation/templates.py",
            "pixelle_video/generation/template_overrides.py",
            "pixelle_video/content/production_tasks.py",
            "pixelle_video/content/projects.py",
        ],
        "runtime_fact_sources": {
            "agent_capabilities": "/api/agent/capabilities",
            "openapi": "/openapi.json",
            "interactive_api_docs": "/docs",
        },
        "states": {
            "production_task": list(get_args(ProductionTaskState)),
            "generation_task": list(get_args(GenerationStatus)),
        },
        "artifact_types": {
            "production_task": list(
                get_args(ProductionTask.model_fields["artifact_type"].annotation)
            ),
            "generation_result": list(
                get_args(GenerationResult.model_fields["artifact_type"].annotation)
            ),
        },
        "scopes": {
            "project": {
                "purpose": "content_task_artifact_scope",
                "fields": sorted(Project.model_fields),
            }
        },
        "settings": {
            key: {"accepted_types": _type_names(expected)}
            for key, expected in sorted(OVERRIDABLE_PARAMS.items())
        },
        "pipelines": [
            manifest.model_dump(mode="json")
            for manifest in sorted(manifests, key=lambda item: item.id)
        ],
        "templates": [
            {
                "id": template.id,
                "version": template.version,
                "display_name": template.display_name,
                "description": template.description,
                "pipeline_id": template.pipeline_id,
                "access_scope": template.access_scope,
                "enabled_by_code": template.enabled,
                "input_requirements": template.input_requirements,
                "allowed_user_params": template.allowed_user_params,
                "passthrough_input_fields": template.passthrough_input_fields,
                "required_capabilities": template.required_capabilities,
                "fixed_param_keys": sorted(template.fixed_params),
            }
            for template in sorted(templates, key=lambda item: item.id)
        ],
    }


def render_json(contract: dict[str, Any]) -> str:
    return json.dumps(contract, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def render_markdown(contract: dict[str, Any]) -> str:
    lines = [
        "# Pixelle 系统合同（自动生成）",
        "",
        "> 此文件由 `scripts/generate_system_contract.py` 从可执行代码生成，禁止手工修改。",
        "> 本机 Provider 可用性、凭据和启停状态以运行时接口为准，不写入仓库。",
        "",
        "## 运行时事实入口",
        "",
        "- Agent 能力：`GET /api/agent/capabilities`",
        "- HTTP 合同：`GET /openapi.json`",
        "- API 文档：`GET /docs`",
        "",
        "## 状态",
        "",
        f"- 生产任务：`{' | '.join(contract['states']['production_task'])}`",
        f"- 执行任务：`{' | '.join(contract['states']['generation_task'])}`",
        "",
        "## 内容空间",
        "",
        "- 作用：归集和筛选内容、任务与作品。",
        f"- 字段：`{' | '.join(contract['scopes']['project']['fields'])}`",
        "- 不携带生产模板、语言、音色或发布平台默认值。",
        "",
        "## Pipeline",
        "",
        "| ID | 输入 | 阶段 | 必需产物 | 发起端 |",
        "| --- | --- | --- | --- | --- |",
    ]
    for pipeline in contract["pipelines"]:
        required_input = ", ".join(
            field["name"] for field in pipeline["input"]["required_fields"]
        ) or "—"
        stages = " → ".join(stage["id"] for stage in pipeline["stages"])
        outputs = ", ".join(
            output["role"] for output in pipeline["outputs"] if output["required"]
        ) or "—"
        surfaces = ", ".join(pipeline["launch_surfaces"])
        lines.append(
            f"| `{pipeline['id']}` | `{required_input}` | {stages} | {outputs} | {surfaces} |"
        )

    lines.extend(
        [
            "",
            "## 内置模板",
            "",
            "| ID | Pipeline | 输入 | 可覆盖设置 | 访问范围 |",
            "| --- | --- | --- | ---: | --- |",
        ]
    )
    for template in contract["templates"]:
        requirements = ", ".join(template["input_requirements"]) or "—"
        lines.append(
            f"| `{template['id']}` | `{template['pipeline_id']}` | "
            f"`{requirements}` | {len(template['allowed_user_params'])} | "
            f"{template['access_scope']} |"
        )

    lines.extend(
        [
            "",
            "## 边界",
            "",
            "- 本文件只描述代码内置合同，不包含用户创建的模板和本地覆盖。",
            "- Provider 凭据、模型列表、网络连通性与当前启用状态必须读取运行时接口。",
            "- 产品语义与用户体验边界见 `docs/zh/product/current-product.md`。",
            "- 架构取舍与不可逆决策见 `docs/adr/`。",
            "",
        ]
    )
    return "\n".join(lines)


def _check_file(path: Path, expected: str) -> bool:
    if not path.exists():
        print(f"missing generated contract: {path.relative_to(ROOT)}", file=sys.stderr)
        return False
    if path.read_text(encoding="utf-8") != expected:
        print(f"generated contract is stale: {path.relative_to(ROOT)}", file=sys.stderr)
        return False
    return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="Fail if committed generated files differ from executable contracts.",
    )
    args = parser.parse_args()

    contract = build_contract()
    outputs = {
        JSON_PATH: render_json(contract),
        MARKDOWN_PATH: render_markdown(contract),
    }
    if args.check:
        return 0 if all(_check_file(path, content) for path, content in outputs.items()) else 1

    for path, content in outputs.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        print(path.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
