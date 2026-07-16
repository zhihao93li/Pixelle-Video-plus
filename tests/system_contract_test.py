import json

from scripts.generate_system_contract import (
    JSON_PATH,
    MARKDOWN_PATH,
    build_contract,
    render_json,
    render_markdown,
)


def test_generated_system_contract_is_current():
    contract = build_contract()

    assert JSON_PATH.read_text(encoding="utf-8") == render_json(contract)
    assert MARKDOWN_PATH.read_text(encoding="utf-8") == render_markdown(contract)


def test_builtin_templates_reference_declared_pipelines():
    contract = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    pipeline_ids = {pipeline["id"] for pipeline in contract["pipelines"]}

    assert pipeline_ids
    assert contract["templates"]
    assert all(template["pipeline_id"] in pipeline_ids for template in contract["templates"])


def test_generated_catalog_has_unique_ids_and_setting_keys():
    contract = build_contract()
    pipeline_ids = [pipeline["id"] for pipeline in contract["pipelines"]]
    template_ids = [template["id"] for template in contract["templates"]]

    assert len(pipeline_ids) == len(set(pipeline_ids))
    assert len(template_ids) == len(set(template_ids))
    for template in contract["templates"]:
        keys = template["allowed_user_params"]
        assert len(keys) == len(set(keys)), template["id"]
