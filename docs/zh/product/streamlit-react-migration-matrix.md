# Streamlit 到 React 全功能迁移矩阵

## 迁移原则

React 是新的主入口，Streamlit 在迁移完成前保留为 legacy/debug 入口。迁移目标是保留能力并产品化，不是逐像素复制 Streamlit 表单。

普通用户只选择生成能力或生产模板，不在每次生成时选择 provider、workflow、runtime。底层 provider、workflow、TTS、合成 runtime 归入模板配置或高级设置。

## 当前状态

下表记录的是“功能入口/API 是否已经迁移”。它不是 Streamlit 下线证明。按当前验收标准，只有入口、API、真实任务、真实结果/失败、历史、设置、发布都能在 React 中完成，才算对应能力完成迁移。

| 区域 | Streamlit 来源 | React/API 状态 | 迁移结论 |
| --- | --- | --- | --- |
| 已有文案生成视频 | `web/pipelines/standard.py` + `web/components/output_preview.py` | 已接入 production template task，支持真实任务轮询 | 迁移到 React 主生成入口 |
| 静态字幕短视频 | `web/components/style_config.py` 的 `static` 模板类型 + `web/pipelines/standard.py` | 新增 `petwoods_xhs_static_subtitle_v1` production template，固定 `1080x1920/static_default.html`，不触发 RunningHub/ComfyUI 媒体生成 | 迁移到 React 主生成入口；作为 provider-independent 的真实成片路径 |
| 选题生成视频 | `web/components/content_input.py` | 新增 `petwoods_xhs_topic_to_video_v1` 模板，走 standard/topic | 迁移到 React 主生成入口 |
| 标准高级参数 | `web/components/style_config.py` | 已接入模板参数白名单、media_width/media_height、视觉上下文、提示词规则、BGM、TTS 模式、reference audio 和真实预览；provider/runtime 不放入普通主流程 | 迁移到 React 高级设置折叠区 |
| BGM 选择/上传/预览 | `web/components/content_input.py` | 已接入资源 API `/api/resources/bgm`、`/api/resources/bgm/upload` 和 React 高级设置；上传后保存到自定义 BGM 资源并可预览 | 迁移到 React 高级设置折叠区 |
| TTS 预览 | `web/components/style_config.py` | 已接入 React 高级设置，调用真实 `/api/tts/synthesize`，展示音频或真实失败 | 迁移到 React 高级设置折叠区 |
| 模板预览 | `web/components/style_config.py` | 已接入 React 高级设置，调用真实 `/api/frame/render` 和 `/api/frame/template/params`，展示帧图或真实失败 | 迁移到 React 高级设置折叠区 |
| 媒体工作流预览 | `web/components/style_config.py` | 已新增 `/api/media/generate`，React 调用真实 media workflow 预览图片/视频，失败展示真实错误 | 迁移到 React 高级设置折叠区 |
| 素材生成视频 | `web/pipelines/asset_based.py` | 已接入素材上传、标题、目标、时长、BGM 选择/上传/预览、voice、语速和 asset template task；source/provider 固定在模板配置里 | 迁移到 React 主生成入口 |
| 真实素材混剪 | `web/pipelines/asset_based.py` | 已作为 montage production template 接入，支持同一套素材、BGM 选择/上传/预览、voice、语速输入 | 迁移到 React 主生成入口 |
| 批量生成 | `web/components/output_preview.py` + `web/utils/batch_manager.py` | 已接入 `/api/generation/batches`，支持 topic/script 批量提交、共享分镜/拆分、BGM 选择/上传/预览、TTS、画面模板、模板参数、媒体 workflow 和真实预览；batch 持久化、逐项 task 状态、失败原因和失败/取消项重试已覆盖 | 迁移到 React 复杂生产入口 |
| 文案审核后生成 | `web/components/script_review_workflow.py` | 已接入 `/api/generation/script-review/*`，支持多语言 draft 生成、持久化、人工编辑、语言级脚本模型/Prompt 覆盖、每语言 Fish TTS、审核后提交真实 generation batch | 迁移到 React 复杂生产入口 |
| 图片生成视频 I2V | `web/pipelines/i2v.py` | 已进入 generation registry，`pixelle_i2v_basic_v1` 可通过 React 特殊生成入口提交统一 task | 迁移到 React 特殊生成入口，workflow 固定在模板配置里 |
| 动作迁移视频 | `web/pipelines/action_transfer.py` | 已进入 generation registry，`pixelle_action_transfer_basic_v1` 可通过 React 特殊生成入口提交统一 task；duration 为空时自动读取参考视频时长并限制到 30 秒 | 迁移到 React 特殊生成入口，workflow 固定在模板配置里 |
| 数字人视频 | `web/pipelines/digital_human.py` | 已进入 generation registry，`pixelle_digital_human_basic_v1` 可通过 React 特殊生成入口提交统一 task；支持 customize 文案模式和 digital 商品标题/商品图自动文案模式 | 迁移到 React 特殊生成入口，三段 workflow 固定在模板配置里 |
| 历史记录 | `web/pages/2_📚_History.py` | 已支持筛选、排序、分页、详情、storyboard 帧媒体预览、成片预览/下载、删除确认；已修复中文成片文件名在 `/api/files` 预览/下载时的响应头编码问题 | 迁移到 React 日常管理入口 |
| 发布到 Buffer | `web/pages/2_📚_History.py` | 已支持平台多选、YouTube title 校验、caption/hashtags、queue/scheduled、timezone、配置检查、发布记录展示；Settings 已支持拉取 Buffer Channels | 迁移到 React 日常管理入口 |
| 系统设置 | `web/pages/3_⚙️_Settings.py` | 已支持配置读写、重置、LLM 模型加载/测试、ComfyUI 测试、RunningHub workflow 注册/列表、Fish Audio、Buffer channel 拉取、COS 配置、资源读取和生产前置诊断 `/api/settings/diagnostics` | 迁移到 React 设置页，仍需生产配置逐项验收 |
| 帮助页 | `web/pages/4_❓_Help.py` | FAQ 已迁移到 React Help 页和 `/api/help/faq` | 迁移到 React Help 页 |

