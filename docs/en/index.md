# Pixelle

Pixelle is an AI content production workspace for solo content operators. It connects topics, drafts, review, production, artifacts, and publishing inside one project scope, with support for video, image sets, and long-form text.

## Product Surfaces

- **Board** manages content lifecycle and the next available action.
- **Quick Create** submits single or batch work through standard, asset, and specialized recipes.
- **Tasks** shows production runs, child tasks, cancellation, failures, and retries.
- **Library** previews video, image sets, and text before publishing.
- **Settings** manages projects, AI, voice, generation engines, storage, and recipes.

## Quick Start

1. [Install the backend and console](getting-started/installation.md).
2. [Configure a project and production services](getting-started/configuration.md).
3. [Start the services and create an artifact](getting-started/quick-start.md).

The production console runs at `http://127.0.0.1:5173`. FastAPI documentation is available at `http://127.0.0.1:8000/docs` by default.

## Product and Engineering Boundaries

- See the [current product contract](product/current-product.md) for ownership rules.
- See the [API overview](reference/api-overview.md) for HTTP contracts.
- See [architecture](development/architecture.md) for system layers.

Pixelle is licensed under Apache License 2.0.
