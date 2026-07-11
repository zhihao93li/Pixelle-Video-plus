# API Overview

Start FastAPI:

```bash
uv run uvicorn api.app:app --host 127.0.0.1 --port 8000
```

The routes below use the `/api` prefix. OpenAPI documentation is available at `/docs`.

## Projects and Recipes

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/projects` | Read projects and the default project |
| `GET` | `/generation/templates?project=<id>` | Read available and default recipes for a project |
| `GET` | `/generation/templates/{template_id}` | Read recipe details |

## Submit One Task

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

The response contains `generation_task_id` and the complete initial task. Required input fields and allowed overrides are defined by the selected recipe.

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
| `GET` | `/generation/tasks/{task_id}` | Read a canonical generation task |
| `GET` | `/generation/tasks/{task_id}/result` | Read a completed result |
| `DELETE` | `/generation/tasks/{task_id}` | Cancel one unfinished task |
| `GET` | `/generation/batches` | List batches |
| `GET` | `/generation/batches/{batch_id}` | Read a batch and its children |
| `DELETE` | `/generation/batches/{batch_id}` | Cancel unfinished child tasks |
| `POST` | `/generation/batches/{batch_id}/items/{index}/retry` | Retry one failed or cancelled item |

Cancelling a batch does not remove completed results. Task state is durable; unfinished tasks become `interrupted` after a service restart and require an explicit retry.

## States and Errors

Task states are `pending | running | completed | failed | cancelled | interrupted`.

Errors include a failure layer, message, exception type, and optional detail. Clients must not classify unknown states as running or successful, and must not replace backend failures with local placeholder results.