## 阶段验收

## 真实验收记录

### 2026-07-03 22:07-22:28 非发布真实验收增量

本轮按“不发布，Buffer 用户自测”的边界执行。没有调用 `/api/publish/tasks/{task_id}`，没有创建 Buffer post。

| 能力 | 验收命令/证据 | 结论 |
| --- | --- | --- |
| 已有文案生成视频 | `--real-template petwoods_xhs_daily_v1 --no-cancel-on-timeout --timeout 300` 通过；generation task `0ef1ceee-c178-4e57-b018-0cc8043ef90e`，产物 `/output/20260703_220708_b6eb/final.mp4` | 通过 |
| 选题生成视频 | `--real-template petwoods_xhs_topic_to_video_v1 --no-cancel-on-timeout --timeout 300` 通过；generation task `e30a4636-7cb9-47a4-8988-95b01246d709`，产物 `/output/20260703_220813_ef6b/final.mp4` | 通过 |
| 高质量解释视频 | 首次失败暴露根因：`npx hyperframes lint` 需要交互式安装确认，导致 API runtime 阻塞；已修复为 `npx --yes` 且合成 runtime 在线程执行。复跑 `--real-template petwoods_xhs_quality_explainer_v1 --no-cancel-on-timeout --timeout 360` 通过；generation task `4aa7c445-c917-4b2d-9da1-91f836e779c0`，`compose_runtime=hyperframes`，产物 `/output/20260703_221331_134c/final.mp4` | 通过 |
| 素材增强视频 | `--real-template petwoods_xhs_asset_enhanced_v1 --no-cancel-on-timeout --timeout 300` 通过；generation task `7ebf5050-f636-435b-9822-3ed91595008c`，产物 `/output/20260703_221438_42da/猫咪日常素材.mp4` | 通过 |
| 真实素材 montage | `--real-template petwoods_xhs_real_material_montage_v1 --no-cancel-on-timeout --timeout 300` 通过；generation task `0e4ebd8d-8d23-43d5-87e0-f928855a5b79`，产物 `/output/20260703_221543_4731/猫咪日常素材.mp4` | 通过 |
| I2V | `--real-template pixelle_i2v_basic_v1 --no-cancel-on-timeout --timeout 300` 通过；RunningHub provider task `2073048268757229569`，generation task `3d112b8f-83d4-4168-97a6-740a4aca5723`，产物 `/output/20260703_221635_f679/final.mp4` | 通过 |
| 动作迁移 | `--real-template pixelle_action_transfer_basic_v1 --no-cancel-on-timeout --timeout 300` 失败；RunningHub provider task `2073049508220198914` 返回 `FAILED`，本地 task `2ba7cf2d-214a-427d-bbcc-414a05004a9d` 失败，错误 `Workflow did not return a video. Check workflow configuration.` | 未通过，需要 RunningHub workflow 侧排查 |
| 数字人视频 | `--real-template pixelle_digital_human_basic_v1 --no-cancel-on-timeout --timeout 300` 通过；generation task `ac5707f0-591e-4760-825c-4bf9b86f3bb3`，产物 `/output/20260703_222327_68f9/final.mp4` | 通过 |
| Script Review 完整链路 | `--real-script-review --timeout 240 --poll-interval 2` 通过；draft set `9278b845a10f4c358067134333960d8d`，batch `c0aef6b29cf44094b0f6b2c60d942809`，item task `81dc0e2b-9f4b-4929-9d73-9dc4f85bd1f1` | 通过 |
| 非发布管理/浏览器/配置 | `--management-readiness --provider-readiness --browser-smoke --completion-audit --timeout 120 --poll-interval 2` 中 management、browser smoke、provider readiness 通过；completion gate 失败是因为该命令不复用前面单项 E2E 证据，且发布未执行 | 非发布入口通过；严格 gate 仍未关闭 |

