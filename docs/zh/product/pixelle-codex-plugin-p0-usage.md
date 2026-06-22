# Pixelle Codex Plugin P0 使用说明

版本：v1.2
日期：2026-06-22
范围：P0/P0.9 本地插件入口

## 1. 定位

Pixelle Codex Plugin 是 P0 的运营写入口。

Codex 通过插件工具发起运营动作；Pixelle Ops 保存状态和证据；Pixelle UI/API 只读展示结果。

## 2. 本地 Codex Plugin

当前已经提供个人本地插件包：

```text
/Users/zhihaoli/plugins/pixelle-ops
```

个人 marketplace：

```text
/Users/zhihaoli/.agents/plugins/marketplace.json
```

插件包含：

```text
.codex-plugin/plugin.json
.mcp.json
skills/pixelle-ops/SKILL.md
```

Codex app 中查看或启用该插件后，新线程会加载 `pixelle-ops` skill 和 Pixelle Ops MCP 工具。

## 3. 本地 MCP 启动

在项目根目录运行：

```bash
uv run python -m codex_plugin.server
```

该命令以 stdio MCP server 形式启动 Pixelle 工具入口。

P0 不提供远程插件发布包，不提供 HTTP 写入口。正式使用优先走本地 Codex Plugin；该命令主要用于手动调试 MCP server。

## 4. 状态库

默认状态库：

```text
data/ops.db
```

本地测试或临时运行可以通过环境变量覆盖：

```bash
PIXELLE_OPS_DB_PATH=/tmp/pixelle-ops.db uv run python -m codex_plugin.server
```

## 5. 工具清单

```text
pixelle_get_capabilities
pixelle_list_projects
pixelle_get_current
pixelle_create_project
pixelle_create_channel_account
pixelle_create_cycle
pixelle_create_experiment
pixelle_lock_prediction
pixelle_list_generation_pipelines
pixelle_submit_generation_draft
pixelle_approve_generation_draft
pixelle_request_generation
pixelle_get_generation_status
pixelle_check_generation_asset
pixelle_record_publish
pixelle_record_metrics
pixelle_write_retro
pixelle_write_memory
```

## 6. 最小闭环顺序

```text
pixelle_get_capabilities
pixelle_list_projects
pixelle_get_current(project_id/channel_account_id)
pixelle_create_project
pixelle_create_channel_account
pixelle_create_cycle
pixelle_create_experiment
pixelle_lock_prediction
pixelle_list_generation_pipelines
pixelle_submit_generation_draft
pixelle_approve_generation_draft
pixelle_request_generation
pixelle_get_generation_status
pixelle_check_generation_asset
pixelle_record_publish
pixelle_record_metrics
pixelle_write_retro
pixelle_write_memory
pixelle_get_current
```

`pixelle_get_capabilities` 必须作为新线程、P0 验证、状态查看、续跑、推荐、生成和恢复的第一步。任何 `pixelle_get_current`、项目列表、pipeline、写入或生成工具都不能在它之前调用。当前期望 `protocol_version = p0.9.20260622`，`conversation_contract_version = p0.9.20260622`，`conversation_contract.requires_capability_first = true`，并且 `project_selection_gate`、`channel_account_gate`、`content_shape_gate`、`existing_generation_gate`、`pipeline_selection_gate`、`draft_approval_gate`、`async_generation_status`、`asset_check_gate` 都为 true。缺失或不匹配时，说明当前 Codex 线程加载的是旧插件，必须停止并重新加载插件/新开线程。

P0.9 起，capability 还必须返回 `intent_routes`，用于把自然语言请求收敛到稳定分支：

```text
project_selection
channel_account_selection
status_check
content_recommendation
ambiguous_copy_request
approved_copy_request
full_operations_experiment
video_generation
existing_generation
publish_evidence
mock_p0_closeout
metrics_and_retro
```

用户不应该再需要发送长工具清单。Codex 必须根据这些 route 决定是先选择项目/平台账号、只读状态、推荐选题、先问内容形态、进入文案审核链、处理已有成片、记录发布证据，还是执行 mock P0 收口。

