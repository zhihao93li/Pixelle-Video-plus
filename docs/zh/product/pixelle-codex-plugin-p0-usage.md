# Pixelle Codex Plugin P0 使用说明

版本：v1.0  
日期：2026-06-21  
范围：P0 本地插件入口

## 1. 定位

Pixelle Codex Plugin 是 P0 的运营写入口。

Codex 通过插件工具发起运营动作；Pixelle Ops 保存状态和证据；Pixelle UI/API 只读展示结果。

## 2. 本地启动

在项目根目录运行：

```bash
uv run python -m codex_plugin.server
```

该命令以 stdio MCP server 形式启动 Pixelle 工具入口。

P0 不提供远程插件发布包，不提供 HTTP 写入口。

## 3. 状态库

默认状态库：

```text
data/ops.db
```

本地测试或临时运行可以通过环境变量覆盖：

```bash
PIXELLE_OPS_DB_PATH=/tmp/pixelle-ops.db uv run python -m codex_plugin.server
```

## 4. 工具清单

```text
pixelle_get_current
pixelle_create_project
pixelle_create_cycle
pixelle_create_experiment
pixelle_lock_prediction
pixelle_request_generation
pixelle_record_publish
pixelle_record_metrics
pixelle_write_retro
pixelle_write_memory
```

## 5. 最小闭环顺序

```text
pixelle_create_project
pixelle_create_cycle
pixelle_create_experiment
pixelle_lock_prediction
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

## 6. P0 边界

1. 插件只调用 `ops.service`。
2. 插件不直接写 SQLite。
3. 插件不调用 `web`。
4. UI/API 不提供写入口。
5. 没有 locked prediction 不能生成。
6. 生成失败必须写 `generation_failed`，不能伪成功。
7. 发布证据不能只有 confirmation note。
8. metrics 必须挂到已发布 content item。

## 7. 错误返回

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

## 8. 本地验证

```bash
uv run pytest tests/test_codex_plugin.py -q
uv run pytest tests/test_ops_store.py tests/test_ops_service.py tests/test_codex_plugin.py tests/test_ops_api.py -q
```