本轮代码回归：`uv run pytest tests/compose_runtime_test.py tests/verify_streamlit_migration_test.py tests/generation_api_test.py tests/generation_registry_test.py tests/generation_service_test.py tests/production_templates_test.py -q` 通过，84 passed；React `npm run typecheck`、`npm run lint`、`npm run build` 均通过。

当前严格结论：除 Buffer 发布由用户自测外，保留能力里只有 Action Transfer 真实 E2E 未通过；其失败层级在 provider runtime/workflow，不是 React 入口、API contract、凭证或本地文件缺失。

截至 2026-07-04，迁移完成度必须分成两类判断：

| 验收项 | 当前证据 | 结论 |
| --- | --- | --- |
| React 功能入口覆盖 | React 顶部入口包含生成、历史与发布、文案审核、特殊生成、批量生产、模板状态、设置、帮助；浏览器烟测均可打开，无前端错误日志 | 功能入口已覆盖 |
| API 基础可用性 | `/api/generation/templates`、`/api/generation/batches`、`/api/generation/script-review/templates`、`/api/history/tasks`、`/api/settings/config`、`/api/settings/diagnostics`、`/api/resources/bgm`、`/api/help/faq` 均返回 200 | 管理、设置与资源 API 可用 |
| 自动化回归 | 前端 `typecheck`、`lint`、`build` 通过；后端迁移相关测试通过；`tests/files_api_test.py` 覆盖中文文件名文件响应 | 代码级回归通过 |
| 迁移验证脚本 | `uv run python scripts/verify_streamlit_migration.py` 默认执行只读 API、模板清单、路由 contract 和 `capability_matrix` 检查；`capability_matrix` 是机器可读 Streamlit 能力清单，要求每个迁移能力都有 Streamlit 来源、React surface、迁移决策、阶段、模板或 evidence check，并校验所有 user-facing gate check 都被覆盖；`--browser-smoke` 用 Playwright 打开 React 主入口并检查生成、历史与发布、文案审核、特殊生成、批量生产、模板状态、设置、帮助及关键表单控件，且会遵守全局 `--timeout`；`--management-readiness` 可结构化检查 History / Settings / Resources / Help；`--provider-readiness` 非变更式检查外部 provider 模板需要的配置、诊断项和 workflow 文件；`--external-e2e-plan` 只读输出剩余外部 E2E 的推荐顺序、命令、阶段、产品能力和副作用类型；`--provider-task-status --provider-task-id <id>` 只读复查已有 RunningHub provider task 状态，不创建新任务；`--generation-task-id <id>` 只读轮询已有 Pixelle generation task 的最终 result；`--existing-real-template <template_id>:<task_id>` 可把已有 generation task 复查为指定模板的 `real_generation_<template_id>` 证据，不创建或取消任务；`--no-cancel-on-timeout` 让真实长任务在 verifier 超时后继续运行，超时输出会给出对应 `--existing-real-template` 续查命令；`--real-template <id>` 可逐模板提交真实生成；`--real-all-enabled` 可显式跑所有 enabled production templates；`--real-asset-pipelines` 可聚焦提交素材增强和真实素材 montage；`--real-special-pipelines` 可聚焦提交 I2V、Action Transfer、Digital Human；`--real-batch` 和 `--real-script-review` 分别验收专用批量/文案审核流；`--script-review-submit-only` 可用已有 draft set 验证“审核稿提交生成视频”后半段，不创建新 LLM draft；`--real-publish-e2e` 可通过 `/api/publish/tasks/{task_id}` 跑真实发布 E2E，但必须加 `--confirm-real-publish`；`--completion-audit` 会自动纳入 management readiness、browser smoke、provider readiness，并追加严格 Streamlit replacement gate | 只读迁移覆盖检查可重复执行；基础浏览器入口可验收；真实 E2E 和外部配置检查需要显式触发；真实发布默认有防误发帖保护；长 provider 任务可以跨 verifier 运行继续验收 |
| 管理入口结构化验收 | `uv run python scripts/verify_streamlit_migration.py --management-readiness` 已通过；验证 History 列表/统计、Settings config/diagnostics、BGM/Template/Media workflow/TTS workflow 资源、Help FAQ 的关键响应结构；Settings config 现在会字段级检查旧 Streamlit Settings 的关键配置项：LLM、ComfyUI、RunningHub、Fish Audio、Buffer channels、COS；diagnostics 会检查 LLM、FFmpeg、RunningHub、ComfyUI、Fish Audio、默认 workflow、Buffer、COS 的诊断项存在 | 日常管理 API 结构可支撑 React；Settings 不是只做入口迁移，关键配置字段已纳入验收；不等于浏览器完整操作回归 |
| 功能清单完整性 | `uv run python scripts/verify_streamlit_migration.py` 默认已通过 `capability_matrix`；当前机器清单覆盖 20 个 Streamlit 能力项、11 个 production/dedicated template id，以及所有 user-facing required check；本次补清单时曾发现 `petwoods_xhs_quality_explainer_v1` 缺少能力行，已补为“重点解释/质量解释器视频” | 迁移范围现在有机器约束，后续不能只靠文档描述判断是否漏项；不等于真实 E2E 已完成 |
| React 浏览器入口验收 | `uv run python scripts/verify_streamlit_migration.py --browser-smoke --timeout 60` 已通过；Playwright 打开 `http://127.0.0.1:5173`，逐个进入生成视频、历史与发布、文案审核、特殊生成、批量生产、模板状态、设置、帮助，并检查视频文案、创建真实生成任务、真实任务状态、历史刷新、视频详情、真实 Buffer 发布链路、Script Prompt、提交生成视频、I2V、Action Transfer、Digital Human、批量选题/文案、创建批量任务、Settings 关键配置字段、Help FAQ 等关键控件；未发现 page error 或 console error | 产品入口和关键控件已有浏览器级证据；不等于每个表单提交后的完整操作 E2E |
| Streamlit 下线 gate | `streamlit_replacement_gate` 仍为严格 gate，且当前命令内不会自动复用之前单项 E2E 证据；2026-07-03 的非发布单项 E2E 已补齐 daily、topic、quality explainer、asset enhanced、real material montage、I2V、Digital Human、Script Review，Action Transfer 真实 E2E 失败，Buffer 真实发布按用户边界未执行 | 不能宣称 Streamlit 已可下线；严格剩余项是 Action Transfer provider/workflow 修复和 Buffer 真实发布验收 |
| 能力级缺口报告 | `streamlit_replacement_gate` 输出 `capability_summary` 和 `capability_gaps`，每个 gap 都包含 Streamlit 能力名、React surface、迁移决策、template id、缺失 evidence 和失败 evidence；最新人工核对以本节 `2026-07-03 22:07-22:28 非发布真实验收增量` 为准 | 后续不再只看 check 名称；以 Streamlit 能力和真实 E2E 证据判断是否可下线 |
| 外部 E2E 执行计划 | `uv run python scripts/verify_streamlit_migration.py --external-e2e-plan` 已通过；原计划中的 provider/LLM 非发布 E2E 已执行到只剩 Action Transfer 未通过；真实发布 E2E 仍必须加 `--confirm-real-publish`，且会上传媒体并创建 Buffer post | 继续保留防误发布保护；真实 Buffer 发布由用户确认后执行 |
| 本地合成 E2E | `--local-render-smoke` 使用新的 `petwoods_xhs_static_subtitle_v1` production template，已产出 `/output/20260703_165650_9ca8/final.mp4`；metadata 中 `production_template.id=petwoods_xhs_static_subtitle_v1`；质量检查 `file_exists`、`video_playable`、`audio_present`、`duration_seconds`、`black_frame_sample` 全部 passed | Streamlit static template 能力已成为 React/FastAPI 下真实可验收的生产模板；不等于 RunningHub provider E2E 通过 |
| 静态字幕模板真实提交 | `uv run python scripts/verify_streamlit_migration.py --real-template petwoods_xhs_static_subtitle_v1 --timeout 120 --poll-interval 2` 已通过，最近一次产出 `/output/20260703_212822_ee4f/final.mp4`，metadata 中 `template_id=petwoods_xhs_static_subtitle_v1`，质量检查通过 | 第一条不依赖外部媒体 provider 的 React production template 已跑通真实成片 E2E |
| 已有任务按模板复查 | `uv run python scripts/verify_streamlit_migration.py --existing-real-template petwoods_xhs_static_subtitle_v1:8aab2456-945a-4e9b-a602-1c2272814151 --timeout 10 --poll-interval 1` 已通过；返回 check 名称 `real_generation_petwoods_xhs_static_subtitle_v1`，`resumed_existing_task=true`，读取同一个 task 的 result/primary video；不会创建新任务或取消已有任务 | 后续长 provider E2E 可以先保留运行，再用同一任务继续补齐 completion gate 证据 |
| 标准视频真实提交 | `petwoods_xhs_daily_v1`、`petwoods_xhs_topic_to_video_v1`、`petwoods_xhs_quality_explainer_v1` 已在 2026-07-03 非发布验收中通过真实 API task/result/primary video；高质量解释视频明确使用 `compose_runtime=hyperframes` | Standard 保留能力已有真实成片证据 |
| 素材/Montage 真实提交 | `petwoods_xhs_asset_enhanced_v1`、`petwoods_xhs_real_material_montage_v1` 已在 2026-07-03 非发布验收中通过真实 API task/result/primary video | 素材与 montage 保留能力已有真实成片证据 |
| 长任务控制 | React 标准生成与特殊生成任务状态卡已接入 `DELETE /api/generation/tasks/{task_id}`；Batch 已接入失败/取消项重试 API | 排队或失败后的用户控制能力已覆盖 |
| 批量真实提交 | `uv run python scripts/verify_streamlit_migration.py --real-batch --timeout 120 --poll-interval 2` 已通过；verifier 使用 `petwoods_xhs_static_subtitle_v1` 创建真实 persisted batch，`/api/generation/tasks/{task_id}/result` 返回 primary video / artifacts | Batch 的持久化、任务提交、轮询和最终结果读取已有 provider-independent E2E 证据 |
| 文案审核真实提交 | `--real-script-review --timeout 240 --poll-interval 2` 已通过；draft set `9278b845a10f4c358067134333960d8d`，batch `c0aef6b29cf44094b0f6b2c60d942809`，item task `81dc0e2b-9f4b-4929-9d73-9dc4f85bd1f1` | 完整“LLM 生成草稿 -> 审核提交 -> 成片”已有真实 E2E 证据 |
| 设置诊断 | React Settings 读取 `/api/settings/diagnostics`，展示 LLM、FFmpeg、HyperFrames、RunningHub、ComfyUI、Fish Audio、workflow、Buffer、COS 的脱敏 readiness；迁移 verifier 纳入只读检查 | 可见性已补齐，真实连接仍以各项测试和 E2E 为准 |
| Provider readiness | `uv run python scripts/verify_streamlit_migration.py --provider-readiness` 已通过，且已加入 `streamlit_replacement_gate` required checks；LLM、FFmpeg、RunningHub API Key、RunningHub timeout、默认图片 workflow、默认视频 workflow 均通过 diagnostics；`runninghub/i2v_LTX2.json`、`runninghub/af_scail.json`、`workflows/runninghub/digital_image.json`、`workflows/runninghub/digital_combination.json`、`workflows/runninghub/digital_customize.json` 本地文件存在；这些特殊 workflow 未列入 `/api/resources/workflows/media`，但 pipeline 固定路径可直接引用 | 配置和 workflow 文件不是当前 blocker；仍不等于 provider runtime E2E 成功 |
| 发布 readiness | `uv run python scripts/verify_streamlit_migration.py --publish-readiness --publish-platform x` 已通过；只调用 `/api/publish/platforms`、`/api/publish/timezones`、`/api/publish/check`，不会调用 `/api/publish/tasks/{task_id}` 创建 Buffer post；当前 COS 诊断通过，Buffer X channel 可达；不限定平台时会因 YouTube/TikTok/Instagram/Pinterest channel 未配置而失败 | 当前已配置发布平台的非发帖 readiness 通过；不等于真实发布 E2E，也不等于所有平台账号都已配置 |
| 真实发布 E2E 工具 | 已新增 `--real-publish-e2e`；未加 `--confirm-real-publish` 时会返回 `real_publish_e2e=false` 且 `publish_endpoint_called=false`，不会调用 `/api/publish/tasks/{task_id}`；确认后会先跑 readiness，再发布指定 completed task，未提供 task id 时会先生成一个静态字幕视频作为发布源 | 验收工具已就绪；真实发布会上传视频并创建 Buffer post，必须由用户确认后才执行 |
| Provider 外部任务可观察性 | RunningHub workflow 执行已通过服务层 wrapper 把外部 `taskId`、`status`、`msg` 写入 generation progress detail；React 任务卡以二级信息展示服务任务与服务状态；覆盖标准视频媒体生成和 I2V / Action Transfer / Digital Human 的 workflow 执行 | 能定位到 provider queue/runtime 层；Action Transfer 当前失败可定位到 RunningHub workflow runtime |
| Provider task 状态复查 | `uv run python scripts/verify_streamlit_migration.py --provider-task-status --provider-task-id 2073049508220198914` 只读查询 Action Transfer 的 RunningHub task；当前返回 `FAILED`，`msg=success`，没有更细节点信息 | Action Transfer 失败不是本地轮询误判，需要 RunningHub 控制台排查失败节点 |

