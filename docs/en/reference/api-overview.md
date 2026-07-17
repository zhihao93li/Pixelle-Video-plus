# API Overview

Start FastAPI:

```bash
uv run uvicorn api.app:app --host 127.0.0.1 --port 8000
```

The routes below use the `/api` prefix. OpenAPI documentation is available at `/docs`.

## Projects and Templates

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/projects` | Read content spaces and the internal initial selection |
| `GET` | `/generation/templates?project=<id>` | Read available and default templates for a project |
| `GET` | `/generation/templates/{template_id}` | Read template details |

## Submit One Production

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

The response contains a stable `production_task_id`, `content_item_id`, and the complete production task. Required input fields and allowed overrides are defined by the selected pipeline and template. The request field remains `recipe_id` for API compatibility. Reuse the same `request_id` for retries of the same logical request.

## Submit a Batch

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

A batch can contain item-level validation failures. Each item returns either a canonical task identity or a structured error.

## Read, Cancel, and Retry

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/production-tasks` | List workbench production tasks |
| `GET` | `/production-tasks/{task_id}` | Read a stable production task |
| `DELETE` | `/production-tasks/{task_id}` | Cancel one unfinished production task |
| `POST` | `/production-tasks/{task_id}/retry` | Retry a failed or cancelled production unchanged |
| `GET` | `/generation/tasks/{task_id}` | Read an execution attempt |
| `GET` | `/generation/tasks/{task_id}/result` | Read execution artifacts |
| `GET` | `/generation/batches` | List batches |
| `GET` | `/generation/batches/{batch_id}` | Read a batch and its children |
| `DELETE` | `/generation/batches/{batch_id}` | Cancel unfinished child tasks |
| `POST` | `/generation/batches/{batch_id}/items/{index}/retry` | Retry one failed or cancelled item |

Cancellation does not remove completed results. Task state is durable; unfinished execution attempts become `interrupted` after a service restart and require an explicit retry.

## States and Errors

Workbench production states are `needs_user | in_progress | failed | produced | cancelled`. Execution states are `pending | running | completed | failed | cancelled | interrupted`.

Errors include a failure layer, message, exception type, and optional detail. Clients must not classify unknown states as running or successful, and must not replace backend failures with local placeholder results.
