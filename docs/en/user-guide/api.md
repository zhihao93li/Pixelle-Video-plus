# API Usage

Production capabilities are exposed through FastAPI. After starting the server, the interactive contract is available at `http://127.0.0.1:8000/docs`.

## Basic Flow

1. Read projects with `GET /api/projects`.
2. Read available recipes with `GET /api/generation/templates?project=<project_id>`.
3. Submit a single task or batch through a recipe.
4. Poll the canonical generation task or batch state.
5. Read artifacts from the task result, then use library and publishing APIs.

Every production request must carry a real project identity and pass through recipe compilation. Clients must not assemble internal pipeline parameters directly.

## State Handling

Task terminal states are `completed`, `failed`, `cancelled`, and `interrupted`. A service restart preserves terminal tasks and marks unfinished work as `interrupted`. Clients must show backend errors and must not infer success or write content lifecycle transitions merely to reconcile a view.

See the [API overview](../reference/api-overview.md) for routes and request examples.
