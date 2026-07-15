# Installation

## Requirements

- Python 3.11+
- Node.js 20.19+ or 22.12+
- `uv`
- FFmpeg and FFprobe
- macOS, Linux, or Windows

A compatible GPU and model installation are required only when using a local ComfyUI service.

## Install Source Dependencies

```bash
git clone https://github.com/zhihao93li/Pixelle-Video-plus.git
cd Pixelle-Video-plus
uv sync --extra dev
cd apps/console
npm install
```

Copy the example configuration:

```bash
cp config.example.yaml config.yaml
```

Credentials and service URLs can also be entered in the console Settings area.

## Verify the Installation

From the repository root:

```bash
uv run python -c "from api.app import app; print(app.title)"
uv run ffmpeg -version
```

From `apps/console`:

```bash
npm run typecheck
npm run build
```

Continue with the [quick start](quick-start.md).
