import html
import json
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from pixelle_video.services.video import VideoService


class ComposeRuntimeError(RuntimeError):
    pass


@dataclass
class ComposeRuntimeContext:
    segment_paths: list[str]
    output_path: str
    task_dir: str
    storyboard: Any = None
    bgm_path: str | None = None
    bgm_volume: float = 0.2
    bgm_mode: str = "loop"
    params: dict[str, Any] = field(default_factory=dict)


@dataclass
class ComposeRuntimeResult:
    output_path: str
    runtime_id: str
    metadata: dict[str, Any] = field(default_factory=dict)


class ComposeRuntime(Protocol):
    def render(self, context: ComposeRuntimeContext) -> ComposeRuntimeResult:
        ...


class ComposeRuntimeRegistry:
    def __init__(self):
        self._runtimes: dict[str, ComposeRuntime] = {}

    def register(self, runtime_id: str, runtime: ComposeRuntime) -> None:
        if runtime_id in self._runtimes:
            raise ValueError(f"Compose runtime already registered: {runtime_id}")
        self._runtimes[runtime_id] = runtime

    def get(self, runtime_id: str) -> ComposeRuntime:
        try:
            return self._runtimes[runtime_id]
        except KeyError:
            raise ComposeRuntimeError(f"Unknown compose runtime: {runtime_id}") from None


class HtmlFfmpegComposeRuntime:
    runtime_id = "html_ffmpeg"

    def render(self, context: ComposeRuntimeContext) -> ComposeRuntimeResult:
        output_path = VideoService().concat_videos(
            videos=context.segment_paths,
            output=context.output_path,
            bgm_path=context.bgm_path,
            bgm_volume=context.bgm_volume,
            bgm_mode=context.bgm_mode,
        )
        return ComposeRuntimeResult(
            output_path=output_path,
            runtime_id=self.runtime_id,
            metadata={"segment_count": len(context.segment_paths)},
        )


class HyperframesComposeRuntime:
    runtime_id = "hyperframes"

    def render(self, context: ComposeRuntimeContext) -> ComposeRuntimeResult:
        if not shutil.which("npx"):
            raise ComposeRuntimeError("HyperFrames runtime requires npx, but npx is not available.")
        if not context.segment_paths:
            raise ComposeRuntimeError("HyperFrames runtime requires at least one video segment.")

        project_dir = Path(context.task_dir) / "hyperframes_compose"
        if project_dir.exists():
            shutil.rmtree(project_dir)
        media_dir = project_dir / "media"
        media_dir.mkdir(parents=True, exist_ok=True)

        scenes = self._copy_scene_media(context, media_dir)
        bgm_rel_path = self._copy_bgm(context, media_dir)
        (project_dir / "DESIGN.md").write_text(self._design_markdown(), encoding="utf-8")
        (project_dir / "index.html").write_text(
            self._index_html(scenes, bgm_rel_path=bgm_rel_path, bgm_volume=context.bgm_volume),
            encoding="utf-8",
        )

        self._run(["npx", "hyperframes", "lint"], cwd=project_dir)
        self._run(["npx", "hyperframes", "inspect", "--samples", "5"], cwd=project_dir)
        self._run(
            [
                "npx",
                "hyperframes",
                "render",
                "--output",
                str(Path(context.output_path).resolve()),
                "--quality",
                str(context.params.get("hyperframes_quality", "standard")),
            ],
            cwd=project_dir,
        )

        output_path = Path(context.output_path)
        if not output_path.is_file():
            raise ComposeRuntimeError("HyperFrames render completed without creating the output video.")

        return ComposeRuntimeResult(
            output_path=str(output_path),
            runtime_id=self.runtime_id,
            metadata={
                "project_dir": str(project_dir),
                "segment_count": len(scenes),
                "hyperframes_quality": context.params.get("hyperframes_quality", "standard"),
            },
        )

    def _copy_scene_media(self, context: ComposeRuntimeContext, media_dir: Path) -> list[dict[str, Any]]:
        frames = list(getattr(context.storyboard, "frames", []) or [])
        scenes: list[dict[str, Any]] = []
        current_start = 0.0
        for index, segment_path in enumerate(context.segment_paths):
            source = Path(segment_path)
            if not source.is_file():
                raise ComposeRuntimeError(f"Video segment is missing: {segment_path}")

            target_name = f"scene-{index + 1:03d}{source.suffix or '.mp4'}"
            target = media_dir / target_name
            shutil.copy2(source, target)

            frame = frames[index] if index < len(frames) else None
            duration = _frame_duration(frame, default=context.params.get("default_scene_duration", 3.0))
            narration = str(getattr(frame, "narration", "") or f"Scene {index + 1}")
            scenes.append(
                {
                    "index": index,
                    "start": current_start,
                    "duration": duration,
                    "src": f"media/{target_name}",
                    "caption": narration,
                }
            )
            current_start += duration
        return scenes

    def _copy_bgm(self, context: ComposeRuntimeContext, media_dir: Path) -> str | None:
        if not context.bgm_path:
            return None
        source = Path(context.bgm_path)
        if not source.is_file():
            raise ComposeRuntimeError(f"BGM file is missing: {context.bgm_path}")
        target_name = f"bgm{source.suffix or '.mp3'}"
        shutil.copy2(source, media_dir / target_name)
        return f"media/{target_name}"

    def _index_html(
        self,
        scenes: list[dict[str, Any]],
        *,
        bgm_rel_path: str | None,
        bgm_volume: float,
    ) -> str:
        total_duration = sum(scene["duration"] for scene in scenes)
        scene_clips = []
        transition_clips = []
        animations = []
        for scene in scenes:
            index = scene["index"]
            start = scene["start"]
            duration = scene["duration"]
            caption = html.escape(scene["caption"])
            src = html.escape(scene["src"])
            scene_clips.append(
                f"""
    <video id="video-{index}" class="clip" data-start="{start:.3f}" data-duration="{duration:.3f}" data-track-index="0" src="{src}" muted playsinline></video>
    <audio id="audio-{index}" class="clip" data-start="{start:.3f}" data-duration="{duration:.3f}" data-track-index="{10 + index}" src="{src}" data-volume="1"></audio>
    <div id="caption-{index}" class="clip caption" data-start="{start:.3f}" data-duration="{duration:.3f}" data-track-index="{30 + index}">{caption}</div>"""
            )
            animations.append(
                f"""tl.from({json.dumps(f"#caption-{index}")}, {{ y: 48, opacity: 0, scale: 0.98, duration: 0.55, ease: "power3.out" }}, {start + 0.2:.3f});"""
            )
            if index > 0:
                transition_clips.append(
                    f"""<div id="transition-{index}" class="clip transition" data-start="{start:.3f}" data-duration="0.550" data-track-index="{60 + index}"></div>"""
                )
                animations.append(
                    f"""tl.fromTo({json.dumps(f"#transition-{index}")}, {{ opacity: 1 }}, {{ opacity: 0, duration: 0.55, ease: "power2.out" }}, {start:.3f});"""
                )

        bgm_clip = ""
        if bgm_rel_path:
            bgm_clip = (
                f'<audio id="bgm" class="clip" data-start="0" data-duration="{total_duration:.3f}" '
                f'data-track-index="90" src="{html.escape(bgm_rel_path)}" data-volume="{bgm_volume}"></audio>'
            )

        return f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Pixelle HyperFrames Composition</title>