### 当前真实阻塞层级

当前真实阻塞集中在 Action Transfer。`--provider-readiness` 已证明 LLM、FFmpeg、RunningHub 配置和 workflow 文件存在；I2V、Digital Human、标准媒体模板、素材/Montage 都已拿到最终 mp4。因此当前 Action Transfer 的失败层级不是 input、credentials、network、API contract、本地 workflow 文件缺失，也不是通用 provider 队列问题，而是 `workflows/runninghub/af_scail.json` 对应 RunningHub workflow runtime 未产出视频。

Action Transfer 失败证据：generation task `2ba7cf2d-214a-427d-bbcc-414a05004a9d`，RunningHub provider task `2073049508220198914`，provider status `FAILED`，本地错误 `Workflow did not return a video. Check workflow configuration.`。RunningHub 状态 API 只返回 `msg=success`，没有更细节点错误；下一步必须在 RunningHub 控制台查看该 task 的失败节点、输出和参数映射。

已补充 `runninghub_timeout` 设置，默认 600 秒，并在 React Settings 中开放配置。它不会让 provider queue 自动成功，但能避免外部任务无限等待；超时后应作为 provider runtime 失败暴露，而不是让用户一直看到进行中。

已补充 generation progress 的 provider runtime detail。媒体生成阶段会把 provider、workflow、media type、RunningHub timeout 写入 task progress；React 标准生成和特殊生成任务卡只作为二级信息展示这些上下文，不把 provider 选择重新放回普通生成主流程。

