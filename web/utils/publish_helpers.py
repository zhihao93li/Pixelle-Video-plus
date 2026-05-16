"""Small helpers for the publish controls."""

from datetime import date, datetime, time
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError, available_timezones

DEFAULT_PUBLISH_TIMEZONE = "Asia/Shanghai"
COMMON_PUBLISH_TIMEZONES = [
    DEFAULT_PUBLISH_TIMEZONE,
    "Asia/Singapore",
    "Asia/Hong_Kong",
    "Asia/Taipei",
    "Asia/Tokyo",
    "Asia/Seoul",
    "Australia/Sydney",
    "UTC",
    "Europe/London",
    "Europe/Paris",
    "America/Los_Angeles",
    "America/New_York",
]
PUBLISH_TIMEZONE_OPTIONS = list(
    dict.fromkeys([*COMMON_PUBLISH_TIMEZONES, *sorted(available_timezones())])
)


def _split_first_nonempty_line(text: str) -> tuple[str, str]:
    lines = text.splitlines()
    for index, line in enumerate(lines):
        clean_line = line.strip()
        if clean_line:
            remaining = "\n".join(lines[index + 1:]).strip()
            return clean_line, remaining
    return "", ""


def build_default_title(metadata: dict, max_title_chars: int = 100) -> str:
    """Build the default publish title from persisted task metadata."""
    input_params = metadata.get("input", {}) if metadata else {}
    title = (input_params.get("title") or "").strip()
    if not title:
        text = (input_params.get("text") or "").strip()
        title, _ = _split_first_nonempty_line(text)

    if len(title) > max_title_chars:
        title = title[:max_title_chars].rstrip()
    return title


def build_default_caption(metadata: dict, max_text_chars: int = 500) -> str:
    """Build a conservative default caption from persisted task metadata."""
    input_params = metadata.get("input", {}) if metadata else {}
    title = (input_params.get("title") or "").strip()
    text = (input_params.get("text") or "").strip()
    if not title and input_params.get("mode") == "fixed":
        _, text = _split_first_nonempty_line(text)

    if len(text) > max_text_chars:
        text = text[:max_text_chars].rstrip() + "..."

    return text


def _normalize_hashtags(hashtags: str) -> str:
    raw = (hashtags or "").strip()
    if not raw:
        return ""

    tokens = raw.replace(",", " ").replace("，", " ").split()
    normalized = []
    for token in tokens:
        tag = token.strip()
        if not tag:
            continue
        if not tag.startswith("#"):
            tag = f"#{tag}"
        normalized.append(tag)

    return " ".join(normalized)


def append_hashtags_to_caption(caption: str, hashtags: str) -> str:
    """Append normalized hashtags as a separate caption block."""
    clean_caption = (caption or "").strip()
    clean_hashtags = _normalize_hashtags(hashtags)
    if not clean_hashtags:
        return clean_caption
    if not clean_caption:
        return clean_hashtags
    return f"{clean_caption}\n\n{clean_hashtags}"


def build_scheduled_due_at(due_date: date, due_time: time, timezone_name: str) -> str:
    """Build the ISO timestamp Buffer expects for a custom scheduled post."""
    clean_timezone = (timezone_name or DEFAULT_PUBLISH_TIMEZONE).strip()
    try:
        timezone = ZoneInfo(clean_timezone)
    except ZoneInfoNotFoundError as exc:
        raise ValueError(f"Unknown publish timezone: {timezone_name}") from exc

    return datetime.combine(due_date, due_time, tzinfo=timezone).isoformat()
