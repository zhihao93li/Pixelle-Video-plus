# Configuration

The production configuration surface is the console Settings area. Each section saves independently and displays failures in place.

## First-Time Order

1. **Projects**: create or select a project and choose its default production recipe.
2. **AI & Voice**: configure drafting models, TTS mode, voices, and workflows.
3. **Generation**: configure local ComfyUI or RunningHub and run connection diagnostics.
4. **Publishing & Storage**: configure output storage, publishing targets, and credentials.
5. **Recipes**: enable the recipes required by the current project and edit recipe defaults when needed.

## Configuration Sources

Runtime configuration is stored in local `config.yaml` and the backend data directory. The React console is the production configuration surface. Do not edit configuration concurrently from the legacy Streamlit process during migration, because a stale process can overwrite newer values. Never place credentials or business defaults in frontend code.

Generation settings use one precedence rule:

```text
project defaults → effective recipe defaults → current-run overrides
```

Fields unchanged for the current run are not submitted as overrides.

## Diagnostics

The Settings overview reports LLM, TTS, media generation, FFmpeg, storage, and publishing readiness separately. A failure is never presented as an empty configuration or successful state. Resolve the blocking section before a real production run.