</head>
<body>
  <div data-composition-id="pixelle-hyperframes" data-start="0" data-duration="{total_duration:.3f}" data-width="1080" data-height="1920">
    {''.join(scene_clips)}
    {''.join(transition_clips)}
    {bgm_clip}
    <style>
      [data-composition-id="pixelle-hyperframes"] {{
        position: relative;
        overflow: hidden;
        width: 100%;
        height: 100%;
        background: #0f1f1c;
        font-family: "Inter", sans-serif;
      }}
      video {{
        width: 100%;
        height: 100%;
        object-fit: cover;
      }}
      .caption {{
        position: absolute;
        left: 72px;
        right: 72px;
        bottom: 150px;
        box-sizing: border-box;
        padding: 32px 36px;
        border-radius: 28px;
        background: rgba(247, 243, 231, 0.92);
        color: #13231f;
        font-size: 58px;
        line-height: 1.16;
        font-weight: 760;
        text-wrap: balance;
        box-shadow: 0 22px 70px rgba(0, 0, 0, 0.32);
      }}
      .transition {{
        position: absolute;
        inset: 0;
        background: #f2c94c;
      }}
    </style>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <script>
      window.__timelines = window.__timelines || {{}};
      const tl = gsap.timeline({{ paused: true }});
      {" ".join(animations)}
      window.__timelines["pixelle-hyperframes"] = tl;
    </script>
  </div>
</body>
</html>
"""

    def _design_markdown(self) -> str:
        return """# Pixelle PetWoods HyperFrames Style

## Style Prompt
Warm editorial pet-care explainer with tactile caption cards, soft cream surfaces, deep green backgrounds, and clear high-contrast typography.

## Colors
- Deep green: #0f1f1c
- Cream card: #f7f3e7
- Charcoal text: #13231f
- Warm accent: #f2c94c

## Typography
- Inter or Noto Sans SC for clean bilingual captions.

## What NOT to Do
- Do not use generic blue/purple SaaS gradients.
- Do not place small text over busy footage.
- Do not silently hide captions during transitions.
"""

    def _run(self, command: list[str], *, cwd: Path) -> None:
        completed = subprocess.run(
            command,
            cwd=str(cwd),
            check=False,
            capture_output=True,
            text=True,
            timeout=180,
        )
        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout or "").strip()
            raise ComposeRuntimeError(
                f"HyperFrames command failed: {' '.join(command)}"
                + (f"\n{detail}" if detail else "")
            )


def build_default_compose_runtime_registry() -> ComposeRuntimeRegistry:
    registry = ComposeRuntimeRegistry()
    registry.register("html_ffmpeg", HtmlFfmpegComposeRuntime())
    registry.register("hyperframes", HyperframesComposeRuntime())
    return registry


def render_with_compose_runtime(
    runtime_id: str,
    context: ComposeRuntimeContext,
    *,
    registry: ComposeRuntimeRegistry | None = None,
) -> ComposeRuntimeResult:
    runtime_registry = registry or build_default_compose_runtime_registry()
    return runtime_registry.get(runtime_id).render(context)


def _frame_duration(frame: Any, *, default: float) -> float:
    raw_duration = getattr(frame, "duration", None)
    try:
        duration = float(raw_duration)
    except (TypeError, ValueError):
        duration = float(default)
    return max(duration, 0.1)
