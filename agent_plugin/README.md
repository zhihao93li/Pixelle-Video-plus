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
Always call `get_capabilities` first. Confirmation is intentionally absent:
the user confirms drafts and scene manifests in the React console.
