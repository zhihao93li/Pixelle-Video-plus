# Pixelle 系统合同（自动生成）

> 此文件由 `scripts/generate_system_contract.py` 从可执行代码生成，禁止手工修改。
> 本机 Provider 可用性、凭据和启停状态以运行时接口为准，不写入仓库。

## 运行时事实入口

- Agent 能力：`GET /api/agent/capabilities`
- HTTP 合同：`GET /openapi.json`
- API 文档：`GET /docs`

## 状态

- 生产任务：`needs_user | in_progress | failed | produced | cancelled`
- 执行任务：`pending | running | completed | failed | cancelled | interrupted`

## Pipeline

| ID | 输入 | 阶段 | 必需产物 | 发起端 |
| --- | --- | --- | --- | --- |
| `action_transfer` | `reference_video, assets, prompt` | execute_workflow → download_video → save_artifacts | primary_video | react |
| `asset_based` | `assets` | analyze_assets → generate_script → match_assets → generate_tts → compose_video → save_artifacts | primary_video | react, batch |
| `codex_scene_video` | `scenes` | plan_scenes → review_scenes → generate_agent_images → validate_scenes → generate_tts → compose_video → save_artifacts | primary_video | agent |
| `digital_human` | `character_assets` | compose_image → generate_tts → execute_workflow → download_video → save_artifacts | primary_video | react |
| `i2v` | `assets, prompt` | execute_workflow → download_video → save_artifacts | primary_video | react |
| `image_post` | `script` | paginate → generate_image_prompts → generate_media → compose_pages → save_artifacts | cover, page | react, agent, batch |
| `long_form` | `script` | write_article → save_artifacts | article | react, agent, batch |
| `script_to_video` | `script` | split_scenes → generate_image_prompts → generate_tts → generate_media → compose_video → save_artifacts | primary_video | react, agent, batch |
| `topic_to_image_post` | `topic` | generate_script → review_script → paginate → review_pages → generate_image_prompts → generate_media → compose_pages → save_artifacts | cover, page | react, agent, batch |
| `topic_to_long_form` | `topic` | write_article → save_artifacts | article | react, agent, batch |
| `topic_to_video` | `topic` | generate_script → review_script → split_scenes → generate_image_prompts → generate_tts → generate_media → compose_video → save_artifacts | primary_video | react, agent, batch |

## 内置模板

| ID | Pipeline | 输入 | 可覆盖设置 | 访问范围 |
| --- | --- | --- | ---: | --- |
| `codex_image_story_v1` | `codex_scene_video` | `scenes` | 15 | agent |
| `pipeline_asset_based_base_v1` | `asset_based` | `assets` | 6 | public |
| `pipeline_image_post_base_v1` | `image_post` | `script` | 13 | public |
| `pipeline_long_form_base_v1` | `long_form` | `script` | 5 | public |
| `pipeline_standard_base_v1` | `script_to_video` | `script` | 24 | public |
| `pipeline_topic_to_image_post_base_v1` | `topic_to_image_post` | `topic` | 21 | public |
| `pipeline_topic_to_long_form_base_v1` | `topic_to_long_form` | `topic` | 5 | public |
| `pipeline_topic_to_video_base_v1` | `topic_to_video` | `topic` | 29 | public |
| `pixelle_action_transfer_basic_v1` | `action_transfer` | `reference_video, assets, prompt` | 3 | public |
| `pixelle_digital_human_basic_v1` | `digital_human` | `character_assets` | 10 | public |
| `pixelle_i2v_basic_v1` | `i2v` | `assets, prompt` | 4 | public |

## 边界

- 本文件只描述代码内置合同，不包含用户创建的模板和本地覆盖。
- Provider 凭据、模型列表、网络连通性与当前启用状态必须读取运行时接口。
- 产品语义与用户体验边界见 `docs/zh/product/current-product.md`。
- 架构取舍与不可逆决策见 `docs/adr/`。