已补充 RunningHub 外部任务可观察性。标准视频媒体生成和特殊 workflow pipeline 会在 RunningHub task 创建与状态轮询时把 `provider_task_id`、`provider_status` 和非空 `provider_status_message` 写入同一个 task progress；这用于真实诊断队列/运行状态，不作为普通用户的 provider 选择入口，也不能替代最终产物验收。

已新增 `petwoods_xhs_static_subtitle_v1`，对应 Streamlit 里的 static frame template 能力。它固定使用本地静态 HTML 帧 + TTS + FFmpeg 合成，不依赖 `media` capability，用于保证 React 至少有一条不受外部 provider 队列影响的真实成片主路径。

因此，当前状态是：Streamlit 功能迁移已达到“功能入口覆盖 + API 边界 + 非发布真实 E2E 基本通过”阶段；按“Streamlit 里的功能是否全部迁移过来”这个严格标准，仍不能宣称完成。完成还需要 Action Transfer 修复并通过真实 E2E，以及用户确认/执行 Buffer 真实发布验收。

### P0 基线冻结

- 迁移矩阵存在并能对应 Streamlit 页面和 pipeline。
- 每个能力有状态：已迁移、部分迁移、legacy only、planned。
- React 不提供 provider-first 主流程。

### P1 Standard 主路径

