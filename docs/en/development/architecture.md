# Architecture

Pixelle is one business system composed of a React console, FastAPI contract layer, and Python production services.

```mermaid
flowchart LR
    Console[React Console] --> API[FastAPI]
    Codex[Codex Plugin] --> API
    API --> Content[Projects and Content]
    API --> Tasks[Task Manager]
    API --> Generation[Generation Registry]
    Generation --> Pipelines[Pipelines]
    Pipelines --> Services[LLM / TTS / Media / Publish]
```

## Layers

| Layer | Location | Responsibility |
| --- | --- | --- |
| Console | `apps/console` | Routing, interaction, and ViewModel rendering |
| API | `api` | HTTP contracts, validation, and task entry points |
| Content | `pixelle_video/content` | Projects, content items, and drafting profiles |
| Generation | `pixelle_video/generation` | Recipes, parameter merging, execution, and quality |
| Pipelines | `pixelle_video/pipelines` | Artifact-specific production implementations |
| Services | `pixelle_video/services` | LLM, TTS, media, storage, and publishing |
| Operations | `ops` | Operating-project state and persistence |
| Agent | `codex_plugin` | Controlled automation operations |

## Boundaries

- Every production request is compiled through the recipe registry before entering a pipeline.
- The frontend does not interpret raw backend states; states are adapted into shared ViewModels.
- Projects, tasks, artifacts, and publishing state belong to backend persistence.
- API, console, and agent interfaces share the same business contracts and do not copy state machines.
- External provider failures remain explicit and cannot be hidden behind successful fallbacks.