P0.7-B 起，`video_generation.requires_user_pipeline_choice` 和 `video_generation.default_pipeline_requires_user_acceptance` 必须为 true。默认 pipeline 只是推荐，不等于用户已经选择；用户说“直接生成视频”只表示认可已审核稿进入生成，不表示自动选择 `standard`。除非同一句或前文明确指定已注册 pipeline，例如“用 standard 生成”，否则必须先问 pipeline。

P0.9 起，用户模型收敛为四个词：

```text
项目
平台账号
内容
发布记录
```

项目是顶层长期运营对象，通常是一个品牌、业务、IP 或账号矩阵，例如 PetWoods。平台账号是项目下的分发渠道，例如小红书 PetWoods、抖音 PetWoods、YouTube PetWoods。内容是项目里生产和判断的对象，同一条内容可以有多条发布记录；发布记录表示这条内容发到某个平台账号的一次发布。

如果 Pixelle Ops 中存在多个项目或多个平台账号，Codex 不能默认使用“最近项目”做推荐、生成、发布、指标或复盘写入。必须先调用 `pixelle_list_projects`，让用户选择项目或平台账号，再用 `pixelle_get_current(project_id=...)` 或 `pixelle_get_current(channel_account_id=...)` 读取明确选择。`pixelle_create_channel_account` 只保存平台账号元数据和 credential reference，不做真实平台授权、不发布、不回收数据；后续 UI 账号绑定也应写入同一套平台账号/credential reference 模型，不改变 Codex 作为运营入口。

`pixelle_get_current` 的阻断动作必须区分清楚：

```text
multiple_projects -> select_project
multiple_accounts -> select_channel_account
```

所以发布、指标、平台数据相关操作遇到多个平台账号时，Codex 应该问“这次要操作哪个平台账号？”，不是再问“哪个项目？”。

每个写工具都必须带 `source`。

Codex 来源必须满足：

```json
{
  "kind": "codex",
  "skill": "cheat-on-content",
  "confirmed_by_user": true
}
```

## 7. P0 边界

1. 插件只调用 `ops.service`。
2. 插件不直接写 SQLite。
3. 插件不调用 `web`。
4. UI/API 不提供写入口。
5. 新线程必须先通过 `pixelle_get_capabilities` 自检插件协议、对话契约和对话门禁，且任何 Pixelle Ops 工具不能早于 capability 调用。
6. 多项目或多平台账号时必须先选项目或平台账号，不能默认使用最近项目。
7. 平台账号绑定在 P0.9 只表示分发渠道配置和 credential reference，不代表真实平台授权、发布能力或数据回收能力。
8. 没有 locked prediction 不能生成。
9. 用户没有明确内容形态时，Codex 必须先问“短视频字幕稿 / 图文笔记 / 只做 hook / 完整运营实验”，不能擅自生成图文长文。
10. 进入生成前必须调用 `pixelle_list_generation_pipelines`，让用户选择已注册 pipeline；默认 pipeline 只能作为推荐，不能在用户未接受时自动使用。
11. Codex 必须先提交 `generation_drafted` 文案草稿。
12. 用户审核后必须记录 `generation_draft_approved`。
13. `pixelle_request_generation` 只接受已批准 draft 的 approval event id，不能直接传任意文案。
14. 草稿文本只能是最终上屏字幕或口播稿，不能包含 `【视频目标】`、`【内容形式】`、`【发布标题】`、`【发布正文】`、`【标签】` 等生成说明或发布字段。
15. 如果同主题或当前实验已有成片，不能把旧成片静默当作本次生成结果。必须先问用户：复用已有成片、用当前审核稿重新生成、还是新建干净实验重新生成。
16. 只有用户明确选择复用已有成片时，才允许对旧 content item 调用 `pixelle_check_generation_asset` 并返回旧资产。
17. 用户选择重新生成时，必须新建实验或使用未完成生成的干净实验，不能复用已有 `generation_completed` 的实验。
18. 同一实验有生成进行中时不能重复请求生成，必须返回 `generation_in_progress`。
19. 同一实验已经生成完成时不能静默重生成，必须返回 `generation_already_completed`。
20. 不能自造 pipeline 名称；必须使用 PixelleVideoCore 已注册 pipeline。
21. 未知 pipeline 必须在写入 `generation_requested` 前返回 `unknown_generation_pipeline`。
22. `pixelle_request_generation` 默认返回 `generation_requested`，后续必须用 `pixelle_get_generation_status` 查询异步生成结果，避免 Codex 工具调用长时间等待超时。
23. 生成失败必须写 `generation_failed`，不能伪成功。
24. 生成成功必须能提取出 `path`、`video_path`、`url`、`asset_url` 或 `output_path` 之一作为资产引用。
25. 生成完成后必须调用 `pixelle_check_generation_asset`，确认资产引用存在、本地文件可读且 draft 文本没有污染。
26. 资产检查通过后才进入发布记录；检查失败时必须停在 `resolve_asset_issue`。
27. 发布证据不能只有 confirmation note。
28. metrics 必须挂到已发布 content item。

