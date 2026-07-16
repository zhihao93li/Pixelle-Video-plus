# Web Console

The Pixelle console organizes content production by project. Desktop uses a primary sidebar; page title, project switching, and theme controls live in one shared shell.

## Board

The workbench groups production tasks by confirmed states: needs attention, in progress, failed, and produced. Opening a task card goes directly to its single detail page. The most important current action is at the top; real outputs, failures, and retries follow below in reverse chronological order.

## Quick Production

Quick Production first selects the artifact family and then a production template:

- Video from scripts, topics, or source assets
- Image sets with a cover and pages
- Structured long-form text
- Specialized video flows: image-to-video, action transfer, and digital human

The generation workspace keeps input and current overrides together. Submission opens the workbench task detail for progress, human confirmation, recovery, and results. Batch is a mode inside supported templates; each item creates an independent task and there is no batch-level status.

## Library

Library supports keyword, artifact type, status, and sort filters. Selecting an item opens video, image-set, or text preview, production facts, download actions, and publishing when eligible.

## Settings

Settings uses URL-backed sections:

- Overview
- Projects
- AI & Voice
- Generation
- Publishing & Storage
- Templates
- Help

Each configuration section saves independently. Unsaved changes are marked and protected when leaving.

## State and Recovery

Loading failures, empty data, and stale data are separate states. Errors appear near the affected action with an explicit recovery path; they are never presented as empty lists or successful results.

Completed and failed task states survive a service restart. Work that was still in progress becomes interrupted and requires an explicit retry.
