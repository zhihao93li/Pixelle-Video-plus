# API 概览

启动 FastAPI：

```bash
uv run uvicorn api.app:app --host 127.0.0.1 --port 8000
```

以下路径以 `/api` 为前缀。OpenAPI 文档位于 `/docs`。

## 项目与模板

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/projects` | 读取项目和默认项目 |
| `GET` | `/generation/templates?project=<id>` | 读取项目可用模板与默认模板 |
| `GET` | `/generation/templates/{template_id}` | 读取模板详情 |

## 提交单条生产

`POST /production-tasks`

```json
{
  "request_id": "content-id:revision-3",
  "project_id": "project-id",
  "pipeline_id": "script_to_video",
  "recipe_id": "pipeline_standard_base_v1",
  "input": {
    "script": "Cats need clean water every day."
  },
  "overrides": {},
  "source": "react"
}
```

响应包含稳定的 `production_task_id`、`content_item_id` 和完整生产任务。`input` 的必填字段和允许覆盖项由所选 Pipeline 与模板决定。相同逻辑请求及其重试必须复用同一个 `request_id`。

## 提交批次

`POST /generation/batches`

```json
{
  "template_id": "pipeline_standard_base_v1",
  "metadata": {"project_id": "project-id"},
  "idempotency_key": "batch-2026-07-11",
  "items": [
    {"input": {"script": "First script."}},
    {"input": {"script": "Second script."}}
  ]
}
```

批次允许单项校验失败；响应会逐项返回任务身份或结构化错误。

## 查询、取消与重试

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/production-tasks` | 查询工作台生产任务 |
| `GET` | `/production-tasks/{task_id}` | 查询稳定生产任务 |
| `DELETE` | `/production-tasks/{task_id}` | 取消未完成生产任务 |
| `POST` | `/production-tasks/{task_id}/retry` | 原样重试失败或取消的生产任务 |
| `GET` | `/generation/tasks/{task_id}` | 查询底层执行尝试 |
| `GET` | `/generation/tasks/{task_id}/result` | 读取执行产物 |
| `GET` | `/generation/batches` | 列出批次 |
| `GET` | `/generation/batches/{batch_id}` | 查询批次与子任务 |
| `DELETE` | `/generation/batches/{batch_id}` | 取消尚未完成的子任务 |
| `POST` | `/generation/batches/{batch_id}/items/{index}/retry` | 重试失败或取消的单项 |

取消不会删除已完成结果。任务状态持久化；服务重启后未完成任务成为 `interrupted`，需要明确重试。

## 状态与错误

工作台生产状态为 `needs_user | in_progress | failed | produced | cancelled`。底层执行状态为 `pending | running | completed | failed | cancelled | interrupted`。

错误包含失败层级、消息、异常类型和可选详情。调用方不得把未知状态归类为运行中或成功，也不得用本地占位结果覆盖后端错误。