- React 支持 script/topic 两种 standard 输入。
- 高级参数走模板白名单，不允许任意 provider 参数透传。
- 失败展示后端真实错误。
- 当前状态：已有文案、静态字幕、选题生成和高质量解释视频均已有真实 E2E 产物；HyperFrames runtime 已修复非交互安装阻塞和 API event-loop 阻塞问题。

### P2 日常管理闭环

- History 支持筛选、排序、分页、详情、下载、删除。
- Publish 支持平台、标题、caption、hashtags、queue/scheduled、配置检查。
- Settings 支持非调试配置读写和关键连接测试。
- 当前状态：History/Publish/Settings/Help 的入口与 API 已迁移；Management 已有 `--management-readiness` 结构化只读验收入口；React 主入口已有 `--browser-smoke` 浏览器级验收；Publish 已有 `--publish-readiness` 非发帖配置验收入口。是否可完全替代 Streamlit 仍需要完整操作回归和真实账号发布 E2E 验收；Buffer 真实发布由用户自测。

### P3 复杂生产流

- Batch 状态持久化，刷新不丢失。
- Script Review 有 draft API，支持确认后生成。
- 当前状态：Batch 与 Script Review 主闭环已迁移到 React/API；Script Review 的语言级模型和 Prompt 映射已补齐；`--real-batch` 和 `--real-script-review` 已通过真实 E2E。

