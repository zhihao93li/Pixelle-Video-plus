# Quick Start

## Start the Services

Start the API from the repository root:

```bash
uv run uvicorn api.app:app --host 127.0.0.1 --port 8000
```

Start the console in another terminal:

```bash
cd apps/console
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

## Initial Setup

1. Open Settings.
2. Create or select a project under Projects.
3. Configure content models and voice services under AI & Voice.
4. Check local or cloud generation connections under Generation.
5. Confirm the required production recipes are enabled.

Each section saves independently. The diagnostics summary shows connections that still need attention.

## Generate the First Artifact

1. Open Quick Create.
2. Choose video, image set, long-form text, or a specialized video flow.
3. Select a recipe and open its generation workspace.
4. Enter a script, topic, or source assets.
5. Review the estimate and current overrides, then start generation.
6. Follow progress in the right rail or on the Tasks page.
7. Preview the result in Library and continue to publishing when eligible.

Batch is a submission mode, not a separate page. Switch to Batch inside a recipe that supports it.

## Other Entry Points

The Streamlit interface remains independently runnable for the Windows package and low-level diagnostics:

```bash
uv run streamlit run web/app.py
```

API documentation is available at `http://127.0.0.1:8000/docs` by default.
