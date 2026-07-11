# API 概览

启动 FastAPI：

```bash
uv run uvicorn api.app:app --host 127.0.0.1 --port 8000
```

以下路径以 `/api` 为前缀。OpenAPI 文档位于 `/docs`。

## 项目与配方

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/projects` | 读取项目和默认项目 |
| `GET` | `/generation/templates?project=<id>` | 读取项目可用配方与默认配方 |
| `GET` | `/generation/templates/{template_id}` | 读取配方详情 |

## 提交单条任务

`POST /generation/templates/{template_id}/tasks`

```json
{
  "input": {
    "script": "Cats need clean water every day."
  },
  "metadata": {
    "project_id": "project-id",
    "source": "api"
  },
  "idempotency_key": "content-id:revision-3"
}
```

响应包含 `generation_task_id` 和完整初始任务。`input` 的必填字段和允许覆盖项由所选配方决定。

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
| `GET` | `/generation/tasks/{task_id}` | 查询正式生成任务 |
| `GET` | `/generation/tasks/{task_id}/result` | 读取完成结果 |
| `DELETE` | `/generation/tasks/{task_id}` | 取消未完成单条任务 |
| `GET` | `/generation/batches` | 列出批次 |
| `GET` | `/generation/batches/{batch_id}` | 查询批次与子任务 |
| `DELETE` | `/generation/batches/{batch_id}` | 取消尚未完成的子任务 |
| `POST` | `/generation/batches/{batch_id}/items/{index}/retry` | 重试失败或取消的单项 |

取消批次不会删除已完成结果。任务状态持久化；服务重启后未完成任务成为 `interrupted`，需要明确重试。

## 状态与错误

任务状态：`pending | running | completed | failed | cancelled | interrupted`。

错误包含失败层级、消息、异常类型和可选详情。调用方不得把未知状态归类为运行中或成功，也不得用本地占位结果覆盖后端错误。
