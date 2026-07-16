# API Usage

Production capabilities are exposed through FastAPI. After starting the server, the interactive contract is available at `http://127.0.0.1:8000/docs`.

## Basic Flow

1. Read projects with `GET /api/projects`.
2. Read available templates with `GET /api/generation/templates?project=<project_id>`.
3. Submit one production through `POST /api/production-tasks`, or a batch through `/api/generation/batches`.
4. Poll the stable production task, execution attempt, or batch state.
5. Read artifacts from the task result, then use library and publishing APIs.

Every formal production request must carry a real project identity, pipeline, template, and stable `request_id`, then pass through template compilation. The request field remains `recipe_id` for API compatibility. The removed raw-generation write endpoints are not part of the API contract.

## State Handling

Task terminal states are `completed`, `failed`, `cancelled`, and `interrupted`. A service restart preserves terminal tasks and marks unfinished work as `interrupted`. Clients must show backend errors and must not infer success or write content lifecycle transitions merely to reconcile a view.

See the [API overview](../reference/api-overview.md) for routes and request examples.
