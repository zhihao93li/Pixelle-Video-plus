# Windows Package Builder

Automated build system for creating Windows portable packages of Pixelle-Video.

## Quick Start

### Prerequisites

- Windows 10/11 x64 build host (cross-platform builds are rejected because native wheels are platform-specific)
- Python 3.11+ (for running the build script)
- Node.js 20.19+ or 22.12+ and npm (required by the locked Vite toolchain)
- PyYAML: `pip install pyyaml`
- Internet connection (for downloading Python, FFmpeg, etc.)

### Build Package

```bash
# Run these commands on Windows. Basic build:
python packaging/windows/build.py

# Build with China mirrors (faster in China)
python packaging/windows/build.py --cn-mirror

# Custom output directory
python packaging/windows/build.py --output /path/to/output
```

## Configuration

Edit `config/build_config.yaml` to customize:

- Python version
- FFmpeg version
- Excluded files/folders
- Build options
- Mirror settings

## Output

The build process creates:

```
dist/windows/
├── Pixelle-Video-v*-win64/             # Build directory (version number varies)
│   ├── python/                         # Python embedded
│   ├── tools/                          # FFmpeg and portable Chromium
│   ├── Pixelle-Video/                  # Allowlisted project files
│   │   ├── apps/console/dist/          # Production React console
│   │   ├── data/                       # Runtime data (empty except built-in prompts)
│   │   └── output/                     # Generated output (empty)
│   ├── start.bat                       # Main launcher
│   ├── open_browser.py                 # Health-aware browser launcher
│   └── README.txt                      # User guide
├── Pixelle-Video-v*-win64.zip          # ZIP package (version number varies)
└── Pixelle-Video-v*-win64.zip.sha256   # Checksum (version number varies)
```

## Build Process

The builder performs these steps:

1. **Download Phase**
   - Python embedded distribution
   - FFmpeg portable
   - Cached in `.cache/` for reuse

2. **Extract Phase**
   - Extract Python to `build/python/`
   - Extract FFmpeg to `build/tools/ffmpeg/`

3. **Prepare Phase**
   - Enable site-packages in Python
   - Install pip

4. **Install Phase**
   - Install runtime dependencies using the embedded Windows Python
   - Install portable Playwright Chromium
   - Pre-install all packages

5. **Console Build Phase**
   - Install locked npm dependencies
   - Build the React console with same-origin `/api` requests

6. **Copy Phase**
   - Copy project files (excluding test/docs/cache)
   - Generate launcher scripts from templates
   - Create empty directories

7. **Package Phase**
   - Create ZIP archive
   - Generate SHA256 checksum

## Templates

Launcher script templates in `templates/`:

- `start.bat` - Unified React console and API launcher
- `open_browser.py` - Opens the console after the API health check passes
- `README.txt` - User documentation

Templates support placeholders:
- `{VERSION}` - Project version
- `{BUILD_DATE}` - Build timestamp

## Cache

Downloaded files are cached in `.cache/`:

```
.cache/
├── python-3.11.9-embed-amd64.zip
├── ffmpeg-autobuild-2026-06-30-13-34-win64.zip
└── get-pip.py
```

Every cached build input is checked against its pinned SHA-256 digest. Delete the
cache to force a verified re-download.

## Troubleshooting

### Build fails with "PyYAML not found"

```bash
pip install pyyaml
```

### Downloads are slow

Use China mirrors:

```bash
python build.py --cn-mirror
```

### Dependencies installation fails

Check:
1. Internet connection
2. PyPI mirrors accessibility
3. Project dependencies in `pyproject.toml`

### ZIP creation fails

Ensure:
1. Sufficient disk space
2. Write permissions to output directory
3. No files are locked by other processes

## Advanced Usage

### Custom Configuration

Create custom config file:

```bash
cp config/build_config.yaml config/my_config.yaml
# Edit my_config.yaml
python build.py --config config/my_config.yaml
```

### Skip ZIP Creation

Edit `build_config.yaml`:

```yaml
build:
  create_zip: false
```

### Include Chrome Portable

Edit `build_config.yaml`:

```yaml
chrome:
  include: true
  download_url: "https://path/to/chrome-portable.zip"
```

## Maintenance

### Update Python Version

Edit `config/build_config.yaml`:

```yaml
python:
  version: "3.11.10"
  download_url: "https://www.python.org/ftp/python/3.11.10/python-3.11.10-embed-amd64.zip"
```

### Update FFmpeg Version

Edit `config/build_config.yaml`:

```yaml
ffmpeg:
  version: "6.2.0"
  download_url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/..."
```

## Distribution

To distribute the package:

1. Upload ZIP file to release page
2. Include SHA256 checksum for verification
3. Provide installation instructions

Users verify download:

```bash
# Windows PowerShell
Get-FileHash Pixelle-Video-v*-win64.zip -Algorithm SHA256
```

Compare with `.sha256` file.

## License

Same as Pixelle-Video project license.
