# Pixelle Agent MCP

Start the Pixelle API first:

```bash
uv run uvicorn api.app:app --host 127.0.0.1 --port 8000
```

Register this stdio server in Codex, Claude Code, or Cursor:

```json
{
  "command": "uv",
  "args": ["run", "python", "-m", "agent_plugin.server"],
  "cwd": "/absolute/path/to/pixlle",
  "env": {
    "PIXELLE_VIDEO_ROOT": "/absolute/path/to/pixlle",
    "PIXELLE_API_BASE": "http://127.0.0.1:8000/api"
  }
}
```

The local token is read from `PIXELLE_AGENT_TOKEN`, then
`PIXELLE_AGENT_TOKEN_FILE`, then `<PIXELLE_VIDEO_ROOT>/data/agent-token`.
Always call `get_capabilities` first. Human confirmation can happen in React
or through `confirm_pending_item` after the Agent has displayed the complete
pending version and received an explicit approval from the user.

## Stable production contract

- Read `pipelines`, `recipes[].launch_surfaces`, and `agent_producible` from
  `get_capabilities`; do not send `entry` or guess a route.
- Every write uses a stable `request_id`. Network retries of the same logical
  request reuse it.
- `start_production` requires explicit `project_id`, `pipeline_id`,
  `recipe_id`, route input, and optional allowed overrides. It returns the
  ledger `content_item_id` and stable `production_task_id`.
- `add_topics`, `draft_items`, and `produce_item` are not production-entry
  tools. Start a complete route once with `start_production`.
- `confirm_pending_item` requires the exact pending item's `updated_at` as
  `content_version` and an explicit user decision. Stale versions are rejected.
- `edit_pending_review` saves direct user edits; `regenerate_pending_review`
  rewrites a script, selected scenes/pages, or the complete plan. Both keep the
  same stable production task and invalidate any older pending version.
- Use `list_production_tasks` for the four factual workbench states. A
  generation task is an execution attempt, not a second user-visible job.
- Required artifacts must exist and be readable before a task is `produced`.

The Codex image-story route remains two-stage: start the route with its
text-only scene manifest, wait for human confirmation, then upload images by
`scene_id`. Once every image is present, Pixelle continues the existing task
automatically. Replacing one scene keeps prior image files and video attempts.