### P4 特殊 Pipeline

- I2V、Action Transfer、Digital Human 全部进入 generation registry。
- 每个特殊 pipeline 有统一 task/status/result/history/failure guidance。
- 当前状态：三类特殊 pipeline 已有后端可执行 pipeline、production template 和 React 特殊生成入口；I2V 和 Digital Human 已通过真实 E2E；Action Transfer 已恢复自动读取参考视频时长，但 RunningHub workflow `af_scail` 真实 E2E 未通过，失败会通过统一 task error 暴露。

### P4-A 素材与 Montage

- 素材增强和真实素材 montage 都走 `asset_based` pipeline，但作为两个 production template 暴露给 React。
- 当前状态：两类能力已有 React 主生成入口、真实素材输入、统一 task/status/result/history/failure guidance，且素材增强和真实素材 montage 都已通过真实 E2E。

### P5 下线 Streamlit

- Streamlit 不能在当前阶段下线。
- 下线前必须逐项证明：标准生成、素材/Montage、Batch、Script Review、I2V、Action Transfer、Digital Human、History、Publish、Settings、Help 都能在 React 完成真实流程；当前缺 Action Transfer 真实 E2E 和 Buffer 真实发布验收。
- provider/workflow/source 选择按产品原则迁入模板配置/设置页，不作为普通用户每次生成入口。
- 所有保留能力必须有 React 入口和真实验收记录；无法保留的能力必须有明确废弃说明。
