# Pixelle Codex Plugin P0 使用说明

版本：v1.0  
日期：2026-06-21  
范围：P0 本地插件入口

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
pixelle_get_current
pixelle_create_project
pixelle_create_cycle
pixelle_create_experiment
pixelle_lock_prediction
pixelle_submit_generation_draft
pixelle_approve_generation_draft
pixelle_request_generation
pixelle_record_publish
pixelle_record_metrics
pixelle_write_retro
pixelle_write_memory
```

## 6. 最小闭环顺序

```text
pixelle_create_project
pixelle_create_cycle
pixelle_create_experiment
pixelle_lock_prediction
pixelle_submit_generation_draft
pixelle_approve_generation_draft
pixelle_request_generation
pixelle_record_publish
pixelle_record_metrics
pixelle_write_retro
pixelle_write_memory
pixelle_get_current
```

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
5. 没有 locked prediction 不能生成。
6. Codex 必须先提交 `generation_drafted` 文案草稿。
7. 用户审核后必须记录 `generation_draft_approved`。
8. `pixelle_request_generation` 只接受已批准 draft 的 approval event id，不能直接传任意文案。
9. 不能自造 pipeline 名称；必须使用 PixelleVideoCore 已注册 pipeline。
10. 未知 pipeline 必须在写入 `generation_requested` 前返回 `unknown_generation_pipeline`。
11. 生成失败必须写 `generation_failed`，不能伪成功。
12. 生成成功必须能提取出 `path`、`video_path`、`url`、`asset_url` 或 `output_path` 之一作为资产引用。
13. 发布证据不能只有 confirmation note。
14. metrics 必须挂到已发布 content item。

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
