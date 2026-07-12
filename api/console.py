"""React console build discovery for the unified application service."""

from pathlib import Path


def resolve_console_dist(project_root: Path) -> Path | None:
    """Return a complete Vite build directory, or ``None`` when it is absent."""
    dist_dir = project_root / "apps" / "console" / "dist"
    if not (dist_dir / "index.html").is_file():
        return None
    if not (dist_dir / "assets").is_dir():
        return None
    return dist_dir
