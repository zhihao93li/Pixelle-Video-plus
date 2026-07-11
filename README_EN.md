# Pixelle

Pixelle is an AI content production workspace for solo content operators. It keeps topics, drafting, generation, task tracking, artifacts, and publishing inside one project scope. The current product supports video, image-set, and long-form text artifacts.

## Capabilities

- Project and content lifecycle management
- Standard video, asset-based video, image-set, text, and batch generation
- Image-to-video, action transfer, and digital-human generation
- Multilingual draft review and unified production submission
- Run progress, failure recovery, and per-item retry
- Artifact preview, publish preparation, and publish status
- Project, AI, voice, generation, storage, and recipe settings

## Repository Structure

| Directory | Responsibility |
| --- | --- |
| `apps/console` | Production React + Vite console |
| `api` | FastAPI routes, request contracts, and task entry points |
| `pixelle_video` | Content generation, recipes, pipelines, and media services |
| `ops` | Operating-project state and persistence |
| `codex_plugin` | Codex operations interface |
| `web` | Independently runnable Streamlit interface |
| `tests` | Python unit and integration tests |

See the [current product contract](docs/zh/product/current-product.md) and the console [design and implementation contract](apps/console/DESIGN.md).

## Local Development

Requires Python 3.11+, Node.js 20+, FFmpeg, and `uv`.

Install backend dependencies:

```bash
uv sync --extra dev
```

Start the API:

```bash
uv run uvicorn api.app:app --host 127.0.0.1 --port 8000
```

Start the console in another terminal:

```bash
cd apps/console
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. API documentation is available at `http://127.0.0.1:8000/docs` by default.

The Streamlit interface can be started independently:

```bash
uv run streamlit run web/app.py
```

## Verification

Backend:

```bash
uv run pytest
uv run ruff check .
```

Console:

```bash
cd apps/console
npm run typecheck
npm run lint
npm run test:p1
npm run build
npm run test:e2e
```

## Configuration and Documentation

- Create local `config.yaml` from `config.example.yaml`.
- User documentation lives in `docs/zh` and `docs/en`.
- Windows packaging instructions live in `packaging/windows/README.md`.

## License

Apache License 2.0. See [LICENSE](LICENSE).