当前已注册 pipeline：

```text
standard
custom
asset_based
```

## 8. 错误返回

插件工具遇到业务错误时，不把 Python exception 暴露给 Codex，而是返回稳定结构：

```json
{
  "status": "error",
  "error": {
    "code": "source_not_confirmed",
    "message": "Codex writes require explicit user confirmation."
  },
  "next_action": {
    "kind": "resolve_error",
    "blocked": true,
    "reason": "source_not_confirmed"
  }
}
```

API 遇到业务错误时，HTTP status code 反映请求结果，`detail.error.code` 保留同一套业务错误码。

## 9. 本地验证

```bash
uv run pytest tests/test_codex_plugin.py -q
uv run pytest tests/test_ops_store.py tests/test_ops_service.py tests/test_codex_plugin.py tests/test_ops_api.py -q
uv run python scripts/p0_codex_smoke.py
```

`scripts/p0_codex_smoke.py` 使用隔离临时 SQLite DB 和 fake generation runner，通过 FastMCP client 调用真实 `pixelle_*` 工具面，验证 Codex 插件链路和 P0 状态机。真实视频生成需要单独验收。

## 10. P0.9 对话验收用例

新线程加载 `@pixelle-ops` 后，用短话术验收对话路由：

```text
使用 @pixelle-ops，帮我看一下当前状态
```

预期：先自检 capability，再读取 current state，不写状态。

```text
使用 @pixelle-ops，下一条内容适合做什么？
```

预期：如果只有一个项目/账号，读取当前状态后给推荐，不创建实验；如果有多个项目/账号，先让用户选择项目或账号。

```text
使用 @pixelle-ops，下一条内容适合做什么？
```

多项目预期：先返回类似“你要操作哪个项目/平台账号？”的短选择题；用户选择后才调用 `pixelle_get_current(project_id=...)` 或 `pixelle_get_current(channel_account_id=...)` 并给推荐。

```text
文案呢？
```

预期：如果内容形态不明确，先问短视频字幕稿、图文笔记、只做 hook、还是完整运营实验。

```text
用这版生成视频
```

预期：要求已审核 draft、选择已注册 pipeline、提交 approval 后生成，不直接用自由文案生成。

如果用户没有明确说 `standard`、`custom`、`asset_based` 等已注册 pipeline，预期必须先问：

```text
生成视频用哪个 pipeline？

1. standard（推荐）
2. custom
3. asset_based
```

```text
这个主题已经有成片了，再生成一版
```

预期：先问复用已有成片、用当前审核稿重生成、还是新建干净实验。

```text
先 mock 跑完 P0 收口
```

预期：允许 mock 发布证据和 mock metrics，但必须显式标记 mock，不伪装真实发布。mock 发布证据和 mock metrics 都必须带 `mock: true` 和非空 `mock_label`；只有一句备注或“我已经发布了”不能算发布证据。
