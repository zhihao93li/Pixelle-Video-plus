# Pixelle Production Template Demo

React + Vite + shadcn/ui workspace for the Pixelle production-template console.

This app is the current React migration target for the Streamlit-to-React work.
It calls the real FastAPI task, history, settings, resource, publish-readiness,
batch, script-review, and special-pipeline APIs. Streamlit remains available as
the legacy/debug UI until the migration gate closes.

Current product and migration context:

- `docs/zh/product/pixelle-production-template-productization-prd.md`
- `docs/zh/product/streamlit-react-migration-matrix.md`

## Scope

The React workspace currently covers:

- Standard production templates through real generation tasks.
- Asset/Montage generation through production templates.
- I2V, Action Transfer, and Digital Human special pipeline submission.
- Batch generation and Script Review.
- History, publish readiness, settings, resources, and help surfaces.
- Real task polling, result display, and backend failure reporting.

Known migration gate:

- Action Transfer still needs RunningHub workflow/runtime E2E closure.
- Buffer real publish is intentionally user-confirmed because it can create
  external posts.

## Commands

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm run build
```
